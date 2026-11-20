/* =====================================================================
 * Carnet · 单层书架 3D 开合书（2026-11-20 重做，取代封面飞入 / Genie 漏斗）
 * ---------------------------------------------------------------------
 * 打开：书脊抽出（home-events 的 .pulling）→ 白场淡入、周围只剩这一本
 *       → 书立到屏幕中央，从书脊慢慢转到正面封面 → glide 进阅读器落点；
 * 关闭：封面在中央从正面转回书脊方向 → 缩成一根书脊插回架上原位
 *       → 白场淡出，周围的手账本重新显现。
 *
 * 实现选型：纯 CSS 3D（preserve-3d 书盒：封面 / 书脊 / 书口 / 封底四个面）。
 *   不引 three.js / WebGL —— 封面与书脊的皮全是项目自己的 DOM 渲染
 *   （coverHTML / spineBackdrop，与编辑、导出同源），WebGL 需要先把 DOM
 *   栅格化成纹理才能贴图，既降清晰度又破坏零依赖离线 PWA。CSS 3D 是真 3D
 *   旋转，视觉皮还逐像素一致。
 *
 * 对外接口：window.CarnetSpineFx = { open, close, teardown }
 *   reader-flow.js 在 openReader / runCloseSequence 里优先调它；
 *   返回 false（量不到矩形 / 没有书脊）时自动退回旧的 flyCover 路径。
 *
 * 依赖模块：core, state, home-view（closedCoverHTML / backCoverHTML）,
 *           visuals（bookRadiusOf）, reader-flow（armFlyBusy / freeFlyBusy /
 *           renderReader / coverPageRect / fallbackCoverRect / endClose）
 * ===================================================================== */
