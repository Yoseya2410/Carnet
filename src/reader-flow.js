/* =====================================================================
 * Carnet · 阅读器交互 · 开合书动画与增删页   （脚本 25 / 28）
 * ---------------------------------------------------------------------
 * ① 打开：封面飞入放大成书 flyCover / openReader
 * ② 关闭：合上书（只合一次，不再先连翻回封面）、书缩回主页封面 closeReader
 * ③ 阅读器内的手势与「添加」菜单联动
 * ④ 加页 addPageAfter / 删页 deleteCurrentPage
 *
 * 对外接口：openReader, closeReader, addPageAfter, deleteCurrentPage
 *
 * 依赖模块：core, state, reader-view, page-flip（page-edit / text-sticker / page-bg / scrub 后置）
 *
 * 说明：模块间共用全局作用域，加载顺序即依赖顺序（见 index.html 与 README）。
 * ===================================================================== */
/* ==================== 阅读器交互 ==================== */
/* 开合动画：把主页封面「飞」成书，关闭时再飞回去 */
const FLY_MS = 560;
const FLY_OUT_MS = 600;                          // 关闭：慢慢缩回主页
const FLY_EASE = 'cubic-bezier(.22,1,.28,1)';   // 收尾更绵长，落地不生硬
/* 抬起 / 插回那一段要看得见，用匀速感更强的 ease-in-out；
   原来的强 ease-out 会在头 15% 时间就走完大半，看着像瞬间跳上去。 */
const FLY_LIFT_EASE = 'cubic-bezier(.42,0,.58,1)';
const FOLD_MS = 400;                             // 合书：左半边沿书脊翻到右侧（统一从左往右）
/* ⚠️ 11-19：开合动画的三层保底。活页 / 老数据 / 视图切换中途偶尔会走进
   「量不到封面」或「合书 Promise 挂起」的兜底分支，表现就是打开和关闭
   完全没有放大缩小动画（和其他装帧不一样）。正常路径一律不受影响。 */
let flyBusy = false, flyBusyT = 0;
function armFlyBusy(ms) {
  flyBusy = true;
  clearTimeout(flyBusyT);
  /* 落地回调 / endClose 万一没跑到，2s 后自动解锁，别把之后的每一次开合都挡成无动画 */
  flyBusyT = setTimeout(() => { flyBusy = false; flyBusyT = 0; }, ms);
}
function freeFlyBusy() {
  flyBusy = false;
  clearTimeout(flyBusyT); flyBusyT = 0;
}
/* 量不到起飞 / 落点封面时给一个屏幕居中的近似矩形：宁可从近似位置飞入，
   也不要整段无动画直接跳。flyCover 只用到 left/top/width/height。 */
function fallbackCoverRect() {
  const w = Math.min(220, Math.max(90, window.innerWidth * .34));
  const h = w * 1.414;
  return {
    left: (window.innerWidth - w) / 2, top: (window.innerHeight - h) / 2,
    width: w, height: h,
    right: (window.innerWidth + w) / 2, bottom: (window.innerHeight + h) / 2
  };
}
/* 每次 flyCover 递增：上一趟动画的落地回调（ms+60 的 setTimeout）不能去摘
   新一趟的 .book-in，否则新动画放大途中书会提前显形、又变成两张封面。 */
let flySeq = 0;
/* ==================== 飞行期间的玻璃挡板副本 ====================
   ⚠️ ghost 是 #app 直属、z-index:60；书架玻璃 .shelf-board 在 #home 内，而 #home 是
   z-index:0 的层叠上下文 —— 玻璃在它内部再怎么提 z-index 也盖不到飞行的书。
   于是抬起 / 插回时书看起来是「浮在玻璃外面」的。这里在 #app 上放一份 fixed 副本
   （z:61，书之下是背景、之上是玻璃），只覆盖当前那一排的玻璃矩形：
   书抬出玻璃上沿之后矩形自然就遮不到它了，不需要逐帧算遮挡。
   外观全部从真实 .shelf-board 的 computed style 拷贝（深底 / 浅底 / GPU 接管三套
   都同源，不另写第二套色板）；布局只在开场量这一次，动画过程中绝不读 rect。 */
let flyGlassNode = null, flyGlassSrc = null;
/* 起飞位留空（用户 11-19 实测：抬起段背景一清晰，架上原位那本封面就和 ghost
   叠成「两封面重合」）。整段飞行期间把那一本 visibility:hidden，落地与 ghost
   交接的同一帧恢复 —— 架子上就是一个空位，书看起来真的是被抽出来 / 插回去。
   ⚠️ 绝不能用 display:none：coverRect() 会量到 0×0，落点就跑到屏幕左上角。 */
