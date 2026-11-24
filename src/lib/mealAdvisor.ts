import type { FoodItem, Settings, UserProfile } from '../types/models';
import { callAiTextCompletion, extractCleanJsonBlock } from './aiClient';

export type WorkoutSceneId =
  | 'legs'
  | 'push'
  | 'pull'
  | 'cardio'
  | 'rest'
  | 'low_battery'
  | 'craving';

export interface WorkoutScenePreset {
  id: WorkoutSceneId;
  label: string;
  promptText: string;
  strategySummary: string;
}

/** 快捷「今天练了什么」场景按钮 */
export const WORKOUT_SCENE_PRESETS: WorkoutScenePreset[] = [
  {
    id: 'legs',
    label: '练腿/硬拉(大消耗)',
    promptText: '今天刚练完腿和硬拉，消耗巨大，需要高碳水+高蛋白快速回血',
    strategySummary: '练腿肌糖原消耗最大：优先补足优质碳水 + 35g+ 蛋白质，不必过度恐惧热量。',
  },
  {
    id: 'push',
    label: '推日(胸/肩/三头)',
    promptText: '今天练了胸、肩、三头力量训练，想要高蛋白且不太油腻的餐食',
    strategySummary: '上肢力量日：锁定 32g+ 高蛋白修补肌纤维，碳水适中，控油避免囤脂。',
  },
  {
    id: 'pull',
    label: '拉日(背/二头)',
    promptText: '今天练了背和二头，想要扎实高蛋白和中等碳水',
    strategySummary: '背部大肌群训练后：高蛋白优先，配合温热米面或清汤牛河最稳。',
  },
  {
    id: 'cardio',
    label: '跑步/打球/有氧',
    promptText: '今天跑了步/打了球，出汗很多，需要清爽补碳水与电解质',
    strategySummary: '有氧出汗后：推荐汤粉/牛肉粿条/清淡快餐补水分与碳水，避开厚重油炸。',
  },
  {
    id: 'rest',
    label: '休息日控卡',
    promptText: '今天是休息日没训练，想在食堂或外卖吃得饱、蛋白高、热量低',
    strategySummary: '休息日控卡策略：优先低脂高蛋白、少油蒸菜或轻食，把热量留给训练日。',
  },
  {
    id: 'low_battery',
    label: '熬夜低电量恢复',
    promptText: '昨晚没睡好有点累，想吃温和好消化、能稳住精力的食物',
    strategySummary: '低电量恢复期：避开重油重辣和纯糖奶茶，选清蒸鱼/蒸蛋/牛肉粿条稳血糖。',
  },
  {
    id: 'craving',
    label: '想吃KFC/麦当劳/解馋',
    promptText: '今天嘴馋想吃 KFC、麦当劳、汉堡或烧腊，帮我选聪明吃法不至于热量爆炸',
    strategySummary: '解馋不焦虑原则：同样吃快餐，选去皮原味鸡、去酱板烧或萨莉亚鸡排照样高蛋白！',
  },
];

export interface MealRecommendationItem {
  badge: string;
  food: FoodItem;
  reason: string;
  orderTip: string;
}

export interface MealAdviceResult {
  source: 'local_engine' | 'ai_engine';
  headline: string;
  coachNote: string;
  items: MealRecommendationItem[];
  latencyMs?: number;
  usedModel?: string;
}

