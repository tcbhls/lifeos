import Dexie, { type EntityTable } from 'dexie';
import { buildDefaultFiveDaySplitPlan } from '../data/exerciseLibrary';
import { DEFAULT_CENTER_LNGLAT } from '../lib/amap';
import { calculateMetabolicTargets } from '../lib/nutrition';
import type {
  FoodItem,
  HabitLog,
  MealLog,
  Settings,
  UserProfile,
  WorkoutLog,
  WorkoutPlan,
} from '../types/models';
import { UNIVERSAL_SEED_FOODS } from './seeds/universalFoodSeed';

/** 可选构建期环境变量（公开大众发布版留空，由用户在设备本地自行配置或使用内置离线 AI） */
const ENV_DEFAULT_ZHIPU_KEY: string =
  (import.meta.env.VITE_DEFAULT_ZHIPU_KEY as string | undefined)?.trim() || '';
const ENV_DEFAULT_AMAP_KEY: string =
  (import.meta.env.VITE_DEFAULT_AMAP_KEY as string | undefined)?.trim() || '';

/**
 * LifeOS 纯本地 IndexedDB 数据库（基于 Dexie.js）
 * 所有数据 100% 存储在用户自己的手机/浏览器本地，无任何中心服务器采集
 */
class LifeOSDatabase extends Dexie {
  userProfile!: EntityTable<UserProfile, 'id'>;
  foodItems!: EntityTable<FoodItem, 'id'>;
  mealLogs!: EntityTable<MealLog, 'id'>;
  workoutPlans!: EntityTable<WorkoutPlan, 'id'>;
  workoutLogs!: EntityTable<WorkoutLog, 'id'>;
  habitLogs!: EntityTable<HabitLog, 'date'>;
  settings!: EntityTable<Settings, 'id'>;

  constructor() {
    super('LifeOSDB');

    this.version(1).stores({
      userProfile: 'id',
      foodItems: '++id, sourceType, location, storeName, name, *tags, isFavorite',
      mealLogs: '++id, date, mealType, foodItemId, [date+mealType]',
      workoutPlans: '++id, name, isActive',
      workoutLogs: '++id, date, planId, completed',
      habitLogs: 'date',
      settings: 'id',
    });
  }
}

export const db = new LifeOSDatabase();

/** 生成通用默认用户身体档案（可随时在新手引导或设置页修改） */
export function createDefaultUserProfile(): UserProfile {
  const base = {
    gender: 'male' as const,
    age: 24,
    heightCm: 175,
    weightKg: 68,
    activityLevel: 'moderate' as const,
    goal: 'cut' as const,
    calorieAdjustment: 0,
  };
  const computed = calculateMetabolicTargets(base);

  return {
    id: 'primary',
    nickname: '自律探索者',
    campus: '上海市',
    ...base,
    targetWeightKg: 64,
    dailyBudgetYuan: 50,
    ...computed,
    trainingDayExtraCarbsG: 45,
    trainingDayExtraWaterMl: 500,
    bedtimeTarget: '23:30',
    wakeTarget: '07:30',
    updatedAt: Date.now(),
  };
}

/**
 * 生成公开大众版默认应用设置（零内置个人隐私密钥，默认支持端侧离线 AI 与 BYOK 免费云端 AI）
 */
export function createDefaultSettings(): Settings {
  return {
    id: 'app_settings',
    theme: 'dark',
    aiProvider: 'openai_compatible',
    aiBaseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    aiApiKey: ENV_DEFAULT_ZHIPU_KEY,
    aiModel: 'glm-4-flash-250414',
    amapWebKey: ENV_DEFAULT_AMAP_KEY,
    amapCenterLngLat: DEFAULT_CENTER_LNGLAT,
    notificationsEnabled: true,
    waterReminderIntervalMin: 90,
    stretchReminderIntervalMin: 60,
    onboardingCompleted: false,
    dndWindows: [
      {
        id: 'dnd-focus-morning',
        label: '上午专注/工作免打扰',
        start: '09:00',
        end: '11:30',
        enabled: true,
      },
      {
        id: 'dnd-evening-relax',
        label: '晚间休息/娱乐免打扰',
        start: '20:00',
        end: '22:00',
        enabled: false,
      },
    ],
    updatedAt: Date.now(),
  };
}

