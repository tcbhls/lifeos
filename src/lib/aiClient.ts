import type { AiProvider, Settings } from '../types/models';
import { runEmbeddedLocalCompletion } from './localLlm';

export interface WebSearchSource {
  title: string;
  link: string;
}

export interface AiPreset {
  id: string;
  name: string;
  badge: string;
  isFree: boolean;
  provider: AiProvider;
  baseUrl: string;
  defaultModel: string;
  visionModel?: string;
  keyUrl: string;
  hint: string;
}

/**
 * 内置 AI 服务商预设：优先「智谱免费稳态引擎（原生联网）」与「本机离线 GGUF 模型」
 * 未来切换付费模型时，直接在设置页修改即可
 */
export const AI_PROVIDER_PRESETS: AiPreset[] = [
  {
    id: 'zhipu_free',
    name: '智谱 GLM-4-Flash (云端免费 + 实时联网)',
    badge: '国内直连 · 联网 + 识图',
    isFree: true,
    provider: 'openai_compatible',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    defaultModel: 'glm-4-flash-250414',
    visionModel: 'glm-4v-flash',
    keyUrl: 'https://open.bigmodel.cn/usercenter/proj-mgmt/apikeys',
    hint: '国内网络免代理直连！适合需要实时查天气/新闻/看外卖截图时使用，可与上方「App 自带端侧 AI」随时切换',
  },
  {
    id: 'gemini_free',
    name: 'Google Gemini 2.5 Flash',
    badge: 'Google 联网 + 最强免费识图',
    isFree: true,
    provider: 'gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    defaultModel: 'gemini-2.5-flash',
    visionModel: 'gemini-2.5-flash',
    keyUrl: 'https://aistudio.google.com/apikey',
    hint: '支持原生 Google Search 实时联网与超强多模态识图（需代理）',
  },
  {
    id: 'siliconflow_free',
    name: '硅基流动免费开源池 (Qwen)',
    badge: '国内直连 · 免费开源',
    isFree: true,
    provider: 'openai_compatible',
    baseUrl: 'https://api.siliconflow.cn/v1',
    defaultModel: 'Qwen/Qwen2.5-7B-Instruct',
    visionModel: 'Qwen/Qwen2.5-VL-72B-Instruct',
    keyUrl: 'https://cloud.siliconflow.cn/account/ak',
    hint: '国内直连，云端免费运行开源 Qwen2.5-7B，免占手机存储与内存',
  },
  {
    id: 'deepseek_paid',
    name: 'DeepSeek (按量付费)',
    badge: '极高性价比进阶',
    isFree: false,
    provider: 'openai_compatible',
    baseUrl: 'https://api.deepseek.com/v1',
    defaultModel: 'deepseek-chat',
    keyUrl: 'https://platform.deepseek.com/api_keys',
    hint: '后续升级付费模型时的优质选择',
  },
  {
    id: 'openai_paid',
    name: 'OpenAI 官方 / 中转站',
    badge: '自定义进阶',
    isFree: false,
    provider: 'openai_compatible',
    baseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o-mini',
    visionModel: 'gpt-4o-mini',
    keyUrl: 'https://platform.openai.com/api-keys',
    hint: '标准 OpenAI 协议，也兼容任意 OneAPI / OpenRouter 中转站',
  },
];

/** 判断是否命中本机离线推理端点（无需 API Key） */
export function isLocalLlmEndpoint(baseUrl: string): boolean {
  const lower = baseUrl.toLowerCase();
  return (
    lower.includes('127.0.0.1') ||
    lower.includes('localhost:') ||
    lower.includes('10.0.2.2') ||
    /^https?:\/\/192\.168\./.test(lower)
  );
}

/** 判断是否命中智谱官方免费端点 */
export function isZhipuEndpoint(baseUrl: string): boolean {
  const lower = baseUrl.toLowerCase();
  return lower.includes('open.bigmodel.cn') || lower.includes('/proxy/zhipu');
}

/**
 * 构建免费模型自动回退链：
 * 实测智谱最新 glm-4.7-flash / glm-4.6v-flash 在高峰时段易报 429(1305) 访问量过大，
 * 通过自动回退链确保零感知切到稳定的 glm-4-flash-250414 / glm-4-flash / glm-4v-flash
 */
function buildFallbackModels(primaryModel: string, baseUrl: string, mode: 'text' | 'vision'): string[] {
  const clean = primaryModel.trim();
  if (!isZhipuEndpoint(baseUrl)) {
    return [clean];
  }
  const pool =
    mode === 'vision'
      ? [clean, 'glm-4v-flash', 'glm-4.6v-flash']
      : [clean, 'glm-4-flash-250414', 'glm-4-flash', 'glm-4.7-flash'];
  return Array.from(new Set(pool.filter(Boolean)));
}

