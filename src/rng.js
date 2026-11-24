// mulberry32：带种子的伪随机数，刷怪/掉落/升级抽取都用它，结算页显示种子方便复现
export function mulberry32(seed) {
  let a = seed >>> 0;
  const rand = function rand() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  // 存档用：读写内部状态，读档后随机序列与存档时完全一致
  rand.getState = () => a >>> 0;
  rand.setState = (v) => { a = v | 0; };
  return rand;
}
