import { useEffect } from 'react';
import { syncNativeStatusBar } from '../lib/native';
import type { ThemeMode } from '../types/models';

const THEME_CACHE_KEY = 'lifeos_theme_cache';

/** 同步读取上次缓存的主题，避免 IndexedDB 加载前首帧主题闪烁 */
export function getCachedTheme(): ThemeMode {
  try {
    const raw = localStorage.getItem(THEME_CACHE_KEY);
    if (raw === 'dark' || raw === 'light' || raw === 'system') {
      return raw;
    }
  } catch {
    // 忽略隐私模式读取失败
  }
  return 'dark';
}

/**
 * 暗色 / 浅色 / 跟随系统三态自适应主题 Hook
 * 同步更新 html.dark、背景底色、localStorage 缓存以及 Android 原生状态栏风格
 */
export function useTheme(theme: ThemeMode = 'dark') {
  useEffect(() => {
    try {
      localStorage.setItem(THEME_CACHE_KEY, theme);
    } catch {
      // 忽略写入异常
    }

    const root = document.documentElement;
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');

    const apply = () => {
      const isDark = theme === 'dark' || (theme === 'system' && mediaQuery.matches);
      root.classList.toggle('dark', isDark);
      root.style.backgroundColor = isDark ? '#0b0c0e' : '#f7f8f7';
      void syncNativeStatusBar(isDark);
    };

    apply();

    if (theme === 'system') {
      mediaQuery.addEventListener('change', apply);
      return () => mediaQuery.removeEventListener('change', apply);
    }
    return undefined;
  }, [theme]);
}
