/* =====================================================================
 * Carnet · 基础工具 · 视口   （脚本 1 / 23）
 * ---------------------------------------------------------------------
 * ① 输入法弹起时锁定应用高度（键盘不再顶起底栏，编辑文字时底栏跟随抬起）
 * ② $ / $$ / uid / clamp / enc / esc / shade 等通用小工具
 *
 * 依赖模块：无
 *
 * 说明：模块间共用全局作用域，按下面的顺序加载，顺序即依赖顺序。
 * ===================================================================== */
/* ==================== 输入法弹起时锁住应用高度 ====================
   键盘出现会把视口压矮，导致底栏被顶上去。这里把 #app 的高度固定在
   “未弹起输入法时的高度”，底栏就一直待在原位（被键盘盖住而不是上移）。 */
(() => {
  let baseH = window.innerHeight;
  const isTyping = () => {
    const a = document.activeElement;
    return !!a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.isContentEditable);
  };
  const apply = () => document.documentElement.style.setProperty('--app-h', baseH + 'px');
  const sync = () => {
    const h = window.innerHeight;
    if (!h) return;
    if (!isTyping() || h > baseH) baseH = h;   // 正在输入时只在变高（键盘收起）才跟随
    apply();
  };
  apply();
  window.addEventListener('resize', sync);
  window.addEventListener('orientationchange', () => setTimeout(sync, 260));
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', sync);
    window.visualViewport.addEventListener('scroll', sync);
  }
  // 聚焦输入框的瞬间先把高度记下来，键盘随后弹起也不受影响
  document.addEventListener('focusin', () => { if (isTyping() && window.innerHeight > baseH) { baseH = window.innerHeight; apply(); } });
  /* 编辑文字时反过来：底栏要跟着输入法一起抬起来，别被键盘盖住 */
  const coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
  let kbWasUp = false;
  const syncBotBar = () => {
    const el = document.querySelector('.rbot');
    if (!el) return;
    const vv = window.visualViewport;
    let kb = 0;
    // 键盘高度 = 锁定住的应用高度 - 当前可视高度
    if (el.classList.contains('editing') && vv) kb = Math.max(0, Math.round(baseH - vv.height - (vv.offsetTop || 0)));
    /* 输入法收起（键盘高度归零）后自动退出文字编辑，不用再点一下别处 */
    const w = coarse ? document.querySelector('.ptext-wrap.editing') : null;
    if (w) {
      if (kb > 60) kbWasUp = true;
      else if (kbWasUp && kb <= 4 && w.isConnected) { kbWasUp = false; stopTextEdit(w, true); return; }
      else if (kb <= 4) kbWasUp = false;
    }
    el.style.transform = kb > 4 ? `translateY(${-kb}px)` : '';
  };
  window.__syncBotBar = syncBotBar;
  const syncAll = () => { sync(); syncBotBar(); };
  window.addEventListener('resize', syncAll);
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', syncBotBar);
    window.visualViewport.addEventListener('scroll', syncBotBar);
  }
  document.addEventListener('focusin', () => setTimeout(syncBotBar, 40));
  document.addEventListener('focusout', () => setTimeout(syncBotBar, 120));
  document.addEventListener('focusout', () => setTimeout(sync, 60));
})();

/* ==================== 工具 ==================== */
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const uid = () => 'x' + Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const enc = svg => 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function shade(hex, pct) {
  let c = hex.replace('#', '');
  if (c.length === 3) c = c.split('').map(x => x + x).join('');
  const n = parseInt(c, 16);
  let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const f = v => clamp(Math.round(v + (pct / 100) * 255), 0, 255);
  return '#' + ((1 << 24) + (f(r) << 16) + (f(g) << 8) + f(b)).toString(16).slice(1);
}

