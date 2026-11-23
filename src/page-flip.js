/* =====================================================================
 * Carnet · 翻页动画 · 叶片翻转   （脚本 15 / 28）
 * ---------------------------------------------------------------------
 * ① 三次贝塞尔求值器 cubicBezier 与翻页专用曲线 EASE_FLIP
 * ② 单步翻页 stepFlip / flip：叶片沿书脊翻转、深度压暗（活页中缝机构延迟到 60% 才出场）
 * ③ 翻页位移清理 clearBookShift 与动画取消 cancelFlip
 * ④ ⚠️ flip 用 layoutBook 写下的 state.pw 算半页位移 —— 翻页前必须先跑过 layoutBook
 *
 * 对外接口：flip, stepFlip, cancelFlip, clearBookShift, cubicBezier
 *
 * 依赖模块：core, state, reader-view
 *
 * 说明：模块间共用全局作用域，加载顺序即依赖顺序（见 index.html 与 README）。
 * ===================================================================== */
/* ==================== 翻页 ==================== */
/* 逐帧驱动：翻页过程中可以立刻接受下一次翻页，不必等动画播完 */
/* 三次贝塞尔求值器：用牛顿迭代反解 t，翻页曲线可以随手调 */
function cubicBezier(x1, y1, x2, y2) {
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
  const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  const fx = t => ((ax * t + bx) * t + cx) * t;
  const dfx = t => (3 * ax * t + 2 * bx) * t + cx;
  const fy = t => ((ay * t + by) * t + cy) * t;
  return x => {
    if (x <= 0) return 0; if (x >= 1) return 1;
    let t = x;
    for (let i = 0; i < 6; i++) {
      const e = fx(t) - x; if (Math.abs(e) < 1e-5) break;
      const d = dfx(t); if (Math.abs(d) < 1e-6) break;
      t -= e / d;
    }
    return fy(Math.min(Math.max(t, 0), 1));
  };
}
/* 起步稍缓、中段快、收尾绵长 —— 比对称的 easeInOut 更接近真纸 */
const EASE_FLIP = cubicBezier(.42, 0, .24, 1);
/* 活页：摊开封面那一翻，中缝机构（含环）到动画这个进度才淡出来（见 flip / stepFlip） */
const RINGS_SHOW_AT = .6;
let flipA = null, lastFlipAt = 0;
/* 「这一回翻页自己加上了 .has-under」标记：只有自己加的才在收尾时摘（见 clearBookShift） */
let flipUnder = false;
/* 「这一回翻页自己按住了中缝」标记：只有自己按的才由自己摘（收尾 / 取消时见 clearBookShift） */
let gutterHold = false;
/* 翻页每帧只写 transform / CSS 变量，#leaf / #book 这两个节点在动画期间不会换。
   缓存下来省掉每帧的 querySelector；万一外部重绘把节点换掉（isConnected=false），
   惰性重查一次，绝不会拿着脱离文档的旧节点继续写。 */
