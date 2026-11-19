/* =====================================================================
 * Carnet · 移动端主页 / 新建 Bottom Sheet / 菜单页   （脚本 30）
 * ---------------------------------------------------------------------
 * 依赖顺序：排在 main.js 之后、gl-lab.js 之前。这里只做「包装 + 绑定」，
 * 不复制任何业务实现 —— 装帧数据走 BOOK_STYLES，封面走 coverHTML，
 * 新建 / 编辑落盘走 editor.js，背景走 widgets.js / storage.js，
 * 导入走 io-photobook / io-import，导出走 io-share，多选走 home-view.js。
 *
 * ① 主页浮层：两态切换 / 分享 / 删除 / 菜单 / 新建 / 多选胶囊
 * ② 新建两步式 Bottom Sheet：选装帧 → 抬到 90% 填设置
 * ③ 菜单页：把设置与导入的全部功能收进一页卡片列表
 * ===================================================================== */
(function () {
  'use strict';

  const MQ = '(orientation:portrait) and (max-width:1024px)';
  /* ------------------------------------------------------------------
   * ⓪ 实验性「新视觉风格」（默认开，设置 → 实验性功能）
   *    开 = 手机竖屏用本文件 + m-home.css 那套独立主页 / Bottom Sheet / 整屏菜单；
   *    关 = 整体停用 m-home.css 的竖屏 @media、把桌面 @media 放开成 all，
   *        并让 isMobile() 恒为 false —— 两步 Sheet、轮播书名、浮层按钮等
   *        所有业务分支全部走电脑端那套原逻辑，移动端 UI 与电脑端一致。
   *    ⚠️ 状态只存 localStorage，不进 state.prefs、不跟 .json 导出走（同 GLLab）。
   *    ⚠️ index.html 的内联脚本会在首帧先切一次 CSS；这里保留同款兜底，
   *       HTML 被本地编辑器还原后功能依然在（只是首帧可能闪一下）。
   *    ⚠️ 不逐条盖 CSS：m-home.css 的竖屏规则有上百条，靠改写 CSSMediaRule
   *       的 mediaText 整段开关，桌面那条（④）同时放开，形态才真的一致。
   * ------------------------------------------------------------------ */
  const LS_MUI = 'carnet_mobile_ui_v1';
  let muiOn = true;
  try { muiOn = localStorage.getItem(LS_MUI) !== 'off'; } catch (_) {}
  const MQ_MOBILE = '(orientation:portrait) and (max-width:1024px)';
  const MQ_DESKTOP = '(min-width:1025px), (orientation:landscape)';
  function muiCss(on) {
    /* 自己也跑一遍：index.html 那段只负责首帧，且可能被还原；
       同一批 CSSMediaRule 会复用 __muiOrig，重复设置是幂等的。 */
    try {
      [...document.styleSheets].forEach(sh => {
        if (!String(sh.href || '').includes('m-home.css')) return;
        [...sh.cssRules].forEach(r => {
          if (r.type !== 4) return;                     // CSSMediaRule
          if (r.__muiOrig === undefined) r.__muiOrig = r.conditionText || '';
          const t = r.__muiOrig;
          if (t.includes('orientation: portrait') && t.includes('1024px'))
            r.media.mediaText = on ? MQ_MOBILE : 'not all';
          else if (t.includes('1025px'))
            r.media.mediaText = on ? MQ_DESKTOP : 'all';
        });
      });
    } catch (_) {}
  }
  muiCss(muiOn);
  document.documentElement.classList.toggle('mui-off', !muiOn);

  const isMobile = () => muiOn && !!(window.matchMedia && window.matchMedia(MQ).matches);
  window.MHome = { isMobile };
  window.MobileUI = {
    get on() { return muiOn; },
    status: () => ({ on: muiOn, mobile: !!(window.matchMedia && window.matchMedia(MQ).matches) }),
    set(on) {
      const v = !!on;
      if (v === muiOn) return true;
      muiOn = v;
      try { localStorage.setItem(LS_MUI, v ? 'on' : 'off'); } catch (_) {}
      document.documentElement.classList.toggle('mui-off', !v);
      muiCss(v);
      /* 两套 UI 的 DOM 与事件绑定一直都在，只是显示形态变了：重绘一次主页，
         让桌面顶栏 / 三态切换 / 轮播间距立刻回到正确状态。 */
      try { if (typeof renderHome === 'function') renderHome(); } catch (_) {}
      try { if (typeof syncViewToggle === 'function') syncViewToggle(); } catch (_) {}
      mSync();
      return true;
    }
  };

  /* ------------------------------------------------------------------
   * ① 主页浮层
   * ------------------------------------------------------------------ */
  /* 让 #home 的 class 始终跟上真实状态：
     m-shelf   = 多层书架（决定顶部要不要「我的书架」）
     m-picking  = 多选模式（决定四个常驻按钮 / 多选胶囊谁露面）
     ⚠️ 用包装而不是轮询：renderHome / setView / enterPickMode / exitPickMode
        是这四个状态的唯一写入口，包一层后不用碰 home-view.js 里的实现。 */
  function mSync() {
    const home = $('#home');
    if (!home) return;
    const v = state.prefs.view;
    home.classList.toggle('m-shelf', v === 'shelf' || v === 'spine');
    home.classList.toggle('m-carousel', v === 'carousel');
    home.classList.toggle('m-picking', !!state.picking);
    mSyncMeta();
    const sw = $('#mSwitch');
    if (sw) {
      /* 三格直接跟真实 view 对齐（含 spine），不再把单层书架并进多层那一格 */
      sw.dataset.v = v;
      $$('#mSwitch button[data-mv]').forEach(b =>
        b.classList.toggle('on', b.dataset.mv === sw.dataset.v));
    }
    const n = typeof pickedList === 'function' ? pickedList().length : 0;
    /* ⚠️ 别给这两颗按钮上 disabled：参考图里垃圾桶与完成都是常亮的黑字黑图标，
       没勾书时点一下由原有逻辑 toast 提示即可（#pickDelete / 分享菜单各自会拦）。 */
    const cnt = $('#mPickCount');
    if (cnt) cnt.textContent = n ? `已选 ${n} 本` : '选择手帐本';
  }
  /* 轮播模式：书名 / 页数 / 点状进度条钉在封面下方。
     ⚠️ carousel.js 的 snap() 直接写 #homeName / #homePages / #countPill，不走 syncHomeHead，
        所以用 MutationObserver 盯这几个节点，滑动换本时才跟得上；回调合帧，别一帧重画几次。 */
  let mcLastFrom = -1, mcRollRaf = 0;
  function mSyncMeta() {
    /* 11-20：轮播信息区现在「只认开关、不认视口」—— 电脑端（isMobile() 为 false）
       只要新视觉风格开着，也要更新封面下方的书名 / 页数 / 分页点。
       ⚠️ 别改回 !isMobile() return，否则电脑端会一直显示 HTML 里的「— / 0 页」占位。 */
    if (!muiOn) return;
    const name = $('#mcName'), meta = $('#mcMeta'), dots = $('#mcDots');
    if (!name || !meta || !dots) return;
    const j = cur();
    name.textContent = j ? j.name : '还没有手帐本';
    name.classList.toggle('en', typeof homeNameIsEn === 'function' && homeNameIsEn(j && j.name));
    meta.textContent = j ? `${j.pages.length} 页` : '点右下角 ＋ 新建';
    /* 分页点与「选择装帧」的 .ns-dots 同款：圆点 7px、激活点是 22px 黑色长条。
       ⚠️ 5 格窗口，每翻一本只把窗口往前推 **1 格**（绝不整窗跳 5 格 ——
          那样第 6 本的长条会一下退回第 1 格，用户明确否决）。
          黑条位置 = sel - from：
            · 前 4 本依次落在第 1~4 格（第 4 本必须是第 4 个点）；
            · 之后黑条停在倒数第二格，最后一格留给「右边还有更多」的小点；
            · 滑到末尾窗口触顶，黑条自然走到最后一格收尾，全程不回头。
          于是每翻一本：下一个点接力变黑条、左边少一个普通点（左端缩成小点）、
          右边补一个小点，正是参考图那种滚动式 page control。
       ⚠️ 也不要退回「以当前本居中」的 sel-2：那会让第 4 本落到第 3 点、长条永远不动。
       ⚠️ 哪一侧还有没显示出来的书，就把那一侧最边上的点缩成 4px 小圆点（.mini）；
          激活点优先，永远是长条，不会被缩小。
       ⚠️ 节点只在「点数变了」时重建，之后只 toggle class：
          每次 innerHTML 重排成新节点的话 width 的 transition 根本没有起始帧，
          圆点 → 长条的动画就永远不会播（选择装帧那套 nsPickAt 就是这么做的）。 */
    const n = state.journals.length, WIN = 5;
    const shown = Math.min(n, WIN);
    const from = n > WIN ? clamp(state.sel - (WIN - 2), 0, n - WIN) : 0;
    const leftMore = from > 0, rightMore = from + WIN < n;
    /* 窗口推进一格时，整排点做一次「向左滑入」的过场：
       新内容从右一格滑进来，左端那颗淡出、右端小点淡入，黑条在过场里接力到下一格。
       ⚠️ 用 rAF 跨帧重启动画，不读 offsetWidth —— 轮播期间一次布局都别碰。 */
    if (mcLastFrom >= 0 && from !== mcLastFrom) {
      dots.classList.remove('mc-roll');
      cancelAnimationFrame(mcRollRaf);
      mcRollRaf = requestAnimationFrame(() => {
        if (dots.isConnected) dots.classList.add('mc-roll');
      });
    }
    mcLastFrom = from;
    const key = String(shown);
    if (dots.dataset.key !== key) {
      dots.innerHTML = '<i></i>'.repeat(shown);
      /* 槽位数跟着点数走，但每个槽位恒为 14px：
         点数变少时整排仍是固定宽度、居中不动，不会因 black bar 伸缩而晃。 */
      dots.style.gridTemplateColumns = `repeat(${shown},14px)`;
      dots.dataset.key = key;
    }
    const els = dots.children;
    for (let k = 0; k < shown; k++) {
      const on = from + k === state.sel;
      const mini = !on && ((k === 0 && leftMore) || (k === shown - 1 && rightMore));
      els[k].classList.toggle('on', on);
      els[k].classList.toggle('mini', mini);
    }
  }
  (function watchMeta() {
    const targets = [$('.home-head'), $('#countPill')].filter(Boolean);
    if (!targets.length || typeof MutationObserver === 'undefined') return;
    let raf = 0;
    const ob = new MutationObserver(() => {
      if (raf) return;
      raf = requestAnimationFrame(() => { raf = 0; mSyncMeta(); });
    });
    targets.forEach(t => ob.observe(t, { subtree: true, childList: true, characterData: true }));
  })();

  ['renderHome', 'setView', 'enterPickMode', 'exitPickMode', 'togglePick'].forEach(name => {
    const orig = window[name];
    if (typeof orig !== 'function') return;
    window[name] = function () {
      const r = orig.apply(this, arguments);
      mSync();
      return r;
    };
  });
  /* 初始同步：main.js 已经 renderHome 过，这里补一次 class */
  mSync();

  /* 左下三格：多层书架 / 单层书架 / 左右滑动。
     短按 = 点哪格切哪格；按住 260ms = 圆钮涨成一枚液态玻璃透镜（球面折射 +
     边缘色散），可左右拖，松手吸附到最近那格并缩回。
     ⚠️ 拖动期间绝不调 setView() / renderHome()：会整块重绘书架 / 轮播，
        触摸手势锁死的目标节点被换掉，同一根手指再也拖不动（长按排序同一条红线）。
        每帧只写 --ms-x / --ms-spin 两个 CSS 变量 + 按钮高亮预览，零布局读写；
        切视图只在松手那一下发生。 */
  (function bindSwitch() {
    const sw = $('#mSwitch'), thumb = sw && sw.querySelector('.ms-thumb');
    if (!sw || !thumb) return;
    /* ⚠️ 折射视窗由这里自愈创建，绝不依赖 index.html 里那颗 <span>：
       本地编辑器 / 浏览器缓存把 HTML 还原成旧版时没有 .ms-lens-view，
       早先「找不到就 return」会让整块手势失效（用户报「点击没反应」）。
       现在只要 sw / thumb 在，手势一定绑得上，折射层自动补出来。 */
    let lens = sw.querySelector('.ms-lens-view');
    if (!lens) {
      lens = document.createElement('span');
      lens.className = 'ms-lens-view';
      lens.setAttribute('aria-hidden', 'true');
      sw.appendChild(lens);
    }
    const VIEWS = ['shelf', 'spine', 'carousel'], STEP = 48, HOLD = 150;
    /* 11-19：胶囊按 --ms-zoom 做了整体视觉缩放，内部几何（STEP / 46px 圆钮 /
       液态玻璃 / WebGL 纹理）一律不变，只有 pointer 的 clientX 是缩放后的屏幕像素。
       初始化时读一次 zoom（绝不在拖动中读样式），把手势换回控件坐标系，
       否则点第三格会被算成第二格、拖动也会比手指慢一截。 */
    const ZOOM = parseFloat(getComputedStyle(sw).getPropertyValue('--ms-zoom')) || 1;
    const btns = [...sw.querySelectorAll('button[data-mv]')];
    /* 折射副本直接 clone 真实图标：以后改图标不用再维护第二份 SVG。
       两层 = 主折射（橙 / 蓝色散彩边）+ 更远更淡的球面拉伸重影。 */
    const ghosts = [];
    function addSnap(cls) {
      const s = document.createElement('span');
      s.className = 'ms-snap ' + cls;
      const row = btns.map((b, i) => {
        const g = document.createElement('span');
        g.className = 'ms-g';
        g.style.left = (5 + i * STEP) + 'px';
        const svg = b.querySelector('svg');
        if (svg) g.appendChild(svg.cloneNode(true));
        s.appendChild(g);
        return g;
      });
      lens.appendChild(s);
      ghosts.push(row);
    }
    addSnap('ms-snap-a');
    addSnap('ms-snap-b');

    /* WebGL 液态玻璃（src/liquid-glass.js）：动态加载，不写进 index.html 的
       脚本顺序 —— 那个文件会被本地编辑器还原。加载失败 / 无 WebGL 时
       ok=false，下面的 CSS 玻璃照常生效，交互一行都不用改。 */
    (function loadGL() {
      if (window.LiquidGlass) {
        try { window.LiquidGlass.attach(sw); } catch (_) {}
        return;
      }
      const s = document.createElement('script');
      s.src = 'src/liquid-glass.js';
      s.async = true;
      s.onload = () => {
        try { window.LiquidGlass && window.LiquidGlass.attach(sw); } catch (_) {}
      };
      s.onerror = () => {};
      document.head.appendChild(s);
    })();

    let st = null, holdT = 0;
    const posOf = v => Math.max(0, VIEWS.indexOf(v)) * STEP;
    function setX(p) { sw.style.setProperty('--ms-x', p.toFixed(1) + 'px'); }
    function setSpin(p) {
      /* 6° 量化：conic-gradient 每变一次就得重画整圈，别每帧都写 */
      const d = Math.round(p / 6) * 6 + 200;
      if (sw._spin === d) return;
      sw._spin = d;
      sw.style.setProperty('--ms-spin', d + 'deg');
    }
    function preview(p) {
      const near = clamp(Math.round(p / STEP), 0, VIEWS.length - 1);
      btns.forEach((b, i) => b.classList.toggle('on', i === near));
      ghosts.forEach(row => row.forEach((g, i) => g.classList.toggle('on', i === near)));
    }
    function release() {
      const LG = window.LiquidGlass;
      if (LG && sw.classList.contains('gl-on')) {
        LG.setActive(false);
        sw.classList.remove('gl-on');
      }
      sw.classList.remove('liquid', 'dragging');
      sw.style.removeProperty('--ms-x');
      sw.style.removeProperty('--ms-spin');
      sw._spin = null;
    }
    function liquidOn() {
      if (!st) return;
      st.liquid = true;
      sw.classList.add('liquid');
      const LG = window.LiquidGlass;
      if (LG && LG.ok && LG.setActive(true, st.base, false)) {
        sw.classList.add('gl-on');   // 由 shader 画玻璃，CSS 那层退到只剩阴影
        st.gl = true;
      }
      try { navigator.vibrate && navigator.vibrate(8); } catch (_) {}
    }
    /* pointer 手势正常收尾时，只吞掉紧随其后的那一次 click。
       ⚠️ 别用「500ms 内一律忽略」：某些浏览器 / 触摸场景 pointerup 没派到
          sw 上，click 又被时间窗吞掉，就成了用户报的「点击没反应」。
          反过来若 pointerup 真丢了，这里没置标记，click 兜底会照常切视图。 */
    function swallowClick() {
      sw._swallowClick = true;
      clearTimeout(sw._swallowT);
      sw._swallowT = setTimeout(() => { sw._swallowClick = false; }, 400);
    }
    sw.addEventListener('pointerdown', e => {
      if (e.button !== undefined && e.button !== 0) return;
      clearTimeout(holdT);
      const r = sw.getBoundingClientRect();
      const base = posOf(state.prefs.view);
      st = {
        id: e.pointerId, x: e.clientX, left: r.left,
        base, pos: base, moved: false, liquid: false, cancelled: false,
        /* 点击按落点算格子（46px 按钮 + 2px gap = 48px 一档），不依赖 target */
        clickIdx: clamp(Math.floor(((e.clientX - r.left) / ZOOM - 5) / STEP), 0, VIEWS.length - 1)
      };
      const pid = e.pointerId;
      holdT = setTimeout(() => {
        if (!st || st.id !== pid || st.cancelled) return;
        liquidOn();
      }, HOLD);
      try { sw.setPointerCapture(e.pointerId); } catch (_) {}
    });
    sw.addEventListener('pointermove', e => {
      if (!st || e.pointerId !== st.id) return;
      const dx = (e.clientX - st.x) / ZOOM;
      if (!st.liquid) {
        /* 长按还没到就甩出去 = 普通点按 / 快速滑动，别把液态态误触发 */
        if (!st.moved && Math.abs(dx) > 10) {
          st.moved = true; st.cancelled = true; clearTimeout(holdT);
        }
        return;
      }
      if (!st.moved) { st.moved = true; sw.classList.add('dragging'); }
      const raw = st.base + dx;
      /* 两端橡皮筋：拖过头只跟 0.25 倍，松手靠目标格吸附弹回 */
      st.pos = raw < 0 ? raw * .25
        : raw > STEP * 2 ? STEP * 2 + (raw - STEP * 2) * .25 : raw;
      setX(st.pos); setSpin(st.pos); preview(st.pos);
      if (st.gl && window.LiquidGlass) window.LiquidGlass.frame(st.pos, true);
    }, { passive: true });
    const end = e => {
      if (!st || (e.pointerId !== undefined && e.pointerId !== st.id)) return;
      const s = st; st = null;
      clearTimeout(holdT);
      swallowClick();
      try { sw.releasePointerCapture(e.pointerId); } catch (_) {}
      /* 只有真正拖动过才按位置算；长按后原地松手（或普通短按）都按落点算，
         否则「按久了一点又没拖」会变成点了没反应。 */
      const idx = s.liquid && s.moved
        ? clamp(Math.round(s.pos / STEP), 0, VIEWS.length - 1)
        : !s.liquid && s.moved
          ? clamp(Math.floor(((e.clientX - s.left) / ZOOM - 5) / STEP), 0, VIEWS.length - 1)
          : s.clickIdx;
      /* 先清 inline 变量交回 CSS，再切视图：data-v 带着 .3s 缓动把玻璃珠
         吸附到目标格，同时 scale 收回 46px 圆钮，不会瞬移。 */
      release();
      const target = VIEWS[idx];
      if (target !== state.prefs.view) setView(target); else mSync();
    };
    sw.addEventListener('pointerup', end);
    sw.addEventListener('pointercancel', end);
    /* 键盘 / 辅助技术、或 pointerup 没派到 sw 时，都靠这一条兜底切视图 */
    sw.addEventListener('click', e => {
      if (sw._swallowClick) { sw._swallowClick = false; return; }
      const b = e.target.closest('button[data-mv]');
      if (b) setView(b.dataset.mv);
    });
  })();

  /* 右上搜索：短按开搜索，长按直接进多选（主页常态不显示分享 / 删除）。
     ⚠️ 长按后那一下 click 必须吞掉，否则会紧跟一个搜索面板盖在多选上。 */
  const searchBtn = $('#mSearch');
  if (searchBtn) {
    let holdT = 0, longFired = false, sy = 0;
    searchBtn.addEventListener('pointerdown', e => {
      longFired = false; sy = e.clientY;
      clearTimeout(holdT);
      holdT = setTimeout(() => {
        longFired = true;
        enterPickMode('del');
        setTimeout(() => { longFired = false; }, 420);
      }, 420);
    });
    ['pointerup', 'pointercancel'].forEach(t =>
      searchBtn.addEventListener(t, () => clearTimeout(holdT)));
    searchBtn.addEventListener('pointermove', e => {
      /* 手指一挪就当普通点击，别在滑动误触里进多选 */
      if (holdT && Math.abs(e.clientY - sy) > 10) clearTimeout(holdT);
    }, { passive: true });
    searchBtn.addEventListener('click', e => {
      if (longFired) { e.preventDefault(); e.stopPropagation(); return; }
      toggleSearch(true);
    });
  }

  /* 多选胶囊：分享 / 删除 / 完成。
     删除直接触发旧 #pickDelete 的 click —— 连带确认弹窗、清密钥、落盘全复用 */
  const pd = $('#mPickDel');
  if (pd) pd.addEventListener('click', () => {
    const b = $('#pickDelete');
    if (b) b.click();
  });
  const done = $('#mPickDone');
  if (done) done.addEventListener('click', () => exitPickMode());
  const ps = $('#mPickShare');
  if (ps) ps.addEventListener('click', () => {
    if (!pickedList().length) { toast('先勾选手帐本再分享'); return; }
    mExpOpen(true);
  });
  function mExpOpen(open) {
    const m = $('#mExpMenu'), mask = $('#mExpMask');
    if (m) m.classList.toggle('show', open);
    if (mask) mask.classList.toggle('show', open);
  }
  const expMask = $('#mExpMask');
  if (expMask) expMask.addEventListener('click', () => mExpOpen(false));
  const expCancel = $('#mExpCancel');
  if (expCancel) expCancel.addEventListener('click', () => mExpOpen(false));
  $$('#mExpMenu button[data-expkind]').forEach(b => {
    b.addEventListener('click', async () => {
      const kind = b.dataset.expkind;
      mExpOpen(false);
      await exportPicked(kind);
    });
  });

  /* ------------------------------------------------------------------
   * ② 新建 / 编辑：两步式 Bottom Sheet
   * ------------------------------------------------------------------ */
  /* 第一步：大卡片横滑选装帧（照参考图），当前居中那张的名字写在标题下方、底下分页点。
     预览用真正的封面 coverHTML，选到哪档看到的就是成品。 */
  function nsPickAt(i) {
    const k = clamp(i, 0, BOOK_STYLES.length - 1);
    const sub = $('#edPickSub');
    if (sub) sub.textContent = BOOK_STYLES[k].n;
    $$('#edPickDots i').forEach((d, n) => d.classList.toggle('on', n === k));
    $$('#edPickCards .ns-card').forEach((c, n) => c.classList.toggle('on', n === k));
  }
  function nsRenderPick() {
    const box = $('#edPickCards');
    if (!box || !ed.temp) return;
    box.innerHTML = BOOK_STYLES.map(s => `
      <button class="ns-card" data-ns-style="${s.k}">
        <span class="ns-pv">${coverHTML({ ...ed.temp, style: s.k })}</span>
        <b>${s.n}</b><small>${s.d}</small>
      </button>`).join('');
    const dots = $('#edPickDots');
    if (dots) dots.innerHTML = BOOK_STYLES.map(() => '<i></i>').join('');
    const curIdx = Math.max(0, BOOK_STYLES.findIndex(s => s.k === normBookStyle(ed.temp.style)));
    nsPickAt(curIdx);
    /* 把当前装帧滚到正中：容器左右有 padding，offsetLeft 已经把它算进去 */
    const card = box.querySelectorAll('.ns-card')[curIdx];
    if (card) box.scrollLeft = card.offsetLeft - (box.clientWidth - card.clientWidth) / 2;
    if (!box.dataset.bound) {
      box.dataset.bound = '1';
      let raf = 0;
      box.addEventListener('scroll', () => {
        if (raf) return;
        raf = requestAnimationFrame(() => {
          raf = 0;
          const cards = [...box.querySelectorAll('.ns-card')];
          if (!cards.length) return;
          const cr = box.getBoundingClientRect();
          const cx = cr.left + cr.width / 2;
          let best = 0, bd = Infinity;
          cards.forEach((c, i) => {
            const r = c.getBoundingClientRect();
            const d = Math.abs(r.left + r.width / 2 - cx);
            if (d < bd) { bd = d; best = i; }
          });
          nsPickAt(best);
        });
      }, { passive: true });
    }
  }
  const origOpenEditor = window.openEditor;
  window.openEditor = function (journal) {
    const mask = $('#mask');
    /* 新建时先把高度档位落到 46%，再让 origOpenEditor 加 .show ——
       否则打开那一帧会先按 90% 撑开再收下来，看得见一次跳动 */
    if (isMobile() && mask && !journal) mask.classList.add('ns-setup', 'ns-pick');
    origOpenEditor(journal);
    if (!mask) return;
    if (!isMobile()) {
      mask.classList.remove('ns-pick', 'ns-setup');
      /* 桌面端新建 / 编辑都要显示左上返回按钮，把移动端留下的 inline display 清掉 */
      const b = $('#nsBack'); if (b) b.style.display = '';
      return;
    }
    /* 编辑已有本：直接给 90% 的设置页；新建：先落在 46% 的选样式页 */
    mask.classList.add('ns-setup');
    ed.fold = {};                         // 移动端是连续清单，不吃桌面那套折叠状态
    if (!journal) {
      nsRenderPick();
      mask.classList.add('ns-pick');
    } else {
      mask.classList.remove('ns-pick');
    }
    const back = $('#nsBack');
    if (back) back.style.display = journal ? 'none' : '';
    syncEditor();
    $('#modal').scrollTop = 0;
  };
  /* 右下黑色 ＋：走同一个 openEditor(null)，包装里会自动落到第一步 */
  const addBtn = $('#mAdd');
  if (addBtn) addBtn.addEventListener('click', () => openEditor(null));

  const cards = $('#edPickCards');
  if (cards) cards.addEventListener('click', e => {
    const c = e.target.closest('[data-ns-style]');
    if (!c) return;
    ed.temp.style = normBookStyle(c.dataset.nsStyle);
    $$('#edPickCards .ns-card').forEach(n => n.classList.toggle('on', n === c));
    const mask = $('#mask');
    mask.classList.remove('ns-pick');     // 同一个盒子从 46% 抬到 90%
    mask.classList.add('ns-setup');
    ed.fold = {};
    syncEditor();
    $('#modal').scrollTop = 0;
  });
  const nsBack = $('#nsBack');
  if (nsBack) nsBack.addEventListener('click', () => {
    const mask = $('#mask');
    /* 桌面端没有第一步：点返回 = 取消，跟「取消」按钮一样关掉整个弹窗。
       移动端编辑已有本同理；只有移动端新建才退回选装帧那一步。 */
    if (!isMobile() || !ed.isNew || !mask) { nsCleanup(); closeEditor(); return; }
    nsRenderPick();
    mask.classList.add('ns-pick');
    $('#modal').scrollTop = 0;
  });
  /* 关掉 sheet 时把两步状态 / 拖拽残留收干净，下次打开从第一步重新来 */
  const maskEl = $('#mask');
  function nsCleanup() {
    const modal = $('#modal');
    if (modal) {
      modal.classList.remove('ns-dragging', 'ns-closing', 'ns-snapback');
      modal.style.transform = '';
    }
    if (maskEl) maskEl.classList.remove('ns-pick');
  }
  if (maskEl) maskEl.addEventListener('click', e => {
    if (e.target === maskEl) setTimeout(nsCleanup, 0);
  });
  const edCancel = $('#edCancel');
  if (edCancel) edCancel.addEventListener('click', nsCleanup);
  /* 编辑已有本时没有第一步，「返回」就是关掉 sheet，顺手清掉状态 */
  const backBtn2 = $('#nsBack');
  if (backBtn2) backBtn2.addEventListener('click', () => { if (!ed.isNew) nsCleanup(); });

  /* ---- 顶部拖动条：往下拖就关掉整个 Bottom Sheet ----
     全程只读 pointer 的 clientY 差值，不碰任何布局量（不触发重排）。
     没拖过阈值就弹回原位；过阈值补一段下滑过渡再交给 closeEditor()。 */
  (function dragGrabClose() {
    const grab = document.querySelector('.ns-grab');
    const modal = $('#modal');
    if (!grab || !modal) return;
    let st = null;
    grab.addEventListener('pointerdown', e => {
      if (!isMobile() || !$('#mask').classList.contains('show')) return;
      st = { id: e.pointerId, y: e.clientY, dy: 0 };
      try { grab.setPointerCapture(e.pointerId); } catch (_) {}
      modal.classList.add('ns-dragging');
      e.preventDefault();
    });
    grab.addEventListener('pointermove', e => {
      if (!st || e.pointerId !== st.id) return;
      st.dy = Math.max(0, e.clientY - st.y);
      modal.style.transform = 'translateY(' + st.dy.toFixed(1) + 'px)';
      e.preventDefault();
    }, { passive: false });
    const finish = e => {
      if (!st || (e.pointerId !== undefined && e.pointerId !== st.id)) return;
      const dy = st.dy; st = null;
      try { grab.releasePointerCapture(e.pointerId); } catch (_) {}
      modal.classList.remove('ns-dragging');
      if (dy < 90) {                       // 没拖够：带一点缓动弹回原位
        modal.classList.add('ns-snapback');
        modal.style.transform = '';
        setTimeout(() => modal.classList.remove('ns-snapback'), 220);
        return;
      }
      modal.classList.add('ns-closing');
      modal.style.transform = 'translateY(100%)';
      setTimeout(() => { nsCleanup(); closeEditor(); }, 230);
    };
    grab.addEventListener('pointerup', finish);
    grab.addEventListener('pointercancel', finish);
  })();

  /* ------------------------------------------------------------------
   * ③ 菜单页：设置 + 导入 + 帮助，全部功能收进一页
   * ------------------------------------------------------------------ */
  const MN_BG_PRESETS = (typeof BG_PRESETS !== 'undefined') ? BG_PRESETS :
    ['#5b6182', '#445070', '#3a4358', '#232840', '#6e5a66', '#7a5c49', '#4f6b5d', '#3d5a66', '#8a8fa8', '#b8a98f'];
  function bgNow() { return state.prefs.bg || { mode: 'default', value: '', img: null }; }

  /* 横滑色板在桌面（鼠标）下原本完全滑不动：滚动条被 ::-webkit-scrollbar 藏了，
     又没有触屏那套原生手势。补一条纯鼠标拖拽 —— 按住色板左右拖 = 横滑。
     ⚠️ 只接管 mouse：touch / pen 交给浏览器原生 overflow-x:auto，
        别用 setPointerCapture 把触摸手势抢过来（滚动会整个失效）。
        拖过 4px 才算拖拽，并在 capture 阶段吞掉松手那一下 click，
        否则拖完会顺手把颜色点掉。纵向滚轮不劫持，菜单页还要能上下滚。 */
  function bindHDrag(box) {
    if (!box || box.dataset.hdrag) return;
    box.dataset.hdrag = '1';
    let st = null, swallow = false, swallowT = 0;
    box.addEventListener('pointerdown', e => {
      if (e.pointerType !== 'mouse' || e.button !== 0) return;
      st = { id: e.pointerId, x: e.clientX, left: box.scrollLeft, moved: false };
      try { box.setPointerCapture(e.pointerId); } catch (_) {}
    });
    box.addEventListener('pointermove', e => {
      if (!st || e.pointerId !== st.id) return;
      const dx = e.clientX - st.x;
      if (!st.moved && Math.abs(dx) > 4) { st.moved = true; box.classList.add('h-drag'); }
      if (st.moved) box.scrollLeft = st.left - dx;
    });
    const end = e => {
      if (!st || (e.pointerId !== undefined && e.pointerId !== st.id)) return;
      if (st.moved) {
        swallow = true;
        clearTimeout(swallowT);
        swallowT = setTimeout(() => { swallow = false; }, 160);
      }
      st = null;
      box.classList.remove('h-drag');
      try { box.releasePointerCapture(e.pointerId); } catch (_) {}
    };
    box.addEventListener('pointerup', end);
    box.addEventListener('pointercancel', end);
    /* 色块自己的 click 绑在子元素上，必须在 capture 阶段掐掉 */
    box.addEventListener('click', e => {
      if (!swallow) return;
      swallow = false; clearTimeout(swallowT);
      e.preventDefault(); e.stopPropagation();
    }, true);
  }
  /* 菜单页背景预置色 + 取色器常用色：两个横滑容器共用同一套手势 */
  bindHDrag($('#mnBgColors'));
  bindHDrag($('#cpSwatches'));

  /* 「新视觉风格」开关：index.html 被本地编辑器还原时这一行可能不在，
     和 .ms-lens-view 一样做自愈补建，保证实验性功能里永远有这个入口。 */
  function ensureMuiSwitch() {
    let card = null;
    [...document.querySelectorAll('#homeMenu .mn-cap')].some(n => {
      if (n.textContent.trim() !== '实验性功能') return false;
      card = n.nextElementSibling; return true;
    });
    if (!card || !card.classList.contains('mn-card')) return !!$('#mnMui');
    if (!$('#mnMui')) {
      const row = document.createElement('label');
      row.className = 'mn-row';
      row.innerHTML = '<b>新视觉风格</b><span class="mn-switch" id="mnMuiSwitch"><input type="checkbox" id="mnMui" aria-label="新视觉风格"></span>';
      card.insertBefore(row, card.firstChild);
    }
    if (!$('#mnPwa')) {
      const row = document.createElement('label');
      row.className = 'mn-row';
      row.innerHTML = '<b>PWA 离线应用</b><span class="mn-switch" id="mnPwaSwitch"><input type="checkbox" id="mnPwa" aria-label="PWA 离线应用"></span>';
      card.appendChild(row);
    }
    /* ⚠️ <p class="mn-note"> 这几行最容易被本地编辑器整行还原掉，
       连 WebGL / PWA 原来的说明一起补回来。都插到同一个 anchor 前 = 数组顺序即显示顺序，
       必须 MUI → GL → PWA，跟卡片里三行的上下顺序一致。 */
    const anchor = card.nextSibling;
    ['mnMuiNote', 'mnGlNote', 'mnPwaNote'].forEach(id => {
      if (document.getElementById(id)) return;
      const n = document.createElement('p');
      n.className = 'mn-note'; n.id = id;
      card.parentNode.insertBefore(n, anchor);
    });
    return !!$('#mnMui');
  }
  function bindMuiSwitch() {
    const cb = $('#mnMui');
    if (!cb || cb.dataset.bound) return;
    cb.dataset.bound = '1';
    cb.addEventListener('change', e => {
      const api = window.MobileUI;
      if (!api) { e.target.checked = true; return; }
      api.set(e.target.checked);
      mnSync();
      toast(e.target.checked ? '已开启新视觉风格' : '已切换为电脑端界面');
    });
  }
  function syncMuiSetting() {
    if (!ensureMuiSwitch()) return;
    bindMuiSwitch();
    const cb = $('#mnMui'), box = $('#mnMuiSwitch'), note = $('#mnMuiNote');
    const st = window.MobileUI ? window.MobileUI.status() : { on: true, mobile: false };
    cb.checked = !!st.on;
    if (box) box.classList.toggle('on', !!st.on);
    if (note) note.textContent = st.on
      ? (st.mobile ? '已开启 · 手机竖屏使用独立主页与底部面板'
                   : '已开启 · 当前为电脑端界面，本开关只影响手机竖屏')
      : '已关闭 · 手机竖屏界面与电脑端一致';
  }

  /* PWA 开关：与旧设置页那颗共用一个 CarnetPWA 状态 */
  function bindPwaSwitch() {
    const cb = $('#mnPwa');
    if (!cb || cb.dataset.bound) return;
    cb.dataset.bound = '1';
    cb.addEventListener('change', e => {
      const api = window.CarnetPWA;
      if (!api) { e.target.checked = false; syncPwaSetting(); return; }
      api.set(e.target.checked);
      syncPwaSetting();
      const st = api.status();
      toast(!st.supported ? '当前环境无法启用 PWA，请用 https 或 localhost 打开'
        : e.target.checked ? '已开启 PWA · 可在浏览器菜单中安装'
          : '已关闭 PWA · 离线缓存已清除');
    });
  }
  function syncPwaSetting() {
    if (!ensureMuiSwitch()) return;
    bindPwaSwitch();
    const cb = $('#mnPwa'), box = $('#mnPwaSwitch'), note = $('#mnPwaNote');
    const st = window.CarnetPWA ? window.CarnetPWA.status() : null;
    const on = !!(st && st.on);
    cb.checked = st ? on : false;
    cb.disabled = !st;
    if (box) box.classList.toggle('on', on);
    if (note) {
      note.textContent = typeof pwaNoteText === 'function'
        ? pwaNoteText(st)
        : (!st ? 'PWA 模块未加载' : !st.supported ? '当前环境不支持 PWA' : st.failed || (on ? '已开启 PWA' : '已关闭 PWA'));
      /* .mn-note 默认隐藏；只有在当前环境确实注册不了 PWA 时才把说明露出来，
         否则用户点了开关只看到状态变了、却不知道为什么装不上。 */
      note.style.display = st && !st.supported ? 'block' : '';
    }
  }
  window.addEventListener('carnet-pwa-change', () => {
    try { syncPwaSetting(); } catch (_) {}
  });

  function mnSync() {
    syncMuiSetting();
    syncPwaSetting();
    const b = bgNow();
    /* 背景色板：预置色 + 末尾「＋」自定义取色 */
    const box = $('#mnBgColors');
    if (box && !box.dataset.built) {
      box.innerHTML = MN_BG_PRESETS.map(c =>
        `<i data-mncolor="${c}" style="background:${c}" title="${c}"></i>`).join('')
        + '<i class="mn-custom" data-mncolor="custom" title="自定义颜色">＋</i>';
      box.dataset.built = '1';
      $$('#mnBgColors i[data-mncolor]').forEach(s => s.addEventListener('click', () => {
        if (s.dataset.mncolor === 'custom') {
          openColorPicker('自定义背景颜色',
            bgNow().mode === 'color' ? bgNow().value : '',
            hex => { setBg({ mode: 'color', value: hex, img: null }); if (typeof syncBgPanel === 'function') syncBgPanel(); mnSync(); });
        } else {
          setBg({ mode: 'color', value: s.dataset.mncolor, img: null });
          if (typeof syncBgPanel === 'function') syncBgPanel();
          mnSync();
        }
      }));
    }
    if (box) $$('#mnBgColors i[data-mncolor]').forEach(s =>
      s.classList.toggle('on', b.mode === 'color' && b.value === s.dataset.mncolor));
    const up = $('#mnBgUpload'), clr = $('#mnBgClear');
    if (up) up.textContent = b.mode === 'image' ? '换一张' : '选择图片';
    if (clr) clr.disabled = b.mode !== 'image';
    /* 台面 */
    const pl = $('#mnPlinth'), plBox = $('#mnPlinthSwitch');
    if (pl) pl.checked = !!state.prefs.spinePlinth;
    if (plBox) plBox.classList.toggle('on', !!state.prefs.spinePlinth);
    /* WebGL：状态由 gl-lab.js 自己存 localStorage，这里只读写开关 */
    const gl = window.GLLab || null, cb = $('#mnGl'), note = $('#mnGlNote');
    if (cb) {
      const st = gl ? gl.status() : null;
      cb.checked = !!(st && st.on);
      cb.disabled = !st || !!st.failed;
      $('#mnGlSwitch').classList.toggle('on', cb.checked);
      if (note) note.textContent = !st ? '当前浏览器没有可用的 WebGL 实验层'
        : st.failed ? st.failed
          : cb.checked ? '已开启 · 多层书架与阅读器由 GPU 绘制；左右滑动 / 单层书架为保持流畅不启用'
            : '已关闭 · 当前使用标准渲染';
    }
  }
  /* 其它入口（历史脚本 / 搜索页）直接调 openHomeMenu 时，实验性开关的状态
     也要刷新，否则打开菜单会看到一颗没同步的开关。包一层，mnSync 幂等。 */
  const origOpenHomeMenu = window.openHomeMenu;
  if (typeof origOpenHomeMenu === 'function') {
    window.openHomeMenu = function () {
      const r = origOpenHomeMenu.apply(this, arguments);
      mnSync();
      return r;
    };
  }
  function mOpenMenu() { mnSync(); openHomeMenu(); }
  const mMenu = $('#mMenu');
  if (mMenu) mMenu.onclick = mOpenMenu;
  /* 桌面顶栏那颗也改走新入口（原来绑的是旧函数引用，这里覆盖一次） */
  const deskMenu = $('#menuBtn');
  if (deskMenu) deskMenu.onclick = mOpenMenu;
  const mnBack = $('#mnBack');
  if (mnBack) mnBack.onclick = () => closeMenus();
  /* 桌面弹窗右上的 ✕（移动端隐藏），关闭动作与左上返回一致 */
  const mnX = $('#mnX');
  if (mnX) mnX.onclick = () => closeMenus();

  /* 行项：导入 / 外观 / 更多。导入前先收菜单，免得选图对话框被盖住 */
  $$('#homeMenu [data-mnact]').forEach(b => b.addEventListener('click', () => {
    const a = b.dataset.mnact;
    if (a === 'privacy') {
      const d = $('#mnPrivacyDetail');
      if (d) d.classList.toggle('show');
      return;
    }
    if (a === 'bgReset') {
      setBg({ mode: 'default', value: '', img: null });
      if (typeof syncBgPanel === 'function') syncBgPanel();
      mnSync(); toast('已恢复默认背景');
      return;
    }
    closeMenus();
    if (a === 'book') pickBookImages();
    else if (a === 'source') pickImportFile();
    else if (a === 'pdf') pickBookPDF();
    else if (a === 'help') openHelpMail();
    else if (a === 'search') toggleSearch(true);
  }));
  /* 背景图片：直接点旧 #bgFile —— widgets.js 里那条 change 处理（读文件 → 压缩 → setBg）
     原样复用，不用再写一份。移除图片走 setBg 的默认档 */
  const up = $('#mnBgUpload');
  if (up) up.onclick = () => $('#bgFile').click();
  const clr = $('#mnBgClear');
  if (clr) clr.onclick = () => {
    setBg({ mode: 'default', value: '', img: null });
    if (typeof syncBgPanel === 'function') syncBgPanel();
    mnSync();
  };
  /* 单层书架台面 / WebGL 两个开关 */
  const pl = $('#mnPlinth');
  if (pl) pl.addEventListener('change', e => {
    state.prefs.spinePlinth = !!e.target.checked;
    $('#mnPlinthSwitch').classList.toggle('on', state.prefs.spinePlinth);
    savePrefs();
    if (state.prefs.view === 'spine' && typeof renderSpineShelf === 'function') renderSpineShelf();
  });
  const gl = $('#mnGl');
  if (gl) gl.addEventListener('change', e => {
    const g = window.GLLab;
    if (!g) { e.target.checked = false; return; }
    const ok = g.set(e.target.checked);
    if (!ok) e.target.checked = false;
    mnSync();
    toast(e.target.checked ? '已开启 WebGL 渲染' : '已关闭 WebGL 渲染');
  });

  /* ④ 长按进多选的收尾分别落在 home-events.js（多层书架）与 carousel.js（左右滑动）里：
     两边都复用各自原有的 420ms 长按手势，拖动照旧排序、原地松手才进多选。
     这里不再另挂一套定时器，免得同一下长按被两个模块各处理一次。 */
})();
