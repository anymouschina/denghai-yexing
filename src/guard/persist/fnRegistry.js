// 存档用函数登记表：妖物的 update 等"具名行为函数"按 id 存取；闭包（技能回调等）不进存档。
const byId = new Map();
const byFn = new Map();
export function regFn(id, fn) {
  byId.set(id, fn);
  byFn.set(fn, id);
  return fn;
}
export const fnId = (fn) => byFn.get(fn);
export const fnById = (id) => byId.get(id);
