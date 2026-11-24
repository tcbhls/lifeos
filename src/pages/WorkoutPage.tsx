import { useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Layers,
  Minus,
  Play,
  Plus,
  RotateCcw,
  Search,
  Shuffle,
  Square,
  Timer,
  Trash2,
  TrendingUp,
  Video,
  X,
} from 'lucide-react';
import { ExerciseDemoModal } from '../components/workout/ExerciseDemoModal';
import {
  buildDefaultFiveDaySplitPlan,
  EQUIPMENT_LABELS,
  EXERCISE_LIBRARY,
  findExerciseInLibrary,
  getExerciseGifUrl,
  MUSCLE_CATEGORIES,
  pickRandomBonusExercise,
  WORKOUT_PLAN_TEMPLATES,
  type EquipmentType,
  type ExerciseLibraryItem,
  type MuscleCategoryId,
  type WorkoutPlanTemplate,
} from '../data/exerciseLibrary';
import { db } from '../db/database';
import type { useTodaySummary } from '../hooks/useTodaySummary';
import { hapticLight, hapticSuccess } from '../lib/native';
import type { ExerciseLogEntry, WorkoutLog, WorkoutPlanExercise } from '../types/models';

type SummaryData = ReturnType<typeof useTodaySummary>;

interface WorkoutPageProps {
  summary: SummaryData;
  onAskAi: (prompt: string, autoSend?: boolean) => void;
  onNotify: (text: string) => void;
}

interface ProgressionHint {
  nextWeightKg: number;
  nextTargetReps: number;
  advice: string;
  hasHistory: boolean;
  isUpgrade: boolean;
}

/** 根据历史同动作训练日志推算双进阶建议 */
function getExerciseProgression(ex: WorkoutPlanExercise, logs: WorkoutLog[]): ProgressionHint {
  const sorted = [...logs].sort((a, b) => b.createdAt - a.createdAt);
  for (const log of sorted) {
    const matched = log.exercises.find((e) => e.exerciseName === ex.name);
    if (!matched || matched.sets.length === 0) continue;
    const completed = matched.sets.filter((s) => s.completed);
    const sample = completed.length > 0 ? completed : matched.sets;
    const maxWeight = Math.max(...sample.map((s) => s.weightKg));
    const avgReps = Math.round(sample.reduce((s, x) => s + x.reps, 0) / sample.length);
    const allHitTop = sample.every((s) => s.reps >= ex.targetRepMax);

    if (allHitTop && maxWeight > 0) {
      const nextW = Math.round((maxWeight + 2.5) * 2) / 2;
      return {
        nextWeightKg: nextW,
        nextTargetReps: ex.targetRepMin,
        advice: `建议加重至 ${nextW}kg × ${ex.targetRepMin}次`,
        hasHistory: true,
        isUpgrade: true,
      };
    }
    return {
      nextWeightKg: maxWeight,
      nextTargetReps: Math.min(ex.targetRepMax, avgReps + 1),
      advice: `上次 ${maxWeight}kg · 今日冲 ${Math.min(ex.targetRepMax, avgReps + 1)} 次`,
      hasHistory: true,
      isUpgrade: false,
    };
  }

  const defaultW = /俯卧撑|引体|平板|卷腹|箭步|悬垂|拉伸|波比|跳绳|死虫|转体|派克|慢跑/.test(ex.name)
    ? 0
    : /深蹲|硬拉|倒蹬|臀推/.test(ex.name)
      ? 40
      : /卧推|划船|下拉/.test(ex.name)
        ? 30
        : 12;

  return {
    nextWeightKg: defaultW,
    nextTargetReps: ex.targetRepMin,
    advice: '',
    hasHistory: false,
    isUpgrade: false,
  };
}

/**
 * 极简专注版健身页：
 * - 清晰双栏：今日计划 / 动作库 (64)
 * - 每条动作左侧直接展示 3D 模型缩略图，点卡片即看 3D 模型动图 + 抖音/B站真人教学
 * - 健身房专注模式支持组间倒计时与一键结算
 */