let flipLeafEl = null, flipBookEl = null;
function flipLeaf() {
  if (!flipLeafEl || !flipLeafEl.isConnected) flipLeafEl = $('#leaf');
  return flipLeafEl;
}
function flipBook() {
  if (!flipBookEl || !flipBookEl.isConnected) flipBookEl = $('#book');
  return flipBookEl;
}
function endFlip() {
  if (!flipA) return;
  cancelAnimationFrame(flipA.raf);
  const a = flipA;
  flipA = null;
  /* 合书 / 合到封底 / 从封底翻开这几翻用的是自定义落点（onEnd）。被下一次快翻打断时
     直接替它落定，别把叶片丢在半路上，也不能走下面的 +dir（那会把页码算错一页）。 */
  if (a.onEnd) { clearBookShift(); a.onEnd(); return; }
  const dir = a.dir;
  /* 第二道防线：落定时把页码夹回合法范围（-1 = 封面、-3 = 封底）。
     快翻 / 删页 / 外部跳页叠在一起时，光靠 flip 入口的判断挡不住累加越界。 */
  const n = pageCount();
  if (state.mode === 'spread') {
    state.spread = clampViewIndex(state.spread + dir, spreadCount(n) - 1);
  } else {
    state.page = clampViewIndex(state.page + dir, n - 1);
  }
  const leaf = flipLeaf();
  leaf.classList.remove('show', 'turning');
  leaf.style.transition = 'none';
  leaf.style.transform = 'none';
  leaf.style.removeProperty('--turn');          // 翻完把受光变量收干净，别留在下一次翻页
  leaf.style.removeProperty('--lift');
  clearBookShift();                            // 清掉「翻开 / 合上」时的临时位移
  /* 起手时四块内容已经按这次翻页摆好，落定只交接被叶片盖住的那一侧：
     · 双页往前：右槽已是新右页，只换左槽；往后则相反。
     · 单页往前：右槽已是下一页；往后才把叶正面的上一页交回右槽。
     再让 renderReader(true) 只同步类名 / 页码 / 几何，不重复建铁环、封面底板
     和另外那张已经正确的页面。首次活页翻页尤其需要避开这次整棵 3D 子树重建。 */
  const [ia, ib] = currentIndices();
  if (state.mode === 'spread') {
    if (dir > 0) $('#slotL').innerHTML = pageHTML(ia, 'left');
    else $('#slotR').innerHTML = pageHTML(ib, 'right');
  } else if (dir < 0) {
    $('#slotR').innerHTML = pageHTML(state.page, 'single');
  }
  renderReader(true);
}
/* 清掉翻开 / 合上封面时临时写在书上的横移与「翻的是封面」标记（内联样式优先于 cover-only 的类）。
   ⚠️ cover-closing 必须一起摘：它把右页淡到透明，留着会让合上之后那一页不再出现 */
