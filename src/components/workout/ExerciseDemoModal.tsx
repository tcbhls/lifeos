import { useState } from 'react';
import {
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Link2,
  Play,
  Plus,
  Sparkles,
  Trash2,
  Wind,
  X,
} from 'lucide-react';
import {
  EQUIPMENT_LABELS,
  getExerciseGifCdnFallback,
  getExerciseGifUrl,
  type ExerciseLibraryItem,
} from '../../data/exerciseLibrary';

interface ExerciseDemoModalProps {
  exercise: ExerciseLibraryItem;
  currentDayTitle?: string;
  onClose: () => void;
  onAddToCurrentDay?: (ex: ExerciseLibraryItem) => void;
  onRemoveFromCurrentDay?: () => void;
  onAskAi: (prompt: string) => void;
}

const CUSTOM_BV_STORAGE_KEY = 'lifeos_custom_exercise_bvs_v1';

function loadSavedBvid(exerciseId: string): string {
  try {
    const raw = localStorage.getItem(CUSTOM_BV_STORAGE_KEY);
    if (!raw) return '';
    const map = JSON.parse(raw) as Record<string, string>;
    return map[exerciseId] || '';
  } catch {
    return '';
  }
}

function saveCustomBvid(exerciseId: string, bvid: string): void {
  try {
    const raw = localStorage.getItem(CUSTOM_BV_STORAGE_KEY);
    const map = raw ? (JSON.parse(raw) as Record<string, string>) : {};
    if (bvid) map[exerciseId] = bvid;
    else delete map[exerciseId];
    localStorage.setItem(CUSTOM_BV_STORAGE_KEY, JSON.stringify(map));
  } catch {
    // 忽略本地存储配额异常
  }
}

/** 从完整 B站链接或裸 BV 号提取合法 BV 编号 */
function extractBvid(raw: string): string | null {
  const m = raw.trim().match(/(BV[0-9A-Za-z]{10})/i);
  return m ? `BV${m[1].slice(2)}` : null;
}

/**
 * 动作演示弹窗（全新极简专业版）：
 * 1. 顶部直接展示本地离线 360x360 开源 3D 解剖模型动作示范动图（带红区目标肌群高亮）
 * 2. 并排提供【抖音看真人示范】与【B站看详细教学】双平台直达入口
 * 3. 可选折叠绑定自定义 B站 BV 号内嵌播放
 * 4. 精简清晰的 3 步发力要点、呼吸与避坑提示
 */
