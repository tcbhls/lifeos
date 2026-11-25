package app.lifeos.health;

import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.Settings;

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
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * LifeOS 内置端侧大模型原生插件（基于预编译 ARM64 llama.cpp JNI）：
 * - 支持与音枢 AI 音乐、EchoDeck 零拷贝共享手机公共目录 Download/LocalAI 中的同一份 GGUF 模型
 * - 支持 5GB 级大模型（Qwen3-8B / Qwen3-4B）HTTP Range 断点续传、GGUF 魔数头校验与主备源自动回退
 */
@CapacitorPlugin(name = "LifeOsLocalLlm")
public class LifeOsLocalLlmPlugin extends Plugin {

    private final ExecutorService inferenceExecutor = Executors.newSingleThreadExecutor();
    private final ExecutorService downloadExecutor = Executors.newSingleThreadExecutor();
    private final AtomicBoolean cancelDownloadFlag = new AtomicBoolean(false);
    private final AtomicBoolean isDownloading = new AtomicBoolean(false);

    private volatile long loadedHandle = 0L;
    private volatile String loadedFileName = "";
    private volatile String loadedFilePath = "";

    private boolean hasSharedStorageAccess() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            return Environment.isExternalStorageManager();
        }
        return true;
    }

    private File getSharedModelsDir() {
        return new File(
                Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS),
                "LocalAI"
        );
    }

    private File getPrivateModelsDir() {
        File dir = new File(getContext().getFilesDir(), "models");
        if (!dir.exists()) {
            //noinspection ResultOfMethodCallIgnored
            dir.mkdirs();
        }
        return dir;
    }

    private File getActiveWriteDir() {
        if (hasSharedStorageAccess()) {
            File shared = getSharedModelsDir();
            if (shared.exists() || shared.mkdirs()) {
                if (shared.canWrite()) {
                    return shared;
                }
            }
        }
        return getPrivateModelsDir();
    }

    private File findModelFile(String fileName) {
        if (hasSharedStorageAccess()) {
            File shared = new File(getSharedModelsDir(), fileName);
            if (shared.isFile() && shared.length() > 10L * 1024L * 1024L) {
                return shared;
            }
        }
        File priv = new File(getPrivateModelsDir(), fileName);
        if (priv.isFile() && priv.length() > 10L * 1024L * 1024L) {
            return priv;
        }
        return null;
    }

    private String sanitizeFileName(String raw) {
        if (raw == null) return "";
        return raw.replaceAll("[^a-zA-Z0-9._-]", "");
    }

    private boolean hasValidGgufHeader(File file) {
        if (file == null || !file.exists() || file.length() < 4L) return false;
        try (FileInputStream fis = new FileInputStream(file)) {
            byte[] h = new byte[4];
            return fis.read(h) == 4
                    && h[0] == 'G' && h[1] == 'G' && h[2] == 'U' && h[3] == 'F';
        } catch (Exception ignored) {
            return false;
        }
    }

    @PluginMethod
    public void requestSharedStoragePermission(PluginCall call) {
        try {
            boolean granted = hasSharedStorageAccess();
            if (granted || Build.VERSION.SDK_INT < Build.VERSION_CODES.R) {
                JSObject ret = new JSObject();
                ret.put("granted", true);
                ret.put("openedSettings", false);
                call.resolve(ret);
                return;
            }
            Intent intent = new Intent(
                    Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION,
                    Uri.parse("package:" + getContext().getPackageName())
            );
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            try {
                getContext().startActivity(intent);
            } catch (Exception fallbackEx) {
                Intent fallback = new Intent(Settings.ACTION_MANAGE_ALL_FILES_ACCESS_PERMISSION);
                fallback.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                getContext().startActivity(fallback);
            }
            JSObject ret = new JSObject();
            ret.put("granted", false);
            ret.put("openedSettings", true);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("打开共享目录权限页面失败：" + e.getMessage(), e);
        }
    }

    @PluginMethod
    public void getStatus(PluginCall call) {
        try {
            boolean sharedGranted = hasSharedStorageAccess();
            File sharedDir = getSharedModelsDir();
            File activeDir = getActiveWriteDir();

            Map<String, JSObject> byName = new LinkedHashMap<>();
            if (sharedGranted && sharedDir.exists()) {
                File[] sFiles = sharedDir.listFiles();
                if (sFiles != null) {
                    for (File f : sFiles) {
                        if (f.isFile() && f.getName().toLowerCase().endsWith(".gguf") && f.length() > 10L * 1024L * 1024L) {
                            JSObject item = new JSObject();
                            item.put("fileName", f.getName());
                            item.put("sizeBytes", f.length());
                            item.put("shared", true);
                            byName.put(f.getName(), item);
                        }
                    }
                }
            }
            File[] pFiles = getPrivateModelsDir().listFiles();
            if (pFiles != null) {
                for (File f : pFiles) {
                    if (f.isFile() && f.getName().toLowerCase().endsWith(".gguf") && f.length() > 10L * 1024L * 1024L) {
                        if (!byName.containsKey(f.getName())) {
                            JSObject item = new JSObject();
                            item.put("fileName", f.getName());
                            item.put("sizeBytes", f.length());
                            item.put("shared", false);
                            byName.put(f.getName(), item);
                        }
                    }
                }
            }

            JSArray filesArr = new JSArray();
            for (JSObject item : byName.values()) {
                filesArr.put(item);
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
            ret.put("sharedStorageGranted", sharedGranted);
            ret.put("sharedDirPath", sharedDir.getAbsolutePath());
            ret.put("systemInfo", sysInfo);
            ret.put("modelsDir", activeDir.getAbsolutePath());
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

        if (primaryUrl == null || primaryUrl.isEmpty() || fileName.isEmpty() || !fileName.toLowerCase().endsWith(".gguf")) {
            call.reject("缺少合法的模型下载地址或文件名");
            return;
        }
        if (!isDownloading.compareAndSet(false, true)) {
            call.reject("已有模型正在下载中，请等待完成或先暂停");
            return;
        }

        cancelDownloadFlag.set(false);

        downloadExecutor.execute(() -> {
            File targetDir = getActiveWriteDir();
            File finalFile = new File(targetDir, fileName);
            File partFile = new File(targetDir, fileName + ".part");
            try {
                File existing = findModelFile(fileName);
                if (existing != null && existing.length() > 50L * 1024L * 1024L) {
                    JSObject ret = new JSObject();
                    ret.put("fileName", fileName);
                    ret.put("sizeBytes", existing.length());
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
                        throw new InterruptedException("用户已暂停下载");
                    }
                    try {
                        streamDownloadWithRedirects(targetUrl, partFile, fileName);
                        success = true;
                        break;
                    } catch (InterruptedException ie) {
                        throw ie;
                    } catch (Exception ex) {
                        lastErr = ex;
                    }
                }

                if (!success) {
                    throw (lastErr != null ? lastErr : new RuntimeException("所有镜像源均下载失败"));
                }

                if (!hasValidGgufHeader(partFile) || partFile.length() < 10L * 1024L * 1024L) {
                    //noinspection ResultOfMethodCallIgnored
                    partFile.delete();
                    throw new RuntimeException("模型文件校验失败，请重试");
                }

                if (finalFile.exists()) {
                    //noinspection ResultOfMethodCallIgnored
                    finalFile.delete();
                }
                if (!partFile.renameTo(finalFile)) {
                    throw new RuntimeException("模型文件写入重命名失败，请检查存储空间");
                }

                JSObject ret = new JSObject();
                ret.put("fileName", fileName);
                ret.put("sizeBytes", finalFile.length());
                ret.put("alreadyExisted", false);
                call.resolve(ret);
            } catch (InterruptedException ie) {
                call.reject("已暂停下载（已保留断点进度，再次点击可续传）");
            } catch (Exception e) {
                call.reject("模型下载失败：" + e.getMessage(), e);
            } finally {
                isDownloading.set(false);
            }
        });
    }

    private void streamDownloadWithRedirects(String initialUrl, File destFile, String fileName) throws Exception {
        long resumeOffset = 0L;
        if (destFile.exists()) {
            if (hasValidGgufHeader(destFile)) {
                resumeOffset = destFile.length();
            } else {
                //noinspection ResultOfMethodCallIgnored
                destFile.delete();
            }
        }

        String currentUrl = initialUrl;
        HttpURLConnection conn = null;
        int redirects = 0;

        try {
            while (redirects < 8) {
                URL u = new URL(currentUrl);
                conn = (HttpURLConnection) u.openConnection();
                conn.setInstanceFollowRedirects(false);
                conn.setConnectTimeout(18000);
                conn.setReadTimeout(60000);
                conn.setRequestProperty("User-Agent", "LifeOS-Android/1.1");
                if (resumeOffset > 0L) {
                    conn.setRequestProperty("Range", "bytes=" + resumeOffset + "-");
                }
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
                if (code == 416 && hasValidGgufHeader(destFile)) {
                    return;
                }
                if (code < 200 || code >= 300) {
                    throw new RuntimeException("HTTP " + code + " 下载被拒绝");
                }
                break;
            }

            if (conn == null) {
                throw new RuntimeException("无法建立下载连接");
            }

            int finalCode = conn.getResponseCode();
            boolean appendMode = (finalCode == 206 && resumeOffset > 0L);
            if (!appendMode) {
                resumeOffset = 0L;
            }

            long contentLen = conn.getContentLengthLong();
            long totalBytes = (appendMode && contentLen > 0L) ? (resumeOffset + contentLen) : contentLen;
            long downloaded = resumeOffset;
            long sessionStartDownloaded = resumeOffset;
            long startMs = System.currentTimeMillis();
            long lastEmitMs = 0L;
            boolean headerChecked = appendMode;

            try (InputStream in = new BufferedInputStream(conn.getInputStream(), 131072);
                 FileOutputStream out = new FileOutputStream(destFile, appendMode)) {
                byte[] buf = new byte[131072];
                int n;
                while ((n = in.read(buf)) != -1) {
                    if (cancelDownloadFlag.get()) {
                        throw new InterruptedException("用户已暂停下载");
                    }
                    if (!headerChecked && n >= 4) {
                        if (buf[0] != 'G' || buf[1] != 'G' || buf[2] != 'U' || buf[3] != 'F') {
                            throw new RuntimeException("远端返回的不是有效 GGUF 模型文件");
                        }
                        headerChecked = true;
                    }
                    out.write(buf, 0, n);
                    downloaded += n;

                    long now = System.currentTimeMillis();
                    if (now - lastEmitMs >= 300 || (totalBytes > 0 && downloaded >= totalBytes)) {
                        lastEmitMs = now;
                        double elapsedSec = Math.max(0.25, (now - startMs) / 1000.0);
                        double speedMbps = ((downloaded - sessionStartDownloaded) / 1024.0 / 1024.0) / elapsedSec;
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
                    loadedFilePath = "";
                }
                boolean deleted = true;
                if (hasSharedStorageAccess()) {
                    File sf = new File(getSharedModelsDir(), fileName);
                    if (sf.exists()) deleted = deleted && sf.delete();
                    File sp = new File(getSharedModelsDir(), fileName + ".part");
                    if (sp.exists()) //noinspection ResultOfMethodCallIgnored
                        sp.delete();
                }
                File pf = new File(getPrivateModelsDir(), fileName);
                if (pf.exists()) deleted = deleted && pf.delete();
                File pp = new File(getPrivateModelsDir(), fileName + ".part");
                if (pp.exists()) //noinspection ResultOfMethodCallIgnored
                    pp.delete();

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
                File modelFile = findModelFile(fileName);
                if (modelFile == null || !modelFile.exists()) {
                    call.reject("模型尚未下载（或未开启共享目录权限）：" + fileName);
                    return;
                }

                if (loadedHandle != 0L && modelFile.getAbsolutePath().equals(loadedFilePath)) {
                    JSObject ret = new JSObject();
                    ret.put("loaded", true);
                    ret.put("fileName", loadedFileName);
                    ret.put("cached", true);
                    call.resolve(ret);
                    return;
                }

                if (loadedHandle != 0L) {
                    LlamaJNI.INSTANCE.nativeReleaseModel(loadedHandle);
                    loadedHandle = 0L;
                    loadedFileName = "";
                    loadedFilePath = "";
                }

                long startMs = System.currentTimeMillis();
                long handle = LlamaJNI.INSTANCE.nativeLoadModel(
                        modelFile.getAbsolutePath(),
                        Math.max(1024, Math.min(4096, contextSize)),
                        threads,
                        0
                );
                if (handle == 0L) {
                    call.reject("模型加载失败（可能内存不足，可先清后台或改用 4B/1.7B 模型）");
                    return;
                }

                loadedHandle = handle;
                loadedFileName = fileName;
                loadedFilePath = modelFile.getAbsolutePath();

                JSObject ret = new JSObject();
                ret.put("loaded", true);
                ret.put("fileName", fileName);
                ret.put("shared", loadedFilePath.startsWith(getSharedModelsDir().getAbsolutePath()));
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
                loadedFilePath = "";
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
        final int maxTokens = call.getInt("maxTokens", 420);
        final float temperature = call.getFloat("temperature", 0.45f);

        if (prompt == null || prompt.trim().isEmpty()) {
            call.reject("提示词不能为空");
            return;
        }

        inferenceExecutor.execute(() -> {
            if (loadedHandle == 0L) {
                call.reject("端侧模型尚未加载，请先在设置页启用内置 AI 模型");
                return;
            }
            try {
                String rawJson = LlamaJNI.INSTANCE.nativeComplete(
                        loadedHandle,
                        prompt,
                        systemPrompt != null ? systemPrompt : "",
                        Math.max(32, Math.min(1024, maxTokens)),
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
            loadedFilePath = "";
        }
        inferenceExecutor.shutdownNow();
        downloadExecutor.shutdownNow();
        super.handleOnDestroy();
    }
}
