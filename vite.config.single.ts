import { defineConfig, type Plugin } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * 「单文件版」构建：把 JS / CSS / 图标全部内联进一个 index.html。
 *
 * 产物可以直接双击打开（file://）、发微信、拷 U 盘 —— 不需要 Node、不需要服务器。
 * 所以这里不启用 PWA：Service Worker 在 file:// 下本来就无法注册。
 */
function inlineAssets(): Plugin {
  return {
    name: 'guandan-inline-assets',
    transformIndexHtml(html: string) {
      const svg = readFileSync(resolve(__dirname, 'public/favicon.svg'), 'utf8');
      const dataUri = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
      return html
        .replace(/<link rel="icon"[^>]*>/, `<link rel="icon" href="${dataUri}" />`)
        .replace(/\s*<link rel="apple-touch-icon"[^>]*>/, '');
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [viteSingleFile({ removeViteModuleLoader: true }), inlineAssets()],
  build: {
    target: 'es2022',
    outDir: 'release',
    emptyOutDir: true,
    assetsInlineLimit: 100_000_000,
    cssCodeSplit: false,
    sourcemap: false,
    rollupOptions: { output: { inlineDynamicImports: true } },
  },
});