export function ExerciseDemoModal({
  exercise,
  currentDayTitle,
  onClose,
  onAddToCurrentDay,
  onRemoveFromCurrentDay,
  onAskAi,
}: ExerciseDemoModalProps) {
  const [imgSrc, setImgSrc] = useState(() => getExerciseGifUrl(exercise.gifId));
  const [imgFailed, setImgFailed] = useState(false);

  const [savedBvid, setSavedBvid] = useState(() => loadSavedBvid(exercise.id));
  const [showBindPanel, setShowBindPanel] = useState(false);
  const [bvInput, setBvInput] = useState(() => loadSavedBvid(exercise.id));
  const [bvError, setBvError] = useState<string | null>(null);
  const [showEmbeddedBili, setShowEmbeddedBili] = useState(false);

  const douyinSearchUrl = `https://www.douyin.com/search/${encodeURIComponent(exercise.videoQuery)}?type=video`;
  const biliSearchUrl = `https://search.bilibili.com/all?keyword=${encodeURIComponent(exercise.videoQuery)}`;

  const handleSaveBv = () => {
    const trimmed = bvInput.trim();
    if (!trimmed) {
      saveCustomBvid(exercise.id, '');
      setSavedBvid('');
      setShowEmbeddedBili(false);
      setBvError(null);
      setShowBindPanel(false);
      return;
    }
    const extracted = extractBvid(trimmed);
    if (!extracted) {
      setBvError('请粘贴包含 BV 号的 B站链接（如 BV1xx411c7mD）');
      return;
    }
    saveCustomBvid(exercise.id, extracted);
    setSavedBvid(extracted);
    setBvInput(extracted);
    setBvError(null);
    setShowBindPanel(false);
    setShowEmbeddedBili(true);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm p-0 sm:p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-[440px] max-h-[90dvh] flex flex-col rounded-t-3xl sm:rounded-3xl bg-white dark:bg-[#121418] border border-zinc-200/80 dark:border-zinc-800 shadow-2xl overflow-hidden">
        {/* 顶部简洁标题栏 */}
        <div className="flex items-start justify-between gap-3 px-4 py-3.5 border-b border-zinc-100 dark:border-zinc-800/80">
          <div className="min-w-0">
            <h2 className="text-base font-bold text-zinc-900 dark:text-zinc-100 truncate">
              {exercise.name}
            </h2>
            <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5 truncate">
              {exercise.muscleGroup} · {EQUIPMENT_LABELS[exercise.equipment]} · 节奏 {exercise.tempo}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭"
            className="w-8 h-8 rounded-full flex items-center justify-center bg-zinc-100 dark:bg-zinc-800 text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* 主体内容 */}
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
          {/* 1. 标准 3D 模型示范动图（或已绑定的内嵌 B站视频） */}
          <div className="relative rounded-2xl overflow-hidden bg-white border border-zinc-200/80 dark:border-zinc-800">
            {savedBvid && showEmbeddedBili ? (
              <div className="aspect-video w-full bg-black">
                <iframe
                  title={`${exercise.name} B站教学`}
                  src={`https://player.bilibili.com/player.html?bvid=${savedBvid}&high_quality=1&danmaku=0&autoplay=0`}
                  className="w-full h-full border-0"
                  allowFullScreen
                />
              </div>
            ) : (
              <div className="relative flex items-center justify-center bg-white h-60 sm:h-64 p-2">
                {!imgFailed ? (
                  <img
                    src={imgSrc}
                    alt={`${exercise.name} 标准动作示范`}
                    onError={() => {
                      const fallback = getExerciseGifCdnFallback(exercise.gifId);
                      if (imgSrc !== fallback) {
                        setImgSrc(fallback);
                      } else {
                        setImgFailed(true);
                      }
                    }}
                    className="max-h-full max-w-full object-contain select-none"
                  />
                ) : (
                  <div className="text-center text-xs text-zinc-500 px-4">
                    动图加载失败，可直接点击下方抖音或 B站观看真人示范
                  </div>
                )}
                <span className="absolute top-2.5 left-2.5 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-zinc-900/75 text-white backdrop-blur-sm">
                  3D 标准动作示范
                </span>
                <span className="absolute bottom-2.5 right-2.5 text-[10px] font-medium px-2 py-0.5 rounded-full bg-rose-500/12 text-rose-600">
                  红区为主要发力肌群
                </span>
              </div>
            )}

            {savedBvid && (
              <div className="flex items-center justify-between px-3 py-1.5 bg-zinc-50 dark:bg-zinc-900 border-t border-zinc-200/70 dark:border-zinc-800 text-[11px]">
                <span className="text-zinc-500 dark:text-zinc-400">已绑定收藏视频 ({savedBvid})</span>
                <button
                  type="button"
                  onClick={() => setShowEmbeddedBili((v) => !v)}
                  className="font-semibold text-emerald-600 dark:text-emerald-400"
                >
                  {showEmbeddedBili ? '切回 3D 模型示范' : '播放绑定视频'}
                </button>
              </div>
            )}
          </div>

          {/* 2. 双平台真人教学直达（抖音 + B站） */}
          <div className="grid grid-cols-2 gap-2.5">
            <a
              href={douyinSearchUrl}
              target="_blank"
              rel="noreferrer"
              className="flex items-center justify-center gap-1.5 py-2.5 px-3 rounded-xl text-xs font-semibold bg-zinc-900 hover:bg-zinc-800 dark:bg-zinc-100 dark:hover:bg-white text-white dark:text-zinc-900 transition-colors"
            >
              <Play className="w-3.5 h-3.5 fill-current" />
              <span>抖音看真人示范</span>
              <ExternalLink className="w-3 h-3 opacity-60" />
            </a>
            <a
              href={biliSearchUrl}
              target="_blank"
              rel="noreferrer"
              className="flex items-center justify-center gap-1.5 py-2.5 px-3 rounded-xl text-xs font-semibold bg-[#FB7299]/14 hover:bg-[#FB7299]/22 text-[#E54D7B] dark:text-[#FF85A8] border border-[#FB7299]/25 transition-colors"
            >
              <Play className="w-3.5 h-3.5 fill-current" />
              <span>B站看详细教学</span>
              <ExternalLink className="w-3 h-3 opacity-70" />
            </a>
          </div>

          {/* 3. 核心发力步骤（精简清晰） */}
          <div className="space-y-2">
            <h3 className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">动作要点</h3>
            <ol className="space-y-2">
              {exercise.steps.map((step, idx) => (
                <li
                  key={idx}
                  className="flex items-start gap-2.5 text-xs text-zinc-700 dark:text-zinc-300 leading-relaxed"
                >
                  <span className="w-5 h-5 rounded-full bg-emerald-500/12 text-emerald-700 dark:text-emerald-400 text-[11px] font-bold flex items-center justify-center shrink-0 mt-0.5 num-tabular">
                    {idx + 1}
                  </span>
                  <span>{step}</span>
                </li>
              ))}
            </ol>
          </div>

          {/* 4. 呼吸与避坑（紧凑合卡） */}
          <div className="rounded-2xl bg-zinc-50 dark:bg-zinc-900/80 border border-zinc-200/70 dark:border-zinc-800 p-3.5 space-y-2.5 text-xs">
            <div className="flex items-start gap-2">
              <Wind className="w-3.5 h-3.5 text-sky-500 shrink-0 mt-0.5" />
              <p className="text-zinc-600 dark:text-zinc-300 leading-relaxed">
                <span className="font-semibold text-zinc-800 dark:text-zinc-100">呼吸：</span>
                {exercise.breathing}
              </p>
            </div>
            <div className="flex items-start gap-2 pt-2 border-t border-zinc-200/60 dark:border-zinc-800">
              <AlertTriangle className="w-3.5 h-3.5 text-amber-500 shrink-0 mt-0.5" />
              <div className="text-zinc-600 dark:text-zinc-300 leading-relaxed space-y-1">
                <span className="font-semibold text-zinc-800 dark:text-zinc-100 block">避坑提醒：</span>
                {exercise.mistakes.map((m, idx) => (
                  <p key={idx}>• {m}</p>
                ))}
              </div>
            </div>
          </div>

          {/* 5. 可选：折叠绑定自定义 B站 BV 号（平时不干扰视线） */}
          <div className="pt-0.5">
            <button
              type="button"
              onClick={() => setShowBindPanel((v) => !v)}
              className="inline-flex items-center gap-1 text-[11px] text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
            >
              <Link2 className="w-3 h-3" />
              <span>{savedBvid ? '更换已绑定的 B站视频' : '绑定自己收藏的 B站教学视频（可选）'}</span>
              {showBindPanel ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            </button>

            {showBindPanel && (
              <div className="mt-2 p-3 rounded-xl bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 space-y-2">
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={bvInput}
                    onChange={(e) => setBvInput(e.target.value)}
                    placeholder="粘贴 B站链接或 BV 号（留空则解绑）"
                    className="flex-1 min-w-0 px-2.5 py-1.5 rounded-lg text-xs bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-700"
                  />
                  <button
                    type="button"
                    onClick={handleSaveBv}
                    className="shrink-0 px-3 py-1.5 rounded-lg text-xs font-semibold bg-emerald-500 text-white"
                  >
                    保存
                  </button>
                </div>
                {bvError && <p className="text-[11px] text-rose-500">{bvError}</p>}
              </div>
            )}
          </div>
        </div>

        {/* 底部简洁操作条 */}
        <div className="flex items-center gap-2 px-4 py-3 border-t border-zinc-100 dark:border-zinc-800/80 bg-zinc-50/70 dark:bg-zinc-900/50">
          {onRemoveFromCurrentDay && (
            <button
              type="button"
              onClick={() => {
                onRemoveFromCurrentDay();
                onClose();
              }}
              aria-label="移出今日计划"
              title="移出今日计划"
              className="w-10 h-10 rounded-xl flex items-center justify-center bg-zinc-200/70 dark:bg-zinc-800 text-zinc-500 hover:text-rose-500 shrink-0"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              onClose();
              onAskAi(
                `我准备做「${exercise.name}」（练${exercise.muscleGroup}），请结合我当前体能告诉我重量怎么选、发力感怎么找，以及如果器械排队有哪些平替？`,
              );
            }}
            className="flex-1 inline-flex items-center justify-center gap-1.5 h-10 rounded-xl text-xs font-semibold bg-zinc-200/70 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-800 dark:text-zinc-100"
          >
            <Sparkles className="w-3.5 h-3.5 text-emerald-500" />
            问 AI 纠错
          </button>
          {onAddToCurrentDay && (
            <button
              type="button"
              onClick={() => {
                onAddToCurrentDay(exercise);
                onClose();
              }}
              className="flex-1 inline-flex items-center justify-center gap-1.5 h-10 rounded-xl text-xs font-semibold bg-emerald-500 hover:bg-emerald-600 text-white active:scale-[0.98]"
            >
              <Plus className="w-4 h-4" />
              加入{currentDayTitle ? `「${currentDayTitle}」` : '今日计划'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
