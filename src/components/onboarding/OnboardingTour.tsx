import { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  BellOff,
  Check,
  Dumbbell,
  Flame,
  Rocket,
  Sparkles,
  Utensils,
  X,
  Zap,
} from 'lucide-react';
import type { NavTab } from '../layout/MobileShell';
import { createDefaultUserProfile, db } from '../../db/database';
import { getLocalDateKey } from '../../lib/date';
import { hapticLight, hapticSuccess } from '../../lib/native';
import { calculateMetabolicTargets, FITNESS_GOALS } from '../../lib/nutrition';
import type { FitnessGoal, UserProfile } from '../../types/models';

interface TourStepDef {
  id: string;
  tag: string;
  title: string;
  desc: string;
  bullets: string[];
  targetTab: NavTab;
  selector?: string;
  icon: typeof Zap;
  isFinalSetup?: boolean;
}

const TOUR_STEPS: TourStepDef[] = [
  {
    id: 'welcome',
    tag: '欢迎使用 LifeOS',
    title: '你的纯本地隐私优先健身与养生中枢',
    desc: '所有体征、饮食、训练和作息数据 100% 存在你手机本地，无账号注册、无云端收集。接下来 40 秒，带你快速熟悉 5 个核心用法：',
    bullets: [
      'RPG 升级打卡 + 睡眠不足自动「低电量保护」',
      '内置 54+ 全国常见中式简餐、轻食、连锁快餐与便利店营养库',
      '全权限游离 AI 管家，支持手机端侧离线模型与云端联网双模式',
    ],
    targetTab: 'today',
    icon: Zap,
  },
  {
    id: 'today_rpg',
    tag: '板块 1 · 今日中枢',
    title: '把自律变成升级打怪',
    desc: '这里是每天打开的第一屏。喝水、记餐、拉伸、晨重和训练都会实时涨 XP 经验、点亮 28 天热力图：',
    bullets: [
      '下方环形仪表实时算你今天还剩多少热量和碳蛋脂，记错餐可直接一键删除',
      '如果昨晚睡不满 6.5 小时，顶部自动亮起「低电量恢复模式」提示减载',
      '坚持录 4 天晨重，系统会自动按周趋势帮你动态微调每日热量目标',
    ],
    targetTab: 'today',
    selector: '[data-tour="today-rpg"]',
    icon: Flame,
  },
  {
    id: 'diet_hub',
    tag: '板块 2 · 健康饮食',
    title: '中餐、轻食、快餐、便利店全收录，3 栏一眼看懂',
    desc: '顶部精简为【吃什么 / 美食库 / 周边探店】3 个清爽视图：',
    bullets: [
      '【吃什么】：按练完部位速配、AI 精排，也能一键切到「一日三餐」单餐换一换',
      '【美食库】：内置全国常见 54+ 餐品营养数据，支持拍照/截图识图批量入库',
      '【周边探店】：内置 16 家全国连锁点单攻略，也支持定位 + 高德/OSM 实时探店',
    ],
    targetTab: 'diet',
    selector: '[data-tour="diet-tabs"]',
    icon: Utensils,
  },
  {
    id: 'workout_focus',
    tag: '板块 3 · 五分化与 64 动作 3D 示范',
    title: '练背/肩/胸/腿/有氧 · 随时塞核心与初始化',
    desc: '默认按「练背 · 练肩 · 练胸 · 练腿 · 有氧」五分化排布，点动作即可看 3D 模型示范 + 抖音/B站教学：',
    bullets: [
      '支持一键「随机塞核心」加练，临时加过的动作下次点「初始化」可随时恢复默认或清空重选',
      '专注模式下每勾一组自动开启组间休息倒计时，结算自动激活训练日饮食加成',
    ],
    targetTab: 'workout',
    selector: '[data-tour="workout-hero"]',
    icon: Dumbbell,
  },
  {
    id: 'routine_dnd',
    tag: '板块 4 · 喝水与免打扰作息',
    title: '饮品自动折算补水，专注开会绝不打扰',
    desc: '不同饮品补水效率不同（白水×1.0、电解质×1.1、美式×0.8、奶茶×0.7），系统会自动折算有效补水量：',
    bullets: [
      '把「上午专注」「晚间休息」加进免打扰时段，提醒时间轴会自动划线静音',
      '点「同步提醒」即可下发到安卓系统原生通知栏，准点推喝水和睡前 30 分钟倒计时',
    ],
    targetTab: 'routine',
    selector: '[data-tour="routine-dnd"]',
    icon: BellOff,
  },
  {
    id: 'global_ai',
    tag: '王牌功能 · 全权限游离 AI 管家',
    title: '点顶部「AI」按钮，端侧离线 + 云端联网双模切换',
    desc: '这个常驻入口游离在全 App 之上（菜品和健身动作卡片上也能一键提问）：',
    bullets: [
      '内置健身与四季养生知识库，支持手机端侧原生离线模型（零隐私上传），也能自配免费云端 Key 联网识图',
      '拥有 12 项 App 内部操作权限：说一句「刚喝300ml电解质水，把下午会议设免打扰」，AI 会直接帮你办完',
    ],
    targetTab: 'today',
    selector: '[data-tour="global-ai-btn"]',
    icon: Sparkles,
  },
  {
    id: 'quick_setup',
    tag: '最后一步 · 5 秒校准你的档案',
    title: '设定初始参数，马上开启冒险',
    desc: '微调下面的基础数据，系统立即按 Mifflin-St Jeor 公式为你生成每日热量、蛋白与饮水目标（随时可在设置页修改）：',
    bullets: [],
    targetTab: 'today',
    icon: Rocket,
    isFinalSetup: true,
  },
];

