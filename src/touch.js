// 手机触摸层：DOM 覆盖层（虚拟摇杆 + 闪避/暂停按钮）+ 横屏引导 + 禁滚动缩放。
// 用 Pointer Events 按 pointerId 各自追踪，摇杆与按钮可多点同时按；与 Phaser 画布互不抢事件（只有控件本身吃事件）。
// 游戏侧只读 touch.mx / touch.my / touch.mag，并用 consumeDash() 取闪避；键盘路径完全不受影响。
const params = new URLSearchParams(location.search);
const coarse = matchMedia('(pointer: coarse)').matches || matchMedia('(any-pointer: coarse)').matches && !matchMedia('(any-pointer: fine)').matches;

export const touch = {
  enabled: coarse || params.get('touch') === '1',
  mx: 0, my: 0, mag: 0, // 方向单位向量 + 经死区/加速曲线后的力度 0..1
  dashQ: false,
  onPause: null, // 由 UI 场景注册
  portrait: false,
  consumeDash() { const v = this.dashQ; this.dashQ = false; return v; },
};

const DEAD = 0.14; // 死区（占摇杆半径）
const curve = (n) => (n <= 0 ? 0 : Math.min(1, 0.22 + 0.78 * Math.pow(n, 1.25))); // 加速曲线：轻推慢走、推满全速
const R = 54; // 摇杆可拖半径（CSS px）

let root; let stick; let knob; let dashBtn; let visible = false;

function css() {
  const s = document.createElement('style');
  s.textContent = `
  html, body { overscroll-behavior: none; -webkit-user-select: none; user-select: none; -webkit-touch-callout: none; -webkit-tap-highlight-color: transparent; touch-action: none; }
  body.touch { position: fixed; width: 100%; }
  #tc { position: fixed; inset: 0; z-index: 20; pointer-events: none; display: none; font-family: "Ma Shan Zheng", "STKaiti", "KaiTi", serif; }
  #tc.on { display: block; }
  #tc .zone { position: absolute; left: 0; top: 18%; bottom: 0; width: 46%; pointer-events: auto; touch-action: none; }
  #tc .stick { position: absolute; width: 128px; height: 128px; margin: -64px 0 0 -64px; border-radius: 50%;
    background: radial-gradient(circle, rgba(38,43,94,.28) 0 55%, rgba(38,43,94,.5) 100%); border: 3px solid rgba(255,154,60,.55); box-shadow: 0 0 0 3px rgba(11,13,24,.55), 0 0 22px rgba(255,140,50,.25); }
  #tc .knob { position: absolute; left: 50%; top: 50%; width: 56px; height: 56px; margin: -28px 0 0 -28px; border-radius: 50%;
    background: radial-gradient(circle at 40% 35%, #ffd9a0, #f08a2c 60%, #b8531a); border: 3px solid #0b0d18; opacity: .78; }
  #tc .btn { position: absolute; pointer-events: auto; touch-action: none; border-radius: 50%; display: flex; align-items: center; justify-content: center;
    color: #f3e6c8; border: 3px solid #0b0d18; box-shadow: 0 0 0 3px rgba(255,154,60,.55); text-shadow: 0 0 6px #0b0d18, 0 2px 0 #0b0d18; opacity: .72; transition: transform .06s; }
  #tc .btn.down { transform: scale(.9); opacity: .95; }
  #tc .dash { width: 92px; height: 92px; font-size: 38px; right: calc(env(safe-area-inset-right, 0px) + 26px); bottom: calc(env(safe-area-inset-bottom, 0px) + 24px);
    background: conic-gradient(#7fe3ff var(--k, 360deg), rgba(27,33,72,.82) 0); }
  #tc .dash::before { content: ""; position: absolute; inset: 7px; border-radius: 50%; background: rgba(27,33,72,.9); z-index: 0; }
  #tc .dash span { position: relative; z-index: 1; }
  #tc .dash.ready { box-shadow: 0 0 0 3px #7fe3ff, 0 0 18px rgba(127,227,255,.6); }
  #rotate { position: fixed; inset: 0; z-index: 99; display: none; flex-direction: column; align-items: center; justify-content: center; gap: 22px;
    background: radial-gradient(ellipse at 50% 42%, #2a2350 0%, #141a33 45%, #0b0d1c 100%); color: #f3e6c8; text-align: center;
    font-family: "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", system-ui, sans-serif; }
  #rotate .ph { width: 54px; height: 92px; border: 4px solid #ffc977; border-radius: 12px; animation: rot 2.4s ease-in-out infinite; position: relative; }
  #rotate .ph::after { content: ""; position: absolute; left: 50%; bottom: 6px; width: 16px; height: 4px; margin-left: -8px; background: #ffc977; border-radius: 2px; }
  #rotate b { font: 34px "Ma Shan Zheng", "STKaiti", "KaiTi", serif; letter-spacing: 8px; color: #ffc977; }
  #rotate small { color: #9aa3cf; letter-spacing: 2px; }
  @keyframes rot { 0%, 25% { transform: rotate(0); } 60%, 100% { transform: rotate(-90deg); } }
  @media (orientation: portrait) { body.touch #rotate { display: flex; } body.touch #tc { display: none !important; } }
  @media (prefers-reduced-motion: reduce) { #rotate .ph { animation: none; } }`;
  document.head.appendChild(s);
}

