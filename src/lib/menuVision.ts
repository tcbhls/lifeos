import type { FoodItem, FoodSourceType, Settings } from '../types/models';
import { callAiVisionCompletion, extractCleanJsonBlock } from './aiClient';

/**
 * 将用户上传的外卖长截图或食堂价目表照片等比压缩为适合免费视觉模型清晰阅读的 JPEG DataURL
 * 保留足够文字清晰度（长边上限 1600px），避免原图过大导致传输超时
 */
export function compressImageToDataUrl(file: File, maxDimension = 1600): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('无法读取所选图片文件'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('图片解码失败，请确认是常见 PNG/JPG/WebP 格式'));
      img.onload = () => {
        let { width, height } = img;
        if (width > maxDimension || height > maxDimension) {
          const ratio = Math.min(maxDimension / width, maxDimension / height);
          width = Math.max(1, Math.round(width * ratio));
          height = Math.max(1, Math.round(height * ratio));
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(String(reader.result));
          return;
        }
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', 0.84));
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}

export interface ParsedMenuResult {
  items: Array<Omit<FoodItem, 'id'>>;
  usedModel: string;
  latencyMs: number;
}

/**
 * 上传外卖菜单长截图或餐厅/食堂价目表照片
 * 自动调用多模态视觉模型（如智谱 glm-4v-flash / Gemini 2.5 Flash）提取结构化菜品列表
 */
export async function parseMenuImageWithAi(params: {
  file: File;
  sourceTypeHint: FoodSourceType;
  locationHint: string;
  settings: Pick<Settings, 'aiProvider' | 'aiBaseUrl' | 'aiApiKey' | 'aiModel'>;
}): Promise<ParsedMenuResult> {
  const imageDataUrl = await compressImageToDataUrl(params.file);

  const prompt = `你是一位擅长中式餐饮营养估算的 AI 助手。请仔细阅读这张手机外卖截图或餐厅/食堂价目表照片，提取出图里所有清晰可见的菜品（最多 12 道），不管健康与否全部如实提取。

已知上下文提示：
- 来源类型偏好：${params.sourceTypeHint === 'canteen' ? '中式简餐/食堂窗口' : '外卖/连锁餐饮'}
- 所在位置参考：${params.locationHint || '附近餐饮'}

请严格只输出一个 JSON 数组（不要输出任何额外说明），每一项字段如下：
[
  {
    "storeName": "店名或食堂档口名（图中看不清就按位置填写）",
    "name": "具体菜品名",
    "priceYuan": 15.0,
    "portionDesc": "1份（约420g）",
    "calories": 580,
    "proteinG": 30,
    "carbsG": 70,
    "fatG": 18,
    "cookingOilFactor": 1.2,
    "tags": ["高蛋白", "性价比"],
    "notes": "一句点单控油或营养提醒"
  }
]`;

  const { text, latencyMs, usedModel } = await callAiVisionCompletion(params.settings, {
    imageDataUrl,
    prompt,
    maxTokens: 1800,
    timeoutMs: 45000,
  });

  const jsonStr = extractCleanJsonBlock(text, 'array');
  const rawArr = JSON.parse(jsonStr) as Array<Record<string, unknown>>;
  if (!Array.isArray(rawArr) || rawArr.length === 0) {
    throw new Error('图片中未识别到清晰的菜名与价格，请换一张更清晰的价目表或外卖截图');
  }

  const now = Date.now();
  const items: Array<Omit<FoodItem, 'id'>> = rawArr.slice(0, 12).map((row) => ({
    sourceType: params.sourceTypeHint,
    location: params.locationHint.trim() || (params.sourceTypeHint === 'canteen' ? '中式简餐/食堂' : '外卖/连锁'),
    storeName: String(row.storeName || params.locationHint || '识图录入店铺').trim(),
    name: String(row.name || '未命名菜品').trim(),
    priceYuan: Math.max(0, Number(row.priceYuan) || 15),
    portionDesc: String(row.portionDesc || '1份（识图估算）'),
    calories: Math.max(20, Math.round(Number(row.calories) || 550)),
    proteinG: Math.max(0, Math.round(Number(row.proteinG) || 25)),
    carbsG: Math.max(0, Math.round(Number(row.carbsG) || 65)),
    fatG: Math.max(0, Math.round(Number(row.fatG) || 18)),
    cookingOilFactor: Number(row.cookingOilFactor) || 1.2,
    confidence: 'ai_estimated',
    tags: Array.isArray(row.tags)
      ? row.tags.map(String).filter(Boolean).slice(0, 4)
      : ['截图识图'],
    mealSlots: ['lunch', 'dinner'],
    isFavorite: false,
    notes: typeof row.notes === 'string' && row.notes.trim() ? row.notes.trim() : '由免费视觉 AI 识图入库',
    createdAt: now,
    updatedAt: now,
  }));

  return { items, usedModel, latencyMs };
}