function flyTakeClear() {
  $$('.fly-taken').forEach(el => el.classList.remove('fly-taken'));
}
function flyTakeMark() {
  flyTakeClear();
  const view = state.prefs && state.prefs.view;
  const sel = view === 'spine'
    ? `#spineRow .spine-item[data-i="${state.sel}"]`
    : view === 'shelf'
      ? `#shelfWrap .book-item[data-i="${state.sel}"]`
      : `#carousel .book-item[data-i="${state.sel}"]`;
  const el = $(sel) || $('.book-item.active') || $('.book-item');
  if (el) el.classList.add('fly-taken');
}
function flyGlassCleanup() {
  if (flyGlassNode) { flyGlassNode.remove(); flyGlassNode = null; }
  if (flyGlassSrc) { flyGlassSrc.classList.remove('fly-hidden'); flyGlassSrc = null; }
  flyTakeClear();                            // 玻璃副本 / 起飞位都是飞行期临时状态，一起收
}
function flyGlassBoard() {
  if (state.prefs.view !== 'shelf') return null;
  const item = document.querySelector(`#shelfWrap .book-item[data-i="${state.sel}"]`);
  const row = item && item.closest ? item.closest('.shelf-row') : null;
  return row ? row.querySelector('.shelf-board') : null;
}
function flyGlassMount(reverse) {
  flyGlassCleanup();
  flyTakeMark();                             // 先清空起飞位，再挂玻璃副本（顺序不能反）
  const board = flyGlassBoard();
  if (!board) return;
  const r = board.getBoundingClientRect();
  if (!r.width || !r.height) return;
  const cs = getComputedStyle(board);
  const g = document.createElement('div');
  /* 退出时段①主页还藏着，玻璃副本跟着先隐形；段②主页显现时再淡入 */
  g.className = 'fly-glass' + (reverse ? ' hidden' : '');
  const s = g.style;
  s.left = r.left + 'px'; s.top = r.top + 'px';
  s.width = r.width + 'px'; s.height = r.height + 'px';
  /* --glass-r 定义在 .shelf-row 上，fixed 副本取不到变量，直接抄解析后的四个角 */
  s.borderRadius = cs.borderTopLeftRadius + ' ' + cs.borderTopRightRadius + ' ' +
    cs.borderBottomRightRadius + ' ' + cs.borderBottomLeftRadius;
  if (cs.backgroundImage !== 'none') s.backgroundImage = cs.backgroundImage;
  if (cs.backgroundColor && cs.backgroundColor !== 'rgba(0, 0, 0, 0)') s.backgroundColor = cs.backgroundColor;
  if (cs.boxShadow !== 'none') s.boxShadow = cs.boxShadow;
  /* GPU 接管时真实玻璃的 backdrop-filter 被压成 none，照抄就不会冒出第二层模糊 */
  if (cs.backdropFilter && cs.backdropFilter !== 'none') s.backdropFilter = cs.backdropFilter;
  if (cs.webkitBackdropFilter && cs.webkitBackdropFilter !== 'none') s.webkitBackdropFilter = cs.webkitBackdropFilter;
  /* 浅底玻璃下沿那条书脚接触影画在 ::before 里，伪元素不会跟着走 —— 拿真实子节点顶替 */
  const bf = getComputedStyle(board, '::before');
  if (bf && bf.backgroundImage && bf.backgroundImage !== 'none' && bf.height !== 'auto') {
    const sh = document.createElement('i');
    sh.style.cssText = 'position:absolute;pointer-events:none;left:' + bf.left + ';right:' + bf.right +
      ';bottom:' + bf.bottom + ';height:' + bf.height + ';background:' + bf.backgroundImage +
      ';border-radius:' + (bf.borderRadius === '0px' ? '0 0 6px 6px' : bf.borderRadius);
    if (bf.maskImage && bf.maskImage !== 'none') sh.style.maskImage = bf.maskImage;
    if (bf.webkitMaskImage && bf.webkitMaskImage !== 'none') sh.style.webkitMaskImage = bf.webkitMaskImage;
    g.appendChild(sh);
  }
  /* 两颗铆钉：--rivet-d / --rivet-x 挂在 #shelfWrap 上，fixed 副本里取不到，
     位置按真实铆钉的 rect 反算成 px，外观照抄 computed background + 阴影 */
  board.querySelectorAll('.screw').forEach(sc => {
    const sr = sc.getBoundingClientRect(), ss = getComputedStyle(sc);
    if (!sr.width || !sr.height) return;
    const i = document.createElement('i');
    i.style.position = 'absolute'; i.style.pointerEvents = 'none';
    i.style.left = (sr.left - r.left) + 'px'; i.style.top = (sr.top - r.top) + 'px';
    i.style.width = sr.width + 'px'; i.style.height = sr.height + 'px';
    i.style.borderRadius = ss.borderRadius;
    i.style.background = ss.background && ss.background !== '' ? ss.background : ss.backgroundImage;
    if (ss.boxShadow !== 'none') i.style.boxShadow = ss.boxShadow;
    g.appendChild(i);
  });
  $('#app').appendChild(g);
  flyGlassNode = g; flyGlassSrc = board;
  board.classList.add('fly-hidden');       // 副本顶班，真实玻璃先藏起来，避免叠成两层
}
function coverRect() {
  /* 书架里一眼能看到好几本，必须认准当前那一本，动画才不会从别的位置飞出去 */
  const view = state.prefs && state.prefs.view;
  /* 单层书架：从那根书脊本身起飞 —— 点它就是「从架子上抽出来」，
     动画自然得从书脊开始（此时它已被 .pulling 抬起，量到的就是抽出后的位置） */
  if (view === 'spine') {
    const sp = $(`#spineRow .spine-item[data-i="${state.sel}"]`);
    return sp ? sp.getBoundingClientRect() : null;
  }
  const root = view === 'shelf' ? '#shelfWrap' : '#carousel';
  const el = $(`${root} .book-item[data-i="${state.sel}"] .cover`)
    || $('.book-item.active .cover') || $('.book-item .cover');
  return el ? el.getBoundingClientRect() : null;
}
/* 画面上「封面那一页」的位置：合上书之后封面躺在左槽，平时在右槽；
   也不能去量整本书 —— 封面单独成页时书比封面宽一倍 */
function coverPageRect() {
  const el = $('#slotL .paper.coverpage') || $('#slotR .paper.coverpage');
  return (el || $('#book')).getBoundingClientRect();
}
/* 飞行的封面。
   ⚠️ 这里**绝不能用非等比 scale 直接把起点撑成终点**：单层书架的起点是一根书脊
      （约 42×384），终点是 A5 封面（约 190×270），scale 的横纵比差 6 倍以上，
      封面内容会被先压扁再拉回来 —— 全程都是扭曲的。
   改成「窗口展开 + 内容等比填充」：
     ① ghost 本身是个**窗口**，用 width/height 从起点矩形过渡到终点矩形（尺寸变化不用 scale，
        所以窗口内部的东西不会被拉变形）；
     ② 内容单独包一层 .cover-ghost-fit，按**终点封面**的真实尺寸渲染，只做**等比** scale
        （cover 式填充：起点放大到能铺满细长窗口、且居中，所以一开始只露出中间一条竖缝，
        跟「书脊」的形状对得上），随窗口展开回落到 1 —— 内容比例从头到尾都是对的，
        只是被裁剪的范围在变：看着就是封面从书脊那条缝里展开。 */
