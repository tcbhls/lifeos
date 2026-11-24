import { useEffect, useState } from 'react';
import { AlarmClock, BedDouble, Check, MoonStar, Sunrise } from 'lucide-react';
import { getBedtimeCountdown, getCurrentTimeHHmm } from '../../lib/date';

interface SleepCheckinCardProps {
  bedtimeTarget: string;
  wakeTarget: string;
  loggedBedTime?: string;
  loggedWakeTime?: string;
  sleepDurationHours?: number;
  onSaveSleep: (payload: { bedTime?: string; wakeTime?: string }) => Promise<void>;
}

/**
 * 入睡倒计时 + 昨晚入睡 / 今日起床快速打卡原型
 */
export function SleepCheckinCard({
  bedtimeTarget,
  wakeTarget,
  loggedBedTime,
  loggedWakeTime,
  sleepDurationHours,
  onSaveSleep,
}: SleepCheckinCardProps) {
  const [bedDraft, setBedDraft] = useState<string | null>(null);
  const [wakeDraft, setWakeDraft] = useState<string | null>(null);
  const [, setNowTick] = useState(0);
  const [saving, setSaving] = useState(false);

  const bedInput = bedDraft ?? loggedBedTime ?? bedtimeTarget;
  const wakeInput = wakeDraft ?? loggedWakeTime ?? wakeTarget;
  // 随 bedtimeTarget 改动立即重算，每 30 秒刷新一次倒计时
  const countdown = getBedtimeCountdown(bedtimeTarget);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNowTick((t) => t + 1);
    }, 30000);
    return () => window.clearInterval(timer);
  }, []);

  const handleSavePair = async (nextBed: string, nextWake: string) => {
    setSaving(true);
    try {
      await onSaveSleep({ bedTime: nextBed, wakeTime: nextWake });
      setBedDraft(null);
      setWakeDraft(null);
    } finally {
      setSaving(false);
    }
  };

  const handleQuickWakeNow = async () => {
    const nowStr = getCurrentTimeHHmm();
    setWakeDraft(nowStr);
    await handleSavePair(bedInput || bedtimeTarget, nowStr);
  };

  const handleQuickBedNow = async () => {
    setSaving(true);
    try {
      const nowStr = getCurrentTimeHHmm();
      setBedDraft(nowStr);
      await onSaveSleep({ bedTime: nowStr });
      setBedDraft(null);
    } finally {
      setSaving(false);
    }
  };

  const isLowSleep = typeof sleepDurationHours === 'number' && sleepDurationHours < 6.5;
  const isGreatSleep = typeof sleepDurationHours === 'number' && sleepDurationHours >= 7;

  return (
    <section className="rounded-2xl bg-white dark:bg-zinc-900/90 border border-zinc-200/80 dark:border-zinc-800/90 p-4 space-y-3.5">
      {/* 头部：入睡倒计时状态 */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <div className="flex items-center justify-center w-8 h-8 rounded-xl bg-indigo-500/12 text-indigo-600 dark:text-indigo-400">
            <MoonStar className="w-4 h-4" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">作息与睡眠打卡</h2>
            <p className="text-[11px] text-zinc-500 dark:text-zinc-400 num-tabular">
              目标入睡 {bedtimeTarget} · 目标起床 {wakeTarget}
            </p>
          </div>
        </div>

        <div
          className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-medium num-tabular ${
            countdown.isPastBedtime
              ? 'bg-rose-500/10 text-rose-600 dark:text-rose-400'
              : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300'
          }`}
        >
          <AlarmClock className="w-3.5 h-3.5" />
          <span>{countdown.isPastBedtime ? countdown.label : `距入睡 ${countdown.label}`}</span>
        </div>
      </div>

      {/* 睡眠时长结果展示 */}
      <div className="flex items-center justify-between px-3 py-2.5 rounded-xl bg-zinc-50 dark:bg-zinc-800/60 border border-zinc-200/60 dark:border-zinc-700/50">
        <span className="text-xs text-zinc-600 dark:text-zinc-400">今日已记录睡眠</span>
        {typeof sleepDurationHours === 'number' ? (
          <div className="flex items-center gap-2">
            <span className="text-sm font-bold text-zinc-900 dark:text-zinc-100 num-tabular">
              {sleepDurationHours} 小时
            </span>
            <span
              className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${
                isLowSleep
                  ? 'bg-amber-500/15 text-amber-700 dark:text-amber-300'
                  : isGreatSleep
                    ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400'
                    : 'bg-zinc-200 dark:bg-zinc-700 text-zinc-700 dark:text-zinc-300'
              }`}
            >
              {isLowSleep ? '睡眠不足 · 低电量' : isGreatSleep ? '元气满格' : '尚可'}
            </span>
          </div>
        ) : (
          <span className="text-xs text-zinc-400">尚未完成早起打卡</span>
        )}
      </div>

      {/* 时间选择器与一键打卡 */}
      <div className="grid grid-cols-2 gap-2.5">
        <label className="block space-y-1">
          <span className="text-[11px] text-zinc-500 dark:text-zinc-400 flex items-center gap-1">
            <BedDouble className="w-3 h-3" /> 昨晚入睡
          </span>
          <input
            type="time"
            value={bedInput}
            onChange={(e) => setBedDraft(e.target.value)}
            className="w-full px-2.5 py-2 rounded-xl text-sm font-medium num-tabular bg-zinc-50 dark:bg-zinc-800/80 border border-zinc-200 dark:border-zinc-700 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:border-emerald-500"
          />
        </label>

        <label className="block space-y-1">
          <span className="text-[11px] text-zinc-500 dark:text-zinc-400 flex items-center gap-1">
            <Sunrise className="w-3 h-3" /> 今日起床
          </span>
          <input
            type="time"
            value={wakeInput}
            onChange={(e) => setWakeDraft(e.target.value)}
            className="w-full px-2.5 py-2 rounded-xl text-sm font-medium num-tabular bg-zinc-50 dark:bg-zinc-800/80 border border-zinc-200 dark:border-zinc-700 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:border-emerald-500"
          />
        </label>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <button
          type="button"
          disabled={saving}
          onClick={handleQuickBedNow}
          className="py-2 px-2 rounded-xl text-xs font-medium bg-zinc-100 hover:bg-zinc-200/80 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-200 transition-colors"
        >
          此刻入睡
        </button>
        <button
          type="button"
          disabled={saving}
          onClick={handleQuickWakeNow}
          className="py-2 px-2 rounded-xl text-xs font-medium bg-zinc-100 hover:bg-zinc-200/80 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-200 transition-colors"
        >
          此刻起床
        </button>
        <button
          type="button"
          disabled={saving}
          onClick={() => handleSavePair(bedInput, wakeInput)}
          className="inline-flex items-center justify-center gap-1 py-2 px-2 rounded-xl text-xs font-semibold bg-emerald-500 hover:bg-emerald-600 text-white active:scale-[0.98] transition-all"
        >
          <Check className="w-3.5 h-3.5" />
          保存打卡
        </button>
      </div>
    </section>
  );
}