function clearBookShift() {
  const bk = flipBook();
  if (!bk) return;
  bk.style.transform = '';
  bk.classList.remove('cover-flip', 'cover-closing', 'cover-opening', 'gutter-hold', 'folding-back', 'back-hinge', 'back-close', 'back-opening');
  gutterHold = false;                          // 翻页已收束：中缝一律放开，别压在下一翻上
  /* ⚠️ has-under **只摘自己加的那一回**（单页模式翻开封面的那一翻，见 flip）：
     双页合书时那层封面内侧是 renderReader 按状态开着的、还得靠
     .book.folding .book-under 裁掉左半张，无差别摘掉会把本子的底一起撤了。 */
  if (flipUnder) { bk.classList.remove('has-under'); flipUnder = false; }
}
function cancelFlip() {
  if (flipA) { cancelAnimationFrame(flipA.raf); flipA = null; }
  clearBookShift();
}
function stepFlip(now) {
  if (!flipA) return;
  const p = clamp((now - flipA.t0) / flipA.dur, 0, 1);
  const e = EASE_FLIP(p);
  /* 活页摊开第一页：中缝机构（含环）压到进度 60% 才放出来 ——
     起手那一刻书还收着、封面正压在上面，环要是第一帧就在，看着就是浮在封面上的一排亮片。
     ⚠️ 只摘一次：摘完立刻清标记，后面每一帧不用再碰 DOM */
  if (gutterHold && p >= RINGS_SHOW_AT) {
    gutterHold = false;
    flipBook().classList.remove('gutter-hold');
  }
  const deg = flipA.from + (flipA.to - flipA.from) * e;
  // 翻到中途把纸轻轻"抬"起来一点，避免转动看起来是纯 2D 压扁
  const lift = Math.sin(p * Math.PI) * 30;
  const leaf = flipLeaf();
  leaf.style.transform = `translateZ(${lift.toFixed(1)}px) rotateY(${deg.toFixed(3)}deg)`;
  /* 只让压暗强度跟角度走；高光背景与叶片阴影已是静态值（reader.css）。
     --lift 不再写 CSS：3D translateZ 已负责抬升，少一次全子树样式失效。
     ⚠️ 纯内联属性写入，绝不读 rect / clientWidth —— 每帧读布局会强制重排。 */
  leaf.style.setProperty('--turn', Math.min(1, Math.abs(deg) / 180).toFixed(3));
  /* 封面 ↔ 第一跨页：书同时「摊开 / 合拢」——整本横移半页宽，
     前 42% 就把位移补齐，剩下的动作跟普通翻页一模一样 */
  if (flipA.slide) {
    const sp = clamp(p / 0.42, 0, 1), se = sp * sp * (3 - 2 * sp);
    const [s0, s1] = flipA.slide;
    flipBook().style.transform = `translateX(${(s0 + (s1 - s0) * se).toFixed(1)}px)`;
  }
  if (p < 1) flipA.raf = requestAnimationFrame(stepFlip);
  // onEnd：合书时借这套引擎翻一次，翻完自行收束，不走 endFlip（那会改页码并重绘）
  else if (flipA.onEnd) { const cb = flipA.onEnd; flipA = null; cb(); }
  else endFlip();
}
function flip(dir) {
  const n = pageCount();
  if (!n) return;
  commitTextEdit();                    // 翻页前先把正在编辑的文字存下来
  /* ⚠️ 必须先让上一翻落定、再检查边界：页码要等 endFlip 才真正 +dir。
     以前是「先检查、后 endFlip」，快速连翻时每次都拿同一个旧页码判断，
     连按两下就能越过最后一跨 —— 截图里「3 / 2」且两页全是环衬就是这么来的。 */
  // 上一次翻页还没结束：立即落定，接着翻下一页，实现连续快翻
  if (flipA) endFlip();
  /* ---- 封底：最后一页往后翻 = 合上书显示封底；封底只能往前翻回最后一页 ----
     ⚠️ 没设封底（hasBackCover 为假）时 below 的边界守卫照旧把这一下挡掉，
        阅读器完全保持原来的行为：到最后一页就翻不动了，只能往前翻。 */
  if (isBackView()) {
    if (dir < 0) openFromBack();
    return;
  }
  const atLast = state.mode === 'spread'
    ? state.spread >= spreadCount(n) - 1
    : state.page >= n - 1;
  if (dir > 0 && atLast) {
    /* 移动端不论有没有封底都停在最后一页；电脑端有封底才合书到封底 */
    if (hasBackCover(cur()) && backCoverFlipAllowed()) closeToBack();
    return;
  }
  if (state.mode === 'spread') {
    const pairs = spreadCount(n), s = state.spread;
    if (dir > 0 && s >= pairs - 1) return;
    if (dir < 0 && s <= -1) return;
  } else {
    const p = state.page;
    if (dir > 0 && p >= n - 1) return;
    if (dir < 0 && p <= -1) return;
  }

  const leaf = $('#leaf'), lf = $('#leafF'), lb = $('#leafB');
  /* 起手就会替换槽位，先摘旧文字贴的 document 监听；复用落定后旧节点已经离场，
     再清理就找不到它们了。 */
  dropSlotTextListeners('#slotL'); dropSlotTextListeners('#slotR');
  let start, end, slide = null;
  if (state.mode === 'spread') {
    const s = state.spread;
    let front, back, sL, sR;
    /* ⚠️ 左右两个槽位在动画期间填的是**当前**那一跨的页，不是下一跨的：
         叶片抬起时露出的下面那页 = 下一跨（所以右页填 sR），
         而叶片落下去盖住的那半边在被盖住之前必须还是当前页（左页填 cL）。
         反过来往回翻同理：左页填 sL（叶片抬起后露出来的），右页填 cR（叶片落下去才盖住）。
         两边都填下一跨的话，动画才转到一半、对面就已经变成新内容了 —— 一眼假。 */
    const [cL, cR] = spreadIndices(s);           // 当前这一跨的左右页
    if (dir > 0) { [sL, sR] = spreadIndices(s + 1); front = cR; back = sL; }
    else { [sL, sR] = spreadIndices(s - 1); front = sR; back = cL; }
    /* 活页第二跨 → 第一跨：左槽此刻已经换成封面内侧，立刻同步第一跨的透明槽样式。
       等到 endFlip 才加 .first-spread 的话，动画期间左槽只剩 .page-slot 的纸色底，
       看起来就是一张白纸停在左边，收尾时才突然变成封面内侧。 */
    if (bookStyleOf(cur()).rings && dir < 0 && s === 1) $('#book').classList.add('first-spread');
    /* 最后一跨的右半是后封面内侧：动画期间右槽填的就是那一格（dir>0 填 sR、dir<0 填 cR），
       越界就得同步透明样式，否则翻到最后一页的中途会闪一块白底 / 深蓝环衬。
       endFlip → renderReader 会按最终页码重新 toggle 一次。 */
    /* ⚠️ 不再限定活页：胶装本最后一跨的右格是环衬，同样要按 last-spread 去掉右白边 */
    $('#book').classList.toggle('last-spread',
      (dir > 0 ? sR : cR) >= n);
    $('#slotL').innerHTML = pageHTML(dir > 0 ? cL : sL, 'left');
    $('#slotR').innerHTML = pageHTML(dir > 0 ? sR : cR, 'right');
    lf.innerHTML = pageHTML(front, 'right');
    lb.innerHTML = pageHTML(back, 'left');
    start = dir > 0 ? 0 : -180;
    end = dir > 0 ? -180 : 0;
    /* 封面单独一页 ↔ 第一跨页：照样翻纸，同时让整本书横移「半张封面」完成摊开 / 合拢。
       封面打开：位移 -半张 → 0；合回封面：0 → -半张。
       ⚠️ 横移的是**封面**的半宽，不是内页的：活页的封面含内侧露边与半道中缝，
          拿内页宽去移会少走一截，摊开瞬间整本往左蹦一下。 */
    const st = bookStyleOf(cur());
    const coverK = st.rings ? 1 + (st.padX || 0) + (st.gap || 0) / 2 : 1;
    const coverW = (state.pw || 0) * (s === -1 ? 1 : coverK);   // 封面态 state.pw 已经是封面宽
    const half = coverW / 2;
    if (s === -1 && dir > 0) slide = [-half, 0];
    else if (s === 0 && dir < 0) { slide = [0, -half]; $('#book').classList.add('cover-only'); }
    /* 封面 ↔ 第一跨页：翻的得是整张封面板（比内页大一圈，见 reader.css 的 .cover-flip），
       不然合上的是一张纸、落地还要跳成封面大小。
       摊开 / 合拢过程中左槽不参与，封面内侧由 .book-under 铺出来。
       打开时先切到内页尺寸并铺好底层，右侧第一页从动画第一帧起就是正常纸张，
       不会先以封面态的白底露一段、落地后才变成内页。 */
    if (slide) {
      const bk = $('#book');
      /* ⚠️ 非活页没有 .book-under 那层封面内侧，左槽留空会在摊开 / 合拢的
         交接处露出整块白纸。按**落地后第一跨**补上左页：合拢方向左槽可见时
         能直接看到纸，落地 renderReader() 填的是同一页，不会跳变；打开方向
         .cover-opening 会把左槽 visibility:hidden，那半边仍由封面叶片覆盖。
         活页仍走 .book-under，左槽保持空，别重复铺。 */
      $('#slotL').innerHTML = st.rings ? '' : pageHTML(spreadIndices(0)[0], 'left');
      bk.classList.add('cover-flip');
      if (dir > 0) {
        state.spread = 0;
        layoutBook();
        state.spread = -1;
        bk.classList.add('spread', 'cover-opening');
        /* 只有活页才有内页底下那张封面内侧。笔记本 / 画册不能临时铺这层，
           否则打开第一页时底部会露出一张灰色封面板，收尾重绘时又突然消失。 */
        if (st.rings) {
          /* 中缝机构（含环）先按住：等这一翻走到 60% 再淡入（见 stepFlip）。
             ⚠️ 现在 --pw 已经按落点那一跨重排过、书还收在封面态，环立刻画出来会浮在封面上 */
          bk.classList.add('gutter-hold');
          gutterHold = true;
          $('#bookUnder').innerHTML = coverUnderBoardsHTML();
          bk.classList.add('has-under', 'first-spread');
          flipUnder = true;
        }
        bk.classList.remove('cover-only');
      } else {
        /* 这里只裁掉正在被翻起的左半张封面板；右侧第一页保留到封面叶片真正盖住它。
           不再给右槽加淡出，否则封面还在左边时，右侧就已提前变成封面。 */
        bk.classList.add('cover-closing');
      }
    }
  } else {
    const p = state.page;
    if (dir > 0) {
      $('#slotR').innerHTML = pageHTML(p + 1, 'single');
      lf.innerHTML = pageHTML(p, 'single');
      lb.innerHTML = pageHTML(p + 1, 'single');
      start = 0; end = -180;
    } else {
      $('#slotR').innerHTML = pageHTML(p, 'single');
      lf.innerHTML = pageHTML(p - 1, 'single');
      lb.innerHTML = pageHTML(p, 'single');
      start = -180; end = 0;
    }
    /* ---- 单页模式（手机竖屏 / 窄窗口）翻封面，翻的也得是「整张封面板」 ----
       双页模式下这一翻有 .cover-flip 那套几何（见上面），单页模式没有 ——
       叶片一直是内页尺寸（--pw × --ph），合上时翻的就是「内页那么大的一张封面」：
       活页的封面比内页大一圈（内页坐在封面内侧上、四周露一条边），
       叶片落在内页那一格里，右边和上下都还露着底下那张封面内侧，
       落地瞬间再跳成封面大小 —— 就是手机上看到的那个毛病。
       ⚠️ 反过来（封面 → 第 1 页）同样要处理，只是方向不同：此刻 --pw 还是**封面**宽，
          底下的那张纸会被画成封面那么大（四周没有封面边、也没有打孔那一列），
          封面转开露出它，落地那一帧又缩回内页大小 —— 反方向跳一下。
          所以打开时要**先把书按第 1 页的尺寸重排**（layoutBook 只改 CSS 变量、不重绘，
          画面此刻被叶片上的封面盖着，看不出来），并补上封面内侧那层（.has-under）。
          --cbrd-w / --cbrd-h 两个状态下都是「封面那张板」，叶片始终按板的尺寸走。 */
    const ringed1 = !!bookStyleOf(cur()).rings;
    if (ringed1 && ((dir > 0 && p === -1) || (dir < 0 && p === 0))) {
      const bk = $('#book');
      bk.classList.add('cover-flip');
      if (dir > 0) {
        state.page = p + 1; layoutBook(); state.page = p;   // 按落点那一页重排，再把页码放回去
        const bu = $('#bookUnder');
        if (bu) bu.innerHTML = coverUnderBoardsHTML();
        bk.classList.add('has-under'); flipUnder = true;
        /* 跟双页同一条规矩：摊开封面这一翻，机构条与环到 60% 才淡入 */
        bk.classList.add('gutter-hold'); gutterHold = true;
      }
    }
  }

  const now = performance.now();
  const gap = now - lastFlipAt;
  lastFlipAt = now;
  // 连着翻：动画自动缩短，越点越快，且不会出现"排队等前一页"
  const dur = gap < 150 ? 200 : (gap < 320 ? 270 : (gap < 620 ? 370 : 500));

  leaf.classList.add('show', 'turning');
  leaf.style.transition = 'none';
  leaf.style.transform = `rotateY(${start}deg)`;
  flipA = { dir, from: start, to: end, slide, t0: now, dur, raf: requestAnimationFrame(stepFlip) };
}


