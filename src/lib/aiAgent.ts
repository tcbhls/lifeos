import { retrieveWellnessKnowledge } from '../data/wellnessKnowledgeBase';
import { createDefaultUserProfile, db } from '../db/database';
import type { NavTab } from '../components/layout/MobileShell';
import type { useTodaySummary } from '../hooks/useTodaySummary';
import type { DrinkType, FitnessGoal, FoodItem, FoodSourceType, MealSlot } from '../types/models';
import {
  callAiTextCompletion,
  callAiVisionCompletion,
  type WebSearchSource,
} from './aiClient';
import { getCachedAmapWeather } from './amap';
import { compressImageToDataUrl } from './menuVision';
import { hapticSuccess, syncNativeReminders } from './native';
import { calculateMetabolicTargets } from './nutrition';

type SummaryData = ReturnType<typeof useTodaySummary>;

/**
 * AI 在 LifeOS 内部拥有的 12 项全功能操作权限定义
 * 仅作用于本 App 本地 IndexedDB、UI 导航与原生提醒，不涉及系统外部敏感权限
 */
export type AgentAction =
  | {
      type: 'log_water';
      drinkType?: DrinkType;
      rawMl: number;
    }
  | {
      type: 'log_meal';
      foodName: string;
      storeName?: string;
      priceYuan?: number;
      calories?: number;
      proteinG?: number;
      carbsG?: number;
      fatG?: number;
      mealType?: MealSlot;
    }
  | {
      type: 'add_food_item';
      name: string;
      storeName: string;
      location?: string;
      sourceType?: FoodSourceType;
      priceYuan?: number;
      calories: number;
      proteinG: number;
      carbsG: number;
      fatG: number;
      notes?: string;
      tags?: string[];
    }
  | {
      type: 'log_sleep';
      bedTime?: string;
      wakeTime?: string;
    }
  | {
      type: 'log_weight';
      weightKg: number;
    }
  | {
      type: 'toggle_training_day';
      isTrainingDay: boolean;
    }
  | {
      type: 'log_stretch';
    }
  | {
      type: 'add_workout_exercise';
      dayHint?: string;
      name: string;
      muscleGroup?: string;
      targetSets?: number;
      targetRepMin?: number;
      targetRepMax?: number;
      restSeconds?: number;
    }
  | {
      type: 'update_user_profile';
      dailyBudgetYuan?: number;
      goal?: FitnessGoal;
      bedtimeTarget?: string;
      calorieAdjustmentDelta?: number;
    }
  | {
      type: 'add_dnd_window';
      label: string;
      start: string;
      end: string;
    }
  | {
      type: 'sync_notifications';
    }
  | {
      type: 'navigate_tab';
      target: NavTab | 'settings';
    };

export interface ExecutedActionRecord {
  type: AgentAction['type'];
  ok: boolean;
  summary: string;
}

export interface AgentChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  imagePreviewUrl?: string;
  executedActions?: ExecutedActionRecord[];
  webSources?: WebSearchSource[];
  usedModel?: string;
  latencyMs?: number;
  timestamp: number;
}

export interface AgentRunContext {
  currentView: NavTab | 'settings';
  summary: SummaryData;
  onNavigate: (target: NavTab | 'settings') => void;
  onNotify: (text: string) => void;
}

const VIEW_LABELS: Record<NavTab | 'settings', string> = {
  today: '首页（今日中枢）',
  diet: '饮食板块（推荐 / 三餐 / 美食库 / 探店）',
  workout: '训练板块（分化计划 / 健身房专注模式）',
  routine: '作息板块（喝水 / 睡眠 / 免打扰提醒）',
  settings: '设置页（身体档案 / AI 配置 / 备份）',
};

/** 生成精确的手机本地实时日期时间字符串，彻底杜绝大模型猜测训练截止日期 */
function formatLiveDeviceDateTime(): string {
  const now = new Date();
  const weekdays = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
  const y = now.getFullYear();
  const m = now.getMonth() + 1;
  const d = now.getDate();
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  return `${y}年${m}月${d}日 ${weekdays[now.getDay()]} ${hh}:${mm}`;
}

/** 判断用户本轮输入是否包含明确的 App 内部操作指令 */
function isLocalActionRequest(userText: string): boolean {
  const q = userText.trim();
  return /(帮我|给我|请)?(记一下|记一杯|记一顿|记录|打卡|喝了|吃了|添加|加一个|加进|设成|设为|调成|改成|切换|带我去|回到|打开).*(水|咖啡|奶茶|美式|电解质|牛奶|茶|饭|餐|睡眠|睡|体重|晨重|拉伸|免打扰|提醒|预算|目标|首页|饮食|训练|作息|设置|推日|拉日|腿日)/.test(
    q,
  );
}

