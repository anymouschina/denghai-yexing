// 技能实现注册表：KITS[单位key][槽位] = { cast(sim, u, aim) → false 表示没放出去, ai(sim, u) → 瞄准点或 null }
// 槽位：英雄 q/e/r/f/u（u=大招，耗满能量）；雇佣兵 q；神兽 q/e。数值在 data/heroes.json / units.json 的 skills 里。
import azhu from './azhu.js';
import huoqing from './huoqing.js';
import yunque from './yunque.js';
import xuanshuang from './xuanshuang.js';
import * as MERCS from './mercs.js';
import * as BEASTS from './beasts.js';

export const KITS = {};
KITS.azhu = azhu;
KITS.huoqing = huoqing;
KITS.yunque = yunque;
KITS.xuanshuang = xuanshuang;
Object.assign(KITS, MERCS, BEASTS);