(function () {
'use strict';

const OPEN_MS = 1080;      /* 打开全程：抬起 → 转身 → 落入阅读器 */
const CLOSE_MS = 980;      /* 关闭全程：离位 → 转身 → 插回书架 */

let runId = 0;             /* 每趟动画一个号，被打断时旧 rAF 回调直接作废 */
let stage = null, white = null;

function easeIO(p) { return p < .5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2; }

/* ---------------- 白场与 3D 舞台 ---------------- */
/* 白场：z-index 56，压在主页与阅读器之上、3D 舞台（80）之下。
   打开时它先把周围藏成一片白；关闭收尾它淡出，书架原样显现。 */
function mkWhite() {
  const w = document.createElement('div');
  w.id = 'spfxWhite';
  $('#app').appendChild(w);
  void w.offsetWidth;                      // 建立基线再挂 .on，淡入才生效
  w.classList.add('on');
  white = w;
  return w;
}
function fadeWhite() {
  if (!white) return;
  const w = white; white = null;
  w.classList.remove('on'); w.classList.add('out');
  setTimeout(() => w.remove(), 420);
}
function mkStage() {
  const st = document.createElement('div');
  st.className = 'spfx-stage';
  $('#app').appendChild(st);
  stage = st;
  return st;
}
/* 收尾清理：动画被中途打断（返回键 / 连点）时由 endClose 调。
   ⚠️ 白场不硬删，改走淡出 —— 打断时书架可能还乱着，白场硬闪更难看。 */
function teardown() {
  runId++;
  if (stage) { stage.remove(); stage = null; }
  fadeWhite();
  $('#app').classList.remove('spinefx-hold', 'spinefx-enter');
}

/* ---------------- 3D 书盒 ----------------
   内容按**落点封面**的真实尺寸渲染（W×H），飞行全程只做 translate / rotateY /
   等比 scale —— 封面内容从头到尾不糊不变形（与 .cover-ghost 同一条规矩）。
   厚度 t 反推自真实书脊宽：θ=90° 时投影宽度 t·s 正好等于那根书脊的视觉宽。 */
function mkGhost(j, spineEl, W, H, t) {
  const book = document.createElement('div');
  book.className = 'spfx-book';
  book.style.width = W + 'px';
  book.style.height = H + 'px';
  const rr = bookRadiusOf(j).toFixed(1);
  const t2 = (t / 2).toFixed(1);

  /* 正面封面（朝外那一面） */
  const front = document.createElement('div');
  front.className = 'spfx-face spfx-front';
  front.style.transform = 'translateZ(' + t2 + 'px)';
  front.style.borderRadius = '5px ' + rr + 'px ' + rr + 'px 5px';
  const fitF = document.createElement('div');
  fitF.className = 'spfx-fit';
  fitF.innerHTML = closedCoverHTML(j);
  front.appendChild(fitF);
  const shF = document.createElement('i');
  shF.className = 'spfx-shade';
  front.appendChild(shF);

  /* 封底（镜像圆角，旋转中途从缝里才可能露一点） */
  const back = document.createElement('div');
  back.className = 'spfx-face spfx-back';
  back.style.transform = 'rotateY(180deg) translateZ(' + t2 + 'px)';
  back.style.borderRadius = rr + 'px 5px 5px ' + rr + 'px';
  const fitB = document.createElement('div');
  fitB.className = 'spfx-fit';
  fitB.innerHTML = backCoverHTML(j);
  back.appendChild(fitB);

  /* 书脊面：克隆真实那根书脊（底色 / 纹理 / 图案 / 加密旗标全部同源），
     类名重置成静置态 —— 克隆体不能带着 .pulling / .gone / .active 的位移和透明 */
  const sp = document.createElement('div');
  sp.className = 'spfx-face spfx-spine';
  sp.style.width = t.toFixed(1) + 'px';
  sp.style.marginLeft = (-t / 2).toFixed(1) + 'px';
  sp.style.transform = 'translateX(' + (-W / 2).toFixed(1) + 'px) rotateY(-90deg)';
  const spIn = spineEl.cloneNode(true);
  spIn.className = 'spine-item spfx-spine-in' + (spineEl.classList.contains('custom-spine') ? ' custom-spine' : '');
  spIn.removeAttribute('title');
  spIn.setAttribute('aria-hidden', 'true');
  spIn.tabIndex = -1;
  sp.appendChild(spIn);
  const shS = document.createElement('i');
  shS.className = 'spfx-shade spfx-shade-spine';
  sp.appendChild(shS);

  /* 书口（右侧纸页断面）：转身时从缝里露出一条纸边，书才有厚度 */
  const pg = document.createElement('div');
  pg.className = 'spfx-face spfx-pages';
  pg.style.width = t.toFixed(1) + 'px';
  pg.style.marginLeft = (-t / 2).toFixed(1) + 'px';
  pg.style.transform = 'translateX(' + (W / 2).toFixed(1) + 'px) rotateY(90deg)';

  book.appendChild(back);
  book.appendChild(pg);
  book.appendChild(sp);
  book.appendChild(front);

  const shadow = document.createElement('div');
  shadow.className = 'spfx-shadow';

  return { book, shadow, shF, shS };
}

/* 每帧摆姿势：translate 定位中心点 → rotateY 转身 → 等比 scale。
   ⚠️ 顺序不能换：旋转 / 缩放都以盒子中心为轴，translate 只管中心去哪。 */
function applyPose(g, W, H, t, pose) {
  g.book.style.transform =
    'translate3d(' + (pose.cx - W / 2).toFixed(2) + 'px,' + (pose.cy - H / 2).toFixed(2) + 'px,0)' +
    ' rotateY(' + pose.ang.toFixed(2) + 'deg) scale(' + pose.s.toFixed(4) + ')';
  const rad = pose.ang * Math.PI / 180;
  const cos = Math.abs(Math.cos(rad)), sin = Math.abs(Math.sin(rad));
  /* 落地软影：宽度 = 封面投影 + 厚度投影；抬得越高影越淡越虚 */
  const pw = (W * cos + t * sin) * pose.s;
  const lift = pose.lift || 0;
  g.shadow.style.width = (pw * .9).toFixed(1) + 'px';
  g.shadow.style.transform =
    'translate3d(' + (pose.cx - pw * .45).toFixed(1) + 'px,' +
    (pose.cy + H * pose.s / 2 + 10).toFixed(1) + 'px,0)';
  g.shadow.style.opacity = (.5 - .3 * lift).toFixed(3);
  /* 朝向光：面越侧对镜头越暗 —— 封面背光渐深、书脊转正渐亮 */
  g.shF.style.opacity = (sin * .5).toFixed(3);
  g.shS.style.opacity = (cos * .42).toFixed(3);
}

/* ---------------- 关键帧驱动 ----------------
   track：按绝对毫秒排的姿势点，段间 easeInOut；onEvent 用来在时间点触发
   相位切换（阅读器淡入 / 白场淡出）。被打断靠 runId 作废，不再碰 DOM。 */
function drive(track, onPose, onEvent, onDone) {
  const id = ++runId;
  const dur = track[track.length - 1].t;
  const t0 = performance.now();
  (function tick(now) {
    if (id !== runId) return;
    const ms = Math.max(0, now - t0);
    let i = 0;
    while (i < track.length - 2 && ms > track[i + 1].t) i++;
    const a = track[i], b = track[i + 1];
    const seg = Math.min(Math.max((ms - a.t) / Math.max(b.t - a.t, 1), 0), 1);
    const e = (b.ease || easeIO)(seg);
    onPose({
      cx: a.cx + (b.cx - a.cx) * e,
      cy: a.cy + (b.cy - a.cy) * e,
      s: a.s + (b.s - a.s) * e,
      ang: a.ang + (b.ang - a.ang) * e,
      lift: (a.lift || 0) + ((b.lift || 0) - (a.lift || 0)) * e
    }, ms);
    if (onEvent) onEvent(ms);
    if (ms < dur) requestAnimationFrame(tick);
    else if (onDone) onDone();
  })(t0);
}

function spineElOf() {
  if (!state.prefs || state.prefs.view !== 'spine') return null;
  return $('#spineRow .spine-item[data-i="' + state.sel + '"]');
}
/* 屏幕中央偏上一点的「立书位」：白场里只摆这一本 */
function centerHold() {
  return { x: window.innerWidth / 2, y: window.innerHeight * .46 };
}

/* ==================== 打开 ====================
   from = 书脊**抽出后**的实时矩形（openReader 入口量好传进来）。
   全程：θ=90° 的书脊条 → 抬到中央 → 转到 θ=0° 的正面封面 → 落进阅读器。 */
function open(from) {
  const j = cur();
  const spineEl = spineElOf();
  if (!j || !spineEl || !from || !from.width || !from.height) return false;
  const home = $('#home'), reader = $('#reader'), book = $('#book'), app = $('#app');
  armFlyBusy(OPEN_MS + 900);
  /* 相位类：主页**不动**（白场盖在它上面，不关 book-opening 那套缩放模糊）；
     阅读器挂 .show 但先整体透明（spinefx-hold），等书转正了再淡入。 */
  app.classList.remove('spinefx-enter');
  app.classList.add('spinefx-hold');
  home.classList.remove('book-returning', 'book-appearing');
  reader.classList.add('book-opening');
  reader.classList.add('show');
  book.classList.remove('book-out', 'gone', 'folded', 'folding', 'folding-back',
    'back-hinge', 'back-close', 'back-opening', 'cover-flip');
  renderReader();
  const to = coverPageRect() || fallbackCoverRect();
  book.classList.add('book-in');

  const W = to.width, H = to.height;
  const s0 = from.height / H;              // 起始缩放：书脊高度 → 封面内容高度
  const t = from.width / s0;               // 厚度：θ=90° 时投影 t·s0 = 书脊视觉宽
  mkWhite();
  const st = mkStage();
  const g = mkGhost(j, spineEl, W, H, t);
  st.appendChild(g.shadow);
  st.appendChild(g.book);

  const CC = centerHold(), sC = 1.07;
  const c0 = { x: from.left + from.width / 2, y: from.top + from.height / 2 };
  const cT = { x: to.left + to.width / 2, y: to.top + to.height / 2 };
  const track = [
    { t: 0,       cx: c0.x, cy: c0.y, s: s0, ang: 90, lift: 0 },
    { t: 310,     cx: CC.x, cy: CC.y, s: sC, ang: 90, lift: 1, ease: easeIO },  // 抬到中央
    { t: 770,     cx: CC.x, cy: CC.y, s: sC, ang: 0,  lift: 1, ease: easeIO },  // 慢慢转到正面
    { t: OPEN_MS, cx: cT.x, cy: cT.y, s: 1,  ang: 0,  lift: 0, ease: easeIO }   // 落进阅读器
  ];
  let entered = false;
  drive(track,
    pose => applyPose(g, W, H, t, pose),
    ms => {
      /* 书一转正：阅读器在不透明的白场**底下**淡入（看不见）。
         ⚠️ 白场此刻不能淡出 —— ghost 在白场之上、真书在白场之下，
         落地交接若撞上白场半透，书会突然蒙纱「闪」一下 */
      if (!entered && ms >= 740) {
        entered = true;
        app.classList.remove('spinefx-hold');
        app.classList.add('spinefx-enter');
      }
    },
    () => {
      /* 落地后：ghost 还盖在书位上（z-80 在白场之上），先在它底下淡出白场
         —— 白场怎么淡都被 ghost 遮住，底下的真书/阅读器一点都不闪；
         白场散尽后再做 ghost → 真书交接，两边都是全亮度，零视觉差 */
      const id = runId;
      fadeWhite();
      setTimeout(() => {
        if (id !== runId) return;           // 已被打断（teardown 收掉了 stage）
        if (stage) { stage.remove(); stage = null; }
        book.classList.remove('book-in');
        reader.classList.remove('book-opening');
        freeFlyBusy();
      }, 400);                              // 与白场淡出 .38s 同步
    });
  return true;
}

/* ==================== 关闭 ====================
   from = 阅读器里封面那一页的矩形（书已合好）。
   全程：封面抬到中央 → 转回书脊方向（θ→90°）→ 缩成书脊插回架上原位 →
   白场淡出，周围的手账本显现。 */
function close(from) {
  const j = cur();
  const spineEl = spineElOf();
  if (!j || !spineEl || !from || !from.width || !from.height) return false;
  /* 落点必须是架上**静置**位：.pulling 的抽出位移先摘掉再量 */
  spineEl.classList.remove('pulling');
  const to = spineEl.getBoundingClientRect();
  if (!to || !to.width || !to.height) return false;
  const home = $('#home'), reader = $('#reader'), book = $('#book');
  /* 主页在白场底下待命（closeReader 先加了 book-returning 把它藏了，这里放回来） */
  home.classList.remove('book-returning', 'noanim');
  home.classList.add('book-appearing');
  book.classList.add('gone');              // 封面交给 ghost，真身立刻让位

  const W = from.width, H = from.height;
  const sT = to.height / H;
  const t = to.width / sT;
  mkWhite();
  const st = mkStage();
  const g = mkGhost(j, spineEl, W, H, t);
  st.appendChild(g.shadow);
  st.appendChild(g.book);

  const CC = centerHold(), sC = 1.07;
  const c0 = { x: from.left + from.width / 2, y: from.top + from.height / 2 };
  const cT = { x: to.left + to.width / 2, y: to.top + to.height / 2 };
  const track = [
    { t: 0,        cx: c0.x, cy: c0.y, s: 1,  ang: 0,  lift: 1 },
    { t: 270,      cx: CC.x, cy: CC.y, s: sC, ang: 0,  lift: 1, ease: easeIO },  // 抬到中央
    { t: 680,      cx: CC.x, cy: CC.y, s: sC, ang: 90, lift: 1, ease: easeIO },  // 转回书脊方向
    { t: CLOSE_MS, cx: cT.x, cy: cT.y, s: sT, ang: 90, lift: 0, ease: easeIO }   // 插回架上
  ];
  drive(track,
    pose => applyPose(g, W, H, t, pose),
    null,
    () => {
      if (stage) { stage.remove(); stage = null; }
      /* 书脊真身放回原位（白场还盖着，看不见这一帧），再统一收尾：
         endClose 里会摘 .show / 放锁，并调 teardown() 把白场淡出 */
      spineEl.classList.remove('gone', 'pulling');
      endClose();
    });
  return true;
}

window.CarnetSpineFx = { open: open, close: close, teardown: teardown };
})();
