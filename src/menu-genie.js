/* =====================================================================
 * Carnet · Genie Effect（src/menu-genie.js）
 * ---------------------------------------------------------------------
 * 用 @web-kits/springboard 的 origin() + genie()，让面板从按钮图标「飞出去」，
 * 收起时再原路吸回图标。目前三套：
 *   ① #homeMenu   ← 右上角菜单按钮（竖屏是 #mMenu）
 *   ② #modal      ← 电脑端底栏中间的「＋ 新建手帐本」
 *   ③ 阅读器封面   ← 单层书架的那根书脊（reader-flow.js 调 flyBook，
 *                    ghost 封面由它建好传进来，打开飞出 / 关闭吸回）
 *
 * 业务状态仍由 .show 说了算（closeMenus / closeEditor / Esc / 侧滑返回 /
 * 历史脚本都认这套），这里只接管开合那 0.4 秒的视觉：
 *   · 打开：先加 .show → 效果层拍下当前画面 → 本体藏起来，
 *           切片副本从图标处展开 → 落地后交回真实 DOM。
 *   · 关闭：效果层先接住画面 → 立刻摘 .show（业务状态同步完成，
 *           选图对话框 / 后续点击都不用等动画）→ 副本吸回图标。
 *
 * ⚠️ springboard 的 cloneWindow() 会抹掉副本里所有 id，而本项目样式有
 *    `#homeMenu.addmenu …` / `#edPick{display:none}` 这类 id 选择器。所以按
 *    DOM 顺序把真实节点的 id 贴回每份新副本（真实节点在 DOM 里更靠前，
 *    getElementById 仍然拿到真的）。home-events.js 的 closeMenus 里对应加了
 *    [data-genie] 过滤，免得把副本的 .show 也一起摘掉。
 *
 * ⚠️ 库的 genie/genie.ts place() 打了本地补丁：关闭时 #mask 变 display:none
 *    会让 #modal 的 rect 变 0×0，漏斗会整块挪到屏幕左上角（看起来像「从
 *    左边收回」）。补丁忽略零尺寸测量，保留最后一次真实几何。
 *
 * ⚠️ 开关不进 state.prefs、不跟导出走；库没加载 / 不支持 WAAPI 时自动
 *    退回原来的 CSS 淡入淡出。
 *
 * 懒加载：菜单 / 新建弹窗的动画也要 cloneNode 整棵子树（菜单 .mn-scroll
 * 含色板、开关、卡片；#edForm 有 300+ 节点），逐帧克隆与重绘是主要卡顿源。
 *   开启时（默认关）动画期间把重子树摘到内存、换成十来个节点的轻骨架，
 *   落地后原样放回：节点对象没销毁，id / 值 / 监听器 / 事件绑定都在。
 *   状态存 localStorage carnet_lazy_v1，和 Genie 开关一样不进 prefs、不跟导出走。
 * ===================================================================== */
