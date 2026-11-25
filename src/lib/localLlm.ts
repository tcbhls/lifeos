import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core';

export interface DownloadedModelFile {
  fileName: string;
  sizeBytes: number;
  shared?: boolean;
}

export interface LocalLlmStatus {
  supported: boolean;
  loaded: boolean;
  loadedFileName: string;
  downloading: boolean;
  sharedStorageGranted?: boolean;
  sharedDirPath?: string;
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
  requestSharedStoragePermission(): Promise<{ granted: boolean; openedSettings: boolean }>;
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
  }): Promise<{ loaded: boolean; fileName: string; loadTimeMs?: number; cached?: boolean; shared?: boolean }>;
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
  /** 备用高速直链 */
  fallbackUrl: string;
}

/**
 * 三端生态统一端侧离线模型清单（与音枢 AI 音乐、EchoDeck 共用手机 Download/LocalAI 零拷贝目录）
 * 均经实测返回标准 GGUF 魔数头，支持 5GB 级断点续传
 */
export const EMBEDDED_LOCAL_MODELS: EmbeddedModelSpec[] = [
  {
    id: 'qwen3-8b',
    name: 'Qwen3-8B（Q4_K_M · 旗舰满血）',
    badge: '4.80 GB · 三端共享首选',
    fileName: 'Qwen3-8B-Q4_K_M.gguf',
    sizeLabel: '4.80 GB',
    ramHint: '推荐 12GB / 16GB 旗舰机',
    desc: '端侧智商天花板，复杂健身周期编排、营养配比与食疗养生推理最细腻；与音枢、EchoDeck 零拷贝共享同一份文件。',
    primaryUrl:
      'https://www.modelscope.cn/api/v1/models/Qwen/Qwen3-8B-GGUF/repo?Revision=master&FilePath=Qwen3-8B-Q4_K_M.gguf',
    fallbackUrl:
      'https://www.modelscope.cn/api/v1/models/unsloth/Qwen3-8B-GGUF/repo?Revision=master&FilePath=Qwen3-8B-Q4_K_M.gguf',
  },
  {
    id: 'qwen3-4b',
    name: 'Qwen3-4B（Q4_K_M · 全能甜点）',
    badge: '2.38 GB · 速度智商双优',
    fileName: 'Qwen3-4B-Q4_K_M.gguf',
    sizeLabel: '2.38 GB',
    ramHint: '建议 8GB+ 运存手机',
    desc: '体积减半、响应极快发热低，中文饮食点评与动作纠错兼顾高智商与丝滑流畅。',
    primaryUrl:
      'https://www.modelscope.cn/api/v1/models/Qwen/Qwen3-4B-GGUF/repo?Revision=master&FilePath=Qwen3-4B-Q4_K_M.gguf',
    fallbackUrl:
      'https://www.modelscope.cn/api/v1/models/unsloth/Qwen3-4B-GGUF/repo?Revision=master&FilePath=Qwen3-4B-Q4_K_M.gguf',
  },
  {
    id: 'qwen3-1.7b',
    name: 'Qwen3-1.7B（轻快省电版）',
    badge: '1.06 GB · 均衡流畅',
    fileName: 'Qwen3-1.7B-Q4_K_M.gguf',
    sizeLabel: '1.06 GB',
    ramHint: '6GB+ 运存流畅运行',
    desc: '仅 1GB 出头、低功耗秒级响应，配合内置健身养生知识库日常离线使用极稳。',
    primaryUrl:
      'https://www.modelscope.cn/api/v1/models/unsloth/Qwen3-1.7B-GGUF/repo?Revision=master&FilePath=Qwen3-1.7B-Q4_K_M.gguf',
    fallbackUrl: 'https://hf-mirror.com/unsloth/Qwen3-1.7B-GGUF/resolve/main/Qwen3-1.7B-Q4_K_M.gguf',
  },
  {
    id: 'qwen3-0.6b',
    name: 'Qwen3-0.6B（极速轻量版）',
    badge: '378 MB · 秒下秒跑',
    fileName: 'Qwen3-0.6B-Q4_K_M.gguf',
    sizeLabel: '378 MB',
    ramHint: '4GB+ 运存即可流畅运行',
    desc: '体积最小、普通 Wi-Fi 十余秒下完，适合存储空间紧张时离线兜底。',
    primaryUrl:
      'https://www.modelscope.cn/api/v1/models/unsloth/Qwen3-0.6B-GGUF/repo?Revision=master&FilePath=Qwen3-0.6B-Q4_K_M.gguf',
    fallbackUrl: 'https://hf-mirror.com/unsloth/Qwen3-0.6B-GGUF/resolve/main/Qwen3-0.6B-Q4_K_M.gguf',
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
      sharedStorageGranted: false,
      sharedDirPath: '/storage/emulated/0/Download/LocalAI',
      systemInfo: '当前为网页预览模式；安装 Android APK 后将自动启用原生 ARM64 llama.cpp 与三端共享模型库',
      modelsDir: '',
      downloadedFiles: [],
    };
  }
  return NativeLocalLlm.getStatus();
}

