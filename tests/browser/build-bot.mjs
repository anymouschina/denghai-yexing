// 把代打机器人打成单个 IIFE 字符串（window.GuardBot.attach），供 CDP 注入
import { build } from 'vite';
import { fileURLToPath } from 'node:url';
export async function buildBot() {
  const out = await build({
    configFile: false, logLevel: 'silent',
    build: { write: false, minify: false, lib: { entry: fileURLToPath(new URL('./bot-entry.mjs', import.meta.url)), formats: ['iife'], name: 'GuardBot' } },
  });
  const r = Array.isArray(out) ? out[0] : out;
  return r.output[0].code;
}
