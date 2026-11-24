import type { FoodItem, MealSlot } from '../types/models';

export interface DailyMealPlan {
  breakfast: FoodItem | null;
  lunch: FoodItem | null;
  dinner: FoodItem | null;
  totalPrice: number;
  totalCalories: number;
  totalProteinG: number;
  totalCarbsG: number;
  totalFatG: number;
}

/** 挑选最贴近单餐目标热量、蛋白与预算的候选菜品（支持跳过指定菜品实现「换一换」） */
function pickSlotFood(params: {
  pool: FoodItem[];
  slot: MealSlot;
  targetCal: number;
  targetBudget: number;
  preferHighCarb: boolean;
  excludeKeys: Set<string>;
  randomJitter?: boolean;
}): FoodItem | null {
  const { pool, slot, targetCal, targetBudget, preferHighCarb, excludeKeys, randomJitter } = params;

  let slotPool = pool.filter(
    (f) =>
      !excludeKeys.has(`${f.storeName}::${f.name}`) &&
      (f.mealSlots.includes(slot) || (slot !== 'breakfast' && f.calories >= 380)),
  );
  // 若连续点击「换一换」导致排除后候选为空，自动放开排除项兜底循环，避免出现空白餐位
  if (slotPool.length === 0) {
    slotPool = pool.filter(
      (f) => f.mealSlots.includes(slot) || (slot !== 'breakfast' && f.calories >= 380),
    );
  }
  if (slotPool.length === 0) return null;

  const scored = slotPool
    .map((f) => {
      let score = 60;
      score += Math.min(28, f.proteinG * 0.75);
      if (preferHighCarb) score += Math.min(16, f.carbsG * 0.2);

      // 热量接近度
      score -= Math.min(35, Math.abs(f.calories - targetCal) / 14);
      // 预算控制
      if (f.priceYuan <= targetBudget) score += 16;
      else score -= Math.min(25, (f.priceYuan - targetBudget) * 2.2);

      // 优先健康度较好的常规餐，但不彻底排斥快餐聪明吃
      if (f.cookingOilFactor <= 1.2) score += 10;
      if (f.tags.includes('放纵餐')) score -= 18;
      if (randomJitter) score += Math.random() * 14;

      return { f, score };
    })
    .sort((a, b) => b.score - a.score);

  return scored[0]?.f ?? null;
}

/**
 * 智能生成今日早 / 中 / 晚三餐组合（结合预算、训练日状态、每日目标热量）
 */
export function generateSmartDailyPlan(params: {
  foods: FoodItem[];
  dailyBudgetYuan: number;
  targetCalories: number;
  isTrainingDay: boolean;
  locked?: Partial<Record<'breakfast' | 'lunch' | 'dinner', FoodItem | null>>;
  excludeKeys?: Set<string>;
  randomJitter?: boolean;
}): DailyMealPlan {
  const {
    foods,
    dailyBudgetYuan,
    targetCalories,
    isTrainingDay,
    locked = {},
    excludeKeys = new Set<string>(),
    randomJitter = false,
  } = params;

  const used = new Set<string>(excludeKeys);

  const bBudget = Math.max(7, dailyBudgetYuan * 0.22);
  const lBudget = Math.max(12, dailyBudgetYuan * 0.42);
  const dBudget = Math.max(12, dailyBudgetYuan * 0.38);

  const bCal = Math.round(targetCalories * 0.24);
  const lCal = Math.round(targetCalories * 0.4);
  const dCal = Math.round(targetCalories * 0.36);

  const breakfast =
    locked.breakfast !== undefined
      ? locked.breakfast
      : pickSlotFood({
          pool: foods,
          slot: 'breakfast',
          targetCal: bCal,
          targetBudget: bBudget,
          preferHighCarb: isTrainingDay,
          excludeKeys: used,
          randomJitter,
        });
  if (breakfast) used.add(`${breakfast.storeName}::${breakfast.name}`);

  const lunch =
    locked.lunch !== undefined
      ? locked.lunch
      : pickSlotFood({
          pool: foods,
          slot: 'lunch',
          targetCal: lCal,
          targetBudget: lBudget,
          preferHighCarb: isTrainingDay,
          excludeKeys: used,
          randomJitter,
        });
  if (lunch) used.add(`${lunch.storeName}::${lunch.name}`);

  const dinner =
    locked.dinner !== undefined
      ? locked.dinner
      : pickSlotFood({
          pool: foods,
          slot: 'dinner',
          targetCal: dCal,
          targetBudget: dBudget,
          preferHighCarb: false,
          excludeKeys: used,
          randomJitter,
        });

  const meals = [breakfast, lunch, dinner].filter(Boolean) as FoodItem[];

  return {
    breakfast,
    lunch,
    dinner,
    totalPrice: Math.round(meals.reduce((s, m) => s + m.priceYuan, 0) * 10) / 10,
    totalCalories: meals.reduce((s, m) => s + m.calories, 0),
    totalProteinG: meals.reduce((s, m) => s + m.proteinG, 0),
    totalCarbsG: meals.reduce((s, m) => s + m.carbsG, 0),
    totalFatG: meals.reduce((s, m) => s + m.fatG, 0),
  };
}
