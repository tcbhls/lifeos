import type { ActivityLevel, DrinkType, FitnessGoal, Gender, UserProfile } from '../types/models';

/** 活动水平系数映射（面向日常办公/学习与健身人群标定） */
export const ACTIVITY_MULTIPLIERS: Record<
  ActivityLevel,
  { factor: number; label: string; desc: string }
> = {
  sedentary: {
    factor: 1.2,
    label: '久坐办公',
    desc: '基本在工位/室内久坐，很少运动',
  },
  light: {
    factor: 1.375,
    label: '轻度活跃',
    desc: '日常通勤步行 + 每周训练 1~2 次',
  },
  moderate: {
    factor: 1.55,
    label: '规律训练',
    desc: '每周健身房/跑步/球类 3~5 次',
  },
  active: {
    factor: 1.725,
    label: '高强度训练',
    desc: '每周高强度分化训练 6~7 次',
  },
  very_active: {
    factor: 1.9,
    label: '专业竞技级',
    desc: '每日双练或高消耗体能训练',
  },
};

/** 健身目标对应的热量差与宏量营养分配策略 */
export const FITNESS_GOALS: Record<
  FitnessGoal,
  {
    label: string;
    calorieDelta: number;
    proteinPerKg: number;
    fatPerKg: number;
    hint: string;
  }
> = {
  cut: {
    label: '科学减脂',
    calorieDelta: -350,
    proteinPerKg: 2.0,
    fatPerKg: 0.75,
    hint: '每日制造约 350 kcal 温和缺口，高蛋白保肌',
  },
  maintain: {
    label: '维持塑形',
    calorieDelta: 0,
    proteinPerKg: 1.7,
    fatPerKg: 0.85,
    hint: '热量收支平衡，精力充沛兼顾体脂控制',
  },
  bulk: {
    label: '干净增肌',
    calorieDelta: 280,
    proteinPerKg: 1.9,
    fatPerKg: 0.9,
    hint: '每日盈余约 280 kcal，稳步涨维度少囤脂',
  },
};

/** 饮品补水折算系数表（参考临床水合指数 BHI 简化） */
export const DRINK_OPTIONS: Array<{
  type: DrinkType;
  label: string;
  shortLabel: string;
  factor: number;
  defaultMl: number;
  accentClass: string;
}> = [
  {
    type: 'water',
    label: '白开水 / 矿泉水',
    shortLabel: '纯水',
    factor: 1.0,
    defaultMl: 250,
    accentClass: 'text-sky-500',
  },
  {
    type: 'electrolyte',
    label: '电解质水',
    shortLabel: '电解质',
    factor: 1.1,
    defaultMl: 350,
    accentClass: 'text-emerald-500',
  },
  {
    type: 'tea',
    label: '无糖茶饮',
    shortLabel: '无糖茶',
    factor: 0.9,
    defaultMl: 300,
    accentClass: 'text-teal-500',
  },
  {
    type: 'coffee',
    label: '美式 / 黑咖啡',
    shortLabel: '黑咖',
    factor: 0.8,
    defaultMl: 250,
    accentClass: 'text-amber-600 dark:text-amber-400',
  },
  {
    type: 'milk',
    label: '纯牛奶 / 豆浆',
    shortLabel: '牛奶',
    factor: 1.05,
    defaultMl: 250,
    accentClass: 'text-indigo-500',
  },
  {
    type: 'sugary',
    label: '奶茶 / 含糖饮料',
    shortLabel: '含糖饮',
    factor: 0.7,
    defaultMl: 300,
    accentClass: 'text-rose-500',
  },
];

export interface MetabolicResult {
  bmr: number;
  tdee: number;
  targetCalories: number;
  targetProteinG: number;
  targetCarbsG: number;
  targetFatG: number;
  targetWaterMl: number;
}

/**
 * 使用 Mifflin-St Jeor 公式计算 BMR、TDEE、碳蛋脂目标和基础饮水目标
 */
export function calculateMetabolicTargets(params: {
  gender: Gender;
  age: number;
  heightCm: number;
  weightKg: number;
  activityLevel: ActivityLevel;
  goal: FitnessGoal;
  calorieAdjustment?: number;
}): MetabolicResult {
  const { gender, age, heightCm, weightKg, activityLevel, goal, calorieAdjustment = 0 } = params;

  const safeWeight = Math.max(35, Math.min(200, weightKg || 65));
  const safeHeight = Math.max(130, Math.min(220, heightCm || 175));
  const safeAge = Math.max(15, Math.min(80, age || 20));

  // Mifflin-St Jeor 基础代谢公式
  const rawBmr =
    10 * safeWeight + 6.25 * safeHeight - 5 * safeAge + (gender === 'male' ? 5 : -161);
  const bmr = Math.round(rawBmr);

  const multiplier = ACTIVITY_MULTIPLIERS[activityLevel].factor;
  const tdee = Math.round(bmr * multiplier);

  const goalRule = FITNESS_GOALS[goal];
  // 设置安全底线：不低于基础代谢的 95%（防止过度节食损伤代谢）
  const minSafeCalories = Math.max(1200, Math.round(bmr * 0.95));
  const targetCalories = Math.max(
    minSafeCalories,
    Math.round(tdee + goalRule.calorieDelta + calorieAdjustment),
  );

  // 蛋白质(4 kcal/g) 与脂肪(9 kcal/g) 按体重优先分配，剩余热量全部配给碳水(4 kcal/g)
  const targetProteinG = Math.round(safeWeight * goalRule.proteinPerKg);
  const targetFatG = Math.round(safeWeight * goalRule.fatPerKg);
  const remainingKcal = Math.max(200, targetCalories - targetProteinG * 4 - targetFatG * 9);
  const targetCarbsG = Math.round(remainingKcal / 4);

  // 基础有效饮水目标：体重(kg) × 35 ml，下限 1800 ml，向上取整至 50 ml
  const targetWaterMl = Math.max(1800, Math.ceil((safeWeight * 35) / 50) * 50);

  return {
    bmr,
    tdee,
    targetCalories,
    targetProteinG,
    targetCarbsG,
    targetFatG,
    targetWaterMl,
  };
}

/**
 * 计算当日动态生效目标（训练日自动联动增加碳水与饮水，低电量模式给出温和提示）
 */
export function getEffectiveDailyTargets(
  profile: UserProfile,
  isTrainingDay: boolean,
): {
  calories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  waterMl: number;
} {
  const extraCarbs = isTrainingDay ? profile.trainingDayExtraCarbsG : 0;
  const extraWater = isTrainingDay ? profile.trainingDayExtraWaterMl : 0;
  return {
    calories: profile.targetCalories + extraCarbs * 4,
    proteinG: profile.targetProteinG,
    carbsG: profile.targetCarbsG + extraCarbs,
    fatG: profile.targetFatG,
    waterMl: profile.targetWaterMl + extraWater,
  };
}
