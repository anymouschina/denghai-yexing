import { defineConfig } from 'vite';

// 产物用普通脚本（iife）而非 ES module：浏览器对 file:// 下的 module 脚本按跨域拦截，
// 双击 dist/index.html 会卡在加载页。去掉 type="module"/crossorigin 后本地直接打开也能玩。
const classicScript = {
  name: 'classic-script',
  apply: 'build',
  enforce: 'post',
  transformIndexHtml(html) {
    return html
      .replace(/<script type="module" crossorigin (src="[^"]+")><\/script>/, '<script defer $1></script>')
      .replace(/<link rel="stylesheet" crossorigin /g, '<link rel="stylesheet" ');
  },
};

export default defineConfig({
  base: './',
  plugins: [classicScript],
  build: {
    assetsDir: 'bundle',
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 2000,
    modulePreload: false,
    rollupOptions: { output: { format: 'iife' } },
  },
});