interface HighlightRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

interface OnboardingTourProps {
  profile: UserProfile;
  onNavigateTab: (tab: NavTab) => void;
  onFinish: (bonusMsg?: string) => Promise<void>;
}

/**
 * 7 步跨板块真实聚光灯手把手新手教程 + 收官个人身体档案快配
 */
export function OnboardingTour({ profile, onNavigateTab, onFinish }: OnboardingTourProps) {
  const [stepIdx, setStepIdx] = useState(0);
  const [rect, setRect] = useState<HighlightRect | null>(null);
  const [saving, setSaving] = useState(false);

  // 第 7 步开局档案快配本地表单状态
  const [heightCm, setHeightCm] = useState(profile.heightCm);
  const [weightKg, setWeightKg] = useState(profile.weightKg);
  const [goal, setGoal] = useState<FitnessGoal>(profile.goal);
  const [budgetYuan, setBudgetYuan] = useState(profile.dailyBudgetYuan);

  const step = TOUR_STEPS[stepIdx];
  const Icon = step.icon;

  const livePreview = useMemo(
    () =>
      calculateMetabolicTargets({
        gender: profile.gender,
        age: profile.age,
        heightCm,
        weightKg,
        activityLevel: profile.activityLevel,
        goal,
        calorieAdjustment: profile.calorieAdjustment,
      }),
    [profile.gender, profile.age, profile.activityLevel, profile.calorieAdjustment, heightCm, weightKg, goal],
  );

  // 切换步骤时自动切换真实底层页面，并异步定位聚光灯坐标
  useEffect(() => {
    onNavigateTab(step.targetTab);

    let cancelled = false;
    const measure = () => {
      if (cancelled) return;
      if (!step.selector) {
        setRect(null);
        return;
      }
      const el = document.querySelector<HTMLElement>(step.selector);
      if (!el) {
        setRect(null);
        return;
      }
      const r = el.getBoundingClientRect();
      const pad = 6;
      setRect({
        top: Math.max(4, r.top - pad),
        left: Math.max(4, r.left - pad),
        width: r.width + pad * 2,
        height: r.height + pad * 2,
      });
    };

    const timer1 = window.setTimeout(() => {
      if (step.selector) {
        const el = document.querySelector<HTMLElement>(step.selector);
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }
      measure();
    }, 110);

    const timer2 = window.setTimeout(measure, 360);

    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);

    return () => {
      cancelled = true;
      window.clearTimeout(timer1);
      window.clearTimeout(timer2);
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
    };
  }, [step.selector, step.targetTab, onNavigateTab]);

  const handleNext = () => {
    void hapticLight();
    if (stepIdx < TOUR_STEPS.length - 1) {
      setStepIdx((i) => i + 1);
    }
  };

  const handlePrev = () => {
    void hapticLight();
    if (stepIdx > 0) {
      setStepIdx((i) => i - 1);
    }
  };

  /** 跳过教程直接开始 */
  const handleSkip = async () => {
    void hapticLight();
    onNavigateTab('today');
    await onFinish('已跳过新手教程（随时可在右上角设置页重新打开）');
  };

  /** 保存快配档案、发放新手启程 +30 XP 并完成教程 */
  const handleCompleteSetup = async () => {
    setSaving(true);
    try {
      const cur = (await db.userProfile.get('primary')) ?? createDefaultUserProfile();
      await db.userProfile.put({
        ...cur,
        heightCm: Math.max(130, Math.min(220, heightCm || 175)),
        weightKg: Math.max(35, Math.min(200, weightKg || 68)),
        goal,
        dailyBudgetYuan: Math.max(10, Math.min(300, budgetYuan || 38)),
        ...livePreview,
        updatedAt: Date.now(),
      });

      // 首次完成新手引导发放 +30 XP 启动奖励（防重复领取）
      const todayKey = getLocalDateKey();
      const existingHabit = await db.habitLogs.get(todayKey);
      const quests = new Set(existingHabit?.completedQuests ?? []);
      let bonusXp = 0;
      if (!quests.has('onboarding_complete')) {
        quests.add('onboarding_complete');
        bonusXp = 30;
        await db.habitLogs.put({
          date: todayKey,
          waterEntries: existingHabit?.waterEntries ?? [],
          totalRawWaterMl: existingHabit?.totalRawWaterMl ?? 0,
          totalEffectiveWaterMl: existingHabit?.totalEffectiveWaterMl ?? 0,
          sleepBedTime: existingHabit?.sleepBedTime,
          sleepWakeTime: existingHabit?.sleepWakeTime,
          sleepDurationHours: existingHabit?.sleepDurationHours,
          sleepQuality: existingHabit?.sleepQuality,
          morningWeightKg: existingHabit?.morningWeightKg,
          isTrainingDay: existingHabit?.isTrainingDay ?? false,
          stretchCount: existingHabit?.stretchCount ?? 0,
          xpEarned: (existingHabit?.xpEarned ?? 0) + bonusXp,
          completedQuests: Array.from(quests),
          updatedAt: Date.now(),
        });
      }

      void hapticSuccess();
      onNavigateTab('today');
      await onFinish(
        bonusXp > 0
          ? `新手启程完成！每日目标 ${livePreview.targetCalories} kcal · +${bonusXp} XP`
          : `个人目标已更新：每日 ${livePreview.targetCalories} kcal`,
      );
    } finally {
      setSaving(false);
    }
  };

  // 智能决定说明卡片停靠位置：如果高亮目标靠屏幕下方，卡片自动停在上方避让
  const viewportH = typeof window !== 'undefined' ? window.innerHeight : 800;
  const dockTop = Boolean(rect && rect.top > viewportH * 0.45);
  const isCenteredCard = !rect;

  return (
    <div className="fixed inset-0 z-[60] pointer-events-auto">
      {/* 背景遮罩（有聚光灯目标时由 Spotlight box-shadow 提供精准镂空遮罩，无目标时全屏暗化） */}
      {!rect && (
        <div className="fixed inset-0 bg-black/72 backdrop-blur-[2px]" />
      )}

      {/* 真实元素聚光灯镂空框 */}
      {rect && (
        <div
          className="fixed rounded-2xl ring-2 ring-emerald-400 transition-all duration-300 ease-out pointer-events-none"
          style={{
            top: rect.top,
            left: rect.left,
            width: rect.width,
            height: rect.height,
            boxShadow: '0 0 0 9999px rgba(5, 6, 8, 0.74), 0 0 24px rgba(16, 185, 129, 0.45)',
          }}
        />
      )}

      {/* 引导说明卡片容器 */}
      <div
        className={`fixed inset-x-0 px-4 flex justify-center transition-all duration-300 ${
          isCenteredCard
            ? 'inset-y-0 items-center'
            : dockTop
              ? 'top-16 items-start'
              : 'bottom-6 items-end'
        }`}
        style={{
          paddingBottom: !isCenteredCard && !dockTop ? 'calc(var(--safe-bottom) + 8px)' : undefined,
        }}
      >
        <div className="w-full max-w-[408px] rounded-3xl bg-white dark:bg-[#12151c] border border-zinc-200/90 dark:border-zinc-700/80 shadow-2xl p-5 space-y-4 animate-page-in">
          {/* 顶栏：步骤进度与跳过 */}
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2.5">
              {step.id === 'welcome' ? (
                <img
                  src="./logo.png"
                  alt="LifeOS"
                  className="w-9 h-9 rounded-xl object-cover shadow-sm shrink-0"
                />
              ) : (
                <div className="w-8 h-8 rounded-xl bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0">
                  <Icon className="w-4 h-4" />
                </div>
              )}
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
                  {step.tag}
                </p>
                <p className="text-[11px] text-zinc-400 num-tabular">
                  新手教程 · 第 {stepIdx + 1} / {TOUR_STEPS.length} 步
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={handleSkip}
              className="inline-flex items-center gap-0.5 px-2.5 py-1 rounded-lg text-[11px] font-medium text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
            >
              跳过
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* 进度条点阵 */}
          <div className="flex items-center gap-1">
            {TOUR_STEPS.map((s, idx) => (
              <div
                key={s.id}
                className={`h-1 flex-1 rounded-full transition-all duration-300 ${
                  idx <= stepIdx ? 'bg-emerald-500' : 'bg-zinc-200 dark:bg-zinc-800'
                }`}
              />
            ))}
          </div>

          {/* 标题与引导文案 */}
          <div className="space-y-2">
            <h2 className="text-base font-bold text-zinc-900 dark:text-zinc-100 leading-snug">
              {step.title}
            </h2>
            <p className="text-xs text-zinc-600 dark:text-zinc-300 leading-relaxed">
              {step.desc}
            </p>
          </div>

          {/* 要点清单 */}
          {step.bullets.length > 0 && (
            <ul className="space-y-2">
              {step.bullets.map((b) => (
                <li
                  key={b}
                  className="flex items-start gap-2 text-xs text-zinc-700 dark:text-zinc-200 leading-relaxed"
                >
                  <span className="mt-1 w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />
                  <span>{b}</span>
                </li>
              ))}
            </ul>
          )}

          {/* 第 7 步：开局身体目标 5 秒快配表单 */}
          {step.isFinalSetup && (
            <div className="space-y-3 pt-1">
              <div className="grid grid-cols-3 gap-2">
                <label className="block space-y-1">
                  <span className="text-[11px] text-zinc-500">身高 (cm)</span>
                  <input
                    type="number"
                    min={130}
                    max={220}
                    value={heightCm}
                    onChange={(e) => setHeightCm(Number(e.target.value))}
                    className="w-full px-2.5 py-2 rounded-xl text-xs font-semibold num-tabular bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700"
                  />
                </label>
                <label className="block space-y-1">
                  <span className="text-[11px] text-zinc-500">体重 (kg)</span>
                  <input
                    type="number"
                    step="0.1"
                    min={35}
                    max={180}
                    value={weightKg}
                    onChange={(e) => setWeightKg(Number(e.target.value))}
                    className="w-full px-2.5 py-2 rounded-xl text-xs font-semibold num-tabular bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700"
                  />
                </label>
                <label className="block space-y-1">
                  <span className="text-[11px] text-zinc-500">日预算 (¥)</span>
                  <input
                    type="number"
                    min={10}
                    max={200}
                    value={budgetYuan}
                    onChange={(e) => setBudgetYuan(Number(e.target.value))}
                    className="w-full px-2.5 py-2 rounded-xl text-xs font-semibold num-tabular bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700"
                  />
                </label>
              </div>

              <div className="grid grid-cols-3 gap-1.5">
                {(Object.keys(FITNESS_GOALS) as FitnessGoal[]).map((gk) => (
                  <button
                    key={gk}
                    type="button"
                    onClick={() => {
                      void hapticLight();
                      setGoal(gk);
                    }}
                    className={`py-2 rounded-xl text-xs font-semibold border transition-colors ${
                      goal === gk
                        ? 'bg-emerald-500 text-white border-emerald-500'
                        : 'bg-zinc-50 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 border-zinc-200 dark:border-zinc-700'
                    }`}
                  >
                    {FITNESS_GOALS[gk].label}
                  </button>
                ))}
              </div>

              <div className="flex items-center justify-between px-3 py-2.5 rounded-xl bg-emerald-500/10 border border-emerald-500/25 text-xs">
                <span className="text-emerald-800 dark:text-emerald-300 font-medium">
                  为你测算每日目标
                </span>
                <span className="font-bold text-emerald-700 dark:text-emerald-400 num-tabular">
                  {livePreview.targetCalories} kcal · 蛋{livePreview.targetProteinG}g · 水{livePreview.targetWaterMl}ml
                </span>
              </div>
            </div>
          )}

          {/* 底部导航操作栏 */}
          <div className="flex items-center justify-between gap-2 pt-1">
            {stepIdx > 0 ? (
              <button
                type="button"
                onClick={handlePrev}
                className="inline-flex items-center gap-1 px-3.5 py-2.5 rounded-xl text-xs font-semibold bg-zinc-100 hover:bg-zinc-200/80 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-200"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                上一步
              </button>
            ) : (
              <div />
            )}

            {step.isFinalSetup ? (
              <button
                type="button"
                disabled={saving}
                onClick={handleCompleteSetup}
                className="flex-1 inline-flex items-center justify-center gap-1.5 py-2.5 px-4 rounded-xl text-xs font-bold bg-emerald-500 hover:bg-emerald-600 text-white shadow-md shadow-emerald-500/25 active:scale-[0.98] disabled:opacity-60"
              >
                <Check className="w-4 h-4" />
                保存并开始使用 (+30 XP)
              </button>
            ) : (
              <button
                type="button"
                onClick={handleNext}
                className="inline-flex items-center gap-1 px-4 py-2.5 rounded-xl text-xs font-bold bg-emerald-500 hover:bg-emerald-600 text-white shadow-sm shadow-emerald-500/25 active:scale-95 transition-all"
              >
                <span>{stepIdx === 0 ? '开始 40 秒上手导览' : '下一步'}</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