/** 推算当前配置对应的多模态识图模型名 */
export function resolveVisionModel(
  config: Pick<Settings, 'aiProvider' | 'aiBaseUrl' | 'aiModel'>,
): string {
  if (isZhipuEndpoint(config.aiBaseUrl)) {
    return 'glm-4v-flash';
  }
  if (config.aiProvider === 'gemini') {
    return config.aiModel.trim() || 'gemini-2.5-flash';
  }
  if (config.aiBaseUrl.includes('siliconflow.cn')) {
    return 'Qwen/Qwen2.5-VL-72B-Instruct';
  }
  return config.aiModel.trim() || 'gpt-4o-mini';
}

/**
 * 解析实际请求 URL：本地 Vite 开发环境自动走代理规避 CORS，
 * 打包进 Capacitor Android 后直连原始官方域名
 */
export function resolveFetchBaseUrl(rawBaseUrl: string): string {
  const cleaned = rawBaseUrl.trim().replace(/\/+$/, '');
  const isLocalViteDev =
    typeof window !== 'undefined' &&
    import.meta.env.DEV &&
    (window.location.hostname === 'localhost' ||
      window.location.hostname === '127.0.0.1' ||
      window.location.port === '5173');

  if (isLocalViteDev) {
    if (cleaned.startsWith('https://open.bigmodel.cn')) {
      return cleaned.replace('https://open.bigmodel.cn', '/proxy/zhipu');
    }
    if (cleaned.startsWith('https://api.siliconflow.cn')) {
      return cleaned.replace('https://api.siliconflow.cn', '/proxy/siliconflow');
    }
  }
  return cleaned;
}

/** 清洗大模型可能包裹的 Markdown 代码块与思考标签，稳定提取 JSON */
export function extractCleanJsonBlock(rawText: string, expected: 'object' | 'array'): string {
  const stripped = rawText
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/```(?:json)?\s*/gi, '')
    .replace(/```/g, '')
    .trim();

  const pattern = expected === 'array' ? /\[[\s\S]*\]/ : /\{[\s\S]*\}/;
  const match = stripped.match(pattern);
  if (!match) {
    throw new Error('AI 未返回有效 JSON 结构，请重试一次');
  }
  return match[0];
}

function isRetryableRateLimit(status: number, errText: string): boolean {
  return status === 429 || status === 503 || /1305|1302|访问量过大|并发|rate.?limit/i.test(errText);
}

/**
 * 统一文本对话调用入口（支持智谱原生 web_search / Gemini Google Search 联网 + 429 自动降级 + 本机离线模型免 Key）
 */
