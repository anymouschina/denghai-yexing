// 空间哈希：每 tick 重建一次敌人格子，范围查询 O(格子内数量)
export const CELL = 96;

export class Grid {
  constructor() { this.map = new Map(); }

  rebuild(list) {
    this.map.clear();
    for (const e of list) {
      if (!e.alive) continue;
      const k = ((e.x / CELL) | 0) * 8192 + ((e.y / CELL) | 0);
      let arr = this.map.get(k);
      if (!arr) this.map.set(k, (arr = []));
      arr.push(e);
    }
  }

  // cb 返回 false 提前结束
  query(x, y, r, cb) {
    const x0 = ((x - r) / CELL) | 0;
    const x1 = ((x + r) / CELL) | 0;
    const y0 = ((y - r) / CELL) | 0;
    const y1 = ((y + r) / CELL) | 0;
    for (let cx = x0; cx <= x1; cx++) {
      for (let cy = y0; cy <= y1; cy++) {
        const arr = this.map.get(cx * 8192 + cy);
        if (!arr) continue;
        for (const e of arr) if (e.alive && cb(e) === false) return;
      }
    }
  }
}