function fitScale(win, to) {
  return Math.max(win.width / Math.max(to.width, 1), win.height / Math.max(to.height, 1));
}
function flyCover(from, to, reverse, onLand, onLift) {
  const j = cur();
  if (!j || !from || !to) { flyGlassCleanup(); if (onLand) onLand(); return null; }
  /* 开场先收掉任何残留的飞行封面：动画中途被返回键打断、又立刻点开另一本时，
     旧的 ghost 会一直飞到自己的 ms+60 才消失，与新 ghost 叠成两张封面。 */
  const seq = ++flySeq;
  $$('.cover-ghost').forEach(g => g.remove());
  /* 玻璃副本在 #app 上，跟 ghost 同批清残留：动画中途打断再开另一本时不会留两块玻璃 */
  flyGlassMount(reverse);
  const a = reverse ? to : from, b = reverse ? from : to;      // a = 起飞的窗口，b = 落地的窗口
  const ghost = document.createElement('div');
  ghost.className = 'cover-ghost';
  const fit = document.createElement('div');
  fit.className = 'cover-ghost-fit';
  /* 合着的书朝外那一面：停在封面就是封面、停在封底就是封底（封底态退场前会先翻回封面，
     这里认 closedCoverHTML 只是多一道保险，免得 ghost 跟书上的皮不是同一张） */
  fit.innerHTML = closedCoverHTML(j);
  fit.style.width = to.width + 'px';
  fit.style.height = to.height + 'px';
  ghost.appendChild(fit);
  /* 起点圆角跟着起飞物走：从书脊出发时它就是一根窄条（书脊的圆角只有 1.5~2.5px），
     套用封面的大圆角会在细条上糊成一团。从封面起飞时右侧两角按这一本自定义的圆角走
     （默认 10px → 13px，跟原来的起点一致），左侧书脊两角固定 5px。 */
  const spineStart = (state.prefs && state.prefs.view) === 'spine';
  const rHome = coverRadiusOf(j);
  const rStart = spineStart ? '1.5px 2.5px 2px 1.5px'
    : `5px ${(rHome * 1.3).toFixed(1)}px ${(rHome * 1.3).toFixed(1)}px 5px`;
  /* 落地圆角必须等于**这一本合书态整本外框**的 --book-r：
     笔记本 / 画册 5px 16px 16px 5px、活页 5px 25px 25px 5px（翻开后改为四角统一、
     但角度仍是同一个 --cr-round；飞入时先落到合着的封面，所以取合书那一档）。
     ⚠️ 现在 --book-r 是带 calc()/var() 的公式，读 getComputedStyle 拿到的可能是
        未解析的变量串（塞给 ghost 的 border-radius 就作废了），所以直接由
        bookRadiusOf(j) 算同一组合书态数值：右侧两角跟着本子的封面圆角走，左侧固定 5px。 */
  const rr = bookRadiusOf(j).toFixed(1);
  const rEnd = `5px ${rr}px ${rr}px 5px`;
  ghost.style.width = a.width + 'px';
  ghost.style.height = a.height + 'px';
  ghost.style.borderRadius = reverse ? rEnd : rStart;
  /* translate3d 把整块 ghost 钉在 GPU 合成层：width/height 的 layout 变化不再
     把整页拖进重绘，内容层的 scale 与窗口位置也能落在同一帧，封面不会「抖」。 */
  ghost.style.transform = `translate3d(${a.left}px,${a.top}px,0px)`;
  fit.style.transform = `translate3d(-50%,-50%,0px) scale(${fitScale(a, to)})`;
  /* ⚠️ 不给 ghost 设 CSS animation（见 book-anim.css 的重影说明）：
     飞行全程保持不透明，落地那一帧才与书交接。关闭时同样不做渐变。 */
  $('#app').appendChild(ghost);
  /* ⚠️ 强制一次样式计算，给刚插入的 ghost 建立「旧样式」基线。
     少了这一下，浏览器会把下一帧里「设置 transition + 改目标值」当成同一次变更，
     第一段的抬起会整段跳过去（实测 headless 里 top 直接落到终点）。只在开场读一次，
     动画过程中绝不碰布局。 */
  void ghost.offsetWidth;
  const ms = reverse ? FLY_OUT_MS : FLY_MS;
  /* 11-17 第十二轮：**两段式开合书**。
     打开 = 先把书从书架上「抬」出玻璃挡板（尺寸不变，书底高过玻璃上沿）→ 再放大飞进阅读器；
     退出 = 先缩回到玻璃上方（尺寸变回书架那本）→ 再往下「插」回书架原位。
     ⚠️ 中间点取书架那一端的矩形，只做垂直上移；抬起量按玻璃高度算才真的「抽出来」。
     ⚠️ 只在开场量一次布局，之后全靠 CSS transition，不在每帧读 rect。 */
  const shelfRect = reverse ? b : a;
  const glass = flyGlassBoard();
  const lift = Math.max(22, glass ? glass.getBoundingClientRect().height * 1.18 : shelfRect.height * .18);
  const mid = {
    left: shelfRect.left, top: shelfRect.top - lift,
    width: shelfRect.width, height: shelfRect.height
  };
  const liftMs = Math.round(ms * .38), zoomMs = ms - liftMs;
  /* ⚠️ 11-19：border-radius 不再逐帧插值。overflow:hidden 的窗口每帧重算圆角
     裁剪路径，边缘会在亚像素处「蠕动」，正是放大 / 缩小时封面细微抖动的来源。
     两段各自的起点一次性设好圆角（rStart ↔ rEnd 只差 3px，切换几乎看不出）。 */
  const winTrans = (d, ease) => `width ${d}ms ${ease},height ${d}ms ${ease},` +
    `transform ${d}ms ${ease}`;
  /* GPU 光影层也按同样的两段插值（a → mid → b），落地影在抬起时变淡、放大时回来 */
  if (window.GLLab && GLLab.on) GLLab.fly(a, mid, b, ms, reverse);
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      /* 段 ①：抬起 / 缩到玻璃上方。窗口尺寸不变（打开时）或缩回书架尺寸（退出时），
         圆角先回到书架那档；内容的等比缩放与窗口必须同一个 easing / 时长。 */
      ghost.style.transition = winTrans(liftMs, FLY_LIFT_EASE);
      ghost.style.width = mid.width + 'px';
      ghost.style.height = mid.height + 'px';
      ghost.style.borderRadius = rStart;
      ghost.style.transform = `translate3d(${mid.left}px,${mid.top}px,0px)`;
      fit.style.transition = `transform ${liftMs}ms ${FLY_LIFT_EASE}`;
      fit.style.transform = `translate3d(-50%,-50%,0px) scale(${fitScale(mid, to)})`;
      setTimeout(() => {
        /* 段 ②：放大进阅读器 / 插回书架 */
        ghost.style.transition = winTrans(zoomMs, FLY_EASE);
        ghost.style.width = b.width + 'px';
        ghost.style.height = b.height + 'px';
        ghost.style.borderRadius = reverse ? rStart : rEnd;
        ghost.style.transform = `translate3d(${b.left}px,${b.top}px,0px)`;
        fit.style.transition = `transform ${zoomMs}ms ${FLY_EASE}`;
        fit.style.transform = `translate3d(-50%,-50%,0px) scale(${fitScale(b, to)})`;
        /* 段 ① 刚走完、书已经抬到玻璃上方：这一帧才通知外层切「背景相位」
           （打开＝背景模糊 + 阅读器淡入；退出＝主页显现 + 书插回书架）。
           ⚠️ 和段 ② 的属性写在同一次任务里，背景与放大严格同帧起步。 */
        if (onLift && seq === flySeq) onLift();
      }, liftMs);
    });
  });
  /* 落地交接：ghost 移除与「书显形」必须在**同一次任务**里完成，浏览器只会渲染
     合并后的那一帧 —— 两张皮同源同尺寸同位置，零跳变、零重影。
     +60ms 是留给双 rAF 起步与 transition 尾帧的余量，别再提前。
     玻璃副本也在这里收掉：退出时 endClose 比落地早，不能在那儿提前摘。 */
  setTimeout(() => {
    ghost.remove();
    /* 只认最后一趟：被打断后旧回调仍会 remove 自己的 ghost，但不能再动书 / 玻璃的状态 */
    if (seq === flySeq) {
      flyGlassCleanup();
      if (onLand) onLand();
    }
  }, ms + 60);
  return ghost;
}
function openReader() {
  if (flyBusy || !cur()) return;
  /* 加密本还没解锁就先解密：本机记住过密钥时静默完成（不弹框），
     从外部导入 / 点过「立即上锁」的才弹输入框；解锁成功后会重新跑一次 openReader。 */
  if (!guardUnlocked(cur(), () => openReader())) return;
  cancelFlip();
  closeScrub();
  closeAddMenu();
  hideTextBar();
  state.page = -1; state.spread = -1;   // 先展示封面
  primeEndpaper(cur());                 // 提前取封面 / 封底主色，翻到末页时不再补色
  const home = $('#home'), reader = $('#reader'), book = $('#book');
  const app = $('#app');
  const from = coverRect() || fallbackCoverRect();
  const reduced = window.matchMedia('(prefers-reduced-motion:reduce)').matches;
  if (reduced) {
    app.classList.remove('fly-lift', 'fly-zoom');
    flyGlassCleanup();
    reader.classList.add('show');
    home.classList.remove('book-returning', 'book-appearing');
    book.classList.remove('book-in', 'book-out', 'gone', 'folded', 'folding', 'folding-back', 'back-hinge', 'back-close', 'back-opening', 'cover-flip');
    renderReader();
    return;
  }
  armFlyBusy(FLY_MS + 600);
  /* 相位 ①：只把书从玻璃里抬出来，主页保持清晰、原尺寸，阅读器整体透明 */
  app.classList.remove('fly-zoom');
  app.classList.add('fly-lift');
  home.classList.remove('book-returning', 'book-appearing');
  home.classList.add('book-opening');
  reader.classList.add('book-opening');
  reader.classList.add('show');
  book.classList.remove('book-out', 'gone', 'folded', 'folding', 'folding-back', 'back-hinge', 'back-close', 'back-opening', 'cover-flip');
  renderReader();
  /* 量封面那一页本身，而不是整本书 —— 封面单独成页时书比封面宽一倍 */
  const to = coverPageRect() || fallbackCoverRect();
  book.classList.add('book-in');
  /* 交接回调挂在 flyCover 的落地帧上：ghost.remove() 之后立刻摘 .book-in，
     不再另开一个 setTimeout（两个定时器错开哪怕 20ms，都会在放大末尾露出一帧重影）。 */
  flyCover(from, to, false, () => {
    freeFlyBusy();
    app.classList.remove('fly-lift');     // 兜底：量不到封面走早退分支时别把相位留在抬起态
    reader.classList.remove('book-opening');
    book.classList.remove('book-in');
  }, () => {
    /* 相位 ②：书已抬到玻璃上方、正要放大 —— 这一帧主页才模糊淡出、阅读器淡入。
       ⚠️ 玻璃副本同时淡出并把真实玻璃放回来，书此时已经越过玻璃上沿，遮不到它了。 */
    app.classList.remove('fly-lift');
    app.classList.add('fly-zoom');
    if (flyGlassNode) flyGlassNode.classList.add('fade');
    if (flyGlassSrc) flyGlassSrc.classList.remove('fly-hidden');
  });
}
/* 是否停在「合着的书」：统一用 reader-view.js 的 isClosedView() / isBackView()，
   这里不再留第二份判定（封面 -1 与封底 -3 都是合着的书） */
