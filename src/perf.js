// 性能档位：低端机降同屏敌人上限与环境粒子/雾层，保住手感。
// 初始：触屏 + (内存 ≤3GB 或 CPU ≤4 核) 判低档；运行中触屏实测帧率连续偏低也会一次性降档。URL ?perf=low|high 可强制。
import { touch } from './touch.js';
const q = new URLSearchParams(location.search).get('perf');
const weak = (navigator.deviceMemory && navigator.deviceMemory <= 3) || (navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 4);
export const perf = { low: q === 'low' || (q !== 'high' && touch.enabled && !!weak) };
export const LOW_ENEMY_CAP = 130;