/**
 * 确定性兜底动作提取器：
 * 当轻量云端或本地 GGUF 模型口头答复「已记录」但漏掉 <<<ACTIONS>>> 块时，
 * 针对明确的喝水 / 拉伸 / 免打扰 / 记体重 / 切页指令做精准兜底，杜绝“假装记录”幻觉。
 */
function inferFallbackLocalActions(userText: string): AgentAction[] {
  const q = userText.trim();
  if (!isLocalActionRequest(q)) return [];
  const actions: AgentAction[] = [];

  // 1. 喝水/饮品记录
  const waterMatch = q.match(/(?:喝了?|记(?:一下|一杯)?|补水)[^\d]{0,8}(\d{2,4})\s*(?:ml|毫升|mL)?/i);
  if (waterMatch && /(水|电解质|咖啡|美式|拿铁|奶茶|茶|牛奶|豆浆|可乐)/.test(q)) {
    const rawMl = Number(waterMatch[1]);
    if (rawMl >= 50 && rawMl <= 2000) {
      let drinkType: DrinkType = 'water';
      if (/电解质|宝矿力|外星人|运动饮料/.test(q)) drinkType = 'electrolyte';
      else if (/咖啡|美式|拿铁/.test(q)) drinkType = 'coffee';
      else if (/牛奶|豆浆|酸奶/.test(q)) drinkType = 'milk';
      else if (/奶茶|可乐|雪碧|果汁|糖/.test(q)) drinkType = 'sugary';
      else if (/茶/.test(q)) drinkType = 'tea';
      actions.push({ type: 'log_water', drinkType, rawMl });
    }
  }

  // 2. 拉伸打卡
  if (/(打卡|记|完成).{0,6}拉伸|拉伸.{0,4}(打卡|一次|\+1)/.test(q)) {
    actions.push({ type: 'log_stretch' });
  }

  // 3. 免打扰时段
  const dndMatch = q.match(/(\d{1,2}:\d{2})\s*[-~到至]\s*(\d{1,2}:\d{2})/);
  if (dndMatch && /免打扰/.test(q)) {
    const pad = (t: string) => t.replace(/^(\d):/, '0$1:');
    const labelMatch = q.match(/的([^\s，,。]{2,10}?)(?:加进|设为|设成|加入)?免打扰/);
    actions.push({
      type: 'add_dnd_window',
      label: labelMatch?.[1] || '课表免打扰',
      start: pad(dndMatch[1]),
      end: pad(dndMatch[2]),
    });
    if (/同步提醒/.test(q)) {
      actions.push({ type: 'sync_notifications' });
    }
  }

  // 4. 页面跳转
  if (/(带我去|回到|切换到|打开).*(首页|今日|饮食|训练|作息|设置)/.test(q)) {
    const navMap: Array<[RegExp, NavTab | 'settings']> = [
      [/首页|今日/, 'today'],
      [/饮食/, 'diet'],
      [/训练/, 'workout'],
      [/作息/, 'routine'],
      [/设置/, 'settings'],
    ];
    for (const [re, target] of navMap) {
      if (re.test(q)) {
        actions.push({ type: 'navigate_tab', target });
        break;
      }
    }
  }

  return actions;
}

/**
 * 智能判断是否开启实时联网搜索：
 * 纯操作指令关闭 web_search，确保模型聚焦动作执行；
 * 其他日期、天气、营养、补剂、中医养生、新店咨询自动走实时联网搜索。
 */
function shouldUseWebSearch(userText: string, webSearchEnabled: boolean): boolean {
  if (!webSearchEnabled) return false;
  const q = userText.trim();
  if (!q) return false;
  if (isLocalActionRequest(q) && !/天气|今天几|几号|最新|新闻|联网|搜一下|查一下/.test(q)) {
    return false;
  }
  return true;
}

