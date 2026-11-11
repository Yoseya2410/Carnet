/* =====================================================================
 * Carnet · 页数轴 · 拖着页码选页与滑动翻页   （脚本 25 / 27）
 * ---------------------------------------------------------------------
 * ① 长按页码唤出固定长度的白色胶囊，一根刻度 = 一页，刻度数与页数一一对应
 * ② 滑块是「加速摇杆」：离中心越远刻度滚得越快，顶到两端最快；松手弹性回中
 * ③ 左右滑动翻页、点左右半区翻页、键盘左右键翻页
 * ④ 关面板后的短窗口内抑制翻页：统一问 core.js 的 flipSuppressed(ms)
 *
 * 对外接口：openScrub, closeScrub, paintScrub, setScrubIndex
 *
 * 依赖模块：core, state, reader-view（reader-flow / text-sticker 后置，只在运行时调用）
 *
 * 说明：模块间共用全局作用域，加载顺序即依赖顺序（见 index.html 与 README）。
 * ===================================================================== */
/* ==================== 页数轴：每页一根刻度的加速滚轮 ==================== */
const SCRUB_GAP = 14;            // 每根刻度的间距 = 一页
const SCRUB_VMAX = .62;          // 滑块顶到两端时每帧最多滚多少页
let scrubOn = false, scrubHideT = null;
let scrubPos = 0;                // 浮点页位置，刻度带按它连续滚动
let scrubDx = 0, scrubMaxX = 48; // 滑块相对中心的位移 / 可移动上限
let scrubAutoRaf = 0, scrubAutoT = 0;
function scrubCount() {
  const n = pageCount();
  return state.mode === 'spread' ? spreadCount(n) : Math.max(n, 1);
}
function scrubIndex() { return state.mode === 'spread' ? state.spread : state.page; }
function scrubLast() { return Math.max(scrubCount() - 1, 0); }
/* 一根刻度 = 一页，页数变了就重建（只在打开页数轴时跑一次） */
function buildScrub() {
  const box = $('#scrubTicks'); if (!box) return;
  const n = scrubCount();
  let html = '';
  for (let i = 0; i < n; i++) html += `<i style="left:${((i + .5) * SCRUB_GAP).toFixed(1)}px"></i>`;
  box.innerHTML = html;
}
/* 刻度清晰：全部实心黑，只按离中心的距离改变粗细 / 长短（中间粗两边细），
   最低不透明度 .72 —— 不做渐隐，两端也看得清。只刷可见的几根，页数再多也不卡。 */
function paintScrub() {
  const track = $('#scrubTrack'), box = $('#scrubTicks');
  if (!track || !box) return;
  if (!scrubOn && Math.round(scrubPos) !== scrubIndex()) scrubPos = scrubIndex();  // 外部翻页后同步
  const w = track.clientWidth, center = w / 2, last = scrubLast();
  scrubPos = clamp(scrubPos, 0, last);
  const shift = center - (scrubPos + .5) * SCRUB_GAP;
  box.style.transform = `translate3d(${shift.toFixed(2)}px,0,0)`;
  const idx = clamp(Math.round(scrubPos), 0, last);
  const num = $('#scrubNum');
  /* 双页：第 0 格是「封面内侧 + 第 1 页」，报右页的页码；往后报左页页码 */
  if (num) num.textContent = String(state.mode === 'spread' ? spreadIndices(idx)[1] + 1 : idx + 1);
  const kids = box.children;
  const lo = clamp(Math.floor(-shift / SCRUB_GAP) - 2, 0, last);
  const hi = clamp(Math.ceil((w - shift) / SCRUB_GAP) + 2, 0, last);
  for (let k = lo; k <= hi; k++) {
    const el = kids[k]; if (!el) continue;
    const x = (k + .5) * SCRUB_GAP + shift;
    const t = Math.max(0, 1 - Math.abs(x - center) / Math.max(center, 1));
    el.style.width = (3 + 2.5 * t).toFixed(1) + 'px';
    el.style.height = (12 + 9 * t).toFixed(1) + 'px';
    el.style.opacity = (.72 + .28 * t).toFixed(2);
  }
}
/* 拖动中跨页也要把纸面翻过去：手帐本跟着页数轴实时翻页。
   autoTick 本身跑在 rAF 里、一帧最多跨一次页，所以这里每帧最多重绘一次；
   renderReader() 内部会调 paintScrub()，刻度带继续按 scrubPos 连续滚动。 */