/** 内部打分函数：同时服务于「离线秒推」与「AI 推荐前 Top-18 极速召回」 */
function rankFoodsByQuery(params: {
  query: string;
  foods: FoodItem[];
  profile: UserProfile;
  remainingCalories: number;
  lowBatteryMode: boolean;
}) {
  const { query, foods, profile, remainingCalories, lowBatteryMode } = params;
  const q = query.trim().toLowerCase();

  const isLegs = /腿|深蹲|硬拉|下肢|臀/.test(q);
  const isUpper = /胸|背|肩|推|拉|手|二头|三头|卧推|引体|力量/.test(q);
  const isCardio = /跑|有氧|球|游泳|骑车|出汗/.test(q);
  const isCraving = /kfc|肯德基|麦当劳|汉堡|炸鸡|奶茶|萨莉亚|解馋|放纵|快餐|螺蛳粉|麻辣烫|烧腊/.test(q);
  const isLowEnergy = lowBatteryMode || /熬夜|困|累|低电量|没睡好/.test(q);
  const isRest = /休息|没练|减脂|控卡|少油|轻食/.test(q);

  const budgetMatch = q.match(/(?:预算|以内|不超过|低于|控制在)\s*(\d{1,3})|(\d{1,3})\s*(?:元|块)/);
  const singleMealBudget = budgetMatch
    ? Number(budgetMatch[1] || budgetMatch[2])
    : Math.max(15, Math.round(profile.dailyBudgetYuan * 0.6));

  const preferKfc = /kfc|肯德基/.test(q);
  const preferMcd = /麦当劳|金拱门/.test(q);
  const preferCanteen = /食堂|中餐|简餐|家常/.test(q);
  const preferLight = /轻食|沙拉|波奇|鸡胸/.test(q);
  const preferTakeaway = /外卖|快餐/.test(q);

  const scored = foods
    .filter((f) => f.calories >= 150)
    .map((food) => {
      let score = 50;
      const text = `${food.storeName} ${food.location} ${food.name} ${food.tags.join(' ')}`.toLowerCase();

      score += Math.min(30, food.proteinG * 0.75);

      if (food.priceYuan <= singleMealBudget) score += 14;
      else if (food.priceYuan <= singleMealBudget + 8) score += 4;
      else score -= 12;

      const targetMealCal = Math.max(420, Math.min(850, remainingCalories * 0.5 || 600));
      const calDiff = Math.abs(food.calories - targetMealCal);
      score -= Math.min(25, calDiff / 22);

      if (isLegs) {
        if (food.carbsG >= 65) score += 20;
        if (food.proteinG >= 32) score += 18;
        if (food.calories >= 580 && food.calories <= 880) score += 12;
      } else if (isUpper) {
        if (food.proteinG >= 34) score += 24;
        if (food.cookingOilFactor <= 1.2) score += 12;
      } else if (isCardio) {
        if (/汤|粉|面|粿条|轻食|蒸/.test(text)) score += 22;
        if (food.fatG <= 20) score += 12;
      } else if (isCraving) {
        if (/kfc|肯德基|麦当劳|萨莉亚|塔斯汀|华莱士|烧腊|麻辣烫|猪脚|炸鸡|螺蛳粉/.test(text)) {
          score += 28;
        }
        if (/聪明吃|去皮|去酱|高蛋白/.test(text)) score += 16;
      } else if (isLowEnergy) {
        if (/易消化|蒸|鱼|粿条|汤|少油/.test(text)) score += 26;
        if (food.cookingOilFactor <= 1.15) score += 14;
      } else if (isRest) {
        if (food.calories <= 580 && food.proteinG >= 30) score += 26;
        if (food.cookingOilFactor <= 1.1) score += 15;
      }

      if (preferKfc && /kfc|肯德基/.test(text)) score += 50;
      if (preferMcd && /麦当劳/.test(text)) score += 50;
      if (preferCanteen && food.sourceType === 'canteen') score += 32;
      if (preferLight && /轻食|沙拉|波奇|鸡胸/.test(text)) score += 36;
      if (preferTakeaway && food.sourceType === 'takeaway') score += 22;

      return { food, score, text };
    })
    .sort((a, b) => b.score - a.score);

  return {
    scored,
    flags: {
      isLegs,
      isUpper,
      isCardio,
      isCraving,
      isLowEnergy,
      isRest,
      preferKfc,
      preferMcd,
      singleMealBudget,
    },
  };
}

/**
 * 1. 本地秒出推荐引擎（免 Key、0 延迟，全库打分挑选）
 */