/* =====================================================================
 * 封底：最后一页往后翻 = 合上书显示封底（2026-11-16）
 * ---------------------------------------------------------------------
 * 封底不是一张正文页，而是「合着的书翻了个面」：几何跟封面态完全一样，
 * 只是朝外那张皮换成 backCoverPageHTML()。所以两处过渡都借现成的叶片引擎：
 *   ① 合上（closeToBack）：双页走 reader-flow.js 的 foldBook('back') → foldBookBack()
 *      （**右半边从右往左翻到左槽**，落地那一面是封底，跟合回封面正好镜像）；
 *      单页以**左侧书脊**为轴（末页朝上时书脊在左）**0° → -180°** 从右往左合上书（用户 11-17）。
 *   ② 翻开（openFromBack）：方向一律**从左往右**，落回最后一跨。
 *      双页仍是合书的镜像（左槽封底 -180° → 0° + 半页横移）；
 *      单页不再整本翻面 —— 真实的书停在封底时书脊在右，是以**右侧边为轴**
 *      把封底掀开（0° → 180°，用户 11-17），转出去的皮被单页外框裁掉、露出末页。
 *      ⚠️ 与 ① 的合书左轴**不是同一根轴**：两翻各用当前朝上那一面的书脊。
 * ⚠️ 这两翻都写 flipA.onEnd 自定义落点：endFlip() 被快翻打断时会先替它们落定。
 * ===================================================================== */
