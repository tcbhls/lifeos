package app.lifeos.health;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import dev.ffmpegkit.llama.LlamaJNI;

import org.json.JSONObject;

import java.io.BufferedInputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * LifeOS 内置端侧大模型原生插件（基于预编译 ARM64 llama.cpp JNI）：
 * - 直接在手机端侧运行量化 GGUF 模型（Qwen2.5 / Qwen3），无需外部电脑、Termux 或云端 API
 * - 支持魔搭社区 / HF-Mirror 国内高速流式下载、GGUF 文件头校验、进度广播与断点清理
 */
@CapacitorPlugin(name = "LifeOsLocalLlm")
public class LifeOsLocalLlmPlugin extends Plugin {

    private final ExecutorService inferenceExecutor = Executors.newSingleThreadExecutor();
    private final ExecutorService downloadExecutor = Executors.newSingleThreadExecutor();
    private final AtomicBoolean cancelDownloadFlag = new AtomicBoolean(false);
    private final AtomicBoolean isDownloading = new AtomicBoolean(false);

    private volatile long loadedHandle = 0L;
    private volatile String loadedFileName = "";

    private File getModelsDir() {
        File dir = new File(getContext().getFilesDir(), "models");
        if (!dir.exists()) {
            //noinspection ResultOfMethodCallIgnored
            dir.mkdirs();
        }
        return dir;
    }

    private String sanitizeFileName(String raw) {
        if (raw == null) return "";
        return raw.replaceAll("[^a-zA-Z0-9._-]", "");
    }

    @PluginMethod
    public void getStatus(PluginCall call) {
        try {
            File dir = getModelsDir();
            JSArray filesArr = new JSArray();
            File[] files = dir.listFiles();
            if (files != null) {
                for (File f : files) {
                    if (f.isFile() && f.getName().endsWith(".gguf")) {
                        JSObject item = new JSObject();
                        item.put("fileName", f.getName());
                        item.put("sizeBytes", f.length());
                        filesArr.put(item);
                    }
                }
            }

            String sysInfo = "";
            boolean engineAvailable = true;
            try {
                sysInfo = LlamaJNI.INSTANCE.nativeGetSystemInfo();
            } catch (Throwable t) {
                engineAvailable = false;
                sysInfo = "设备架构不支持 arm64-v8a 原生引擎：" + t.getMessage();
            }

            JSObject ret = new JSObject();
            ret.put("supported", engineAvailable);
            ret.put("loaded", loadedHandle != 0L);
            ret.put("loadedFileName", loadedFileName);
            ret.put("downloading", isDownloading.get());
            ret.put("systemInfo", sysInfo);
            ret.put("modelsDir", dir.getAbsolutePath());
            ret.put("downloadedFiles", filesArr);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("获取端侧引擎状态失败：" + e.getMessage(), e);
        }
    }

    @PluginMethod
    public void downloadModel(PluginCall call) {
        final String primaryUrl = call.getString("url", "");
        final String fallbackUrl = call.getString("fallbackUrl", "");
        final String fileName = sanitizeFileName(call.getString("fileName", ""));

        if (primaryUrl == null || primaryUrl.isEmpty() || fileName.isEmpty() || !fileName.endsWith(".gguf")) {
            call.reject("缺少合法的模型下载地址或文件名");
            return;
        }
        if (!isDownloading.compareAndSet(false, true)) {
            call.reject("已有模型正在下载中，请等待完成或先取消");
            return;
        }

        cancelDownloadFlag.set(false);

        downloadExecutor.execute(() -> {
            File finalFile = new File(getModelsDir(), fileName);
            File partFile = new File(getModelsDir(), fileName + ".part");
            try {
                if (finalFile.exists() && finalFile.length() > 50L * 1024L * 1024L) {
                    JSObject ret = new JSObject();
                    ret.put("fileName", fileName);
                    ret.put("sizeBytes", finalFile.length());
                    ret.put("alreadyExisted", true);
                    call.resolve(ret);
                    return;
                }

                Exception lastErr = null;
                String[] urls = (fallbackUrl != null && !fallbackUrl.isEmpty())
                        ? new String[]{primaryUrl, fallbackUrl}
                        : new String[]{primaryUrl};

                boolean success = false;
                for (String targetUrl : urls) {
                    if (cancelDownloadFlag.get()) {
                        throw new InterruptedException("用户已取消下载");
                    }
                    try {
                        streamDownloadWithRedirects(targetUrl, partFile, fileName);
                        success = true;
                        break;
                    } catch (InterruptedException ie) {
                        throw ie;
                    } catch (Exception ex) {
                        lastErr = ex;
                        if (partFile.exists()) {
                            //noinspection ResultOfMethodCallIgnored
                            partFile.delete();
                        }
                    }
                }

                if (!success) {
                    throw (lastErr != null ? lastErr : new RuntimeException("所有镜像源均下载失败"));
                }

                if (finalFile.exists()) {
                    //noinspection ResultOfMethodCallIgnored
                    finalFile.delete();
                }
                if (!partFile.renameTo(finalFile)) {
                    throw new RuntimeException("模型文件写入重命名失败");
                }

                JSObject ret = new JSObject();
                ret.put("fileName", fileName);
                ret.put("sizeBytes", finalFile.length());
                ret.put("alreadyExisted", false);
                call.resolve(ret);
            } catch (InterruptedException ie) {
                if (partFile.exists()) {
                    //noinspection ResultOfMethodCallIgnored
                    partFile.delete();
                }
                call.reject("已取消模型下载");
            } catch (Exception e) {
                if (partFile.exists()) {
                    //noinspection ResultOfMethodCallIgnored
                    partFile.delete();
                }
                call.reject("模型下载失败：" + e.getMessage(), e);
            } finally {
                isDownloading.set(false);
            }
        });
    }

