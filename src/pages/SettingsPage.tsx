import { useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  ArrowLeft,
  BookOpen,
  Check,
  CheckCircle2,
  Copy,
  Cpu,
  Database,
  Download,
  ExternalLink,
  Eye,
  EyeOff,
  Loader2,
  MapPin,
  Palette,
  Save,
  ShieldCheck,
  Trash2,
  Upload,
  UserRound,
  XCircle,
} from 'lucide-react';
import { EmbeddedLocalAiCard } from '../components/settings/EmbeddedLocalAiCard';
import {
  downloadBackupJson,
  exportDatabaseBackup,
  importBackupJsonText,
} from '../db/backup';
import {
  createDefaultSettings,
  createDefaultUserProfile,
  db,
  resetAllLocalData,
} from '../db/database';
import {
  AI_PROVIDER_PRESETS,
  testAiConnection,
  type AiConnectionTestResult,
} from '../lib/aiClient';
import { CITY_PRESETS, resolveCityPreset, testAmapWebKey } from '../lib/amap';
import type { EmbeddedModelSpec } from '../lib/localLlm';
import {
  ACTIVITY_MULTIPLIERS,
  calculateMetabolicTargets,
  FITNESS_GOALS,
} from '../lib/nutrition';
import type {
  ActivityLevel,
  AiProvider,
  FitnessGoal,
  Gender,
  Settings,
  ThemeMode,
  UserProfile,
} from '../types/models';

interface SettingsPageProps {
  onBack: () => void;
  onReplayTour: () => void;
  onNotify: (text: string) => void;
}

/**
 * 设置页：
 * 1. 外观主题（暗色 / 浅色 / 跟随系统）
 * 2. 身体档案表单（实时计算 BMR / TDEE / 碳蛋脂 / 喝水目标并保存）
 * 3. BYOK AI 接口配置与真实连通性测试（OpenAI 兼容 & Google Gemini 原生）
 * 4. 高德地图 Web 服务配置（全国周边 POI 探店与城市实况天气）
 * 5. 纯本地 IndexedDB 一键导出 / 导入 JSON 备份
 */
