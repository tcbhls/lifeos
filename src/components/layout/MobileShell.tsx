import type { ReactNode } from 'react';
import {
  Dumbbell,
  Flame,
  Moon,
  Settings,
  Sparkles,
  Sun,
  Utensils,
  Zap,
} from 'lucide-react';
import { hapticLight } from '../../lib/native';
import type { ThemeMode } from '../../types/models';

export type NavTab = 'today' | 'diet' | 'workout' | 'routine';

interface MobileShellProps {
  activeTab: NavTab;
  showSettings: boolean;
  onSelectTab: (tab: NavTab) => void;
  onToggleSettings: (open: boolean) => void;
  theme: ThemeMode;
  onCycleTheme: () => void;
  onOpenAi: () => void;
  campusLabel: string;
  xpToast: string | null;
  children: ReactNode;
}

const NAV_ITEMS: Array<{ id: NavTab; label: string; icon: typeof Flame }> = [
  { id: 'today', label: '今日', icon: Flame },
  { id: 'diet', label: '饮食', icon: Utensils },
  { id: 'workout', label: '训练', icon: Dumbbell },
  { id: 'routine', label: '作息', icon: Moon },
];

const TAB_TITLES: Record<NavTab, string> = {
  today: '今日概览',
  diet: '健康饮食',
  workout: '健身训练',
  routine: '喝水与作息',
};

/**
 * 极简移动 App 外壳：克制清爽的顶栏（方案 B 矿石绿生命环 Logo）+ 悬浮底栏
 */
export function MobileShell({
  activeTab,
  showSettings,
  onSelectTab,
  onToggleSettings,
  theme,
  onCycleTheme,
  onOpenAi,
  xpToast,
  children,
}: MobileShellProps) {
  return (
    <div className="min-h-dvh w-full bg-zinc-100 dark:bg-[#050608] flex justify-center">
      <div className="relative flex flex-col w-full max-w-[440px] min-h-dvh bg-[#f7f8f7] dark:bg-[#0b0c0e] sm:border-x sm:border-zinc-200/80 dark:sm:border-zinc-800/60 sm:shadow-2xl">
        {/* 顶部极简导航栏 */}
        <header
          className="sticky top-0 z-30 flex items-center justify-between px-4 min-h-14 bg-[#f7f8f7]/88 dark:bg-[#0b0c0e]/88 backdrop-blur-xl border-b border-zinc-200/60 dark:border-zinc-800/60"
          style={{ paddingTop: 'calc(var(--safe-top) + 6px)', paddingBottom: '6px' }}
        >
          <div className="flex items-center gap-2.5 min-w-0">
            <img
              src="./logo.png"
              alt="LifeOS"
              className="w-8 h-8 rounded-[10px] object-cover shadow-sm shrink-0"
            />
            <div className="leading-none min-w-0">
              <span className="text-[15px] font-bold tracking-tight text-zinc-900 dark:text-zinc-100 block">
                LifeOS
              </span>
              <span className="text-[11px] text-zinc-500 dark:text-zinc-400 mt-1 block truncate">
                {showSettings ? '偏好与备份设置' : TAB_TITLES[activeTab]}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              data-tour="global-ai-btn"
              onClick={() => {
                void hapticLight();
                onOpenAi();
              }}
              aria-label="打开全权限 AI 管家"
              className="inline-flex items-center gap-1 px-3 h-8 rounded-full bg-[#1a6e5e] hover:bg-[#155a4d] text-white text-xs font-semibold shadow-sm active:scale-95 transition-all"
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>AI</span>
            </button>
            <button
              type="button"
              onClick={() => {
                void hapticLight();
                onCycleTheme();
              }}
              title={`切换主题（当前：${theme === 'dark' ? '暗色' : theme === 'light' ? '浅色' : '跟随系统'}）`}
              className="flex items-center justify-center w-8 h-8 rounded-full text-zinc-500 hover:text-zinc-900 hover:bg-zinc-200/60 dark:text-zinc-400 dark:hover:text-zinc-100 dark:hover:bg-zinc-800/80 active:scale-95 transition-all"
            >
              {theme === 'light' ? <Sun className="w-[17px] h-[17px]" /> : <Moon className="w-[17px] h-[17px]" />}
            </button>
            <button
              type="button"
              onClick={() => {
                void hapticLight();
                onToggleSettings(!showSettings);
              }}
              aria-label="打开设置"
              className={`flex items-center justify-center w-8 h-8 rounded-full active:scale-95 transition-all ${
                showSettings
                  ? 'bg-[#1a6e5e] text-white'
                  : 'text-zinc-500 hover:text-zinc-900 hover:bg-zinc-200/60 dark:text-zinc-400 dark:hover:text-zinc-100 dark:hover:bg-zinc-800/80'
              }`}
            >
              <Settings className="w-[17px] h-[17px]" />
            </button>
          </div>
        </header>

        {/* 操作反馈轻胶囊 */}
        {xpToast && (
          <div className="pointer-events-none fixed top-16 left-1/2 -translate-x-1/2 z-50 max-w-[90vw]">
            <div className="animate-xp-toast flex items-center gap-1.5 px-3.5 py-2 rounded-full bg-zinc-900/95 dark:bg-[#1a6e5e] text-white text-xs font-semibold shadow-xl border border-white/10">
              <Zap className="w-3.5 h-3.5 fill-current shrink-0 text-emerald-300 dark:text-white" />
              <span className="truncate">{xpToast}</span>
            </div>
          </div>
        )}

        {/* 主内容区 */}
        <main
          key={showSettings ? 'settings' : activeTab}
          className="animate-page-in flex-1 overflow-y-auto px-4 pt-4 pb-28"
        >
          {children}
        </main>

        {/* 底部悬浮 4 栏导航 */}
        <nav
          className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-[440px] z-30 px-3.5 pt-2 pointer-events-none"
          style={{ paddingBottom: 'calc(var(--safe-bottom) + 10px)' }}
        >
          <div className="pointer-events-auto grid grid-cols-4 p-1.5 rounded-2xl bg-white/94 dark:bg-[#13151a]/94 backdrop-blur-xl border border-zinc-200/80 dark:border-zinc-800/80 shadow-lg shadow-black/6 dark:shadow-black/40">
            {NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              const isActive = !showSettings && activeTab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    void hapticLight();
                    onToggleSettings(false);
                    onSelectTab(item.id);
                  }}
                  className={`flex flex-col items-center justify-center gap-0.5 py-2 rounded-xl active:scale-95 transition-all ${
                    isActive
                      ? 'bg-emerald-500/12 text-[#166556] dark:text-emerald-400'
                      : 'text-zinc-400 hover:text-zinc-700 dark:text-zinc-500 dark:hover:text-zinc-200'
                  }`}
                >
                  <Icon className="w-[19px] h-[19px]" strokeWidth={isActive ? 2.2 : 1.75} />
                  <span className="text-[11px] font-semibold leading-none mt-0.5">{item.label}</span>
                </button>
              );
            })}
          </div>
        </nav>
      </div>
    </div>
  );
}
