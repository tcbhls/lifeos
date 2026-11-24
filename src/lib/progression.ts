import type { WorkoutLog, WorkoutPlanExercise } from '../types/models';

export interface ProgressionSuggestion {
  lastSummary: string;
  nextWeightKg: number;
  nextTargetReps: number;
  advice: string;
  isUpgrade: boolean;
}

/**
 * Double Progression（双进阶超负荷）算法：
 * 根据历史上最近一次完成同动作的每组重量与次数，自动推算本次建议负荷
 */
export function getExerciseProgression(
  exercise: WorkoutPlanExercise,
  historyLogs: WorkoutLog[],
): ProgressionSuggestion {
  // 按日期倒序查找最近一次包含该动作且有已完成组的训练记录
  const sorted = [...historyLogs].sort((a, b) => b.createdAt - a.createdAt);
  for (const log of sorted) {
    const matched = log.exercises.find((e) => e.exerciseName === exercise.name);
    const doneSets = matched?.sets.filter((s) => s.completed && s.reps > 0) ?? [];
    if (doneSets.length === 0) continue;

    const topWeight = Math.max(...doneSets.map((s) => s.weightKg));
    const minReps = Math.min(...doneSets.map((s) => s.reps));
    const avgReps = Math.round(doneSets.reduce((s, x) => s + x.reps, 0) / doneSets.length);
    const allHitUpper = doneSets.every((s) => s.reps >= exercise.targetRepMax);

    const lastSummary = `上次 ${topWeight}kg × ${doneSets.map((s) => s.reps).join('/')}`;

    if (allHitUpper && doneSets.length >= exercise.targetSets) {
      const increment = /哑铃|侧平举|弯举|下压/.test(exercise.name) ? 2 : 2.5;
      const nextWeightKg = Math.round((topWeight + increment) * 10) / 10;
      return {
        lastSummary,
        nextWeightKg,
        nextTargetReps: exercise.targetRepMin,
        advice: `上次已打满 ${exercise.targetRepMax} 次上限！本次建议加重至 ${nextWeightKg}kg，冲击 ${exercise.targetRepMin} 次`,
        isUpgrade: true,
      };
    }

    const nextTargetReps = Math.min(exercise.targetRepMax, Math.max(minReps + 1, avgReps + 1));
    return {
      lastSummary,
      nextWeightKg: topWeight,
      nextTargetReps,
      advice: `保持 ${topWeight}kg，力争每组比上次多推/拉 1 次（目标 ${nextTargetReps} 次）`,
      isUpgrade: false,
    };
  }

  // 首次训练无历史数据时给常见健身房安全基准重量
  const defaultWeight = /卧推|深蹲|硬拉/.test(exercise.name)
    ? 40
    : /下拉|划船/.test(exercise.name)
      ? 35
      : /举腿/.test(exercise.name)
        ? 0
        : 10;

  return {
    lastSummary: '首次记录此动作',
    nextWeightKg: defaultWeight,
    nextTargetReps: exercise.targetRepMin,
    advice: `首次执行：先用舒适重量找发力感（RPE 7），完成后自动开启下次进阶推算`,
    isUpgrade: false,
  };
}