/* ① 合上书：一次动画，不再先「哗哗翻回封面」。
   ⚠️ 以前是 flipBackToCover() 翻回封面（它最后一翻本身就把书合上了，而且只播 160ms 就被掐断，
      是个半截的「小合上」），完了再走 foldBook() —— 合上看着演了两遍，第一遍还只演了一半。
      现在合上**只留一次**：当前这一跨直接合。 */
function closeBookOnce() {
  /* 单页模式本来就「合着」（一次只有一张纸），不补合书动画，直接回封面 */
  if (state.mode !== 'spread') { state.page = -1; state.spread = -1; renderReader(); return Promise.resolve(); }
  /* 第一跨页（封面内侧 + 第 1 页）：走翻页那套 —— 封面摊开 / 合拢的那段横移在里面。
     ⚠️ 它是「从左往右」合上的（叶片从 -180° 转到 0°），下面的 foldBook 必须同向 */
  if (state.spread === 0) return flipDone(-1);
  /* 其它跨页：右页沿书脊翻到左边，封面朝外 */
  return foldBook();
}
/* 翻一次页并等到它播完：flip 是逐帧驱动的、没有完成回调，这里盯着 flipA 判结束
   （flip 因边界守卫没启动时会立刻 resolve） */
function flipDone(dir) {
  return new Promise(done => {
    flip(dir);
    (function wait() { if (flipA) requestAnimationFrame(wait); else done(); })();
  });
}
/* ② 合回封面：**从左往右** —— 把左半边抬起来，沿书脊翻到右边盖上，落定后朝外的是封面。
   ⚠️ 方向跟「第一跨页合回封面」那一翻（closeBookOnce 里的 flip(-1)）必须是同一个：
      以前第二跨往后是反着来（把右页往左掀），同一个「返回」一会儿左合一会儿右合，
      看着像两套本子 —— 现在两处都是「从左往右」。
   ⚠️ 起步那一格（-180°，正盖住左槽）放的是**当前左页**：整格内容原样搬进叶背，
      画面从静止接得上，不会在第一帧跳一下；
      落那一格（0°，盖住右槽）放封面 —— 合上之后朝外的自然是它。
      ⚠️ 落点必须是 slotR（不是 slotL）：封面单独成页时 `.cover-only` 会把左槽收起来，
         放在左槽里它是 display:none，量出来的位置是 0×0，
         紧接着飞回主页那张 ghost 就会从屏幕左上角那么一个「无」里长出来。 */