    private void streamDownloadWithRedirects(String initialUrl, File destFile, String fileName) throws Exception {
        String currentUrl = initialUrl;
        HttpURLConnection conn = null;
        int redirects = 0;

        try {
            while (redirects < 8) {
                URL u = new URL(currentUrl);
                conn = (HttpURLConnection) u.openConnection();
                conn.setInstanceFollowRedirects(false);
                conn.setConnectTimeout(15000);
                conn.setReadTimeout(30000);
                conn.setRequestProperty("User-Agent", "LifeOS-Android/1.0");
                int code = conn.getResponseCode();
                if (code == 301 || code == 302 || code == 303 || code == 307 || code == 308) {
                    String loc = conn.getHeaderField("Location");
                    conn.disconnect();
                    if (loc == null || loc.isEmpty()) {
                        throw new RuntimeException("镜像重定向地址为空");
                    }
                    URL nextUrl = new URL(u, loc);
                    currentUrl = nextUrl.toString();
                    redirects++;
                    continue;
                }
                if (code < 200 || code >= 300) {
                    throw new RuntimeException("HTTP " + code + " 下载被拒绝");
                }
                break;
            }

            if (conn == null) {
                throw new RuntimeException("无法建立下载连接");
            }

            long totalBytes = conn.getContentLengthLong();
            long downloaded = 0L;
            long startMs = System.currentTimeMillis();
            long lastEmitMs = 0L;
            boolean headerChecked = false;

            try (InputStream in = new BufferedInputStream(conn.getInputStream(), 65536);
                 FileOutputStream out = new FileOutputStream(destFile)) {
                byte[] buf = new byte[65536];
                int n;
                while ((n = in.read(buf)) != -1) {
                    if (cancelDownloadFlag.get()) {
                        throw new InterruptedException("用户已取消下载");
                    }
                    if (!headerChecked && n >= 4) {
                        // 校验文件头必须为标准 GGUF 魔数，防止下载到错误 HTML 页
                        if (buf[0] != 'G' || buf[1] != 'G' || buf[2] != 'U' || buf[3] != 'F') {
                            throw new RuntimeException("远端返回的不是有效 GGUF 模型文件");
                        }
                        headerChecked = true;
                    }
                    out.write(buf, 0, n);
                    downloaded += n;

                    long now = System.currentTimeMillis();
                    if (now - lastEmitMs >= 250 || (totalBytes > 0 && downloaded >= totalBytes)) {
                        lastEmitMs = now;
                        double elapsedSec = Math.max(0.2, (now - startMs) / 1000.0);
                        double speedMbps = (downloaded / 1024.0 / 1024.0) / elapsedSec;
                        int pct = totalBytes > 0 ? (int) Math.min(100, (downloaded * 100L) / totalBytes) : 0;

                        JSObject ev = new JSObject();
                        ev.put("fileName", fileName);
                        ev.put("downloadedBytes", downloaded);
                        ev.put("totalBytes", totalBytes);
                        ev.put("percent", pct);
                        ev.put("speedMBps", Math.round(speedMbps * 10.0) / 10.0);
                        notifyListeners("downloadProgress", ev);
                    }
                }
                out.flush();
            }

            if (!headerChecked || downloaded < 10L * 1024L * 1024L) {
                throw new RuntimeException("模型文件不完整，请重试");
            }
        } finally {
            if (conn != null) {
                conn.disconnect();
            }
        }
    }

    @PluginMethod
    public void cancelDownload(PluginCall call) {
        cancelDownloadFlag.set(true);
        JSObject ret = new JSObject();
        ret.put("cancelled", true);
        call.resolve(ret);
    }

    @PluginMethod
    public void deleteModel(PluginCall call) {
        final String fileName = sanitizeFileName(call.getString("fileName", ""));
        if (fileName.isEmpty()) {
            call.reject("缺少文件名");
            return;
        }
        inferenceExecutor.execute(() -> {
            try {
                if (fileName.equals(loadedFileName) && loadedHandle != 0L) {
                    LlamaJNI.INSTANCE.nativeReleaseModel(loadedHandle);
                    loadedHandle = 0L;
                    loadedFileName = "";
                }
                File f = new File(getModelsDir(), fileName);
                boolean deleted = !f.exists() || f.delete();
                JSObject ret = new JSObject();
                ret.put("deleted", deleted);
                call.resolve(ret);
            } catch (Exception e) {
                call.reject("删除模型失败：" + e.getMessage(), e);
            }
        });
    }

