# LifeOS 架构说明 (Local-First Architecture)

## 1. 技术栈
- **前端**：React 19 + TypeScript + Vite 8 + Tailwind CSS v4 + Lucide Icons
- **本地存储**：Dexie.js (IndexedDB)，7 张本地表（`userProfile` / `foodItems` / `mealLogs` / `workoutPlans` / `workoutLogs` / `habitLogs` / `settings`）
- **原生壳层**：Capacitor 8 Android (`app.lifeos.health`)，含 Haptics、LocalNotifications、StatusBar 与自研 `LifeOsLocalLlmPlugin`
- **端侧推理**：预编译 Android ARM64 `llama.cpp` JNI (`dev.ffmpegkit-maintained:llama-android:0.1.1`) + 离线养生/健身 RAG 知识库

## 2. 启动无闪烁架构
- `index.html` 同步脚本在首帧绘制前恢复 `localStorage` 缓存主题与底色；
- Android `MainActivity` 挂载像素对齐的原生启动过渡层，待前端数据库初始化并绘制首帧后回调 `hideLaunchSplash()` 以 220ms 平滑淡出；
- 接管 Android 系统返回手势（`OnBackPressedCallback` → `window.__lifeosHandleBack()`），逐层关闭 AI 抽屉 / 弹窗 / 设置页 / 返回首页，根目录二次返回再退出。

## 3. 隐私边界
- 公开构建绝不内置开发者个人密钥（`.env.local` 留空且被 `.gitignore` 忽略）；
- 导出 JSON 备份默认脱敏剔除 `aiApiKey` / `amapWebKey`；
- 定位权限（`ACCESS_COARSE_LOCATION`）仅在用户主动点击「定位我」时按需请求，不在后台静默运行。
