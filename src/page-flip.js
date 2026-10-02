/* =====================================================================
 * Carnet · 翻页动画 · 叶片翻转   （脚本 13 / 24）
 * ---------------------------------------------------------------------
 * ① 三次贝塞尔求值器 cubicBezier 与翻页专用曲线 EASE_FLIP
 * ② 单步翻页 stepFlip / flip：叶片沿书脊翻转、深度压暗
 * ③ 翻页位移清理 clearBookShift 与动画取消 cancelFlip
 * ④ ⚠️ flip 用 layoutBook 写下的 state.pw 算半页位移 —— 翻页前必须先跑过 layoutBook
 *
 * 对外接口：flip, stepFlip, cancelFlip, clearBookShift, cubicBezier
 *
 * 依赖模块：core, state, reader-view
 *
 * 说明：模块间共用全局作用域，加载顺序即依赖顺序（见 index.html 与 README）。
 * ===================================================================== */
/* ==================== 翻页 ==================== */
/* 逐帧驱动：翻页过程中可以立刻接受下一次翻页，不必等动画播完 */
/* 三次贝塞尔求值器：用牛顿迭代反解 t，翻页曲线可以随手调 */
function cubicBezier(x1, y1, x2, y2) {
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
  const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  const fx = t => ((ax * t + bx) * t + cx) * t;
  const dfx = t => (3 * ax * t + 2 * bx) * t + cx;
  const fy = t => ((ay * t + by) * t + cy) * t;
  return x => {
    if (x <= 0) return 0; if (x >= 1) return 1;
    let t = x;
    for (let i = 0; i < 6; i++) {
      const e = fx(t) - x; if (Math.abs(e) < 1e-5) break;
      const d = dfx(t); if (Math.abs(d) < 1e-6) break;
      t -= e / d;
    }
    return fy(Math.min(Math.max(t, 0), 1));
  };
}
/* 起步稍缓、中段快、收尾绵长 —— 比对称的 easeInOut 更接近真纸 */
const EASE_FLIP = cubicBezier(.42, 0, .24, 1);
let flipA = null, lastFlipAt = 0;
function endFlip() {
  if (!flipA) return;
  cancelAnimationFrame(flipA.raf);
  const dir = flipA.dir;
  flipA = null;
  if (state.mode === 'spread') state.spread += dir; else state.page += dir;
  const leaf = $('#leaf');
  leaf.classList.remove('show', 'turning');
  leaf.style.transition = 'none';
  leaf.style.transform = 'none';
  clearBookShift();                            // 清掉「翻开 / 合上」时的临时位移
  renderReader();
}
/* 清掉翻开 / 合上封面时临时写在书上的横移（内联样式优先于 cover-only 的类） */
function clearBookShift() { const bk = $('#book'); if (bk) bk.style.transform = ''; }
function cancelFlip() {
  if (flipA) { cancelAnimationFrame(flipA.raf); flipA = null; }
  clearBookShift();
}
function stepFlip(now) {
  if (!flipA) return;
  const p = clamp((now - flipA.t0) / flipA.dur, 0, 1);
  const e = EASE_FLIP(p);
  const deg = flipA.from + (flipA.to - flipA.from) * e;
  // 翻到中途把纸轻轻"抬"起来一点，避免转动看起来是纯 2D 压扁
  const lift = Math.sin(p * Math.PI) * 30;
  $('#leaf').style.transform = `translateZ(${lift.toFixed(1)}px) rotateY(${deg.toFixed(3)}deg)`;
  /* 封面 ↔ 第一跨页：书同时「摊开 / 合拢」——整本横移半页宽，
     前 42% 就把位移补齐，剩下的动作跟普通翻页一模一样 */
  if (flipA.slide) {
    const sp = clamp(p / 0.42, 0, 1), se = sp * sp * (3 - 2 * sp);
    const [s0, s1] = flipA.slide;
    $('#book').style.transform = `translateX(${(s0 + (s1 - s0) * se).toFixed(1)}px)`;
  }
  if (p < 1) flipA.raf = requestAnimationFrame(stepFlip);
  // onEnd：合书时借这套引擎翻一次，翻完自行收束，不走 endFlip（那会改页码并重绘）
  else if (flipA.onEnd) { const cb = flipA.onEnd; flipA = null; cb(); }
  else endFlip();
}
function flip(dir) {
  const n = pageCount();
  if (!n) return;
  commitTextEdit();                    // 翻页前先把正在编辑的文字存下来
  if (state.mode === 'spread') {
    const pairs = Math.ceil(n / 2), s = state.spread;
    if (dir > 0 && s >= pairs - 1) return;
    if (dir < 0 && s <= -1) return;
  } else {
    const p = state.page;
    if (dir > 0 && p >= n - 1) return;
    if (dir < 0 && p <= -1) return;
  }
  // 上一次翻页还没结束：立即落定，接着翻下一页，实现连续快翻
  if (flipA) endFlip();

  const leaf = $('#leaf'), lf = $('#leafF'), lb = $('#leafB');
  let start, end, slide = null;
  if (state.mode === 'spread') {
    const s = state.spread;
    let front, back, sL, sR;
    if (dir > 0) { front = s * 2 + 1; back = s * 2 + 2; sL = s * 2; sR = s * 2 + 3; }
    else { front = s * 2 - 1; back = s * 2; sL = s * 2 - 2; sR = s * 2 + 1; }
    $('#slotL').innerHTML = pageHTML(sL, 'left');
    $('#slotR').innerHTML = pageHTML(sR, 'right');
    lf.innerHTML = pageHTML(front, 'right');
    lb.innerHTML = pageHTML(back, 'left');
    start = dir > 0 ? 0 : -180;
    end = dir > 0 ? -180 : 0;
    /* 封面单独一页 ↔ 第一跨页：照样翻纸，同时让整本书横移半页宽完成摊开 / 合拢。
       封面打开：位移 -半页 → 0；合回封面：0 → -半页 */
    const half = (state.pw || 0) / 2;
    if (s === -1 && dir > 0) slide = [-half, 0];
    else if (s === 0 && dir < 0) { slide = [0, -half]; $('#book').classList.add('cover-only'); }
    if (slide) $('#slotL').innerHTML = '';   // 摊开 / 合拢过程中，左页不参与
  } else {
    const p = state.page;
    if (dir > 0) {
      $('#slotR').innerHTML = pageHTML(p + 1, 'single');
      lf.innerHTML = pageHTML(p, 'single');
      lb.innerHTML = pageHTML(p + 1, 'single');
      start = 0; end = -180;
    } else {
      $('#slotR').innerHTML = pageHTML(p, 'single');
      lf.innerHTML = pageHTML(p - 1, 'single');
      lb.innerHTML = pageHTML(p, 'single');
      start = -180; end = 0;
    }
  }

  const now = performance.now();
  const gap = now - lastFlipAt;
  lastFlipAt = now;
  // 连着翻：动画自动缩短，越点越快，且不会出现"排队等前一页"
  const dur = gap < 150 ? 200 : (gap < 320 ? 270 : (gap < 620 ? 370 : 500));

  leaf.classList.add('show', 'turning');
  leaf.style.transition = 'none';
  leaf.style.transform = `rotateY(${start}deg)`;
  flipA = { dir, from: start, to: end, slide, t0: now, dur, raf: requestAnimationFrame(stepFlip) };
}