/* landing = undefined/'front' 是合回封面（点返回时的老路径）；
   ⚠️ 'back'（翻到最后一页再往后翻合到封底）**不共用这段动画**：真实本子翻到末页
      是把右半边从右往左合上，跟合回封面正好镜像 —— 见下面的 foldBookBack()。 */
function foldBook(landing) {
  if (landing === 'back') return foldBookBack();
  const landingHTML = coverPageHTML();
  return new Promise(done => {
    const book = $('#book'), leaf = $('#leaf'), lf = $('#leafF'), lb = $('#leafB');
    /* 换掉左槽前先把文字贴挂在 document 上的监听摘掉（跟 renderReader 同一套做法），
       不然这些节点被冲掉之后监听会残留 */
    $$('#slotL .ptext-wrap').forEach(x => {
      if (x.__outDown) { document.removeEventListener('pointerdown', x.__outDown, true); x.__outDown = null; }
    });
    /* 活页合上的是**整本左半边**，封面比内页大一圈：
       ① 叶片换到「整张封面板」那套几何（.book.cover-flip，见 reader.css）—— 沿用内页尺寸的话，
          落地那张封面是内页大小，看着就是「一张纸合上了」，不是外面那张封面合上了；
       ② 背上那一面（起点，还躺在左边）照摊开的样子摆：板（封面内侧）+ 压在板上的那张内页
          （.leaf-page-inset 让出四周的露边），这样第一帧和静止时一模一样，不会跳一下。
       胶装本封面与内页同大、也没有封面内侧那层皮，照老样子把纸铺满整格即可。 */
    const ringed = !!bookStyleOf(cur()).rings;
    const leftHTML = $('#slotL').innerHTML;
    lb.innerHTML = ringed
      ? insideCoverPageHTML() + `<div class="leaf-page-inset">${leftHTML}</div>`
      : leftHTML;                             // 背面：当前左页（起点那一面）
    lf.innerHTML = landingHTML;               // 正面：封面（落地那一面）
    /* 左页被"掀"起来带走：**整格一起收掉**（.book.folding，见 book-anim.css）——
       空槽自己垫的那层纸色看着就是「一张白纸停在左边」，而合上的是整本左半边，
       纸和封面都跟着翻过去了，那一格合书期间本来就该什么都没有 */
    $('#slotL').innerHTML = '';
    book.classList.add('folding');
    if (ringed) book.classList.add('cover-flip');
    leaf.classList.add('show', 'turning');
    leaf.style.transition = 'none';
    leaf.style.transform = 'rotateY(-180deg)';
    flipA = {
      dir: -1, from: -180, to: 0, dur: FOLD_MS, raf: 0, t0: performance.now(),
      onEnd: () => {
        $('#slotR').innerHTML = landingHTML;        // 交接给右槽：封面就停在自己落地的位置
        leaf.classList.remove('show', 'turning');
        leaf.style.transition = 'none';
        leaf.style.transform = 'none';
        state.page = -1; state.spread = -1;         // 书已合上，状态回到封面（不重绘，免得合拢形态被冲掉）
        $('#pager').textContent = '封面';            // 底栏页码跟上（整体重绘会破坏合拢形态，这里只改文字）
        /* 形态改到「封面单独成页」再按封面态重算尺寸：活页封面比内页大一圈
           （--pw 从内页宽变成封面宽），不重算的话收拢出来的是内页大小的一张封面 */
        book.classList.remove('spread', 'first-spread', 'last-spread', 'has-under', 'folding', 'folding-back', 'back-hinge', 'back-close', 'back-opening', 'cover-flip');
        book.classList.add('cover-only');
        layoutBook();
        book.classList.add('folded');              // 收成一本合着的书
        done();
      }
    };
    requestAnimationFrame(stepFlip);
  });
}
/* ==================== 合到封底：从右往左 ====================
   真实本子翻到最后一页再合上，抬起来的是**右半边**，沿书脊往左盖过去，
   朝外的就是封底；合回封面（foldBook）抬的是左半边，两者正好镜像。
   ⚠️ 叶片转轴固定在书脊（右槽左沿）：0° 盖右槽、-180° 盖左槽。所以这一翻
      是 0° → -180°，起手叶正面 = 当前右页（静止那一帧接得上）、落地叶背 = 封底。
   ⚠️ 叶片最后停在左槽，封底态就由 renderReader() 摆在**左槽**（.back-only）:
      合书时整本右移半张封面（slide），左槽被推到屏幕正中；落定后位移保持这半张，
      交接在同一帧完成，眼睛看不到任何跳动。
      ⚠️ 别再把封底摆回右槽：那样从封底往前翻只能又翻一次右→左，跟合书方向反着来。
   ⚠️ 右槽不清空、只靠 .folding-back 把它 visibility:hidden：文字贴挂在 document 上的
      监听留给 renderReader() 统一摘，动画被打断时槽里也还是完整的那一页。 */
