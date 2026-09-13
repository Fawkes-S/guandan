import { defineConfig } from 'vitest/config';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  base: './',
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: '掼蛋 · 水墨',
        short_name: '掼蛋',
        description: '江苏规则单机掼蛋 · 水墨极简 · 一名真人 + 三名 AI，离线可玩',
        lang: 'zh-CN',
        theme_color: '#f4f1e8',
        background_color: '#f4f1e8',
        display: 'standalone',
        orientation: 'any',
        start_url: './',
        scope: './',
        categories: ['games', 'entertainment'],
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        navigateFallback: 'index.html',
      },
    }),
  ],
  build: {
    target: 'es2022',
    outDir: 'dist',
    assetsDir: 'assets',
    sourcemap: false,
  },
  server: {
    port: 5273,
    host: '127.0.0.1',
    open: false,
    // 别去监视截图 / 浏览器临时目录，否则 HMR 会被反复触发甚至把 dev server 拖挂
    watch: {
      ignored: ['**/.chrome-*/**', '**/.shots/**', '**/.npm-cache/**', '**/dist/**'],
    },
  },
  test: {
    environment: 'node',
    include: ['src/test/**/*.test.ts'],
  },
});
