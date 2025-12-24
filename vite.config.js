import { defineConfig } from 'vite';
import { resolve } from 'path';
import vue from '@vitejs/plugin-vue';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [vue()],
  
  // GitHub Pages 用のベースパス設定
  // リポジトリ名に合わせて設定
  base: '/subtitle-output-system/',
  
  // Multi-page application の設定
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        operator: resolve(__dirname, 'operator.html'),
        display: resolve(__dirname, 'display.html'),
        login: resolve(__dirname, 'login.html'),
        questionForm: resolve(__dirname, 'question-form.html'),
        glForm: resolve(__dirname, 'gl-form.html'),
        participantMailView: resolve(__dirname, 'participant-mail-view.html'),
        notFound: resolve(__dirname, '404.html'),
      },
    },
    outDir: 'dist',
  },
  
  // 開発サーバーの設定
  server: {
    port: 3000,
    open: true,
  },
  
  // パスの解決設定
  resolve: {
    alias: {
      '@': resolve(__dirname, './'),
    },
  },
});

