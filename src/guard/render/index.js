// 渲染扩展注册入口：各系统的渲染模块在这里 import（模块内调用 registerFx / registerZoneVis / registerLayer）。
// registerLayer(fn)：fn(scene, sim, inView) 每帧调用，用于画系统自带的世界物件（传送门、秘境状态等）。
export const LAYERS = [];
export function registerLayer(fn) { LAYERS.push(fn); }
