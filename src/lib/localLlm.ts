import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core';

export interface DownloadedModelFile {
  fileName: string;
  sizeBytes: number;
}

export interface LocalLlmStatus {
  supported: boolean;
  loaded: boolean;
  loadedFileName: string;
  downloading: boolean;
  systemInfo: string;
  modelsDir: string;
  downloadedFiles: DownloadedModelFile[];
}

export interface LocalDownloadProgress {
  fileName: string;
  downloadedBytes: number;
  totalBytes: number;
  percent: number;
  speedMBps: number;
}

export interface LocalCompleteResult {
  text: string;
  tokensGenerated: number;
  tokensPerSecond: number;
  promptEvalTimeMs: number;
  generateTimeMs: number;
  modelFileName: string;
}

interface LifeOsLocalLlmNativePlugin {
  getStatus(): Promise<LocalLlmStatus>;
  downloadModel(options: {
    url: string;
    fallbackUrl?: string;
    fileName: string;
  }): Promise<{ fileName: string; sizeBytes: number; alreadyExisted: boolean }>;
  cancelDownload(): Promise<{ cancelled: boolean }>;
  deleteModel(options: { fileName: string }): Promise<{ deleted: boolean }>;
  loadModel(options: {
    fileName: string;
    contextSize?: number;
    threads?: number;
  }): Promise<{ loaded: boolean; fileName: string; loadTimeMs?: number; cached?: boolean }>;
  unloadModel(): Promise<{ unloaded: boolean }>;
  complete(options: {
    prompt: string;
    systemPrompt?: string;
    maxTokens?: number;
    temperature?: number;
  }): Promise<LocalCompleteResult>;
  hideLaunchSplash(): Promise<{ hidden: boolean }>;
  addListener(
    eventName: 'downloadProgress',
    listenerFunc: (event: LocalDownloadProgress) => void,
  ): Promise<PluginListenerHandle>;
}

const NativeLocalLlm = registerPlugin<LifeOsLocalLlmNativePlugin>('LifeOsLocalLlm');

/** 首屏绘制完毕后通知 Android 原生主界面平滑淡出启动遮罩，彻底消除闪黑屏 */
export async function hideNativeLaunchSplash(): Promise<void> {
  if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== 'android') return;
  try {
    await NativeLocalLlm.hideLaunchSplash();
  } catch {
    // 忽略旧宿主版本未实现该方法的异常
  }
}

export interface EmbeddedModelSpec {
  id: string;
  name: string;
  badge: string;
  fileName: string;
  sizeLabel: string;
  ramHint: string;
  desc: string;
  /** 魔搭社区国内免梯子高速直链 */
  primaryUrl: string;
  /** HF-Mirror 国内镜像兜底直链 */
  fallbackUrl: string;
}

/**
 * 经过实测验证（返回真 GGUF 魔数头 + 国内免梯子直连）的 3 款手机端侧模型
 * 均配合 LifeOS 本地健身/养生 RAG 知识库运行，零外部服务器、零 API Key
 */
export const EMBEDDED_LOCAL_MODELS: EmbeddedModelSpec[] = [
  {
    id: 'qwen3-0.6b',
    name: 'Qwen3-0.6B（极速轻量版）',
    badge: '378 MB · 秒下秒跑',
    fileName: 'Qwen3-0.6B-Q4_K_M.gguf',
    sizeLabel: '378 MB',
    ramHint: '4GB+ 运存即可流畅运行',
    desc: '体积最小、普通 Wi-Fi 约 15 秒下完，配合内置养生健身知识库离线秒回，适合所有安卓机型。',
    primaryUrl:
      'https://www.modelscope.cn/api/v1/models/unsloth/Qwen3-0.6B-GGUF/repo?Revision=master&FilePath=Qwen3-0.6B-Q4_K_M.gguf',
    fallbackUrl: 'https://hf-mirror.com/unsloth/Qwen3-0.6B-GGUF/resolve/main/Qwen3-0.6B-Q4_K_M.gguf',
  },
  {
    id: 'qwen25-1.5b',
    name: 'Qwen2.5-1.5B-Instruct（均衡推荐）',
    badge: '1.04 GB · 中文最稳',
    fileName: 'qwen2.5-1.5b-instruct-q4_k_m.gguf',
    sizeLabel: '1.04 GB',
    ramHint: '建议 8GB+ 运存手机',
    desc: '中文理解与健身营养建议质量显著更强，指令遵循稳健，是手机自带离线 AI 的主力首选。',
    primaryUrl:
      'https://www.modelscope.cn/api/v1/models/Qwen/Qwen2.5-1.5B-Instruct-GGUF/repo?Revision=master&FilePath=qwen2.5-1.5b-instruct-q4_k_m.gguf',
    fallbackUrl:
      'https://hf-mirror.com/Qwen/Qwen2.5-1.5B-Instruct-GGUF/resolve/main/qwen2.5-1.5b-instruct-q4_k_m.gguf',
  },
  {
    id: 'qwen3-1.7b',
    name: 'Qwen3-1.7B（高阶推理版）',
    badge: '1.03 GB · 新一代架构',
    fileName: 'Qwen3-1.7B-Q4_K_M.gguf',
    sizeLabel: '1.03 GB',
    ramHint: '建议 8GB+ 运存手机',
    desc: '最新 Qwen3 架构 1.7B 量化版，综合推理与食疗/训练规划更细腻。',
    primaryUrl:
      'https://www.modelscope.cn/api/v1/models/unsloth/Qwen3-1.7B-GGUF/repo?Revision=master&FilePath=Qwen3-1.7B-Q4_K_M.gguf',
    fallbackUrl: 'https://hf-mirror.com/unsloth/Qwen3-1.7B-GGUF/resolve/main/Qwen3-1.7B-Q4_K_M.gguf',
  },
];

