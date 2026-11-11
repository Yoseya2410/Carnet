/* =====================================================================
 * Carnet · 翻页动画 · 叶片翻转   （脚本 14 / 27）
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
function endFlip() {
  if (!flipA) return;
  cancelAnimationFrame(flipA.raf);
  const dir = flipA.dir;
  flipA = null;
  /* 第二道防线：落定时把页码夹回合法范围（-1 = 封面）。
     快翻 / 删页 / 外部跳页叠在一起时，光靠 flip 入口的判断挡不住累加越界。 */
  const n = pageCount();
  if (state.mode === 'spread') {
    state.spread = clamp(state.spread + dir, -1, Math.max(spreadCount(n) - 1, -1));
  } else {
    state.page = clamp(state.page + dir, -1, Math.max(n - 1, -1));
  }
  const leaf = $('#leaf');
  leaf.classList.remove('show', 'turning');
  leaf.style.transition = 'none';
  leaf.style.transform = 'none';
  clearBookShift();                            // 清掉「翻开 / 合上」时的临时位移
  renderReader();
}
/* 清掉翻开 / 合上封面时临时写在书上的横移与「翻的是封面」标记（内联样式优先于 cover-only 的类）。
   ⚠️ cover-closing 必须一起摘：它把右页淡到透明，留着会让合上之后那一页不再出现 */
function clearBookShift() {
  const bk = $('#book');
  if (!bk) return;
  bk.style.transform = '';
  bk.classList.remove('cover-flip', 'cover-closing', 'cover-opening', 'gutter-hold');
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
    $('#book').classList.remove('gutter-hold');
  }
  const deg = flipA.from + (flipA.to - flipA.from) * e;
  // 翻到中途把纸轻轻"抬"起来一点，避免转动看起来是纯 2D 压扁
  const lift = Math.sin(p * Math.PI) * 30;
  $('#leaf').style.transform = `translateZ(${lift.toFixed(1)}px) rotateY(${deg.toFixed(3)}deg)`;
  /* 封面 ↔ 第一跨页：书同时「摊开 / 合拢」——整本横移半页宽，
     前 42% 就把位移补齐，剩下的动作跟普通翻页一模一样 */
  if (flipA.slide) {
    const sp = clamp(p / 0.42, 0, 1), se = sp * sp * (3 - 2 * sp);
    const [s0, s1] = flipA.slide;
    $('#book').style.transform = `translateX(${(s0 + (s1 - s0) * se).toFixed(1)}px)`;
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
    $('#book').classList.toggle('last-spread',
      bookStyleOf(cur()).rings && (dir > 0 ? sR : cR) >= n);
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
      $('#slotL').innerHTML = '';
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

