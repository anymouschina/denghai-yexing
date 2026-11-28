// 空间哈希：每 tick 重建一次敌人格子，范围查询 O(格子内数量)
export const CELL = 96;

export class Grid {
  constructor() {
    this.map = new Map();
    this._usedKeys = [];
    this._pool = [];
  }

  rebuild(list) {
    // 复用桶数组，避免 30Hz × 850 怪潮下每 tick 分配数百个临时数组造成 GC 抖动
    const used = this._usedKeys;
    for (let i = 0; i < used.length; i++) {
      const k = used[i];
      const arr = this.map.get(k);
      if (arr) {
        arr.length = 0;
        this._pool.push(arr);
        this.map.delete(k);
      }
    }
    used.length = 0;
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      if (!e.alive) continue;
      const k = ((e.x / CELL) | 0) * 8192 + ((e.y / CELL) | 0);
      let arr = this.map.get(k);
      if (!arr) {
        arr = this._pool.length ? this._pool.pop() : [];
        this.map.set(k, arr);
        used.push(k);
      }
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
      const row = cx * 8192;
      for (let cy = y0; cy <= y1; cy++) {
        const arr = this.map.get(row + cy);
        if (!arr) continue;
        for (let i = 0; i < arr.length; i++) {
          const e = arr[i];
          if (e.alive && cb(e) === false) return;
        }
      }
    }
  }
}
