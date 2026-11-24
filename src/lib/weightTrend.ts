import type { FitnessGoal, HabitLog } from '../types/models';

export interface WeightPoint {
  date: string;
  weightKg: number;
}

export interface WeightTrendAnalysis {
  points: WeightPoint[];
  latestWeight?: number;
  recentAvg?: number;
  previousAvg?: number;
  weeklyDeltaKg?: number;
  statusLabel: string;
  suggestedCalorieDelta: number;
  suggestionText: string;
}

/**
 * 基于最近 14 天晨起空腹体重计算周均重变化斜率，并给出每日热量自动动态微调建议
 */
export function analyzeWeightTrend(
  allHabits: HabitLog[],
  goal: FitnessGoal,
): WeightTrendAnalysis {
  const points: WeightPoint[] = allHabits
    .filter((h) => typeof h.morningWeightKg === 'number' && h.morningWeightKg > 25)
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-14)
    .map((h) => ({ date: h.date, weightKg: h.morningWeightKg! }));

  if (points.length === 0) {
    return {
      points: [],
      statusLabel: '待记录晨重',
      suggestedCalorieDelta: 0,
      suggestionText: '每天晨起如厕后记一下体重，满 4 天即可自动分析代谢趋势并动态校准热量目标。',
    };
  }

  const latestWeight = points[points.length - 1].weightKg;
  if (points.length < 4) {
    return {
      points,
      latestWeight,
      statusLabel: `已录 ${points.length} 天`,
      suggestedCalorieDelta: 0,
      suggestionText: `当前晨重 ${latestWeight.toFixed(1)} kg。再记录 ${4 - points.length} 天即可解锁每周趋势自动热量微调。`,
    };
  }

  const splitIndex = Math.max(1, Math.floor(points.length / 2));
  const prevSlice = points.slice(0, splitIndex);
  const recentSlice = points.slice(splitIndex);

  const avg = (arr: WeightPoint[]) =>
    Math.round((arr.reduce((s, p) => s + p.weightKg, 0) / arr.length) * 100) / 100;

  const previousAvg = avg(prevSlice);
  const recentAvg = avg(recentSlice);
  const weeklyDeltaKg = Math.round((recentAvg - previousAvg) * 100) / 100;

  if (goal === 'cut') {
    if (weeklyDeltaKg > -0.1) {
      return {
        points,
        latestWeight,
        recentAvg,
        previousAvg,
        weeklyDeltaKg,
        statusLabel: '减脂平台期',
        suggestedCalorieDelta: -120,
        suggestionText: `近阶段均重变化 ${weeklyDeltaKg >= 0 ? '+' : ''}${weeklyDeltaKg}kg（偏慢），建议每日热量微调 -120 kcal 或增加步数。`,
      };
    }
    if (weeklyDeltaKg < -0.85) {
      return {
        points,
        latestWeight,
        recentAvg,
        previousAvg,
        weeklyDeltaKg,
        statusLabel: '掉重偏快',
        suggestedCalorieDelta: 120,
        suggestionText: `掉重速度 ${weeklyDeltaKg}kg/周 偏快，为防止掉肌肉与代谢适应，建议每日回调 +120 kcal。`,
      };
    }
    return {
      points,
      latestWeight,
      recentAvg,
      previousAvg,
      weeklyDeltaKg,
      statusLabel: '黄金减脂速率',
      suggestedCalorieDelta: 0,
      suggestionText: `均重稳步下降 ${weeklyDeltaKg}kg，处于最佳保肌减脂区间，保持当前热量目标即可！`,
    };
  }

  if (goal === 'bulk') {
    if (weeklyDeltaKg < 0.08) {
      return {
        points,
        latestWeight,
        recentAvg,
        previousAvg,
        weeklyDeltaKg,
        statusLabel: '增肌盈余不足',
        suggestedCalorieDelta: 150,
        suggestionText: `均重几乎未涨（${weeklyDeltaKg}kg），建议每日增加 +150 kcal 优质碳水推动维度增长。`,
      };
    }
    if (weeklyDeltaKg > 0.55) {
      return {
        points,
        latestWeight,
        recentAvg,
        previousAvg,
        weeklyDeltaKg,
        statusLabel: '增重偏快防囤脂',
        suggestedCalorieDelta: -100,
        suggestionText: `增重 +${weeklyDeltaKg}kg 略快，建议微调 -100 kcal 控制体脂增长。`,
      };
    }
    return {
      points,
      latestWeight,
      recentAvg,
      previousAvg,
      weeklyDeltaKg,
      statusLabel: '干净增肌中',
      suggestedCalorieDelta: 0,
      suggestionText: `稳健增长 +${weeklyDeltaKg}kg，肌肉增长与体脂控制平衡极佳。`,
    };
  }

  // maintain
  if (Math.abs(weeklyDeltaKg) > 0.4) {
    const delta = weeklyDeltaKg > 0 ? -100 : 100;
    return {
      points,
      latestWeight,
      recentAvg,
      previousAvg,
      weeklyDeltaKg,
      statusLabel: weeklyDeltaKg > 0 ? '轻微上浮' : '轻微下降',
      suggestedCalorieDelta: delta,
      suggestionText: `体重波动 ${weeklyDeltaKg > 0 ? '+' : ''}${weeklyDeltaKg}kg，建议每日微调 ${delta > 0 ? '+' : ''}${delta} kcal 回到平衡线。`,
    };
  }

  return {
    points,
    latestWeight,
    recentAvg,
    previousAvg,
    weeklyDeltaKg,
    statusLabel: '体重稳态',
    suggestedCalorieDelta: 0,
    suggestionText: `体重维持在 ${recentAvg.toFixed(1)}kg 附近波动极小，代谢收支非常稳健。`,
  };
}