export async function callAiTextCompletion(
  config: Pick<Settings, 'aiProvider' | 'aiBaseUrl' | 'aiApiKey' | 'aiModel'>,
  params: {
    systemPrompt?: string;
    userPrompt: string;
    temperature?: number;
    maxTokens?: number;
    jsonMode?: boolean;
    enableWebSearch?: boolean;
    timeoutMs?: number;
  },
): Promise<{ text: string; latencyMs: number; usedModel: string; webSources?: WebSearchSource[] }> {
  // 手机 App 自带原生 llama.cpp 端侧推理（零外部服务器、零 API Key）
  if (config.aiProvider === 'local_embedded') {
    const res = await runEmbeddedLocalCompletion({
      modelFileName: config.aiModel,
      systemPrompt: params.systemPrompt,
      userPrompt: params.userPrompt,
      maxTokens: params.maxTokens,
      temperature: params.temperature,
    });
    return { ...res, webSources: [] };
  }

  const apiKey = config.aiApiKey.trim();
  const baseUrl = resolveFetchBaseUrl(config.aiBaseUrl);
  const primaryModel = config.aiModel.trim();
  const localMode = isLocalLlmEndpoint(config.aiBaseUrl);

  if (!apiKey && !localMode) {
    throw new Error('请先填写免费 API Key（或切到本机离线模型预设）');
  }
  if (!baseUrl || !primaryModel) {
    throw new Error('请补全接口 Base URL 与模型名称');
  }

  const candidates = buildFallbackModels(primaryModel, config.aiBaseUrl, 'text');
  let lastError: Error | null = null;

  for (const model of candidates) {
    const start = performance.now();
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), params.timeoutMs ?? 25000);

    try {
      if (config.aiProvider === 'gemini') {
        const endpoint = `${baseUrl}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
        const fullPrompt = params.systemPrompt
          ? `${params.systemPrompt}\n\n${params.userPrompt}`
          : params.userPrompt;

        const geminiBody: Record<string, unknown> = {
          contents: [{ parts: [{ text: fullPrompt }] }],
          generationConfig: {
            temperature: params.temperature ?? 0.4,
            maxOutputTokens: params.maxTokens ?? 1200,
            ...(params.jsonMode ? { responseMimeType: 'application/json' } : {}),
          },
        };
        if (params.enableWebSearch && !params.jsonMode) {
          geminiBody.tools = [{ google_search: {} }];
        }

        const res = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: controller.signal,
          body: JSON.stringify(geminiBody),
        });

        const latencyMs = Math.round(performance.now() - start);
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          const errMsg = data?.error?.message || `HTTP ${res.status} ${res.statusText}`;
          throw new Error(`Gemini 接口拒绝：${errMsg}`);
        }

        const text: string = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
        const chunks: Array<{ web?: { title?: string; uri?: string } }> =
          data?.candidates?.[0]?.groundingMetadata?.groundingChunks ?? [];
        const webSources: WebSearchSource[] = chunks
          .map((c) => ({ title: c.web?.title || '', link: c.web?.uri || '' }))
          .filter((s) => Boolean(s.title && s.link))
          .slice(0, 5);
        return { text, latencyMs, usedModel: model, webSources };
      } else {
        const endpoint = baseUrl.endsWith('/chat/completions')
          ? baseUrl
          : `${baseUrl}/chat/completions`;

        const messages: Array<{ role: 'system' | 'user'; content: string }> = [];
        if (params.systemPrompt) {
          messages.push({ role: 'system', content: params.systemPrompt });
        }
        messages.push({ role: 'user', content: params.userPrompt });

        const payload: Record<string, unknown> = {
          model,
          messages,
          temperature: params.temperature ?? 0.4,
          max_tokens: params.maxTokens ?? 1200,
        };
        if (model.includes('4.7') || model.includes('4.5')) {
          payload.thinking = { type: 'disabled' };
        }
        // 开启智谱免费原生联网搜索（仅在非强制 JSON 输出模式下启用）
        if (params.enableWebSearch && !params.jsonMode && isZhipuEndpoint(config.aiBaseUrl)) {
          payload.tools = [
            {
              type: 'web_search',
              web_search: {
                enable: true,
                search_result: true,
              },
            },
          ];
        }

        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (apiKey) {
          headers.Authorization = `Bearer ${apiKey}`;
        }

        const res = await fetch(endpoint, {
          method: 'POST',
          headers,
          signal: controller.signal,
          body: JSON.stringify(payload),
        });

        const latencyMs = Math.round(performance.now() - start);
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          const errMsg = data?.error?.message || `HTTP ${res.status} ${res.statusText}`;
          const errCode = String(data?.error?.code || '');
          if (isRetryableRateLimit(res.status, `${errCode} ${errMsg}`)) {
            lastError = new Error(`模型 ${model} 暂时拥挤：${errMsg}`);
            continue;
          }
          throw new Error(`接口返回异常 (${model})：${errMsg}`);
        }

        const msg = data?.choices?.[0]?.message;
        const text: string = (msg?.content || msg?.reasoning_content || '').trim();
        const rawSources: Array<{ title?: string; link?: string }> = Array.isArray(data?.web_search)
          ? data.web_search
          : [];
        const webSources: WebSearchSource[] = rawSources
          .map((s) => ({ title: String(s.title || '').trim(), link: String(s.link || '').trim() }))
          .filter((s) => Boolean(s.title && s.link))
          .slice(0, 5);
        return { text, latencyMs, usedModel: model, webSources };
      }
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        lastError = new Error(`模型 ${model} 请求超时`);
        continue;
      }
      if (err instanceof Error && !lastError) {
        throw err;
      }
      lastError = err instanceof Error ? err : new Error(String(err));
    } finally {
      window.clearTimeout(timer);
    }
  }

  throw lastError ?? new Error('所有备选模型暂时不可用，请稍后重试');
}

/**
 * 统一多模态视觉识图入口（自动适配智谱免费 glm-4v-flash / Google Gemini / OpenAI Vision）
 */
export async function callAiVisionCompletion(
  config: Pick<Settings, 'aiProvider' | 'aiBaseUrl' | 'aiApiKey' | 'aiModel'>,
  params: {
    imageDataUrl: string;
    prompt: string;
    maxTokens?: number;
    timeoutMs?: number;
  },
): Promise<{ text: string; latencyMs: number; usedModel: string }> {
  // 当用户启用手机内置纯文本端侧模型时，若发图则自动借用已配好的智谱免费视觉 glm-4v-flash（若有 Key）
  const effectiveConfig =
    config.aiProvider === 'local_embedded'
      ? {
          ...config,
          aiProvider: 'openai_compatible' as const,
          aiBaseUrl: 'https://open.bigmodel.cn/api/paas/v4',
          aiModel: 'glm-4v-flash',
        }
      : config;

  const apiKey = effectiveConfig.aiApiKey.trim();
  const baseUrl = resolveFetchBaseUrl(effectiveConfig.aiBaseUrl);
  const primaryVisionModel = resolveVisionModel(effectiveConfig);

  if (!apiKey) {
    throw new Error('当前为手机端侧纯文本离线模式，拍照识图需在设置页保留免费的智谱 Key 或切到云端识图');
  }

  const candidates = buildFallbackModels(primaryVisionModel, effectiveConfig.aiBaseUrl, 'vision');
  let lastError: Error | null = null;

  for (const model of candidates) {
    const start = performance.now();
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), params.timeoutMs ?? 40000);

    try {
      if (config.aiProvider === 'gemini') {
        const mimeMatch = params.imageDataUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
        if (!mimeMatch) {
          throw new Error('图片格式无效，请重新选择图片');
        }
        const endpoint = `${baseUrl}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: controller.signal,
          body: JSON.stringify({
            contents: [
              {
                parts: [
                  { inline_data: { mime_type: mimeMatch[1], data: mimeMatch[2] } },
                  { text: params.prompt },
                ],
              },
            ],
            generationConfig: {
              temperature: 0.2,
              maxOutputTokens: params.maxTokens ?? 1800,
              responseMimeType: 'application/json',
            },
          }),
        });

        const latencyMs = Math.round(performance.now() - start);
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(data?.error?.message || `Gemini 识图失败 HTTP ${res.status}`);
        }
        const text: string = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
        return { text, latencyMs, usedModel: model };
      } else {
        const endpoint = baseUrl.endsWith('/chat/completions')
          ? baseUrl
          : `${baseUrl}/chat/completions`;

        const res = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
          },
          signal: controller.signal,
          body: JSON.stringify({
            model,
            messages: [
              {
                role: 'user',
                content: [
                  { type: 'image_url', image_url: { url: params.imageDataUrl } },
                  { type: 'text', text: params.prompt },
                ],
              },
            ],
            temperature: 0.2,
            max_tokens: params.maxTokens ?? 1800,
          }),
        });

        const latencyMs = Math.round(performance.now() - start);
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          const errMsg = data?.error?.message || `HTTP ${res.status}`;
          const errCode = String(data?.error?.code || '');
          if (isRetryableRateLimit(res.status, `${errCode} ${errMsg}`)) {
            lastError = new Error(`视觉模型 ${model} 暂时拥挤：${errMsg}`);
            continue;
          }
          throw new Error(`识图接口异常 (${model})：${errMsg}`);
        }

        const msg = data?.choices?.[0]?.message;
        const text: string = (msg?.content || msg?.reasoning_content || '').trim();
        return { text, latencyMs, usedModel: model };
      }
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        lastError = new Error(`视觉模型 ${model} 识图超时`);
        continue;
      }
      if (err instanceof Error && !lastError) {
        throw err;
      }
      lastError = err instanceof Error ? err : new Error(String(err));
    } finally {
      window.clearTimeout(timer);
    }
  }

  throw lastError ?? new Error('免费视觉模型暂时拥挤，请稍后再试');
}