export async function requestSharedStoragePermission(): Promise<{ granted: boolean; openedSettings: boolean }> {
  if (!isEmbeddedLocalLlmSupported()) {
    return { granted: false, openedSettings: false };
  }
  return NativeLocalLlm.requestSharedStoragePermission();
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
 * 调用手机内置 ARM64 llama.cpp 引擎执行离线推理（支持自动识别 Download/LocalAI 三端共享模型）
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

  const status = await NativeLocalLlm.getStatus();
  const matchedSpec = EMBEDDED_LOCAL_MODELS.find(
    (m) => m.fileName === params.modelFileName || m.id === params.modelFileName,
  );
  let targetFile = matchedSpec ? matchedSpec.fileName : params.modelFileName;

  if (!status.downloadedFiles.some((f) => f.fileName === targetFile)) {
    if (status.downloadedFiles.length > 0) {
      // 自动优先命中三端共享目录里体积最大（能力最强）的模型（如 Qwen3-8B）
      const sorted = [...status.downloadedFiles].sort((a, b) => b.sizeBytes - a.sizeBytes);
      targetFile = sorted[0].fileName;
    } else {
      const spec = matchedSpec ?? EMBEDDED_LOCAL_MODELS[0];
      throw new Error(
        `尚未下载端侧模型「${spec.name}」：请打开右上角「设置」→「App 自带端侧 AI」开启共享目录权限或免费下载（${spec.sizeLabel}）`,
      );
    }
  }

  const start = performance.now();
  if (!status.loaded || status.loadedFileName !== targetFile) {
    await NativeLocalLlm.loadModel({ fileName: targetFile, contextSize: 2048 });
  }

  // Qwen3 关闭冗长思考标签，确保端侧生成干脆迅速
  const isQwen3 = targetFile.toLowerCase().includes('qwen3');
  const finalPrompt =
    isQwen3 && !params.userPrompt.includes('/no_think')
      ? `${params.userPrompt}\n/no_think`
      : params.userPrompt;

  const res = await NativeLocalLlm.complete({
    prompt: finalPrompt,
    systemPrompt: params.systemPrompt || '',
    maxTokens: Math.min(520, params.maxTokens ?? 400),
    temperature: params.temperature ?? 0.45,
  });

  const cleanText = res.text
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/^<think>[\s\S]*/i, '')
    .trim();
  const speedTag = res.tokensPerSecond > 0 ? ` · ${res.tokensPerSecond.toFixed(1)}t/s` : '';
  const displayName = matchedSpec ? matchedSpec.id : targetFile.replace(/\.gguf$/i, '');
  return {
    text: cleanText || res.text,
    latencyMs: Math.round(performance.now() - start),
    usedModel: `本机端侧 ${displayName}${speedTag}`,
  };
}