function foldBookBack() {
  return new Promise(done => {
    const book = $('#book'), leaf = $('#leaf'), lf = $('#leafF'), lb = $('#leafB');
    const ringed = !!bookStyleOf(cur()).rings;
    const rightHTML = $('#slotR').innerHTML;
    /* 活页右半边摊开时是「后封面内侧那张板 + 压在板上的内页」，起手照原样摆进叶正面 */
    lf.innerHTML = ringed
      ? insideCoverPageHTML() + `<div class="leaf-page-inset">${rightHTML}</div>`
      : rightHTML;
    lb.innerHTML = backCoverPageHTML();          // 落地那一面（-180°，盖住左槽）
    book.style.transform = '';
    book.classList.add('folding-back', 'back-view');
    if (ringed) book.classList.add('cover-flip');
    leaf.classList.add('show', 'turning');
    leaf.style.transition = 'none';
    leaf.style.transform = 'rotateY(0deg)';
    /* 位移按「合着的封面」半宽算：活页封面比内页大一圈，拿内页宽去移会少走一截 */
    const st = bookStyleOf(cur());
    const coverK = st.rings ? 1 + (st.padX || 0) + (st.gap || 0) / 2 : 1;
    const half = (state.pw || 0) * coverK / 2;
    flipA = {
      dir: 1, from: 0, to: -180, slide: [0, half], dur: FOLD_MS,
      t0: performance.now(), raf: 0,
      onEnd: () => {
        leaf.classList.remove('show', 'turning');
        leaf.style.transition = 'none';
        leaf.style.transform = 'none';
        book.style.transform = '';               // 交给 .back-only 的 CSS 位移（同为 +半张）
        book.classList.remove('folding-back', 'back-hinge', 'back-close', 'back-opening', 'cover-flip', 'back-view', 'folding');
        /* 合到封底后人还在阅读器里，不留 .folded：按封底态整体重绘，
           把 back-only / back-view / --pw / 底栏按钮 / 页码一次算对。 */
        state.page = PAGE_BACK_COVER; state.spread = PAGE_BACK_COVER;
        renderReader();
        done();
      }
    };
    requestAnimationFrame(stepFlip);
  });
}
/* 收尾清理：无论走到哪一步被打断，都能把现场还原干净。
   hard = 动画被中途打断（没有落地帧来收玻璃副本）；正常退出时副本要一路留到
   flyCover 的落地回调，因为那时书才刚插回书架、玻璃还得压在书脚上。 */
function endClose(hard) {
  freeFlyBusy();
  cancelFlip();                                // 合书没跑完就被跳过时，别让它的收尾再给书加上合拢态
  if (hard) flyGlassCleanup();
  /* fly-zoom 与 .show 同一任务摘掉：单独摘会让 #reader.show 的 fadeIn 重播一次 */
  $('#app').classList.remove('fly-lift', 'fly-zoom');
  /* 单层书架：把那根被「抽走」的书脊放回架上（抽出 + 隐藏的 class 一起摘掉） */
  $$('#spineRow .spine-item.pulling,#spineRow .spine-item.gone')
    .forEach(el => el.classList.remove('pulling', 'gone'));
  const leaf = $('#leaf');
  if (leaf) { leaf.classList.remove('show', 'turning'); leaf.style.transition = 'none'; leaf.style.transform = 'none'; }
  $('#reader').classList.remove('show', 'closing');
  $('#book').classList.remove('book-out', 'gone', 'folded', 'folding', 'folding-back', 'back-hinge', 'back-close', 'back-opening', 'cover-flip');
  $('#book').style.transform = '';
  $('#home').classList.remove('book-returning', 'book-appearing');
}
/* 退场：合上书（一次动画） → 缩小回主页 */
async function runCloseSequence(to) {
  const reader = $('#reader'), book = $('#book');
  const alive = () => reader.classList.contains('show') && !!cur();
  /* 停在「合着的书」（封面 / 封底）就不用再合；否则**合一次**就够（见 closeBookOnce 的注释） */
  if (!isClosedView()) {
    /* 合书链（活页的 foldBook / flipDone）万一没 resolve，也要继续走飞回动画，
       不能整段卡在这里变成「关闭没动画」。超时后强制把叶片落定。 */
    await Promise.race([
      closeBookOnce(),
      new Promise(r => setTimeout(r, FOLD_MS + 320))
    ]);
    if (flipA) endFlip();
    if (!alive()) { endClose(true); return; }
  }
  /* 封面那一页的位置（可能是左槽也可能是右槽） */
  const from = coverPageRect() || fallbackCoverRect();
  state.page = -1; state.spread = -1;          // 统一归位到封面态
  flyCover(to, from, true, null, () => {
    /* 相位 ②：书已经缩回到书架玻璃上方 —— 主页这才显现出来，紧接着 ghost 插回书架。
       玻璃副本同步淡入并顶班到落地，插回那一段它一直压在书脚上。 */
    const home = $('#home');
    home.classList.remove('book-returning');
    home.classList.add('book-appearing');
    if (flyGlassNode) flyGlassNode.classList.remove('hidden', 'fade');
  });
  /* 封面交给 ghost 去飞回主页：这里立刻隐藏，不留淡出 */
  book.classList.add('gone');
  // 主页显现的时机交给 flyCover 两段交界处的回调，别再另开一个会错开相位的定时器
  setTimeout(endClose, FLY_OUT_MS * 0.8);
}
function closeReader() {
  cancelFlip();
  closeScrub();
  closeAddMenu();
  commitTextEdit();
  hideTextBar();
  const home = $('#home'), reader = $('#reader'), book = $('#book');
  if (!reader.classList.contains('show')) return;
  /* 从封底退出：先把书翻回封面那一面，再让封面飞回书架。
     主页书架上摆的永远是封面，直接拿封底去缩回去会「封底飞着飞着变成封面」。 */
  if (isBackView()) { state.page = -1; state.spread = -1; renderReader(); }
  const reduced = window.matchMedia('(prefers-reduced-motion:reduce)').matches;
  /* 书架模式先把要落位的那本滚进视野，不然封面飞回去会飞到屏幕外 */
  if (state.prefs.view === 'shelf') {
    const el = $(`#shelfWrap .book-item[data-i="${state.sel}"]`);
    if (el && el.scrollIntoView) el.scrollIntoView({ block: 'center' });
  } else if (state.prefs.view === 'spine') {
    const el = $(`#spineRow .spine-item[data-i="${state.sel}"]`);
    if (el && el.scrollIntoView) el.scrollIntoView({ block: 'nearest', inline: 'center' });
  }
  /* 主页先无过渡地回到最终布局，再量封面位置 —— 否则量到的是缩放中的尺寸，落点会偏。
     ⚠️ fly-zoom 留到 endClose 与 .show 一起摘：现在摘会让 #reader.show 的 fadeIn
        在退场开场重播一次；fly-lift 是打开专用的相位，这里先收掉。 */
  $('#app').classList.remove('fly-lift');
  home.classList.add('noanim');
  home.classList.remove('book-opening', 'book-appearing');
  home.classList.add('book-returning');
  void home.offsetWidth;                       // 强制回流，让上面的变化立即生效
  home.classList.remove('noanim');
  const to = coverRect() || fallbackCoverRect();
  book.classList.remove('folded', 'gone');
  if (reduced) {
    $('#app').classList.remove('fly-lift', 'fly-zoom');
    flyGlassCleanup();
    reader.classList.remove('show');
    home.classList.remove('book-returning', 'book-appearing');
    book.classList.remove('book-in', 'book-out', 'gone', 'folded', 'folding', 'folding-back', 'back-hinge', 'back-close', 'back-opening', 'cover-flip');
    $$('#spineRow .spine-item.pulling,#spineRow .spine-item.gone')
      .forEach(el => el.classList.remove('pulling', 'gone'));
    return;
  }
  if (flyBusy) {                               // 飞入 / 退场动画没播完就再点：直接收掉
    $$('.cover-ghost').forEach(g => g.remove());   // 别让被打断的封面继续飞到空背景上
    endClose(true);
    return;
  }
  armFlyBusy(FLY_OUT_MS + 1400);
  reader.classList.add('closing');
  runCloseSequence(to);
}
$('#backBtn').onclick = closeReader;
$('#prevBtn').onclick = () => flip(-1);
$('#nextBtn').onclick = () => flip(1);
/* 右上角「添加」：弹出菜单选加页 / 图片 / 文字 */
$('#rAdd').onclick = e => {
  e.stopPropagation();
  toggleAddMenu();
};
$$('#addMenu [data-addact]').forEach(btn => {
  btn.addEventListener('click', e => {
    e.stopPropagation();
    const act = btn.dataset.addact;
    /* 「本页底色」走底部弹窗（和编辑文字同一套），菜单先收，弹窗自己会关 */
    if (act === 'bg') { openBgSheet(currentAddPage()); return; }
    closeAddMenu();
    if (act === 'img') { addImageTo(currentAddPage()); return; }
    /* 跨页图：选一张横图 → 从中间裁成两半，各自铺满一页（见 io-photobook.js 的 addSpreadImage）。
       传进去的参考页决定它插在哪一跨页后面 */
    if (act === 'spread') { pickSpreadImage(currentAddPage()); return; }
    if (act === 'text') { addTextTo(currentAddPage()); return; }
    /* 贴纸：便利贴 / 装饰胶带 / 手绘图案，面板自己会关掉菜单 */
    if (act === 'sticker') { openStickerSheet(currentAddPage()); return; }
    /* 跨本复制：勾一页或多页 → 挑目标手帐 → 追加到目标末尾 */
    if (act === 'copy') { openCopyPanel(); return; }
    if (act === 'del') { deleteCurrentPage(); return; }
    addPageAfter();
  });
});
/* 「左页 / 右页」切换：直接选新内容加到哪一页，菜单保持展开 */
$$('#amTarget .am-side').forEach(btn => {
  btn.addEventListener('click', e => {
    e.stopPropagation();
    const [a, b] = currentIndices();
    const pid = btn.dataset.side === 'L' ? a : b;
    if (pid < 0 || !cur().pages[pid]) return;
    setAddTarget(pid); markAddTarget(); updateAddMenuHint();
  });
});
document.addEventListener('pointerdown', e => {
  const m = $('#addMenu');
  if (!m || !m.classList.contains('show')) return;
  if (e.target.closest('#addMenu') || e.target.closest('#rAdd')) return;
  if (e.target.closest('#book')) return;      // 菜单展开时点页面 = 挑加到哪一页，不关菜单
  closeAddMenu();
  markFlipSuppressed();             // 点空白处刚关掉菜单：这一下不该翻页
}, true);