    @PluginMethod
    public void loadModel(PluginCall call) {
        final String fileName = sanitizeFileName(call.getString("fileName", ""));
        final int contextSize = call.getInt("contextSize", 2048);
        final int defaultThreads = Math.min(6, Math.max(2, Runtime.getRuntime().availableProcessors() - 2));
        final int threads = call.getInt("threads", defaultThreads);

        if (fileName.isEmpty()) {
            call.reject("缺少要加载的 GGUF 模型文件名");
            return;
        }

        inferenceExecutor.execute(() -> {
            try {
                if (loadedHandle != 0L && fileName.equals(loadedFileName)) {
                    JSObject ret = new JSObject();
                    ret.put("loaded", true);
                    ret.put("fileName", loadedFileName);
                    ret.put("cached", true);
                    call.resolve(ret);
                    return;
                }

                File modelFile = new File(getModelsDir(), fileName);
                if (!modelFile.exists()) {
                    call.reject("模型尚未下载：" + fileName);
                    return;
                }

                if (loadedHandle != 0L) {
                    LlamaJNI.INSTANCE.nativeReleaseModel(loadedHandle);
                    loadedHandle = 0L;
                    loadedFileName = "";
                }

                long startMs = System.currentTimeMillis();
                long handle = LlamaJNI.INSTANCE.nativeLoadModel(
                        modelFile.getAbsolutePath(),
                        contextSize,
                        threads,
                        0
                );
                if (handle == 0L) {
                    call.reject("模型加载失败（可能内存不足，可尝试改用更轻量的 0.6B 模型）");
                    return;
                }

                loadedHandle = handle;
                loadedFileName = fileName;

                JSObject ret = new JSObject();
                ret.put("loaded", true);
                ret.put("fileName", fileName);
                ret.put("loadTimeMs", System.currentTimeMillis() - startMs);
                ret.put("threads", threads);
                call.resolve(ret);
            } catch (Throwable t) {
                call.reject("端侧模型初始化异常：" + t.getMessage());
            }
        });
    }

    @PluginMethod
    public void unloadModel(PluginCall call) {
        inferenceExecutor.execute(() -> {
            if (loadedHandle != 0L) {
                LlamaJNI.INSTANCE.nativeReleaseModel(loadedHandle);
                loadedHandle = 0L;
                loadedFileName = "";
            }
            JSObject ret = new JSObject();
            ret.put("unloaded", true);
            call.resolve(ret);
        });
    }

    @PluginMethod
    public void complete(PluginCall call) {
        final String prompt = call.getString("prompt", "");
        final String systemPrompt = call.getString("systemPrompt", "");
        final int maxTokens = call.getInt("maxTokens", 380);
        final float temperature = call.getFloat("temperature", 0.45f);

        if (prompt == null || prompt.trim().isEmpty()) {
            call.reject("提示词不能为空");
            return;
        }

        inferenceExecutor.execute(() -> {
            if (loadedHandle == 0L) {
                call.reject("端侧模型尚未加载，请先在设置页下载并启用内置 AI 模型");
                return;
            }
            try {
                String rawJson = LlamaJNI.INSTANCE.nativeComplete(
                        loadedHandle,
                        prompt,
                        systemPrompt != null ? systemPrompt : "",
                        Math.max(32, Math.min(768, maxTokens)),
                        temperature,
                        0.9f,
                        40,
                        -1
                );

                JSONObject obj = new JSONObject(rawJson);
                if (obj.has("error")) {
                    call.reject("端侧推理失败：" + obj.optString("error"));
                    return;
                }

                JSObject ret = new JSObject();
                ret.put("text", obj.optString("text", "").trim());
                ret.put("tokensGenerated", obj.optInt("tokensGenerated", 0));
                ret.put("tokensPerSecond", obj.optDouble("tokensPerSecond", 0.0));
                ret.put("promptEvalTimeMs", obj.optLong("promptEvalTimeMs", 0L));
                ret.put("generateTimeMs", obj.optLong("generateTimeMs", 0L));
                ret.put("modelFileName", loadedFileName);
                call.resolve(ret);
            } catch (Throwable t) {
                call.reject("端侧推理异常：" + t.getMessage());
            }
        });
    }

    /** 前端首屏与主题绘制完毕后调用，平滑淡出原生启动画面，消除闪黑屏 */
    @PluginMethod
    public void hideLaunchSplash(PluginCall call) {
        if (getActivity() instanceof MainActivity) {
            ((MainActivity) getActivity()).hideLaunchSplash();
        }
        JSObject ret = new JSObject();
        ret.put("hidden", true);
        call.resolve(ret);
    }

    @Override
    protected void handleOnDestroy() {
        cancelDownloadFlag.set(true);
        if (loadedHandle != 0L) {
            try {
                LlamaJNI.INSTANCE.nativeReleaseModel(loadedHandle);
            } catch (Throwable ignored) {
            }
            loadedHandle = 0L;
            loadedFileName = "";
        }
        inferenceExecutor.shutdownNow();
        downloadExecutor.shutdownNow();
        super.handleOnDestroy();
    }
}
