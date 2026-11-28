// 系统注册表：每个系统 { id, init?(sim), preUpdate?(sim,dt), update?(sim,dt), commands?: {type: (sim,cmd)=>({ok,reason})} }
// 各里程碑在这里追加自己的系统（顺序即每 tick 的执行顺序）。
import waves from './waves.js';
import loot from './loot.js';
import realms from './realms.js';
import buildings from './buildings.js';
import mercs from './mercs.js';
import quests from './quests.js';
import bosses from './bosses.js';
import recall from './recall.js';
import blink from './blink.js';
import shop from './shop.js';
import groundDrops from './groundDrops.js';
import escalation from './escalation.js';
import craft from './craft.js';
import training from './training.js';
import bandits from './bandits.js';
import hunter from './hunter.js';
import bossRoom from './bossRoom.js';
import mirror from './mirror.js';
import temper from './temper.js';
import nanhua from './nanhua.js';
import story from './story.js';

export const SYSTEMS = [waves, loot, craft, realms, training, bossRoom, bandits, hunter, mirror, temper, nanhua, buildings, mercs, quests, bosses, recall, blink, shop, groundDrops, escalation, story];