const BACK_FOLD_MS = 400;   // 与 reader-flow.js 的 FOLD_MS 同源：合书 / 摊开一个速度
/* 换槽内容前把文字贴挂在 document 上的监听摘掉（跟 renderReader / foldBook 同一套） */
function dropSlotTextListeners(sel) {
  $$(sel + ' .ptext-wrap').forEach(x => {
    if (x.__outDown) { document.removeEventListener('pointerdown', x.__outDown, true); x.__outDown = null; }
  });
}
function closeToBack() {
  /* 双页：右半边整格从右往左翻到左槽盖上，落定后朝外的是封底（见 foldBookBack） */
  if (state.mode === 'spread') { foldBook('back'); return; }
  /* 单页（手机竖屏）：末页朝上时**书脊在左**，合书绕左侧边把最后一页从右往左翻走、
     露出封底（用户 11-17 二次反馈「改为以左侧为轴合上书」）。
     叶片 0° → -180°：起手正面 = 最后一页（跟静止帧严丝合缝），槽里先摆封底，
     叶片收窄时从右边逐渐露出封底，转过 90° 后叶片被 .book.single 裁掉、画面只剩封底。
     ⚠️ 与「从封底往前翻」的**右轴**（.back-hinge）不共用一根轴：两翻各用当前朝上
        那一面的书脊；也别退回整本绕中轴翻面（.back-turn 已整块撤掉）。 */
  const book = $('#book'), leaf = $('#leaf'), lf = $('#leafF'), lb = $('#leafB');
  const p = state.page, backHTML = backCoverPageHTML();
  dropSlotTextListeners('#slotR');
  $('#slotR').innerHTML = backHTML;       // 叶片翻走后露出的封底
  lf.innerHTML = pageHTML(p, 'single');   // 0°：起手盖住整本 = 最后一页
  lb.innerHTML = backHTML;                // -180°：叶背，转出书外被裁掉
  /* ⚠️ 起手不挂 .back-view：外框圆角要跟「最后一页」同档，否则叶片的正面圆角
     与外框对不上，封底会从四角露出粉色月牙（实测）；封底态的圆角由落定那次
     renderReader() 统一挂上。 */
  book.classList.add('back-close');
  leaf.classList.add('show', 'turning');
  leaf.style.transition = 'none';
  leaf.style.transform = 'rotateY(0deg)';
  flipA = {
    dir: 1, from: 0, to: -180, dur: BACK_FOLD_MS, t0: performance.now(), raf: 0,
    onEnd: () => {
      leaf.classList.remove('show', 'turning');
      leaf.style.transition = 'none'; leaf.style.transform = 'none';
      book.classList.remove('back-close', 'back-view');
      state.page = PAGE_BACK_COVER; state.spread = PAGE_BACK_COVER;
      renderReader();
    }
  };
  requestAnimationFrame(stepFlip);
}
function openFromBack() {
  const n = pageCount();
  if (!n) return;
  const book = $('#book'), leaf = $('#leaf'), lf = $('#leafF'), lb = $('#leafB');
  const backHTML = backCoverPageHTML();
  const st = bookStyleOf(cur()), ringed = !!st.rings;
  /* 封底态的 state.pw 就是「合着的封面宽」，摊开时整本要横移这半张宽 */
  const half = (state.pw || 0) / 2;
  const land = () => {
    leaf.classList.remove('show', 'turning');
    leaf.style.transition = 'none'; leaf.style.transform = 'none';
    clearBookShift();                  // 撤掉 cover-flip / cover-opening / 临时横移 / has-under
    book.classList.remove('folding', 'folding-back', 'folded', 'back-hinge', 'back-close', 'back-opening');
    renderReader();
  };
  if (state.mode === 'spread') {
    /* 从封底往前翻 = 合书的逆过程：封底停在左槽（back-only），把它从 -180° 沿书脊
       往右翻到 0°，整本同时从 +半页横移回摊开的 0 —— **从左往右**，跟合上时
       的「从右往左」正好相反（用户 11-16 反馈原来这一翻方向反了）。
       ⚠️ 起手那一帧叶片盖在左槽显示封底，跟静止态一模一样，不会跳。 */
    const last = Math.max(spreadCount(n) - 1, 0);
    const [l, r] = spreadIndices(last);
    /* 按落点那一跨重排（--pw / --cbrd-* 换成内页坐标系），页码先留在封底态 */
    state.spread = last; layoutBook(); state.spread = PAGE_BACK_COVER;
    $('#slotL').innerHTML = pageHTML(l, 'left');    // 叶片转开后露出的左页
    /* ⚠️ 右槽在起手那帧**必须还是空的**：书此刻仍合着，叶片正盖在左槽上，
       右侧凭空先摆一张末页（环衬）会让人以为「还没翻就已经翻开了」（用户 11-16 反馈）。
       最后一跨的右页只放在叶片正面，等叶片 0° 盖过来才出现；落地由 renderReader() 重建槽。
       镜像「封面 → 第一跨」那翻的 `.cover-opening`（那边收的是左槽）。 */
    $('#slotR').innerHTML = '';
    lf.innerHTML = pageHTML(r, 'right');            // 0°：落到右槽 = 最后一跨的右页
    lb.innerHTML = backHTML;                        // -180°：起手盖住左槽 = 封底
    book.classList.remove('back-only');
    book.classList.add('cover-flip', 'spread', 'back-opening');
    book.classList.toggle('first-spread', ringed && last === 0 && spreadHasInsideCover());
    book.classList.toggle('last-spread', r >= n);
    if (ringed) {
      book.classList.add('gutter-hold'); gutterHold = true;
      const bu = $('#bookUnder'); if (bu) bu.innerHTML = coverUnderBoardsHTML();
      book.classList.add('has-under'); flipUnder = true;
    }
    leaf.classList.add('show', 'turning');
    leaf.style.transition = 'none'; leaf.style.transform = 'rotateY(-180deg)';
    flipA = {
      dir: 1, from: -180, to: 0, slide: [half, 0], dur: BACK_FOLD_MS,
      t0: performance.now(), raf: 0,
      onEnd: () => {
        state.spread = last;
        state.page = clamp(spreadIndices(last)[1], 0, Math.max(n - 1, 0));
        land();
      }
    };
  } else {
    /* 单页：真实的书停在封底时**书脊在右**，往前翻是抓着封底的左沿、
       以右侧边为轴从左往右把封底掀开（用户 11-17），不是整本绕中轴翻面。
       叶片绕自身右沿 0° → 180°（正角度让封底左沿朝读者抬起）：起手正面 = 封底、正好盖住整本；
       转过 90° 后叶片落到书的右侧外面、被 .book.single 的 overflow 裁掉，
       槽里早已摆好的最后一页露出来 —— 就是「封底被翻走、露出末页」。
       ⚠️ 合到封底（closeToBack）改用 .back-close 左轴（0° → -180°），
          两翻各用当前朝上那一面的书脊，别合并成一根轴心。 */
    const last = n - 1;
    state.page = last; layoutBook(); state.page = PAGE_BACK_COVER;
    $('#slotR').innerHTML = pageHTML(last, 'single');   // 封底翻走后露出的末页
    lf.innerHTML = backHTML;                            // 0°：起手盖住整本 = 封底
    lb.innerHTML = pageHTML(last, 'single');            // 180°：叶背，转出书外被裁掉
    book.classList.add('back-hinge');
    leaf.classList.add('show', 'turning');
    leaf.style.transition = 'none'; leaf.style.transform = 'rotateY(0deg)';
    flipA = {
      dir: 1, from: 0, to: 180, dur: BACK_FOLD_MS, t0: performance.now(), raf: 0,
      onEnd: () => { state.page = last; state.spread = last; land(); }
    };
  }
  requestAnimationFrame(stepFlip);
}
