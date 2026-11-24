import { useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  Camera,
  Check,
  Download,
  Heart,
  Loader2,
  LocateFixed,
  MapPin,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
  Star,
  Trash2,
  Wand2,
  X,
} from 'lucide-react';
import { db } from '../db/database';
import type { useTodaySummary } from '../hooks/useTodaySummary';
import { resolveVisionModel } from '../lib/aiClient';
import {
  estimateFoodItemFromPoi,
  generateDishesWithAiForPoi,
  NATIONWIDE_CHAIN_GUIDES,
  requestCurrentLocation,
  resolveCityPreset,
  reverseGeocodeAmap,
  searchAmapNearbyRestaurants,
  searchOsmNearbyRestaurants,
  type NearbyRestaurant,
} from '../lib/amap';
import {
  buildAiMealAdvice,
  buildLocalMealAdvice,
  WORKOUT_SCENE_PRESETS,
  type MealAdviceResult,
} from '../lib/mealAdvisor';
import { generateSmartDailyPlan, type DailyMealPlan } from '../lib/mealPlanner';
import { parseMenuImageWithAi } from '../lib/menuVision';
import { hapticLight } from '../lib/native';
import type { FoodItem, FoodSourceType, MealSlot } from '../types/models';

type SummaryData = ReturnType<typeof useTodaySummary>;

interface DietPageProps {
  summary: SummaryData;
  onOpenSettings: () => void;
  onAskAi: (prompt: string, autoSend?: boolean) => void;
  onNotify: (text: string) => void;
}

type LibraryCategory = 'all' | 'favorite' | 'canteen' | 'light' | 'fastfood' | 'drink';

/**
 * 极简高效版健康饮食页（3 栏主结构，面向全国通用）：
 * 1. 吃什么：按训练场景速配（本地 + AI）与一日三餐排班（单餐换一换）
 * 2. 美食库：54+ 全国常见中餐/轻食/快餐/便利店营养库 + 识图/快速手动记餐
 * 3. 周边探店：全国连锁点单攻略 + GPS 定位 + 高德/OSM 实时周边餐馆
 */