function setScrubIndex(idx) {
  idx = clamp(Math.round(idx), 0, scrubLast());
  if (idx === scrubIndex()) return;
  if (state.mode === 'spread') state.spread = idx; else state.page = idx;
  renderReader();
  if (navigator.vibrate) { try { navigator.vibrate(6); } catch (_) {} }
}
function stopAuto() {
  if (scrubAutoRaf) { cancelAnimationFrame(scrubAutoRaf); scrubAutoRaf = 0; }
  scrubAutoT = 0;
}
/* 滑块位置 = 速度：|dx| 越接近两端刻度滚得越快（平方曲线），
   手指按住不动也会一直滚；回到中心附近就停。左 → 向前翻，右 → 向后翻。 */
function autoTick(now) {
  scrubAutoRaf = 0;
  if (!scrubOn) return;
  const dt = scrubAutoT ? clamp((now - scrubAutoT) / 16.7, .5, 2) : 1;
  scrubAutoT = now;
  const r = Math.abs(scrubDx) / Math.max(scrubMaxX, 1);
  if (r > .08 && scrubLast() > 0) {
    const dir = scrubDx < 0 ? -1 : 1;
    scrubPos = clamp(scrubPos + dir * SCRUB_VMAX * r * r * dt, 0, scrubLast());
    const idx = clamp(Math.round(scrubPos), 0, scrubLast());
    if (idx !== scrubIndex()) setScrubIndex(idx); else paintScrub();
  }
  scrubAutoRaf = requestAnimationFrame(autoTick);
}
function openScrub(clientX) {
  const n = pageCount();
  if (!n) { toast('还没有页面'); return; }
  if (isCoverView()) {                       // 停在封面时，从第 1 页开始选
    if (state.mode === 'spread') state.spread = 0; else state.page = 0;
    renderReader();
  }
  buildScrub();
  scrubPos = scrubIndex();
  scrubDx = 0;
  hideTextBar();                             // 页数轴和文字样式条不同时出现
  $('#scrub').classList.add('show', 'dragging');
  scrubOn = true;
  clearTimeout(scrubHideT);
  const track = $('#scrubTrack'), num = $('#scrubNum');
  scrubMaxX = track && num ? Math.max(12, (track.clientWidth - num.offsetWidth) / 2 - 6) : 48;
  paintScrub();
  stopAuto(); scrubAutoRaf = requestAnimationFrame(autoTick);
  const startX = clientX;
  const mv = ev => {
    scrubDx = clamp(ev.clientX - startX, -scrubMaxX, scrubMaxX);
    if (num) num.style.transform = `translate(calc(-50% + ${scrubDx.toFixed(1)}px),-50%)`;
  };
  const up = () => {
    window.removeEventListener('pointermove', mv);
    window.removeEventListener('pointerup', up);
    window.removeEventListener('pointercancel', up);
    stopAuto();
    $('#scrub').classList.remove('dragging');   // 先撤掉 transition:none，回弹才有动画
    if (num) num.style.transform = '';          // 过冲曲线把滑块弹回正中
    scrubDx = 0;
    scrubOn = false;
    renderReader();                            // 落到最终页：整页只重绘这一次
    clearTimeout(scrubHideT);
    scrubHideT = setTimeout(closeScrub, 800);
  };
  window.addEventListener('pointermove', mv);
  window.addEventListener('pointerup', up);
  window.addEventListener('pointercancel', up);
}
function closeScrub() {
  stopAuto();
  clearTimeout(scrubHideT);
  scrubOn = false;
  const s = $('#scrub');
  if (s) { s.classList.remove('show', 'dragging'); }
  const p = $('#pager');
  if (p) p.classList.remove('pressing');
}
/* 长按页码 320ms 唤出页数轴；轻点给出提示 */
(() => {
  const p = $('#pager');
  let timer = null, sx = 0, sy = 0, fired = false;
  p.addEventListener('pointerdown', e => {
    if (scrubOn) return;
    e.preventDefault();
    sx = e.clientX; sy = e.clientY; fired = false;
    p.classList.add('pressing');
    timer = setTimeout(() => {
      timer = null; fired = true;
      openScrub(e.clientX);
      if (navigator.vibrate) { try { navigator.vibrate(12); } catch (_) {} }
    }, 320);
    const move = ev => {
      if (Math.abs(ev.clientX - sx) > 10 || Math.abs(ev.clientY - sy) > 10) {
        clearTimeout(timer); timer = null; p.classList.remove('pressing');
      }
    };
    const up = () => {
      clearTimeout(timer); timer = null;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      if (!fired) { p.classList.remove('pressing'); toast('长按页码，拖动选页'); }
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  });
  // 轴还在的这会儿，可以直接按在轴上拖动（绝对定位落格）
  $('#scrubTrack').addEventListener('pointerdown', e => {
    if (scrubOn) return;
    e.preventDefault(); e.stopPropagation();
    clearTimeout(scrubHideT);
    openScrub(e.clientX);
  });
})();
// 键盘
window.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    if ($('#confirmMask').classList.contains('show')) { closeConfirm(); return; }
    if ($('#searchPanel').classList.contains('show')) { toggleSearch(false); return; }
    if ($('#mask').classList.contains('show')) { closeEditor(); return; }
  }
  if (!$('#reader').classList.contains('show')) return;
  if (e.key === 'ArrowRight') flip(1);
  else if (e.key === 'ArrowLeft') flip(-1);
  else if (e.key === 'Escape') closeReader();
});
// 滑动翻页：图片未固定时在图片上拖动是移动图片；固定后，图片上也能左右滑动翻页
(() => {
  const stage = $('#stage');
  let sx = 0, sy = 0, active = false;
  stage.addEventListener('pointerdown', e => {
    /* 右键是纸面菜单的，不参与翻页手势：否则抬起的那一下会被当成「点了一下」翻页 */
    if (e.button > 0) { active = false; return; }
    if (flipSuppressed(500)) { active = false; return; }        // 刚关菜单：只关菜单
    if (e.target.closest('.objbar')) return;                 // 工具条上的按键不算滑动手势
    syncAddFocusFrom(e.target);               // 在哪一页上操作，新内容就默认加到那一页
    const img = e.target.closest('.pimg-wrap');
    if (img && !img.classList.contains('locked')) return;
    const tw = e.target.closest('.ptext-wrap');
    // 正在输入 / 正在调整大小的文字贴自己处理手势；已固定的文字和固定图片一样可以滑动翻页
    if (tw && (tw.classList.contains('editing') || tw.classList.contains('adjust'))) return;
    if (!e.target.closest('.objbar,.hdl')) {
      hideTextBar();                                // 点空白处：收起编辑面板与选中态
    }
    /* boxmode 是长按版式态的标记，跟着 adjust 一起撤，别让旧对象的四角手柄孤零零留着 */
    $$('.pimg-wrap,.ptext-wrap').forEach(x => { if (x !== tw) x.classList.remove('sel', 'adjust', 'boxmode'); });
    sx = e.clientX; sy = e.clientY; active = true;
  });
  stage.addEventListener('pointerup', e => {
    if (e.button > 0) { active = false; return; }
    if (!active) return; active = false;
    if (state.imgDragging) return;
    const dx = e.clientX - sx, dy = e.clientY - sy;
    if (Math.abs(dx) > 46 && Math.abs(dx) > Math.abs(dy)) flip(dx < 0 ? 1 : -1);
    else if (Math.abs(dx) < 6 && Math.abs(dy) < 6) {
      /* 刚收尾行内打字 / 刚关掉编辑面板或底色面板：这一下只是「退出编辑」，不要顺手翻页 */
      if (flipSuppressed(450)) return;
      /* 「+」菜单开着时点页面 = 切换目标页（右页也能选），不翻页 */
      const m = $('#addMenu');
      if (m && m.classList.contains('show') && state.mode === 'spread' && !isCoverView()) {
        const slot = e.target.closest('#slotL, #slotR');
        if (slot) {
          const pid = slotPageIndex(slot);
          if (pid >= 0 && cur().pages[pid]) {
            setAddTarget(pid); markAddTarget(); updateAddMenuHint();
            return;
          }
        }
      }
      // 点击左右半区翻页（图片 / 文字区域除外，避免误触）
      if (e.target.closest('.pimg-wrap') || e.target.closest('.ptext-wrap')) return;
      if (e.target.closest('.objbar') || e.target.closest('.hdl')) return;
      const r = stage.getBoundingClientRect();
      const x = e.clientX - r.left;
      flip(x > r.width / 2 ? 1 : -1);
    }
  });
  stage.addEventListener('pointercancel', () => active = false);
})();