function bindStick(zone) {
  let id = null; let ox = 0; let oy = 0;
  const defX = () => Math.max(96, zone.clientWidth * 0.3);
  const defY = () => zone.clientHeight - 100;
  const rest = () => { stick.style.left = `${defX()}px`; stick.style.top = `${defY()}px`; knob.style.transform = ''; stick.style.opacity = '.55'; };
  const move = (e) => {
    let dx = e.clientX - ox; let dy = e.clientY - oy;
    const d = Math.hypot(dx, dy);
    if (d > R) { dx = dx / d * R; dy = dy / d * R; }
    knob.style.transform = `translate(${dx}px,${dy}px)`;
    const n = Math.min(1, d / R);
    if (n < DEAD) { touch.mx = touch.my = touch.mag = 0; return; }
    touch.mx = dx / Math.max(1, Math.min(d, R)); touch.my = dy / Math.max(1, Math.min(d, R));
    const len = Math.hypot(touch.mx, touch.my) || 1; touch.mx /= len; touch.my /= len;
    touch.mag = curve((n - DEAD) / (1 - DEAD));
  };
  zone.addEventListener('pointerdown', (e) => {
    // 触屏设备上忽略合成的鼠标指针（点按会附带 mouse 事件，且可能没有对应抬起，导致摇杆卡死）
    if (e.pointerType === 'mouse' && coarse) return;
    if (id !== null) { if (e.pointerId !== id) return; }
    id = e.pointerId;
    const b = zone.getBoundingClientRect();
    // 浮动原点：在左侧区域按下即以落点为摇杆中心（限制在区域内，避免半截在屏外）
    ox = Math.min(Math.max(e.clientX, b.left + 70), b.right - 70); oy = Math.min(Math.max(e.clientY, b.top + 70), b.bottom - 40);
    stick.style.left = `${ox - b.left}px`; stick.style.top = `${oy - b.top}px`; stick.style.opacity = '.95';
    move(e);
  });
  // 不用 setPointerCapture（残留的捕获会吞掉后续落在别处的点按）：move/up 挂在 window 上，靠 pointerId 区分
  window.addEventListener('pointermove', (e) => { if (e.pointerId === id) move(e); });
  const end = (e) => { if (e.pointerId !== id) return; id = null; touch.mx = touch.my = touch.mag = 0; rest(); };
  window.addEventListener('pointerup', end);
  window.addEventListener('pointercancel', end);
  // 兜底：同一个 pointerId 在摇杆区之外按下，说明之前那次的抬起丢了 → 清掉残留
  window.addEventListener('pointerdown', (e) => { if (id !== null && e.pointerId === id && !zone.contains(e.target)) end(e); }, true);
  touch.releaseAll = () => { id = null; touch.mx = touch.my = touch.mag = 0; rest(); };
  rest();
  window.addEventListener('resize', () => { if (id === null) rest(); });
}

