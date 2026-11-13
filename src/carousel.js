/* =====================================================================
 * Carnet · 主页 · 左右滑动轮播   （脚本 13 / 28）
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

  /* 每本书的中心点 / 宽度只在 measure() 里量一次，之后一直复用：
     translate / scale 走的是 transform，不参与布局，拖动过程中这两个数不会变。
     原来是边写 el.style.transform 边读 el.offsetWidth —— 写一次就强制重排一次，
     n 本书就是每帧 n 次重排，拖起来发涩全花在这上面。 */
  let mets = [], wrapW = 0, lastK = [];
  /* 只有「节点换了」或「视口变了」才重新量布局。
     拖动松手 / 滚轮换本都会调 snap()，以前每次都把 n 本书的 offsetLeft / offsetWidth
     读一遍 —— CSS transform 刚写完就同步读布局，是一次强制重排，落在松手那一下最明显。
     书没换、视口没动时这些数一个都不会变，直接沿用。 */
  function measure(force) {
    const els = [...track.children];
    const changed = force || els.length !== items.length || els.some((el, i) => el !== items[i]);
    if (!changed) return;
    items = els;
    wrapW = wrap.clientWidth;
    mets = items.map(el => ({ c: el.offsetLeft + el.offsetWidth / 2, w: el.offsetWidth }));
    lastK = items.map(() => NaN);     // 节点重建过，下一帧必须全量写一次
    minOff = maxOff = 0;
    if (!items.length) return;
    maxOff = wrapW / 2 - mets[0].c;
    minOff = wrapW / 2 - mets[mets.length - 1].c;
    if (minOff > maxOff) { const t = minOff; minOff = maxOff; maxOff = t; }
  }
  function styleItems() {
    const view = wrapW / 2 - off, edge = wrapW / 2;
    for (let i = 0; i < items.length; i++) {
      const m = mets[i], prev = lastK[i];
      const span = Math.max(m.w * 1.25, 1);
      const dist = Math.abs(m.c - view);
      /* 屏幕外、且上次就已经是熄灭态：连除法都不必算。
         中心点 / 宽度是布局值，transform 不影响它们，measure() 后一直有效。 */
      if (dist > edge + span && prev === 0) continue;
      const k = dist >= span ? 0 : 1 - dist / span;
      /* 只写真正变了的书：拖动时绝大多数书 k 恒为 0，中心附近 1~2 本在变。
         ⚠️ 阈值 .0002 是照着下面三个 toFixed 的精度算的 —— 小于它时
         scale(4 位小数)、saturate / brightness(3 位小数) 三串都不会变，
         跳过写 DOM 不会有任何像素差异，只是省掉字符串拼接与 CSSOM 写入。 */
      if (Number.isFinite(prev) && Math.abs(k - prev) < .0002) continue;
      lastK[i] = k;
      const el = items[i];
      el.style.transform = `scale(${(1 + 0.055 * k).toFixed(4)})`;
      el.style.filter = `saturate(${(0.86 + 0.14 * k).toFixed(3)}) brightness(${(0.94 + 0.06 * k).toFixed(3)})`;
    }
  }
  function paint() {
    track.style.transform = `translate3d(${off.toFixed(2)}px,0,0)`;
    styleItems();
  }
  /* 跟手那一下按帧画：pointermove 一秒能来上百次，每次都立刻写样式会把主线程堵住。
     攒到下一帧统一画一次 —— 看上去一样跟手，掉帧没了。snap() 走的是带缓动的落位，直接 paint。 */
  let paintRaf = 0;
  function schedulePaint() {
    if (paintRaf) return;
    paintRaf = requestAnimationFrame(() => { paintRaf = 0; paint(); });
  }
  function cancelPaint() { if (paintRaf) { cancelAnimationFrame(paintRaf); paintRaf = 0; } }
  function ease(animate) {
    track.style.transition = animate ? EASE : 'none';
    items.forEach(el => el.style.transition = animate ? EASE + ',filter .46s ease' : 'none');
  }
  /* ===== 松手惯性 =====
     vel 的单位是 px/帧（pointermove 里已按 16.7ms 归一），摩擦按帧衰减。
     以前松手是「算一个投影目标 → CSS 缓动一次跳过去」，快甩也只能跨两本，
     手上没有"东西还在滑"的感觉。现在按初速逐帧滑行，末端仍吸附到最近一本。
     惯性期间 track 的 transition 保持 'none'（pointerdown 的 ease(false) 设的），
     每帧位移立即生效；只有收尾 snap() 才打开缓动补最后一点距离。 */
  let inertRaf = 0, inertVel = 0, inertT = 0;
  function stopInertia() {
    if (inertRaf) { cancelAnimationFrame(inertRaf); inertRaf = 0; }
    inertVel = 0; inertT = 0;
  }
  function nearestIndex() {
    const view = wrapW / 2 - off;
    let best = 0, bd = Infinity;
    for (let i = 0; i < mets.length; i++) {
      const d = Math.abs(mets[i].c - view);
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  }
  function settle() { stopInertia(); snap(nearestIndex(), true); }
  function startInertia(v0) {
    stopInertia();
    inertVel = clamp(v0, -48, 48);
    if (Math.abs(inertVel) < 1.2) { settle(); return; }
    const step = now => {
      inertRaf = 0;
      const dt = inertT ? clamp((now - inertT) / 16.7, .5, 2) : 1;
      inertT = now;
      off += inertVel * dt;
      /* 撞到两端：软回弹 + 快速泄速，不硬停 */
      if (off > maxOff) { off -= (off - maxOff) * .22; inertVel *= .68; }
      else if (off < minOff) { off += (minOff - off) * .22; inertVel *= .68; }
      inertVel *= Math.pow(.94, dt);
      paint();
      const near = nearestIndex();
      if (near !== state.sel) {          // 滑行中选中态 / 计数跟着走，点开时 cur() 也是这一本
        state.sel = near;
        items.forEach((el, k) => el.classList.toggle('active', k === near));
        $('#countPill').textContent = `${near + 1} / ${items.length}`;
      }
      if (Math.abs(inertVel) < .35) { settle(); return; }
      inertRaf = requestAnimationFrame(step);
    };
    inertRaf = requestAnimationFrame(step);
  }
  function snap(i, animate) {
    stopInertia();                       // 外部换本 / 滚轮 / 重排都要先掐掉惯性
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
    off = wrapW / 2 - mets[idx].c;
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
                x, dx: 0, scroll: 0, auto: 0, raf: 0, lastT: 0, dragged: false,
                wrapRect: wrap.getBoundingClientRect() };  // 拖动期间容器不动，边缘判定只量这一次
    dragging = false; vel = 0;                  // 交出横向滚动的控制权
    stopInertia();
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
    applySortNow();                           // 自动滚动本身就在帧里，立刻画，不排队到下一帧
    s.raf = requestAnimationFrame(autoTick);
  }
  /* 排序的重画统一收口到一帧一次：pointermove 和边缘自动滚动的 rAF 可能在同一帧
     都要求重画，各写一次的话 n 本书会被写两遍。 */
  let sortRaf = 0;
  function scheduleSort() {
    if (sortRaf) return;
    sortRaf = requestAnimationFrame(() => { sortRaf = 0; applySort(); });
  }
  function applySortNow() {
    if (sortRaf) { cancelAnimationFrame(sortRaf); sortRaf = 0; }
    applySort();
  }
  function applySort() {
    const s = sorting; if (!s) return;
    s.to = clamp(s.from + Math.round((s.dx + s.scroll) / s.step), 0, s.els.length - 1);
    if (s.to !== s.lastTo) { s.lastTo = s.to; buzz(8); }
    s.el.style.transform = `translateX(${s.dx.toFixed(1)}px) scale(1.07)`;
    const view = wrapW / 2 - off;
    s.els.forEach((e, i) => {
      if (e === s.el) return;
      let shift = 0;
      if (s.to > s.from) { if (i > s.from && i <= s.to) shift = -s.step; }
      else if (s.to < s.from) { if (i >= s.to && i < s.from) shift = s.step; }
      shift -= s.scroll;
      const m = mets[i] || { c: s.bases[i] + e.offsetWidth / 2, w: e.offsetWidth };
      const d = Math.abs(m.c + shift - view) / Math.max(m.w * 1.25, 1);
      const k = Math.max(0, 1 - d);
      e.style.transform = `translateX(${shift.toFixed(1)}px) scale(${(1 + 0.055 * k).toFixed(4)})`;
    });
  }
  function moveSort(x) {
    const s = sorting;
    s.x = x; s.dx = x - s.startX;
    if (Math.abs(s.dx) > 6) s.dragged = true;    // 真的拖动了才吞掉随后的 click
    const r = s.wrapRect, edge = Math.max(56, r.width * 0.18);
    let a = 0, depth = 0;
    if (x > r.right - edge) { a = 1; depth = Math.min(1, (x - (r.right - edge)) / Math.max(edge, 1)); }
    else if (x < r.left + edge) { a = -1; depth = Math.min(1, ((r.left + edge) - x) / Math.max(edge, 1)); }
    s.depth = depth;
    if (a && !s.raf) { s.auto = a; s.lastT = performance.now(); s.raf = requestAnimationFrame(autoTick); }
    else if (!a && s.raf) { s.auto = 0; cancelAnimationFrame(s.raf); s.raf = 0; }
    else s.auto = a;
    scheduleSort();                           // 上百次 pointermove 只画一帧
  }
  function endSort() {
    applySortNow();      // 补上攒着没画的那一帧：s.to 必须是松手那一刻的位置
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
    if (inertRaf) {                       // 按下打断惯性：这一下不该顺手把书翻开
      suppressClick = true;
      setTimeout(() => suppressClick = false, 340);
    }
    stopInertia();
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
    schedulePaint();
  }, { passive: true });
  const endDrag = () => {
    clearTimeout(holdTimer); pendingEl = null;
    if (sorting) { endSort(); return; }
    if (!dragging) return;
    dragging = false;
    cancelPaint();
    if (moved) { suppressClick = true; setTimeout(() => suppressClick = false, 340); }
    /* 手指停在原地超过 120ms 再松手，说明已经不想甩了，别把旧速度带出去 */
    const v0 = performance.now() - lastT < 120 ? vel : 0;
    vel = 0;
    if (items.length > 1 && Math.abs(v0) >= 1.5) { startInertia(v0); return; }
    /* 轻手一拨：沿用原来的短投影吸附，最多跨两本 */
    const proj = off + v0 * 5;
    let best = state.sel, bd = Infinity;
    items.forEach((el, i) => {
      const d = Math.abs(mets[i].c + proj - wrapW / 2);
      if (d < bd) { bd = d; best = i; }
    });
    best = clamp(best, state.sel - 2, state.sel + 2);
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
    layout(animate) { measure(true); snap(state.sel, animate); },  // 外部调用视口可能变了，强制重量
    snap,
    consumeClick() { const s = suppressClick; suppressClick = false; return s; }
  };
})();
function layoutCarousel(animate) { carousel.layout(animate); }
function selectJournal(i, animate = true) {
  if (state.prefs.view === 'spine') {
    state.sel = clamp(i, 0, Math.max(state.journals.length - 1, 0));
    syncSpineSelection(animate);
    return;
  }
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