/** 收集当前 App 全模块实时快照，让 AI 彻底“看穿”用户在各个板块的数据与状态 */
async function buildAppContextSnapshot(ctx: AgentRunContext, userQuery: string): Promise<string> {
  const { summary, currentView } = ctx;
  const {
    profile,
    settings,
    habit,
    dailyTargets,
    consumed,
    todayMeals,
    workoutLogs,
    todayWorkoutLog,
    rpg,
    streakDays,
    lowBatteryMode,
    weightTrend,
  } = summary;

  const [allFoods, plans] = await Promise.all([
    db.foodItems.toArray(),
    db.workoutPlans.toArray(),
  ]);
  const activePlan = plans.find((p) => p.isActive) ?? plans[0];

  // 从美食库挑出与用户当前提问最相关的最多 14 道菜作为参考上下文
  const q = userQuery.toLowerCase();
  const matchedFoods = allFoods
    .map((f) => {
      const hay = `${f.storeName} ${f.location} ${f.name} ${f.tags.join(' ')}`.toLowerCase();
      let score = f.isFavorite ? 5 : 0;
      for (const kw of ['kfc', '肯德基', '麦当劳', '赛百味', '老乡鸡', '烧腊', '鸡', '牛', '麻辣烫', '螺蛳粉', '奶茶', '咖啡', '沙县', '萨莉亚', '轻食', '便利店']) {
        if (q.includes(kw) && hay.includes(kw)) score += 20;
      }
      if (f.proteinG >= 32) score += 3;
      return { f, score };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 14)
    .map(
      ({ f }) =>
        `- ${f.storeName}(${f.location})·${f.name} | ¥${f.priceYuan} | ${f.calories}kcal 蛋${f.proteinG}g 碳${f.carbsG}g 脂${f.fatG}g`,
    );

  const planDesc = activePlan
    ? activePlan.days
        .map((d) => `${d.title}(${d.focus}): ${d.exercises.map((e) => `${e.name}[${e.targetSets}x${e.targetRepMin}-${e.targetRepMax}]`).join('、')}`)
        .join('\n')
    : '暂无训练计划';

  const recentWorkouts = [...workoutLogs]
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, 3)
    .map((w) => `${w.date} ${w.dayName} 容量${w.totalVolumeKg}kg (${w.durationMin}分钟)`)
    .join('；');

  const todayMealsDesc =
    todayMeals.length > 0
      ? todayMeals
          .map((m) => `${m.storeName}·${m.foodName}(${m.calories}kcal/蛋${m.proteinG}g/¥${m.priceYuan})`)
          .join('；')
      : '今天尚未记录任何餐食';

  const dndDesc = settings.dndWindows
    .map((w) => `${w.label}[${w.start}-${w.end}:${w.enabled ? '开' : '关'}]`)
    .join('、');

  const wellnessRag = retrieveWellnessKnowledge(userQuery, 2);
  const cachedWeather = getCachedAmapWeather();
  const weatherDesc = cachedWeather
    ? `${cachedWeather.city} ${cachedWeather.weather} ${cachedWeather.temperature}°C 湿度${cachedWeather.humidity}%`
    : '';
  const isEmbeddedCompact = settings.aiProvider === 'local_embedded';

  if (isEmbeddedCompact) {
    // 端侧 0.6B~1.7B 轻量化专用精简上下文（严控在 ~600 字内，大幅提速并防 2048 token 溢出）
    return `【时间】${formatLiveDeviceDateTime()}${weatherDesc ? ` | 实况天气:${weatherDesc}` : ''}
【体征与今日】${profile.gender === 'male' ? '男' : '女'} ${profile.heightCm}cm ${profile.weightKg}kg(目标${profile.targetWeightKg}kg) | 剩${Math.max(0, dailyTargets.calories - consumed.calories)}kcal | 蛋白${consumed.proteinG}/${dailyTargets.proteinG}g | 水${habit.totalEffectiveWaterMl}/${dailyTargets.waterMl}ml | 睡眠${habit.sleepDurationHours ?? '未录'}h${lowBatteryMode ? '(低电量)' : ''} | 训练日:${habit.isTrainingDay ? '是' : '否'}
【今日餐食】${todayMealsDesc}
【训练分化】${activePlan?.name || '五分化'}（今日:${todayWorkoutLog ? todayWorkoutLog.dayName : '未练'}）
${wellnessRag ? `【权威健身与养生参考】\n${wellnessRag}\n` : ''}【食堂/外卖精选参考】
${matchedFoods.slice(0, 4).join('\n')}`;
  }

  return `【当前手机实时时间】${formatLiveDeviceDateTime()}${weatherDesc ? ` | 【当地实况天气】${weatherDesc}` : ''}（涉及今天是几年几月几日/星期几/当前时段，必须严格以此为准，严禁沿用旧年份）
【当前所在页面】${VIEW_LABELS[currentView]}
【用户档案】昵称:${profile.nickname} | 所在城市:${profile.campus} | ${profile.gender === 'male' ? '男' : '女'} ${profile.age}岁 ${profile.heightCm}cm ${profile.weightKg}kg(目标${profile.targetWeightKg}kg) | 目标:${profile.goal === 'cut' ? '科学减脂' : profile.goal === 'bulk' ? '干净增肌' : '维持塑形'} | 日预算:¥${profile.dailyBudgetYuan} | TDEE:${profile.tdee}kcal
【RPG与今日总览】LV.${rpg.level} ${rpg.title} | 连胜${streakDays}天 | 今日+${habit.xpEarned}XP | 训练日:${habit.isTrainingDay ? '是' : '否'} | 低电量模式:${lowBatteryMode ? '已触发(睡眠不足6.5h)' : '否'}
【今日能量与饮水】热量 ${consumed.calories}/${dailyTargets.calories}kcal(剩${Math.max(0, dailyTargets.calories - consumed.calories)}) | 蛋白 ${consumed.proteinG}/${dailyTargets.proteinG}g | 碳水 ${consumed.carbsG}/${dailyTargets.carbsG}g | 脂肪 ${consumed.fatG}/${dailyTargets.fatG}g | 花费 ¥${consumed.spentYuan}/¥${profile.dailyBudgetYuan} | 有效补水 ${habit.totalEffectiveWaterMl}/${dailyTargets.waterMl}ml
【今日已吃餐食】${todayMealsDesc}
【睡眠与体重】入睡:${habit.sleepBedTime || '未录'} 起床:${habit.sleepWakeTime || '未录'} 时长:${habit.sleepDurationHours ?? '未录'}h(目标入睡${profile.bedtimeTarget}) | 今日晨重:${habit.morningWeightKg ?? '未录'}kg | 趋势:${weightTrend.statusLabel}
【今日训练与计划】今日已完成:${todayWorkoutLog ? `${todayWorkoutLog.dayName} 容量${todayWorkoutLog.totalVolumeKg}kg` : '未完成'} | 近期记录:${recentWorkouts || '暂无'}
当前分化(${activePlan?.name || '无'}):
${planDesc}
【免打扰与提醒】喝水间隔:${settings.waterReminderIntervalMin}分钟 | 免打扰:${dndDesc || '无'}
${wellnessRag ? `【本地健身与四季养生参考库】\n${wellnessRag}\n` : ''}【饮食库精选参考(全库共${allFoods.length}道)】
${matchedFoods.join('\n')}`;
}

