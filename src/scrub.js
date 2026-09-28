/* =====================================================================
 * Carnet · 页数轴 · 拖着页码选页   （脚本 21 / 23）
 * ---------------------------------------------------------------------
 * ① 长按页码唤出页数轴，拖动/点选快速跳页
 * ② 键盘左右键翻页
 *
 * 依赖模块：core, state, reader-view
 *
 * 说明：模块间共用全局作用域，按下面的顺序加载，顺序即依赖顺序。
 * ===================================================================== */
/* ==================== 页数轴：长按页码拖着选页 ==================== */
const SCRUB_PAD = 18;            // 轴两端留白，滑块不会顶到边缘
let scrubOn = false, scrubHideT = null, scrubRaf = 0, scrubJob = null;
function scrubCount() {
  const n = pageCount();
  return state.mode === 'spread' ? Math.max(Math.ceil(n / 2), 1) : Math.max(n, 1);
}
function scrubIndex() {
  return state.mode === 'spread' ? state.spread : state.page;
}
function buildScrub() {
  const count = scrubCount();
  const step = count > 40 ? Math.ceil(count / 24) : 1;
  let html = '';
  for (let i = 0; i < count; i++) html += `<i class="${i % step === 0 ? 'maj' : ''}"></i>`;
  $('#scrubTicks').innerHTML = html;
}
function paintScrub() {
  const track = $('#scrubTrack');
  if (!track) return;
  const w = track.clientWidth - SCRUB_PAD * 2;
  const i = clamp(scrubIndex(), 0, Math.max(scrubCount() - 1, 0));
  const last = Math.max(scrubCount() - 1, 1);
  const x = SCRUB_PAD + (i / last) * Math.max(w, 1);
  const xs = x.toFixed(1) + 'px';
  const bar = $('#scrubBar'), num = $('#scrubNum');
  if (bar) bar.style.left = xs;
  if (num) { num.style.left = xs; num.textContent = state.mode === 'spread' ? String(i * 2 + 1) : String(i + 1); }
  const fill = $('#scrubFill'); if (fill) fill.style.width = xs;
}
/* 落位到某一格：页面立刻跟着变，实现“页数随拖动条变化” */
function setScrubIndex(idx) {
  idx = clamp(Math.round(idx), 0, Math.max(scrubCount() - 1, 0));
  if (idx === scrubIndex()) return;
  if (state.mode === 'spread') state.spread = idx; else state.page = idx;
  renderReader();
  if (navigator.vibrate) { try { navigator.vibrate(6); } catch (_) {} }
}
/* 手指在轴上：按绝对位置落格 */
function idxFromAbs(clientX) {
  const t = $('#scrubTrack'); if (!t) return scrubIndex();
  const r = t.getBoundingClientRect();
  const w = Math.max(r.width - SCRUB_PAD * 2, 1);
  const ratio = clamp((clientX - r.left - SCRUB_PAD) / w, 0, 1);
  return Math.round(ratio * Math.max(scrubCount() - 1, 0));
}
/* 从页码长按出来的：按位移量走，滑块不会跳到手指下方 */
function idxFromDelta(clientX, startX, startIdx) {
  const t = $('#scrubTrack'); if (!t) return scrubIndex();
  const per = Math.max((t.clientWidth - SCRUB_PAD * 2) / Math.max(scrubCount() - 1, 1), 1);
  return startIdx + Math.round((clientX - startX) / per);
}
/* 每帧最多重绘一次 */
function queueScrub(fn) {
  scrubJob = fn;
  if (scrubRaf) return;
  scrubRaf = requestAnimationFrame(() => {
    scrubRaf = 0;
    const job = scrubJob; scrubJob = null;
    if (!job || !scrubOn) return;
    setScrubIndex(job());
    paintScrub();
  });
}
function openScrub(clientX, absolute) {
  const n = pageCount();
  if (!n) { toast('还没有页面'); return; }
  if (isCoverView()) {                       // 停在封面时，从第 1 页开始选
    if (state.mode === 'spread') state.spread = 0; else state.page = 0;
    renderReader();
  }
  buildScrub();
  hideTextBar();                             // 页数轴和文字样式条不同时出现
  $('#scrub').classList.add('show', 'dragging');
  scrubOn = true;
  clearTimeout(scrubHideT);
  paintScrub();
  const startX = clientX, startIdx = scrubIndex();
  const mv = ev => queueScrub(() => absolute ? idxFromAbs(ev.clientX) : idxFromDelta(ev.clientX, startX, startIdx));
  const up = () => {
    window.removeEventListener('pointermove', mv);
    window.removeEventListener('pointerup', up);
    window.removeEventListener('pointercancel', up);
    $('#scrub').classList.remove('dragging');
    scrubOn = false;
    clearTimeout(scrubHideT);
    scrubHideT = setTimeout(closeScrub, 800);
  };
  window.addEventListener('pointermove', mv);
  window.addEventListener('pointerup', up);
  window.addEventListener('pointercancel', up);
}
function closeScrub() {
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
    openScrub(e.clientX, true);
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
    if (performance.now() - menuClosedAt < 500) { active = false; return; }  // 刚关菜单：只关菜单
    if (e.target.closest('.tstyle')) return;
    syncAddFocusFrom(e.target);               // 在哪一页上操作，新内容就默认加到那一页
    const img = e.target.closest('.pimg-wrap');
    if (img && !img.classList.contains('locked')) return;
    const tw = e.target.closest('.ptext-wrap');
    // 正在输入 / 正在调整大小的文字贴自己处理手势；已固定的文字和固定图片一样可以滑动翻页
    if (tw && (tw.classList.contains('editing') || tw.classList.contains('adjust'))) return;
    if (!e.target.closest('.img-del,.hdl,.img-lock,.txt-edit')) {
      hideTextBar();                                // 点空白处：收起文字样式条
    }
    $$('.pimg-wrap,.ptext-wrap').forEach(x => { if (x !== tw) x.classList.remove('sel', 'adjust'); });
    sx = e.clientX; sy = e.clientY; active = true;
  });
  stage.addEventListener('pointerup', e => {
    if (!active) return; active = false;
    if (state.imgDragging) return;
    const dx = e.clientX - sx, dy = e.clientY - sy;
    if (Math.abs(dx) > 46 && Math.abs(dx) > Math.abs(dy)) flip(dx < 0 ? 1 : -1);
    else if (Math.abs(dx) < 6 && Math.abs(dy) < 6) {
      // 刚收尾文字编辑：这一下只是「退出输入」，不要顺手翻页
      if (performance.now() - (window.__textCommitAt || 0) < 450) return;
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
      if (e.target.closest('.img-del') || e.target.closest('.hdl') || e.target.closest('.img-lock') || e.target.closest('.txt-edit')) return;
      const r = stage.getBoundingClientRect();
      const x = e.clientX - r.left;
      flip(x > r.width / 2 ? 1 : -1);
    }
  });
  stage.addEventListener('pointercancel', () => active = false);
})();

