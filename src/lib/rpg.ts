import type { HabitLog } from '../types/models';
import { getOffsetDateKey } from './date';

/** RPG 称号梯度配置 */
const LEVEL_TITLES = [
  '健康新手',
  '早起探索者',
  '自律学徒',
  '营养规划师',
  '铁馆常客',
  '体能进阶者',
  '代谢掌控者',
  '自律达人',
  '全能健康大师',
  'LifeOS 传奇',
];

/** 单个日常任务的经验奖励定义 */
export const DAILY_QUEST_REWARDS = {
  water_step: { id: 'water_step', title: '每次喝水打卡', xp: 10 },
  water_goal: { id: 'water_goal', title: '达成今日有效补水目标', xp: 45 },
  sleep_checkin: { id: 'sleep_checkin', title: '记录今日起床/睡眠时长', xp: 35 },
  sleep_healthy: { id: 'sleep_healthy', title: '睡满 7 小时元气拉满', xp: 25 },
  stretch_checkin: { id: 'stretch_checkin', title: '久坐拉伸放松一次', xp: 15 },
  training_flag: { id: 'training_flag', title: '激活训练日状态', xp: 30 },
} as const;

export interface RpgLevelState {
  level: number;
  title: string;
  totalXp: number;
  currentLevelXp: number;
  nextLevelXp: number;
  progressPercent: number;
}

/**
 * 依据累计总经验计算当前 RPG 等级、称号与升级进度
 * 每级需求呈平滑增长：120, 170, 220, 270...
 */
export function calculateRpgLevel(totalXp: number): RpgLevelState {
  let level = 1;
  let remaining = Math.max(0, Math.floor(totalXp));
  let needed = 120;

  while (remaining >= needed) {
    remaining -= needed;
    level += 1;
    needed = 120 + (level - 1) * 50;
  }

  const titleIndex = Math.min(LEVEL_TITLES.length - 1, level - 1);
  return {
    level,
    title: LEVEL_TITLES[titleIndex],
    totalXp,
    currentLevelXp: remaining,
    nextLevelXp: needed,
    progressPercent: Math.min(100, Math.round((remaining / needed) * 100)),
  };
}

/**
 * 计算当前连续打卡天数（只要当日 xpEarned > 0 即计为活跃日）
 */
export function calculateStreakDays(logs: HabitLog[]): number {
  const activeDates = new Set(logs.filter((l) => l.xpEarned > 0).map((l) => l.date));
  let streak = 0;

  // 若今天已打卡，从今天倒数；若今天尚未开始，从昨天起算当前保有连胜
  const todayKey = getOffsetDateKey(0);
  const startOffset = activeDates.has(todayKey) ? 0 : -1;

  for (let offset = startOffset; offset >= -365; offset -= 1) {
    const key = getOffsetDateKey(offset);
    if (activeDates.has(key)) {
      streak += 1;
    } else {
      break;
    }
  }
  return streak;
}

export interface HeatmapCell {
  date: string;
  xp: number;
  /** 强度档位 0~4 */
  level: 0 | 1 | 2 | 3 | 4;
  isToday: boolean;
}

/**
 * 生成最近 N 天（默认 28 天，4×7 网格）的 RPG 活跃度热力图数据
 */
export function buildHeatmapCells(logs: HabitLog[], days = 28): HeatmapCell[] {
  const map = new Map<string, HabitLog>();
  for (const log of logs) {
    map.set(log.date, log);
  }

  const cells: HeatmapCell[] = [];
  for (let offset = -(days - 1); offset <= 0; offset += 1) {
    const date = getOffsetDateKey(offset);
    const xp = map.get(date)?.xpEarned ?? 0;
    let level: 0 | 1 | 2 | 3 | 4 = 0;
    if (xp >= 120) level = 4;
    else if (xp >= 80) level = 3;
    else if (xp >= 40) level = 2;
    else if (xp > 0) level = 1;

    cells.push({
      date,
      xp,
      level,
      isToday: offset === 0,
    });
  }
  return cells;
}

/** 判定是否进入「低电量恢复模式」（睡眠已记录且不足 6.5 小时） */
export function isLowBatterySleep(sleepDurationHours?: number): boolean {
  return typeof sleepDurationHours === 'number' && sleepDurationHours > 0 && sleepDurationHours < 6.5;
}
