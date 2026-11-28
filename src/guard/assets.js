// 新模式素材清单（按需在 GuardSelect.preload 加载，原模式启动不受影响）。
// 纹理键：public/assets/guard/x.png → g_x；eq/x.png → g_eq_x；sk/x.png → g_sk_x
// 原生多姿态 16 帧精灵图清单：public/assets/guard/sheets/manifest.json（任意单位放入 sheets/<key>.png + .json 即可自动原生加载）
const MAIN = ['altar', 'beast_baihu', 'beast_qilin', 'beast_qinglong', 'beast_xuanwu', 'beast_zhuque', 'bld_arrow', 'bld_foundation', 'bld_fu', 'bld_lamp',
  'bld_lei', 'bld_wall', 'boss_hanba', 'boss_simayi', 'boss_yedi', 'deco_rock', 'deco_tree', 'enemy_bandit', 'enemy_guiche', 'enemy_hunbing', 'enemy_wolf', 'enemy_yeya',
  'hero_guanyu', 'hero_huoqing', 'hero_xuanshuang', 'hero_yunque', 'kongming', 'merc_dao', 'merc_nu', 'merc_tong', 'npc_hunter', 'npc_nanhua', 'realm_gate', 'ui_save_lantern'];
const EQ = ['baihu_a', 'baihu_j', 'baihu_t', 'baihu_w', 'legend_fangtian_halberd', 'legend_qilin_seal', 'legend_qinglong_blade', 'legend_wolong_scroll', 'legend_xuanwu_armor', 'legend_xuanyuan_sword', 'legend_zhuque_fan', 'oil', 'pill', 'plain_a', 'plain_j', 'plain_t', 'plain_w', 'purse', 'qinglong_a', 'qinglong_j', 'qinglong_t',
  'qinglong_w', 'swift', 'wolong_a', 'wolong_j', 'wolong_t', 'wolong_w', 'xuanwu_a', 'xuanwu_j', 'xuanwu_t', 'xuanwu_w', 'zhuque_a', 'zhuque_j', 'zhuque_t', 'zhuque_w'];
const SK = ['hq_e', 'hq_f', 'hq_q', 'hq_r', 'hq_u', 'xs_e', 'xs_f', 'xs_q', 'xs_r', 'xs_u', 'yq_e', 'yq_f', 'yq_q', 'yq_r', 'yq_u'];

// 运行时映射表：texKey / unitKey / sheetKey -> { sheetKey, metaKey, entry }
const NATIVE_SHEET_INDEX = new Map();

function queueNativeSheets(scene, manifest) {
  const sheets = manifest && manifest.sheets;
  if (!sheets || typeof sheets !== 'object') return;
  const L = scene.load;
  for (const [key, entry] of Object.entries(sheets)) {
    if (!entry || !entry.frameWidth || !entry.frameHeight) continue;
    const sheetKey = `sheet_${key}`;
    const metaKey = `sheet_meta_${key}`;
    const rec = { key, sheetKey, metaKey, entry };
    NATIVE_SHEET_INDEX.set(key, rec);
    NATIVE_SHEET_INDEX.set(`g_${key}`, rec);
    if (key.startsWith('beast_')) NATIVE_SHEET_INDEX.set(key.slice(6), rec);
    if (key.startsWith('hero_')) NATIVE_SHEET_INDEX.set(key.slice(5), rec);
    if (key.startsWith('boss_')) NATIVE_SHEET_INDEX.set(key.slice(5), rec);
    if (entry.texKey) NATIVE_SHEET_INDEX.set(entry.texKey, rec);
    if (entry.unitKey) NATIVE_SHEET_INDEX.set(entry.unitKey, rec);
    if (!scene.textures.exists(sheetKey)) {
      L.spritesheet(sheetKey, `assets/guard/sheets/${entry.image || `${key}.png`}`, {
        frameWidth: entry.frameWidth,
        frameHeight: entry.frameHeight,
      });
    }
    if (!scene.cache.json.exists(metaKey)) {
      L.json(metaKey, `assets/guard/sheets/${key}.json`);
    }
  }
}

export function resolveNativeSheet(scene, texKey, unitKey = null) {
  const rec = (unitKey && NATIVE_SHEET_INDEX.get(unitKey))
    || (texKey && NATIVE_SHEET_INDEX.get(texKey))
    || (texKey && texKey.startsWith('g_') && NATIVE_SHEET_INDEX.get(texKey.slice(2)))
    || null;
  if (!rec) return null;
  if (!scene.textures.exists(rec.sheetKey)) return null;
  const meta = scene.cache.json.exists(rec.metaKey) ? scene.cache.json.get(rec.metaKey) : rec.entry;
  return { sheetKey: rec.sheetKey, meta: meta || rec.entry };
}

export function preloadGuard(scene) {
  const L = scene.load;
  for (const k of MAIN) if (!scene.textures.exists(`g_${k}`)) L.image(`g_${k}`, `assets/guard/${k}.png`);
  for (const k of EQ) if (!scene.textures.exists(`g_eq_${k}`)) L.image(`g_eq_${k}`, `assets/guard/eq/${k}.png`);
  for (const k of SK) if (!scene.textures.exists(`g_sk_${k}`)) L.image(`g_sk_${k}`, `assets/guard/sk/${k}.png`);
  if (!scene.textures.exists('g_ground')) L.image('g_ground', 'assets/guard/ground.jpg');
  if (!scene.textures.exists('g_keyart')) L.image('g_keyart', 'assets/guard/keyart.jpg');

  // 动态加载多姿态原生精灵图清单（按需加载已生成的 sheets/<key>.png + .json，无多余 404）
  if (scene.cache.json.exists('g_sheets_manifest')) {
    queueNativeSheets(scene, scene.cache.json.get('g_sheets_manifest'));
  } else {
    L.once('filecomplete-json-g_sheets_manifest', (_k, _t, data) => queueNativeSheets(scene, data));
    L.json('g_sheets_manifest', 'assets/guard/sheets/manifest.json');
  }
}

// 代码生成的小纹理（箭矢、阴影），只做弹体/粒子这类不需要美术的东西
export function makeGuardTextures(scene) {
  if (scene.textures.exists('g_arrow')) return;
  const t = scene.textures.createCanvas('g_arrow', 44, 10);
  const c = t.getContext();
  c.strokeStyle = '#0b0d18'; c.lineWidth = 4; c.beginPath(); c.moveTo(2, 5); c.lineTo(36, 5); c.stroke();
  c.strokeStyle = '#f3e6c8'; c.lineWidth = 2; c.beginPath(); c.moveTo(3, 5); c.lineTo(35, 5); c.stroke();
  c.fillStyle = '#7fe3ff'; c.strokeStyle = '#0b0d18'; c.lineWidth = 1.5; c.beginPath(); c.moveTo(44, 5); c.lineTo(34, 0); c.lineTo(34, 10); c.closePath(); c.fill(); c.stroke();
  c.fillStyle = '#e0463a'; c.fillRect(1, 1, 7, 3); c.fillRect(1, 6, 7, 3);
  t.refresh();
}