export function buildLocalMealAdvice(params: {
  query: string;
  foods: FoodItem[];
  profile: UserProfile;
  remainingCalories: number;
  remainingProteinG: number;
  lowBatteryMode: boolean;
}): MealAdviceResult {
  const { scored, flags } = rankFoodsByQuery(params);
  const picks: MealRecommendationItem[] = [];
  const usedIds = new Set<string>();

  const tryPick = (
    badge: string,
    predicate: (entry: (typeof scored)[number]) => boolean,
    reasonBuilder: (f: FoodItem) => string,
  ) => {
    const found = scored.find(
      (entry) =>
        !usedIds.has(`${entry.food.storeName}::${entry.food.name}`) && predicate(entry),
    );
    if (!found) return;
    usedIds.add(`${found.food.storeName}::${found.food.name}`);
    picks.push({
      badge,
      food: found.food,
      reason: reasonBuilder(found.food),
      orderTip: found.food.notes || '按正常份量吃，控制额外高油酱汁即可。',
    });
  };

  if (flags.preferKfc || flags.preferMcd || flags.isCraving) {
    tryPick(
      '解馋聪明吃 · 首选',
      (e) =>
        (flags.preferKfc
          ? /kfc|肯德基/.test(e.text)
          : flags.preferMcd
            ? /麦当劳/.test(e.text)
            : true) && /kfc|肯德基|麦当劳|萨莉亚|塔斯汀|华莱士|烧腊|麻辣烫|猪脚/.test(e.text),
      (f) => `既满足你想吃 ${f.storeName} 的口腹欲，又能拿到 ${f.proteinG}g 蛋白，不打乱全天节奏。`,
    );
  }

  tryPick(
    '中式简餐 · 高性价比',
    (e) => e.food.sourceType === 'canteen',
    (f) =>
      `${f.storeName}常见好点，仅 ¥${f.priceYuan.toFixed(0)} 即可补充 ${f.proteinG}g 蛋白与 ${f.carbsG}g 碳水。`,
  );

  tryPick(
    flags.isLegs ? '大消耗充能 · 高蛋白推荐' : '轻食外卖 · 高蛋白推荐',
    (e) => e.food.sourceType === 'takeaway' && e.food.proteinG >= 28,
    (f) =>
      `蛋白高达 ${f.proteinG}g，契合你当前剩余 ${Math.max(0, params.remainingProteinG)}g 蛋白缺口。`,
  );

  tryPick(
    '连锁快餐 · 隐藏健身吃法',
    (e) => /kfc|肯德基|麦当劳|赛百味|萨莉亚|沙县|麻辣烫/.test(e.text),
    (f) => `想换换口味时，去 ${f.storeName} 这样点同样稳控碳蛋脂（${f.calories} kcal）。`,
  );

  while (picks.length < 4) {
    const next = scored.find((e) => !usedIds.has(`${e.food.storeName}::${e.food.name}`));
    if (!next) break;
    usedIds.add(`${next.food.storeName}::${next.food.name}`);
    picks.push({
      badge: '综合高匹配备选',
      food: next.food,
      reason: `热量 ${next.food.calories} kcal，蛋白 ${next.food.proteinG}g，综合契合当前状态。`,
      orderTip: next.food.notes || '搭配一杯无糖饮品更清爽。',
    });
  }

  let headline = '按你今日体征与训练状态匹配';
  let coachNote = `当前单餐参考预算约 ¥${flags.singleMealBudget}，今日剩余可摄入 ${Math.max(0, params.remainingCalories)} kcal、蛋白缺口 ${Math.max(0, params.remainingProteinG)}g。`;

  if (flags.isLegs) {
    headline = '练腿大消耗 · 碳水蛋白双充能方案';
    coachNote = `练完下肢糖原见底，这顿大胆补碳水 + 35g 左右蛋白，恢复效率翻倍。${coachNote}`;
  } else if (flags.isCraving) {
    headline = '想吃快餐/解馋 · 聪明点单方案';
    coachNote = '美食库不管健不健康全收了！想吃 KFC/麦当劳/烧腊完全可以，挑对单品+去皮少酱就行。';
  } else if (flags.isLowEnergy) {
    headline = '低电量恢复 · 温和稳血糖方案';
    coachNote = '睡眠不足时胰岛素敏感度略降，优先少油热食和优质蛋白，少碰高糖奶茶。';
  } else if (flags.isUpper) {
    headline = '力量训练后 · 高蛋白修肌方案';
    coachNote = `上肢泵感拉满后抓紧补 30-45g 优质蛋白。${coachNote}`;
  } else if (flags.isCardio) {
    headline = '有氧出汗后 · 补水补糖原方案';
    coachNote = '优先选带清汤或易消化的主食蛋白组合，同时多喝 350ml 电解质水。';
  }

  return {
    source: 'local_engine',
    headline,
    coachNote,
    items: picks,
  };
}