/**
 * 工业级容错解析：分离“给用户看的自然语言”与 AI 动作指令块
 * 兼容 <<<ACTIONS>>> / >>>ACTIONS>>> 尖括号变体、漏写外层 [] 的多对象列表、单对象 JSON、尾逗号等大模型常见格式波动，
 * 且无论解析成败都彻底剥离原始指令块，绝不向用户对话气泡泄漏原始 JSON
 */
function parseAgentResponse(raw: string): { replyText: string; actions: AgentAction[] } {
  const cleaned = raw.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  const actionRegex =
    /(?:<{2,3}|>{2,3})\s*ACTIONS\s*(?:<{2,3}|>{2,3})([\s\S]*?)(?:(?:<{2,3}|>{2,3})\s*END_ACTIONS\s*(?:<{2,3}|>{2,3})|$)/i;
  const match = cleaned.match(actionRegex);

  if (!match) {
    return { replyText: cleaned, actions: [] };
  }

  const replyText = cleaned.replace(actionRegex, '').trim();
  const inner = match[1]
    .replace(/```(?:json)?\s*/gi, '')
    .replace(/```/g, '')
    .trim();

  let actions: AgentAction[] = [];

  // 尝试多种容错 JSON 形态：标准数组 / 单对象 / 逗号分隔的多个裸对象
  const attempts = [
    inner,
    inner.replace(/,\s*([}\]])/g, '$1'),
    `[${inner.replace(/,\s*$/, '')}]`,
    `[${inner.replace(/}\s*{/g, '},{').replace(/,\s*$/, '')}]`,
  ];

  for (const candidate of attempts) {
    try {
      const parsed = JSON.parse(candidate);
      const list = Array.isArray(parsed) ? parsed : [parsed];
      const valid = list.filter(
        (a): a is AgentAction => Boolean(a) && typeof a === 'object' && typeof a.type === 'string',
      );
      if (valid.length > 0) {
        actions = valid;
        break;
      }
    } catch {
      // 继续下一个容错形态
    }
  }

  return { replyText: replyText || '已完成你的指令，相关数据已自动同步更新。', actions };
}

/** 将大模型可能输出的页面别名标准化为合法路由 */
function normalizeNavTarget(rawTarget: string): NavTab | 'settings' {
  const t = String(rawTarget || '').trim().toLowerCase();
  if (['today', 'home', 'index', 'main', '首页', '今日'].includes(t)) return 'today';
  if (['diet', 'food', 'meal', 'meals', '饮食', '食堂', '美食'].includes(t)) return 'diet';
  if (['workout', 'train', 'training', 'gym', 'fitness', '训练', '健身'].includes(t)) return 'workout';
  if (['routine', 'habit', 'sleep', 'water', '作息', '喝水', '睡眠'].includes(t)) return 'routine';
  if (['settings', 'setting', 'config', 'profile', '设置'].includes(t)) return 'settings';
  return 'today';
}

/**
 * 真正执行 AI 下发的 App 全权限动作（直接落盘 IndexedDB、触发震动与跨页跳转）
 */
