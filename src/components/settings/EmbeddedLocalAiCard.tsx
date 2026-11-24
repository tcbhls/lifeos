import { useCallback, useEffect, useState } from 'react';
import {
  Check,
  Cpu,
  Download,
  HardDrive,
  Loader2,
  Play,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import {
  cancelEmbeddedModelDownload,
  deleteEmbeddedModel,
  downloadEmbeddedModel,
  EMBEDDED_LOCAL_MODELS,
  getLocalLlmStatus,
  isEmbeddedLocalLlmSupported,
  loadEmbeddedModel,
  runEmbeddedLocalCompletion,
  unloadEmbeddedModel,
  type EmbeddedModelSpec,
  type LocalDownloadProgress,
  type LocalLlmStatus,
} from '../../lib/localLlm';
import { hapticLight, hapticSuccess } from '../../lib/native';
import type { Settings } from '../../types/models';

interface EmbeddedLocalAiCardProps {
  settings: Settings;
  onActivateEmbeddedModel: (spec: EmbeddedModelSpec) => Promise<void>;
  onSwitchBackCloud: () => Promise<void>;
  onNotify: (text: string) => void;
}

/**
 * LifeOS 内置端侧 AI 模型管理卡（基于 Android 原生预编译 llama.cpp JNI）：
 * 无需外部电脑、无需 Termux、无需 API Key，从国内魔搭社区一键下载量化 GGUF 到手机本地即开即用
 */
export function EmbeddedLocalAiCard({
  settings,
  onActivateEmbeddedModel,
  onSwitchBackCloud,
  onNotify,
}: EmbeddedLocalAiCardProps) {
  const nativeAndroid = isEmbeddedLocalLlmSupported();
  const isEmbeddedActive = settings.aiProvider === 'local_embedded';

  const [status, setStatus] = useState<LocalLlmStatus | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [progress, setProgress] = useState<LocalDownloadProgress | null>(null);
  const [loadingModelId, setLoadingModelId] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [testOutput, setTestOutput] = useState<{ ok: boolean; text: string } | null>(null);

  const refreshStatus = useCallback(async () => {
    try {
      const s = await getLocalLlmStatus();
      setStatus(s);
    } catch {
      // 忽略首次读取异常
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    getLocalLlmStatus()
      .then((s) => {
        if (!cancelled) setStatus(s);
      })
      .catch(() => {
        // 忽略首次读取异常
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const isDownloaded = (fileName: string) =>
    Boolean(status?.downloadedFiles.some((f) => f.fileName === fileName));

  const formatBytesMB = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(0)} MB`;

  const handleDownload = async (spec: EmbeddedModelSpec) => {
    if (downloadingId) return;
    setDownloadingId(spec.id);
    setProgress({
      fileName: spec.fileName,
      downloadedBytes: 0,
      totalBytes: 0,
      percent: 0,
      speedMBps: 0,
    });
    setTestOutput(null);
    void hapticLight();

    try {
      await downloadEmbeddedModel(spec, (ev) => {
        setProgress(ev);
      });
      await refreshStatus();
      await onActivateEmbeddedModel(spec);
      void hapticSuccess();
      onNotify(`端侧模型「${spec.name}」已下载并启用`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      onNotify(msg);
      setTestOutput({ ok: false, text: msg });
    } finally {
      setDownloadingId(null);
      setProgress(null);
    }
  };

  const handleCancel = async () => {
    await cancelEmbeddedModelDownload();
    setDownloadingId(null);
    setProgress(null);
    onNotify('已取消模型下载');
  };

  const handleActivate = async (spec: EmbeddedModelSpec) => {
    setLoadingModelId(spec.id);
    setTestOutput(null);
    try {
      await loadEmbeddedModel(spec.fileName);
      await onActivateEmbeddedModel(spec);
      await refreshStatus();
      void hapticSuccess();
      onNotify(`已切换至 App 内置 AI：${spec.name}`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setTestOutput({ ok: false, text: msg });
      onNotify(msg);
    } finally {
      setLoadingModelId(null);
    }
  };

  const handleDelete = async (spec: EmbeddedModelSpec) => {
    await deleteEmbeddedModel(spec.fileName);
    await refreshStatus();
    if (isEmbeddedActive && settings.aiModel === spec.fileName) {
      await onSwitchBackCloud();
    }
    onNotify(`已删除本地权重并释放空间：${spec.sizeLabel}`);
  };

  const handleQuickSelfTest = async () => {
    setTesting(true);
    setTestOutput(null);
    try {
      const activeFile =
        status?.loadedFileName ||
        status?.downloadedFiles[0]?.fileName ||
        EMBEDDED_LOCAL_MODELS[0].fileName;
      const res = await runEmbeddedLocalCompletion({
        modelFileName: activeFile,
        systemPrompt: '你是 LifeOS 手机内置健身与养生管家，回答简短实用。',
        userPrompt: '用一句话告诉我减脂期每天蛋白质怎么吃。',
        maxTokens: 120,
        temperature: 0.3,
      });
      setTestOutput({
        ok: true,
        text: `推理成功 (${res.usedModel} · ${res.latencyMs}ms)：${res.text}`,
      });
    } catch (err: unknown) {
      setTestOutput({
        ok: false,
        text: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setTesting(false);
      void refreshStatus();
    }
  };

  const hasAnyDownloaded = (status?.downloadedFiles.length ?? 0) > 0;

  return (
    <section className="rounded-2xl bg-white dark:bg-zinc-900/95 border border-emerald-500/35 p-4 space-y-3.5">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-9 h-9 rounded-xl bg-[#1a6e5e]/12 text-[#166556] dark:text-emerald-400 flex items-center justify-center shrink-0">
            <Cpu className="w-4.5 h-4.5" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap">
              <h2 className="text-sm font-bold text-zinc-900 dark:text-zinc-100">
                App 自带内置 AI（端侧离线引擎）
              </h2>
              <span
                className={`text-[10px] px-1.5 py-0.5 rounded font-semibold ${
                  isEmbeddedActive
                    ? 'bg-[#1a6e5e] text-white'
                    : 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-400'
                }`}
              >
                {isEmbeddedActive ? '当前使用中' : 'llama.cpp 原生'}
              </span>
            </div>
            <p className="text-[11px] text-zinc-500 dark:text-zinc-400 mt-0.5">
              直接装进手机本机运行 + 养生/健身知识库增强 · 不连电脑、不需 API Key
            </p>
          </div>
        </div>

        {isEmbeddedActive && (
          <button
            type="button"
            onClick={async () => {
              await unloadEmbeddedModel();
              await onSwitchBackCloud();
              await refreshStatus();
            }}
            className="shrink-0 text-[11px] font-semibold px-2.5 py-1 rounded-lg bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300"
          >
            切回云端联网
          </button>
        )}
      </div>

      {/* 环境状态条 */}
      <div className="flex items-start justify-between gap-2 px-3 py-2 rounded-xl bg-zinc-50 dark:bg-zinc-800/60 text-[11px]">
        <div className="flex items-start gap-1.5 text-zinc-600 dark:text-zinc-300 min-w-0">
          <HardDrive className="w-3.5 h-3.5 text-emerald-500 shrink-0 mt-0.5" />
          <span className="leading-snug">
            {nativeAndroid
              ? status?.loaded
                ? `已载入内存：${status.loadedFileName}`
                : hasAnyDownloaded
                  ? `本机已下载 ${status?.downloadedFiles.length} 个模型（待载入）`
                  : '原生 ARM64 引擎已就绪 · 点下方免费下载模型即可离线用'
              : 'Android 原生引擎已打包进 APK（网页预览不支持，装到手机即可一键下载运行）'}
          </span>
        </div>
        {nativeAndroid && hasAnyDownloaded && (
          <button
            type="button"
            disabled={testing}
            onClick={handleQuickSelfTest}
            className="shrink-0 inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-semibold bg-emerald-500/12 text-emerald-700 dark:text-emerald-400 disabled:opacity-60"
          >
            {testing ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
            {testing ? '推理中' : '测速'}
          </button>
        )}
      </div>

      {/* 3 款精选国内魔搭直连 GGUF 模型 */}
      <div className="space-y-2">
        {EMBEDDED_LOCAL_MODELS.map((spec) => {
          const downloaded = isDownloaded(spec.fileName);
          const isThisDownloading = downloadingId === spec.id;
          const isThisLoading = loadingModelId === spec.id;
          const isCurrentActive = isEmbeddedActive && settings.aiModel === spec.fileName;

          return (
            <div
              key={spec.id}
              className={`p-3 rounded-xl border space-y-2 transition-colors ${
                isCurrentActive
                  ? 'bg-emerald-500/8 border-emerald-500/40'
                  : 'bg-zinc-50/80 dark:bg-zinc-800/45 border-zinc-200/70 dark:border-zinc-800'
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-xs font-bold text-zinc-900 dark:text-zinc-100">
                      {spec.name}
                    </span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-200/80 dark:bg-zinc-700 text-zinc-600 dark:text-zinc-300 num-tabular">
                      {spec.badge}
                    </span>
                  </div>
                  <p className="text-[11px] text-zinc-500 dark:text-zinc-400 mt-0.5 leading-relaxed">
                    {spec.desc}
                  </p>
                </div>
              </div>

              {/* 实时下载进度条 */}
              {isThisDownloading && progress && (
                <div className="space-y-1">
                  <div className="flex items-center justify-between text-[11px] text-emerald-600 dark:text-emerald-400 num-tabular">
                    <span>
                      魔搭国内源下载中... {progress.percent}%
                      {progress.totalBytes > 0
                        ? ` (${formatBytesMB(progress.downloadedBytes)} / ${formatBytesMB(progress.totalBytes)})`
                        : ''}
                    </span>
                    <span>{progress.speedMBps > 0 ? `${progress.speedMBps} MB/s` : ''}</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-zinc-200 dark:bg-zinc-700 overflow-hidden">
                    <div
                      className="h-full bg-[#1a6e5e] transition-all duration-200"
                      style={{ width: `${Math.max(3, progress.percent)}%` }}
                    />
                  </div>
                </div>
              )}

              <div className="flex items-center justify-between gap-2 pt-0.5">
                <span className="text-[10px] text-zinc-400">{spec.ramHint}</span>

                <div className="flex items-center gap-1.5 shrink-0">
                  {isThisDownloading ? (
                    <button
                      type="button"
                      onClick={handleCancel}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-rose-500/12 text-rose-600 dark:text-rose-400"
                    >
                      <X className="w-3.5 h-3.5" />
                      取消
                    </button>
                  ) : downloaded ? (
                    <>
                      <button
                        type="button"
                        onClick={() => handleDelete(spec)}
                        title="删除释放空间"
                        className="p-1.5 rounded-lg text-zinc-400 hover:text-rose-500"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        disabled={isThisLoading}
                        onClick={() => handleActivate(spec)}
                        className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-xl text-xs font-semibold transition-all ${
                          isCurrentActive
                            ? 'bg-[#1a6e5e] text-white'
                            : 'bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900'
                        }`}
                      >
                        {isThisLoading ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : isCurrentActive ? (
                          <Check className="w-3.5 h-3.5" />
                        ) : (
                          <Sparkles className="w-3.5 h-3.5" />
                        )}
                        {isThisLoading ? '加载中' : isCurrentActive ? '使用中' : '启用此 AI'}
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      disabled={Boolean(downloadingId) || !nativeAndroid}
                      onClick={() => handleDownload(spec)}
                      className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl text-xs font-semibold bg-[#1a6e5e] hover:bg-[#155a4d] text-white disabled:opacity-45"
                    >
                      <Download className="w-3.5 h-3.5" />
                      {nativeAndroid ? `免费下载 (${spec.sizeLabel})` : '需在手机 APK 下载'}
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {testOutput && (
        <div
          className={`p-3 rounded-xl text-xs leading-relaxed border ${
            testOutput.ok
              ? 'bg-emerald-500/10 border-emerald-500/25 text-emerald-800 dark:text-emerald-300'
              : 'bg-rose-500/10 border-rose-500/25 text-rose-700 dark:text-rose-300'
          }`}
        >
          {testOutput.text}
        </div>
      )}
    </section>
  );
}