/* 加页：插在「目标页」的后面（双页模式下可以在左页后，也可以在右页后） */
function addPageAfter() {
  const j = cur(); if (!j) return;
  if (state.mode === 'spread' && !isClosedView()) {
    const [a, b] = currentIndices();
    const t = currentAddPage();
    // 目标页是右页就插在右页后（落到下一跨页的左页），否则插在左页后（就是当前跨页的右页）
    const at = (t === b && j.pages[b]) ? b + 1 : a + 1;
    j.pages.splice(at, 0, mkPage());
    save();
    state.spread = clamp(spreadIndexOfPage(at), 0, spreadCount(j.pages.length) - 1);
    setAddTarget(at);              // 新页直接成为下一个添加目标
    renderReader();
    toast('已在第 ' + at + ' 页后加一页');
  } else {
    const at = state.page + 1;                 // 封面态 page=-1 → 插到最前面
    j.pages.splice(Math.max(at, 0), 0, mkPage());
    save();
    state.page = Math.max(at, 0);
    renderReader();
    toast(at <= 0 ? '已在封面后加一页' : '已在第 ' + at + ' 页后加一页');
  }
  renderHome();                 // 主页封面的「N 页」角标跟着更新
}
/* 删除当前目标页：双页模式下先在菜单里点「左页 / 右页」挑要删哪一页，再点删除 */
function deleteCurrentPage() {
  const j = cur(); if (!j) return;
  if (!j.pages.length) { toast('这一本已经没有页面了'); return; }
  const p = currentAddPage();
  const pg = j.pages[p];
  if (!pg) { toast('这一页不存在'); return; }
  if (j.pages.length <= 1) { toast('至少得留一页，不能再删了'); return; }
  const nImg = (pg.images || []).length, nTxt = (pg.texts || []).length;
  const doDelete = () => {
    j.pages.splice(p, 1);
    /* 删完把视图拉回合法范围，别停在已经不存在的页上 */
    if (state.mode === 'spread') {
      state.spread = clamp(state.spread, 0, spreadCount(j.pages.length) - 1);
    } else {
      state.page = clamp(state.page, 0, j.pages.length - 1);
    }
    setAddTarget(Math.min(p, j.pages.length - 1));
    state.pendingPage = null;
    save(); renderReader(); renderHome();
    toast('已删除第 ' + (p + 1) + ' 页');
  };
  /* 空白页直接删，有内容的先问一句 */
  if (!nImg && !nTxt) { doDelete(); return; }
  const what = [nImg ? nImg + ' 张图片' : '', nTxt ? nTxt + ' 段文字' : ''].filter(Boolean).join(' 和 ');
  askConfirm(`第 ${p + 1} 页上的 ${what}会一起删掉，删了就找不回来了。`, {
    title: '删除这一页', ok: '删除', onOk: doDelete
  });
}

