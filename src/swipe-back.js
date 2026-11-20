/* =====================================================================
 * Carnet · 移动端侧滑返回 / 系统返回   （脚本 29 / 31）
 * ---------------------------------------------------------------------
 * ① 返回统一走浏览器 history：进入每一层 pushState，侧滑提交与物理返回键
 *    都调用 history.back()，由 popstate 执行「关闭当前最上层」。
 * ② 跟手阶段只写 translate + 一层渐变阴影；底下的上一屏本来就在 DOM 里，
 *    不需要截图，也不会重绘画布书架。
 * ③ 松手过阈值先滑出屏幕，再交给 history.back()；没过阈值原路弹回。
 * ④ 根层压一条 guard 条目：在书架按物理返回不会把整个页面退走。
 * ⑤ 只在手机触屏的边缘右滑生效；竖向滚动、轮播、翻页、滑块都不受影响。
 *
 * 对外接口：window.CarnetSwipeBack = { consuming, canGoBack, backTarget, depth }
 *   closeReader() 会读 consuming，走无飞入动画的瞬时关闭分支
 * ===================================================================== */
(function () {
  'use strict';

  const app = document.getElementById('app');
  if (!app) return;

  /* ---------------- 可调参数 ---------------- */
  const EDGE = 28;          // 左边缘感应宽度（px）
  const SLOP = 10;          // 判定方向前允许的抖动
  const RATIO = .34;        // 松手位移超过屏宽这个比例 = 提交
  const V_MIN = .45;        // 快速轻扫的最低速度（px/ms）
  const V_DIST = 56;        // 快速轻扫至少要走这么远
  const DURATION = 230;     // 滑出 / 弹回时长（ms）
  const SWIPE_MQ = '(max-width:1024px)';
  const HKEY = 'carnetBack';

  const clampV = (v, a, b) => Math.max(a, Math.min(b, v));
  const $ = sel => document.querySelector(sel);
  const shown = el => !!el && !el.hidden
    && getComputedStyle(el).display !== 'none'
    && getComputedStyle(el).visibility !== 'hidden';

  /* ---------------- 阴影层：一次创建，常驻但默认透明 ---------------- */
  const shade = document.createElement('div');
  shade.id = 'swipeBackShade';
  shade.setAttribute('aria-hidden', 'true');
  app.appendChild(shade);

  /* ---------------- 当前可见层级（从最上层到根） ---------------- */
  function collectLayers() {
    const L = [];
    const add = (name, el, run) => { if (el && shown(el)) L.push({ name, el, run }); };
    const sh = sel => { const e = $(sel); return e && e.classList.contains('show') ? e : null; };
    const vi = sel => { const e = $(sel); return e && !e.hidden ? e : null; };

    /* 取色盘 / 加密 / 确认 / 复制：小窗优先，盖在页面之上 */
    add('color', sh('#cpMask'), () => { if (typeof closeColorPicker === 'function') closeColorPicker(); });
    add('lock', sh('#lockMask'), () => { if (typeof closeLockPanel === 'function') closeLockPanel(); });
    add('confirm', sh('#confirmMask'), () => { if (typeof closeConfirm === 'function') closeConfirm(); });
    add('copy', vi('#copyMask'), () => { if (typeof closeCopyPanel === 'function') closeCopyPanel(); });

    /* DIY 全屏页里的面板 → 先关面板，再关整页 */
    add('diySheet', vi('#diySheet'), () => {
      if (typeof diySheet === 'function') diySheet('');
      else { const d = $('#diySheet'); if (d) d.hidden = true; }
    });

    /* 阅读器里的四块底部面板 */
    const sheets = [
      ['text', '#tsheet', () => { if (typeof closeTextSheet === 'function') closeTextSheet(true); }],
      ['bg', '#bgsheet', () => { if (typeof closeBgSheet === 'function') closeBgSheet(); }],
      ['frame', '#frsheet', () => { if (typeof closeFrameSheet === 'function') closeFrameSheet(); }],
      ['sticker', '#stsheet', () => { if (typeof closeStickerSheet === 'function') closeStickerSheet(); }]
    ];
    sheets.forEach(([name, sel, run]) => add(name, vi(sel), run));

    add('diy', vi('#diyPage'), () => {
      const b = $('#diyBack');
      if (b) b.click();
      else if (typeof closeDiyCover === 'function') closeDiyCover();
    });

    /* 移动端分享 Bottom Sheet */
    add('export', sh('#mExpMenu'), () => {
      const exp = $('#mExpMenu'); if (exp) exp.classList.remove('show');
      const m = $('#mExpMask'); if (m) m.classList.remove('show');
    });

    /* 编辑器：移动端新建时第一步 ↔ 第二步，点原生返回钮那条逻辑最完整 */
    add('editor', sh('#mask'), () => {
      const b = $('#nsBack');
      if (b) b.click();
      else if (typeof closeEditor === 'function') closeEditor();
    });

    add('search', sh('#searchPanel'), () => { if (typeof toggleSearch === 'function') toggleSearch(false); });

    /* 全屏菜单 / 分享菜单 / 阅读器「+」菜单 */
    add('menu', sh('#homeMenu'), () => { if (typeof closeMenus === 'function') closeMenus(); });
    add('addMenu', sh('#addMenu'), () => {
      if (typeof closeAddMenu === 'function') closeAddMenu();
      else if (typeof closeMenus === 'function') closeMenus();
    });
    const anyMenu = $('.addmenu.show');
    if (anyMenu && shown(anyMenu)) add('menu', anyMenu, () => { if (typeof closeMenus === 'function') closeMenus(); });

    /* 旧版残留页（正常入口已停用，只为老缓存兜底） */
    add('import', vi('#importPanel'), () => { if (typeof closeImportPage === 'function') closeImportPage(); });
    add('settings', vi('#bgMask'), () => { if (typeof closeBgPanel === 'function') closeBgPanel(); });

    add('reader', sh('#reader'), () => { if (typeof closeReader === 'function') closeReader(); });

    /* 主页是根，但多选态相当于一个子页面 */
    if (typeof state !== 'undefined' && state.picking && typeof exitPickMode === 'function') {
      add('picking', $('#home'), () => exitPickMode());
    }
    return L;
  }

  function backTarget() { return collectLayers()[0] || null; }

  const SB = {
    consuming: false,
    depth: 0,
    canGoBack: () => !!backTarget(),
    backTarget: () => { const t = backTarget(); return t ? t.name : null; }
  };
  window.CarnetSwipeBack = SB;

  /* ---------------- history 层级栈 ---------------- */
  let histOk = false;
  let syncQueued = false;
  let restoring = false;
  let popGuardUntil = 0;

  function histState() {
    try { return (history.state && history.state[HKEY]) || null; }
    catch (_) { return null; }
  }

  function initHistory() {
    try {
      const s = Object.assign({}, history.state || {});
      s[HKEY] = { depth: 0, guard: true };
      history.replaceState(s, '');
      history.pushState(s, '');     // guard：主页这一格，防止物理返回退出页面
      SB.depth = 0;
      histOk = true;
    } catch (_) {
      /* file:// 等受限上下文：降级为「只关当前层」，不接管 history */
      histOk = false;
    }
  }

  /* DOM 变化后把 history 深度追上可见层数。
     只 push、不主动 go(-n)：用按钮关掉一层后 history 会暂时偏深，
     但下一次进入新层时 want 追平，popstate 永远只关「当前最上层」，语义不会错。 */
  function scheduleSync() {
    if (!histOk || syncQueued) return;
    syncQueued = true;
    requestAnimationFrame(() => {
      syncQueued = false;
      /* popstate 后关闭动画还在跑，DOM 上那一层暂时还在；
         这几百毫秒内别把「即将消失的层」重新 push 回历史。 */
      if (performance.now() < popGuardUntil) return;
      const want = collectLayers().length;
      while (SB.depth < want) {
        try {
          const s = Object.assign({}, history.state || {});
          s[HKEY] = { depth: SB.depth + 1 };
          history.pushState(s, '');
        } catch (_) { break; }
        SB.depth++;
      }
    });
  }

  window.addEventListener('popstate', () => {
    const s = histState();
    if (s && typeof s.depth === 'number') SB.depth = s.depth;
    popGuardUntil = performance.now() + 450;
    if (restoring) { restoring = false; return; }

    const t = backTarget();
    if (!t) {
      /* 已经回到主页：把浏览器刚退掉的那一格补回来，别把页面退走 */
      if (histOk) {
        restoring = true;
        try { history.forward(); } catch (_) { restoring = false; }
        setTimeout(() => { restoring = false; }, 500);
      }
      SB.consuming = false;
      return;
    }
    try { t.run(); }
    catch (err) { console.error('[swipe-back] 返回动作出错：', err); }
    SB.consuming = false;
  });

  /* 入口挂钩放在 DOMContentLoaded：m-home.js 会二次包装 openEditor，
     必须等它包完再套最外层，否则 push 会被覆盖掉。 */
  function hookEntries() {
    const names = [
      'openReader', 'openEditor', 'openDiyCover', 'openHomeMenu', 'enterPickMode',
      'openTextSheet', 'openBgSheet', 'openFrameSheet', 'openStickerSheet',
      'openLockPanel', 'openBgPanel', 'toggleSearch', 'diySheet', 'openImportPage'
    ];
    names.forEach(name => {
      const orig = window[name];
      if (typeof orig !== 'function' || orig.__carnetBackSync) return;
      const wrapped = function () {
        const r = orig.apply(this, arguments);
        setTimeout(scheduleSync, 0);
        return r;
      };
      wrapped.__carnetBackSync = true;
      window[name] = wrapped;
    });
  }

  /* 兜底：分享菜单、确认框、复制页等不是靠上面的函数打开的，
     只观察这些节点的 class / hidden 变化，不在全 DOM 上撒网。 */
  function observeLayers() {
    const ids = [
      'cpMask', 'lockMask', 'confirmMask', 'copyMask', 'diySheet', 'tsheet',
      'bgsheet', 'frsheet', 'stsheet', 'diyPage', 'mExpMenu', 'mask',
      'searchPanel', 'homeMenu', 'addMenu', 'importPanel', 'bgMask', 'reader', 'home'
    ];
    const mo = new MutationObserver(() => scheduleSync());
    ids.forEach(id => {
      const el = document.getElementById(id);
      if (el) mo.observe(el, { attributes: true, attributeFilter: ['class', 'hidden'] });
    });
  }

  /* ---------------- 手势状态 ---------------- */
  let st = null;
  let animating = false;
  let suppressClickUntil = 0;
  let touchEdge = null;

  const moveQueue = frameQueue(x => {
    if (!st || !st.el) return;
    st.el.style.translate = x + 'px 0';
    const w = Math.max(1, st.w);
    shade.style.opacity = String(clampV(x / (w * .5), 0, 1) * .55);
  });

  function baseEligible(x, y, target) {
    if (animating || st) return false;
    if (!window.matchMedia || !window.matchMedia(SWIPE_MQ).matches) return false;
    /* fly-zoom 在阅读器打开期间是常驻相位，不能拿它当「动画中」；
       真正的开合书飞行看 fly-lift 与 ghost 节点。 */
    if (app.classList.contains('fly-lift') || document.querySelector('.cover-ghost')) return false;
    if (!target || target.closest('#diyResizer, #mSwitch, input, textarea, [contenteditable="true"], [data-no-swipe-back]')) return false;
    if (typeof state !== 'undefined' && (state.imgDragging || state.imgResizing)) return false;
    if (typeof diy !== 'undefined' && diy && (diy.drag || diy.layerDrag)) return false;
    if (document.querySelector('.ns-dragging, .grab-dragging, #leaf.turning')) return false;
    const a = document.activeElement;
    if (a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.isContentEditable)) return false;
    const r = app.getBoundingClientRect();
    return x - r.left <= EDGE;
  }

  function onDown(e) {
    if (!e.isPrimary || e.pointerType !== 'touch') return;
    if (!baseEligible(e.clientX, e.clientY, e.target)) return;
    const r = app.getBoundingClientRect();
    if (e.clientX - r.left > EDGE) return;
    const target = backTarget();
    if (!target || !target.el) return;

    const el = target.el;
    st = {
      id: e.pointerId, el, target,
      x0: e.clientX, y0: e.clientY, x: 0,
      lastX: e.clientX, lastT: performance.now(), vx: 0,
      confirmed: false, movedAt: 0,
      w: Math.max(1, window.innerWidth || r.width),
      prevTranslate: el.style.translate,
      prevTransition: el.style.transition,
      prevZ: el.style.zIndex,
      prevWillChange: el.style.willChange
    };
    /* 只垫层级、不露阴影；竖向滑动会原样收掉，看不见任何变化 */
    el.style.transition = 'none';
    el.style.willChange = 'translate';
    el.style.zIndex = '1000';
    shade.style.opacity = '0';
  }

  function abort(s) {
    if (!s) return;
    s.el.style.translate = s.prevTranslate;
    s.el.style.transition = s.prevTransition;
    s.el.style.zIndex = s.prevZ;
    s.el.style.willChange = s.prevWillChange;
    shade.style.opacity = '0';
    shade.classList.remove('on');
  }

  function onMove(e) {
    if (!st || e.pointerId !== st.id) return;
    const s = st;
    const dx = e.clientX - s.x0;
    const dy = e.clientY - s.y0;

    if (!s.confirmed) {
      /* 竖向为主：不管了，交回页面原生滚动 */
      if (Math.abs(dy) > SLOP && Math.abs(dy) > Math.abs(dx)) { st = null; moveQueue.cancel(); abort(s); return; }
      if (dx <= SLOP || Math.abs(dx) <= Math.abs(dy)) return;
      /* 确认是右滑：从这里开始才吞事件，避免误伤按钮点击和其它手势 */
      s.confirmed = true;
      s.movedAt = performance.now();
      shade.classList.add('on');
      if (e.cancelable) e.preventDefault();
      e.stopPropagation();
    }

    const now = performance.now();
    const dt = Math.max(1, now - s.lastT);
    s.vx = .6 * s.vx + .4 * ((e.clientX - s.lastX) / dt);
    s.lastX = e.clientX; s.lastT = now; s.movedAt = now;
    s.x = clampV(dx, 0, s.w);
    moveQueue.push(s.x);
    if (e.cancelable) e.preventDefault();
    e.stopPropagation();
  }

  function settle(e, cancelled) {
    if (!st || e.pointerId !== st.id) return;
    const s = st;
    st = null;
    moveQueue.cancel();
    if (!s.confirmed) { abort(s); return; }

    /* 跟手那一帧一定要画出来，别在 pointerup 里丢掉最后几像素 */
    s.el.style.translate = s.x + 'px 0';
    shade.style.opacity = String(clampV(s.x / (s.w * .5), 0, 1) * .55);

    /* 抬手后浏览器还会补一个 click：吞掉一次真实点击，别误触返回钮/卡片 */
    suppressClickUntil = performance.now() + 420;

    const fresh = performance.now() - s.movedAt < 90;
    const fast = fresh && s.x >= V_DIST && s.vx > V_MIN;
    const commit = !cancelled && (s.x >= s.w * RATIO || fast);

    animating = true;
    s.el.style.transition = `translate ${DURATION}ms cubic-bezier(.22,.72,.22,1)`;
    shade.style.transition = `opacity ${DURATION}ms ease`;

    if (commit) {
      s.el.style.translate = s.w + 'px 0';
      shade.style.opacity = '1';
    } else {
      s.el.style.translate = '0px 0';
      shade.style.opacity = '0';
    }

    setTimeout(() => {
      if (commit) {
        /* 交给系统返回：popstate 里统一执行关闭。
           consuming 保持到 popstate 处理完，让 closeReader() 跳过飞入动画。 */
        SB.consuming = true;
        setTimeout(() => { SB.consuming = false; }, 900);   // popstate 没来时的兜底
        try {
          if (histOk && SB.depth > 0) history.back();
          else s.target.run();
        } catch (err) {
          console.error('[swipe-back] 返回动作出错：', err);
          SB.consuming = false;
        }
      }
      abort(s);
      s.el.style.transition = s.prevTransition;
      shade.style.transition = '';
      if (typeof markFlipSuppressed === 'function') markFlipSuppressed(540);
      animating = false;
    }, DURATION);
  }

  /* ---------------- 绑定：捕获阶段，先于业务手势拿到事件 ---------------- */
  document.addEventListener('pointerdown', onDown, true);
  document.addEventListener('pointermove', onMove, true);
  document.addEventListener('pointerup', e => settle(e, false), true);
  document.addEventListener('pointercancel', e => settle(e, true), true);

  /* 浏览器（含 iOS Safari / Chrome）的左边缘原生后退比 pointer 手势抢得早：
     第一帧 touchmove 就得拦，否则后面再 preventDefault 已经 cancelable=false 了。
     这里只挡「起点在边缘 + 第一下就是横向」的那一帧；竖向滚动照常放行。 */
  document.addEventListener('touchstart', e => {
    touchEdge = null;
    if (e.touches.length !== 1) return;
    const t = e.touches[0];
    if (!baseEligible(t.clientX, t.clientY, e.target)) return;
    if (!backTarget()) return;
    touchEdge = { x: t.clientX, y: t.clientY, blocked: false };
  }, { capture: true, passive: true });

  document.addEventListener('touchmove', e => {
    if (touchEdge && e.touches.length === 1) {
      const t = e.touches[0];
      const dx = t.clientX - touchEdge.x, dy = t.clientY - touchEdge.y;
      if (Math.abs(dy) > 8 && Math.abs(dy) > Math.abs(dx)) touchEdge = null;      // 竖向滚动：让开
      else if (dx > 4 && Math.abs(dx) > Math.abs(dy)) {                           // 横向：先拦住浏览器原生后退
        if (e.cancelable) e.preventDefault();
        e.stopPropagation();
        touchEdge.blocked = true;
      }
    }
    if (st && st.confirmed) {
      if (e.cancelable) e.preventDefault();
      e.stopPropagation();
    }
  }, { capture: true, passive: false });

  document.addEventListener('touchend', () => { touchEdge = null; }, true);
  document.addEventListener('touchcancel', () => { touchEdge = null; }, true);

  document.addEventListener('click', e => {
    if (e.isTrusted && performance.now() < suppressClickUntil) {
      e.preventDefault();
      e.stopPropagation();
      suppressClickUntil = 0;
    }
  }, true);

  /* ---------------- 启动 ---------------- */
  initHistory();
  observeLayers();
  if (document.readyState === 'complete') hookEntries();
  else document.addEventListener('DOMContentLoaded', hookEntries, { once: true });
})();
