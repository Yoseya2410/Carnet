/* =====================================================================
 * Carnet · Springboard 物理动效与触觉反馈（src/motion.js）
 * ---------------------------------------------------------------------
 * 统一提供：长按震动、rubberBand / decay、sheetTop、push、zoom 与 morph。
 * 业务状态仍由原模块负责；库未就绪、WAAPI 不可用或系统减少动态效果时，
 * 所有入口都退回原来的 CSS / 瞬时行为，不阻塞点击、保存与关闭。
 * ===================================================================== */
(function () {
  'use strict';

  const $ = s => document.querySelector(s);
  let SB = window.Springboard || null;
  let libPromise = null;
  const hasWAAPI = typeof Element !== 'undefined' && typeof Element.prototype.animate === 'function';
  const reduced = () => !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion:reduce)').matches);
  const mobilePortrait = () => !!(window.matchMedia &&
    window.matchMedia('(orientation:portrait) and (max-width:1024px)').matches);

  /* 与 menu-genie.js 共用同一个加载 Promise，避免空闲预取与首次点击各插一份脚本。 */
  function load() {
    if (SB) return Promise.resolve(true);
    if (libPromise) return libPromise;
    if (window.__carnetSpringboardPromise) {
      libPromise = window.__carnetSpringboardPromise;
      return libPromise;
    }
    libPromise = new Promise(resolve => {
      const s = document.createElement('script');
      s.src = 'assets/vendor/springboard.js';
      s.async = true;
      s.onload = () => {
        SB = window.Springboard || null;
        try { if (window.CarnetMenuGenie) window.CarnetMenuGenie.sync(); } catch (_) {}
        resolve(!!SB);
      };
      s.onerror = () => resolve(false);
      document.head.appendChild(s);
    });
    window.__carnetSpringboardPromise = libPromise;
    return libPromise;
  }
  if (window.requestIdleCallback) requestIdleCallback(load, { timeout: 1200 });
  else setTimeout(load, 200);

  function haptic(ms) {
    try {
      if (navigator.vibrate) { navigator.vibrate(ms == null ? 12 : ms); return true; }
    } catch (_) {}
    return false;
  }
  window.carnetHaptic = haptic;

  function rubberBand(offset, dimension) {
    const n = Math.max(1, dimension || 80);
    if (SB && typeof SB.rubberBand === 'function') return SB.rubberBand(offset, n, .55);
    return Math.sign(offset) * n * (1 - Math.exp(-Math.abs(offset) * .3 / n));
  }
  function decay(v, elapsed) {
    return SB && typeof SB.decay === 'function'
      ? SB.decay(v, elapsed, SB.DECELERATION && SB.DECELERATION.normal)
      : v / 3.71 * (1 - Math.exp(-3.71 * elapsed));
  }
  function decayVelocity(v, elapsed) {
    return SB && typeof SB.decayVelocity === 'function'
      ? SB.decayVelocity(v, elapsed, SB.DECELERATION && SB.DECELERATION.normal)
      : v * Math.exp(-3.71 * elapsed);
  }

  function springDuration(spring) {
    if (!SB || !spring) return 360;
    try { return Math.max(180, Math.min(760, Math.round(SB.settle(spring) * 1000))); }
    catch (_) { return 360; }
  }
  function springProgress(spring, count) {
    const duration = springDuration(spring) / 1000;
    const out = [];
    for (let i = 0; i <= count; i++) {
      const p = i === count ? 1 : SB.value(spring, duration * i / count);
      out.push(Math.max(0, Math.min(1, p)));
    }
    return out;
  }
  function play(el, frames, duration, done, additive) {
    if (!el || !hasWAAPI) { if (done) done(); return null; }
    const a = el.animate(frames, {
      duration, easing: 'linear', fill: 'both',
      composite: additive ? 'add' : 'replace'
    });
    a.onfinish = () => {
      if (done) done();
      /* fill:both 只为落地这一帧防脱节；收尾后释放动画，避免累积旧效果。 */
      try { a.cancel(); } catch (_) {}
    };
    a.oncancel = () => {};
    return a;
  }

  /* ---- sheetTop：实际面板负责入场；关闭用短暂副本，业务可同步收尾 ---- */
  const sheetRuns = new WeakMap();
  const sheetClones = new WeakMap();
  function clearSheetClone(el) {
    const old = el && sheetClones.get(el);
    if (!old) return;
    sheetClones.delete(el);
    try { old.anim && old.anim.cancel(); } catch (_) {}
    old.node.remove();
  }
  function cancelSheet(el) {
    if (!el) return;
    const old = sheetRuns.get(el);
    if (old) { try { old.cancel(); } catch (_) {} sheetRuns.delete(el); }
    el.classList.remove('sb-sheet-running');
    clearSheetClone(el);
  }
  function sheet(el, opening, options) {
    const opt = options || {};
    if (!el || el.hidden || reduced() || !SB || !hasWAAPI) return false;
    clearSheetClone(el);
    const old = sheetRuns.get(el);
    if (old) { try { old.cancel(); } catch (_) {} sheetRuns.delete(el); }
    const r = el.getBoundingClientRect();
    if (!r.height || !r.width) return false;
    const screenH = window.innerHeight;
    const finalTop = r.top;
    const travel = Math.max(40, screenH - finalTop + 8);
    const fromY = Math.max(0, Number(opt.fromY) || 0);
    const startP = fromY ? Math.max(0, 1 - fromY / travel) : 0;
    const spring = SB.uikit.sheet;
    const duration = springDuration(spring);
    const progress = springProgress(spring, 40);
    const frames = progress.map(v => {
      const p = opening ? startP + (1 - startP) * v : 1 - v;
      const y = SB.sheetTop(screenH, finalTop, p) - finalTop;
      return { transform: `translate3d(0,${y.toFixed(2)}px,0)` };
    });
    if (!opening) frames[0] = { transform: 'translate3d(0,0,0)' };
    el.classList.add('sb-sheet-running', 'sb-sheet-driven');
    const finish = () => {
      if (sheetRuns.get(el) !== a) return;
      sheetRuns.delete(el);
      el.classList.remove('sb-sheet-running');
      if (opt.onLand) opt.onLand();
    };
    const a = play(el, frames, duration, finish, true);
    if (!a) { el.classList.remove('sb-sheet-running', 'sb-sheet-driven'); return false; }
    sheetRuns.set(el, a);
    return true;
  }
  function dismissSheet(el) {
    if (!el || el.hidden || reduced() || !SB || !hasWAAPI || !el.getClientRects().length) return false;
    cancelSheet(el);
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) return false;
    /* 移动端新建手账本：退场动画先 cloneNode(true) 整棵 #modal，300+ 节点的
       #edForm 是逐帧重绘大头。懒加载开关开着时，在同一个同步任务里把真表单
       临时换成轻骨架给克隆用，克隆完立刻换回 —— 真节点、值、监听器都不动，
       用户也看不见骨架。异常走 finally，绝不让表单落在内存里。 */
    let lazyParked = false;
    try {
      if (el.id === 'modal' && typeof ed !== 'undefined' && ed && ed.isNew &&
          window.CarnetLazyLoad && window.CarnetLazyLoad.on)
        lazyParked = window.CarnetLazyLoad.parkSheetForClone(el);
    } catch (_) {}
    let node, host;
    try {
      node = el.cloneNode(true);
      host = el.parentNode;
    } finally {
      if (lazyParked) { try { window.CarnetLazyLoad.restoreSheetClone(); } catch (_) {} }
    }
    /* #mask .modal 的移动版样式依赖父级 id；单独克隆 modal 会掉成桌面弹窗。 */
    if (el.id === 'modal' && el.parentNode && el.parentNode.id === 'mask') {
      const mask = el.parentNode.cloneNode(false);
      mask.classList.add('show', 'sb-sheet-clone-mask');
      mask.style.pointerEvents = 'none';
      mask.style.animation = 'none';
      mask.style.zIndex = '150';
      mask.appendChild(node);
      node = mask;
      host = $('#app') || document.body;
    } else {
      node.querySelectorAll('[id]').forEach(n => n.removeAttribute('id'));
      node.hidden = false;
      node.classList.add('show');
    }
    const panel = node.id === 'mask' ? node.querySelector('#modal') : node;
    if (!panel) return false;
    panel.hidden = false;
    panel.classList.add('show', 'sb-sheet-clone');
    panel.style.cssText += ';position:fixed!important;left:' + r.left + 'px!important;top:' + r.top +
      'px!important;right:auto!important;bottom:auto!important;width:' + r.width + 'px!important;height:' +
      r.height + 'px!important;max-height:none!important;margin:0!important;transform:none!important;' +
      'animation:none!important;transition:none!important;pointer-events:none!important;';
    node.setAttribute('aria-hidden', 'true');
    host.appendChild(node);
    const screenH = window.innerHeight, top = r.top;
    const progress = springProgress(SB.uikit.sheet, 36);
    const frames = progress.map(v => ({
      transform: `translate3d(0,${(SB.sheetTop(screenH, top, 1 - v) - top).toFixed(2)}px,0)`
    }));
    const rec = { node, anim: null };
    const finish = () => {
      if (sheetClones.get(el) !== rec) return;
      sheetClones.delete(el); node.remove();
    };
    rec.anim = play(panel, frames, springDuration(SB.uikit.sheet), finish);
    if (!rec.anim) { node.remove(); return false; }
    sheetClones.set(el, rec);
    return true;
  }

  /* ---- push：三种主页展示模式的方向性推移 + 30% 视差 ---- */
  let pushRun = null;
  function captureView(el) {
    if (!el || el.hidden || !el.getClientRects().length) return null;
    const r = el.getBoundingClientRect();
    const copy = el.cloneNode(true);
    copy.querySelectorAll('[id]').forEach(n => n.removeAttribute('id'));
    copy.hidden = false;
    copy.style.cssText += ';position:fixed;left:' + r.left + 'px;top:' + r.top + 'px;width:' + r.width +
      'px;height:' + r.height + 'px;margin:0;z-index:18;pointer-events:none;animation:none;transition:none;';
    copy.setAttribute('aria-hidden', 'true');
    copy.dataset.motionClone = 'view';
    const srcCv = el.querySelectorAll('canvas'), dstCv = copy.querySelectorAll('canvas');
    for (let i = 0; i < Math.min(srcCv.length, dstCv.length); i++) {
      try { const c = dstCv[i].getContext('2d'); c && c.drawImage(srcCv[i], 0, 0); } catch (_) {}
    }
    return { copy, rect: r };
  }
  function pushView(snapshot, incoming, direction) {
    if (!snapshot || !incoming || incoming.hidden || reduced() || !SB || !hasWAAPI) {
      if (snapshot) snapshot.copy.remove();
      return false;
    }
    if (pushRun) {
      try { pushRun.a.cancel(); pushRun.b.cancel(); } catch (_) {}
      if (pushRun.old) pushRun.old.remove();
      if (pushRun.el) {
        pushRun.el.classList.remove('sb-push-running');
        pushRun.el.style.transform = ''; pushRun.el.style.opacity = '';
      }
      pushRun = null;
    }
    const app = $('#app') || document.body, old = snapshot.copy;
    app.appendChild(old);
    const width = Math.max(1, window.innerWidth), dir = direction < 0 ? -1 : 1;
    const spring = SB.uikit.navigation.spring;
    const progress = springProgress(spring, 42);
    const states = progress.map(p => SB.push(width, p));
    incoming.classList.add('sb-push-running');
    const rec = { el: incoming, old, a: null, b: null };
    pushRun = rec;
    const finish = () => {
      if (pushRun !== rec) return;
      incoming.classList.remove('sb-push-running');
      incoming.style.transform = ''; incoming.style.opacity = '';
      old.remove(); pushRun = null;
    };
    rec.a = play(incoming, states.map(s => ({
      transform: `translate3d(${(dir * s.incoming).toFixed(2)}px,0,0)`
    })), springDuration(spring), finish);
    rec.b = play(old, states.map(s => ({
      transform: `translate3d(${(dir * s.outgoing).toFixed(2)}px,0,0)`,
      opacity: String(1 - .18 * s.dimming)
    })), springDuration(spring));
    if (!rec.a || !rec.b) { finish(); return false; }
    return true;
  }

  /* ---- zoom：只给开合书第二段生成几何帧，第一段抬起与业务相位不动 ---- */
  function zoomFrames(from, to, duration) {
    if (!SB || !hasWAAPI || reduced()) return null;
    const A = { x: from.left, y: from.top, width: from.width, height: from.height };
    const B = { x: to.left, y: to.top, width: to.width, height: to.height };
    const spring = SB.uikit.zoom.spring;
    const progress = springProgress(spring, 44);
    const rects = progress.map(p => SB.zoom(A, B, p));
    return {
      duration,
      window: rects.map(r => ({
        transform: `translate3d(${r.x.toFixed(2)}px,${r.y.toFixed(2)}px,0)`,
        width: r.width.toFixed(2) + 'px', height: r.height.toFixed(2) + 'px'
      })),
      fit: rects.map(r => {
        const k = Math.max(r.width / Math.max(to.width, 1), r.height / Math.max(to.height, 1));
        return { transform: `translate3d(-50%,-50%,0px) scale(${k.toFixed(5)})` };
      })
    };
  }

  /* ---- Morph：纸面长按点先变成玻璃珠，再展开为菜单；后续菜单可复用 ---- */
  let morphRun = null;
  function morphCleanup(removePopup) {
    const m = morphRun;
    if (!m) return;
    morphRun = null;
    clearTimeout(m.safety);
    m.el.classList.remove('sb-morph-running');
    if (removePopup) m.el.classList.remove('show');
    if (m.anchor && m.ownsAnchor) m.anchor.remove();
    try { if (m.inst) m.inst.destroy(); } catch (_) {}
  }
  function morphOpen(el, options) {
    const opt = options || {};
    if (!el || reduced() || !SB || !hasWAAPI || typeof SB.morph !== 'function') return false;
    morphCleanup(true);
    el.classList.add('show');
    const app = $('#app') || document.body;
    const source = opt.from || null;
    if (source && !source.getClientRects().length) return false;
    /* 真实按钮绝不交给 morph：它会被吸收 / 缩小。只用同位置、同尺寸的透明
       几何锚点参与效果，按钮本体始终保持原样、可继续点击。 */
    const sr = source ? source.getBoundingClientRect() : null;
    const w = sr ? sr.width : 36, h = sr ? sr.height : 36;
    const x = sr ? sr.left + sr.width / 2 : (Number.isFinite(opt.x) ? opt.x : window.innerWidth / 2);
    const y = sr ? sr.top + sr.height / 2 : (Number.isFinite(opt.y) ? opt.y : window.innerHeight / 2);
    const radius = source ? getComputedStyle(source).borderRadius : '50%';
    const anchor = document.createElement('span');
    const ownsAnchor = true;
    anchor.style.cssText = 'position:fixed;left:' + (x - w / 2) + 'px;top:' + (y - h / 2) +
      'px;width:' + w + 'px;height:' + h + 'px;border-radius:' + radius + ';pointer-events:none;' +
      'z-index:79;background:transparent;box-shadow:none';
    app.appendChild(anchor);
    const rec = { el, anchor, ownsAnchor, inst: null, opening: true, safety: 0 };
    morphRun = rec;
    el.classList.add('sb-morph-running');
    const landed = () => {
      if (morphRun !== rec) return;
      clearTimeout(rec.safety);
      rec.opening = false;
      el.classList.remove('sb-morph-running');
    };
    try {
      rec.inst = SB.origin(el, {
        from: anchor,
        effect: SB.morph({ lens: true }),
        bounds: app,
        hideTarget: false,
        reducedMotion: 'user',
        open: false,
        onStart: () => {
          const layer = $('#app > [data-morph]');
          if (layer) layer.style.zIndex = String(opt.layerZ || (el.id === 'paperMenu' ? 80 : 45));
        },
        onLand: landed
      });
      rec.inst.open();
      rec.safety = setTimeout(landed, 1400);
      return true;
    } catch (_) { morphCleanup(false); return false; }
  }
  function morphClose(el) {
    const rec = morphRun;
    if (!el || !rec || rec.el !== el) return false;
    /* 只保留展开 Morph；关闭立即销毁副本，避免玻璃源点反向飞回。 */
    morphCleanup(true);
    return true;
  }


  /* 在全部 defer 脚本完成包装后再接最外层，避免绕开 m-home / 侧滑返回的包装。 */
  function wrap(name, before, after) {
    const orig = window[name];
    if (typeof orig !== 'function') return;
    window[name] = function () {
      if (before) { try { before.apply(this, arguments); } catch (_) {} }
      const result = orig.apply(this, arguments);
      if (after) { try { after.apply(this, arguments); } catch (_) {} }
      return result;
    };
  }
  function init() {
    /* setView 需要在调用前抓旧画面，单独包装以保留快照。 */
    const rawSetView = window.setView;
    if (typeof rawSetView === 'function' && !rawSetView.__motionWrapped) {
      const order = ['#shelfWrap', '#spineWrap', '#carouselWrap'];
      const visible = () => order.map($).find(el => el && !el.hidden) || null;
      const wrapped = function () {
        const old = visible(), snap = old ? captureView(old) : null;
        const oldIndex = order.indexOf(old && '#' + old.id);
        const result = rawSetView.apply(this, arguments);
        const next = visible(), nextIndex = order.indexOf(next && '#' + next.id);
        if (!old || !next || old === next || !$('#reader').classList.contains('show')) {
          if (old !== next) pushView(snap, next, nextIndex >= oldIndex ? 1 : -1);
        } else if (snap) snap.copy.remove();
        return result;
      };
      wrapped.__motionWrapped = true;
      window.setView = wrapped;
    }
    wrap('openEditor', null, function () {
      if (window.MHome && MHome.isMobile() && $('#mask').classList.contains('show')) sheet($('#modal'), true);
    });
    wrap('closeEditor', function () {
      const skip = window.CarnetSwipeBack && CarnetSwipeBack.consuming;
      if (!skip && window.MHome && MHome.isMobile() && $('#mask').classList.contains('show')) dismissSheet($('#modal'));
    });
    [
      ['openTextSheet', 'closeTextSheet', '#tsheet'],
      ['openBgSheet', 'closeBgSheet', '#bgsheet'],
      ['openFrameSheet', 'closeFrameSheet', '#frsheet'],
      ['openStickerSheet', 'closeStickerSheet', '#stsheet']
    ].forEach(([open, close, sel]) => {
      wrap(close, function () { if (mobilePortrait()) dismissSheet($(sel)); });
      wrap(open, null, function () { if (mobilePortrait()) sheet($(sel), true); });
    });
    const rawDiySheet = window.diySheet;
    if (typeof rawDiySheet === 'function') {
      window.diySheet = function (kind) {
        const el = $('#diySheet'), was = !!(el && !el.hidden);
        if (was && !kind && mobilePortrait()) dismissSheet(el);
        const result = rawDiySheet.apply(this, arguments);
        if (kind && mobilePortrait()) sheet(el, true);
        return result;
      };
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else setTimeout(init, 0);

  window.CarnetMotion = {
    load, haptic, rubberBand, decay, decayVelocity,
    lib: () => SB,
    sheet, dismissSheet, cancelSheet,
    zoomFrames,
    morphOpen, morphClose,
    status: () => ({ ready: !!SB, reduced: reduced(), pushing: !!pushRun, morphing: !!morphRun })
  };
})();
