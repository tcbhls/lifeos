import { useCallback, useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { createDefaultSettings, createDefaultUserProfile, db } from '../db/database';
import { getCachedTheme } from './useTheme';
import { calcSleepDurationHours, getLocalDateKey } from '../lib/date';
import { hapticLight, hapticSuccess } from '../lib/native';
import { calculateMetabolicTargets, DRINK_OPTIONS, getEffectiveDailyTargets } from '../lib/nutrition';
import {
  buildHeatmapCells,
  calculateRpgLevel,
  calculateStreakDays,
  DAILY_QUEST_REWARDS,
  isLowBatterySleep,
} from '../lib/rpg';
import { analyzeWeightTrend } from '../lib/weightTrend';
import type {
  DrinkType,
  ExerciseLogEntry,
  FoodItem,
  HabitLog,
  MealSlot,
  WaterEntry,
} from '../types/models';

/** 生成空自然日 HabitLog */
function createEmptyHabitLog(date: string): HabitLog {
  return {
    date,
    waterEntries: [],
    totalRawWaterMl: 0,
    totalEffectiveWaterMl: 0,
    isTrainingDay: false,
    stretchCount: 0,
    xpEarned: 0,
    completedQuests: [],
    updatedAt: Date.now(),
  };
}

/**
 * 今日核心状态与全模块联动动作 Hook（全响应式直连 IndexedDB）
 */
export function useTodaySummary() {
  // 自动跟踪跨午夜日期切换（App 隔夜挂后台回前台时自动切到新自然日，避免把今天早餐记到昨天）
  const [todayKey, setTodayKey] = useState(() => getLocalDateKey());

  useEffect(() => {
    const syncDate = () => {
      const next = getLocalDateKey();
      setTodayKey((prev) => (prev === next ? prev : next));
    };
    const timer = window.setInterval(syncDate, 60_000);
    const onVisibility = () => {
      if (document.visibilityState === 'visible') syncDate();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  const profile = useLiveQuery(() => db.userProfile.get('primary'), []);
  const settings = useLiveQuery(() => db.settings.get('app_settings'), []);
  const todayHabit = useLiveQuery(() => db.habitLogs.get(todayKey), [todayKey]);
  const allHabits = useLiveQuery(() => db.habitLogs.toArray(), []) ?? [];
  const todayMeals =
    useLiveQuery(() => db.mealLogs.where('date').equals(todayKey).toArray(), [todayKey]) ?? [];
  const workoutLogs = useLiveQuery(() => db.workoutLogs.toArray(), []) ?? [];
  const foodCount = useLiveQuery(() => db.foodItems.count(), []) ?? 0;

  const activeProfile = profile ?? createDefaultUserProfile();
  const activeSettings = settings ?? { ...createDefaultSettings(), theme: getCachedTheme() };
  const habit = todayHabit ?? createEmptyHabitLog(todayKey);

  // 当日动态目标（训练日自动上浮碳水与饮水）
  const dailyTargets = getEffectiveDailyTargets(activeProfile, habit.isTrainingDay);

  // 汇总今日饮食已摄入宏量与花费
  const consumed = todayMeals.reduce(
    (acc, item) => ({
      calories: acc.calories + item.calories,
      proteinG: acc.proteinG + item.proteinG,
      carbsG: acc.carbsG + item.carbsG,
      fatG: acc.fatG + item.fatG,
      spentYuan: Math.round((acc.spentYuan + item.priceYuan) * 10) / 10,
    }),
    { calories: 0, proteinG: 0, carbsG: 0, fatG: 0, spentYuan: 0 },
  );

  // RPG 状态与周体重趋势计算
  const totalXp = allHabits.reduce((sum, item) => sum + (item.xpEarned || 0), 0);
  const rpg = calculateRpgLevel(totalXp);
  const streakDays = calculateStreakDays(allHabits);
  const heatmap = buildHeatmapCells(allHabits, 28);
  const lowBatteryMode = isLowBatterySleep(habit.sleepDurationHours);
  const weightTrend = analyzeWeightTrend(allHabits, activeProfile.goal);
  const todayWorkoutLog = workoutLogs.find((w) => w.date === todayKey && w.completed);

  /** 动作 1：快速记录饮水（自动按饮品补水系数折算 + 发放 XP + 震动反馈） */
  const logWater = useCallback(
    async (drinkType: DrinkType, rawMl: number): Promise<{ gainedXp: number; effectiveMl: number }> => {
      const option = DRINK_OPTIONS.find((d) => d.type === drinkType) ?? DRINK_OPTIONS[0];
      const effectiveMl = Math.round(rawMl * option.factor);
      const entry: WaterEntry = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        timestamp: Date.now(),
        drinkType: option.type,
        label: option.shortLabel,
        rawMl,
        hydrationFactor: option.factor,
        effectiveMl,
      };

      let gainedXp = 0;
      let hitGoalNow = false;

      await db.transaction('rw', [db.habitLogs, db.userProfile], async () => {
        const currentProfile = (await db.userProfile.get('primary')) ?? createDefaultUserProfile();
        const existing = (await db.habitLogs.get(todayKey)) ?? createEmptyHabitLog(todayKey);
        const targets = getEffectiveDailyTargets(currentProfile, existing.isTrainingDay);

        const nextEntries = [entry, ...existing.waterEntries];
        const totalRawWaterMl = nextEntries.reduce((s, e) => s + e.rawMl, 0);
        const totalEffectiveWaterMl = nextEntries.reduce((s, e) => s + e.effectiveMl, 0);

        if (existing.waterEntries.length < 6) {
          gainedXp += DAILY_QUEST_REWARDS.water_step.xp;
        }

        const completedQuests = new Set(existing.completedQuests);
        if (
          totalEffectiveWaterMl >= targets.waterMl &&
          !completedQuests.has(DAILY_QUEST_REWARDS.water_goal.id)
        ) {
          completedQuests.add(DAILY_QUEST_REWARDS.water_goal.id);
          gainedXp += DAILY_QUEST_REWARDS.water_goal.xp;
          hitGoalNow = true;
        }

        await db.habitLogs.put({
          ...existing,
          waterEntries: nextEntries,
          totalRawWaterMl,
          totalEffectiveWaterMl,
          xpEarned: existing.xpEarned + gainedXp,
          completedQuests: Array.from(completedQuests),
          updatedAt: Date.now(),
        });
      });

      if (hitGoalNow) void hapticSuccess();
      else void hapticLight();

      return { gainedXp, effectiveMl };
    },
    [todayKey],
  );

  /** 动作 2：撤销最近一笔喝水记录（同步回滚达标任务与对应 XP，避免撤销后状态不一致） */
  const undoLastWater = useCallback(async (): Promise<boolean> => {
    let removed = false;
    await db.transaction('rw', [db.habitLogs, db.userProfile], async () => {
      const existing = await db.habitLogs.get(todayKey);
      if (!existing || existing.waterEntries.length === 0) return;

      const currentProfile = (await db.userProfile.get('primary')) ?? createDefaultUserProfile();
      const targets = getEffectiveDailyTargets(currentProfile, existing.isTrainingDay);

      const [, ...rest] = existing.waterEntries;
      const totalRawWaterMl = rest.reduce((s, e) => s + e.rawMl, 0);
      const totalEffectiveWaterMl = rest.reduce((s, e) => s + e.effectiveMl, 0);
      let deductXp = existing.waterEntries.length <= 6 ? DAILY_QUEST_REWARDS.water_step.xp : 0;

      const completedQuests = new Set(existing.completedQuests);
      if (
        totalEffectiveWaterMl < targets.waterMl &&
        completedQuests.has(DAILY_QUEST_REWARDS.water_goal.id)
      ) {
        completedQuests.delete(DAILY_QUEST_REWARDS.water_goal.id);
        deductXp += DAILY_QUEST_REWARDS.water_goal.xp;
      }

      await db.habitLogs.put({
        ...existing,
        waterEntries: rest,
        totalRawWaterMl,
        totalEffectiveWaterMl,
        xpEarned: Math.max(0, existing.xpEarned - deductXp),
        completedQuests: Array.from(completedQuests),
        updatedAt: Date.now(),
      });
      removed = true;
    });
    if (removed) void hapticLight();
    return removed;
  }, [todayKey]);

  /** 动作 3：入睡 / 起床打卡与睡眠时长计算 */
  const saveSleepCheckin = useCallback(
    async (payload: {
      bedTime?: string;
      wakeTime?: string;
      quality?: 1 | 2 | 3 | 4 | 5;
    }): Promise<{ gainedXp: number; durationHours?: number; triggeredLowBattery: boolean }> => {
      let gainedXp = 0;
      let durationHours: number | undefined;

      await db.transaction('rw', db.habitLogs, async () => {
        const existing = (await db.habitLogs.get(todayKey)) ?? createEmptyHabitLog(todayKey);
        const nextBed = payload.bedTime !== undefined ? payload.bedTime : existing.sleepBedTime;
        const nextWake = payload.wakeTime !== undefined ? payload.wakeTime : existing.sleepWakeTime;
        durationHours = calcSleepDurationHours(nextBed, nextWake);

        const completedQuests = new Set(existing.completedQuests);
        if (nextBed && nextWake && !completedQuests.has(DAILY_QUEST_REWARDS.sleep_checkin.id)) {
          completedQuests.add(DAILY_QUEST_REWARDS.sleep_checkin.id);
          gainedXp += DAILY_QUEST_REWARDS.sleep_checkin.xp;
        }
        if (
          typeof durationHours === 'number' &&
          durationHours >= 7 &&
          !completedQuests.has(DAILY_QUEST_REWARDS.sleep_healthy.id)
        ) {
          completedQuests.add(DAILY_QUEST_REWARDS.sleep_healthy.id);
          gainedXp += DAILY_QUEST_REWARDS.sleep_healthy.xp;
        }

        await db.habitLogs.put({
          ...existing,
          sleepBedTime: nextBed,
          sleepWakeTime: nextWake,
          sleepDurationHours: durationHours,
          sleepQuality: payload.quality ?? existing.sleepQuality,
          xpEarned: existing.xpEarned + gainedXp,
          completedQuests: Array.from(completedQuests),
          updatedAt: Date.now(),
        });
      });

      void hapticSuccess();

      return {
        gainedXp,
        durationHours,
        triggeredLowBattery: isLowBatterySleep(durationHours),
      };
    },
    [todayKey],
  );

  /** 动作 4：切换今日「训练日」状态 */
  const toggleTrainingDay = useCallback(async (): Promise<{ isTrainingDay: boolean; gainedXp: number }> => {
    let nextState = false;
    let gainedXp = 0;

    await db.transaction('rw', db.habitLogs, async () => {
      const existing = (await db.habitLogs.get(todayKey)) ?? createEmptyHabitLog(todayKey);
      nextState = !existing.isTrainingDay;
      const completedQuests = new Set(existing.completedQuests);

      if (nextState && !completedQuests.has(DAILY_QUEST_REWARDS.training_flag.id)) {
        completedQuests.add(DAILY_QUEST_REWARDS.training_flag.id);
        gainedXp += DAILY_QUEST_REWARDS.training_flag.xp;
      }

      await db.habitLogs.put({
        ...existing,
        isTrainingDay: nextState,
        xpEarned: existing.xpEarned + gainedXp,
        completedQuests: Array.from(completedQuests),
        updatedAt: Date.now(),
      });
    });

    void hapticLight();
    return { isTrainingDay: nextState, gainedXp };
  }, [todayKey]);

  /** 动作 5：久坐拉伸打卡 */
  const logStretch = useCallback(async (): Promise<{ gainedXp: number; count: number }> => {
    let gainedXp = 0;
    let count = 0;

    await db.transaction('rw', db.habitLogs, async () => {
      const existing = (await db.habitLogs.get(todayKey)) ?? createEmptyHabitLog(todayKey);
      count = existing.stretchCount + 1;
      if (existing.stretchCount < 3) {
        gainedXp = DAILY_QUEST_REWARDS.stretch_checkin.xp;
      }

      await db.habitLogs.put({
        ...existing,
        stretchCount: count,
        xpEarned: existing.xpEarned + gainedXp,
        updatedAt: Date.now(),
      });
    });

    void hapticLight();
    return { gainedXp, count };
  }, [todayKey]);

  /** 动作 6：从美食库或推荐方案一键记餐 */
  const logMealFromFood = useCallback(
    async (food: FoodItem, mealType?: MealSlot): Promise<{ gainedXp: number }> => {
      const hour = new Date().getHours();
      const autoSlot: MealSlot =
        mealType ??
        (hour < 10 ? 'breakfast' : hour < 15 ? 'lunch' : hour < 21 ? 'dinner' : 'snack');

      let gainedXp = 0;

      await db.transaction('rw', [db.mealLogs, db.habitLogs], async () => {
        await db.mealLogs.add({
          date: todayKey,
          mealType: autoSlot,
          foodItemId: food.id,
          foodName: food.name,
          storeName: food.storeName,
          servings: 1,
          priceYuan: food.priceYuan,
          calories: food.calories,
          proteinG: food.proteinG,
          carbsG: food.carbsG,
          fatG: food.fatG,
          createdAt: Date.now(),
        });

        const existing = (await db.habitLogs.get(todayKey)) ?? createEmptyHabitLog(todayKey);
        const todayMealCount = await db.mealLogs.where('date').equals(todayKey).count();
        if (todayMealCount <= 4) {
          gainedXp = 15;
        }
        await db.habitLogs.put({
          ...existing,
          xpEarned: existing.xpEarned + gainedXp,
          updatedAt: Date.now(),
        });
      });

      void hapticLight();
      return { gainedXp };
    },
    [todayKey],
  );

  /** 动作 7：删除今日某一条饮食流水 */
  const deleteMealLog = useCallback(async (mealLogId: number): Promise<void> => {
    await db.mealLogs.delete(mealLogId);
    void hapticLight();
  }, []);

  /** 动作 8：记录今日晨起空腹体重（同时更新身体档案当前体重） */
  const logMorningWeight = useCallback(
    async (weightKg: number): Promise<{ gainedXp: number }> => {
      const safe = Math.round(Math.max(30, Math.min(200, weightKg)) * 10) / 10;
      let gainedXp = 0;

      await db.transaction('rw', [db.habitLogs, db.userProfile], async () => {
        const existing = (await db.habitLogs.get(todayKey)) ?? createEmptyHabitLog(todayKey);
        const completedQuests = new Set(existing.completedQuests);
        if (!completedQuests.has('weight_checkin')) {
          completedQuests.add('weight_checkin');
          gainedXp = 20;
        }

        await db.habitLogs.put({
          ...existing,
          morningWeightKg: safe,
          xpEarned: existing.xpEarned + gainedXp,
          completedQuests: Array.from(completedQuests),
          updatedAt: Date.now(),
        });

        const currentProfile = (await db.userProfile.get('primary')) ?? createDefaultUserProfile();
        const recomputed = calculateMetabolicTargets({
          gender: currentProfile.gender,
          age: currentProfile.age,
          heightCm: currentProfile.heightCm,
          weightKg: safe,
          activityLevel: currentProfile.activityLevel,
          goal: currentProfile.goal,
          calorieAdjustment: currentProfile.calorieAdjustment,
        });
        await db.userProfile.put({
          ...currentProfile,
          weightKg: safe,
          ...recomputed,
          updatedAt: Date.now(),
        });
      });

      void hapticSuccess();
      return { gainedXp };
    },
    [todayKey],
  );

  /** 动作 9：一键应用周体重趋势动态热量微调 */
  const applyCalorieAdjustment = useCallback(async (deltaKcal: number): Promise<number> => {
    let nextTarget = 0;
    await db.transaction('rw', db.userProfile, async () => {
      const currentProfile = (await db.userProfile.get('primary')) ?? createDefaultUserProfile();
      const nextAdj = Math.max(-400, Math.min(400, (currentProfile.calorieAdjustment || 0) + deltaKcal));
      const recomputed = calculateMetabolicTargets({
        gender: currentProfile.gender,
        age: currentProfile.age,
        heightCm: currentProfile.heightCm,
        weightKg: currentProfile.weightKg,
        activityLevel: currentProfile.activityLevel,
        goal: currentProfile.goal,
        calorieAdjustment: nextAdj,
      });
      nextTarget = recomputed.targetCalories;
      await db.userProfile.put({
        ...currentProfile,
        calorieAdjustment: nextAdj,
        ...recomputed,
        updatedAt: Date.now(),
      });
    });
    void hapticSuccess();
    return nextTarget;
  }, []);

  /** 动作 10：完成一次健身房专注训练（写日志、算总容量、自动激活训练日、发 +60 XP） */
  const completeWorkoutSession = useCallback(
    async (payload: {
      planId?: number;
      dayName: string;
      durationMin: number;
      exercises: ExerciseLogEntry[];
      notes?: string;
    }): Promise<{ totalVolumeKg: number; gainedXp: number }> => {
      const totalVolumeKg = Math.round(
        payload.exercises.reduce(
          (acc, ex) =>
            acc +
            ex.sets
              .filter((s) => s.completed)
              .reduce((sAcc, s) => sAcc + Math.max(0, s.weightKg) * Math.max(0, s.reps), 0),
          0,
        ),
      );

      let gainedXp = 0;

      await db.transaction('rw', [db.workoutLogs, db.habitLogs], async () => {
        await db.workoutLogs.add({
          date: todayKey,
          planId: payload.planId,
          dayName: payload.dayName,
          isTrainingDay: true,
          durationMin: Math.max(1, payload.durationMin),
          exercises: payload.exercises,
          totalVolumeKg,
          completed: true,
          notes: payload.notes,
          createdAt: Date.now(),
        });

        const existing = (await db.habitLogs.get(todayKey)) ?? createEmptyHabitLog(todayKey);
        const completedQuests = new Set(existing.completedQuests);
        if (!completedQuests.has('workout_session_done')) {
          completedQuests.add('workout_session_done');
          gainedXp = 60;
        }
        await db.habitLogs.put({
          ...existing,
          isTrainingDay: true,
          xpEarned: existing.xpEarned + gainedXp,
          completedQuests: Array.from(completedQuests),
          updatedAt: Date.now(),
        });
      });

      void hapticSuccess();
      return { totalVolumeKg, gainedXp };
    },
    [todayKey],
  );

  return {
    todayKey,
    settingsLoaded: settings !== undefined,
    profile: activeProfile,
    settings: activeSettings,
    habit,
    dailyTargets,
    consumed,
    todayMeals,
    workoutLogs,
    todayWorkoutLog,
    foodCount,
    rpg,
    streakDays,
    heatmap,
    lowBatteryMode,
    weightTrend,
    actions: {
      logWater,
      undoLastWater,
      saveSleepCheckin,
      toggleTrainingDay,
      logStretch,
      logMealFromFood,
      deleteMealLog,
      logMorningWeight,
      applyCalorieAdjustment,
      completeWorkoutSession,
    },
  };
}