function bindBtn(el, onDown) {
  let id = null; let last = -1e9;
  // 同一次点按可能依次产生 pointerdown / touchstart / mousedown / click：250ms 内只触发一次（部分环境只送其中一种）
  const fire = () => { const n = performance.now(); if (n - last < 250) return; last = n; onDown(); };
  el.addEventListener('pointerdown', (e) => {
    if (id === null) id = e.pointerId;
    el.classList.add('down'); fire(); e.preventDefault();
  });
  const up = (e) => { if (e.pointerId !== id) return; id = null; el.classList.remove('down'); };
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', up);
  el.addEventListener('lostpointercapture', up);
  el.addEventListener('touchstart', (e) => { fire(); if (e.cancelable) e.preventDefault(); }, { passive: false });
  el.addEventListener('mousedown', fire);
  el.addEventListener('click', fire);
}

// 首次手势：尝试锁定横屏（Android Chrome 在全屏/已安装的网页应用里可锁；iOS Safari 不支持 → 靠「请横屏」引导层降级）。
// 不会自动请求全屏：全屏会让视口突然变大，打乱画面与触控坐标。
function tryLock() {
  const run = () => {
    try {
      const p = screen.orientation && screen.orientation.lock && screen.orientation.lock('landscape');
      if (p && p.catch) p.catch(() => { /* 当前模式不允许锁定：保持提示降级 */ });
    } catch { /* 不支持：保持提示降级 */ }
  };
  const once = () => { run(); window.removeEventListener('pointerup', once, true); };
  window.addEventListener('pointerup', once, true);
}

export function initTouch() {
  if (!touch.enabled) return;
  document.body.classList.add('touch');
  css();
  // 禁滚动 / 双指缩放 / 长按菜单 / 下拉刷新
  const stop = (e) => { if (e.cancelable) e.preventDefault(); };
  document.addEventListener('touchmove', stop, { passive: false });
  document.addEventListener('touchstart', (e) => { if (e.touches.length > 1) stop(e); }, { passive: false });
  for (const ev of ['gesturestart', 'gesturechange', 'gestureend', 'contextmenu', 'dblclick']) document.addEventListener(ev, stop);

  root = document.createElement('div');
  root.id = 'tc';
  root.innerHTML = '<div class="zone"><div class="stick"><div class="knob"></div></div></div>'
    + '<div class="btn dash ready" data-k="dash"><span>闪</span></div>';
  document.body.appendChild(root);
  const rot = document.createElement('div');
  rot.id = 'rotate';
  rot.innerHTML = '<div class="ph"></div><b>请横屏</b><small>把手机横过来，《灯骸夜行》需要横屏游玩</small>';
  document.body.appendChild(rot);

  stick = root.querySelector('.stick'); knob = root.querySelector('.knob');
  dashBtn = root.querySelector('.dash');
  bindStick(root.querySelector('.zone'));
  bindBtn(dashBtn, () => { touch.dashQ = true; });
  tryLock();

  const mq = matchMedia('(orientation: portrait)');
  const upd = () => { touch.portrait = mq.matches; if (mq.matches && touch.releaseAll) touch.releaseAll(); };
  mq.addEventListener('change', upd); upd();
}

// 对局中显示控件，标题页 / 弹窗里隐藏（弹窗里用点击选择）
export function setTouchVisible(on) {
  if (!root || on === visible) return;
  visible = on;
  root.classList.toggle('on', on);
  if (!on) touch.releaseAll();
}

// 闪避冷却：k 0..1（1=就绪）
export function setDashProgress(k) {
  if (!dashBtn) return;
  dashBtn.style.setProperty('--k', `${Math.round(k * 360)}deg`);
  dashBtn.classList.toggle('ready', k >= 1);
}
