import { useState } from 'react';
import { Droplets, RotateCcw } from 'lucide-react';
import { DRINK_OPTIONS } from '../../lib/nutrition';
import type { DrinkType, WaterEntry } from '../../types/models';

interface QuickWaterCardProps {
  totalEffectiveMl: number;
  totalRawMl: number;
  targetWaterMl: number;
  isTrainingDay: boolean;
  entries: WaterEntry[];
  onLogWater: (drinkType: DrinkType, rawMl: number) => Promise<void>;
  onUndoLast: () => Promise<void>;
  compact?: boolean;
}

const VOLUME_PRESETS = [150, 250, 350, 500];

/**
 * 快捷喝水打卡组件：支持 6 种饮品补水系数自动折算、快捷容量、撤销与记录流水
 */
export function QuickWaterCard({
  totalEffectiveMl,
  totalRawMl,
  targetWaterMl,
  isTrainingDay,
  entries,
  onLogWater,
  onUndoLast,
  compact = false,
}: QuickWaterCardProps) {
  const [selectedDrink, setSelectedDrink] = useState<DrinkType>('water');
  const [busy, setBusy] = useState(false);

  const activeOption = DRINK_OPTIONS.find((d) => d.type === selectedDrink) ?? DRINK_OPTIONS[0];
  const percent = Math.min(100, Math.round((totalEffectiveMl / Math.max(1, targetWaterMl)) * 100));
  const remaining = Math.max(0, targetWaterMl - totalEffectiveMl);

  const handleAdd = async (ml: number) => {
    if (busy) return;
    setBusy(true);
    try {
      await onLogWater(selectedDrink, ml);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="rounded-2xl bg-white dark:bg-zinc-900/90 border border-zinc-200/80 dark:border-zinc-800/90 p-4 space-y-3.5">
      {/* 标题与进度数值 */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <div className="flex items-center justify-center w-8 h-8 rounded-xl bg-sky-500/12 text-sky-600 dark:text-sky-400">
            <Droplets className="w-4 h-4" />
          </div>
          <div>
            <div className="flex items-center gap-1.5">
              <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">有效补水进度</h2>
              {isTrainingDay && (
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-sky-500/10 text-sky-600 dark:text-sky-400 font-medium">
                  训练日加成
                </span>
              )}
            </div>
            <p className="text-[11px] text-zinc-500 dark:text-zinc-400 num-tabular">
              实际饮用 {totalRawMl} ml · {remaining > 0 ? `还差 ${remaining} ml` : '今日补水达标'}
            </p>
          </div>
        </div>

        <div className="text-right">
          <div className="text-base font-bold text-zinc-900 dark:text-zinc-100 num-tabular">
            {totalEffectiveMl}
            <span className="text-xs font-normal text-zinc-400"> / {targetWaterMl} ml</span>
          </div>
          <div className="text-[11px] font-medium text-sky-600 dark:text-sky-400 num-tabular">
            {percent}%
          </div>
        </div>
      </div>

      {/* 补水进度条 */}
      <div className="h-2 w-full rounded-full bg-zinc-200/80 dark:bg-zinc-800 overflow-hidden">
        <div
          className="h-full rounded-full bg-sky-500 transition-all duration-300 ease-out"
          style={{ width: `${percent}%` }}
        />
      </div>

      {/* 饮品类型与补水系数选择条 */}
      <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-0.5">
        {DRINK_OPTIONS.map((drink) => {
          const isSelected = drink.type === selectedDrink;
          return (
            <button
              key={drink.type}
              type="button"
              onClick={() => setSelectedDrink(drink.type)}
              className={`shrink-0 px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                isSelected
                  ? 'bg-zinc-900 text-white border-zinc-900 dark:bg-zinc-100 dark:text-zinc-900 dark:border-zinc-100'
                  : 'bg-zinc-50 text-zinc-600 border-zinc-200/80 hover:bg-zinc-100 dark:bg-zinc-800/60 dark:text-zinc-300 dark:border-zinc-700/70'
              }`}
            >
              <span>{drink.shortLabel}</span>
              <span className="ml-1 text-[10px] opacity-75 num-tabular">×{drink.factor}</span>
            </button>
          );
        })}
      </div>

      {/* 快捷容量记录按钮 */}
      <div className="grid grid-cols-4 gap-2">
        {VOLUME_PRESETS.map((ml) => {
          const eff = Math.round(ml * activeOption.factor);
          return (
            <button
              key={ml}
              type="button"
              disabled={busy}
              onClick={() => handleAdd(ml)}
              className="flex flex-col items-center justify-center py-2 px-1 rounded-xl border border-zinc-200/90 dark:border-zinc-800 bg-zinc-50 hover:bg-sky-500/10 hover:border-sky-500/40 dark:bg-zinc-800/50 dark:hover:bg-sky-500/15 active:scale-[0.98] transition-all"
            >
              <span className="text-xs font-semibold text-zinc-900 dark:text-zinc-100 num-tabular">
                +{ml}ml
              </span>
              <span className="text-[10px] text-zinc-500 dark:text-zinc-400 num-tabular">
                折合 {eff}
              </span>
            </button>
          );
        })}
      </div>

      {/* 最近饮水记录与撤销 */}
      {entries.length > 0 && (
        <div className="pt-2 border-t border-zinc-100 dark:border-zinc-800/80 flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar text-[11px] text-zinc-500 dark:text-zinc-400">
            {entries.slice(0, compact ? 2 : 5).map((item) => (
              <span
                key={item.id}
                className="shrink-0 px-2 py-0.5 rounded-md bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 num-tabular"
              >
                {item.label} {item.rawMl}ml → {item.effectiveMl}
              </span>
            ))}
          </div>

          <button
            type="button"
            onClick={onUndoLast}
            className="shrink-0 inline-flex items-center gap-1 text-[11px] text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-200 px-2 py-1 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
          >
            <RotateCcw className="w-3 h-3" />
            撤销
          </button>
        </div>
      )}
    </section>
  );
}