export async function executeAgentActions(
  actions: AgentAction[],
  ctx: AgentRunContext,
): Promise<ExecutedActionRecord[]> {
  const results: ExecutedActionRecord[] = [];
  const { summary, onNavigate } = ctx;

  for (const act of actions) {
    try {
      switch (act.type) {
        case 'log_water': {
          const validDrinks: DrinkType[] = ['water', 'electrolyte', 'tea', 'coffee', 'milk', 'sugary'];
          const drink: DrinkType =
            act.drinkType && validDrinks.includes(act.drinkType) ? act.drinkType : 'water';
          const ml = Math.max(50, Math.min(2000, Math.round(Number(act.rawMl) || 250)));
          const res = await summary.actions.logWater(drink, ml);
          results.push({
            type: act.type,
            ok: true,
            summary: `记录饮水 ${ml}ml（有效 +${res.effectiveMl}ml${res.gainedXp ? ` · +${res.gainedXp}XP` : ''}）`,
          });
          break;
        }

        case 'log_meal': {
          const allFoods = await db.foodItems.toArray();
          const kw = act.foodName.trim().toLowerCase();
          const matched = allFoods.find(
            (f) => f.name.toLowerCase().includes(kw) || kw.includes(f.name.toLowerCase()),
          );

          const foodToLog: FoodItem = matched ?? {
            sourceType: 'takeaway',
            location: 'AI 快速估算记餐',
            storeName: act.storeName?.trim() || 'AI 记餐',
            name: act.foodName.trim() || '未知餐品',
            priceYuan: Math.max(0, Number(act.priceYuan) || 15),
            portionDesc: '1份',
            calories: Math.max(20, Math.round(Number(act.calories) || 550)),
            proteinG: Math.max(0, Math.round(Number(act.proteinG) || 28)),
            carbsG: Math.max(0, Math.round(Number(act.carbsG) || 65)),
            fatG: Math.max(0, Math.round(Number(act.fatG) || 18)),
            cookingOilFactor: 1.2,
            confidence: 'ai_estimated',
            tags: ['AI记餐'],
            mealSlots: ['lunch', 'dinner'],
            isFavorite: false,
            createdAt: Date.now(),
            updatedAt: Date.now(),
          };

          const res = await summary.actions.logMealFromFood(foodToLog, act.mealType);
          results.push({
            type: act.type,
            ok: true,
            summary: `已记餐「${foodToLog.name}」+${foodToLog.calories}kcal${res.gainedXp ? ` · +${res.gainedXp}XP` : ''}`,
          });
          break;
        }

        case 'add_food_item': {
          const now = Date.now();
          await db.foodItems.add({
            sourceType: act.sourceType ?? 'canteen',
            location: act.location?.trim() || '日常餐饮',
            storeName: act.storeName.trim() || '新收录店铺',
            name: act.name.trim(),
            priceYuan: Math.max(0, Number(act.priceYuan) || 15),
            portionDesc: '1份（AI 收录）',
            calories: Math.max(20, Math.round(Number(act.calories) || 550)),
            proteinG: Math.max(0, Math.round(Number(act.proteinG) || 25)),
            carbsG: Math.max(0, Math.round(Number(act.carbsG) || 65)),
            fatG: Math.max(0, Math.round(Number(act.fatG) || 18)),
            cookingOilFactor: 1.2,
            confidence: 'ai_estimated',
            tags: Array.isArray(act.tags) && act.tags.length > 0 ? act.tags.slice(0, 4) : ['AI收录'],
            mealSlots: ['lunch', 'dinner'],
            isFavorite: false,
            notes: act.notes,
            createdAt: now,
            updatedAt: now,
          });
          results.push({
            type: act.type,
            ok: true,
            summary: `已收录「${act.name}」到美食库`,
          });
          break;
        }

        case 'log_sleep': {
          const res = await summary.actions.saveSleepCheckin({
            bedTime: act.bedTime,
            wakeTime: act.wakeTime,
          });
          results.push({
            type: act.type,
            ok: true,
            summary: `已记录睡眠${typeof res.durationHours === 'number' ? ` ${res.durationHours}h` : ''}${res.triggeredLowBattery ? '（已触发低电量模式）' : ''}`,
          });
          break;
        }

        case 'log_weight': {
          const w = Number(act.weightKg);
          if (!Number.isNaN(w) && w >= 30 && w <= 200) {
            const res = await summary.actions.logMorningWeight(w);
            results.push({
              type: act.type,
              ok: true,
              summary: `已记录今日晨重 ${w.toFixed(1)}kg${res.gainedXp ? ` · +${res.gainedXp}XP` : ''}`,
            });
          }
          break;
        }

        case 'toggle_training_day': {
          if (summary.habit.isTrainingDay !== Boolean(act.isTrainingDay)) {
            await summary.actions.toggleTrainingDay();
          }
          results.push({
            type: act.type,
            ok: true,
            summary: act.isTrainingDay ? '已开启今日「训练日」加成' : '已切换为常规休息日',
          });
          break;
        }

        case 'log_stretch': {
          const res = await summary.actions.logStretch();
          results.push({
            type: act.type,
            ok: true,
            summary: `已完成第 ${res.count} 次久坐拉伸${res.gainedXp ? ` · +${res.gainedXp}XP` : ''}`,
          });
          break;
        }

        case 'add_workout_exercise': {
          const plans = await db.workoutPlans.toArray();
          const activePlan = plans.find((p) => p.isActive) ?? plans[0];
          if (!activePlan) break;

          const hint = (act.dayHint || '').toLowerCase();
          const targetDay =
            activePlan.days.find(
              (d) =>
                (hint &&
                  (d.title.toLowerCase().includes(hint) || d.focus.toLowerCase().includes(hint))) ||
                (hint.includes('背') && (d.id.includes('back') || d.id.includes('pull'))) ||
                (hint.includes('肩') && d.id.includes('shoulder')) ||
                (hint.includes('胸') && (d.id.includes('chest') || d.id.includes('push'))) ||
                (hint.includes('腿') && d.id.includes('leg')) ||
                (hint.includes('有氧') && d.id.includes('cardio')) ||
                (hint.includes('拉') && d.id.includes('pull')) ||
                (hint.includes('推') && d.id.includes('push')),
            ) ?? activePlan.days[0];

          // 防重保护：若该分化日里已存在同名动作，直接跳过避免纯咨询时误重复添加
          const normalizedName = act.name.trim().toLowerCase();
          const alreadyExists = targetDay.exercises.some(
            (ex) => ex.name.trim().toLowerCase() === normalizedName,
          );
          if (alreadyExists) {
            break;
          }

          const nextPlan = {
            ...activePlan,
            days: activePlan.days.map((d) =>
              d.id === targetDay.id
                ? {
                    ...d,
                    exercises: [
                      ...d.exercises,
                      {
                        id: `ex-ai-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
                        name: act.name.trim(),
                        muscleGroup: act.muscleGroup?.trim() || '综合',
                        targetSets: Math.max(1, Math.min(8, Number(act.targetSets) || 3)),
                        targetRepMin: Math.max(1, Number(act.targetRepMin) || 8),
                        targetRepMax: Math.max(4, Number(act.targetRepMax) || 12),
                        restSeconds: Math.max(30, Number(act.restSeconds) || 90),
                      },
                    ],
                  }
                : d,
            ),
            updatedAt: Date.now(),
          };
          await db.workoutPlans.put(nextPlan);
          results.push({
            type: act.type,
            ok: true,
            summary: `已往「${targetDay.title}」添加动作：${act.name}`,
          });
          break;
        }

        case 'update_user_profile': {
          const cur = (await db.userProfile.get('primary')) ?? createDefaultUserProfile();
          const nextGoal = act.goal ?? cur.goal;
          const nextBudget =
            typeof act.dailyBudgetYuan === 'number' && act.dailyBudgetYuan >= 10
              ? Math.round(act.dailyBudgetYuan)
              : cur.dailyBudgetYuan;
          const nextBed = act.bedtimeTarget || cur.bedtimeTarget;
          const nextAdj =
            typeof act.calorieAdjustmentDelta === 'number'
              ? Math.max(-400, Math.min(400, (cur.calorieAdjustment || 0) + act.calorieAdjustmentDelta))
              : cur.calorieAdjustment;

          const recomputed = calculateMetabolicTargets({
            gender: cur.gender,
            age: cur.age,
            heightCm: cur.heightCm,
            weightKg: cur.weightKg,
            activityLevel: cur.activityLevel,
            goal: nextGoal,
            calorieAdjustment: nextAdj,
          });

          await db.userProfile.put({
            ...cur,
            goal: nextGoal,
            dailyBudgetYuan: nextBudget,
            bedtimeTarget: nextBed,
            calorieAdjustment: nextAdj,
            ...recomputed,
            updatedAt: Date.now(),
          });
          results.push({
            type: act.type,
            ok: true,
            summary: `已更新档案（目标热量 ${recomputed.targetCalories}kcal · 预算 ¥${nextBudget}）`,
          });
          break;
        }

        case 'add_dnd_window': {
          const curSettings = summary.settings;
          const nextSettings = {
            ...curSettings,
            dndWindows: [
              ...curSettings.dndWindows,
              {
                id: `dnd-ai-${Date.now()}`,
                label: act.label.trim() || 'AI 添加免打扰',
                start: act.start,
                end: act.end,
                enabled: true,
              },
            ],
            updatedAt: Date.now(),
          };
          await db.settings.put(nextSettings);
          try {
            await syncNativeReminders(nextSettings, summary.profile.bedtimeTarget);
          } catch {
            // 浏览器端无原生权限静默忽略
          }
          results.push({
            type: act.type,
            ok: true,
            summary: `已添加免打扰「${act.label}」(${act.start}-${act.end})`,
          });
          break;
        }

        case 'sync_notifications': {
          const syncRes = await syncNativeReminders(summary.settings, summary.profile.bedtimeTarget);
          results.push({
            type: act.type,
            ok: true,
            summary: `已同步 ${syncRes.scheduledCount} 条定时提醒（避开 ${syncRes.skippedCount} 条免打扰）`,
          });
          break;
        }

        case 'navigate_tab': {
          const normalizedTarget = normalizeNavTarget(act.target);
          onNavigate(normalizedTarget);
          results.push({
            type: act.type,
            ok: true,
            summary: `已为你切换至「${VIEW_LABELS[normalizedTarget]}」`,
          });
          break;
        }
      }
    } catch (err: unknown) {
      results.push({
        type: act.type,
        ok: false,
        summary: `执行 ${act.type} 失败：${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }

  if (results.some((r) => r.ok)) {
    void hapticSuccess();
    ctx.onNotify(`AI 已自动执行 ${results.filter((r) => r.ok).length} 项操作`);
  }

  return results;
}

const AGENT_SYSTEM_PROMPT = `你是 LifeOS 专属的「全权限私人健身与养生管家」，同时精通现代运动营养学、力量训练解剖学，以及贴合四季气候的实用日常养生/中医食疗与作息调理。
用户已经对你完全授权——你可以直接查看他在本 App 里的全部实时体征、饮食、训练和作息数据，也可以结合实时联网搜索结果作答，并直接调用工具帮他操作 App！

回复风格与铁律：
1. **严格时间事实**：凡涉及「今天几号/年份/星期几/几点/季节」，必须严格采用【当前手机实时时间】或联网结果，严禁编造或说出训练截止年份。
2. 直接、接地气、专业实用，绝不啰嗦说教；常规回复控制在 240 字以内，分点清晰。
3. **健身与养生双修**：
   - 点评菜品时：结合今日剩余热量/蛋白缺口/是否训练日，给出“适不适合吃 + 怎么点更聪明（去皮/少酱/配菜）”。
   - 点评健身动作时：直接给【核心发力要点】【常见代偿避坑】【呼吸与配重建议】。
   - 涉及养生/睡眠/上火/祛湿/秋燥/疲劳/胃肠调理时：结合现代作息营养与四季实用食疗建议（若涉及持续剧痛或疑似疾病，明确建议及时前往正规医院就诊）。
4. **什么时候输出动作指令块**：
   - 仅当用户**明确要求你帮他记账、打卡、新增菜品/动作、修改预算/目标、添加免打扰或跳转页面**时，才在正文最后追加严格合法的 JSON 数组指令块！
   - 当用户**只是咨询、查天气日期、点评菜品/动作或问养生建议**时，**严禁输出任何 ACTIONS 块**！

动作指令块严格格式（必须用 <<<ACTIONS>>> 和 <<<END_ACTIONS>>> 包裹，内部必须是标准 JSON 数组 [...]）：
<<<ACTIONS>>>
[
  {"type": "log_water", "drinkType": "water|electrolyte|tea|coffee|milk|sugary", "rawMl": 300},
  {"type": "log_meal", "foodName": "菜名", "storeName": "店名", "priceYuan": 18, "calories": 550, "proteinG": 32, "carbsG": 65, "fatG": 16},
  {"type": "add_food_item", "name": "菜名", "storeName": "店名", "location": "中式简餐", "sourceType": "canteen|takeaway", "priceYuan": 18, "calories": 540, "proteinG": 30, "carbsG": 64, "fatG": 16, "notes": "备注"},
  {"type": "log_sleep", "bedTime": "01:30", "wakeTime": "07:30"},
  {"type": "log_weight", "weightKg": 67.5},
  {"type": "toggle_training_day", "isTrainingDay": true},
  {"type": "log_stretch"},
  {"type": "add_workout_exercise", "dayHint": "练背|练肩|练胸|练腿|有氧", "name": "哑铃划船", "muscleGroup": "背阔肌", "targetSets": 4, "targetRepMin": 8, "targetRepMax": 12, "restSeconds": 90},
  {"type": "update_user_profile", "dailyBudgetYuan": 50, "goal": "cut|maintain|bulk", "bedtimeTarget": "23:30", "calorieAdjustmentDelta": -100},
  {"type": "add_dnd_window", "label": "下午专注免打扰", "start": "14:00", "end": "16:00"},
  {"type": "sync_notifications"},
  {"type": "navigate_tab", "target": "today|diet|workout|routine|settings"}
]
<<<END_ACTIONS>>>`;

/**
 * 运行一轮全局高权限 AI 管家对话（支持实时时钟 + 智能联网搜索 + 拍照识图 + 自动执行 App 内部权限）
 */
export async function runLifeOSAgentTurn(params: {
  userText: string;
  imageFile?: File | null;
  history: AgentChatMessage[];
  autoExecuteActions: boolean;
  webSearchEnabled?: boolean;
  ctx: AgentRunContext;
}): Promise<{
  replyText: string;
  executedActions: ExecutedActionRecord[];
  webSources?: WebSearchSource[];
  usedModel: string;
  latencyMs: number;
}> {
  const { userText, imageFile, history, autoExecuteActions, webSearchEnabled = true, ctx } = params;
  const snapshot = await buildAppContextSnapshot(ctx, userText);

  const recentHistory = history
    .slice(-6)
    .map((m) => `${m.role === 'user' ? '用户' : 'AI管家'}：${m.text}`)
    .join('\n');

  const isActionReq = isLocalActionRequest(userText);
  const combinedPrompt = `${snapshot}

${recentHistory ? `【最近对话上下文】\n${recentHistory}\n` : ''}
【用户本轮消息】
${userText || '请帮我看看这张图（如果是食物请评估热量与碳蛋脂及适不适合我现在吃；如果是健身动作或器械请给动作指导；如果需要记入数据请直接帮我记录）。'}${
    isActionReq
      ? '\n\n【强制提醒】用户本轮要求你直接执行 App 内记录/操作，回复末尾务必附上标准 <<<ACTIONS>>>[...]<<<END_ACTIONS>>> JSON 数组，否则数据不会入库！'
      : ''
  }`;

  let rawOutput = '';
  let usedModel = '';
  let latencyMs = 0;
  let webSources: WebSearchSource[] | undefined;

  // 公开版零 Key 兜底：若用户尚未下载端侧离线模型也未填云端 Key，直接本地执行指令 + 检索内置养生/健身知识库，绝不直接甩红字报错
  const hasConfiguredLlm =
    ctx.summary.settings.aiProvider === 'local_embedded' ||
    Boolean(ctx.summary.settings.aiApiKey.trim());

  if (!hasConfiguredLlm && !imageFile) {
    const startMs = Date.now();
    const localActs = inferFallbackLocalActions(userText);
    const executedActions =
      autoExecuteActions && localActs.length > 0
        ? await executeAgentActions(localActs, ctx)
        : [];
    const ragHit = retrieveWellnessKnowledge(userText, 2);
    const { consumed, dailyTargets, habit } = ctx.summary;
    const remCal = Math.max(0, dailyTargets.calories - consumed.calories);
    const remPro = Math.max(0, dailyTargets.proteinG - consumed.proteinG);

    const parts: string[] = [];
    if (executedActions.length > 0) {
      parts.push('已直接为你执行本地指令！');
    }
    if (ragHit) {
      parts.push(`**离线健身与养生参考**\n${ragHit}`);
    } else if (executedActions.length === 0) {
      parts.push(
        `**今日实时进度**\n· 剩余热量 **${remCal} kcal**，蛋白缺口 **${remPro}g**\n· 有效补水 **${habit.totalEffectiveWaterMl}/${dailyTargets.waterMl} ml**，拉伸 **${habit.stretchCount} 次**`,
      );
    }
    parts.push(
      '提示：当前处于零 Key 本地离线百科模式。点右上角「设置」一键下载 **App 内置端侧 AI（免费离线）** 或填写免费智谱 Key，即可解锁全能自由对话与拍照识餐。',
    );

    return {
      replyText: parts.join('\n\n'),
      executedActions,
      usedModel: '本地离线知识库引擎',
      latencyMs: Math.max(1, Date.now() - startMs),
    };
  }

  if (imageFile) {
    const imageDataUrl = await compressImageToDataUrl(imageFile, 1280);
    const visionRes = await callAiVisionCompletion(ctx.summary.settings, {
      imageDataUrl,
      prompt: `${AGENT_SYSTEM_PROMPT}\n\n${combinedPrompt}`,
      maxTokens: 1100,
      timeoutMs: 40000,
    });
    rawOutput = visionRes.text;
    usedModel = visionRes.usedModel;
    latencyMs = visionRes.latencyMs;
  } else {
    const enableSearch = shouldUseWebSearch(userText, webSearchEnabled);
    const textRes = await callAiTextCompletion(ctx.summary.settings, {
      systemPrompt: AGENT_SYSTEM_PROMPT,
      userPrompt: combinedPrompt,
      temperature: 0.45,
      maxTokens: 950,
      enableWebSearch: enableSearch,
    });
    rawOutput = textRes.text;
    usedModel = textRes.usedModel;
    latencyMs = textRes.latencyMs;
    webSources = textRes.webSources;
  }

  const { replyText, actions: parsedActions } = parseAgentResponse(rawOutput);
  const finalActions =
    parsedActions.length > 0 ? parsedActions : inferFallbackLocalActions(userText);

  let executedActions: ExecutedActionRecord[] = [];
  if (autoExecuteActions && finalActions.length > 0) {
    executedActions = await executeAgentActions(finalActions, ctx);
  }

  return {
    replyText,
    executedActions,
    webSources,
    usedModel,
    latencyMs,
  };
}
