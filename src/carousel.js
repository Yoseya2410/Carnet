/* =====================================================================
 * Carnet · 主页 · 左右滑动轮播   （脚本 11 / 24）
 * ---------------------------------------------------------------------
 * ① 排布与跟手：按屏幕比例算书的大小与间距 layoutCarousel
 * ② 滑动松手后落到最近的一本、居中吸附
 * ③ selectJournal / consumeClick 对外入口
 *
 * 对外接口：carousel.layoutCarousel, carousel.selectJournal, carousel.consumeClick
 *
 * 依赖模块：core, state
 *
 * 说明：模块间共用全局作用域，加载顺序即依赖顺序（见 index.html 与 README）。
 * ===================================================================== */
const carousel = (() => {
  const wrap = $('#carouselWrap'), track = $('#carousel');
  const EASE = 'transform .46s cubic-bezier(.22,.92,.24,1)';
  let items = [], off = 0, minOff = 0, maxOff = 0;
  let dragging = false, moved = false, startX = 0, startOff = 0, lastX = 0, lastT = 0, vel = 0;
  let suppressClick = false, wheelLock = 0;
  let holdTimer = 0, pendingEl = null, pendingX = 0, sorting = null;
  const HOLD_MS = 420;                          // 长按多久进入排序

  const centerOf = el => el.offsetLeft + el.offsetWidth / 2;
  function measure() {
    items = [...track.children];
    if (!items.length) { minOff = maxOff = 0; return; }
    const w = wrap.clientWidth;
    maxOff = w / 2 - centerOf(items[0]);
    minOff = w / 2 - centerOf(items[items.length - 1]);
    if (minOff > maxOff) { const t = minOff; minOff = maxOff; maxOff = t; }
  }
  function styleItems() {
    const view = wrap.clientWidth / 2 - off;
    items.forEach(el => {
      const d = Math.abs(centerOf(el) - view) / Math.max(el.offsetWidth * 1.25, 1);
      const k = Math.max(0, 1 - d);
      el.style.transform = `scale(${(1 + 0.055 * k).toFixed(4)})`;
      el.style.filter = `saturate(${(0.86 + 0.14 * k).toFixed(3)}) brightness(${(0.94 + 0.06 * k).toFixed(3)})`;
    });
  }
  function paint() {
    track.style.transform = `translate3d(${off.toFixed(2)}px,0,0)`;
    styleItems();
  }
  function ease(animate) {
    track.style.transition = animate ? EASE : 'none';
    items.forEach(el => el.style.transition = animate ? EASE + ',filter .46s ease' : 'none');
  }
  function snap(i, animate) {
    measure();
    if (!items.length) { track.style.transform = 'translate3d(0,0,0)'; return; }
    const idx = clamp(i, 0, items.length - 1);
    state.sel = idx;
    items.forEach((el, k) => el.classList.toggle('active', k === idx));
    const j = cur();
    if (j) {
      $('#homeName').textContent = j.name;
      $('#homePages').innerHTML = `<span>▤</span><span>${j.pages.length} 页</span>`;
    }
    $('#countPill').textContent = `${idx + 1} / ${items.length}`;
    off = wrap.clientWidth / 2 - centerOf(items[idx]);
    ease(animate);
    paint();
  }

  /* ===== 长按拖动排序：选中一本，左右拖到目标位置，松手落位 ===== */
  function buzz(ms) { try { navigator.vibrate && navigator.vibrate(ms); } catch (_) {} }
  function beginSort(el, x) {
    const els = [...track.children];
    const from = els.indexOf(el);
    if (from < 0 || els.length < 2) return;
    const bases = els.map(e => e.offsetLeft);
    const step = Math.abs(bases[1] - bases[0]) || el.offsetWidth;
    sorting = { el, els, bases, step, from, to: from, lastTo: from, startX: x,
                x, dx: 0, scroll: 0, auto: 0, raf: 0, lastT: 0, dragged: false };
    dragging = false; vel = 0;                  // 交出横向滚动的控制权
    wrap.classList.add('sortmode');
    el.classList.add('picked');
    buzz(12);
    applySort();
  }
  /* 手指拖不动了（到屏幕边）就用 scroll 接力：其余的书持续往反方向送，
     远处够不着的手帐本会一路被送到手边 */
  function scrollRange(s) {
    const lo = -s.from * s.step - s.dx, hi = (s.els.length - 1 - s.from) * s.step - s.dx;
    return [Math.min(lo, hi), Math.max(lo, hi)];
  }
  function autoTick(now) {
    const s = sorting;
    if (!s || !s.auto) { if (s) s.raf = 0; return; }
    const dt = Math.min(now - s.lastT, 60) / 1000;
    s.lastT = now;
    const [lo, hi] = scrollRange(s);
    const speed = s.step * (1.8 + 2.2 * (s.depth || 0));   // 手指越贴边，送得越快
    s.scroll = clamp(s.scroll + s.auto * speed * dt, lo, hi);
    applySort();
    s.raf = requestAnimationFrame(autoTick);
  }
  function applySort() {
    const s = sorting; if (!s) return;
    s.to = clamp(s.from + Math.round((s.dx + s.scroll) / s.step), 0, s.els.length - 1);
    if (s.to !== s.lastTo) { s.lastTo = s.to; buzz(8); }
    s.el.style.transform = `translateX(${s.dx.toFixed(1)}px) scale(1.07)`;
    const view = wrap.clientWidth / 2 - off;
    s.els.forEach((e, i) => {
      if (e === s.el) return;
      let shift = 0;
      if (s.to > s.from) { if (i > s.from && i <= s.to) shift = -s.step; }
      else if (s.to < s.from) { if (i >= s.to && i < s.from) shift = s.step; }
      shift -= s.scroll;
      const d = Math.abs(s.bases[i] + e.offsetWidth / 2 + shift - view) / Math.max(e.offsetWidth * 1.25, 1);
      const k = Math.max(0, 1 - d);
      e.style.transform = `translateX(${shift.toFixed(1)}px) scale(${(1 + 0.055 * k).toFixed(4)})`;
    });
  }
  function moveSort(x) {
    const s = sorting;
    s.x = x; s.dx = x - s.startX;
    if (Math.abs(s.dx) > 6) s.dragged = true;    // 真的拖动了才吞掉随后的 click
    const r = wrap.getBoundingClientRect(), edge = Math.max(56, r.width * 0.18);
    let a = 0, depth = 0;
    if (x > r.right - edge) { a = 1; depth = Math.min(1, (x - (r.right - edge)) / Math.max(edge, 1)); }
    else if (x < r.left + edge) { a = -1; depth = Math.min(1, ((r.left + edge) - x) / Math.max(edge, 1)); }
    s.depth = depth;
    if (a && !s.raf) { s.auto = a; s.lastT = performance.now(); s.raf = requestAnimationFrame(autoTick); }
    else if (!a && s.raf) { s.auto = 0; cancelAnimationFrame(s.raf); s.raf = 0; }
    else s.auto = a;
    applySort();
  }
  function endSort() {
    const s = sorting; sorting = null;
    if (s.raf) cancelAnimationFrame(s.raf);
    wrap.classList.remove('sortmode');
    s.el.classList.remove('picked');
    s.els.forEach(e => { e.style.transform = ''; });
    if (s.dragged) { suppressClick = true; setTimeout(() => suppressClick = false, 340); }
    const { from, to } = s;
    if (to === from) { snap(state.sel, true); return; }
    const arr = state.journals;
    arr.splice(to, 0, arr.splice(from, 1)[0]);
    save();
    let ns = state.sel;                          // 选中的那本跟着走
    if (state.sel === from) ns = to;
    else if (from < state.sel && to >= state.sel) ns = state.sel - 1;
    else if (from > state.sel && to <= state.sel) ns = state.sel + 1;
    renderHome();
    snap(clamp(ns, 0, state.journals.length - 1), false);
  }

  wrap.addEventListener('pointerdown', e => {
    if (e.target.closest('.gear')) return;
    measure();
    dragging = true; moved = false; vel = 0;
    startX = lastX = e.clientX; lastT = performance.now();
    startOff = off;
    ease(false);
    /* 手指按住不动才算长按；一旦开始横向滑就把长按作废，让位给滚动 */
    clearTimeout(holdTimer);
    pendingEl = e.target.closest('.book-item'); pendingX = e.clientX;
    holdTimer = setTimeout(() => { if (pendingEl) beginSort(pendingEl, pendingX); }, HOLD_MS);
  });
  window.addEventListener('pointermove', e => {
    if (sorting) { moveSort(e.clientX); return; }
    if (!dragging) return;
    const x = e.clientX, now = performance.now();
    const dx = x - startX;
    if (Math.abs(dx) > 5) { moved = true; clearTimeout(holdTimer); pendingEl = null; }
    const dt = now - lastT;
    if (dt > 6) { vel = vel * 0.7 + ((x - lastX) / dt) * 0.3 * 16.7; lastX = x; lastT = now; }
    let t = startOff + dx;
    if (t > maxOff) t = maxOff + (t - maxOff) * 0.3;
    else if (t < minOff) t = minOff + (t - minOff) * 0.3;
    off = t;
    paint();
  }, { passive: true });
  const endDrag = () => {
    clearTimeout(holdTimer); pendingEl = null;
    if (sorting) { endSort(); return; }
    if (!dragging) return;
    dragging = false;
    const proj = off + vel * 5;
    let best = state.sel, bd = Infinity;
    items.forEach((el, i) => {
      const d = Math.abs(centerOf(el) + proj - wrap.clientWidth / 2);
      if (d < bd) { bd = d; best = i; }
    });
    best = clamp(best, state.sel - 2, state.sel + 2);
    if (moved) { suppressClick = true; setTimeout(() => suppressClick = false, 340); }
    vel = 0;
    snap(best, true);
  };
  window.addEventListener('pointerup', endDrag);
  window.addEventListener('pointercancel', endDrag);
  wrap.addEventListener('wheel', e => {
    if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;
    const now = performance.now();
    if (now < wheelLock) return;
    wheelLock = now + 230;
    snap(state.sel + (e.deltaX > 0 ? 1 : -1), true);
  }, { passive: true });

  return {
    layout(animate) { measure(); snap(state.sel, animate); },
    snap,
    consumeClick() { const s = suppressClick; suppressClick = false; return s; }
  };
})();
function layoutCarousel(animate) { carousel.layout(animate); }
function selectJournal(i, animate = true) {
  if (state.prefs.view === 'shelf') {          // 书架模式：选中并滚到那本，不经过轮播
    state.sel = clamp(i, 0, Math.max(state.journals.length - 1, 0));
    syncHomeHead();
    $$('#shelfWrap .book-item').forEach(el => el.classList.toggle('active', +el.dataset.i === state.sel));
    const el = $(`#shelfWrap .book-item[data-i="${state.sel}"]`);
    if (el && el.scrollIntoView) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    return;
  }
  carousel.snap(i, animate);
}

