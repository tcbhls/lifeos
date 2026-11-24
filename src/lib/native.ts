import { Capacitor } from '@capacitor/core';
import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics';
import { LocalNotifications } from '@capacitor/local-notifications';
import { StatusBar, Style } from '@capacitor/status-bar';
import { timeToMinutes } from './date';
import type { DndWindow, Settings } from '../types/models';

export const isNativeAndroid = () => Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';
export const isNativeApp = () => Capacitor.isNativePlatform();

/** 轻触震动反馈（记水、切 Tab、勾选动作组） */
export async function hapticLight() {
  if (!isNativeApp()) return;
  try {
    await Haptics.impact({ style: ImpactStyle.Light });
  } catch {
    // 非支持硬件静默忽略
  }
}

/** 成功结算震动反馈（达成饮水目标、完成训练、保存打卡） */
export async function hapticSuccess() {
  if (!isNativeApp()) return;
  try {
    await Haptics.notification({ type: NotificationType.Success });
  } catch {
    // 静默降级
  }
}

/** 同步 Android 顶部系统状态栏文字与背景色 */
export async function syncNativeStatusBar(isDark: boolean) {
  if (!isNativeApp()) return;
  try {
    await StatusBar.setStyle({ style: isDark ? Style.Dark : Style.Light });
    if (isNativeAndroid()) {
      await StatusBar.setBackgroundColor({ color: isDark ? '#0b0c0e' : '#f7f8f7' });
    }
  } catch {
    // 静默忽略
  }
}

/** 判断指定分钟点是否落在已启用的课表/游戏免打扰时段内 */
export function isInDndWindow(minuteOfDay: number, windows: DndWindow[]): DndWindow | null {
  for (const w of windows) {
    if (!w.enabled) continue;
    const start = timeToMinutes(w.start);
    const end = timeToMinutes(w.end);
    if (start <= end) {
      if (minuteOfDay >= start && minuteOfDay <= end) return w;
    } else {
      // 跨午夜免打扰
      if (minuteOfDay >= start || minuteOfDay <= end) return w;
    }
  }
  return null;
}

export interface PlannedNotificationSlot {
  id: number;
  timeLabel: string;
  type: 'water' | 'stretch' | 'bedtime';
  title: string;
  body: string;
  skippedByDnd?: string;
}

/**
 * 计算今日 08:30 ~ 23:00 的喝水、久坐拉伸与睡前倒计时提醒排期（严格过滤课表/游戏 DND）
 */
export function buildDailyNotificationSchedule(
  settings: Settings,
  bedtimeTarget: string,
): PlannedNotificationSlot[] {
  const slots: PlannedNotificationSlot[] = [];
  const waterStep = Math.max(30, Math.min(240, settings.waterReminderIntervalMin || 90));
  const bedMin = timeToMinutes(bedtimeTarget || '23:30');
  const endWaterMin = Math.min(bedMin - 60, 22 * 60);

  let nextId = 1001;
  for (let m = 9 * 60; m <= endWaterMin; m += waterStep) {
    const hh = String(Math.floor(m / 60)).padStart(2, '0');
    const mm = String(m % 60).padStart(2, '0');
    const dnd = isInDndWindow(m, settings.dndWindows);
    slots.push({
      id: nextId++,
      timeLabel: `${hh}:${mm}`,
      type: 'water',
      title: 'LifeOS · 补水与拉伸时间',
      body: '喝 250ml 水并起身活动颈肩 30 秒，保持满血状态 (+10 XP)',
      skippedByDnd: dnd?.label,
    });
  }

  // 睡前 30 分钟放手机提醒
  const preBedMin = (bedMin - 30 + 1440) % 1440;
  const preHh = String(Math.floor(preBedMin / 60)).padStart(2, '0');
  const preMm = String(preBedMin % 60).padStart(2, '0');
  const bedDnd = isInDndWindow(preBedMin, settings.dndWindows);
  slots.push({
    id: 2001,
    timeLabel: `${preHh}:${preMm}`,
    type: 'bedtime',
    title: 'LifeOS · 睡前 30 分钟倒计时',
    body: `目标入睡 ${bedtimeTarget}，准备洗漱关屏，睡满 7 小时防止明天进入低电量模式`,
    skippedByDnd: bedDnd?.label,
  });

  return slots;
}

/**
 * 将提醒排期真正下发到 Android 原生 LocalNotifications 调度器
 * 在浏览器环境下返回已计算的排期数量，无报错
 */
export async function syncNativeReminders(
  settings: Settings,
  bedtimeTarget: string,
): Promise<{ scheduledCount: number; skippedCount: number; mode: 'native' | 'web_preview' }> {
  const plan = buildDailyNotificationSchedule(settings, bedtimeTarget);
  const active = plan.filter((p) => !p.skippedByDnd);
  const skippedCount = plan.length - active.length;

  if (!isNativeApp()) {
    return { scheduledCount: active.length, skippedCount, mode: 'web_preview' };
  }

  const perm = await LocalNotifications.requestPermissions();
  if (perm.display !== 'granted') {
    throw new Error('未获得系统通知权限，请在手机设置中允许 LifeOS 发送通知');
  }

  const pending = await LocalNotifications.getPending();
  if (pending.notifications.length > 0) {
    await LocalNotifications.cancel({ notifications: pending.notifications });
  }

  if (!settings.notificationsEnabled || active.length === 0) {
    return { scheduledCount: 0, skippedCount, mode: 'native' };
  }

  await LocalNotifications.schedule({
    notifications: active.map((slot) => {
      const [h, m] = slot.timeLabel.split(':').map(Number);
      return {
        id: slot.id,
        title: slot.title,
        body: slot.body,
        schedule: {
          on: { hour: h, minute: m },
          allowWhileIdle: true,
        },
      };
    }),
  });

  return { scheduledCount: active.length, skippedCount, mode: 'native' };
}

/** 发送一条即时测试通知（Android 实机 2 秒后弹出系统通知栏；浏览器走 Web Notification） */
export async function sendTestReminderNotification(): Promise<string> {
  if (isNativeApp()) {
    const perm = await LocalNotifications.requestPermissions();
    if (perm.display !== 'granted') {
      throw new Error('请先在安卓系统弹窗中允许 LifeOS 通知权限');
    }
    await LocalNotifications.schedule({
      notifications: [
        {
          id: 9999,
          title: 'LifeOS 原生提醒已就绪',
          body: '喝水、拉伸与睡前倒计时将按你的免打扰课表精准推送。',
          schedule: { at: new Date(Date.now() + 2000) },
        },
      ],
    });
    return '已安排 2 秒后弹出原生系统通知';
  }

  if (typeof window !== 'undefined' && 'Notification' in window) {
    if (Notification.permission === 'default') {
      await Notification.requestPermission();
    }
    if (Notification.permission === 'granted') {
      new Notification('LifeOS 本地提醒测试', {
        body: '浏览器与 Android APK 原生本地通知桥接均已就绪！',
      });
      return '已发送桌面/浏览器系统通知';
    }
  }
  return '当前浏览器未开启通知权限，打包为 Android APK 后将使用系统原生通知栏';
}
