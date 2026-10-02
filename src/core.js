/* =====================================================================
 * Carnet · 基础工具 · 视口与通用小工具   （脚本 1 / 24）
 * ---------------------------------------------------------------------
 * ① $ / $$ / uid / clamp / enc / esc / shade 等通用小工具
 * ② 输入法弹起时锁定应用高度（底栏不被顶起、编辑文字时跟随抬起）
 * ③ 底栏高度记在 window.__syncBotBar / __kbHeight 上，text-sticker 会读
 * ④ 关面板后抑制翻页的统一记号 markFlipSuppressed / flipSuppressed
 *
 * 对外接口：$, $$, uid, clamp, enc, esc, shade, markFlipSuppressed, flipSuppressed
 *
 * 依赖模块：无
 *
 * 说明：模块间共用全局作用域，加载顺序即依赖顺序（见 index.html 与 README）。
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
  /* ---- 输入法挡住页面：把整页往上抬，让正在编辑的文字露在键盘上方 ----
     #app 高度是锁死的（键盘不会压缩布局），所以键盘是盖在内容上的。
     这里按「编辑框底部 与 底栏顶部」的差值来抬 .stage，抬到刚好看见光标为止。 */
  let typeShift = 0;
  const kbHeight = () => {
    const vv = window.visualViewport;
    return vv ? Math.max(0, Math.round(baseH - vv.height - (vv.offsetTop || 0))) : 0;
  };
  const syncTypeShift = () => {
    const stage = document.querySelector('.stage');
    const w = document.querySelector('.ptext-wrap.editing');
    if (!stage) return;
    const apply0 = v => {
      if (Math.abs(v - typeShift) < .5) return;
      typeShift = v;
      stage.style.transform = v > .5 ? `translateY(${-v}px)` : '';
    };
    if (!w) { apply0(0); return; }
    const kb = kbHeight();
    if (kb <= 4) { apply0(0); return; }        // 键盘没弹起 / 已收起：不用抬
    const rbot = document.querySelector('.rbot');
    const rtop = document.querySelector('.rtop');
    const floor = rbot ? rbot.getBoundingClientRect().top - 8 : baseH - kb - 8;   // 底栏已经跟着抬上来了
    const ceil = (rtop ? rtop.getBoundingClientRect().bottom : 0) + 6;            // 别把框顶到标题栏底下
    const r = w.getBoundingClientRect();       // 已含当前位移
    const want = typeShift + (r.bottom - floor);      // 还差多少才露出底部
    const max = Math.max(0, r.top + typeShift - ceil);
    apply0(clamp(want, 0, max));
  };
  window.__syncTypeShift = syncTypeShift;
  window.__kbHeight = kbHeight;          // 文字编辑面板也要按这个高度把自己抬到键盘上面
  const syncAll = () => { sync(); syncBotBar(); syncTypeShift(); };
  const syncBars = () => { syncBotBar(); syncTypeShift(); };
  window.addEventListener('resize', syncAll);
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', syncBars);
    window.visualViewport.addEventListener('scroll', syncBars);
  }
  /* 键盘升起有动画，多加几次延迟重试，抬升才跟得上最终高度 */
  const later = fn => { setTimeout(fn, 60); setTimeout(fn, 220); setTimeout(fn, 460); setTimeout(fn, 700); };
  document.addEventListener('focusin', () => later(syncBars));
  document.addEventListener('focusout', () => later(syncBars));
  document.addEventListener('focusout', () => setTimeout(sync, 60));
})();

/* ==================== 工具 ==================== */
/* ---- 「刚退出某个面板」的统一记号 ----
   关掉文字编辑面板 / 底色面板 /「＋」菜单的那一下，手指往往还落在纸面上，
   紧接着抬起的 pointerup 不该被当成「翻页」或「点选」。
   各面板关闭时统一调一次 markFlipSuppressed()，翻页判定处用
   flipSuppressed(ms) 问一句即可 —— 别在各处自己记时间戳，容易漏判。 */
let flipSuppressedAt = 0;
function markFlipSuppressed() { flipSuppressedAt = performance.now(); }
function flipSuppressed(ms) { return performance.now() - flipSuppressedAt < (ms || 450); }
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

