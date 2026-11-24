import { BatteryLow, Flame, ShieldCheck, Sparkles } from 'lucide-react';
import type { HeatmapCell, RpgLevelState } from '../../lib/rpg';

interface RpgStatusCardProps {
  nickname: string;
  campus: string;
  rpg: RpgLevelState;
  todayXp: number;
  streakDays: number;
  heatmap: HeatmapCell[];
  lowBatteryMode: boolean;
  sleepDurationHours?: number;
  isTrainingDay: boolean;
}

const HEATMAP_COLORS: Record<0 | 1 | 2 | 3 | 4, string> = {
  0: 'bg-zinc-200/80 dark:bg-zinc-800/90',
  1: 'bg-emerald-500/30 dark:bg-emerald-500/25',
  2: 'bg-emerald-500/55 dark:bg-emerald-500/50',
  3: 'bg-emerald-500/80 dark:bg-emerald-500/75',
  4: 'bg-emerald-500 dark:bg-emerald-400',
};

/**
 * 首页核心 RPG 状态面板：等级称号、经验进度条、连胜天数、28 天热力图、低电量恢复告警
 */
export function RpgStatusCard({
  nickname,
  rpg,
  todayXp,
  streakDays,
  heatmap,
  lowBatteryMode,
  sleepDurationHours,
  isTrainingDay,
}: RpgStatusCardProps) {
  return (
    <section className="rounded-2xl bg-white dark:bg-zinc-900/90 border border-zinc-200/80 dark:border-zinc-800/90 p-4 space-y-4">
      {/* 头部：等级徽章 + 昵称 + 连胜 */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="relative flex flex-col items-center justify-center w-12 h-12 rounded-xl bg-zinc-900 dark:bg-zinc-800 text-white shrink-0 border border-zinc-700/50">
            <span className="text-[10px] uppercase tracking-wider text-emerald-400 font-semibold leading-none">
              LV
            </span>
            <span className="text-lg font-bold num-tabular leading-tight">{rpg.level}</span>
          </div>

          <div className="min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap">
              <h1 className="text-base font-semibold text-zinc-900 dark:text-zinc-100 truncate">
                {nickname}
              </h1>
              <span className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-700 dark:text-emerald-400">
                <Sparkles className="w-3 h-3" />
                {rpg.title}
              </span>
            </div>
            <p className="text-xs text-zinc-500 dark:text-zinc-400 truncate mt-0.5">
              {isTrainingDay ? '今日状态：训练日 · 碳水与饮水自动加成' : '今日状态：常规休息日 · 稳控代谢'}
            </p>
          </div>
        </div>

        <div className="flex flex-col items-end shrink-0">
          <div className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-amber-500/10 text-amber-600 dark:text-amber-400">
            <Flame className="w-3.5 h-3.5 fill-current" />
            <span className="text-xs font-semibold num-tabular">{streakDays} 天连胜</span>
          </div>
          <span className="text-[11px] text-zinc-500 dark:text-zinc-400 mt-1 num-tabular">
            今日 +{todayXp} XP
          </span>
        </div>
      </div>

      {/* 经验进度条 */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between text-xs">
          <span className="text-zinc-500 dark:text-zinc-400">升级经验进度</span>
          <span className="font-medium text-zinc-700 dark:text-zinc-300 num-tabular">
            {rpg.currentLevelXp} / {rpg.nextLevelXp} XP ({rpg.progressPercent}%)
          </span>
        </div>
        <div className="h-2 w-full rounded-full bg-zinc-200/80 dark:bg-zinc-800 overflow-hidden">
          <div
            className="h-full rounded-full bg-emerald-500 transition-all duration-500 ease-out"
            style={{ width: `${rpg.progressPercent}%` }}
          />
        </div>
      </div>

      {/* 低电量恢复模式告警条（睡眠不足 6.5h 自动触发） */}
      {lowBatteryMode && (
        <div className="flex items-start gap-2.5 p-3 rounded-xl bg-amber-500/10 border border-amber-500/25 text-amber-800 dark:text-amber-300">
          <BatteryLow className="w-4 h-4 shrink-0 mt-0.5" />
          <div className="text-xs leading-relaxed">
            <p className="font-semibold">已触发「低电量恢复模式」</p>
            <p className="opacity-90 mt-0.5">
              昨晚仅睡 <span className="num-tabular font-semibold">{sleepDurationHours}h</span>（低于 6.5h）。建议今日力量训练减量 20%、补充电解质水，并提前 30 分钟入睡。
            </p>
          </div>
        </div>
      )}

      {/* 近 28 天活跃连胜热力图 */}
      <div className="pt-1 border-t border-zinc-100 dark:border-zinc-800/80">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[11px] font-medium text-zinc-500 dark:text-zinc-400 flex items-center gap-1">
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-500" />
            近 28 天自律热力图
          </span>
          <div className="flex items-center gap-1 text-[10px] text-zinc-400">
            <span>少</span>
            {([0, 1, 2, 3, 4] as const).map((lv) => (
              <span key={lv} className={`w-2.5 h-2.5 rounded-[3px] ${HEATMAP_COLORS[lv]}`} />
            ))}
            <span>多</span>
          </div>
        </div>

        <div className="grid grid-cols-14 gap-1.5">
          {heatmap.map((cell) => (
            <div
              key={cell.date}
              title={`${cell.date} · ${cell.xp} XP`}
              className={`aspect-square rounded-[4px] transition-colors ${HEATMAP_COLORS[cell.level]} ${
                cell.isToday ? 'ring-1.5 ring-emerald-500 ring-offset-1 ring-offset-white dark:ring-offset-zinc-900' : ''
              }`}
            />
          ))}
        </div>
      </div>
    </section>
  );
}