export function SettingsPage({ onBack, onReplayTour, onNotify }: SettingsPageProps) {
  const storedProfile = useLiveQuery(() => db.userProfile.get('primary'), []);
  const storedSettings = useLiveQuery(() => db.settings.get('app_settings'), []);

  const dbStats = useLiveQuery(async () => {
    const [foods, meals, habits, plans] = await Promise.all([
      db.foodItems.count(),
      db.mealLogs.count(),
      db.habitLogs.count(),
      db.workoutPlans.count(),
    ]);
    return { foods, meals, habits, plans };
  }, []);

  // 身体档案与设置采用受控草稿覆盖态，避免 useEffect 同步触发多余渲染
  const defaultProfile = useMemo(() => createDefaultUserProfile(), []);
  const defaultSettings = useMemo(() => createDefaultSettings(), []);

  const [profileDraft, setProfileDraft] = useState<UserProfile | null>(null);
  const [settingsDraft, setSettingsDraft] = useState<Settings | null>(null);

  const profileForm = profileDraft ?? storedProfile ?? defaultProfile;
  const settingsForm = settingsDraft ?? storedSettings ?? defaultSettings;

  const setProfileForm = (next: UserProfile | ((prev: UserProfile) => UserProfile)) => {
    setProfileDraft((prev) => {
      const base = prev ?? storedProfile ?? defaultProfile;
      return typeof next === 'function' ? next(base) : next;
    });
  };

  const setSettingsForm = (next: Settings | ((prev: Settings) => Settings)) => {
    setSettingsDraft((prev) => {
      const base = prev ?? storedSettings ?? defaultSettings;
      return typeof next === 'function' ? next(base) : next;
    });
  };

  const [showApiKey, setShowApiKey] = useState(false);
  const [showAmapKey, setShowAmapKey] = useState(false);
  const [testingAi, setTestingAi] = useState(false);
  const [testResult, setTestResult] = useState<AiConnectionTestResult | null>(null);
  const [testingAmap, setTestingAmap] = useState(false);
  const [amapTestResult, setAmapTestResult] = useState<{ ok: boolean; message: string } | null>(
    null,
  );
  const [importStatus, setImportStatus] = useState<string | null>(null);
  const [confirmClearAll, setConfirmClearAll] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 根据身体档案实时计算 BMR / TDEE / 碳蛋脂 / 喝水目标
  const liveTargets = useMemo(
    () =>
      calculateMetabolicTargets({
        gender: profileForm.gender,
        age: profileForm.age,
        heightCm: profileForm.heightCm,
        weightKg: profileForm.weightKg,
        activityLevel: profileForm.activityLevel,
        goal: profileForm.goal,
        calorieAdjustment: profileForm.calorieAdjustment,
      }),
    [
      profileForm.gender,
      profileForm.age,
      profileForm.heightCm,
      profileForm.weightKg,
      profileForm.activityLevel,
      profileForm.goal,
      profileForm.calorieAdjustment,
    ],
  );

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    const cityPreset = resolveCityPreset(profileForm.campus);
    const nextProfile: UserProfile = {
      ...profileForm,
      ...liveTargets,
      updatedAt: Date.now(),
    };
    await db.userProfile.put(nextProfile);
    if (settingsForm.amapCenterLngLat !== cityPreset.lngLat) {
      await db.settings.put({
        ...settingsForm,
        amapCenterLngLat: cityPreset.lngLat,
        updatedAt: Date.now(),
      });
    }
    setProfileDraft(null);
    setSettingsDraft(null);
    onNotify(`已保存档案与城市（${nextProfile.campus}）：目标 ${liveTargets.targetCalories} kcal`);
  };

  const handleThemeChange = async (theme: ThemeMode) => {
    const next = { ...settingsForm, theme, updatedAt: Date.now() };
    setSettingsForm(next);
    await db.settings.put(next);
  };

  const handleApplyPreset = (presetId: string) => {
    const preset = AI_PROVIDER_PRESETS.find((p) => p.id === presetId);
    if (!preset) return;
    const envDefaultZhipuKey =
      (import.meta.env.VITE_DEFAULT_ZHIPU_KEY as string | undefined)?.trim() || '';
    setSettingsForm((prev) => ({
      ...prev,
      aiProvider: preset.provider,
      aiBaseUrl: preset.baseUrl,
      aiModel: preset.defaultModel,
      aiApiKey:
        preset.id === 'zhipu_free' && !prev.aiApiKey.trim() && envDefaultZhipuKey
          ? envDefaultZhipuKey
          : prev.aiApiKey,
    }));
    setTestResult(null);
  };

  const handleSaveAiSettings = async () => {
    const next: Settings = {
      ...settingsForm,
      aiBaseUrl: settingsForm.aiBaseUrl.trim(),
      aiApiKey: settingsForm.aiApiKey.trim(),
      aiModel: settingsForm.aiModel.trim(),
      amapWebKey: settingsForm.amapWebKey.trim(),
      updatedAt: Date.now(),
    };
    await db.settings.put(next);
    setSettingsDraft(null);
    onNotify('AI 与地图接口配置已保存在本地');
  };

  const handleTestAi = async () => {
    setTestingAi(true);
    setTestResult(null);
    try {
      const res = await testAiConnection(settingsForm);
      setTestResult(res);
      // 仅在测试通过时自动保存，避免误测未启动的本地端口覆盖原有可用配置
      if (res.ok) {
        await db.settings.put({
          ...settingsForm,
          aiBaseUrl: settingsForm.aiBaseUrl.trim(),
          aiApiKey: settingsForm.aiApiKey.trim(),
          aiModel: settingsForm.aiModel.trim(),
          updatedAt: Date.now(),
        });
      }
    } finally {
      setTestingAi(false);
    }
  };

  const handleActivateEmbeddedModel = async (spec: EmbeddedModelSpec) => {
    const next: Settings = {
      ...settingsForm,
      aiProvider: 'local_embedded',
      aiBaseUrl: 'local://embedded',
      aiModel: spec.fileName,
      updatedAt: Date.now(),
    };
    await db.settings.put(next);
    setSettingsDraft(null);
    setTestResult(null);
  };

  const handleSwitchBackCloud = async () => {
    const zhipuPreset =
      AI_PROVIDER_PRESETS.find((p) => p.id === 'zhipu_free') ?? AI_PROVIDER_PRESETS[0];
    const envDefaultZhipuKey =
      (import.meta.env.VITE_DEFAULT_ZHIPU_KEY as string | undefined)?.trim() || '';
    const next: Settings = {
      ...settingsForm,
      aiProvider: zhipuPreset.provider,
      aiBaseUrl: zhipuPreset.baseUrl,
      aiModel: zhipuPreset.defaultModel,
      aiApiKey: settingsForm.aiApiKey.trim() || envDefaultZhipuKey,
      updatedAt: Date.now(),
    };
    await db.settings.put(next);
    setSettingsDraft(null);
    setTestResult(null);
  };

  const handleTestAmap = async () => {
    setTestingAmap(true);
    setAmapTestResult(null);
    try {
      const res = await testAmapWebKey(settingsForm.amapWebKey, profileForm.campus);
      setAmapTestResult({ ok: res.ok, message: res.message });
      if (res.ok) {
        await db.settings.put({
          ...settingsForm,
          amapWebKey: settingsForm.amapWebKey.trim(),
          updatedAt: Date.now(),
        });
        setSettingsDraft(null);
        onNotify('高德 Key 连通成功并已保存');
      }
    } finally {
      setTestingAmap(false);
    }
  };

  const handleClearAllLocalData = async () => {
    await resetAllLocalData();
    setProfileDraft(null);
    setSettingsDraft(null);
    setConfirmClearAll(false);
    setTestResult(null);
    setAmapTestResult(null);
    onNotify('已清空全部本机个人数据并恢复初始状态');
  };

  const handleExport = async () => {
    const fileName = await downloadBackupJson();
    onNotify(`已导出备份：${fileName}`);
  };

  const handleCopyBackupJson = async () => {
    try {
      const payload = await exportDatabaseBackup();
      await navigator.clipboard.writeText(JSON.stringify(payload));
      onNotify('已复制完整 JSON 备份到剪贴板');
    } catch {
      onNotify('当前环境不支持剪贴板写入，请使用导出 JSON');
    }
  };

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const res = await importBackupJsonText(text);
      setProfileDraft(null);
      setSettingsDraft(null);
      setImportStatus(`导入成功：已恢复 ${res.tablesRestored} 张表，共 ${res.totalRecords} 条记录`);
      onNotify('本地数据已从 JSON 备份恢复');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setImportStatus(`导入失败：${msg}`);
    } finally {
      e.target.value = '';
    }
  };

  return (
    <div className="space-y-4">
      {/* 顶部返回栏 */}
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-zinc-600 dark:text-zinc-300 hover:text-zinc-900 dark:hover:text-white"
        >
          <ArrowLeft className="w-4 h-4" />
          返回主界面
        </button>
        <span className="text-[11px] text-zinc-400">所有配置均仅存于本机 IndexedDB</span>
      </div>

      {/* 新手交互教程重放入口 */}
      <section className="flex items-center justify-between gap-3 rounded-2xl bg-emerald-500/8 dark:bg-emerald-500/10 border border-emerald-500/25 p-3.5">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-8 h-8 rounded-xl bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0">
            <BookOpen className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <h2 className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">
              LifeOS 手把手交互教程
            </h2>
            <p className="text-[11px] text-zinc-500 dark:text-zinc-400 truncate">
              40 秒带你走一遍 5 大板块与全权限 AI 用法
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={onReplayTour}
          className="shrink-0 px-3 py-1.5 rounded-xl text-xs font-semibold bg-emerald-500 hover:bg-emerald-600 text-white active:scale-95 transition-all"
        >
          重新进入教程
        </button>
      </section>

      {/* 模块 1：主题外观 */}
      <section className="rounded-2xl bg-white dark:bg-zinc-900/90 border border-zinc-200/80 dark:border-zinc-800/90 p-4 space-y-3">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
          <Palette className="w-4 h-4 text-emerald-500" />
          外观与主题模式
        </h2>
        <div className="grid grid-cols-3 gap-2">
          {[
            { id: 'dark' as const, label: '深空暗色' },
            { id: 'light' as const, label: '极简浅色' },
            { id: 'system' as const, label: '跟随系统' },
          ].map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => handleThemeChange(item.id)}
              className={`py-2 px-3 rounded-xl text-xs font-medium border transition-colors ${
                settingsForm.theme === item.id
                  ? 'bg-emerald-500 text-white border-emerald-500'
                  : 'bg-zinc-50 dark:bg-zinc-800/70 text-zinc-700 dark:text-zinc-300 border-zinc-200 dark:border-zinc-700'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
      </section>

      {/* 模块 2：身体档案 & 自动计算 TDEE / 碳蛋脂 / 饮水目标 */}
      <form
        onSubmit={handleSaveProfile}
        className="rounded-2xl bg-white dark:bg-zinc-900/90 border border-zinc-200/80 dark:border-zinc-800/90 p-4 space-y-4"
      >
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
            <UserRound className="w-4 h-4 text-emerald-500" />
            身体档案与代谢计算引擎
          </h2>
          <span className="text-[10px] px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 font-medium">
            Mifflin-St Jeor
          </span>
        </div>

        {/* 实时代谢测算结果卡片 */}
        <div className="p-3 rounded-xl bg-zinc-50 dark:bg-zinc-800/70 border border-zinc-200/80 dark:border-zinc-700/60 space-y-2.5">
          <div className="flex items-baseline justify-between">
            <div>
              <span className="text-[11px] text-zinc-500 dark:text-zinc-400">建议每日目标热量</span>
              <div className="text-xl font-bold text-emerald-600 dark:text-emerald-400 num-tabular">
                {liveTargets.targetCalories} <span className="text-xs font-normal">kcal</span>
              </div>
            </div>
            <div className="text-right text-[11px] text-zinc-500 dark:text-zinc-400 num-tabular">
              <div>BMR {liveTargets.bmr} kcal</div>
              <div>TDEE {liveTargets.tdee} kcal</div>
            </div>
          </div>

          <div className="grid grid-cols-4 gap-1.5 pt-2 border-t border-zinc-200/70 dark:border-zinc-700/60 text-center">
            <div>
              <div className="text-[10px] text-zinc-400">蛋白质</div>
              <div className="text-xs font-semibold text-blue-600 dark:text-blue-400 num-tabular">
                {liveTargets.targetProteinG}g
              </div>
            </div>
            <div>
              <div className="text-[10px] text-zinc-400">碳水</div>
              <div className="text-xs font-semibold text-amber-600 dark:text-amber-400 num-tabular">
                {liveTargets.targetCarbsG}g
              </div>
            </div>
            <div>
              <div className="text-[10px] text-zinc-400">脂肪</div>
              <div className="text-xs font-semibold text-rose-600 dark:text-rose-400 num-tabular">
                {liveTargets.targetFatG}g
              </div>
            </div>
            <div>
              <div className="text-[10px] text-zinc-400">基础饮水</div>
              <div className="text-xs font-semibold text-sky-600 dark:text-sky-400 num-tabular">
                {liveTargets.targetWaterMl}ml
              </div>
            </div>
          </div>
        </div>

        {/* 基础昵称与常驻城市 */}
        <div className="grid grid-cols-2 gap-2.5">
          <label className="block space-y-1">
            <span className="text-[11px] text-zinc-500 dark:text-zinc-400">昵称</span>
            <input
              type="text"
              value={profileForm.nickname}
              onChange={(e) => setProfileForm({ ...profileForm, nickname: e.target.value })}
              className="w-full px-3 py-2 rounded-xl text-xs bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 focus:outline-none focus:border-emerald-500"
            />
          </label>
          <label className="block space-y-1">
            <span className="text-[11px] text-zinc-500 dark:text-zinc-400">常驻城市（天气与探店）</span>
            <select
              value={resolveCityPreset(profileForm.campus).name}
              onChange={(e) => {
                const picked = resolveCityPreset(e.target.value);
                setProfileForm({ ...profileForm, campus: picked.name });
                setSettingsForm((prev) => ({ ...prev, amapCenterLngLat: picked.lngLat }));
              }}
              className="w-full px-2.5 py-2 rounded-xl text-xs bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 focus:outline-none focus:border-emerald-500"
            >
              {CITY_PRESETS.map((city) => (
                <option key={city.adcode} value={city.name}>
                  {city.name}
                </option>
              ))}
            </select>
          </label>
        </div>

        {/* 性别、年龄、身高、体重 */}
        <div className="grid grid-cols-4 gap-2">
          <label className="block space-y-1">
            <span className="text-[11px] text-zinc-500 dark:text-zinc-400">性别</span>
            <select
              value={profileForm.gender}
              onChange={(e) => setProfileForm({ ...profileForm, gender: e.target.value as Gender })}
              className="w-full px-2 py-2 rounded-xl text-xs bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 focus:outline-none focus:border-emerald-500"
            >
              <option value="male">男</option>
              <option value="female">女</option>
            </select>
          </label>
          <label className="block space-y-1">
            <span className="text-[11px] text-zinc-500 dark:text-zinc-400">年龄</span>
            <input
              type="number"
              min={15}
              max={60}
              value={profileForm.age}
              onChange={(e) => setProfileForm({ ...profileForm, age: Number(e.target.value) })}
              className="w-full px-2.5 py-2 rounded-xl text-xs num-tabular bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 focus:outline-none focus:border-emerald-500"
            />
          </label>
          <label className="block space-y-1">
            <span className="text-[11px] text-zinc-500 dark:text-zinc-400">身高(cm)</span>
            <input
              type="number"
              min={130}
              max={220}
              value={profileForm.heightCm}
              onChange={(e) => setProfileForm({ ...profileForm, heightCm: Number(e.target.value) })}
              className="w-full px-2.5 py-2 rounded-xl text-xs num-tabular bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 focus:outline-none focus:border-emerald-500"
            />
          </label>
          <label className="block space-y-1">
            <span className="text-[11px] text-zinc-500 dark:text-zinc-400">体重(kg)</span>
            <input
              type="number"
              step="0.1"
              min={35}
              max={180}
              value={profileForm.weightKg}
              onChange={(e) => setProfileForm({ ...profileForm, weightKg: Number(e.target.value) })}
              className="w-full px-2.5 py-2 rounded-xl text-xs num-tabular bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 focus:outline-none focus:border-emerald-500"
            />
          </label>
        </div>

        {/* 健身目标切换 */}
        <div className="space-y-1.5">
          <span className="text-[11px] text-zinc-500 dark:text-zinc-400">体态管理目标</span>
          <div className="grid grid-cols-3 gap-2">
            {(Object.keys(FITNESS_GOALS) as FitnessGoal[]).map((goalKey) => (
              <button
                key={goalKey}
                type="button"
                onClick={() => setProfileForm({ ...profileForm, goal: goalKey })}
                className={`py-2 px-2 rounded-xl text-xs font-medium border transition-colors ${
                  profileForm.goal === goalKey
                    ? 'bg-zinc-900 text-white border-zinc-900 dark:bg-zinc-100 dark:text-zinc-900 dark:border-zinc-100'
                    : 'bg-zinc-50 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 border-zinc-200 dark:border-zinc-700'
                }`}
              >
                {FITNESS_GOALS[goalKey].label}
              </button>
            ))}
          </div>
          <p className="text-[11px] text-zinc-400">{FITNESS_GOALS[profileForm.goal].hint}</p>
        </div>

        {/* 活动水平 */}
        <label className="block space-y-1">
          <span className="text-[11px] text-zinc-500 dark:text-zinc-400">日常活动量</span>
          <select
            value={profileForm.activityLevel}
            onChange={(e) =>
              setProfileForm({ ...profileForm, activityLevel: e.target.value as ActivityLevel })
            }
            className="w-full px-3 py-2 rounded-xl text-xs bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 focus:outline-none focus:border-emerald-500"
          >
            {(Object.keys(ACTIVITY_MULTIPLIERS) as ActivityLevel[]).map((key) => (
              <option key={key} value={key}>
                {ACTIVITY_MULTIPLIERS[key].label} — {ACTIVITY_MULTIPLIERS[key].desc}
              </option>
            ))}
          </select>
        </label>

        {/* 每日预算 + 训练日加成 + 入睡目标 */}
        <div className="grid grid-cols-3 gap-2">
          <label className="block space-y-1">
            <span className="text-[11px] text-zinc-500 dark:text-zinc-400">日均预算(¥)</span>
            <input
              type="number"
              min={10}
              max={300}
              value={profileForm.dailyBudgetYuan}
              onChange={(e) =>
                setProfileForm({ ...profileForm, dailyBudgetYuan: Number(e.target.value) })
              }
              className="w-full px-2.5 py-2 rounded-xl text-xs num-tabular bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 focus:outline-none focus:border-emerald-500"
            />
          </label>
          <label className="block space-y-1">
            <span className="text-[11px] text-zinc-500 dark:text-zinc-400">训练日+碳水(g)</span>
            <input
              type="number"
              min={0}
              max={150}
              value={profileForm.trainingDayExtraCarbsG}
              onChange={(e) =>
                setProfileForm({ ...profileForm, trainingDayExtraCarbsG: Number(e.target.value) })
              }
              className="w-full px-2.5 py-2 rounded-xl text-xs num-tabular bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 focus:outline-none focus:border-emerald-500"
            />
          </label>
          <label className="block space-y-1">
            <span className="text-[11px] text-zinc-500 dark:text-zinc-400">目标入睡</span>
            <input
              type="time"
              value={profileForm.bedtimeTarget}
              onChange={(e) => setProfileForm({ ...profileForm, bedtimeTarget: e.target.value })}
              className="w-full px-2.5 py-2 rounded-xl text-xs num-tabular bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 focus:outline-none focus:border-emerald-500"
            />
          </label>
        </div>

        <button
          type="submit"
          className="w-full flex items-center justify-center gap-1.5 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-white text-xs font-semibold active:scale-[0.99] transition-all"
        >
          <Save className="w-3.5 h-3.5" />
          保存身体档案并同步每日目标
        </button>
      </form>

      {/* 模块 3A：App 自带内置端侧 AI（Android 原生 llama.cpp，零外部电脑依赖） */}
      <EmbeddedLocalAiCard
        settings={settingsForm}
        onActivateEmbeddedModel={handleActivateEmbeddedModel}
        onSwitchBackCloud={handleSwitchBackCloud}
        onNotify={onNotify}
      />

      {/* 模块 3B：云端联网多模态 AI 配置与连通性测试 */}
      <section className="rounded-2xl bg-white dark:bg-zinc-900/90 border border-zinc-200/80 dark:border-zinc-800/90 p-4 space-y-3.5">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 flex items-center gap-2 min-w-0">
            <Cpu className="w-4 h-4 text-emerald-500 shrink-0" />
            <span className="truncate">云端联网 AI（识图 + 搜网）</span>
          </h2>
          <span className="text-[10px] text-zinc-400 shrink-0 whitespace-nowrap">Key 仅存本地</span>
        </div>

        {/* 免费与进阶预设（带官网直达领 Key 按钮） */}
        <div className="space-y-2">
          <div className="grid grid-cols-1 gap-1.5">
            {AI_PROVIDER_PRESETS.map((preset) => {
              const isSelected =
                settingsForm.aiProvider !== 'local_embedded' &&
                settingsForm.aiBaseUrl.trim().replace(/\/+$/, '') === preset.baseUrl &&
                settingsForm.aiModel.trim() === preset.defaultModel;
              return (
                <div
                  key={preset.id}
                  className={`flex items-center justify-between gap-2 px-3 py-2 rounded-xl border transition-colors ${
                    isSelected
                      ? 'bg-emerald-500/10 border-emerald-500/40'
                      : 'bg-zinc-50 dark:bg-zinc-800/60 border-zinc-200/80 dark:border-zinc-700/70'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => handleApplyPreset(preset.id)}
                    className="flex-1 min-w-0 text-left"
                  >
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">
                        {preset.name}
                      </span>
                      <span
                        className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                          preset.isFree
                            ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400'
                            : 'bg-zinc-200 dark:bg-zinc-700 text-zinc-600 dark:text-zinc-300'
                        }`}
                      >
                        {preset.badge}
                      </span>
                    </div>
                    <p className="text-[10px] text-zinc-500 dark:text-zinc-400 mt-0.5 leading-snug">
                      {preset.hint}
                    </p>
                  </button>

                  <a
                    href={preset.keyUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="shrink-0 inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 text-emerald-600 dark:text-emerald-400 hover:border-emerald-500 transition-colors"
                  >
                    {preset.isFree ? '领免费Key' : '获取Key'}
                    <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
              );
            })}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2.5">
          <label className="block space-y-1">
            <span className="text-[11px] text-zinc-500 dark:text-zinc-400">API 协议格式</span>
            <select
              value={settingsForm.aiProvider}
              onChange={(e) =>
                setSettingsForm({ ...settingsForm, aiProvider: e.target.value as AiProvider })
              }
              className="w-full px-2.5 py-2 rounded-xl text-xs bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 focus:outline-none focus:border-emerald-500"
            >
              <option value="local_embedded">App 自带端侧 AI (离线)</option>
              <option value="openai_compatible">OpenAI 兼容格式</option>
              <option value="gemini">Google Gemini 原生</option>
            </select>
          </label>
          <label className="block space-y-1">
            <span className="text-[11px] text-zinc-500 dark:text-zinc-400">模型名称</span>
            <input
              type="text"
              placeholder="gemini-2.5-flash / gpt-4o-mini"
              value={settingsForm.aiModel}
              onChange={(e) => setSettingsForm({ ...settingsForm, aiModel: e.target.value })}
              className="w-full px-2.5 py-2 rounded-xl text-xs bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 focus:outline-none focus:border-emerald-500"
            />
          </label>
        </div>

        <label className="block space-y-1">
          <span className="text-[11px] text-zinc-500 dark:text-zinc-400">接口 Base URL</span>
          <input
            type="url"
            placeholder="https://api.openai.com/v1"
            value={settingsForm.aiBaseUrl}
            onChange={(e) => setSettingsForm({ ...settingsForm, aiBaseUrl: e.target.value })}
            className="w-full px-3 py-2 rounded-xl text-xs font-mono bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 focus:outline-none focus:border-emerald-500"
          />
        </label>

        <label className="block space-y-1">
          <span className="text-[11px] text-zinc-500 dark:text-zinc-400">API Key</span>
          <div className="relative">
            <input
              type={showApiKey ? 'text' : 'password'}
              placeholder="sk-... 或 AIza..."
              value={settingsForm.aiApiKey}
              onChange={(e) => setSettingsForm({ ...settingsForm, aiApiKey: e.target.value })}
              className="w-full pl-3 pr-9 py-2 rounded-xl text-xs font-mono bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 focus:outline-none focus:border-emerald-500"
            />
            <button
              type="button"
              onClick={() => setShowApiKey((v) => !v)}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200"
            >
              {showApiKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
        </label>

        {/* 高德地图 Web服务 Key（个人实名认证免费 5000次/月 · 实时探店 + 城市实况天气） */}
        <div className="space-y-1.5 pt-2 border-t border-zinc-100 dark:border-zinc-800/80">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] text-zinc-500 dark:text-zinc-400 flex items-center gap-1 min-w-0">
              <MapPin className="w-3 h-3 text-sky-500 shrink-0" />
              <span className="truncate">高德 Web服务 Key（个人免费 5000次/月 · 探店+天气）</span>
            </span>
            <a
              href="https://console.amap.com/dev/key/app"
              target="_blank"
              rel="noreferrer"
              className="shrink-0 inline-flex items-center gap-0.5 text-[11px] font-semibold text-sky-600 dark:text-sky-400 hover:underline"
            >
              免费领Key
              <ExternalLink className="w-3 h-3" />
            </a>
          </div>
          <div className="flex gap-1.5">
            <div className="relative flex-1 min-w-0">
              <input
                type={showAmapKey ? 'text' : 'password'}
                placeholder="选「Web服务」平台申请免费 Key 填在此处"
                value={settingsForm.amapWebKey}
                onChange={(e) => setSettingsForm({ ...settingsForm, amapWebKey: e.target.value })}
                className="w-full pl-3 pr-9 py-2 rounded-xl text-xs font-mono bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 focus:outline-none focus:border-emerald-500"
              />
              <button
                type="button"
                onClick={() => setShowAmapKey((v) => !v)}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200"
              >
                {showAmapKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            <button
              type="button"
              disabled={testingAmap || !settingsForm.amapWebKey.trim()}
              onClick={handleTestAmap}
              className="shrink-0 px-3 py-2 rounded-xl text-xs font-semibold bg-sky-500/12 text-sky-700 dark:text-sky-300 border border-sky-500/30 disabled:opacity-50"
            >
              {testingAmap ? '测速中...' : '测高德'}
            </button>
          </div>
          {amapTestResult && (
            <p
              className={`text-[11px] ${
                amapTestResult.ok
                  ? 'text-emerald-600 dark:text-emerald-400'
                  : 'text-rose-600 dark:text-rose-400'
              }`}
            >
              {amapTestResult.message}
            </p>
          )}
        </div>

        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={handleSaveAiSettings}
            className="inline-flex items-center justify-center gap-1.5 py-2.5 rounded-xl bg-zinc-900 hover:bg-zinc-800 dark:bg-zinc-100 dark:hover:bg-white text-white dark:text-zinc-900 text-xs font-semibold transition-colors"
          >
            <Check className="w-3.5 h-3.5" />
            保存接口配置
          </button>
          <button
            type="button"
            disabled={testingAi}
            onClick={handleTestAi}
            className="inline-flex items-center justify-center gap-1.5 py-2.5 rounded-xl border border-emerald-500/40 bg-emerald-500/10 hover:bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 text-xs font-semibold transition-colors disabled:opacity-60"
          >
            {testingAi ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                正在探测...
              </>
            ) : (
              '测试连通性'
            )}
          </button>
        </div>

        {/* 连通性测试反馈 */}
        {testResult && (
          <div
            className={`flex items-start gap-2 p-3 rounded-xl text-xs border ${
              testResult.ok
                ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-800 dark:text-emerald-300'
                : 'bg-rose-500/10 border-rose-500/30 text-rose-800 dark:text-rose-300'
            }`}
          >
            {testResult.ok ? (
              <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
            ) : (
              <XCircle className="w-4 h-4 shrink-0 mt-0.5" />
            )}
            <div className="min-w-0 break-words">
              <p className="font-semibold">{testResult.message}</p>
              {testResult.replyPreview && (
                <p className="opacity-80 mt-0.5 font-mono">模型响应：{testResult.replyPreview}</p>
              )}
            </div>
          </div>
        )}
      </section>

      {/* 模块 4：纯本地数据统计与 JSON 一键导入/导出备份 */}
      <section className="rounded-2xl bg-white dark:bg-zinc-900/90 border border-zinc-200/80 dark:border-zinc-800/90 p-4 space-y-3">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
          <Database className="w-4 h-4 text-emerald-500" />
          本地数据隐私与 JSON 备份
        </h2>
        <p className="text-xs text-zinc-500 dark:text-zinc-400 leading-relaxed">
          当前已本地存储{' '}
          <span className="font-semibold text-zinc-800 dark:text-zinc-200 num-tabular">
            {dbStats?.foods ?? 0}
          </span>{' '}
          道常见菜品、
          <span className="font-semibold text-zinc-800 dark:text-zinc-200 num-tabular">
            {dbStats?.habits ?? 0}
          </span>{' '}
          天打卡日志、
          <span className="font-semibold text-zinc-800 dark:text-zinc-200 num-tabular">
            {dbStats?.plans ?? 0}
          </span>{' '}
          套训练分化。导出 JSON 默认自动脱敏，不包含你的个人 API Key，换机或分享菜谱更安全。
        </p>

        <div className="grid grid-cols-3 gap-2">
          <button
            type="button"
            onClick={handleExport}
            className="inline-flex items-center justify-center gap-1 py-2.5 rounded-xl bg-zinc-100 hover:bg-zinc-200/80 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-800 dark:text-zinc-100 text-xs font-semibold transition-colors"
          >
            <Download className="w-3.5 h-3.5" />
            导出文件
          </button>

          <button
            type="button"
            onClick={handleCopyBackupJson}
            className="inline-flex items-center justify-center gap-1 py-2.5 rounded-xl bg-zinc-100 hover:bg-zinc-200/80 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-800 dark:text-zinc-100 text-xs font-semibold transition-colors"
          >
            <Copy className="w-3.5 h-3.5" />
            复制文本
          </button>

          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="inline-flex items-center justify-center gap-1 py-2.5 rounded-xl border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-200 text-xs font-semibold transition-colors"
          >
            <Upload className="w-3.5 h-3.5" />
            导入恢复
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json,.json"
            onChange={handleImportFile}
            className="hidden"
          />
        </div>

        {importStatus && (
          <p className="text-[11px] text-zinc-600 dark:text-zinc-300 bg-zinc-50 dark:bg-zinc-800 px-3 py-2 rounded-lg">
            {importStatus}
          </p>
        )}

        {/* 隐私声明与一键清空全部本机数据 */}
        <div className="pt-2.5 border-t border-zinc-100 dark:border-zinc-800/80 space-y-2.5">
          <div className="flex items-start gap-2 text-[11px] text-zinc-500 dark:text-zinc-400 leading-relaxed">
            <ShieldCheck className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
            <span>
              隐私承诺：LifeOS 无账号体系、无中心数据服务器、无广告追踪，所有体重、餐单、训练与密钥仅保存在你当前设备本地。
            </span>
          </div>

          {!confirmClearAll ? (
            <button
              type="button"
              onClick={() => setConfirmClearAll(true)}
              className="w-full inline-flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-medium text-rose-600 dark:text-rose-400 bg-rose-500/8 hover:bg-rose-500/15 border border-rose-500/20 transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5" />
              清空全部本机个人数据
            </button>
          ) : (
            <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 space-y-2">
              <p className="text-xs font-medium text-rose-700 dark:text-rose-300">
                确认清空本机全部身体档案、打卡记录、自录菜品与已保存的 API Key？（不可撤销，建议先导出备份）
              </p>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setConfirmClearAll(false)}
                  className="py-1.5 rounded-lg text-xs font-medium bg-white dark:bg-zinc-900 text-zinc-700 dark:text-zinc-300 border border-zinc-200 dark:border-zinc-700"
                >
                  取消
                </button>
                <button
                  type="button"
                  onClick={handleClearAllLocalData}
                  className="py-1.5 rounded-lg text-xs font-semibold bg-rose-600 text-white"
                >
                  确认彻底清空
                </button>
              </div>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