(function () {
  'use strict';

  const KEY = 'carnet_genie_v1';
  const LAZY_KEY = 'carnet_lazy_v1';
  const $ = s => document.querySelector(s);
  const $$ = s => [...document.querySelectorAll(s)];

  /* ---- 库懒加载：首屏不吃这 42KB，空闲时预取，点击时通常已就绪 ---- */
  let SB = window.Springboard || null;
  let libPromise = null;
  const hasWAAPI = typeof Element.prototype.animate === 'function';

  function ensureLib() {
    if (SB) return Promise.resolve(true);
    if (libPromise) return libPromise;
    libPromise = new Promise(resolve => {
      const s = document.createElement('script');
      s.src = 'assets/vendor/springboard.js';
      s.async = true;
      s.onload = () => {
        SB = window.Springboard || null;
        syncSwitch();                  // 库就绪后把开关从「不可用」刷成可用
        resolve(!!SB);
      };
      s.onerror = () => resolve(false);
      document.head.appendChild(s);
    });
    return libPromise;
  }
  if (window.requestIdleCallback) requestIdleCallback(ensureLib, { timeout: 1200 });
  else setTimeout(ensureLib, 200);

  function libReady() {
    return !!(SB && typeof SB.origin === 'function' &&
      typeof SB.genie === 'function' && hasWAAPI);
  }

  let on = true;
  try { on = localStorage.getItem(KEY) !== '0'; } catch (_) {}

  let inst = null;
  let token = 0;
  let editorOwned = false;
  let editorDone = null;   // 关闭动画落地后才跑的业务收尾（renderHome / toast）

  /* ---- 懒加载总开关：默认关，和 Genie 开关一样只存 localStorage ----
     只有显式存过 '1' 才算开；没有这个 key（含老用户升级）一律按关处理。 */
  let lazyOn = false;
  try { lazyOn = localStorage.getItem(LAZY_KEY) === '1'; } catch (_) {}

  window.CarnetLazyLoad = {
    get on() { return lazyOn; },
    status: () => ({ on: lazyOn }),
    set(v) {
      const next = !!v;
      if (next !== lazyOn) {
        lazyOn = next;
        try { localStorage.setItem(LAZY_KEY, next ? '1' : '0'); } catch (_) {}
      }
      syncLazySwitch();
      return lazyOn;
    },
    toggle() { return window.CarnetLazyLoad.set(!lazyOn); }
  };

  function enabled() {
    return on && libReady() && !!$('#app');
  }

  /* 电脑端 = 不是「竖屏 ≤1024」的移动端形态；横屏 / 宽屏都按桌面弹窗算 */
  function desktopUI() {
    return !window.matchMedia('(orientation:portrait) and (max-width:1024px)').matches;
  }

  function visibleFrom(nodes) {
    for (const n of nodes) {
      if (!n || !n.getClientRects().length) continue;
      const cs = getComputedStyle(n);
      if (cs.display !== 'none' && cs.visibility !== 'hidden') return n;
    }
    return nodes.find(Boolean) || null;
  }

  /* 两套面板：菜单让 Dock 图标浮在副本之上（效果层保持 z:auto），
     新建弹窗则必须压过 .modal-mask 的 z-index:100，否则副本被遮罩吃掉。
     edge 分开配：新建的 ＋ 在屏幕正中下方，钉死 bottom 才不会偏。
     ⚠️ 别调 genie 的 scale：实测 1.25 反而让切片数从 5 涨到 12，更卡。 */
  const MENU = {
    el: () => $('#homeMenu'),
    from: () => visibleFrom([$('#mMenu'), $('#menuBtn')]),
    root: 'div.addmenu',
    edge: 'auto', scale: 1,
    layerZ: null,
  };
  const EDITOR = {
    el: () => $('#modal'),
    from: () => $('.actionbar .icon-btn[data-act="new"]'),
    root: 'div.modal',
    edge: 'bottom', scale: 1,
    layerZ: '150',
  };
  /* ③ 阅读器封面 ← 单层书架的书脊。el / from 由 reader-flow.js 每次飞行前
     现配：ghost 是它建好停在落点矩形上的 .cover-ghost，from 是那根书脊。
     edge:auto 让库按中心方位自己挑漏斗边（书脊在封面下方 → bottom）。
     时长 0.5s 比面板的 0.4s 略长：封面飞的路程远，跟 FLY_MS(560) 一个量级。 */
  const BOOK = {
    el: () => bookRef.el,
    from: () => bookRef.from,
    root: 'div.cover-ghost',
    edge: 'auto', scale: 1, duration: .5,
    layerZ: '70',
  };
  let bookRef = { el: null, from: null };

  /* 副本是逐帧新建 strip 的；只给还没补过的新副本贴 id。
     pairs 是「索引 → id」的稀疏表，一次 run 只算一遍，每帧只写几十个节点，
     不再逐帧遍历整棵 300+ 节点的树。 */
  function bridgeIds(layer, pairs, root) {
    const copies = layer.querySelectorAll(root + ':not([data-gbridge])');
    if (!copies.length) return;
    copies.forEach(copy => {
      const nodes = [copy, ...copy.querySelectorAll('*')];
      for (const [i, id] of pairs)
        if (nodes[i] && !nodes[i].id) nodes[i].id = id;
      copy.setAttribute('data-gbridge', '1');
    });
  }

  /* ---- 新建弹窗懒加载 ------------------------------------------------
     #edForm 是 300+ 节点的表单 / 图案网格 / 色板 / 按钮。库会把它整棵
     cloneNode 成每一条切片，实测点击后同步卡 55ms。动画期间把这棵子树
     摘到内存里暂存，换上一副轻骨架；库克隆的只有十来个节点，首尾两帧
     和逐帧重绘都降一个数量级。落地后原样放回 —— 节点对象没被销毁，
     input 值、勾选状态、事件监听器全都在。 */
  let parked = null;
  function parkEditor(el) {
    if (parked) return;
    const form = el.querySelector('#edForm');
    if (!form) return;
    const sk = document.createElement('div');
    sk.className = 'genie-skeleton';
    sk.setAttribute('aria-hidden', 'true');
    sk.innerHTML =
      '<div class="gs-head"><i></i><b>新建手帐本</b></div>' +
      '<div class="gs-cover"></div>' +
      '<div class="gs-line"></div><div class="gs-line short"></div>' +
      '<div class="gs-cards"><i></i><i></i><i></i><i></i></div>' +
      '<div class="gs-foot"><i></i><i></i></div>';
    /* #modal 高度由内容撑开，摘掉表单后会缩水。直接用与 max-height 同一个
       88vh 锁住窗口几何（不读 getComputedStyle —— 那会强制同步布局，在
       buildEditor 刚生成 300 节点后要花几十毫秒）。 */
    el.style.height = '88vh';
    form.parentNode.replaceChild(sk, form);
    parked = { form, sk, el };
  }
  function restoreEditor() {
    if (!parked) return;
    const p = parked;
    parked = null;
    if (p.sk.parentNode) p.sk.parentNode.replaceChild(p.form, p.sk);
    if (p.el) p.el.style.height = '';
  }

  /* ---- 菜单懒加载 ----------------------------------------------------
     #homeMenu .mn-scroll 装着整张卡片列表（色板 / 开关 / 说明），Genie 每帧
     都要 cloneNode 这棵子树。动画期间换成十来个节点的骨架，落地后原样放回。
     ⚠️ 只摘 .mn-scroll：#homeMenu 自身的 id / 关闭热区 / CSS 变量都留着，
        closeMenus() / Esc / openHomeMenu() 的 .show 状态完全不受影响。 */
  let menuParked = null;
  function parkMenu(el) {
    if (!lazyOn || menuParked) return;
    const scroll = el.querySelector('.mn-scroll');
    if (!scroll) return;
    const sk = document.createElement('div');
    sk.className = 'mn-scroll menu-lazy';
    sk.setAttribute('aria-hidden', 'true');
    sk.innerHTML =
      '<div class="genie-skeleton menu-lazy-skeleton">' +
        '<div class="gs-head"><i></i><b>Carnet</b></div>' +
        '<div class="lazy-cards"><i></i><i></i><i></i></div>' +
        '<div class="lazy-cap"></div>' +
        '<div class="lazy-cards"><i></i><i></i><i></i></div>' +
        '<div class="lazy-cap"></div>' +
        '<div class="lazy-cards"><i></i><i></i><i></i></div>' +
      '</div>';
    scroll.parentNode.replaceChild(sk, scroll);
    menuParked = { scroll, sk, el };
  }
  function restoreMenu(notify) {
    if (!menuParked) return;
    const p = menuParked;
    menuParked = null;
    if (p.sk.parentNode) p.sk.parentNode.replaceChild(p.scroll, p.sk);
    /* 落地后菜单里的开关 / 色板要重新同步一次：window.openHomeMenu 的包装
       会在 g.open() 之后调 mnSync()，那一刻真节点还在内存里。 */
    if (notify) {
      try { window.dispatchEvent(new CustomEvent('carnet-lazy-restore')); } catch (_) {}
    }
  }

  /* 收回动画落地（或被中断 / 降级）时统一放行业务收尾，绝不吞掉回调：
     点「完成」后书架必须刷新，哪怕动画被系统返回打断。 */
  function callEditorDone() {
    const cb = editorDone;
    editorDone = null;
    if (cb) { try { cb(); } catch (_) {} }
  }

  function teardown() {
    token++;
    if (inst) { try { inst.destroy(); } catch (_) {} inst = null; }
    restoreEditor();
    restoreMenu(true);
    callEditorDone();
    const hm = $('#homeMenu'), md = $('#modal');
    if (hm) hm.classList.remove('genie-running');
    if (md) md.classList.remove('genie-running', 'genie-settled');
    /* destroy() 正常会自己摘层；异常中断时兜底清一次，别留下全屏空层 */
    $$('[data-genie]').forEach(n => n.remove());
  }

  /* opening=true 从图标飞出；false 吸回图标。返回是否真的接管了这一帧。 */
  function run(opening, cfg, after) {
    if (!enabled()) return false;
    const el = cfg.el(), from = cfg.from(), bounds = $('#app');
    if (!el || !from || !bounds) return false;

    teardown();                        // 上一段没收尾就先收干净
    /* 本次业务收尾紧跟 teardown 挂上，避免「run 返回后再挂」的竞态；
       after 是幂等 fire()，落地 / 中断 / 降级都只会执行一次。 */
    editorDone = typeof after === 'function' ? after : null;
    const mine = ++token;
    if (cfg === EDITOR) parkEditor(el);   // 懒加载：动画期间只挂轻骨架
    if (cfg === MENU) parkMenu(el);       // 菜单同样懒加载：克隆时只带轻骨架
    el.classList.add('genie-running');
    const ids = [el.id, ...[...el.querySelectorAll('*')].map(n => n.id || '')];
    const pairs = [];
    for (let i = 0; i < ids.length; i++) if (ids[i]) pairs.push([i, ids[i]]);
    let safety = 0;

    const finish = () => {
      if (mine !== token) return;      // 已被新一段接手
      clearTimeout(safety);
      restoreEditor();                 // 懒加载落地：完整表单原样放回
      restoreMenu(cfg === MENU);       // 菜单骨架换回真卡片，并补一次状态同步
      /* 落地后别把 .modal 的 pop 入场又放一遍：摘 genie-running 会让
         animation-name 从 none 变回 pop，白闪一下。留个 settled 压住它，
         直到下次 openEditor / 下一段动画开头再清。 */
      el.classList.remove('genie-running');
      if (cfg === EDITOR) el.classList.add('genie-settled');
      if (inst) { try { inst.destroy(); } catch (_) {} inst = null; }
      /* 库的 dispose 若被中途打断，别把全屏空层留在 #app 里 */
      $$('[data-genie]').forEach(n => n.remove());
      callEditorDone();              // 落地后才重绘书架，别抢收回动画的帧
    };

    try {
      inst = SB.origin(el, {
        from,
        /* 飞出 / 收回同速；scale 只改网格细度，不改窗口像素尺寸。 */
        effect: SB.genie({ edge: cfg.edge, duration: cfg.duration || 0.4, scale: cfg.scale }),
        /* 效果层挂 #app 内，跟着 App 的 fixed 视口走，不盖住系统级弹窗 */
        bounds,
        hideTarget: false,             // Dock 图标始终露着
        reducedMotion: 'user',         // 系统「减少动画」时库自动改淡入淡出
        open: !opening,                // 起点 = 目标反面，才跑得满一整段
        onStart: () => {
          if (!cfg.layerZ) return;
          const layer = $('#app > [data-genie]');
          if (layer) layer.style.zIndex = cfg.layerZ;
        },
        onFrame: () => {
          const layer = $('#app > [data-genie]');
          if (layer) bridgeIds(layer, pairs, cfg.root);
        },
        onLand: finish,
      });
      if (opening) inst.open(); else inst.close();
      /* 系统返回 / 切后台 / WAAPI 被打断时 onLand 可能不来，超时兜底收尾 */
      safety = setTimeout(finish, 950);
      return true;
    } catch (err) {
      teardown();
      return false;
    }
  }

  /* ---- ① 菜单页 ---- */
  function menuOpen() { return run(true, MENU); }
  function menuClose() { return run(false, MENU); }

  /* ---- ③ 单层书架开合书 ----
     reader-flow.js 在打开 / 关闭阅读器时调用：ghost 封面与书脊都由它备好，
     业务相位（主页淡出、书显形、书脊归位）挂在 after 上，落地那一帧同任务完成。
     返回 false = 库没接住（开关关着 / 库未就绪 / 异常），调用方退回两段式飞行。 */
  function bookFly(opening, ghost, from, after) {
    bookRef = { el: ghost, from };
    return run(opening, BOOK, after);
  }

  /* ---- ② 电脑端「＋ 新建手帐本」：只对新建、只对桌面弹窗启用 ----
     编辑已有本（封面齿轮 / 单层长按）和移动端两步 Bottom Sheet 保持原样。 */
  function editorOpen(isNew) {
    editorOwned = false;
    const md = $('#modal');
    if (md) md.classList.remove('genie-settled');
    if (!isNew || !desktopUI() || !enabled()) return false;
    editorOwned = run(true, EDITOR);
    return editorOwned;
  }
  function editorClose(after) {
    /* 返回 / 取消 / 完成 / Esc / 点遮罩全部经 closeEditor() 到这里，
       不再依赖 editorOwned 这种易失标记：只要眼前确实是「电脑端新建弹窗
       还开着」，三个按钮就一定都播吸回动画。 */
    const active = desktopUI() && !!$('#mask') &&
      $('#mask').classList.contains('show') &&
      typeof ed !== 'undefined' && !!ed && !!ed.isNew;
    editorOwned = false;
    let fired = false;
    const fire = () => {
      if (fired) return;
      fired = true;
      if (typeof after === 'function') after();
    };
    const ok = active && enabled() ? run(false, EDITOR, fire) : false;
    if (!ok) fire();                 // 降级 / 非新建 / 异常：立即且仅一次
    return ok;
  }

  /* ---- 实验开关：和 MUI / PWA 一样做成自愈行，index.html 被还原也不丢 ---- */
  function ensureSwitch() {
    let card = null;
    $$('#homeMenu .mn-cap').some(n => {
      if (n.textContent.trim() !== '实验性功能') return false;
      card = n.nextElementSibling; return true;
    });
    if (!card || !card.classList.contains('mn-card')) return;
    if (!$('#mnGenie')) {
      const row = document.createElement('label');
      row.className = 'mn-row';
      row.innerHTML = '<b>Genie Effect动画</b><span class="mn-switch" id="mnGenieSwitch"><input type="checkbox" id="mnGenie" aria-label="Genie Effect动画"></span>';
      card.appendChild(row);
      row.querySelector('input').addEventListener('change', e => {
        on = !!e.target.checked;
        try { localStorage.setItem(KEY, on ? '1' : '0'); } catch (_) {}
        if (!on) teardown();
        syncSwitch();
      });
    }
    /* 懒加载开关同样自愈：本地编辑器把 index.html 那一行还原掉也不丢入口 */
    if (!$('#mnLazy')) {
      const row = document.createElement('label');
      row.className = 'mn-row';
      row.innerHTML = '<b>懒加载</b><span class="mn-switch" id="mnLazySwitch"><input type="checkbox" id="mnLazy" aria-label="懒加载" title="动画期间只克隆轻量骨架，落地后恢复完整内容"></span>';
      card.appendChild(row);
    }
    if (!$('#mnLazyNote')) {
      const n = document.createElement('p');
      n.className = 'mn-note'; n.id = 'mnLazyNote';
      card.parentNode.insertBefore(n, card.nextSibling);
    }
    bindLazySwitch();
    syncSwitch();
    syncLazySwitch();
  }

  /* 行可能是 HTML 自带的，也可能是自愈补的，绑定统一走这里（幂等） */
  function bindLazySwitch() {
    const cb = $('#mnLazy');
    if (!cb || cb.dataset.bound) return;
    cb.dataset.bound = '1';
    cb.addEventListener('change', e => {
      window.CarnetLazyLoad.set(e.target.checked);
      if (typeof toast === 'function')
        toast(lazyOn ? '已开启懒加载 · 动画只加载轻量内容' : '已关闭懒加载 · 动画加载完整界面');
    });
  }

  function syncLazySwitch() {
    const cb = $('#mnLazy'), box = $('#mnLazySwitch'), note = $('#mnLazyNote');
    if (!cb) return;
    cb.checked = lazyOn;
    if (box) box.classList.toggle('on', lazyOn);
    if (note) note.textContent = lazyOn
      ? '已开启 · 菜单与新建弹窗动画期间只加载轻量骨架'
      : '已关闭 · 动画期间加载完整界面';
  }

  function syncSwitch() {
    const cb = $('#mnGenie'), box = $('#mnGenieSwitch');
    if (!cb) return;
    cb.checked = on && libReady();
    cb.disabled = !libReady();
    cb.title = libReady() ? '' : '动画库尚未就绪或浏览器不支持 Web Animations';
    if (box) box.classList.toggle('on', cb.checked);
  }

  window.CarnetMenuGenie = {
    enabled,
    lazy: () => lazyOn,
    open: menuOpen,
    close: menuClose,
    openEditor: editorOpen,
    closeEditor: editorClose,
    flyBook: bookFly,
    teardown,
    sync: syncSwitch,
  };

  /* defer 脚本执行时 DOM 已解析完；开关行补进菜单卡片即可 */
  ensureSwitch();
})();
