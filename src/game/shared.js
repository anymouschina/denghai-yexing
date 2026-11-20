import UP from '../data/upgrades.json';
import EN from '../data/enemies.json';
import WV from '../data/waves.json';
import BAL from '../data/balance.json';
import META from '../data/meta.json';

export { UP, EN, WV, BAL, META };
export const CELL = 80;
export const TAU = Math.PI * 2;
export const UPS = Object.fromEntries(UP.list.map((u) => [u.id, u]));
export const EVOS = Object.fromEntries(UP.evolutions.map((e) => [e.weapon, e]));
export const FX_TINT = { paper: [0xf3e6c8, 0xb9a6d6, 0xe0463a], wisp: [0x7fe3ff, 0x9fa8ff, 0xffffff], spark: [0xffa040, 0xffd36a, 0xe0463a] };
