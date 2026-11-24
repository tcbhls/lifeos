import { useEffect, useImperativeHandle, useRef, useState, type ReactNode, type Ref } from 'react';
import {
  Camera,
  CheckCircle2,
  Cpu,
  ExternalLink,
  Globe,
  Loader2,
  Send,
  ShieldCheck,
  Trash2,
  X,
  XCircle,
  Zap,
} from 'lucide-react';
import type { NavTab } from '../layout/MobileShell';
import type { useTodaySummary } from '../../hooks/useTodaySummary';
import {
  runLifeOSAgentTurn,
  type AgentChatMessage,
} from '../../lib/aiAgent';
import { EMBEDDED_LOCAL_MODELS } from '../../lib/localLlm';
import { hapticLight } from '../../lib/native';

type SummaryData = ReturnType<typeof useTodaySummary>;

export interface GlobalAiCopilotHandle {
  openDrawer: () => void;
  closeDrawer: () => void;
  isOpen: () => boolean;
  openWithPrompt: (prompt: string, autoSend?: boolean) => void;
}

/** 轻量安全 Markdown 渲染（支持 ### 标题、**加粗** 与 `代码` 芯片，彻底告别聊天气泡里裸露 Markdown 符号） */
function renderFormattedChatText(text: string): ReactNode[] {
  const lines = text.split('\n');
  return lines.map((rawLine, lineIdx) => {
    const headingMatch = rawLine.match(/^\s*#{1,4}\s+(.+)$/);
    const isHeading = Boolean(headingMatch);
    const line = headingMatch ? headingMatch[1].trim() : rawLine;
    const tokens = line.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
    const rendered = tokens.map((tok, i) => {
      if (tok.startsWith('**') && tok.endsWith('**') && tok.length > 4) {
        return (
          <strong key={i} className="font-semibold text-zinc-950 dark:text-white">
            {tok.slice(2, -2)}
          </strong>
        );
      }
      if (tok.startsWith('`') && tok.endsWith('`') && tok.length > 2) {
        return (
          <code
            key={i}
            className="px-1 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 text-[11px] font-mono"
          >
            {tok.slice(1, -1)}
          </code>
        );
      }
      return <span key={i}>{tok}</span>;
    });

    return (
      <span
        key={lineIdx}
        className={isHeading ? 'font-bold text-emerald-700 dark:text-emerald-400' : undefined}
      >
        {rendered}
        {lineIdx < lines.length - 1 && '\n'}
      </span>
    );
  });
}

interface GlobalAiCopilotProps {
  ref?: Ref<GlobalAiCopilotHandle>;
  currentView: NavTab | 'settings';
  summary: SummaryData;
  onNavigate: (target: NavTab | 'settings') => void;
  onNotify: (text: string) => void;
}

const CONTEXT_QUICK_PROMPTS: Record<NavTab | 'settings', string[]> = {
  today: [
    '帮我复盘今天的状态，接下来几小时怎么安排最好？',
    '刚喝了 350ml 电解质水，顺便帮我打卡一次久坐拉伸',
    '昨晚 01:30 睡的今早 07:30 起，帮我记一下睡眠并给恢复建议',
  ],
  diet: [
    '看看麦当劳板烧鸡腿堡怎么样？适合我现在吃吗？',
    '帮我记一下刚吃了白切鸡饭，再推荐杯无糖饮品',
    '把我每日饮食预算调成 55 块，然后帮我看下晚上吃啥',
  ],
  workout: [
    '平板杠铃卧推怎么防止肩膀代偿？给我发力和呼吸要点',
    '帮我往练背日加一个「单臂哑铃划船」4组×10次',
    '今天腰有点酸，深蹲可以用什么动作替代？',
  ],
  routine: [
    '把下午 14:00-16:00 的专注会议加进免打扰，并同步提醒',
    '喝黑咖啡算补水吗？帮我记一杯 250ml 美式',
    '昨晚熬夜了怎么快速恢复精力，今晚几点睡合适？',
  ],
  settings: [
    '根据我的身高体重和目标，帮我看看当前热量目标合理吗？',
    '帮我把目标改成干净增肌，并带我回首页看新目标',
  ],
};

/**
 * 全局游离型高权限 AI 健康管家：
 * - 悬浮在 App 任意板块上方，随时点击唤起
 * - 接受各页面（菜品卡片、健身动作卡片、首页）一键「问 AI」上下文直达
 * - 支持拍照/选图提问 + 自动调用 App 内 12 项全权限操作（记水/记餐/记睡/记重/加动作/改目标/设免打扰/切页）
 */
export function GlobalAiCopilot({
  ref,
  currentView,
  summary,
  onNavigate,
  onNotify,
}: GlobalAiCopilotProps) {
  const [open, setOpen] = useState(false);
  const [autoExecute, setAutoExecute] = useState(true);
  const [webSearchEnabled, setWebSearchEnabled] = useState(true);
  const [input, setInput] = useState('');
  const [attachedFile, setAttachedFile] = useState<File | null>(null);
  const [attachedPreview, setAttachedPreview] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [messages, setMessages] = useState<AgentChatMessage[]>(() => [
    {
      id: 'welcome',
      role: 'assistant',
      text: '嗨！我是你的 LifeOS 健身与养生管家（已接入实时时钟与联网搜索）。随时问我天气、营养成分、中医食疗养生、动作要点，或者拍餐盘发给我，也可以直接让我帮你记水、记餐、加动作、设免打扰！',
      timestamp: 0,
    },
  ]);

  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const sendMessage = async (textOverride?: string) => {
    const text = (textOverride ?? input).trim();
    const fileToSend = textOverride !== undefined ? null : attachedFile;
    const previewToSend = textOverride !== undefined ? undefined : attachedPreview ?? undefined;

    if ((!text && !fileToSend) || sending) return;

    const userMsg: AgentChatMessage = {
      id: `u-${Date.now()}`,
      role: 'user',
      text: text || '（发了一张图片请你帮我看看）',
      imagePreviewUrl: previewToSend,
      timestamp: Date.now(),
    };

    const nextHistory = [...messages, userMsg];
    setMessages(nextHistory);
    setInput('');
    setAttachedFile(null);
    setAttachedPreview(null);
    setSending(true);
    void hapticLight();

    try {
      const res = await runLifeOSAgentTurn({
        userText: text,
        imageFile: fileToSend,
        history: messages,
        autoExecuteActions: autoExecute,
        webSearchEnabled,
        ctx: {
          currentView,
          summary,
          onNavigate,
          onNotify,
        },
      });

      const assistantMsg: AgentChatMessage = {
        id: `a-${Date.now()}`,
        role: 'assistant',
        text: res.replyText,
        executedActions: res.executedActions,
        webSources: res.webSources,
        usedModel: res.usedModel,
        latencyMs: res.latencyMs,
        timestamp: Date.now(),
      };
      setMessages((prev) => [...prev, assistantMsg]);
    } catch (err: unknown) {
      const errText = err instanceof Error ? err.message : String(err);
      setMessages((prev) => [
        ...prev,
        {
          id: `e-${Date.now()}`,
          role: 'assistant',
          text: `调用 AI 遇到点小问题：${errText}\n（你可以点右上角设置页检查免费 API Key 或稍后重试）`,
          timestamp: Date.now(),
        },
      ]);
    } finally {
      setSending(false);
    }
  };

  // 供顶部全局「AI」按钮、各板块直达入口及 Android 原生返回键控制抽屉开关
  useImperativeHandle(ref, () => ({
    openDrawer: () => {
      setOpen(true);
    },
    closeDrawer: () => {
      setOpen(false);
    },
    isOpen: () => open,
    openWithPrompt: (prompt: string, autoSend = true) => {
      setOpen(true);
      if (autoSend) {
        void sendMessage(prompt);
      } else {
        setInput(prompt);
      }
    },
  }));

  // 自动滚到底部最新消息
  useEffect(() => {
    if (open && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, sending, open]);

  const handleSelectImage = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setAttachedFile(file);
    const reader = new FileReader();
    reader.onload = () => setAttachedPreview(String(reader.result));
    reader.readAsDataURL(file);
  };

  const quickPrompts = CONTEXT_QUICK_PROMPTS[currentView] ?? CONTEXT_QUICK_PROMPTS.today;
  const isEmbeddedLocal = summary.settings.aiProvider === 'local_embedded';
  const matchedEmbeddedSpec = isEmbeddedLocal
    ? EMBEDDED_LOCAL_MODELS.find((m) => m.fileName === summary.settings.aiModel)
    : undefined;
  const hasActiveLlm =
    summary.settings.aiProvider === 'local_embedded' || Boolean(summary.settings.aiApiKey.trim());
  const displayModelLabel = isEmbeddedLocal
    ? `手机端侧 · ${matchedEmbeddedSpec?.name ?? summary.settings.aiModel}`
    : hasActiveLlm
      ? summary.settings.aiModel
      : '离线知识库（去设置可启端侧/云端AI）';

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-center items-end bg-black/55 backdrop-blur-xs">
          <div className="w-full max-w-[440px] h-[86dvh] flex flex-col rounded-t-3xl bg-zinc-50 dark:bg-[#0e1014] border-t border-x border-zinc-200/90 dark:border-zinc-800 shadow-2xl overflow-hidden animate-page-in">
            {/* 抽屉顶部栏 */}
            <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-zinc-200/80 dark:border-zinc-800/80 bg-white/90 dark:bg-[#12151b]/90">
              <div className="flex items-center gap-2 min-w-0">
                <img
                  src="./logo.png"
                  alt="LifeOS AI"
                  className="w-8 h-8 rounded-[10px] object-cover shadow-sm shrink-0"
                />
                <div className="min-w-0">
                  <div className="flex items-center gap-1">
                    <h2 className="text-sm font-bold text-zinc-900 dark:text-zinc-100 truncate">
                      AI 管家
                    </h2>
                    <span className="shrink-0 inline-flex items-center gap-0.5 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-emerald-500/12 text-emerald-600 dark:text-emerald-400">
                      <ShieldCheck className="w-2.5 h-2.5" />
                      全权限
                    </span>
                  </div>
                  <p className="text-[10px] text-zinc-500 dark:text-zinc-400 truncate">
                    {displayModelLabel}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-1 shrink-0">
                {isEmbeddedLocal ? (
                  <button
                    type="button"
                    onClick={() => {
                      void hapticLight();
                      setOpen(false);
                      onNavigate('settings');
                    }}
                    title="当前运行 App 内置离线 AI（点击去设置切换模型或云端联网）"
                    className="inline-flex items-center gap-0.5 px-2 py-1 rounded-lg text-[10px] font-semibold border bg-emerald-500/12 border-emerald-500/30 text-emerald-700 dark:text-emerald-400 transition-colors"
                  >
                    <Cpu className="w-3 h-3" />
                    本机离线
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      void hapticLight();
                      setWebSearchEnabled((v) => !v);
                    }}
                    title="开启或关闭实时联网搜索"
                    className={`inline-flex items-center gap-0.5 px-2 py-1 rounded-lg text-[10px] font-semibold border transition-colors ${
                      webSearchEnabled
                        ? 'bg-sky-500/12 border-sky-500/30 text-sky-700 dark:text-sky-400'
                        : 'bg-zinc-100 dark:bg-zinc-800 border-zinc-200 dark:border-zinc-700 text-zinc-500'
                    }`}
                  >
                    <Globe className="w-3 h-3" />
                    {webSearchEnabled ? '联网' : '离线'}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    void hapticLight();
                    setAutoExecute((v) => !v);
                  }}
                  title="切换 AI 是否自动执行 App 内操作"
                  className={`px-2 py-1 rounded-lg text-[10px] font-semibold border transition-colors ${
                    autoExecute
                      ? 'bg-emerald-500/12 border-emerald-500/30 text-emerald-700 dark:text-emerald-400'
                      : 'bg-zinc-100 dark:bg-zinc-800 border-zinc-200 dark:border-zinc-700 text-zinc-500'
                  }`}
                >
                  {autoExecute ? '执行:开' : '仅问答'}
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setMessages((prev) => prev.slice(0, 1))
                  }
                  title="清空聊天记录"
                  className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  aria-label="收起 AI 管家"
                  className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* 对话消息流 */}
            <div ref={scrollRef} className="flex-1 overflow-y-auto px-3.5 py-3 space-y-3">
              {messages.map((msg) => (
                <div
                  key={msg.id}
                  className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}
                >
                  <div
                    className={`max-w-[88%] rounded-2xl px-3.5 py-2.5 text-xs leading-relaxed whitespace-pre-wrap ${
                      msg.role === 'user'
                        ? 'bg-emerald-500 text-white rounded-br-md'
                        : 'bg-white dark:bg-zinc-900 text-zinc-800 dark:text-zinc-100 border border-zinc-200/80 dark:border-zinc-800 rounded-bl-md'
                    }`}
                  >
                    {msg.imagePreviewUrl && (
                      <img
                        src={msg.imagePreviewUrl}
                        alt="用户上传图片"
                        className="max-h-44 rounded-xl mb-2 object-cover border border-white/20"
                      />
                    )}
                    <div>
                      {msg.role === 'assistant' ? renderFormattedChatText(msg.text) : msg.text}
                    </div>

                    {/* 联网检索来源引用（仅当本轮触发实时网搜时显示） */}
                    {msg.webSources && msg.webSources.length > 0 && (
                      <div className="mt-2 pt-2 border-t border-zinc-100 dark:border-zinc-800 space-y-1">
                        <div className="text-[10px] font-semibold text-sky-600 dark:text-sky-400 flex items-center gap-1">
                          <Globe className="w-3 h-3" />
                          已实时联网检索 ({msg.webSources.length} 条参考)
                        </div>
                        <div className="flex flex-wrap gap-1">
                          {msg.webSources.slice(0, 3).map((src, idx) => (
                            <a
                              key={`${src.link}-${idx}`}
                              href={src.link}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-0.5 max-w-[180px] px-2 py-0.5 rounded-md bg-zinc-100 dark:bg-zinc-800 text-[10px] text-zinc-600 dark:text-zinc-300 hover:text-sky-600 truncate"
                            >
                              <span className="truncate">{src.title}</span>
                              <ExternalLink className="w-2.5 h-2.5 shrink-0 opacity-60" />
                            </a>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* AI 自动执行的 App 权限操作反馈芯片 */}
                    {msg.executedActions && msg.executedActions.length > 0 && (
                      <div className="mt-2.5 pt-2 border-t border-zinc-100 dark:border-zinc-800 space-y-1">
                        <div className="text-[10px] font-semibold text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                          <Zap className="w-3 h-3 fill-current" />
                          已直接为你操作 App：
                        </div>
                        {msg.executedActions.map((act, idx) => (
                          <div
                            key={`${act.type}-${idx}`}
                            className={`flex items-center gap-1.5 px-2 py-1 rounded-lg text-[11px] font-medium ${
                              act.ok
                                ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                                : 'bg-rose-500/10 text-rose-600 dark:text-rose-400'
                            }`}
                          >
                            {act.ok ? (
                              <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                            ) : (
                              <XCircle className="w-3.5 h-3.5 shrink-0" />
                            )}
                            <span>{act.summary}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {msg.usedModel && (
                    <span className="text-[10px] text-zinc-400 mt-1 px-1 num-tabular">
                      {msg.usedModel} · {msg.latencyMs}ms
                    </span>
                  )}
                </div>
              ))}

              {sending && (
                <div className="flex items-start">
                  <div className="inline-flex items-center gap-2 px-3.5 py-2.5 rounded-2xl rounded-bl-md bg-white dark:bg-zinc-900 border border-zinc-200/80 dark:border-zinc-800 text-xs text-zinc-500 dark:text-zinc-400">
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-emerald-500" />
                    正在读取全板块数据并思考执行...
                  </div>
                </div>
              )}
            </div>

            {/* 当前板块专属快捷提问芯片 */}
            <div className="px-3.5 py-2 border-t border-zinc-200/70 dark:border-zinc-800/70 bg-zinc-50/90 dark:bg-[#0e1014]">
              <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar">
                {quickPrompts.map((qp) => (
                  <button
                    key={qp}
                    type="button"
                    disabled={sending}
                    onClick={() => void sendMessage(qp)}
                    className="shrink-0 px-2.5 py-1.5 rounded-xl text-[11px] font-medium bg-white dark:bg-zinc-900 border border-zinc-200/90 dark:border-zinc-800 text-zinc-700 dark:text-zinc-300 hover:border-emerald-500/50 transition-colors"
                  >
                    {qp}
                  </button>
                ))}
              </div>
            </div>

            {/* 图片预览条（若用户刚拍/选了餐盘或动作图） */}
            {attachedPreview && (
              <div className="px-3.5 pt-2 flex items-center gap-2 bg-white dark:bg-[#12151b]">
                <img
                  src={attachedPreview}
                  alt="待发送图片"
                  className="w-12 h-12 rounded-lg object-cover border border-emerald-500/40"
                />
                <span className="text-[11px] text-zinc-500 flex-1 truncate">
                  已附加图片，将自动调用免费视觉模型看图解答
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setAttachedFile(null);
                    setAttachedPreview(null);
                  }}
                  className="p-1 text-zinc-400 hover:text-rose-500"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            )}

            {/* 底部输入栏 */}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void sendMessage();
              }}
              className="flex items-center gap-2 px-3 py-2.5 bg-white dark:bg-[#12151b] border-t border-zinc-200/80 dark:border-zinc-800"
              style={{ paddingBottom: 'calc(var(--safe-bottom) + 10px)' }}
            >
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                title="拍饭菜/动作/配料表问 AI"
                className="flex items-center justify-center w-9 h-9 rounded-xl bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 hover:text-emerald-500 shrink-0"
              >
                <Camera className="w-4 h-4" />
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={handleSelectImage}
                className="hidden"
              />

              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="问菜品、问动作，或直接让我帮你记水/记餐/改目标..."
                className="flex-1 min-w-0 px-3 py-2 rounded-xl text-xs bg-zinc-100 dark:bg-zinc-800/90 text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 focus:outline-none focus:ring-1 focus:ring-emerald-500"
              />

              <button
                type="submit"
                disabled={sending || (!input.trim() && !attachedFile)}
                className="flex items-center justify-center w-9 h-9 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-white shrink-0 disabled:opacity-45 active:scale-95 transition-all"
              >
                <Send className="w-4 h-4" />
              </button>
            </form>
          </div>
        </div>
  );
}
