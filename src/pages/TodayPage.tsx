import { useEffect, useState } from 'react';
import {
  Activity,
  BatteryLow,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  CloudSun,
  Droplets,
  Dumbbell,
  Flame,
  Moon,
  RotateCcw,
  Scale,
  Sparkles,
  Trash2,
  TrendingDown,
  TrendingUp,
  Utensils,
} from 'lucide-react';
import type { NavTab } from '../components/layout/MobileShell';
import type { useTodaySummary } from '../hooks/useTodaySummary';
import {
  fetchAmapLiveWeather,
  getCachedAmapWeather,
  resolveCityPreset,
  type AmapLiveWeather,
} from '../lib/amap';
import { formatChineseDateLabel } from '../lib/date';
import { hapticLight } from '../lib/native';
import { DRINK_OPTIONS } from '../lib/nutrition';
import type { DrinkType } from '../types/models';

type SummaryData = ReturnType<typeof useTodaySummary>;

interface TodayPageProps {
  summary: SummaryData;
  onNavigate: (tab: NavTab) => void;
  onOpenSettings: () => void;
  onAskAi: (prompt: string, autoSend?: boolean) => void;
  onNotifyXp: (text: string) => void;
}

const HEATMAP_COLORS: Record<0 | 1 | 2 | 3 | 4, string> = {
  0: 'bg-zinc-200/80 dark:bg-zinc-800/90',
  1: 'bg-emerald-500/30 dark:bg-emerald-500/25',
  2: 'bg-emerald-500/55 dark:bg-emerald-500/50',
  3: 'bg-emerald-500/80 dark:bg-emerald-500/75',
  4: 'bg-emerald-500 dark:bg-emerald-400',
};

/** 简洁 SVG 热量圆环 */
function CalorieRing({ consumed, target }: { consumed: number; target: number }) {
  const safeTarget = Math.max(1, target);
  const ratio = Math.min(1, consumed / safeTarget);
  const over = consumed > safeTarget;
  const r = 44;
  const circumference = 2 * Math.PI * r;
  const dashOffset = circumference * (1 - ratio);
  const remaining = Math.max(0, target - consumed);

  return (
    <div className="relative flex items-center justify-center w-28 h-28 shrink-0">
      <svg className="w-28 h-28 -rotate-90" viewBox="0 0 104 104">
        <circle
          cx="52"
          cy="52"
          r={r}
          fill="none"
          stroke="currentColor"
          strokeWidth="8"
          className="text-zinc-100 dark:text-zinc-800"
        />
        <circle
          cx="52"
          cy="52"
          r={r}
          fill="none"
          stroke="currentColor"
          strokeWidth="8"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={dashOffset}
          className={`transition-all duration-500 ease-out ${over ? 'text-amber-500' : 'text-emerald-500'}`}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
        <span className="text-[11px] text-zinc-400 leading-none">{over ? '超出' : '剩余'}</span>
        <span className="text-xl font-bold text-zinc-900 dark:text-zinc-100 num-tabular leading-tight mt-0.5">
          {over ? consumed - target : remaining}
        </span>
        <span className="text-[10px] text-zinc-400">kcal</span>
      </div>
    </div>
  );
}

/**
 * 极简聚焦版首页（今日概览）：
 * - 1 张主焦点仪表卡（热量/营养 + 轻量等级与可折叠 28 天热力图 + 低电量预警）
 * - 1 组高频快捷操作（一键喝水、去吃什么、去训练）
 * - 精简可折叠的晨重、睡眠与今日餐单明细，彻底消除信息拥挤感
 */