/**
 * 2. 两阶段混合优化 AI 推荐：
 * 阶段一（1ms 本地初筛）：从全量菜品中召回 Top-18 最贴合候选（兼顾中式简餐、轻食、全国连锁快餐等）
 * 阶段二（AI 精排）：将精简候选发给端侧或云端模型，响应更快且推荐更精准
 */
export async function buildAiMealAdvice(params: {
  query: string;
  foods: FoodItem[];
  profile: UserProfile;
  settings: Settings;
  remainingCalories: number;
  remainingProteinG: number;
  lowBatteryMode: boolean;
}): Promise<MealAdviceResult> {
  const { query, profile, settings, remainingCalories, remainingProteinG, lowBatteryMode } = params;

  const { scored } = rankFoodsByQuery(params);
  const shortlist = scored.slice(0, 18).map((s) => s.food);

  const catalogLines = shortlist
    .map(
      (f, idx) =>
        `[${idx}] ${f.storeName}(${f.location}) | ${f.name} | ¥${f.priceYuan} | ${f.calories}kcal 蛋${f.proteinG}g 碳${f.carbsG}g 脂${f.fatG}g`,
    )
    .join('\n');

  const systemPrompt = `你是资深健身搭子兼运动营养教练，说话接地气、实用不说教。
你熟悉全国常见中式简餐、轻食沙拉、便利店补给及麦当劳/肯德基/赛百味/萨莉亚等连锁餐饮的聪明点法。
严禁推荐“不推荐”凑数，挑出的 3~4 道菜必须都是真正值得今天吃的方案（覆盖日常简餐/快餐聪明吃/轻食高蛋白等场景）。`;

  const userPrompt = `用户画像与当前需求：
- 目标：${profile.goal === 'cut' ? '科学减脂' : profile.goal === 'bulk' ? '干净增肌' : '维持塑形'}，日预算 ¥${profile.dailyBudgetYuan}
- 今日剩余：${Math.max(0, remainingCalories)} kcal，蛋白缺口 ${Math.max(0, remainingProteinG)}g，睡眠：${lowBatteryMode ? '不足(低电量恢复模式)' : '正常'}
- 用户刚说：「${query || '今天刚训练完，帮我推荐吃什么'}」

候选菜单（[序号]为唯一编号）：
${catalogLines}

请从中精选 3~4 个方案，严格只输出纯 JSON（不要加多余前后缀）：
{
  "headline": "简短有吸引力的推荐标题（16字内）",
  "coachNote": "2句以内自然语气教练点评，结合他刚练的部位和需求",
  "picks": [
    {
      "index": 0,
      "badge": "如：练腿回血首选 / 快餐聪明吃法 / 高蛋白性价比王",
      "reason": "结合训练和营养缺口说明为什么推荐这道（38字内）",
      "orderTip": "落地可执行点单话术，如去皮/少酱/换无糖饮品（38字内）"
    }
  ]
}`;

  const { text, latencyMs, usedModel } = await callAiTextCompletion(settings, {
    systemPrompt,
    userPrompt,
    temperature: 0.45,
    maxTokens: 780,
    jsonMode: true,
  });

  const cleanJson = extractCleanJsonBlock(text, 'object');
  const parsed = JSON.parse(cleanJson) as {
    headline?: string;
    coachNote?: string;
    picks?: Array<{ index?: number; badge?: string; reason?: string; orderTip?: string }>;
  };

  const validPicks: MealRecommendationItem[] = [];
  const used = new Set<number>();
  for (const p of parsed.picks ?? []) {
    const idx = Number(p.index);
    if (!Number.isInteger(idx) || idx < 0 || idx >= shortlist.length || used.has(idx)) continue;
    used.add(idx);
    validPicks.push({
      badge: p.badge || 'AI 精选',
      food: shortlist[idx],
      reason: p.reason || '契合你今日训练强度与营养缺口。',
      orderTip: p.orderTip || shortlist[idx].notes || '注意控制高油酱料即可。',
    });
  }

  if (validPicks.length === 0) {
    throw new Error('AI 未匹配到有效菜品索引，请重试');
  }

  return {
    source: 'ai_engine',
    headline: parsed.headline || 'AI 为你定制的营养搭配方案',
    coachNote: parsed.coachNote || '结合你今天的训练内容与热量缺口生成。',
    items: validPicks,
    latencyMs,
    usedModel,
  };
}
