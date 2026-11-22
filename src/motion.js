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
    /* 动画被新的打开 / 新的关闭抢掉时也要补落地回调：否则迟到的业务收尾
       （重绘书架 / toast）会被整个吞掉，书架就停在旧内容上。 */
    if (old.onLand) { const f = old.onLand; old.onLand = null; f(); }
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
  function dismissSheet(el, options) {
    const opt = options || {};
    if (!el || el.hidden || reduced() || !SB || !hasWAAPI || !el.getClientRects().length) return false;
    cancelSheet(el);
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) return false;
    /* 移动端编辑器 sheet（新建 / 编辑都算）：退场动画先 cloneNode(true) 整棵
       #modal，300+ 节点的 #edForm 是逐帧重绘大头。懒加载开关开着时，在同一个
       同步任务里把真表单临时换成轻骨架给克隆用，克隆完立刻换回 —— 真节点、
       值、监听器都不动，用户也看不见骨架。异常走 finally，绝不让表单落在内存里。 */
    let lazyParked = false;
    try {
      if (el.id === 'modal' && typeof ed !== 'undefined' && ed &&
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
    const rec = { node, anim: null, onLand: typeof opt.onLand === 'function' ? opt.onLand : null };
    const finish = () => {
      if (sheetClones.get(el) !== rec) return;
      sheetClones.delete(el); node.remove();
      /* 落地才执行业务收尾（renderHome / toast）：下滑的每一帧都要求主线程
         闲出来，重绘跟在第一帧后会把 sheet 冻在原地（「白板卡一下才滑走」）。 */
      if (rec.onLand) { const f = rec.onLand; rec.onLand = null; f(); }
    };
    rec.anim = play(panel, frames, springDuration(SB.uikit.sheet), finish);
    if (!rec.anim) { node.remove(); return false; }
    sheetClones.set(el, rec);
    return true;
  }

  /* ---- dismissSheetLive：真面板自己滑出去（不克隆、不换骨架） ----------
     cloneNode 方案在手机上要先克隆整棵 #modal 再做首次绘制，慢机上这一下
     就是一帧都出不来 —— 用户看到的是白板 / 骨架卡在原地。让正在显示的真
     面板直接播同一条 sheetTop 下滑（WAAPI 合成器逐帧，零重绘），内容与
     关闭前逐像素一致。
     业务收尾全部推迟：onLand = 动画自然落地（摘 .show + 重绘 / toast）；
     onCancel = 动画被新的打开 / 更新的动画抢掉（.show 留给接管方，收尾
     回调照给，书架不落旧数据）。
     拖拽到一半松手也走这里：inline transform 的 dy 是加法合成（composite
     'add'）的基底，面板从手指松开的位置继续滑到屏幕外。 */
  function dismissSheetLive(el, options) {
    const opt = options || {};
    if (!el || el.hidden || reduced() || !SB || !hasWAAPI || !el.getClientRects().length) return false;
    /* 已经在关：不要重启，让这一场走完（回调也只挂一次） */
    if (el.classList.contains('sb-sheet-live')) return true;
    const old = sheetRuns.get(el);
    if (old) { try { old.cancel(); } catch (_) {} sheetRuns.delete(el); }
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) return false;
    const screenH = window.innerHeight, top = r.top;
    const progress = springProgress(SB.uikit.sheet, 36);
    const frames = progress.map(v => ({
      transform: `translate3d(0,${(SB.sheetTop(screenH, top, 1 - v) - top).toFixed(2)}px,0)`
    }));
    el.classList.add('sb-sheet-running', 'sb-sheet-driven', 'sb-sheet-live');
    el.style.pointerEvents = 'none';       // 下滑中的面板不再接事件，遮罩点击也不会二次触发
    let ended = false;
    /* 被接管（cancel 由别的动画发起）时只清自己的东西：sb-sheet-running /
       driven 是接管方（sheet() 上滑）的入场守卫，不能碰 */
    const cleanup = taken => {
      el.style.pointerEvents = '';
      el.style.transform = '';
      el.classList.remove('sb-sheet-live', 'ns-dragging', 'ns-closing', 'ns-snapback');
      if (!taken) el.classList.remove('sb-sheet-running', 'sb-sheet-driven');
    };
    const a = el.animate(frames, {
      duration: springDuration(SB.uikit.sheet), easing: 'linear',
      fill: 'both', composite: 'add'
    });
    a.onfinish = () => {
      if (ended) return;
      ended = true;
      if (sheetRuns.get(el) === a) sheetRuns.delete(el);
      cleanup(false);
      try { a.cancel(); } catch (_) {}     // fill 站位到这一帧为止，摘 .show 前不脱节
      if (typeof opt.onLand === 'function') opt.onLand();
    };
    a.oncancel = () => {
      if (ended) return;
      ended = true;
      /* oncancel 是异步事件：sheet() 已经把 sheetRuns 换成新动画 → taken */
      cleanup(sheetRuns.get(el) !== a);
      if (sheetRuns.get(el) === a) sheetRuns.delete(el);
      if (typeof opt.onCancel === 'function') opt.onCancel();
    };
    sheetRuns.set(el, a);
    return true;
  }

  /* ---- push：三种主页展示模式沿同一条水平线推移 ----
     旧视图整幅移出、新视图从反方向整幅移入：任意一帧两块画面首尾相接，
     不叠在同一块区域。方向由三模式的排列顺序决定 ——
     从左格切到右格：旧画面向左出、新画面从右进；反过来则完全镜像。 */
  let pushRun = null;
  let pendingPush = null;
  function captureView(el) {
    if (!el || el.hidden || !el.getClientRects().length) return null;
    const r = el.getBoundingClientRect();
    /* 11-22 性能二轮：旧画面也不 cloneNode 了。三种视图互切时 renderHome
       只把旧视图 hidden、从不动它的子树（重建的只会是目标视图），所以推移
       期间直接让真元素出文档流当旧画面（见 pushView），动画收尾 hidden 回去。
       省掉一次全视图克隆 + 一笔 canvas 逐个 drawImage + 克隆子树的排版与绘制
       —— 书多的书架上这正是切换主线程阻塞的大头。
       scroll 位置在 display:none 一圈后可能被浏览器重置，抓下来推移时补回。 */
    return { el, rect: r, scrollTop: el.scrollTop, scrollLeft: el.scrollLeft };
  }
  function stopPush() {
    const rec = pushRun;
    if (!rec) return;
    pushRun = null;
    try { rec.a && rec.a.cancel(); rec.b && rec.b.cancel(); } catch (_) {}
    if (rec.old) {
      /* 旧画面是真元素：摘掉推移期的内联定位与类，还原 renderHome 给的隐藏态 */
      rec.old.classList.remove('sb-push-outgoing');
      rec.old.style.cssText = rec.oldCss || '';
      rec.old.hidden = true;
    }
    if (rec.el) {
      rec.el.style.visibility = '';
      /* sb-push-running 挂在真视图上：WAAPI 已 cancel，类不摘会一直压着
         指针事件和 z-index。sb-push-hidden 是旧「克隆入场」方案的残留，顺手清。 */
      rec.el.classList.remove('sb-push-running');
      rec.el.classList.remove('sb-push-hidden');
    }
  }
  function pushView(snapshot, incoming, direction) {
    if (!snapshot || !incoming || incoming.hidden || reduced() || !SB || !hasWAAPI) {
      return false;
    }
    stopPush();
    /* 新旧两块画面同父层、同尺寸、同曲线反向平移，接缝恒在一条线上。
       11-22 性能二轮：旧画面同样用真元素（不再 cloneNode，见 captureView）——
       renderHome 刚把它 hidden，这里摘掉 hidden、原地转成 absolute 覆盖层，
       推移完 stopPush 再 hidden 回去。z-index:4 与旧克隆方案一致：
       新画面（.sb-push-running，z 5）永远压在上面。真元素还免掉了 canvas
       拷贝（画面里的 canvas 是活的），且不会出现两份重复 id。 */
    const old = snapshot.el;
    const r = incoming.getBoundingClientRect();
    if (!r.width || !r.height) return false;
    const width = Math.max(1, Math.round(snapshot.rect.width || r.width || window.innerWidth));
    const dir = direction < 0 ? -1 : 1;
    const spring = SB.uikit.navigation.spring;
    const progress = springProgress(spring, 42);
    const rec = { el: incoming, old, oldCss: old.style.cssText, a: null, b: null };
    pushRun = rec;
    old.hidden = false;
    old.scrollTop = snapshot.scrollTop || 0;
    old.scrollLeft = snapshot.scrollLeft || 0;
    old.style.cssText += ';position:absolute;inset:0;margin:0;z-index:4;pointer-events:none;' +
      'animation:none;transition:none;';
    old.classList.add('sb-push-outgoing');
    /* .sb-push-running 同时给真视图：抬到旧画面（z-index:4）之上、
       动画期间挡住指针事件；落地 / 中断由 stopPush 摘掉。 */
    incoming.classList.add('sb-push-running');
    /* shelf / spine 的 wrap 自带 fadeIn 入场（display:none → block 必重播）：
       推移开始前把它跳到末态，别让滑进来的画面半透明地叠在旧画面上。
       finish() 只是提前到末态、不摘 animation-name，落地后不会重播闪一下。
       旧画面同样会重播 fadeIn（刚从 hidden 里放出来），内联 animation:none 压住。 */
    try {
      incoming.getAnimations().forEach(a => {
        try { if (a.animationName === 'fadeIn') a.finish(); } catch (_) {}
      });
    } catch (_) {}
    const finish = () => { if (pushRun === rec) stopPush(); };
    /* 0 → 1 的同一条曲线喂给两块画面：
       old 从原位走到 ±屏宽，fresh 从 ∓屏宽走到原位。 */
    rec.a = play(incoming, progress.map(p => ({
      transform: `translate3d(${(-dir * width * (1 - p)).toFixed(2)}px,0,0)`
    })), springDuration(spring), finish);
    rec.b = play(old, progress.map(p => ({
      transform: `translate3d(${(dir * width * p).toFixed(2)}px,0,0)`
    })), springDuration(spring));
    if (!rec.a || !rec.b) { finish(); return false; }
    return true;
  }
  function dropPending() {
    const p = pendingPush;
    if (!p) return;
    pendingPush = null;
    if (p.timer) clearTimeout(p.timer);
    /* 快照只持引用不持副本（真元素方案），这里只剩计时器要清 */
  }
  function finishPending(visible, viewIndex) {
    const pending = pendingPush;
    if (!pending) return;
    pendingPush = null;
    if (pending.timer) clearTimeout(pending.timer);
    if (!pending.snap) return;
    const next = visible(), nextIndex = viewIndex(next);
    if (!next || nextIndex === pending.oldIndex || $('#reader').classList.contains('show')) {
      return;
    }
    /* 目标在左：旧画面右移出、新画面从左进（dir=1）；目标在右则镜像 */
    pushView(pending.snap, next, pending.oldIndex > nextIndex ? 1 : -1);
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
    const order = ['#shelfWrap', '#spineWrap', '#carouselWrap'];
    /* 推移进行中，被推出去的旧画面也是「未 hidden」的真元素，要排除掉 ——
       否则连切时它会被误当成当前视图抓去当快照（rect 还带着进行中的位移） */
    const visible = () => order.map($).find(el => el && !el.hidden &&
      !el.classList.contains('sb-push-outgoing')) || null;
    const viewIndex = el => order.indexOf(el && '#' + el.id);
    const viewFor = v => $(v === 'shelf' ? '#shelfWrap' : v === 'spine' ? '#spineWrap' : '#carouselWrap');

    /* setView 的 defer 分支把真正的内容构建推后两帧：快照要留到 renderHome
       换完视图再消费，否则抓到的是「旧画面 + 旧画面」，不会有推移。 */
    const rawRenderHome = window.renderHome;
    if (typeof rawRenderHome === 'function' && !rawRenderHome.__motionWrapped) {
      const wrappedRender = function () {
        const result = rawRenderHome.apply(this, arguments);
        if (arguments[0] && arguments[0].modeSwitch && pendingPush) {
          try { finishPending(visible, viewIndex); } catch (_) { dropPending(); }
        }
        return result;
      };
      wrappedRender.__motionWrapped = true;
      window.renderHome = wrappedRender;
    }

    const rawSetView = window.setView;
    if (typeof rawSetView === 'function' && !rawSetView.__motionWrapped) {
      const wrapped = function () {
        const old = visible(), target = viewFor(arguments[0]);
        if (!old || !target || old === target || $('#reader').classList.contains('show')) {
          return rawSetView.apply(this, arguments);
        }
        /* 连切时先收掉上一轮：旧副本和半途的动画都不能叠到新画面上 */
        stopPush(); dropPending();
        pendingPush = { snap: captureView(old), oldIndex: viewIndex(old), timer: 0 };
        const result = rawSetView.apply(this, arguments);
        if (arguments[1] && arguments[1].defer) {
          if (pendingPush) pendingPush.timer = setTimeout(dropPending, 1200);
        } else if (pendingPush) {
          finishPending(visible, viewIndex);
        }
        return result;
      };
      wrapped.__motionWrapped = true;
      window.setView = wrapped;
    }
    wrap('openEditor', null, function () {
      if (window.MHome && MHome.isMobile() && $('#mask').classList.contains('show')) sheet($('#modal'), true);
    });
    /* closeEditor 的移动端退场已由 editor.js 直接调 dismissSheet（带 onLand 落地回调），
       不再在这里包装 —— 之前靠 DOMContentLoaded 后 wrap，而 init 走 setTimeout(0)
       可能抢在 editor.js 定义 closeEditor 之前跑，wrap 会静默落空，退场动画时有时无。 */
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
  /* init 必须等全部 defer 脚本跑完（closeEditor / setView 等都定义完了）再接最外层。
     defer 执行阶段 readyState 已是 'interactive'，走 setTimeout(0) 会和后面
     defer 脚本的任务抢跑 —— 抢赢了就包不到函数（静默落空）。统一挂
     DOMContentLoaded：它一定在所有 defer 脚本之后触发。 */
  if (document.readyState === 'complete') setTimeout(init, 0);
  else document.addEventListener('DOMContentLoaded', init, { once: true });

  window.CarnetMotion = {
    load, haptic, rubberBand, decay, decayVelocity,
    lib: () => SB,
    sheet, dismissSheet, dismissSheetLive, cancelSheet,
    zoomFrames,
    morphOpen, morphClose,
    status: () => ({ ready: !!SB, reduced: reduced(), pushing: !!pushRun, morphing: !!morphRun })
  };
})();