export function TodayPage({ summary, onNavigate, onAskAi, onNotifyXp }: TodayPageProps) {
  const {
    profile,
    settings,
    habit,
    dailyTargets,
    consumed,
    todayMeals,
    todayWorkoutLog,
    rpg,
    streakDays,
    heatmap,
    lowBatteryMode,
    weightTrend,
    actions,
  } = summary;

  const [showHeatmap, setShowHeatmap] = useState(false);
  const [showDrinkPicker, setShowDrinkPicker] = useState(false);
  const [selectedDrink, setSelectedDrink] = useState<DrinkType>('water');
  const [showWeightEditor, setShowWeightEditor] = useState(false);
  const [weightInput, setWeightInput] = useState(
    String(habit.morningWeightKg ?? profile.weightKg),
  );
  const cityPreset = resolveCityPreset(profile.campus);
  const [liveWeather, setLiveWeather] = useState<AmapLiveWeather | null>(() =>
    getCachedAmapWeather(cityPreset.adcode),
  );

  // 配置高德 Key 后静默拉取用户所选城市的实况天气（30 分钟缓存，零干扰且为养生补水提供真实温湿度）
  useEffect(() => {
    const key = settings.amapWebKey.trim();
    if (!key) return;
    let cancelled = false;
    fetchAmapLiveWeather(key, cityPreset.adcode)
      .then((w) => {
        if (!cancelled) setLiveWeather(w);
      })
      .catch(() => {
        // 网络不可用时静默保留缓存或隐藏
      });
    return () => {
      cancelled = true;
    };
  }, [settings.amapWebKey, cityPreset.adcode]);

  const toggleWeightEditor = () => {
    if (!showWeightEditor) {
      // 每次打开编辑器时同步最新体重，避免读到数据库加载前的默认值 68
      setWeightInput(String(habit.morningWeightKg ?? profile.weightKg));
    }
    setShowWeightEditor((v) => !v);
  };

  const activeDrink = DRINK_OPTIONS.find((d) => d.type === selectedDrink) ?? DRINK_OPTIONS[0];
  const waterPct = Math.min(100, Math.round((habit.totalEffectiveWaterMl / Math.max(1, dailyTargets.waterMl)) * 100));

  const handleQuickDrink = async (ml = 250) => {
    void hapticLight();
    const res = await actions.logWater(selectedDrink, ml);
    onNotifyXp(
      res.gainedXp > 0
        ? `${activeDrink.shortLabel} +${res.effectiveMl}ml · +${res.gainedXp} XP`
        : `${activeDrink.shortLabel} +${res.effectiveMl}ml`,
    );
  };

  const handleToggleTraining = async () => {
    void hapticLight();
    const res = await actions.toggleTrainingDay();
    onNotifyXp(
      res.isTrainingDay
        ? `训练日已开：碳水 +${profile.trainingDayExtraCarbsG}g / 饮水 +${profile.trainingDayExtraWaterMl}ml`
        : '已切回休息日目标',
    );
  };

  const handleStretch = async () => {
    void hapticLight();
    const res = await actions.logStretch();
    onNotifyXp(
      res.gainedXp > 0 ? `拉伸第 ${res.count} 次 · +${res.gainedXp} XP` : `拉伸第 ${res.count} 次完成`,
    );
  };

  const handleSaveWeight = async () => {
    const val = Number(weightInput);
    if (Number.isNaN(val) || val < 30 || val > 200) {
      onNotifyXp('请输入合理的体重（kg）');
      return;
    }
    const res = await actions.logMorningWeight(val);
    setShowWeightEditor(false);
    onNotifyXp(
      res.gainedXp > 0 ? `晨重 ${val.toFixed(1)}kg 已记 · +${res.gainedXp} XP` : `已更新晨重 ${val.toFixed(1)}kg`,
    );
  };

  const handleApplyWeightDelta = async () => {
    if (weightTrend.suggestedCalorieDelta === 0) return;
    const nextCal = await actions.applyCalorieAdjustment(weightTrend.suggestedCalorieDelta);
    onNotifyXp(`每日热量目标已微调至 ${nextCal} kcal`);
  };

  return (
    <div className="space-y-4">
      {/* 顶部日期 + 单一状态开关 */}
      <div className="flex items-center justify-between gap-2 px-0.5">
        <div>
          <h1 className="text-base font-bold text-zinc-900 dark:text-zinc-100">
            {formatChineseDateLabel()}
          </h1>
          <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5 num-tabular flex items-center gap-1.5 flex-wrap">
            <span>
              Lv.{rpg.level} {rpg.title} · 连胜 {streakDays} 天
            </span>
            {liveWeather && (
              <span className="inline-flex items-center gap-0.5 text-[11px] text-sky-600 dark:text-sky-400">
                <CloudSun className="w-3 h-3" />
                {liveWeather.weather} {liveWeather.temperature}°C 湿{liveWeather.humidity}%
              </span>
            )}
          </p>
        </div>

        <button
          type="button"
          onClick={handleToggleTraining}
          className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold transition-all active:scale-95 ${
            habit.isTrainingDay
              ? 'bg-[#1a6e5e] text-white shadow-sm'
              : 'bg-white dark:bg-zinc-900 text-zinc-700 dark:text-zinc-300 border border-zinc-200 dark:border-zinc-800'
          }`}
        >
          <Dumbbell className="w-3.5 h-3.5" />
          <span>{habit.isTrainingDay ? '训练日' : '休息日'}</span>
        </button>
      </div>

      {/* 低电量恢复预警（仅睡眠不足 6.5h 才出现，绝不常驻干扰） */}
      {lowBatteryMode && (
        <div className="flex items-start gap-2.5 p-3.5 rounded-2xl bg-amber-500/10 border border-amber-500/25 text-amber-900 dark:text-amber-300">
          <BatteryLow className="w-4 h-4 shrink-0 mt-0.5" />
          <p className="text-xs leading-relaxed">
            <span className="font-semibold">低电量恢复模式：</span>
            昨晚睡 {habit.sleepDurationHours}h（不足 6.5h），今日建议训练减载 20%、多补电解质并早睡。
          </p>
        </div>
      )}

      {/* 唯一主视觉焦点卡：今日热量与营养 + 轻量化进度 */}
      <section
        data-tour="today-rpg"
        className="rounded-3xl bg-white dark:bg-zinc-900/95 border border-zinc-200/70 dark:border-zinc-800/80 p-5 space-y-4 shadow-xs"
      >
        <div className="flex items-center gap-5">
          <CalorieRing consumed={consumed.calories} target={dailyTargets.calories} />

          <div className="flex-1 space-y-3 min-w-0">
            {[
              { label: '蛋白质', cur: consumed.proteinG, max: dailyTargets.proteinG, bar: 'bg-sky-500' },
              { label: '碳水', cur: consumed.carbsG, max: dailyTargets.carbsG, bar: 'bg-amber-500' },
              { label: '脂肪', cur: consumed.fatG, max: dailyTargets.fatG, bar: 'bg-rose-400' },
            ].map((m) => {
              const pct = Math.min(100, Math.round((m.cur / Math.max(1, m.max)) * 100));
              return (
                <div key={m.label} className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-zinc-500 dark:text-zinc-400">{m.label}</span>
                    <span className="font-semibold text-zinc-900 dark:text-zinc-100 num-tabular">
                      {m.cur}
                      <span className="text-zinc-400 font-normal">/{m.max}g</span>
                    </span>
                  </div>
                  <div className="h-1.5 rounded-full bg-zinc-100 dark:bg-zinc-800 overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-300 ${m.bar}`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* 底部轻信息栏：今日花费 + 经验条折叠开关 */}
        <div className="flex items-center justify-between pt-3 border-t border-zinc-100 dark:border-zinc-800/80 text-xs">
          <span className="text-zinc-500 dark:text-zinc-400 num-tabular">
            今日餐费 <strong className="text-zinc-800 dark:text-zinc-200">¥{consumed.spentYuan}</strong> / ¥{profile.dailyBudgetYuan}
          </span>
          <button
            type="button"
            onClick={() => setShowHeatmap((v) => !v)}
            className="inline-flex items-center gap-1 text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-200 font-medium"
          >
            <Flame className="w-3.5 h-3.5 text-emerald-500" />
            <span className="num-tabular">+{habit.xpEarned} XP</span>
            {showHeatmap ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </button>
        </div>

        {/* 按需展开：经验进度与 28 天自律热力图 */}
        {showHeatmap && (
          <div className="pt-2 space-y-3 border-t border-zinc-100 dark:border-zinc-800/80">
            <div className="flex items-center justify-between text-[11px] text-zinc-500">
              <span>升级进度（Lv.{rpg.level}）</span>
              <span className="num-tabular">{rpg.currentLevelXp}/{rpg.nextLevelXp} XP</span>
            </div>
            <div className="h-1.5 rounded-full bg-zinc-100 dark:bg-zinc-800 overflow-hidden">
              <div className="h-full rounded-full bg-emerald-500" style={{ width: `${rpg.progressPercent}%` }} />
            </div>
            <div className="grid grid-cols-14 gap-1.5 pt-1">
              {heatmap.map((cell) => (
                <div
                  key={cell.date}
                  title={`${cell.date} · ${cell.xp} XP`}
                  className={`aspect-square rounded-[4px] ${HEATMAP_COLORS[cell.level]} ${
                    cell.isToday ? 'ring-1.5 ring-emerald-500' : ''
                  }`}
                />
              ))}
            </div>
          </div>
        )}
      </section>

      {/* 核心高频三联操作（喝水 / 吃啥 / 训练） */}
      <div className="grid grid-cols-3 gap-2.5">
        <button
          type="button"
          onClick={() => handleQuickDrink(250)}
          className="flex flex-col items-start justify-between p-3.5 rounded-2xl bg-white dark:bg-zinc-900/95 border border-zinc-200/70 dark:border-zinc-800/80 active:scale-[0.97] transition-transform text-left"
        >
          <div className="flex items-center justify-between w-full">
            <Droplets className="w-4 h-4 text-sky-500" />
            <span className="text-[11px] font-semibold text-sky-600 dark:text-sky-400 num-tabular">
              {waterPct}%
            </span>
          </div>
          <div className="mt-3">
            <p className="text-xs font-bold text-zinc-900 dark:text-zinc-100">+250ml</p>
            <p className="text-[11px] text-zinc-400 num-tabular mt-0.5 truncate">
              {habit.totalEffectiveWaterMl}/{dailyTargets.waterMl}
            </p>
          </div>
        </button>

        <button
          type="button"
          onClick={() => onNavigate('diet')}
          className="flex flex-col items-start justify-between p-3.5 rounded-2xl bg-white dark:bg-zinc-900/95 border border-zinc-200/70 dark:border-zinc-800/80 active:scale-[0.97] transition-transform text-left"
        >
          <Utensils className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
          <div className="mt-3">
            <p className="text-xs font-bold text-zinc-900 dark:text-zinc-100">吃什么</p>
            <p className="text-[11px] text-zinc-400 num-tabular mt-0.5">
              已记 {todayMeals.length} 餐
            </p>
          </div>
        </button>

        <button
          type="button"
          onClick={() => onNavigate('workout')}
          className="flex flex-col items-start justify-between p-3.5 rounded-2xl bg-white dark:bg-zinc-900/95 border border-zinc-200/70 dark:border-zinc-800/80 active:scale-[0.97] transition-transform text-left"
        >
          <Dumbbell className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
          <div className="mt-3">
            <p className="text-xs font-bold text-zinc-900 dark:text-zinc-100">
              {todayWorkoutLog ? '已完赛' : '去训练'}
            </p>
            <p className="text-[11px] text-zinc-400 num-tabular mt-0.5 truncate">
              {todayWorkoutLog ? `${todayWorkoutLog.totalVolumeKg}kg` : '64 动作示范'}
            </p>
          </div>
        </button>
      </div>

      {/* 换饮品微条（按需切换，默认极简 1 行 + 首页误点喝水一键撤销） */}
      <div className="flex items-center justify-between gap-2 px-1 text-xs text-zinc-500">
        <div className="flex items-center gap-2 min-w-0">
          <button
            type="button"
            onClick={() => setShowDrinkPicker((v) => !v)}
            className="inline-flex items-center gap-1 hover:text-zinc-800 dark:hover:text-zinc-200 truncate"
          >
            <span className="truncate">
              快捷饮品：{activeDrink.shortLabel} (×{activeDrink.factor})
            </span>
            {showDrinkPicker ? <ChevronUp className="w-3.5 h-3.5 shrink-0" /> : <ChevronDown className="w-3.5 h-3.5 shrink-0" />}
          </button>
          {habit.waterEntries.length > 0 && (
            <button
              type="button"
              onClick={async () => {
                const ok = await actions.undoLastWater();
                if (ok) onNotifyXp('已撤销上一杯饮水');
              }}
              className="shrink-0 inline-flex items-center gap-0.5 text-[11px] text-zinc-400 hover:text-rose-500"
              title="撤销上一笔喝水"
            >
              <RotateCcw className="w-3 h-3" />
              撤销
            </button>
          )}
        </div>
        <button
          type="button"
          onClick={() =>
            onAskAi('简短复盘我今天的热量、饮水、睡眠和训练进度，告诉我接下来最该做哪 1 件事。')
          }
          className="shrink-0 inline-flex items-center gap-1 font-semibold text-[#166556] dark:text-emerald-400"
        >
          <Sparkles className="w-3.5 h-3.5" />
          AI 复盘
        </button>
      </div>

      {showDrinkPicker && (
        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar">
          {DRINK_OPTIONS.map((d) => (
            <button
              key={d.type}
              type="button"
              onClick={() => {
                setSelectedDrink(d.type);
                setShowDrinkPicker(false);
              }}
              className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                d.type === selectedDrink
                  ? 'bg-zinc-900 text-white border-zinc-900 dark:bg-zinc-100 dark:text-zinc-900'
                  : 'bg-white dark:bg-zinc-900 text-zinc-600 dark:text-zinc-300 border-zinc-200 dark:border-zinc-800'
              }`}
            >
              {d.shortLabel} ×{d.factor}
            </button>
          ))}
        </div>
      )}

      {/* 今日饮食流水（仅在已记餐时出现，简洁明了） */}
      {todayMeals.length > 0 && (
        <section className="rounded-2xl bg-white dark:bg-zinc-900/95 border border-zinc-200/70 dark:border-zinc-800/80 divide-y divide-zinc-100 dark:divide-zinc-800/80">
          {todayMeals.map((m) => (
            <div key={m.id} className="flex items-center justify-between gap-3 px-4 py-3">
              <div className="min-w-0">
                <p className="text-xs font-semibold text-zinc-900 dark:text-zinc-100 truncate">
                  {m.foodName}
                </p>
                <p className="text-[11px] text-zinc-400 num-tabular mt-0.5">
                  {m.storeName} · {m.calories} kcal · 蛋{m.proteinG}g · ¥{m.priceYuan}
                </p>
              </div>
              {m.id !== undefined && (
                <button
                  type="button"
                  onClick={async () => {
                    await actions.deleteMealLog(m.id!);
                    onNotifyXp(`已移除：${m.foodName}`);
                  }}
                  aria-label="删除"
                  className="p-1.5 rounded-lg text-zinc-400 hover:text-rose-500 shrink-0"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          ))}
        </section>
      )}

      {/* 轻量今日健康清单（睡眠 / 晨重 / 拉伸 合并为一张干净列表，告别卡片堆砌） */}
      <section className="rounded-2xl bg-white dark:bg-zinc-900/95 border border-zinc-200/70 dark:border-zinc-800/80 divide-y divide-zinc-100 dark:divide-zinc-800/80">
        {/* 睡眠一行 */}
        <button
          type="button"
          onClick={() => onNavigate('routine')}
          className="w-full flex items-center justify-between gap-3 px-4 py-3.5 text-left hover:bg-zinc-50 dark:hover:bg-zinc-800/40 transition-colors first:rounded-t-2xl"
        >
          <div className="flex items-center gap-3 min-w-0">
            <Moon className="w-4 h-4 text-indigo-500 shrink-0" />
            <div className="min-w-0">
              <p className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">昨晚睡眠</p>
              <p className="text-[11px] text-zinc-400 mt-0.5 num-tabular">
                {typeof habit.sleepDurationHours === 'number'
                  ? `已睡 ${habit.sleepDurationHours} 小时（目标 ${profile.bedtimeTarget} 入睡）`
                  : `未打卡 · 目标 ${profile.bedtimeTarget} 入睡`}
              </p>
            </div>
          </div>
          <ChevronRight className="w-4 h-4 text-zinc-400 shrink-0" />
        </button>

        {/* 晨重一行（点开即录） */}
        <div className="px-4 py-3.5 space-y-2.5">
          <div className="flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={toggleWeightEditor}
              className="flex items-center gap-3 min-w-0 flex-1 text-left"
            >
              <Scale className="w-4 h-4 text-violet-500 shrink-0" />
              <div className="min-w-0">
                <p className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">晨重与趋势</p>
                <p className="text-[11px] text-zinc-400 mt-0.5 num-tabular">
                  {typeof habit.morningWeightKg === 'number'
                    ? `今日 ${habit.morningWeightKg.toFixed(1)}kg · 目标 ${profile.targetWeightKg}kg`
                    : `未记晨重 · 目标 ${profile.targetWeightKg}kg`}
                </p>
              </div>
            </button>
            <button
              type="button"
              onClick={toggleWeightEditor}
              className="text-xs font-semibold text-emerald-600 dark:text-emerald-400 shrink-0"
            >
              {showWeightEditor ? '收起' : '记录'}
            </button>
          </div>

          {showWeightEditor && (
            <div className="space-y-2 pt-1">
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  step="0.1"
                  min={30}
                  max={200}
                  value={weightInput}
                  onChange={(e) => setWeightInput(e.target.value)}
                  className="flex-1 px-3 py-2 rounded-xl text-xs font-semibold num-tabular bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700"
                />
                <button
                  type="button"
                  onClick={handleSaveWeight}
                  className="inline-flex items-center gap-1 px-3.5 py-2 rounded-xl text-xs font-semibold bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900"
                >
                  <Check className="w-3.5 h-3.5" />
                  保存
                </button>
              </div>
              <p className="text-[11px] text-zinc-400">{weightTrend.suggestionText}</p>
            </div>
          )}

          {weightTrend.suggestedCalorieDelta !== 0 && (
            <button
              type="button"
              onClick={handleApplyWeightDelta}
              className="w-full inline-flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-semibold bg-emerald-500/12 text-emerald-700 dark:text-emerald-400"
            >
              {weightTrend.suggestedCalorieDelta < 0 ? (
                <TrendingDown className="w-3.5 h-3.5" />
              ) : (
                <TrendingUp className="w-3.5 h-3.5" />
              )}
              按周趋势微调热量（{weightTrend.suggestedCalorieDelta > 0 ? '+' : ''}
              {weightTrend.suggestedCalorieDelta} kcal）
            </button>
          )}
        </div>

        {/* 久坐拉伸一行 */}
        <div className="flex items-center justify-between gap-3 px-4 py-3.5">
          <div className="flex items-center gap-3 min-w-0">
            <Activity className="w-4 h-4 text-emerald-500 shrink-0" />
            <div>
              <p className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">久坐肩颈拉伸</p>
              <p className="text-[11px] text-zinc-400 mt-0.5 num-tabular">
                今日已做 {habit.stretchCount} 次
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleStretch}
            className="px-3 py-1.5 rounded-xl text-xs font-semibold bg-zinc-100 hover:bg-zinc-200/80 dark:bg-zinc-800 text-zinc-800 dark:text-zinc-200 active:scale-95"
          >
            +1 次
          </button>
        </div>
      </section>
    </div>
  );
}
