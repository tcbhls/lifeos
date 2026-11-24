/**
 * LifeOS 核心本地数据模型定义
 * 对应 IndexedDB (Dexie.js) 中的 7 张表：
 * UserProfile, FoodItem, MealLog, WorkoutPlan, WorkoutLog, HabitLog, Settings
 */

export type Gender = 'male' | 'female';
export type ActivityLevel = 'sedentary' | 'light' | 'moderate' | 'active' | 'very_active';
export type FitnessGoal = 'cut' | 'maintain' | 'bulk';
export type ThemeMode = 'system' | 'dark' | 'light';
export type AiProvider = 'openai_compatible' | 'gemini' | 'local_embedded';
export type MealSlot = 'breakfast' | 'lunch' | 'dinner' | 'snack';

/** 1. 用户身体档案与自动计算的营养/饮水目标 */
export interface UserProfile {
  id: 'primary';
  nickname: string;
  campus: string;
  gender: Gender;
  age: number;
  heightCm: number;
  weightKg: number;
  targetWeightKg: number;
  activityLevel: ActivityLevel;
  goal: FitnessGoal;
  dailyBudgetYuan: number;
  /** Mifflin-St Jeor 基础代谢率 */
  bmr: number;
  /** 每日总能量消耗 */
  tdee: number;
  /** 每日目标热量（含 goal 差值与周趋势微调） */
  targetCalories: number;
  /** Phase 2 每周体重趋势自动动态微调偏移（kcal） */
  calorieAdjustment: number;
  targetProteinG: number;
  targetCarbsG: number;
  targetFatG: number;
  /** 基础每日有效补水目标（ml） */
  targetWaterMl: number;
  /** 训练日额外碳水加成（g） */
  trainingDayExtraCarbsG: number;
  /** 训练日额外饮水加成（ml） */
  trainingDayExtraWaterMl: number;
  /** 目标入睡时间 HH:mm */
  bedtimeTarget: string;
  /** 目标起床时间 HH:mm */
  wakeTarget: string;
  updatedAt: number;
}

/** 2. 饮食营养库条目（来源：中式简餐/食堂 / 外卖连锁 / 自定义） */
export type FoodSourceType = 'canteen' | 'takeaway' | 'custom';

export interface FoodItem {
  id?: number;
  sourceType: FoodSourceType;
  /** 如：中式简餐、轻食健身餐、全国连锁快餐、便利店补给 */
  location: string;
  /** 窗口名或店铺名 */
  storeName: string;
  name: string;
  priceYuan: number;
  portionDesc: string;
  calories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  /** 烹饪吸油修正系数（清蒸水煮 1.0 ~ 重油干锅 1.4） */
  cookingOilFactor: number;
  confidence: 'verified' | 'ai_estimated' | 'manual';
  tags: string[];
  mealSlots: MealSlot[];
  isFavorite: boolean;
  notes?: string;
  createdAt: number;
  updatedAt: number;
}

/** 3. 每日饮食流水记录 */
export interface MealLog {
  id?: number;
  /** 自然日 YYYY-MM-DD */
  date: string;
  mealType: MealSlot;
  foodItemId?: number;
  foodName: string;
  storeName: string;
  servings: number;
  priceYuan: number;
  calories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  createdAt: number;
}

/** 4. 自定义训练分化模板 */
export interface WorkoutPlanExercise {
  id: string;
  name: string;
  muscleGroup: string;
  targetSets: number;
  targetRepMin: number;
  targetRepMax: number;
  restSeconds: number;
}

export interface WorkoutPlanDay {
  id: string;
  title: string;
  focus: string;
  exercises: WorkoutPlanExercise[];
}

export interface WorkoutPlan {
  id?: number;
  name: string;
  splitType: 'ppl' | 'upper_lower' | 'full_body' | 'custom';
  days: WorkoutPlanDay[];
  isActive: boolean;
  updatedAt: number;
}

/** 5. 每日训练执行日志 */
export interface ExerciseSetLog {
  weightKg: number;
  reps: number;
  rpe?: number;
  completed: boolean;
}

export interface ExerciseLogEntry {
  exerciseName: string;
  muscleGroup: string;
  sets: ExerciseSetLog[];
}

export interface WorkoutLog {
  id?: number;
  date: string;
  planId?: number;
  dayName: string;
  isTrainingDay: boolean;
  durationMin: number;
  exercises: ExerciseLogEntry[];
  totalVolumeKg: number;
  completed: boolean;
  notes?: string;
  createdAt: number;
}

/** 饮品类型与补水系数 */
export type DrinkType = 'water' | 'electrolyte' | 'tea' | 'coffee' | 'milk' | 'sugary';

export interface WaterEntry {
  id: string;
  timestamp: number;
  drinkType: DrinkType;
  label: string;
  /** 实际摄入体积 ml */
  rawMl: number;
  /** 补水折算系数 */
  hydrationFactor: number;
  /** 折算后有效补水量 ml */
  effectiveMl: number;
}

/** 6. 每日喝水、作息、晨重与 RPG 经验聚合日志 */
export interface HabitLog {
  /** 自然日主键 YYYY-MM-DD */
  date: string;
  waterEntries: WaterEntry[];
  totalRawWaterMl: number;
  totalEffectiveWaterMl: number;
  /** 昨晚入睡时间（HH:mm） */
  sleepBedTime?: string;
  /** 今日起床时间（HH:mm） */
  sleepWakeTime?: string;
  /** 自动计算睡眠时长（小时），小于 6.5h 触发低电量恢复模式 */
  sleepDurationHours?: number;
  sleepQuality?: 1 | 2 | 3 | 4 | 5;
  /** 晨起空腹体重（kg），用于 Phase 2 周趋势动态调整热量 */
  morningWeightKg?: number;
  /** 是否为训练日（联动增加饮食碳水与饮水目标） */
  isTrainingDay: boolean;
  /** 久坐拉伸完成次数 */
  stretchCount: number;
  /** 当日获得的 RPG 经验值 */
  xpEarned: number;
  /** 当日已结算的日常任务 ID 列表 */
  completedQuests: string[];
  updatedAt: number;
}

/** 免打扰时段（课表/开黑游戏） */
export interface DndWindow {
  id: string;
  label: string;
  start: string;
  end: string;
  enabled: boolean;
}

/** 7. 全局应用设置（主题、BYOK AI、高德 API、本地通知免打扰） */
export interface Settings {
  id: 'app_settings';
  theme: ThemeMode;
  aiProvider: AiProvider;
  aiBaseUrl: string;
  aiApiKey: string;
  aiModel: string;
  /** 可选高德地图 Web 服务 Key */
  amapWebKey: string;
  /** 用户所在城市或定位中心经纬度 */
  amapCenterLngLat: string;
  notificationsEnabled: boolean;
  waterReminderIntervalMin: number;
  stretchReminderIntervalMin: number;
  dndWindows: DndWindow[];
  /** 是否已完成首次新手教程（未完成则启动自动进入手把手教程模式） */
  onboardingCompleted?: boolean;
  updatedAt: number;
}

/** 全库 JSON 导出备份格式 */
export interface LifeOSBackupPayload {
  app: 'LifeOS';
  schemaVersion: number;
  exportedAt: string;
  data: {
    userProfile: UserProfile[];
    foodItems: FoodItem[];
    mealLogs: MealLog[];
    workoutPlans: WorkoutPlan[];
    workoutLogs: WorkoutLog[];
    habitLogs: HabitLog[];
    settings: Settings[];
  };
}