export function DietPage({ summary, onOpenSettings, onAskAi, onNotify }: DietPageProps) {
  const { profile, settings, habit, dailyTargets, consumed, lowBatteryMode, actions } = summary;

  const [subView, setSubView] = useState<'eat' | 'library' | 'explore'>('eat');
  const [eatMode, setEatMode] = useState<'scene' | 'plan'>('scene');

  // ---- 三餐排班态 ----
  const [customPlan, setCustomPlan] = useState<DailyMealPlan | null>(null);

  // ---- 美食库态 ----
  const [libCategory, setLibCategory] = useState<LibraryCategory>('all');
  const [libSearch, setLibSearch] = useState('');
  const [showVisionPanel, setShowVisionPanel] = useState(false);
  const [showAddFoodForm, setShowAddFoodForm] = useState(false);
  const [logImmediately, setLogImmediately] = useState(true);
  const [newFood, setNewFood] = useState({
    sourceType: 'canteen' as FoodSourceType,
    location: '中式简餐 / 自录',
    storeName: '',
    name: '',
    priceYuan: 18,
    calories: 550,
    proteinG: 30,
    carbsG: 65,
    fatG: 16,
  });

  const [visionSourceType, setVisionSourceType] = useState<FoodSourceType>('takeaway');
  const [visionLocation, setVisionLocation] = useState('外卖 / 餐厅菜单');
  const [visionParsing, setVisionParsing] = useState(false);
  const [visionError, setVisionError] = useState<string | null>(null);
  const [visionMeta, setVisionMeta] = useState<string | null>(null);
  const [visionParsedItems, setVisionParsedItems] = useState<Array<Omit<FoodItem, 'id'>>>([]);
  const [visionSelectedIdx, setVisionSelectedIdx] = useState<Set<number>>(() => new Set());
  const visionFileRef = useRef<HTMLInputElement>(null);

  // ---- 场景推荐态 ----
  const [workoutInput, setWorkoutInput] = useState(WORKOUT_SCENE_PRESETS[0].promptText);
  const [activeSceneId, setActiveSceneId] = useState<string>(WORKOUT_SCENE_PRESETS[0].id);
  const [aiAdvice, setAiAdvice] = useState<MealAdviceResult | null>(null);
  const [adviceLoading, setAdviceLoading] = useState(false);
  const [adviceError, setAdviceError] = useState<string | null>(null);

  // ---- 探店态 ----
  const [poiKeyword, setPoiKeyword] = useState('');
  const [radiusMeters, setRadiusMeters] = useState(1500);
  const [searchingPoi, setSearchingPoi] = useState(false);
  const [locating, setLocating] = useState(false);
  const [searchSource, setSearchSource] = useState<'nationwide_guide' | 'amap' | 'osm'>(
    'nationwide_guide',
  );
  const [searchError, setSearchError] = useState<string | null>(null);
  const [nearbyList, setNearbyList] = useState<NearbyRestaurant[]>(NATIONWIDE_CHAIN_GUIDES);
  const [aiLoadingPoiId, setAiLoadingPoiId] = useState<string | null>(null);
  const [addedKeys, setAddedKeys] = useState<Set<string>>(() => new Set());

  const rawFoods = useLiveQuery(() => db.foodItems.toArray(), []);
  const foods = useMemo(() => rawFoods ?? [], [rawFoods]);

  const hasAmapKey = Boolean(settings.amapWebKey.trim());
  const hasAiKey = settings.aiProvider === 'local_embedded' || Boolean(settings.aiApiKey.trim());
  const activeVisionModel = resolveVisionModel(settings);

  const remainingCalories = Math.max(0, dailyTargets.calories - consumed.calories);
  const remainingProteinG = Math.max(0, dailyTargets.proteinG - consumed.proteinG);

  const localAdvice = useMemo(
    () =>
      buildLocalMealAdvice({
        query: workoutInput,
        foods,
        profile,
        remainingCalories,
        remainingProteinG,
        lowBatteryMode,
      }),
    [workoutInput, foods, profile, remainingCalories, remainingProteinG, lowBatteryMode],
  );
  const displayedAdvice = aiAdvice ?? localAdvice;

  const defaultPlan = useMemo(
    () =>
      generateSmartDailyPlan({
        foods,
        dailyBudgetYuan: profile.dailyBudgetYuan,
        targetCalories: dailyTargets.calories,
        isTrainingDay: habit.isTrainingDay,
      }),
    [foods, profile.dailyBudgetYuan, dailyTargets.calories, habit.isTrainingDay],
  );
  const activePlan = customPlan ?? defaultPlan;

  const handleRegenerateAllPlan = () => {
    void hapticLight();
    setCustomPlan(
      generateSmartDailyPlan({
        foods,
        dailyBudgetYuan: profile.dailyBudgetYuan,
        targetCalories: dailyTargets.calories,
        isTrainingDay: habit.isTrainingDay,
        randomJitter: true,
      }),
    );
    onNotify('已重新生成今日三餐');
  };

  const handleSwapSingleMeal = (slot: 'breakfast' | 'lunch' | 'dinner') => {
    void hapticLight();
    const exclude = new Set<string>();
    for (const existing of [activePlan.breakfast, activePlan.lunch, activePlan.dinner]) {
      if (existing) exclude.add(`${existing.storeName}::${existing.name}`);
    }
    const locked: Partial<Record<'breakfast' | 'lunch' | 'dinner', FoodItem | null>> = {
      breakfast: slot === 'breakfast' ? undefined : activePlan.breakfast,
      lunch: slot === 'lunch' ? undefined : activePlan.lunch,
      dinner: slot === 'dinner' ? undefined : activePlan.dinner,
    };
    setCustomPlan(
      generateSmartDailyPlan({
        foods,
        dailyBudgetYuan: profile.dailyBudgetYuan,
        targetCalories: dailyTargets.calories,
        isTrainingDay: habit.isTrainingDay,
        locked,
        excludeKeys: exclude,
        randomJitter: true,
      }),
    );
  };

  const filteredFoods = useMemo(() => {
    const kw = libSearch.trim().toLowerCase();
    return foods.filter((f) => {
      const text = `${f.storeName} ${f.location} ${f.name} ${f.tags.join(' ')}`.toLowerCase();
      if (kw && !text.includes(kw)) return false;
      if (libCategory === 'all') return true;
      if (libCategory === 'favorite') return f.isFavorite;
      if (libCategory === 'drink') {
        return /咖啡|奶茶|饮品|瑞幸|霸王茶姬|蜜雪|星巴克|便利店|全家|7-11|罗森|蛋白粉|加餐|坚果/.test(text);
      }
      if (libCategory === 'fastfood') {
        return /kfc|肯德基|麦当劳|塔斯汀|萨莉亚|赛百味|披萨|汉堡|炸鸡|麻辣烫|螺蛳粉|烤肉/.test(text);
      }
      if (libCategory === 'light') {
        return /轻食|沙拉|波奇|鸡胸|龙利鱼|三文鱼|牛排|大虾|酸奶|三明治|居家/.test(text);
      }
      // 中式简餐
      return f.sourceType === 'canteen' && !/便利店|全家|7-11|罗森/.test(text);
    });
  }, [foods, libCategory, libSearch]);

  const handleSelectScene = (sceneId: string, promptText: string) => {
    void hapticLight();
    setActiveSceneId(sceneId);
    setWorkoutInput(promptText);
    setAiAdvice(null);
    setAdviceError(null);
  };

  const handleRunAiAdvice = async () => {
    if (!hasAiKey) {
      setAdviceError('尚未配置 AI Key，点击右上设置 10 秒即可填免费 Key。');
      return;
    }
    setAdviceLoading(true);
    setAdviceError(null);
    try {
      const res = await buildAiMealAdvice({
        query: workoutInput,
        foods,
        profile,
        settings,
        remainingCalories,
        remainingProteinG,
        lowBatteryMode,
      });
      setAiAdvice(res);
      onNotify(`AI 精排完成 (${res.latencyMs}ms)`);
    } catch (err: unknown) {
      setAdviceError(err instanceof Error ? err.message : String(err));
    } finally {
      setAdviceLoading(false);
    }
  };

  const handleUploadMenuImage = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!hasAiKey) {
      setVisionError('请先在设置页配置免费 AI Key，即可调用视觉识图。');
      return;
    }
    setVisionParsing(true);
    setVisionError(null);
    setVisionMeta(null);
    setVisionParsedItems([]);
    try {
      const res = await parseMenuImageWithAi({
        file,
        sourceTypeHint: visionSourceType,
        locationHint: visionLocation,
        settings,
      });
      setVisionParsedItems(res.items);
      setVisionSelectedIdx(new Set(res.items.map((_, i) => i)));
      setVisionMeta(`识别出 ${res.items.length} 道菜品 (${(res.latencyMs / 1000).toFixed(1)}s)`);
    } catch (err: unknown) {
      setVisionError(err instanceof Error ? err.message : String(err));
    } finally {
      setVisionParsing(false);
    }
  };

  const toggleVisionIdx = (idx: number) => {
    setVisionSelectedIdx((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  };

  const handleConfirmImportVisionItems = async () => {
    const toSave = visionParsedItems.filter((_, idx) => visionSelectedIdx.has(idx));
    if (toSave.length === 0) return;
    await db.foodItems.bulkAdd(toSave);
    onNotify(`已批量入库 ${toSave.length} 道菜品`);
    setVisionParsedItems([]);
    setVisionMeta(null);
    setShowVisionPanel(false);
  };

  const handleManualAddFood = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newFood.name.trim()) return;
    const now = Date.now();
    const record: Omit<FoodItem, 'id'> = {
      sourceType: newFood.sourceType,
      location: newFood.location.trim() || '自录美食',
      storeName: newFood.storeName.trim() || '日常自录',
      name: newFood.name.trim(),
      priceYuan: Math.max(0, Number(newFood.priceYuan) || 0),
      portionDesc: '1份',
      calories: Math.max(10, Math.round(Number(newFood.calories) || 500)),
      proteinG: Math.max(0, Math.round(Number(newFood.proteinG) || 20)),
      carbsG: Math.max(0, Math.round(Number(newFood.carbsG) || 60)),
      fatG: Math.max(0, Math.round(Number(newFood.fatG) || 15)),
      cookingOilFactor: 1.15,
      confidence: 'manual',
      tags: ['自录'],
      mealSlots: ['breakfast', 'lunch', 'dinner'],
      isFavorite: true,
      createdAt: now,
      updatedAt: now,
    };
    const insertedId = await db.foodItems.add(record);
    if (logImmediately) {
      await actions.logMealFromFood({ ...record, id: Number(insertedId) });
    }
    setNewFood((prev) => ({ ...prev, name: '' }));
    setShowAddFoodForm(false);
    onNotify(
      logImmediately
        ? `已收录并记入今日餐单：${record.name}`
        : `已收录至美食库：${record.name}`,
    );
  };

  const handleToggleFavorite = async (item: FoodItem) => {
    if (item.id === undefined) return;
    void hapticLight();
    await db.foodItems.update(item.id, { isFavorite: !item.isFavorite, updatedAt: Date.now() });
  };

  const handleDeleteFood = async (item: FoodItem) => {
    if (item.id === undefined) return;
    await db.foodItems.delete(item.id);
    onNotify(`已删除：${item.name}`);
  };

  const handleExportFoodPack = () => {
    const payload = {
      pack: 'LifeOS-FoodPack',
      exportedAt: new Date().toISOString(),
      count: foods.length,
      foods,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `lifeos-foods-${foods.length}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    onNotify(`已导出 ${foods.length} 道菜谱包`);
  };

  const handleEatFood = async (food: FoodItem, slot?: MealSlot) => {
    const res = await actions.logMealFromFood(food, slot);
    onNotify(
      res.gainedXp > 0
        ? `已记餐「${food.name}」· +${res.gainedXp} XP`
        : `已记餐「${food.name}」+${food.calories}kcal`,
    );
  };

  const activeCenterLngLat =
    settings.amapCenterLngLat.trim() || resolveCityPreset(profile.campus).lngLat;

  const handleLocateMe = async () => {
    setLocating(true);
    setSearchError(null);
    try {
      const pos = await requestCurrentLocation();
      let cityLabel = profile.campus;
      if (hasAmapKey) {
        try {
          const geo = await reverseGeocodeAmap(settings.amapWebKey, pos.lngLat);
          cityLabel = geo.cityName;
        } catch {
          // 逆地理失败保留原城市名，坐标依然生效
        }
      }
      await db.settings.put({
        ...settings,
        amapCenterLngLat: pos.lngLat,
        updatedAt: Date.now(),
      });
      if (cityLabel && cityLabel !== profile.campus) {
        await db.userProfile.put({ ...profile, campus: cityLabel, updatedAt: Date.now() });
      }
      onNotify(`已定位至 ${cityLabel || '当前坐标'}，可搜附近真实餐馆`);
    } catch (err: unknown) {
      setSearchError(err instanceof Error ? err.message : String(err));
    } finally {
      setLocating(false);
    }
  };

  const handleAmapSearch = async () => {
    if (!hasAmapKey) {
      setSearchError('尚未填写高德 Key，可先用「全国连锁」攻略或去设置页 10 秒填个人免费高德 Key。');
      return;
    }
    setSearchingPoi(true);
    setSearchError(null);
    setSearchSource('amap');
    try {
      const list = await searchAmapNearbyRestaurants({
        apiKey: settings.amapWebKey,
        location: activeCenterLngLat,
        keywords: poiKeyword,
        radiusMeters,
      });
      setNearbyList(list);
      onNotify(`高德地图找到 ${list.length} 家附近餐馆`);
    } catch (err: unknown) {
      setSearchError(err instanceof Error ? err.message : String(err));
    } finally {
      setSearchingPoi(false);
    }
  };

  const handleOsmSearch = async () => {
    setSearchingPoi(true);
    setSearchError(null);
    setSearchSource('osm');
    try {
      const list = await searchOsmNearbyRestaurants(activeCenterLngLat, radiusMeters);
      setNearbyList(list);
      if (list.length === 0) setSearchError('当前坐标附近 OSM 暂未收录，可切回「全国连锁」或配高德 Key。');
    } catch (err: unknown) {
      setSearchError(err instanceof Error ? err.message : String(err));
    } finally {
      setSearchingPoi(false);
    }
  };

  const handleGuideFilter = (kw = poiKeyword) => {
    setSearchSource('nationwide_guide');
    setSearchError(null);
    const q = kw.trim().toLowerCase();
    if (!q) {
      setNearbyList(NATIONWIDE_CHAIN_GUIDES);
      return;
    }
    setNearbyList(
      NATIONWIDE_CHAIN_GUIDES.filter((p) =>
        `${p.name} ${p.area} ${p.category} ${p.signatureDishes.join(' ')}`.toLowerCase().includes(q),
      ),
    );
  };

  const handleQuickAddDish = async (poi: NearbyRestaurant, dishName?: string) => {
    const item = estimateFoodItemFromPoi(poi, dishName);
    await db.foodItems.add(item);
    const key = `${poi.id}-${dishName ?? 'default'}`;
    setAddedKeys((prev) => new Set(prev).add(key));
    onNotify(`已收入美食库：${item.name}`);
  };

  const handleAiGenerateDishes = async (poi: NearbyRestaurant) => {
    if (!hasAiKey) {
      onNotify('请先在设置页配置免费 AI Key');
      return;
    }
    setAiLoadingPoiId(poi.id);
    try {
      const generated = await generateDishesWithAiForPoi(poi, settings);
      await db.foodItems.bulkAdd(generated);
      onNotify(`AI 已收录「${poi.name}」${generated.length} 道菜`);
    } catch (err: unknown) {
      onNotify(err instanceof Error ? err.message : String(err));
    } finally {
      setAiLoadingPoiId(null);
    }
  };

  return (
    <div className="space-y-4">
      {/* 顶部清爽 3 栏分段 */}
      <div
        data-tour="diet-tabs"
        className="grid grid-cols-3 gap-1 p-1 rounded-2xl bg-zinc-200/70 dark:bg-zinc-900"
      >
        {[
          { id: 'eat' as const, label: '吃什么' },
          { id: 'library' as const, label: `美食库 (${foods.length})` },
          { id: 'explore' as const, label: '周边探店' },
        ].map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => {
              void hapticLight();
              setSubView(tab.id);
            }}
            className={`py-2 rounded-xl text-xs font-semibold transition-all ${
              subView === tab.id
                ? 'bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 shadow-xs'
                : 'text-zinc-500 dark:text-zinc-400'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* ==================== 视图 1：吃什么（场景速配 + 一日三餐） ==================== */}
      {subView === 'eat' && (
        <div className="space-y-4">
          {/* 轻巧子模式切换 + 今日缺口摘要 */}
          <div className="flex items-center justify-between gap-2 px-0.5">
            <div className="inline-flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setEatMode('scene')}
                className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-colors ${
                  eatMode === 'scene'
                    ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900'
                    : 'bg-white dark:bg-zinc-900 text-zinc-500 border border-zinc-200 dark:border-zinc-800'
                }`}
              >
                练完吃啥
              </button>
              <button
                type="button"
                onClick={() => setEatMode('plan')}
                className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-colors ${
                  eatMode === 'plan'
                    ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900'
                    : 'bg-white dark:bg-zinc-900 text-zinc-500 border border-zinc-200 dark:border-zinc-800'
                }`}
              >
                一日三餐
              </button>
            </div>
            <span className="text-xs text-zinc-500 num-tabular">
              剩 {remainingCalories} kcal · 蛋 {remainingProteinG}g
            </span>
          </div>

          {eatMode === 'scene' ? (
            <>
              <section className="rounded-2xl bg-white dark:bg-zinc-900/95 border border-zinc-200/70 dark:border-zinc-800/80 p-4 space-y-3">
                <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar">
                  {WORKOUT_SCENE_PRESETS.map((scene) => (
                    <button
                      key={scene.id}
                      type="button"
                      onClick={() => handleSelectScene(scene.id, scene.promptText)}
                      className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                        activeSceneId === scene.id
                          ? 'bg-[#1a6e5e] text-white'
                          : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300'
                      }`}
                    >
                      {scene.label}
                    </button>
                  ))}
                </div>

                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    void handleRunAiAdvice();
                  }}
                  className="flex gap-2"
                >
                  <input
                    type="text"
                    value={workoutInput}
                    onChange={(e) => {
                      setWorkoutInput(e.target.value);
                      setActiveSceneId('custom');
                      setAiAdvice(null);
                    }}
                    placeholder="如：刚练完背，预算30，想吃中餐或麦当劳"
                    className="flex-1 min-w-0 px-3 py-2 rounded-xl text-xs bg-zinc-50 dark:bg-zinc-800/80 border border-zinc-200 dark:border-zinc-700 focus:outline-none focus:border-emerald-500"
                  />
                  <button
                    type="submit"
                    disabled={adviceLoading}
                    className="shrink-0 inline-flex items-center gap-1 px-3.5 py-2 rounded-xl text-xs font-semibold bg-[#1a6e5e] hover:bg-[#155a4d] text-white disabled:opacity-60"
                  >
                    {adviceLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Wand2 className="w-3.5 h-3.5" />}
                    AI 推荐
                  </button>
                </form>

                {adviceError && <p className="text-xs text-amber-600 dark:text-amber-400">{adviceError}</p>}
              </section>

              {/* 简洁推荐结果列表 */}
              <div className="space-y-2.5">
                <p className="text-xs text-zinc-500 px-1">{displayedAdvice.coachNote}</p>
                {displayedAdvice.items.map((rec, idx) => (
                  <article
                    key={`${rec.food.storeName}-${rec.food.name}-${idx}`}
                    className="rounded-2xl bg-white dark:bg-zinc-900/95 border border-zinc-200/70 dark:border-zinc-800/80 p-4 space-y-2.5"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-[11px] text-zinc-400 truncate">
                          {rec.food.storeName} · {rec.food.location}
                        </p>
                        <h3 className="text-sm font-bold text-zinc-900 dark:text-zinc-100 mt-0.5">
                          {rec.food.name}
                        </h3>
                      </div>
                      <div className="text-right shrink-0">
                        <span className="text-sm font-bold text-zinc-900 dark:text-zinc-100 num-tabular">
                          ¥{rec.food.priceYuan.toFixed(0)}
                        </span>
                        <p className="text-[11px] text-emerald-600 dark:text-emerald-400 num-tabular">
                          {rec.food.calories} kcal
                        </p>
                      </div>
                    </div>

                    <p className="text-xs text-zinc-600 dark:text-zinc-300 leading-relaxed">
                      {rec.reason} · <span className="text-zinc-400">{rec.orderTip}</span>
                    </p>

                    <div className="flex items-center justify-between pt-2 border-t border-zinc-100 dark:border-zinc-800/80">
                      <span className="text-[11px] text-zinc-400 num-tabular">
                        蛋 {rec.food.proteinG}g · 碳 {rec.food.carbsG}g · 脂 {rec.food.fatG}g
                      </span>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() =>
                            onAskAi(
                              `点评一下「${rec.food.storeName}」的「${rec.food.name}」（¥${rec.food.priceYuan} / ${rec.food.calories}kcal / 蛋${rec.food.proteinG}g），结合我今天状态怎么点最聪明？`,
                            )
                          }
                          className="p-1.5 rounded-lg text-zinc-400 hover:text-emerald-500"
                          title="问 AI 点评"
                        >
                          <Sparkles className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleEatFood(rec.food)}
                          className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl text-xs font-semibold bg-[#1a6e5e] text-white active:scale-95"
                        >
                          <Plus className="w-3.5 h-3.5" />
                          记餐
                        </button>
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            </>
          ) : (
            /* 一日三餐排班 */
            <div className="space-y-3">
              <div className="flex items-center justify-between px-4 py-3 rounded-2xl bg-white dark:bg-zinc-900/95 border border-zinc-200/70 dark:border-zinc-800/80">
                <div className="text-xs num-tabular text-zinc-600 dark:text-zinc-300">
                  合计 <strong className="text-zinc-900 dark:text-zinc-100">¥{activePlan.totalPrice}</strong> ·{' '}
                  {activePlan.totalCalories} kcal · 蛋 {activePlan.totalProteinG}g
                </div>
                <button
                  type="button"
                  onClick={handleRegenerateAllPlan}
                  className="inline-flex items-center gap-1 text-xs font-semibold text-[#166556] dark:text-emerald-400"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  整套换
                </button>
              </div>

              {(
                [
                  { slot: 'breakfast' as const, label: '早餐', item: activePlan.breakfast },
                  { slot: 'lunch' as const, label: '午餐', item: activePlan.lunch },
                  { slot: 'dinner' as const, label: '晚餐', item: activePlan.dinner },
                ] as const
              ).map(({ slot, label, item }) => (
                <section
                  key={slot}
                  className="rounded-2xl bg-white dark:bg-zinc-900/95 border border-zinc-200/70 dark:border-zinc-800/80 p-4 space-y-2.5"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400">{label}</span>
                    <button
                      type="button"
                      onClick={() => handleSwapSingleMeal(slot)}
                      className="inline-flex items-center gap-1 text-xs text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
                    >
                      <RefreshCw className="w-3 h-3" />
                      换一换
                    </button>
                  </div>
                  {item ? (
                    <>
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <h3 className="text-sm font-bold text-zinc-900 dark:text-zinc-100 truncate">
                            {item.name}
                          </h3>
                          <p className="text-xs text-zinc-400 mt-0.5 truncate">
                            {item.storeName} · {item.location}
                          </p>
                        </div>
                        <div className="text-right shrink-0 num-tabular">
                          <div className="text-sm font-bold">¥{item.priceYuan.toFixed(0)}</div>
                          <div className="text-[11px] text-zinc-400">{item.calories} kcal</div>
                        </div>
                      </div>
                      <div className="flex items-center justify-between pt-2 border-t border-zinc-100 dark:border-zinc-800/80">
                        <span className="text-[11px] text-zinc-400 num-tabular">
                          蛋 {item.proteinG}g · 碳 {item.carbsG}g · 脂 {item.fatG}g
                        </span>
                        <button
                          type="button"
                          onClick={() => handleEatFood(item, slot)}
                          className="inline-flex items-center gap-1 px-3 py-1 rounded-xl text-xs font-semibold bg-emerald-500/12 text-[#166556] dark:text-emerald-400"
                        >
                          <Plus className="w-3.5 h-3.5" />
                          记餐
                        </button>
                      </div>
                    </>
                  ) : (
                    <p className="text-xs text-zinc-400">暂无候选</p>
                  )}
                </section>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ==================== 视图 2：美食库 ==================== */}
      {subView === 'library' && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search className="w-3.5 h-3.5 text-zinc-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={libSearch}
                onChange={(e) => setLibSearch(e.target.value)}
                placeholder="搜 鸡胸、麦当劳、轻食、奶茶..."
                className="w-full pl-8 pr-3 py-2 rounded-xl text-xs bg-white dark:bg-zinc-900 border border-zinc-200/80 dark:border-zinc-800 focus:outline-none focus:border-emerald-500"
              />
            </div>
            <button
              type="button"
              onClick={() => {
                setShowVisionPanel((v) => !v);
                setShowAddFoodForm(false);
              }}
              title="截图识图批量入库"
              className={`inline-flex items-center gap-1 px-3 py-2 rounded-xl text-xs font-semibold border ${
                showVisionPanel
                  ? 'bg-[#1a6e5e] text-white border-[#1a6e5e]'
                  : 'bg-white dark:bg-zinc-900 text-zinc-700 dark:text-zinc-200 border-zinc-200/80 dark:border-zinc-800'
              }`}
            >
              <Camera className="w-3.5 h-3.5" />
              识图
            </button>
            <button
              type="button"
              onClick={() => {
                setShowAddFoodForm((v) => !v);
                setShowVisionPanel(false);
              }}
              title="手动添加菜品"
              className={`p-2 rounded-xl border ${
                showAddFoodForm
                  ? 'bg-zinc-900 text-white border-zinc-900 dark:bg-zinc-100 dark:text-zinc-900'
                  : 'bg-white dark:bg-zinc-900 text-zinc-600 dark:text-zinc-300 border-zinc-200/80 dark:border-zinc-800'
              }`}
            >
              <Plus className="w-4 h-4" />
            </button>
          </div>

          {showVisionPanel && (
            <section className="rounded-2xl bg-white dark:bg-zinc-900 border border-emerald-500/35 p-4 space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-xs font-bold">外卖截图 / 食堂价目牌识图 ({activeVisionModel})</h2>
                <button type="button" onClick={() => setShowVisionPanel(false)} className="text-zinc-400">
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <select
                  value={visionSourceType}
                  onChange={(e) => {
                    const nextType = e.target.value as FoodSourceType;
                    setVisionSourceType(nextType);
                    setVisionLocation(nextType === 'canteen' ? '中式简餐 / 食堂' : '外卖 / 餐厅菜单');
                  }}
                  className="px-2.5 py-2 rounded-xl text-xs bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700"
                >
                  <option value="takeaway">外卖 / 餐厅</option>
                  <option value="canteen">中式简餐 / 食堂</option>
                </select>
                <input
                  type="text"
                  value={visionLocation}
                  onChange={(e) => setVisionLocation(e.target.value)}
                  className="px-2.5 py-2 rounded-xl text-xs bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700"
                />
              </div>
              <button
                type="button"
                disabled={visionParsing}
                onClick={() => visionFileRef.current?.click()}
                className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl border border-dashed border-emerald-500/50 bg-emerald-500/8 text-xs font-semibold text-emerald-700 dark:text-emerald-300"
              >
                {visionParsing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Camera className="w-4 h-4" />}
                {visionParsing ? 'AI 识别中...' : '选择截图或拍照识别'}
              </button>
              <input ref={visionFileRef} type="file" accept="image/*" onChange={handleUploadMenuImage} className="hidden" />
              {visionError && <p className="text-xs text-rose-500">{visionError}</p>}
              {visionMeta && <p className="text-xs text-emerald-600">{visionMeta}</p>}
              {visionParsedItems.length > 0 && (
                <div className="space-y-2">
                  <div className="max-h-52 overflow-y-auto space-y-1.5">
                    {visionParsedItems.map((it, idx) => {
                      const checked = visionSelectedIdx.has(idx);
                      return (
                        <button
                          key={`${it.name}-${idx}`}
                          type="button"
                          onClick={() => toggleVisionIdx(idx)}
                          className={`w-full flex items-center justify-between gap-2 p-2.5 rounded-xl border text-left ${
                            checked
                              ? 'bg-emerald-500/10 border-emerald-500/40'
                              : 'bg-zinc-50 dark:bg-zinc-800/50 border-transparent opacity-60'
                          }`}
                        >
                          <div className="min-w-0">
                            <p className="text-xs font-semibold truncate">{it.name}</p>
                            <p className="text-[11px] text-zinc-400 num-tabular">
                              {it.calories}kcal · 蛋{it.proteinG}g · ¥{it.priceYuan}
                            </p>
                          </div>
                          {checked && <Check className="w-4 h-4 text-emerald-500 shrink-0" />}
                        </button>
                      );
                    })}
                  </div>
                  <button
                    type="button"
                    onClick={handleConfirmImportVisionItems}
                    className="w-full py-2.5 rounded-xl bg-[#1a6e5e] text-white text-xs font-semibold"
                  >
                    确认入库 ({visionSelectedIdx.size})
                  </button>
                </div>
              )}
            </section>
          )}

          {showAddFoodForm && (
            <form
              onSubmit={handleManualAddFood}
              className="rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 p-4 space-y-2.5"
            >
              <div className="flex items-center justify-between">
                <h2 className="text-xs font-bold">手动收录菜品</h2>
                <button
                  type="button"
                  onClick={handleExportFoodPack}
                  className="inline-flex items-center gap-1 text-[11px] text-zinc-400 hover:text-zinc-700"
                >
                  <Download className="w-3 h-3" />
                  导出菜谱
                </button>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <input
                  type="text"
                  required
                  placeholder="菜品名"
                  value={newFood.name}
                  onChange={(e) => setNewFood({ ...newFood, name: e.target.value })}
                  className="px-3 py-2 rounded-xl text-xs bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700"
                />
                <input
                  type="text"
                  placeholder="档口/店名"
                  value={newFood.storeName}
                  onChange={(e) => setNewFood({ ...newFood, storeName: e.target.value })}
                  className="px-3 py-2 rounded-xl text-xs bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700"
                />
              </div>
              <div className="grid grid-cols-5 gap-1.5 text-[10px] text-zinc-400">
                {(
                  [
                    ['价格¥', 'priceYuan'],
                    ['热量', 'calories'],
                    ['蛋白', 'proteinG'],
                    ['碳水', 'carbsG'],
                    ['脂肪', 'fatG'],
                  ] as const
                ).map(([lbl, key]) => (
                  <label key={key}>
                    {lbl}
                    <input
                      type="number"
                      value={newFood[key]}
                      onChange={(e) => setNewFood({ ...newFood, [key]: Number(e.target.value) })}
                      className="w-full mt-0.5 px-1.5 py-1.5 rounded-lg text-xs text-zinc-900 dark:text-zinc-100 num-tabular bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700"
                    />
                  </label>
                ))}
              </div>
              <label className="flex items-center gap-2 text-xs text-zinc-600 dark:text-zinc-300 pt-0.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={logImmediately}
                  onChange={(e) => setLogImmediately(e.target.checked)}
                  className="rounded accent-emerald-600"
                />
                <span>保存的同时立即记入今日餐单</span>
              </label>
              <button type="submit" className="w-full py-2 rounded-xl text-xs font-semibold bg-[#1a6e5e] text-white">
                {logImmediately ? '保存并记餐' : '仅保存到美食库'}
              </button>
            </form>
          )}

          {/* 分类胶囊 */}
          <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar">
            {[
              { id: 'all' as const, label: '全部' },
              { id: 'favorite' as const, label: '收藏' },
              { id: 'canteen' as const, label: '中式简餐' },
              { id: 'light' as const, label: '轻食健身' },
              { id: 'fastfood' as const, label: '快餐连锁' },
              { id: 'drink' as const, label: '饮品·便利店' },
            ].map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setLibCategory(tab.id)}
                className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-medium ${
                  libCategory === tab.id
                    ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900'
                    : 'bg-white dark:bg-zinc-900 text-zinc-600 dark:text-zinc-400 border border-zinc-200/80 dark:border-zinc-800'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* 简洁单卡美食列表（支持空态一键清空筛选） */}
          {filteredFoods.length === 0 ? (
            <div className="rounded-2xl bg-white dark:bg-zinc-900/95 border border-dashed border-zinc-300 dark:border-zinc-700 p-6 text-center space-y-2.5">
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                当前筛选下没有找到菜品
              </p>
              <button
                type="button"
                onClick={() => {
                  setLibSearch('');
                  setLibCategory('all');
                }}
                className="px-3 py-1.5 rounded-xl text-xs font-semibold bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-200"
              >
                重置筛选查看全部
              </button>
            </div>
          ) : (
            <section className="rounded-2xl bg-white dark:bg-zinc-900/95 border border-zinc-200/70 dark:border-zinc-800/80 divide-y divide-zinc-100 dark:divide-zinc-800/80 overflow-hidden">
              {filteredFoods.map((item) => (
                <div
                  key={item.id ?? `${item.storeName}-${item.name}`}
                  className="flex items-center justify-between gap-3 px-4 py-3.5"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 truncate">
                        {item.name}
                      </h3>
                      <span className="text-xs font-bold text-zinc-700 dark:text-zinc-300 num-tabular shrink-0">
                        ¥{item.priceYuan.toFixed(0)}
                      </span>
                    </div>
                    <p className="text-xs text-zinc-400 mt-0.5 truncate num-tabular">
                      {item.storeName} · {item.calories}kcal · 蛋{item.proteinG}g 碳{item.carbsG}g
                    </p>
                  </div>

                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={() =>
                        onAskAi(
                          `点评一下「${item.storeName}」的「${item.name}」（¥${item.priceYuan} / ${item.calories}kcal / 蛋${item.proteinG}g），今天适合吃吗？`,
                        )
                      }
                      className="p-1.5 rounded-lg text-zinc-400 hover:text-emerald-500"
                      title="问AI"
                    >
                      <Sparkles className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleToggleFavorite(item)}
                      className={`p-1.5 rounded-lg ${item.isFavorite ? 'text-rose-500' : 'text-zinc-300 dark:text-zinc-600'}`}
                      title="收藏"
                    >
                      <Heart className={`w-3.5 h-3.5 ${item.isFavorite ? 'fill-current' : ''}`} />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeleteFood(item)}
                      className="p-1.5 rounded-lg text-zinc-300 dark:text-zinc-600 hover:text-rose-500"
                      title="删除"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleEatFood(item)}
                      className="ml-1 px-2.5 py-1.5 rounded-xl text-xs font-semibold bg-emerald-500/12 text-[#166556] dark:text-emerald-400 active:scale-95"
                    >
                      记餐
                    </button>
                  </div>
                </div>
              ))}
            </section>
          )}
        </div>
      )}

      {/* ==================== 视图 3：附近餐馆与点单指南 ==================== */}
      {subView === 'explore' && (
        <div className="space-y-3">
          <section className="rounded-2xl bg-white dark:bg-zinc-900/95 border border-zinc-200/70 dark:border-zinc-800/80 p-4 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 min-w-0">
                <MapPin className="w-4 h-4 text-emerald-500 shrink-0" />
                <h2 className="text-sm font-bold truncate">
                  附近探店 · {profile.campus || '当前城市'}
                </h2>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  disabled={locating}
                  onClick={handleLocateMe}
                  className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-semibold bg-emerald-500/10 text-[#166556] dark:text-emerald-400"
                >
                  <LocateFixed className={`w-3 h-3 ${locating ? 'animate-spin' : ''}`} />
                  {locating ? '定位中' : '定位我'}
                </button>
                <button
                  type="button"
                  onClick={onOpenSettings}
                  className="text-xs text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
                >
                  {hasAmapKey ? '高德已连' : '配高德Key'}
                </button>
              </div>
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (searchSource === 'amap' || hasAmapKey) {
                  void handleAmapSearch();
                } else {
                  handleGuideFilter(poiKeyword);
                }
              }}
              className="flex gap-2"
            >
              <input
                type="search"
                placeholder="搜 麦当劳、赛百味、轻食、牛肉面..."
                value={poiKeyword}
                onChange={(e) => {
                  setPoiKeyword(e.target.value);
                  if (searchSource === 'nationwide_guide') handleGuideFilter(e.target.value);
                }}
                className="flex-1 px-3 py-2 rounded-xl text-xs bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 focus:outline-none focus:border-emerald-500"
              />
              <select
                value={radiusMeters}
                onChange={(e) => setRadiusMeters(Number(e.target.value))}
                className="px-2.5 py-2 rounded-xl text-xs num-tabular bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700"
              >
                <option value={800}>800m</option>
                <option value={1500}>1.5km</option>
                <option value={3000}>3km</option>
              </select>
            </form>

            <div className="grid grid-cols-3 gap-1.5">
              <button
                type="button"
                onClick={() => handleGuideFilter(poiKeyword)}
                className={`py-1.5 rounded-xl text-xs font-semibold ${
                  searchSource === 'nationwide_guide'
                    ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900'
                    : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300'
                }`}
              >
                全国连锁 ({NATIONWIDE_CHAIN_GUIDES.length})
              </button>
              <button
                type="button"
                disabled={searchingPoi}
                onClick={handleAmapSearch}
                className={`py-1.5 rounded-xl text-xs font-semibold ${
                  searchSource === 'amap'
                    ? 'bg-[#1a6e5e] text-white'
                    : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300'
                }`}
              >
                {searchingPoi ? '查询中...' : '高德实时'}
              </button>
              <button
                type="button"
                disabled={searchingPoi}
                onClick={handleOsmSearch}
                className={`py-1.5 rounded-xl text-xs font-semibold ${
                  searchSource === 'osm'
                    ? 'bg-sky-600 text-white'
                    : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300'
                }`}
              >
                OSM 地图
              </button>
            </div>

            {searchError && <p className="text-xs text-amber-600 dark:text-amber-400">{searchError}</p>}
          </section>

          <div className="space-y-2.5">
            {nearbyList.length === 0 ? (
              <div className="rounded-2xl bg-white dark:bg-zinc-900/95 border border-dashed border-zinc-300 dark:border-zinc-700 p-6 text-center space-y-2">
                <p className="text-xs text-zinc-500">没有匹配到餐馆</p>
                <button
                  type="button"
                  onClick={() => {
                    setPoiKeyword('');
                    handleGuideFilter('');
                  }}
                  className="px-3 py-1.5 rounded-xl text-xs font-semibold bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-200"
                >
                  查看全国连锁攻略
                </button>
              </div>
            ) : (
              nearbyList.map((poi) => {
                const isAiBusy = aiLoadingPoiId === poi.id;
                return (
                  <article
                    key={poi.id}
                    className="rounded-2xl bg-white dark:bg-zinc-900/95 border border-zinc-200/70 dark:border-zinc-800/80 p-4 space-y-2.5"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <h3 className="text-sm font-bold text-zinc-900 dark:text-zinc-100 truncate">
                          {poi.name}
                        </h3>
                        <p className="text-xs text-zinc-400 mt-0.5 num-tabular truncate">
                          {poi.area}
                          {typeof poi.distanceMeters === 'number' && poi.distanceMeters > 0
                            ? ` · ${poi.distanceMeters}m`
                            : ''}
                          {poi.rating && (
                            <span className="inline-flex items-center gap-0.5 text-amber-500 ml-1.5">
                              <Star className="w-3 h-3 fill-current" />
                              {poi.rating}
                            </span>
                          )}
                        </p>
                      </div>
                      {poi.avgCostYuan && (
                        <span className="shrink-0 text-xs font-semibold text-zinc-700 dark:text-zinc-300 num-tabular">
                          人均 ¥{poi.avgCostYuan}
                        </span>
                      )}
                    </div>

                    {poi.signatureDishes.length > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        {poi.signatureDishes.map((dish) => {
                          const key = `${poi.id}-${dish}`;
                          const isAdded = addedKeys.has(key);
                          return (
                            <button
                              key={dish}
                              type="button"
                              onClick={() => handleQuickAddDish(poi, dish)}
                              className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-medium ${
                                isAdded
                                  ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400'
                                  : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300'
                              }`}
                            >
                              {isAdded ? <Check className="w-3 h-3" /> : <Plus className="w-3 h-3" />}
                              {dish}
                            </button>
                          );
                        })}
                      </div>
                    )}

                    <div className="flex items-center justify-between pt-2 border-t border-zinc-100 dark:border-zinc-800/80">
                      <button
                        type="button"
                        onClick={() => handleQuickAddDish(poi)}
                        className="text-xs text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-200"
                      >
                        + 按人均快录
                      </button>
                      <button
                        type="button"
                        disabled={isAiBusy}
                        onClick={() => handleAiGenerateDishes(poi)}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-xl text-xs font-semibold bg-emerald-500/12 text-[#166556] dark:text-emerald-400 disabled:opacity-60"
                      >
                        {isAiBusy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Wand2 className="w-3 h-3" />}
                        {isAiBusy ? '拆解中...' : 'AI 拆菜单'}
                      </button>
                    </div>
                  </article>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