/** 清空本机全部个人记录并重置为全新出厂状态（用户隐私一键抹除） */
export async function resetAllLocalData(): Promise<void> {
  await db.transaction(
    'rw',
    [
      db.userProfile,
      db.foodItems,
      db.mealLogs,
      db.workoutPlans,
      db.workoutLogs,
      db.habitLogs,
      db.settings,
    ],
    async () => {
      await Promise.all([
        db.userProfile.clear(),
        db.foodItems.clear(),
        db.mealLogs.clear(),
        db.workoutPlans.clear(),
        db.workoutLogs.clear(),
        db.habitLogs.clear(),
        db.settings.clear(),
      ]);
      await db.userProfile.put(createDefaultUserProfile());
      await db.settings.put(createDefaultSettings());
      await db.foodItems.bulkAdd(UNIVERSAL_SEED_FOODS);
      await db.workoutPlans.add(buildDefaultFiveDaySplitPlan());
    },
  );
  try {
    localStorage.removeItem('lifeos_amap_weather_cache_v2');
    localStorage.removeItem('lifeos_amap_weather_cache_v1');
    localStorage.removeItem('lifeos_custom_exercise_bvs_v1');
  } catch {
    // 忽略本地存储清理异常
  }
}

/**
 * 首次启动或版本升级时幂等初始化与增量补全
 */
let initPromise: Promise<void> | null = null;

export function ensureDatabaseSeeded(): Promise<void> {
  if (initPromise) return initPromise;

  initPromise = db.transaction(
    'rw',
    [db.userProfile, db.settings, db.foodItems, db.workoutPlans],
    async () => {
      const existingProfile = await db.userProfile.get('primary');
      if (!existingProfile) {
        await db.userProfile.put(createDefaultUserProfile());
      }

      const existingSettings = await db.settings.get('app_settings');
      if (!existingSettings) {
        await db.settings.put(createDefaultSettings());
      } else {
        const needInjectKey = !existingSettings.aiApiKey.trim() && Boolean(ENV_DEFAULT_ZHIPU_KEY);
        const needInjectAmapKey = !existingSettings.amapWebKey.trim() && Boolean(ENV_DEFAULT_AMAP_KEY);
        const needStabilizeZhipuModel =
          existingSettings.aiBaseUrl.includes('open.bigmodel.cn') &&
          existingSettings.aiModel === 'glm-4.7-flash';

        if (needInjectKey || needInjectAmapKey || needStabilizeZhipuModel) {
          await db.settings.put({
            ...existingSettings,
            aiProvider: needInjectKey ? 'openai_compatible' : existingSettings.aiProvider,
            aiBaseUrl: needInjectKey
              ? 'https://open.bigmodel.cn/api/paas/v4'
              : existingSettings.aiBaseUrl,
            aiApiKey: needInjectKey ? ENV_DEFAULT_ZHIPU_KEY : existingSettings.aiApiKey,
            amapWebKey: needInjectAmapKey ? ENV_DEFAULT_AMAP_KEY : existingSettings.amapWebKey,
            aiModel:
              needInjectKey || needStabilizeZhipuModel
                ? 'glm-4-flash-250414'
                : existingSettings.aiModel,
            updatedAt: Date.now(),
          });
        }
      }

      // 按 (storeName + name) 增量补全全国通用餐饮库，不覆写用户自建数据
      const existingFoods = await db.foodItems.toArray();
      const existingKeySet = new Set(existingFoods.map((f) => `${f.storeName}::${f.name}`));
      const missingFoods = UNIVERSAL_SEED_FOODS.filter(
        (seed) => !existingKeySet.has(`${seed.storeName}::${seed.name}`),
      );
      if (missingFoods.length > 0) {
        await db.foodItems.bulkAdd(missingFoods);
      }

      const existingPlans = await db.workoutPlans.toArray();
      if (existingPlans.length === 0) {
        await db.workoutPlans.add(buildDefaultFiveDaySplitPlan());
      } else {
        const firstPlan = existingPlans[0];
        if (firstPlan?.id !== undefined && firstPlan.name === '推拉腿三分化 (PPL)') {
          await db.workoutPlans.put({
            ...buildDefaultFiveDaySplitPlan(),
            id: firstPlan.id,
          });
        }
      }
    },
  );

  return initPromise;
}
