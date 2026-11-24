// 浏览器实测 v3.7：自动拾取（远处掉落无需走近自动入包）+ 上古神器·轩辕剑百分比真实伤害斩项羽实景
// 0 console errors / 0 missing assets；截图存 tests/browser/out/
import { Browser, serve, sleep } from './cdp.mjs';
import { fileURLToPath } from 'node:url';
import { mkdir } from 'node:fs/promises';

const OUT = fileURLToPath(new URL('./out/', import.meta.url));
await mkdir(OUT, { recursive: true });

const { srv, missing } = await serve(fileURLToPath(new URL('../../dist/', import.meta.url)), 8771);
const b = await Browser.launch({ port: 9341 });

try {
  await b.goto('http://127.0.0.1:8771/index.html?tapcanvasPlaytest=1&seed=20261124');
  await b.until((s) => s.scene === 'title', 35000, 'title');
  await b.press('g');
  await b.until((s) => s.scene === 'select', 20000, 'select');
  await sleep(350);
  await b.press('Enter');
  await b.until((s) => s.scene === 'play', 20000, 'play');
  await sleep(450);

  // 1. 自动拾取：在离英雄很远的地方生成道具/装备，等待后应自动收入行囊
  await b.eval(`(() => {
    const sim = globalThis.__guardSim;
    sim.wave.nextAt = 1e9;
    const h = sim.hero;
    globalThis.__autoDrops = [
      sim.ground.spawn(sim.loot.roll({ id: 'pill' }), h.x + 1200, h.y + 600).id,
      sim.ground.spawn(sim.loot.roll({ slot: 'weapon', q: 3, wave: 12 }), h.x - 1300, h.y - 500).id,
      sim.ground.spawn(sim.loot.roll({ id: 'oil' }), h.x + 140, h.y + 40).id,
    ];
    globalThis.__bagBefore = sim.inv.bag.filter(Boolean).length;
    globalThis.__t0 = sim.t;
  })()`);
  for (let i = 0; i < 120; i++) { if (await b.eval('globalThis.__guardSim.t - globalThis.__t0 >= 1.0')) break; await sleep(250); }
  console.log('sim_clock', await b.eval(`JSON.stringify({ t0: globalThis.__t0, t1: globalThis.__guardSim.t, paused: !!globalThis.__guardScene.paused, over: globalThis.__guardSim.over, cfg: globalThis.__guardSim.groundItems.length })`));
  const pick = JSON.parse(await b.eval(`(() => {
    const sim = globalThis.__guardSim;
    const left = globalThis.__autoDrops.filter((id) => sim.groundItems.some((g) => g.id === id));
    return JSON.stringify({ left: left.length, bagGain: sim.inv.bag.filter(Boolean).length - globalThis.__bagBefore });
  })()`));
  console.log('auto_pickup', JSON.stringify(pick));
  if (pick.left !== 0) throw new Error(`仍有 ${pick.left} 件掉落未自动拾取`);
  await b.shot(`${OUT}v37-01-auto-pickup.png`);

  // 2. 轩辕剑：锻造/穿戴后进入项羽秘境，对 BOSS 打出最大生命 1% 真实伤害
  const setup = JSON.parse(await b.eval(`(() => {
    const sim = globalThis.__guardSim;
    const h = sim.hero;
    const sword = sim.loot.roll({ artifactId: 'xuanyuan_sword' });
    sim.loot.give(sword);
    const eq = sim.command({ type: 'equip', bagIdx: sim.inv.equipBag.indexOf(sword), unitId: h.id });
    globalThis.__swordTex = globalThis.__guardScene.textures.exists('g_eq_legend_xuanyuan_sword') && sword.tex === 'g_eq_legend_xuanyuan_sword';
    const er = { ok: true };
    globalThis.__pct = [];
    sim.on('damage', ({ tgt, dmg, o }) => { if (o && o.tag === 'xuanyuan' && tgt.realmBoss === 'xiangyu') globalThis.__pct.push(dmg / tgt.maxHp); });
    h.invuln = 999;
    return JSON.stringify({ equip: eq.ok, enter: er.ok, tex: globalThis.__swordTex });
  })()`));
  if (!setup.tex) throw new Error('轩辕剑图标纹理未加载');
  await b.press('b');
  await sleep(1200);
  await b.shot(`${OUT}v37-03-bag-xuanyuan-icon.png`);
  await b.press('Escape');
  await sleep(400);
  setup.enter = await b.eval(`globalThis.__guardSim.command({ type: 'enterRealm', id: 'xiangyu' }).ok`);
  if (!setup.equip || !setup.enter) throw new Error(`轩辕剑穿戴/进秘境失败 ${JSON.stringify(setup)}`);
  for (let i = 0; i < 60; i++) {
    const has = await b.eval(`(() => { const sim = globalThis.__guardSim; for (const e of sim.enemies) if (e.alive && e.realm === 'xiangyu' && !e.realmBoss) sim.kill(e, sim.hero); return !!sim.realms.run.xiangyu?.boss; })()`);
    if (has) break;
    await sleep(250);
  }
  await b.eval(`(() => {
    const sim = globalThis.__guardSim;
    const boss = sim.enemies.find((e) => e.alive && e.realmBoss === 'xiangyu');
    const h = sim.hero;
    h.x = boss.x - 90; h.y = boss.y;
    sim.input.autoAttack = true;
  })()`);
  await b.eval('globalThis.__t1 = globalThis.__guardSim.t');
  for (let i = 0; i < 160; i++) { if (await b.eval('globalThis.__guardSim.t - globalThis.__t1 >= 3.0')) break; await sleep(250); }
  const xy = JSON.parse(await b.eval(`(() => {
    const sim = globalThis.__guardSim;
    const boss = sim.enemies.find((e) => e.realmBoss === 'xiangyu');
    return JSON.stringify({ procs: globalThis.__pct.length, pct: globalThis.__pct[0] || 0, bossHpPct: boss ? boss.hp / boss.maxHp : null, bolt: true });
  })()`));
  console.log('xuanyuan', JSON.stringify(xy));
  await b.shot(`${OUT}v37-02-xuanyuan-xiangyu.png`);
  if (xy.procs < 3) throw new Error(`轩辕剑触发次数不足: ${xy.procs}`);
  if (Math.abs(xy.pct - 0.01) > 1e-6) throw new Error(`轩辕剑百分比伤害异常: ${xy.pct}`);

  if (b.errors.length > 0) throw new Error(`页面报错: ${JSON.stringify(b.errors)}`);
  if (missing.length > 0) throw new Error(`缺失资源: ${JSON.stringify(missing)}`);
  console.log('ALL_OK');
} catch (e) {
  console.error('FAIL', e.message);
  process.exitCode = 1;
} finally {
  console.log('errors', JSON.stringify(b.errors.slice(0, 10)));
  console.log('missing', JSON.stringify(missing));
  await b.close();
  srv.close();
}
