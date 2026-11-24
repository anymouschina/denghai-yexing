// 通过 TapCanvas 平台（小T 同一套 /public/draw 生图接口，按积分计费）生成游戏图标：
// 提交 → 轮询 /public/tasks/result → 下载原图到 .src/。抠图/缩放在 key-icon.py 里做。
// 用法：node scripts/gen-image.mjs --profile production --model gpt-image-2.6 --out .src/x.png --prompt "..."
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, v, i, a) => (v.startsWith('--') ? [...acc, [v.slice(2), a[i + 1]]] : acc), []));
for (const k of ['profile', 'model', 'out', 'prompt']) if (!args[k]) throw new Error(`--${k} 必填`);

const cfg = JSON.parse(await readFile(path.join(homedir(), '.tapcanvas/config.json'), 'utf8')).profiles[args.profile];
if (!cfg || !cfg.apiKey || !cfg.apiBaseUrl) throw new Error(`tapcanvas profile ${args.profile} 未配置`);
const base = cfg.apiBaseUrl.replace(/\/$/, '');

async function call(urlPath, body) {
  const res = await fetch(`${base}${urlPath}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${cfg.apiKey}`, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  });
  const raw = await res.text();
  let payload = null;
  try { payload = JSON.parse(raw); } catch { /* 非 JSON 原样报 */ }
  if (res.status >= 400 || !payload || !payload.result) throw new Error(`${urlPath} HTTP ${res.status} ${raw.slice(0, 600)}`);
  return payload.result;
}

let task = await call('/public/draw', { kind: 'text_to_image', prompt: args.prompt, extras: { modelAlias: args.model, aspectRatio: args.aspectRatio || '1:1' } });
console.log('submitted', JSON.stringify({ id: task.id, status: task.status }));
const deadline = Date.now() + 10 * 60_000;
while (task.status === 'queued' || task.status === 'running') {
  if (Date.now() > deadline) throw new Error(`生成超时，平台任务 ${task.id} 仍在 ${task.status}`);
  await new Promise((r) => setTimeout(r, 4000));
  task = await call('/public/tasks/result', { taskId: task.id, taskKind: 'text_to_image' });
}
if (task.status !== 'succeeded') throw new Error(`生成失败：${JSON.stringify(task).slice(0, 800)}`);
const asset = (task.assets || []).find((a) => a && (a.url || a.imageUrl)) || null;
const url0 = asset ? (asset.url || asset.imageUrl) : null;
if (!url0) throw new Error(`生图成功但没有返回图片地址：${JSON.stringify(task).slice(0, 800)}`);
const url = /^https?:\/\//i.test(url0) ? url0 : `${base}${url0.startsWith('/') ? '' : '/'}${url0}`;
const img = await fetch(url);
if (!img.ok) throw new Error(`下载失败 HTTP ${img.status} ${url}`);
await mkdir(path.dirname(path.resolve(args.out)), { recursive: true });
await writeFile(args.out, Buffer.from(await img.arrayBuffer()));
console.log('saved', JSON.stringify({ out: args.out, url, taskId: task.id }));
