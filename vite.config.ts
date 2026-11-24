import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: true,
    port: 5173,
    // 本地开发代理：避免浏览器直接调用国内大模型 API 时被 CORS 拦截
    // 打包为 Capacitor Android APK 后将直接走原生请求，无 CORS 限制
    proxy: {
      '/proxy/zhipu': {
        target: 'https://open.bigmodel.cn',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/proxy\/zhipu/, ''),
      },
      '/proxy/siliconflow': {
        target: 'https://api.siliconflow.cn',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/proxy\/siliconflow/, ''),
      },
    },
  },
});
