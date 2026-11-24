import { defineConfig } from 'vite';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

// 新模式用到的全部汉字（扫描 src/guard 下的源码与数据），进新模式前按需加载书法字体分片
const guardGlyphs = {
  name: 'guard-glyphs',
  resolveId(id) { return id === 'virtual:guard-glyphs' ? '\0guard-glyphs' : null; },
  load(id) {
    if (id !== '\0guard-glyphs') return null;
    const set = new Set();
    const walk = (d) => {
      for (const f of readdirSync(d)) {
        const p = join(d, f);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.(js|json)$/.test(f)) {
          this.addWatchFile(p);
          for (const ch of readFileSync(p, 'utf8')) if (/[\u3000-\u303f\u4e00-\u9fff\uff00-\uffef·—]/.test(ch)) set.add(ch);
        }
      }
    };
    walk(join(import.meta.dirname, 'src/guard'));
    return `export default ${JSON.stringify([...set].join(''))};`;
  },
};

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
  plugins: [classicScript, guardGlyphs],
  build: {
    assetsDir: 'bundle',
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 2000,
    modulePreload: false,
    rollupOptions: { output: { format: 'iife' } },
  },
});
