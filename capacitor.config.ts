import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Capacitor Android 原生套壳配置
 * 关键：启用 CapacitorHttp 原生网络层，在 Android APK 内调用智谱/高德/Gemini API 彻底无 CORS 限制
 */
const config: CapacitorConfig = {
  appId: 'app.lifeos.health',
  appName: 'LifeOS',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
  },
  android: {
    allowMixedContent: true,
  },
  plugins: {
    CapacitorHttp: {
      enabled: true,
    },
    LocalNotifications: {
      iconColor: '#10B981',
    },
    StatusBar: {
      overlaysWebView: false,
    },
  },
};

export default config;