export function WorkoutPage({ summary, onAskAi, onNotify }: WorkoutPageProps) {
  const { actions } = summary;
  const plans = useLiveQuery(() => db.workoutPlans.toArray(), []);
  const rawWorkoutLogs = useLiveQuery(() => db.workoutLogs.toArray(), []);
  const workoutLogs = useMemo(() => rawWorkoutLogs ?? [], [rawWorkoutLogs]);

  const activePlan = plans?.[0];

  const [subView, setSubView] = useState<'plan' | 'library'>('plan');
  const [selectedDayId, setSelectedDayId] = useState<string>('');
  const [showTemplates, setShowTemplates] = useState(false);
  const [showResetPanel, setShowResetPanel] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  // 动作库筛选态
  const [libCategory, setLibCategory] = useState<'all' | MuscleCategoryId>('all');
  const [libEquipment, setLibEquipment] = useState<'all' | EquipmentType>('all');
  const [libSearch, setLibSearch] = useState('');

  // 动作演示弹窗态（附带可选移除回调）
  const [demoState, setDemoState] = useState<{
    exercise: ExerciseLibraryItem;
    planExerciseId?: string;
  } | null>(null);

  // 专注模式态
  const [inFocusMode, setInFocusMode] = useState(false);
  const [sessionStartMs, setSessionStartMs] = useState(0);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [sessionEntries, setSessionEntries] = useState<ExerciseLogEntry[]>([]);
  const [restRemainingSec, setRestRemainingSec] = useState(0);
  const [restTotalSec, setRestTotalSec] = useState(90);

  // 手写自定义动作
  const [showAddEx, setShowAddEx] = useState(false);
  const [newExName, setNewExName] = useState('');
  const [newExMuscle, setNewExMuscle] = useState('胸/背/腿');
  const [newExSets, setNewExSets] = useState(3);
  const [newExRest, setNewExRest] = useState(90);

  const currentDay = useMemo(() => {
    if (!activePlan || activePlan.days.length === 0) return null;
    return activePlan.days.find((d) => d.id === selectedDayId) ?? activePlan.days[0];
  }, [activePlan, selectedDayId]);

  /** 匹配当前计划对应的标准出厂模板（用于一键初始化当前日或整套分化） */
  const baselineDays = useMemo(() => {
    const matchedTpl = WORKOUT_PLAN_TEMPLATES.find((t) => t.name === activePlan?.name);
    if (matchedTpl) return matchedTpl.days;
    return buildDefaultFiveDaySplitPlan().days;
  }, [activePlan?.name]);

  const baselineCurrentDay = useMemo(() => {
    if (!currentDay) return null;
    const byId = baselineDays.find((d) => d.id === currentDay.id);
    if (byId) return byId;
    const curIdx = activePlan?.days.findIndex((d) => d.id === currentDay.id) ?? -1;
    return curIdx >= 0 ? (baselineDays[curIdx] ?? baselineDays[0] ?? null) : (baselineDays[0] ?? null);
  }, [baselineDays, currentDay, activePlan?.days]);

  /** 判断当天动作是否已被临时增删（相对默认模板有变动） */
  const isCurrentDayModified = useMemo(() => {
    if (!currentDay || !baselineCurrentDay) return false;
    const curNames = currentDay.exercises.map((e) => e.name).join('|');
    const baseNames = baselineCurrentDay.exercises.map((e) => e.name).join('|');
    return curNames !== baseNames;
  }, [currentDay, baselineCurrentDay]);

  // 演示弹窗打开时，同步注册给 Android 原生返回键关闭钩子
  useEffect(() => {
    const win = window as Window & { __lifeosCloseTopModal?: () => boolean };
    if (!demoState && !showResetPanel && !showTemplates) return undefined;
    const prev = win.__lifeosCloseTopModal;
    win.__lifeosCloseTopModal = () => {
      if (demoState) {
        setDemoState(null);
        return true;
      }
      if (showResetPanel) {
        setShowResetPanel(false);
        return true;
      }
      if (showTemplates) {
        setShowTemplates(false);
        return true;
      }
      return prev ? prev() : false;
    };
    return () => {
      win.__lifeosCloseTopModal = prev;
    };
  }, [demoState, showResetPanel, showTemplates]);

  const filteredLibrary = useMemo(() => {
    const kw = libSearch.trim().toLowerCase();
    return EXERCISE_LIBRARY.filter((ex) => {
      if (libCategory !== 'all' && ex.category !== libCategory) return false;
      if (libEquipment !== 'all' && ex.equipment !== libEquipment) return false;
      if (kw) {
        const hay = `${ex.name} ${ex.englishName} ${ex.muscleGroup} ${EQUIPMENT_LABELS[ex.equipment]}`.toLowerCase();
        if (!hay.includes(kw)) return false;
      }
      return true;
    });
  }, [libCategory, libEquipment, libSearch]);

  useEffect(() => {
    if (!inFocusMode) return;
    const id = window.setInterval(() => {
      setElapsedSec(Math.max(0, Math.floor((Date.now() - sessionStartMs) / 1000)));
    }, 1000);
    return () => window.clearInterval(id);
  }, [inFocusMode, sessionStartMs]);

  useEffect(() => {
    if (restRemainingSec <= 0) return;
    const id = window.setInterval(() => {
      setRestRemainingSec((prev) => {
        if (prev <= 1) {
          void hapticSuccess();
          onNotify('组间休息结束，准备下一组');
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => window.clearInterval(id);
  }, [restRemainingSec, onNotify]);

  const handleSwitchTemplate = async (tpl: WorkoutPlanTemplate) => {
    if (!activePlan) return;
    await db.workoutPlans.put({
      ...activePlan,
      name: tpl.name,
      splitType: tpl.splitType,
      days: tpl.days.map((d) => ({ ...d, exercises: d.exercises.map((e) => ({ ...e })) })),
      updatedAt: Date.now(),
    });
    setSelectedDayId(tpl.days[0]?.id ?? '');
    setShowTemplates(false);
    setShowResetPanel(false);
    void hapticSuccess();
    onNotify(`已切换模板：${tpl.name}`);
  };

  /** 初始化选项 1：将当前训练日恢复为默认动作（清除今天加的临时动作/随机核心） */
  const handleResetCurrentDay = async () => {
    if (!activePlan || !currentDay || !baselineCurrentDay) return;
    await db.workoutPlans.put({
      ...activePlan,
      days: activePlan.days.map((d) =>
        d.id === currentDay.id
          ? {
              ...d,
              exercises: baselineCurrentDay.exercises.map((e) => ({ ...e })),
            }
          : d,
      ),
      updatedAt: Date.now(),
    });
    setShowResetPanel(false);
    void hapticSuccess();
    onNotify(`已初始化「${currentDay.title}」为默认动作`);
  };

  /** 初始化选项 2：清空当前训练日动作，方便今天临时自由搭配 */
  const handleClearCurrentDay = async () => {
    if (!activePlan || !currentDay) return;
    await db.workoutPlans.put({
      ...activePlan,
      days: activePlan.days.map((d) =>
        d.id === currentDay.id ? { ...d, exercises: [] } : d,
      ),
      updatedAt: Date.now(),
    });
    setShowResetPanel(false);
    void hapticLight();
    onNotify(`已清空「${currentDay.title}」，可从动作库自由重选`);
  };

  /** 初始化选项 3：重置整套分化全部训练日为初始默认动作 */
  const handleResetAllDays = async () => {
    if (!activePlan) return;
    await db.workoutPlans.put({
      ...activePlan,
      days: baselineDays.map((d) => ({
        ...d,
        exercises: d.exercises.map((e) => ({ ...e })),
      })),
      updatedAt: Date.now(),
    });
    setShowResetPanel(false);
    void hapticSuccess();
    onNotify('已将全部训练日初始化为默认方案');
  };

  const handleAddLibraryExercise = async (libEx: ExerciseLibraryItem) => {
    if (!activePlan || !currentDay) return;
    if (currentDay.exercises.some((e) => e.name === libEx.name)) {
      onNotify(`「${libEx.name}」已在 ${currentDay.title} 中`);
      return;
    }
    const nextPlan = {
      ...activePlan,
      days: activePlan.days.map((d) =>
        d.id === currentDay.id
          ? {
              ...d,
              exercises: [
                ...d.exercises,
                {
                  id: `ex-${libEx.id}-${Date.now()}`,
                  name: libEx.name,
                  muscleGroup: libEx.muscleGroup,
                  targetSets: libEx.defaultSets,
                  targetRepMin: libEx.defaultRepMin,
                  targetRepMax: libEx.defaultRepMax,
                  restSeconds: libEx.defaultRestSec,
                },
              ],
            }
          : d,
      ),
      updatedAt: Date.now(),
    };
    await db.workoutPlans.put(nextPlan);
    void hapticLight();
    onNotify(`已加入 ${currentDay.title}：${libEx.name}`);
  };

  const handleRemoveExercise = async (exerciseId: string, exerciseName: string) => {
    if (!activePlan || !currentDay) return;
    const nextPlan = {
      ...activePlan,
      days: activePlan.days.map((d) =>
        d.id === currentDay.id
          ? { ...d, exercises: d.exercises.filter((e) => e.id !== exerciseId) }
          : d,
      ),
      updatedAt: Date.now(),
    };
    await db.workoutPlans.put(nextPlan);
    onNotify(`已移出：${exerciseName}`);
  };

  const openDemoByName = (name: string, muscleGroup: string, planExerciseId?: string) => {
    void hapticLight();
    const matched = findExerciseInLibrary(name);
    if (matched) {
      setDemoState({ exercise: matched, planExerciseId });
      return;
    }
    setDemoState({
      planExerciseId,
      exercise: {
        id: `custom-${name}`,
        name,
        englishName: 'Custom Exercise',
        category: 'chest',
        muscleGroup,
        equipment: 'dumbbell',
        difficulty: '进阶必备',
        motionPattern: 'press_horizontal',
        tempo: '2-1-1-0',
        defaultSets: 3,
        defaultRepMin: 8,
        defaultRepMax: 12,
        defaultRestSec: 90,
        steps: ['核心收紧、脊柱中立，目标肌群主导发力。', '离心下放慢控，不要靠惯性甩动。'],
        breathing: '发力吐气，还原吸气。',
        mistakes: ['重量过大导致动作变形借力'],
        videoQuery: `${name} 标准动作 教学`,
        gifId: '0025',
      },
    });
  };

  const handleStartFocusSession = () => {
    if (!currentDay) return;
    if (currentDay.exercises.length === 0) {
      onNotify(`「${currentDay.title}」还没有动作，请先挑动作或点初始化恢复默认`);
      return;
    }
    const entries: ExerciseLogEntry[] = currentDay.exercises.map((ex) => {
      const prog = getExerciseProgression(ex, workoutLogs);
      return {
        exerciseName: ex.name,
        muscleGroup: ex.muscleGroup,
        sets: Array.from({ length: ex.targetSets }, () => ({
          weightKg: prog.nextWeightKg,
          reps: prog.nextTargetReps,
          completed: false,
        })),
      };
    });
    setSessionEntries(entries);
    setSessionStartMs(Date.now());
    setElapsedSec(0);
    setRestRemainingSec(0);
    setInFocusMode(true);
    void hapticSuccess();
    onNotify(`开始训练：${currentDay.title}`);
  };

  const updateSetField = (exIdx: number, setIdx: number, field: 'weightKg' | 'reps', value: number) => {
    setSessionEntries((prev) =>
      prev.map((ex, i) =>
        i === exIdx
          ? {
              ...ex,
              sets: ex.sets.map((s, j) => (j === setIdx ? { ...s, [field]: Math.max(0, value) } : s)),
            }
          : ex,
      ),
    );
  };

  const toggleSetCompleted = (exIdx: number, setIdx: number) => {
    const willBeDone = !(sessionEntries[exIdx]?.sets[setIdx]?.completed ?? false);
    setSessionEntries((prev) =>
      prev.map((ex, i) =>
        i === exIdx
          ? {
              ...ex,
              sets: ex.sets.map((s, j) => (j === setIdx ? { ...s, completed: willBeDone } : s)),
            }
          : ex,
      ),
    );
    void hapticLight();
    if (willBeDone && currentDay) {
      const restSec = currentDay.exercises[exIdx]?.restSeconds ?? 90;
      setRestTotalSec(restSec);
      setRestRemainingSec(restSec);
    }
  };

  const addExtraSet = (exIdx: number) => {
    setSessionEntries((prev) =>
      prev.map((ex, i) => {
        if (i !== exIdx) return ex;
        const last = ex.sets[ex.sets.length - 1] ?? { weightKg: 20, reps: 10, completed: false };
        return { ...ex, sets: [...ex.sets, { weightKg: last.weightKg, reps: last.reps, completed: false }] };
      }),
    );
  };

  const removeLastSet = (exIdx: number) => {
    setSessionEntries((prev) =>
      prev.map((ex, i) => {
        if (i !== exIdx || ex.sets.length <= 1) return ex;
        return { ...ex, sets: ex.sets.slice(0, -1) };
      }),
    );
  };

  const handleFinishSession = async () => {
    if (!currentDay) return;
    const completedSetsCount = sessionEntries.reduce(
      (acc, ex) => acc + ex.sets.filter((s) => s.completed).length,
      0,
    );
    if (completedSetsCount === 0) {
      setInFocusMode(false);
      setRestRemainingSec(0);
      onNotify('未勾选已完成组，已退出');
      return;
    }
    const durationMin = Math.max(1, Math.round(elapsedSec / 60));
    const res = await actions.completeWorkoutSession({
      planId: activePlan?.id,
      dayName: `${currentDay.title} · ${currentDay.focus}`,
      durationMin,
      exercises: sessionEntries,
    });
    setInFocusMode(false);
    setRestRemainingSec(0);
    onNotify(
      `训练完成 · 容量 ${res.totalVolumeKg}kg${res.gainedXp > 0 ? ` · +${res.gainedXp} XP` : ''}`,
    );
  };

  const handleAddCustomExercise = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activePlan || !currentDay || !newExName.trim()) return;
    await db.workoutPlans.put({
      ...activePlan,
      days: activePlan.days.map((d) =>
        d.id === currentDay.id
          ? {
              ...d,
              exercises: [
                ...d.exercises,
                {
                  id: `ex-custom-${Date.now()}`,
                  name: newExName.trim(),
                  muscleGroup: newExMuscle.trim() || '综合',
                  targetSets: Math.max(1, Math.min(8, newExSets)),
                  targetRepMin: 8,
                  targetRepMax: 12,
                  restSeconds: Math.max(30, Math.min(240, newExRest)),
                },
              ],
            }
          : d,
      ),
      updatedAt: Date.now(),
    });
    setNewExName('');
    setShowAddEx(false);
    onNotify(`已添加动作至 ${currentDay.title}`);
  };

  /** 一键随机穿插 1 个核心 / 手臂 / 拉伸加练动作进当前训练日 */
  const handleInsertRandomBonus = async () => {
    if (!currentDay) return;
    const picked = pickRandomBonusExercise(currentDay.exercises.map((e) => e.name));
    if (!picked) {
      onNotify('核心与加练池动作已全部在今日计划中');
      return;
    }
    await handleAddLibraryExercise(picked);
  };

  const formatClock = (sec: number) =>
    `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`;

  const completedSetsTotal = sessionEntries.reduce(
    (s, ex) => s + ex.sets.filter((x) => x.completed).length,
    0,
  );
  const allSetsTotal = sessionEntries.reduce((s, ex) => s + ex.sets.length, 0);

  return (
    <div className="space-y-4">
      {/* 顶部清爽双栏 */}
      {!inFocusMode && (
        <div className="grid grid-cols-2 gap-1 p-1 rounded-2xl bg-zinc-200/70 dark:bg-zinc-900">
          <button
            type="button"
            onClick={() => {
              void hapticLight();
              setSubView('plan');
            }}
            className={`py-2 rounded-xl text-xs font-semibold transition-all ${
              subView === 'plan'
                ? 'bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 shadow-xs'
                : 'text-zinc-500 dark:text-zinc-400'
            }`}
          >
            今日计划
          </button>
          <button
            type="button"
            onClick={() => {
              void hapticLight();
              setSubView('library');
            }}
            className={`py-2 rounded-xl text-xs font-semibold transition-all ${
              subView === 'library'
                ? 'bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 shadow-xs'
                : 'text-zinc-500 dark:text-zinc-400'
            }`}
          >
            动作库 ({EXERCISE_LIBRARY.length})
          </button>
        </div>
      )}

      {/* ==================== 视图 1：今日训练计划 & 专注模式 ==================== */}
      {subView === 'plan' && (
        <>
          {/* 主视觉卡片 */}
          <section
            data-tour="workout-hero"
            className="rounded-3xl bg-white dark:bg-zinc-900/95 border border-zinc-200/70 dark:border-zinc-800/80 p-4 space-y-3.5"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <h1 className="text-base font-bold text-zinc-900 dark:text-zinc-100 truncate">
                  {inFocusMode && currentDay ? currentDay.title : activePlan?.name || '训练计划'}
                </h1>
                <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5 truncate">
                  {inFocusMode ? '点击圆圈完成组 · 自动开启组间休息' : currentDay?.focus || ''}
                </p>
              </div>

              {inFocusMode ? (
                <div className="text-right shrink-0">
                  <div className="text-base font-bold text-emerald-600 dark:text-emerald-400 num-tabular">
                    {formatClock(elapsedSec)}
                  </div>
                  <p className="text-[11px] text-zinc-400 num-tabular">
                    {completedSetsTotal}/{allSetsTotal} 组
                  </p>
                </div>
              ) : (
                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    type="button"
                    onClick={() => {
                      void hapticLight();
                      setShowResetPanel((v) => !v);
                      setShowTemplates(false);
                    }}
                    className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-xs font-medium transition-colors ${
                      showResetPanel || isCurrentDayModified
                        ? 'bg-amber-500/12 text-amber-700 dark:text-amber-300 border border-amber-500/30'
                        : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-200'
                    }`}
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    初始化
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      void hapticLight();
                      setShowTemplates((v) => !v);
                      setShowResetPanel(false);
                    }}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-xs font-medium bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-200"
                  >
                    <Layers className="w-3.5 h-3.5" />
                    换模板
                  </button>
                </div>
              )}
            </div>

            {showResetPanel && !inFocusMode && currentDay && (
              <div className="space-y-2 pt-2.5 border-t border-zinc-100 dark:border-zinc-800/80">
                <div className="flex items-center justify-between text-[11px] text-zinc-500 dark:text-zinc-400">
                  <span>临时加过的动作下次不想保留？选一种方式重置：</span>
                  <button
                    type="button"
                    onClick={() => setShowResetPanel(false)}
                    className="p-0.5 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
                    aria-label="收起初始化面板"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
                <div className="grid grid-cols-1 gap-1.5">
                  <button
                    type="button"
                    onClick={handleResetCurrentDay}
                    className="flex items-center justify-between gap-2 px-3 py-2.5 rounded-xl bg-emerald-500/10 hover:bg-emerald-500/15 border border-emerald-500/30 text-left transition-colors"
                  >
                    <div>
                      <p className="text-xs font-semibold text-emerald-700 dark:text-emerald-300">
                        恢复「{currentDay.title}」默认动作
                      </p>
                      <p className="text-[11px] text-zinc-500 dark:text-zinc-400 mt-0.5">
                        清除今天额外添加或随机塞的核心，还原标准动作
                      </p>
                    </div>
                    <RotateCcw className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                  </button>
                  <div className="grid grid-cols-2 gap-1.5">
                    <button
                      type="button"
                      onClick={handleClearCurrentDay}
                      className="inline-flex items-center justify-center gap-1.5 py-2 px-2.5 rounded-xl text-xs font-medium bg-zinc-100 hover:bg-zinc-200/80 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-200"
                    >
                      <Trash2 className="w-3.5 h-3.5 text-rose-500" />
                      清空本日动作
                    </button>
                    <button
                      type="button"
                      onClick={handleResetAllDays}
                      className="inline-flex items-center justify-center gap-1.5 py-2 px-2.5 rounded-xl text-xs font-medium bg-zinc-100 hover:bg-zinc-200/80 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-200"
                    >
                      <RotateCcw className="w-3.5 h-3.5 text-amber-500" />
                      重置全部 5 天
                    </button>
                  </div>
                </div>
              </div>
            )}

            {showTemplates && !inFocusMode && (
              <div className="space-y-2 pt-2 border-t border-zinc-100 dark:border-zinc-800/80">
                {WORKOUT_PLAN_TEMPLATES.map((tpl) => {
                  const isCurrent = activePlan?.name === tpl.name;
                  return (
                    <button
                      key={tpl.templateId}
                      type="button"
                      onClick={() => handleSwitchTemplate(tpl)}
                      className={`w-full text-left p-3 rounded-2xl border transition-colors ${
                        isCurrent
                          ? 'bg-emerald-500/8 border-emerald-500/40'
                          : 'bg-zinc-50 dark:bg-zinc-800/50 border-transparent hover:border-zinc-300 dark:hover:border-zinc-700'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">
                          {tpl.name}
                        </span>
                        <span className="text-[11px] text-emerald-600 dark:text-emerald-400 font-medium">
                          {isCurrent ? '当前' : tpl.weeklyDays}
                        </span>
                      </div>
                      <p className="text-[11px] text-zinc-500 mt-0.5">{tpl.tagline}</p>
                    </button>
                  );
                })}
              </div>
            )}

            {/* 分化日横向胶囊 */}
            {!inFocusMode && activePlan && (
              <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar">
                {activePlan.days.map((day) => {
                  const active = currentDay?.id === day.id;
                  return (
                    <button
                      key={day.id}
                      type="button"
                      onClick={() => {
                        void hapticLight();
                        setSelectedDayId(day.id);
                      }}
                      className={`shrink-0 py-1.5 px-3 rounded-full text-xs font-semibold transition-all ${
                        active
                          ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900'
                          : 'bg-zinc-100 dark:bg-zinc-800/80 text-zinc-600 dark:text-zinc-300'
                      }`}
                    >
                      {day.title}
                    </button>
                  );
                })}
              </div>
            )}

            {/* 单一清晰主按钮 */}
            {inFocusMode ? (
              <div className="grid grid-cols-2 gap-2.5">
                <button
                  type="button"
                  onClick={() => {
                    setInFocusMode(false);
                    setRestRemainingSec(0);
                    onNotify('已取消本次记录');
                  }}
                  className="inline-flex items-center justify-center gap-1.5 py-2.5 rounded-2xl text-xs font-semibold bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300"
                >
                  <Square className="w-3.5 h-3.5" />
                  放弃退出
                </button>
                <button
                  type="button"
                  onClick={handleFinishSession}
                  className="inline-flex items-center justify-center gap-1.5 py-2.5 rounded-2xl text-xs font-semibold bg-[#1a6e5e] hover:bg-[#155a4d] text-white"
                >
                  <CheckCircle2 className="w-4 h-4" />
                  完成结算
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={handleStartFocusSession}
                className="w-full inline-flex items-center justify-center gap-1.5 py-3 rounded-2xl text-sm font-semibold bg-[#1a6e5e] hover:bg-[#155a4d] text-white shadow-sm active:scale-[0.99] transition-all"
              >
                <Play className="w-4 h-4 fill-current" />
                开始 {currentDay?.title || '今日训练'}
              </button>
            )}
          </section>

          {/* 组间休息倒计时 */}
          {inFocusMode && restRemainingSec > 0 && (
            <section className="sticky top-16 z-20 rounded-2xl bg-zinc-900 text-white p-3.5 shadow-xl space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-xs font-semibold">
                  <Timer className="w-4 h-4 text-emerald-400" />
                  组间休息
                </div>
                <span className="text-lg font-bold text-emerald-400 num-tabular">
                  {formatClock(restRemainingSec)}
                </span>
              </div>
              <div className="h-1.5 rounded-full bg-white/15 overflow-hidden">
                <div
                  className="h-full bg-emerald-400 transition-all duration-1000 linear"
                  style={{ width: `${Math.min(100, Math.round((restRemainingSec / Math.max(1, restTotalSec)) * 100))}%` }}
                />
              </div>
              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setRestRemainingSec((s) => Math.max(5, s - 15))}
                  className="px-2.5 py-1 rounded-lg text-[11px] bg-white/10"
                >
                  -15s
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setRestRemainingSec((s) => s + 15);
                    setRestTotalSec((t) => t + 15);
                  }}
                  className="px-2.5 py-1 rounded-lg text-[11px] bg-white/10"
                >
                  +15s
                </button>
                <button
                  type="button"
                  onClick={() => setRestRemainingSec(0)}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-emerald-500 text-white"
                >
                  <RotateCcw className="w-3 h-3" />
                  跳过
                </button>
              </div>
            </section>
          )}

          {/* 专注记录 OR 极简动作列表 */}
          {inFocusMode ? (
            <div className="space-y-3">
              {sessionEntries.map((ex, exIdx) => (
                <section
                  key={`${ex.exerciseName}-${exIdx}`}
                  className="rounded-2xl bg-white dark:bg-zinc-900/95 border border-zinc-200/70 dark:border-zinc-800/80 p-3.5 space-y-2.5"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 truncate">
                        {ex.exerciseName}
                      </h3>
                      <span className="text-[11px] text-zinc-400">
                        {ex.muscleGroup} · 休 {currentDay?.exercises[exIdx]?.restSeconds ?? 90}s
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        type="button"
                        onClick={() => openDemoByName(ex.exerciseName, ex.muscleGroup)}
                        className="inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-lg bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-200"
                      >
                        <Video className="w-3.5 h-3.5 text-emerald-500" />
                        演示
                      </button>
                      {ex.sets.length > 1 && (
                        <button
                          type="button"
                          onClick={() => removeLastSet(exIdx)}
                          aria-label="减少一组"
                          title="减少一组"
                          className="p-1 rounded-lg bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400"
                        >
                          <Minus className="w-3.5 h-3.5" />
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => addExtraSet(exIdx)}
                        className="text-xs font-medium px-2 py-1 rounded-lg bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300"
                      >
                        +组
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-12 items-center gap-1.5 px-1.5 text-[10px] font-medium text-zinc-400">
                    <span className="col-span-2">组数</span>
                    <span className="col-span-4 text-center">重量 (kg)</span>
                    <span className="col-span-4 text-center">次数</span>
                    <span className="col-span-2 text-right">完成</span>
                  </div>

                  <div className="space-y-1.5">
                    {ex.sets.map((s, setIdx) => (
                      <div
                        key={setIdx}
                        className={`grid grid-cols-12 items-center gap-1.5 p-1.5 rounded-xl border ${
                          s.completed
                            ? 'bg-emerald-500/8 border-emerald-500/35'
                            : 'bg-zinc-50 dark:bg-zinc-800/50 border-transparent'
                        }`}
                      >
                        <span className="col-span-2 text-xs font-semibold text-zinc-400 num-tabular pl-1">
                          #{setIdx + 1}
                        </span>
                        <input
                          type="number"
                          step="2.5"
                          value={s.weightKg}
                          onFocus={(e) => e.target.select()}
                          onChange={(e) => updateSetField(exIdx, setIdx, 'weightKg', Number(e.target.value))}
                          aria-label="重量"
                          className="col-span-4 py-1.5 px-2 text-center rounded-lg text-xs font-semibold num-tabular bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700"
                        />
                        <input
                          type="number"
                          step="1"
                          value={s.reps}
                          onFocus={(e) => e.target.select()}
                          onChange={(e) => updateSetField(exIdx, setIdx, 'reps', Number(e.target.value))}
                          aria-label="次数"
                          className="col-span-4 py-1.5 px-2 text-center rounded-lg text-xs font-semibold num-tabular bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700"
                        />
                        <div className="col-span-2 flex justify-end">
                          <button
                            type="button"
                            onClick={() => toggleSetCompleted(exIdx, setIdx)}
                            className={`w-8 h-8 rounded-lg flex items-center justify-center transition-all active:scale-90 ${
                              s.completed
                                ? 'bg-emerald-500 text-white'
                                : 'bg-zinc-200/80 dark:bg-zinc-700 text-zinc-500 dark:text-zinc-300'
                            }`}
                          >
                            <Check className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              ))}
            </div>
          ) : (
            currentDay && (
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-2 px-1">
                  <span className="text-xs font-medium text-zinc-500 truncate">
                    共 {currentDay.exercises.length} 个动作 · 点击看 3D 示范
                  </span>
                  <div className="flex items-center gap-2.5 text-xs font-semibold shrink-0">
                    <button
                      type="button"
                      onClick={handleInsertRandomBonus}
                      className="inline-flex items-center gap-1 text-[#166556] dark:text-emerald-400 active:scale-95"
                      title="随机穿插 1 个核心腹肌或手臂/拉伸加练"
                    >
                      <Shuffle className="w-3 h-3" />
                      随机塞核心
                    </button>
                    <button
                      type="button"
                      onClick={() => setSubView('library')}
                      className="text-zinc-600 dark:text-zinc-300"
                    >
                      + 挑动作
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowAddEx((v) => !v)}
                      className="text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
                    >
                      手写
                    </button>
                  </div>
                </div>

                {showAddEx && (
                  <form
                    onSubmit={handleAddCustomExercise}
                    className="rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 p-3.5 space-y-2.5"
                  >
                    <div className="grid grid-cols-2 gap-2">
                      <input
                        type="text"
                        required
                        placeholder="动作名"
                        value={newExName}
                        onChange={(e) => setNewExName(e.target.value)}
                        className="px-3 py-2 rounded-xl text-xs bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700"
                      />
                      <input
                        type="text"
                        placeholder="肌群"
                        value={newExMuscle}
                        onChange={(e) => setNewExMuscle(e.target.value)}
                        className="px-3 py-2 rounded-xl text-xs bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700"
                      />
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      <input
                        type="number"
                        min={1}
                        max={8}
                        value={newExSets}
                        onChange={(e) => setNewExSets(Number(e.target.value))}
                        placeholder="组数"
                        className="px-2.5 py-2 rounded-xl text-xs num-tabular bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700"
                      />
                      <input
                        type="number"
                        step={15}
                        min={30}
                        max={240}
                        value={newExRest}
                        onChange={(e) => setNewExRest(Number(e.target.value))}
                        placeholder="休息(秒)"
                        className="px-2.5 py-2 rounded-xl text-xs num-tabular bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700"
                      />
                      <button
                        type="submit"
                        className="py-2 rounded-xl text-xs font-semibold bg-[#1a6e5e] text-white"
                      >
                        添加
                      </button>
                    </div>
                  </form>
                )}

                {/* 清爽单卡动作列表（点击整行即看示范，支持单条快删与空状态恢复） */}
                {currentDay.exercises.length === 0 ? (
                  <section className="rounded-2xl bg-white dark:bg-zinc-900/95 border border-dashed border-zinc-300 dark:border-zinc-700 p-6 text-center space-y-3">
                    <p className="text-xs text-zinc-500 dark:text-zinc-400">
                      「{currentDay.title}」当前为空，可以从 64 动作库自由挑选今天想练的动作，或一键恢复默认。
                    </p>
                    <div className="flex items-center justify-center gap-2">
                      <button
                        type="button"
                        onClick={handleResetCurrentDay}
                        className="inline-flex items-center gap-1 px-3 py-2 rounded-xl text-xs font-semibold bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-200"
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                        恢复默认动作
                      </button>
                      <button
                        type="button"
                        onClick={() => setSubView('library')}
                        className="inline-flex items-center gap-1 px-3 py-2 rounded-xl text-xs font-semibold bg-[#1a6e5e] text-white"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        去动作库挑选
                      </button>
                    </div>
                  </section>
                ) : (
                  <section className="rounded-2xl bg-white dark:bg-zinc-900/95 border border-zinc-200/70 dark:border-zinc-800/80 divide-y divide-zinc-100 dark:divide-zinc-800/80 overflow-hidden">
                    {currentDay.exercises.map((ex) => {
                      const prog = getExerciseProgression(ex, workoutLogs);
                      const libMatch = findExerciseInLibrary(ex.name);
                      return (
                        <div
                          key={ex.id}
                          className="flex items-center gap-2 pr-2 hover:bg-zinc-50 dark:hover:bg-zinc-800/40 transition-colors"
                        >
                          <button
                            type="button"
                            onClick={() => openDemoByName(ex.name, ex.muscleGroup, ex.id)}
                            className="flex-1 min-w-0 flex items-center gap-3 p-3.5 text-left active:bg-zinc-100/80"
                          >
                            <div className="w-12 h-12 rounded-xl bg-white border border-zinc-200/80 dark:border-zinc-700 overflow-hidden shrink-0 flex items-center justify-center p-0.5">
                              <img
                                src={getExerciseGifUrl(libMatch?.gifId ?? '0025')}
                                alt={ex.name}
                                loading="lazy"
                                className="w-full h-full object-contain"
                              />
                            </div>

                            <div className="flex-1 min-w-0">
                              <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 truncate">
                                {ex.name}
                              </h3>
                              <p className="text-xs text-zinc-500 dark:text-zinc-400 num-tabular mt-0.5 truncate">
                                {ex.targetSets}组 × {ex.targetRepMin}-{ex.targetRepMax}次 · {ex.muscleGroup}
                              </p>
                              {prog.hasHistory && (
                                <p className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-600 dark:text-emerald-400 mt-1">
                                  <TrendingUp className="w-3 h-3" />
                                  {prog.advice}
                                </p>
                              )}
                            </div>

                            <div className="shrink-0 flex items-center gap-0.5 text-xs font-medium text-zinc-400">
                              <span>演示</span>
                              <ChevronRight className="w-4 h-4" />
                            </div>
                          </button>

                          <button
                            type="button"
                            onClick={() => void handleRemoveExercise(ex.id, ex.name)}
                            aria-label={`移出 ${ex.name}`}
                            title="移出本日动作"
                            className="p-2 rounded-lg text-zinc-300 dark:text-zinc-600 hover:text-rose-500 active:scale-90 shrink-0"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      );
                    })}
                  </section>
                )}
              </div>
            )
          )}

          {/* 最近训练记录（默认折叠，不抢首屏注意力） */}
          {!inFocusMode && workoutLogs.length > 0 && (
            <section className="rounded-2xl bg-white dark:bg-zinc-900/95 border border-zinc-200/70 dark:border-zinc-800/80 overflow-hidden">
              <button
                type="button"
                onClick={() => setShowHistory((v) => !v)}
                className="w-full flex items-center justify-between px-4 py-3 text-xs font-semibold text-zinc-600 dark:text-zinc-300"
              >
                <span>最近训练记录 ({workoutLogs.length})</span>
                {showHistory ? <ChevronUp className="w-4 h-4 text-zinc-400" /> : <ChevronDown className="w-4 h-4 text-zinc-400" />}
              </button>
              {showHistory && (
                <div className="px-4 pb-3 space-y-2 border-t border-zinc-100 dark:border-zinc-800/80 pt-2.5">
                  {[...workoutLogs]
                    .sort((a, b) => b.createdAt - a.createdAt)
                    .slice(0, 5)
                    .map((log) => (
                      <div key={log.id} className="flex items-center justify-between text-xs">
                        <div className="min-w-0">
                          <p className="font-medium text-zinc-800 dark:text-zinc-200 truncate">{log.dayName}</p>
                          <p className="text-[11px] text-zinc-400 num-tabular">
                            {log.date} · {log.durationMin} 分钟
                          </p>
                        </div>
                        <span className="shrink-0 font-semibold text-emerald-600 dark:text-emerald-400 num-tabular">
                          {log.totalVolumeKg.toLocaleString()} kg
                        </span>
                      </div>
                    ))}
                </div>
              )}
            </section>
          )}
        </>
      )}

      {/* ==================== 视图 2：64 动作百科库 ==================== */}
      {subView === 'library' && (
        <div className="space-y-3">
          {/* 搜索 + 器械 */}
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search className="w-3.5 h-3.5 text-zinc-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={libSearch}
                onChange={(e) => setLibSearch(e.target.value)}
                placeholder="搜 卧推、引体、深蹲、侧平举..."
                className="w-full pl-8 pr-3 py-2 rounded-xl text-xs bg-white dark:bg-zinc-900 border border-zinc-200/80 dark:border-zinc-800 focus:outline-none focus:border-emerald-500"
              />
            </div>
            <select
              value={libEquipment}
              onChange={(e) => setLibEquipment(e.target.value as 'all' | EquipmentType)}
              className="px-2.5 py-2 rounded-xl text-xs bg-white dark:bg-zinc-900 border border-zinc-200/80 dark:border-zinc-800"
            >
              <option value="all">全部器械</option>
              {(Object.keys(EQUIPMENT_LABELS) as EquipmentType[]).map((eq) => (
                <option key={eq} value={eq}>
                  {EQUIPMENT_LABELS[eq]}
                </option>
              ))}
            </select>
          </div>

          {/* 7 大部位胶囊 */}
          <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar">
            <button
              type="button"
              onClick={() => setLibCategory('all')}
              className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-semibold ${
                libCategory === 'all'
                  ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900'
                  : 'bg-white dark:bg-zinc-900 text-zinc-600 dark:text-zinc-400 border border-zinc-200/80 dark:border-zinc-800'
              }`}
            >
              全部
            </button>
            {MUSCLE_CATEGORIES.map((cat) => (
              <button
                key={cat.id}
                type="button"
                onClick={() => {
                  void hapticLight();
                  setLibCategory(cat.id);
                }}
                className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-semibold ${
                  libCategory === cat.id
                    ? 'bg-[#1a6e5e] text-white'
                    : 'bg-white dark:bg-zinc-900 text-zinc-600 dark:text-zinc-400 border border-zinc-200/80 dark:border-zinc-800'
                }`}
              >
                {cat.short}
              </button>
            ))}
          </div>

          {/* 清爽带 3D 缩略图的动作库列表 */}
          <section className="rounded-2xl bg-white dark:bg-zinc-900/95 border border-zinc-200/70 dark:border-zinc-800/80 divide-y divide-zinc-100 dark:divide-zinc-800/80 overflow-hidden">
            {filteredLibrary.map((ex) => (
              <div key={ex.id} className="flex items-center gap-3 p-3">
                <button
                  type="button"
                  onClick={() => setDemoState({ exercise: ex })}
                  className="flex items-center gap-3 flex-1 min-w-0 text-left"
                >
                  <div className="w-12 h-12 rounded-xl bg-white border border-zinc-200/80 dark:border-zinc-700 overflow-hidden shrink-0 flex items-center justify-center p-0.5">
                    <img
                      src={getExerciseGifUrl(ex.gifId)}
                      alt={ex.name}
                      loading="lazy"
                      className="w-full h-full object-contain"
                    />
                  </div>
                  <div className="min-w-0">
                    <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 truncate">
                      {ex.name}
                    </h3>
                    <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5 truncate">
                      {ex.muscleGroup} · {EQUIPMENT_LABELS[ex.equipment]}
                    </p>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => handleAddLibraryExercise(ex)}
                  aria-label={`添加 ${ex.name}`}
                  className="shrink-0 inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-xs font-semibold bg-emerald-500/12 text-[#166556] dark:text-emerald-400 active:scale-95"
                >
                  <Plus className="w-3.5 h-3.5" />
                  加入
                </button>
              </div>
            ))}
          </section>
        </div>
      )}

      {/* 3D 模型动图 + 抖音/B站 演示弹窗 */}
      {demoState && (
        <ExerciseDemoModal
          key={demoState.exercise.id}
          exercise={demoState.exercise}
          currentDayTitle={currentDay?.title}
          onClose={() => setDemoState(null)}
          onAddToCurrentDay={!inFocusMode && !demoState.planExerciseId ? handleAddLibraryExercise : undefined}
          onRemoveFromCurrentDay={
            !inFocusMode && demoState.planExerciseId
              ? () => handleRemoveExercise(demoState.planExerciseId!, demoState.exercise.name)
              : undefined
          }
          onAskAi={onAskAi}
        />
      )}
    </div>
  );
}
