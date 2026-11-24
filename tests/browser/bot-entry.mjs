// 代打机器人注入入口（打成 IIFE 后由 CDP 注入页面）：attach 到页面里的 sim，每个模拟 tick 前跑一次机器人决策。
// 机器人只写 sim.input / 调 sim.command（与键鼠、面板同一入口），不改任何数值。
import { PlayerBot } from '../guard/bot/player.mjs';

export function attach(sim, opts = {}) {
  const bot = new PlayerBot(sim, { kind: 'proxy', sigma: 0.05, seed: 7, log: true, ...opts });
  // equipHold：先暂停机器人自动换装，让脚本用真鼠标在背包里给孔明穿装备；之后放开交还机器人
  const equip = bot.equipBest.bind(bot);
  bot.equipHold = !!opts.equipHold;
  bot.equipBest = () => { if (!bot.equipHold) equip(); };
  const step = sim.step.bind(sim);
  sim.step = () => { if (bot.enabled) bot.step(); step(); };
  bot.enabled = true;
  return bot;
}
