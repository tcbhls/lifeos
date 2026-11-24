import { useCallback, useEffect, useRef, useState } from 'react';
import {
  GlobalAiCopilot,
  type GlobalAiCopilotHandle,
} from './components/ai/GlobalAiCopilot';
import { MobileShell, type NavTab } from './components/layout/MobileShell';
import { OnboardingTour } from './components/onboarding/OnboardingTour';
import { db, ensureDatabaseSeeded } from './db/database';
import { useTheme } from './hooks/useTheme';
import { useTodaySummary } from './hooks/useTodaySummary';
import { hideNativeLaunchSplash } from './lib/localLlm';
import { DietPage } from './pages/DietPage';
import { RoutinePage } from './pages/RoutinePage';
import { SettingsPage } from './pages/SettingsPage';
import { TodayPage } from './pages/TodayPage';
import { WorkoutPage } from './pages/WorkoutPage';
import type { ThemeMode } from './types/models';

export default function App() {
  const [ready, setReady] = useState(false);
  const [activeTab, setActiveTab] = useState<NavTab>('today');
  const [showSettings, setShowSettings] = useState(false);
  const [replayTourRequested, setReplayTourRequested] = useState(false);
  const [xpToast, setXpToast] = useState<string | null>(null);
  const copilotRef = useRef<GlobalAiCopilotHandle>(null);
  const toastTimerRef = useRef<number | null>(null);

  useEffect(() => {
    ensureDatabaseSeeded().finally(() => setReady(true));
  }, []);

  const summary = useTodaySummary();
  useTheme(summary.settings.theme);

  // 首屏数据与主题全部就绪后，等待 1 帧绘制完成再平滑淡出 Android 原生启动画面，彻底消除闪黑屏
  const splashHiddenRef = useRef(false);
  useEffect(() => {
    if (!ready || !summary.settingsLoaded || splashHiddenRef.current) return;
    splashHiddenRef.current = true;
    const rafId = window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        void hideNativeLaunchSplash();
      });
    });
    return () => window.cancelAnimationFrame(rafId);
  }, [ready, summary.settingsLoaded]);

  // 接管 Android 原生返回手势：优先逐层关闭弹窗/AI 管家/设置页/返回今日首页，避免误触直接闪退
  useEffect(() => {
    const win = window as Window & {
      __lifeosHandleBack?: () => boolean;
      __lifeosCloseTopModal?: () => boolean;
    };
    win.__lifeosHandleBack = () => {
      if (copilotRef.current?.isOpen()) {
        copilotRef.current.closeDrawer();
        return true;
      }
      if (win.__lifeosCloseTopModal?.()) {
        return true;
      }
      if (showSettings) {
        setShowSettings(false);
        return true;
      }
      if (activeTab !== 'today') {
        setActiveTab('today');
        return true;
      }
      return false;
    };
    return () => {
      delete win.__lifeosHandleBack;
    };
  }, [showSettings, activeTab]);

  const notifyXp = useCallback((text: string) => {
    setXpToast(null);
    window.requestAnimationFrame(() => {
      setXpToast(text);
    });
    if (toastTimerRef.current) {
      window.clearTimeout(toastTimerRef.current);
    }
    toastTimerRef.current = window.setTimeout(() => {
      setXpToast(null);
    }, 2200);
  }, []);

  /** 从任意页面/菜品/动作卡片一键呼出全局高权限 AI 管家并提问 */
  const askAi = useCallback((prompt: string, autoSend = true) => {
    copilotRef.current?.openWithPrompt(prompt, autoSend);
  }, []);

  /** 供 AI 管家跨板块游离跳转 */
  const handleAgentNavigate = useCallback((target: NavTab | 'settings') => {
    if (target === 'settings') {
      setShowSettings(true);
    } else {
      setShowSettings(false);
      setActiveTab(target);
    }
  }, []);

  /** 完成或跳过新手手把手教程并持久化 */
  const handleFinishTour = useCallback(
    async (bonusMsg?: string) => {
      setReplayTourRequested(false);
      setShowSettings(false);
      const cur = await db.settings.get('app_settings');
      if (cur) {
        await db.settings.put({
          ...cur,
          onboardingCompleted: true,
          updatedAt: Date.now(),
        });
      }
      if (bonusMsg) notifyXp(bonusMsg);
    },
    [notifyXp],
  );

  /** 在设置页手动重进新手手把手教程 */
  const handleReplayTour = useCallback(() => {
    setShowSettings(false);
    setActiveTab('today');
    setReplayTourRequested(true);
  }, []);

  const handleCycleTheme = async () => {
    const order: ThemeMode[] = ['dark', 'light', 'system'];
    const idx = order.indexOf(summary.settings.theme);
    const nextTheme = order[(idx + 1) % order.length];
    await db.settings.put({
      ...summary.settings,
      theme: nextTheme,
      updatedAt: Date.now(),
    });
    notifyXp(
      nextTheme === 'dark'
        ? '已切换：深空暗色主题'
        : nextTheme === 'light'
          ? '已切换：极简浅色主题'
          : '已切换：跟随系统主题',
    );
  };

  if (!ready) {
    return (
      <div className="min-h-dvh flex flex-col items-center justify-center gap-3 bg-[#f7f8f7] dark:bg-[#0b0c0e] text-zinc-500 dark:text-zinc-400 text-xs">
        <img
          src="./logo.png"
          alt="LifeOS"
          className="w-14 h-14 rounded-2xl shadow-md object-cover"
        />
        <span>正在启动 LifeOS...</span>
      </div>
    );
  }

  const currentView: NavTab | 'settings' = showSettings ? 'settings' : activeTab;
  // 首次进 App（且 IndexedDB settings 加载完毕后确认未完成）自动启动手把手教程；也可在设置页随时重开
  const showOnboarding =
    replayTourRequested || (summary.settingsLoaded && !summary.settings.onboardingCompleted);

  return (
    <>
      <MobileShell
        activeTab={activeTab}
        showSettings={showSettings}
        onSelectTab={setActiveTab}
        onToggleSettings={setShowSettings}
        theme={summary.settings.theme}
        onCycleTheme={handleCycleTheme}
        onOpenAi={() => copilotRef.current?.openDrawer()}
        campusLabel={summary.profile.campus}
        xpToast={xpToast}
      >
        {showSettings ? (
          <SettingsPage
            onBack={() => setShowSettings(false)}
            onReplayTour={handleReplayTour}
            onNotify={notifyXp}
          />
        ) : activeTab === 'today' ? (
          <TodayPage
            summary={summary}
            onNavigate={setActiveTab}
            onOpenSettings={() => setShowSettings(true)}
            onAskAi={askAi}
            onNotifyXp={notifyXp}
          />
        ) : activeTab === 'diet' ? (
          <DietPage
            summary={summary}
            onOpenSettings={() => setShowSettings(true)}
            onAskAi={askAi}
            onNotify={notifyXp}
          />
        ) : activeTab === 'workout' ? (
          <WorkoutPage summary={summary} onAskAi={askAi} onNotify={notifyXp} />
        ) : (
          <RoutinePage summary={summary} onNotifyXp={notifyXp} />
        )}
      </MobileShell>

      {/* 全站游离高权限 AI 健康管家 */}
      <GlobalAiCopilot
        ref={copilotRef}
        currentView={currentView}
        summary={summary}
        onNavigate={handleAgentNavigate}
        onNotify={notifyXp}
      />

      {/* 首次进入自动触发 / 设置页随时重放：7步跨板块聚光灯手把手教程 */}
      {showOnboarding && (
        <OnboardingTour
          profile={summary.profile}
          onNavigateTab={(tab) => {
            setShowSettings(false);
            setActiveTab(tab);
          }}
          onFinish={handleFinishTour}
        />
      )}
    </>
  );
}