export function isEmbeddedLocalLlmSupported(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';
}

export function findEmbeddedModelSpec(fileNameOrId: string): EmbeddedModelSpec {
  return (
    EMBEDDED_LOCAL_MODELS.find(
      (m) => m.fileName === fileNameOrId || m.id === fileNameOrId || m.name === fileNameOrId,
    ) ?? EMBEDDED_LOCAL_MODELS[0]
  );
}

export async function getLocalLlmStatus(): Promise<LocalLlmStatus> {
  if (!isEmbeddedLocalLlmSupported()) {
    return {
      supported: false,
      loaded: false,
      loadedFileName: '',
      downloading: false,
      systemInfo: '当前为网页预览模式；安装 Android APK 后将自动启用手机内置原生 ARM64 llama.cpp 引擎',
      modelsDir: '',
      downloadedFiles: [],
    };
  }
  return NativeLocalLlm.getStatus();
}

export async function downloadEmbeddedModel(
  spec: EmbeddedModelSpec,
  onProgress?: (p: LocalDownloadProgress) => void,
): Promise<{ fileName: string; sizeBytes: number; alreadyExisted: boolean }> {
  if (!isEmbeddedLocalLlmSupported()) {
    throw new Error('端侧模型下载需在 Android App 内执行（网页预览请使用智谱免费联网 AI）');
  }
  let handle: PluginListenerHandle | null = null;
  if (onProgress) {
    handle = await NativeLocalLlm.addListener('downloadProgress', (ev) => {
      if (ev.fileName === spec.fileName) {
        onProgress(ev);
      }
    });
  }
  try {
    return await NativeLocalLlm.downloadModel({
      url: spec.primaryUrl,
      fallbackUrl: spec.fallbackUrl,
      fileName: spec.fileName,
    });
  } finally {
    if (handle) {
      await handle.remove();
    }
  }
}

export async function cancelEmbeddedModelDownload(): Promise<void> {
  if (!isEmbeddedLocalLlmSupported()) return;
  await NativeLocalLlm.cancelDownload();
}

export async function deleteEmbeddedModel(fileName: string): Promise<void> {
  if (!isEmbeddedLocalLlmSupported()) return;
  await NativeLocalLlm.deleteModel({ fileName });
}

export async function loadEmbeddedModel(fileName: string): Promise<void> {
  if (!isEmbeddedLocalLlmSupported()) {
    throw new Error('内置 llama.cpp 仅在 Android 手机 App 中运行');
  }
  await NativeLocalLlm.loadModel({ fileName, contextSize: 2048 });
}

export async function unloadEmbeddedModel(): Promise<void> {
  if (!isEmbeddedLocalLlmSupported()) return;
  await NativeLocalLlm.unloadModel();
}

/**
 * 调用手机内置 ARM64 llama.cpp 引擎执行离线推理（若尚未载入内存会自动加载已下载的 GGUF）
 */
export async function runEmbeddedLocalCompletion(params: {
  modelFileName: string;
  systemPrompt?: string;
  userPrompt: string;
  maxTokens?: number;
  temperature?: number;
}): Promise<{ text: string; latencyMs: number; usedModel: string }> {
  if (!isEmbeddedLocalLlmSupported()) {
    throw new Error('App 内置离线 AI 需在 Android 手机 APK 中运行；电脑浏览器预览请先在设置页选用「智谱 GLM-4-Flash」');
  }

  const spec = findEmbeddedModelSpec(params.modelFileName);
  const status = await NativeLocalLlm.getStatus();
  const hasFile = status.downloadedFiles.some((f) => f.fileName === spec.fileName);
  if (!hasFile) {
    throw new Error(`尚未下载端侧模型「${spec.name}」：请打开右上角「设置」→「App 自带端侧 AI」点一下免费下载（国内魔搭直连 ${spec.sizeLabel}）`);
  }

  const start = performance.now();
  if (!status.loaded || status.loadedFileName !== spec.fileName) {
    await NativeLocalLlm.loadModel({ fileName: spec.fileName, contextSize: 2048 });
  }

  // Qwen3 关闭冗长思考标签，确保端侧生成干脆迅速
  const finalPrompt = spec.id.startsWith('qwen3')
    ? `${params.userPrompt}\n/no_think`
    : params.userPrompt;

  const res = await NativeLocalLlm.complete({
    prompt: finalPrompt,
    systemPrompt: params.systemPrompt || '',
    maxTokens: Math.min(420, params.maxTokens ?? 360),
    temperature: params.temperature ?? 0.45,
  });

  const cleanText = res.text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  const speedTag = res.tokensPerSecond > 0 ? ` · ${res.tokensPerSecond.toFixed(1)}t/s` : '';
  return {
    text: cleanText || res.text,
    latencyMs: Math.round(performance.now() - start),
    usedModel: `本机端侧 ${spec.id}${speedTag}`,
  };
}
