import { useMemo, useState } from 'react';
import { Bell, BellOff, BellRing, ChevronDown, ChevronUp, Plus, Trash2 } from 'lucide-react';
import { QuickWaterCard } from '../components/habit/QuickWaterCard';
import { SleepCheckinCard } from '../components/habit/SleepCheckinCard';
import { db } from '../db/database';
import type { useTodaySummary } from '../hooks/useTodaySummary';
import {
  buildDailyNotificationSchedule,
  hapticLight,
  isNativeApp,
  sendTestReminderNotification,
  syncNativeReminders,
} from '../lib/native';

type SummaryData = ReturnType<typeof useTodaySummary>;

interface RoutinePageProps {
  summary: SummaryData;
  onNotifyXp: (text: string) => void;
}

/**
 * 极简作息与喝水页：聚焦喝水、睡眠与课表免打扰（细节时间轴按需折叠）
 */
export function RoutinePage({ summary, onNotifyXp }: RoutinePageProps) {
  const { profile, settings, habit, dailyTargets, actions } = summary;

  const [showAddDnd, setShowAddDnd] = useState(false);
  const [showTimeline, setShowTimeline] = useState(false);
  const [dndLabel, setDndLabel] = useState('');
  const [dndStart, setDndStart] = useState('14:00');
  const [dndEnd, setDndEnd] = useState('17:20');
  const [syncingNotif, setSyncingNotif] = useState(false);

  const schedulePreview = useMemo(
    () => buildDailyNotificationSchedule(settings, profile.bedtimeTarget),
    [settings, profile.bedtimeTarget],
  );

  const updateSettingsAndSync = async (nextSettings: typeof settings, toastMsg: string) => {
    await db.settings.put({ ...nextSettings, updatedAt: Date.now() });
    if (isNativeApp()) {
      try {
        await syncNativeReminders(nextSettings, profile.bedtimeTarget);
      } catch {
        // 忽略未授权通知异常
      }
    }
    onNotifyXp(toastMsg);
  };

  const toggleDnd = async (windowId: string) => {
    void hapticLight();
    const nextWindows = settings.dndWindows.map((w) =>
      w.id === windowId ? { ...w, enabled: !w.enabled } : w,
    );
    await updateSettingsAndSync({ ...settings, dndWindows: nextWindows }, '已更新免打扰');
  };

  const handleAddDnd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!dndLabel.trim()) return;
    const nextWindows = [
      ...settings.dndWindows,
      {
        id: `dnd-${Date.now()}`,
        label: dndLabel.trim(),
        start: dndStart,
        end: dndEnd,
        enabled: true,
      },
    ];
    await updateSettingsAndSync({ ...settings, dndWindows: nextWindows }, `已添加：${dndLabel.trim()}`);
    setDndLabel('');
    setShowAddDnd(false);
  };

  const handleDeleteDnd = async (id: string) => {
    const nextWindows = settings.dndWindows.filter((w) => w.id !== id);
    await updateSettingsAndSync({ ...settings, dndWindows: nextWindows }, '已移除该免打扰时段');
  };

  const handleIntervalChange = async (minutes: number) => {
    void hapticLight();
    await updateSettingsAndSync(
      { ...settings, waterReminderIntervalMin: minutes },
      `提醒间隔已设为 ${minutes} 分钟`,
    );
  };

  const handleSyncSystemNotifications = async () => {
    setSyncingNotif(true);
    try {
      const res = await syncNativeReminders(settings, profile.bedtimeTarget);
      onNotifyXp(
        res.mode === 'native'
          ? `已下发 ${res.scheduledCount} 条系统定时提醒（跳过 ${res.skippedCount} 条免打扰）`
          : `已排期 ${res.scheduledCount} 条提醒（安装 APK 后接入安卓通知栏）`,
      );
    } catch (err: unknown) {
      onNotifyXp(err instanceof Error ? err.message : String(err));
    } finally {
      setSyncingNotif(false);
    }
  };

  const handleTestNotification = async () => {
    try {
      const msg = await sendTestReminderNotification();
      onNotifyXp(msg);
    } catch (err: unknown) {
      onNotifyXp(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div className="space-y-4">
      <QuickWaterCard
        totalEffectiveMl={habit.totalEffectiveWaterMl}
        totalRawMl={habit.totalRawWaterMl}
        targetWaterMl={dailyTargets.waterMl}
        isTrainingDay={habit.isTrainingDay}
        entries={habit.waterEntries}
        onLogWater={async (drinkType, rawMl) => {
          const res = await actions.logWater(drinkType, rawMl);
          onNotifyXp(
            res.gainedXp > 0
              ? `有效补水 +${res.effectiveMl}ml · +${res.gainedXp} XP`
              : `有效补水 +${res.effectiveMl}ml`,
          );
        }}
        onUndoLast={async () => {
          const ok = await actions.undoLastWater();
          if (ok) onNotifyXp('已撤销上一笔记录');
        }}
      />

      <SleepCheckinCard
        bedtimeTarget={profile.bedtimeTarget}
        wakeTarget={profile.wakeTarget}
        loggedBedTime={habit.sleepBedTime}
        loggedWakeTime={habit.sleepWakeTime}
        sleepDurationHours={habit.sleepDurationHours}
        onSaveSleep={async (payload) => {
          const res = await actions.saveSleepCheckin(payload);
          if (res.triggeredLowBattery) {
            onNotifyXp(`睡眠 ${res.durationHours}h · 已开启低电量保护`);
          } else if (res.gainedXp > 0) {
            onNotifyXp(`作息已保存 · +${res.gainedXp} XP`);
          } else {
            onNotifyXp('已更新睡眠时间');
          }
        }}
      />

      {/* 课表免打扰与原生提醒 */}
      <section
        data-tour="routine-dnd"
        className="rounded-2xl bg-white dark:bg-zinc-900/95 border border-zinc-200/70 dark:border-zinc-800/80 p-4 space-y-3.5"
      >
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <BellOff className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
            <h2 className="text-sm font-bold text-zinc-900 dark:text-zinc-100">定时提醒与免打扰</h2>
          </div>
          <button
            type="button"
            onClick={() => setShowAddDnd((v) => !v)}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-xl text-xs font-medium bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-200"
          >
            <Plus className="w-3.5 h-3.5" />
            新增
          </button>
        </div>

        <div className="flex items-center justify-between text-xs">
          <span className="text-zinc-500">喝水提醒间隔</span>
          <div className="flex items-center gap-1.5">
            {[60, 90, 120].map((min) => (
              <button
                key={min}
                type="button"
                onClick={() => handleIntervalChange(min)}
                className={`px-2.5 py-1 rounded-full text-xs font-medium num-tabular ${
                  settings.waterReminderIntervalMin === min
                    ? 'bg-[#1a6e5e] text-white'
                    : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300'
                }`}
              >
                {min}分
              </button>
            ))}
          </div>
        </div>

        {showAddDnd && (
          <form
            onSubmit={handleAddDnd}
            className="p-3 rounded-xl bg-zinc-50 dark:bg-zinc-800/60 space-y-2"
          >
            <input
              type="text"
              required
              placeholder="时段名称（如：下午会议 / 晚间专注）"
              value={dndLabel}
              onChange={(e) => setDndLabel(e.target.value)}
              className="w-full px-3 py-2 rounded-lg text-xs bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700"
            />
            <div className="grid grid-cols-3 gap-2">
              <input
                type="time"
                value={dndStart}
                onChange={(e) => setDndStart(e.target.value)}
                className="px-2 py-1.5 rounded-lg text-xs num-tabular bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700"
              />
              <input
                type="time"
                value={dndEnd}
                onChange={(e) => setDndEnd(e.target.value)}
                className="px-2 py-1.5 rounded-lg text-xs num-tabular bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700"
              />
              <button type="submit" className="py-1.5 rounded-lg text-xs font-semibold bg-[#1a6e5e] text-white">
                添加
              </button>
            </div>
          </form>
        )}

        <div className="divide-y divide-zinc-100 dark:divide-zinc-800/80">
          {settings.dndWindows.map((win) => (
            <div key={win.id} className="flex items-center justify-between gap-2 py-2.5 first:pt-0 last:pb-0">
              <div className="min-w-0">
                <p className="text-xs font-semibold text-zinc-900 dark:text-zinc-100 truncate">{win.label}</p>
                <p className="text-[11px] text-zinc-400 num-tabular">
                  {win.start} - {win.end}
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  role="switch"
                  aria-checked={win.enabled}
                  onClick={() => toggleDnd(win.id)}
                  className={`relative w-10 h-6 rounded-full transition-colors ${
                    win.enabled ? 'bg-[#1a6e5e]' : 'bg-zinc-300 dark:bg-zinc-700'
                  }`}
                >
                  <span
                    className={`block w-4 h-4 rounded-full bg-white shadow transition-transform ${
                      win.enabled ? 'translate-x-5' : 'translate-x-1'
                    }`}
                  />
                </button>
                <button
                  type="button"
                  onClick={() => handleDeleteDnd(win.id)}
                  className="p-1 text-zinc-400 hover:text-rose-500"
                  title="删除"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-2 gap-2 pt-1">
          <button
            type="button"
            disabled={syncingNotif}
            onClick={handleSyncSystemNotifications}
            className="inline-flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-xs font-semibold bg-[#1a6e5e] hover:bg-[#155a4d] text-white"
          >
            <Bell className="w-3.5 h-3.5" />
            同步提醒
          </button>
          <button
            type="button"
            onClick={handleTestNotification}
            className="inline-flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-xs font-semibold bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-200"
          >
            <BellRing className="w-3.5 h-3.5" />
            测试通知
          </button>
        </div>

        {/* 折叠查看详细排期时间轴 */}
        <button
          type="button"
          onClick={() => setShowTimeline((v) => !v)}
          className="w-full flex items-center justify-between pt-2 border-t border-zinc-100 dark:border-zinc-800/80 text-xs text-zinc-400 hover:text-zinc-600"
        >
          <span>查看今日提醒时间轴 ({schedulePreview.filter((s) => !s.skippedByDnd).length} 条生效)</span>
          {showTimeline ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
        </button>

        {showTimeline && (
          <div className="flex flex-wrap gap-1.5">
            {schedulePreview.map((slot) => (
              <span
                key={slot.id}
                className={`text-[11px] px-2 py-1 rounded-lg num-tabular ${
                  slot.skippedByDnd
                    ? 'bg-zinc-100 dark:bg-zinc-800/50 text-zinc-400 line-through'
                    : 'bg-emerald-500/10 text-[#166556] dark:text-emerald-400'
                }`}
              >
                {slot.timeLabel} {slot.type === 'bedtime' ? '睡前' : '补水'}
              </span>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