/* ==================== 跨本复制页面（单页 / 多页） ====================
   入口：阅读器右上角「＋ → 复制页面到…」。源本是当前打开的这一本，
   勾选任意多页后挑一本目标手帐，按页码顺序**追加**到目标本末尾。
   ⚠️ 页面里的每个图片 / 文字对象都要换一个新 id：id 是页内对象的唯一键，
      两本里出现同 id 会让选中态、工具条、换图串台。其余字段（含页底色）原样深拷贝。
   ⚠️ 目标本可能是加密本：统一走 guardUnlocked(tgt, doCopyPages)，解锁后重入本函数，
      重入时按 id 重新 find —— 解锁会用明文替换 state.journals，旧引用会失效。 */
const copyState = { picked: new Set(), target: '' };
function cloneCopyPage(pg) {
  const c = JSON.parse(JSON.stringify(pg || {}));
  (c.images || []).forEach(im => { im.id = uid(); });
  (c.texts || []).forEach(t => { t.id = uid(); });
  return c;
}
function renderCopyPages() {
  const j = cur(), box = $('#copyPages');
  if (!box || !j) return;
  box.innerHTML = (j.pages || []).map((pg, i) => {
    const ni = (pg.images || []).length, nt = (pg.texts || []).length;
    const info = [ni ? ni + ' 张图' : '', nt ? nt + ' 段文字' : ''].filter(Boolean).join(' · ') || '空白页';
    return `<button class="cp2-page${copyState.picked.has(i) ? ' on' : ''}" data-pg="${i}">
      <span class="cp2-page-thumb"><b>${i + 1}</b></span>
      <span class="cp2-page-tx">第 ${i + 1} 页<small>${info}</small></span>
      <i class="cp2-tick">✓</i>
    </button>`;
  }).join('');
}
function renderCopyTargets() {
  const j = cur(), box = $('#copyTargets');
  if (!box || !j) return;
  const list = state.journals.filter(x => x && x.id !== j.id);
  box.innerHTML = list.length ? list.map(t => {
    const cv = t.cover && /^#[0-9a-f]{3,8}$/i.test(String(t.cover.value || '')) ? t.cover.value : '#b9bec9';
    const locked = typeof journalHasLock === 'function' && journalHasLock(t) ? ' · 已加密' : '';
    return `<button class="cp2-target${copyState.target === t.id ? ' on' : ''}" data-tid="${t.id}">
      <span class="cp2-target-sw" style="background:${cv}"></span>
      <span class="cp2-target-tx">${esc(t.name || '未命名手帐')}<small>${(t.pages || []).length} 页${locked}</small></span>
      <i class="cp2-tick">✓</i>
    </button>`;
  }).join('') : '<p class="cp2-empty">书架里还没有别的手帐本，先新建一本吧</p>';
  const ok = $('#copyOk'); if (ok) ok.disabled = !copyState.target;
}
function openCopyPanel() {
  const j = cur();
  if (!j || !j.pages || !j.pages.length) { toast('这一本还没有页面可以复制'); return; }
  copyState.picked = new Set([clamp(currentAddPage(), 0, j.pages.length - 1)]);  // 默认勾当前页
  copyState.target = '';
  renderCopyPages();
  renderCopyTargets();
  const m = $('#copyMask'); if (m) m.hidden = false;
}
function closeCopyPanel() {
  const m = $('#copyMask'); if (m) m.hidden = true;
  markFlipSuppressed();
}
function doCopyPages() {
  const src = cur();
  const ids = [...copyState.picked].sort((a, b) => a - b);
  const tid = copyState.target;
  if (!src || !ids.length) { toast('先勾选要复制的页面'); return; }
  if (!tid) { toast('先选一本目标手帐'); return; }
  let tgt = state.journals.find(x => x && x.id === tid);
  if (!tgt) { toast('目标手帐不存在'); closeCopyPanel(); return; }
  if (!guardUnlocked(tgt, doCopyPages)) return;      // 加密本：解锁后重入
  tgt = state.journals.find(x => x && x.id === tid) || tgt;
  const pages = ids.filter(i => src.pages[i]).map(cloneCopyPage);
  if (!pages.length) { toast('这些页面已经不存在了'); return; }
  if (!Array.isArray(tgt.pages)) tgt.pages = [];
  tgt.pages.push(...pages);
  save();
  closeCopyPanel();
  renderHome();
  toast('已把 ' + pages.length + ' 页复制到《' + (tgt.name || '未命名手帐') + '》', 2800);
}
(() => {
  const pages = $('#copyPages'), targets = $('#copyTargets');
  if (pages) pages.addEventListener('click', e => {
    const b = e.target.closest('.cp2-page'); if (!b) return;
    const i = Number(b.dataset.pg);
    if (copyState.picked.has(i)) copyState.picked.delete(i); else copyState.picked.add(i);
    b.classList.toggle('on', copyState.picked.has(i));
  });
  if (targets) targets.addEventListener('click', e => {
    const b = e.target.closest('.cp2-target'); if (!b) return;
    copyState.target = b.dataset.tid;
    renderCopyTargets();
  });
  const ok = $('#copyOk'); if (ok) ok.onclick = doCopyPages;
  const close = $('#copyClose'); if (close) close.onclick = closeCopyPanel;
  const back = $('#copyBack'); if (back) back.onclick = closeCopyPanel;   // 移动端左上返回
  const cancel = $('#copyCancel'); if (cancel) cancel.onclick = closeCopyPanel;
  const mask = $('#copyMask');
  if (mask) mask.addEventListener('click', e => { if (e.target === mask) closeCopyPanel(); });
  window.addEventListener('keydown', e => {
    const m = $('#copyMask');
    if (e.key === 'Escape' && m && !m.hidden) closeCopyPanel();
  });
})();
