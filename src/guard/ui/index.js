// HUD 面板注册表（always: true 表示常驻小部件，不需要按键打开）。每项 { name, key（触发键，小写字母）, create(hud) → { c: Container, refresh?(), open?(arg), close?(), key?(e)→bool } }
// 面板打开时战斗照常进行（不暂停）。各里程碑在这里追加自己的面板。
// M3 成长：背包/孔明装备（B）+ 常驻背包小部件
import bag, { bagWidget } from './bag.js';
// M4/v3.5 秘境：常驻秘境状态 + 完整秘境/重刷面板（M）
import realms, { realmsPanel } from './realms.js';
// M5 经营：建造（G）、雇佣（H）、军令（T）+ 常驻军令追踪
import buildPanel from './build.js';
import hirePanel from './hire.js';
import questsPanel, { tracker as questTracker } from './quests.js';
// M7 功能道具商店（P）+ 常驻 HUD 快捷道具栏
import shopPanel from './shop.js';
import quickbar from './quickbar.js';
// v3.6 南华仙人（O）：金币强化装备 & 金币渡劫飞升
import nanhuaPanel from './nanhua.js';

export const PANELS = [bag, bagWidget, realms, realmsPanel, buildPanel, hirePanel, questsPanel, questTracker, shopPanel, quickbar, nanhuaPanel];