export interface AiConnectionTestResult {
  ok: boolean;
  latencyMs: number;
  message: string;
  replyPreview?: string;
}

/** 对用户配置的 AI 发起轻量连通性探测 */
export async function testAiConnection(
  config: Pick<Settings, 'aiProvider' | 'aiBaseUrl' | 'aiApiKey' | 'aiModel'>,
): Promise<AiConnectionTestResult> {
  const start = performance.now();
  const localMode = isLocalLlmEndpoint(config.aiBaseUrl);
  try {
    const res = await callAiTextCompletion(config, {
      userPrompt: '只回复 OK 两个字母即可。',
      temperature: 0,
      maxTokens: 24,
      timeoutMs: localMode ? 6000 : 15000,
    });
    return {
      ok: true,
      latencyMs: res.latencyMs,
      message: `连通成功 (${res.usedModel} · ${res.latencyMs}ms)`,
      replyPreview: (res.text || 'OK').slice(0, 60),
    };
  } catch (err: unknown) {
    const latencyMs = Math.round(performance.now() - start);
    const rawReason = err instanceof Error ? err.message : String(err);
    const message =
      localMode && /fetch|connect|refused|network|timeout|超时|abort/i.test(rawReason)
        ? `无法连接到本地服务 (${config.aiBaseUrl.trim()})：手机当前未运行 Ollama/llama.cpp 进程。若要连电脑上的 Ollama，请确保同一 Wi-Fi、电脑开启 OLLAMA_HOST=0.0.0.0，并将 Base URL 改为 http://你的电脑IP:11434/v1；日常使用建议直接切回上方「智谱 GLM-4-Flash (免费 + 原生联网)」。`
        : rawReason;
    return {
      ok: false,
      latencyMs,
      message,
    };
  }
}
