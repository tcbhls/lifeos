/**
 * 本地自然日与作息时间计算工具
 */

/** 获取本地日期字符串 YYYY-MM-DD */
export function getLocalDateKey(date: Date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** 获取偏移 N 天后的本地日期字符串 */
export function getOffsetDateKey(offsetDays: number, baseDate: Date = new Date()): string {
  const d = new Date(baseDate);
  d.setDate(d.getDate() + offsetDays);
  return getLocalDateKey(d);
}

/** 格式化当前时间为 HH:mm */
export function getCurrentTimeHHmm(date: Date = new Date()): string {
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

/** 将 HH:mm 转为当天分钟数 */
export function timeToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map((v) => Number.parseInt(v, 10));
  if (Number.isNaN(h) || Number.isNaN(m)) return 0;
  return h * 60 + m;
}

/**
 * 根据入睡时间与起床时间计算睡眠时长（小时，保留 1 位小数）
 * 自动处理跨午夜（例如 23:40 入睡，07:20 起床 => 7.7 小时）
 */
export function calcSleepDurationHours(bedTime?: string, wakeTime?: string): number | undefined {
  if (!bedTime || !wakeTime) return undefined;
  const bedMin = timeToMinutes(bedTime);
  const wakeMin = timeToMinutes(wakeTime);
  let diff = wakeMin - bedMin;
  if (diff <= 0) {
    diff += 24 * 60;
  }
  return Math.round((diff / 60) * 10) / 10;
}

/**
 * 计算距离目标入睡时间的倒计时信息
 */
export function getBedtimeCountdown(bedtimeTarget: string, now: Date = new Date()): {
  isPastBedtime: boolean;
  hours: number;
  minutes: number;
  label: string;
} {
  const currentMin = now.getHours() * 60 + now.getMinutes();
  const targetMin = timeToMinutes(bedtimeTarget);

  // 若当前已到凌晨 00:00~04:30 且目标入睡在 20:00~23:59，视为已超过今晚入睡时间
  if (currentMin < 270 && targetMin >= 1200) {
    const overdue = currentMin + (1440 - targetMin);
    const hours = Math.floor(overdue / 60);
    const minutes = overdue % 60;
    return {
      isPastBedtime: true,
      hours,
      minutes,
      label: `已超时 ${hours > 0 ? `${hours}h ` : ''}${minutes}m`,
    };
  }

  let diff = targetMin - currentMin;
  if (diff < 0) {
    // 超过目标入睡时间（例如目标 23:30，现在 23:50）
    const overdue = Math.abs(diff);
    const hours = Math.floor(overdue / 60);
    const minutes = overdue % 60;
    return {
      isPastBedtime: true,
      hours,
      minutes,
      label: `已超时 ${hours > 0 ? `${hours}h ` : ''}${minutes}m`,
    };
  }

  const hours = Math.floor(diff / 60);
  const minutes = diff % 60;
  return {
    isPastBedtime: false,
    hours,
    minutes,
    label: hours > 0 ? `${hours} 小时 ${minutes} 分` : `${minutes} 分钟`,
  };
}

/** 格式化中文友好日期，如 "11月24日 · 周二" */
export function formatChineseDateLabel(date: Date = new Date()): string {
  const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  return `${date.getMonth() + 1}月${date.getDate()}日 · ${weekdays[date.getDay()]}`;
}
