/* =====================================================================
 * Carnet · 文字贴 · 编辑面板与行内编辑   （脚本 16 / 27）
 * ---------------------------------------------------------------------
 * ① 底部「编辑文字」面板 .tsheet：正文 + 字体 / 颜色 / 字号 / 格式四个标签页
 * ② 面板会话内的撤销栈 shPush / shUndo，每一次改动即时画回纸面
 * ③ 编辑态 eflow：顶栏底栏让位、书整体上移避让（updateEflow / sheetLayout，底色面板复用同一套）
 * ④ 行内编辑（双击直接打字）startTextEdit / stopTextEdit
 * ⑤ 对象工具条自动避让 fitObjBar：贴边 / 顶栏 / 底栏 / 面板 / 键盘挡住时自己换个地方待
 *
 * 对外接口：openTextSheet, closeTextSheet, startTextEdit, stopTextEdit, commitTextEdit, pageBusy,
 *           syncBar, fitObjBar, refitObjBars, updateEflow, sheetLayout
 *
 * 依赖模块：core, state, visuals（widgets / scrub / page-bg 后置，只在运行时调用）
 *
 * 说明：模块间共用全局作用域，加载顺序即依赖顺序（见 index.html 与 README）。
 * ===================================================================== */
/* ==================== 文字贴：编辑面板 ==================== */
let selText = null;                     // {pid, iid}
/* 页面里正忙：拖图 / 拉伸 / 打字 —— 这些时候不能重绘，否则会打断 */
function pageBusy() {
  return !!(state.imgDragging || state.imgResizing || document.querySelector('.ptext-wrap.editing'));
}
/* 字号档位：面板上的快捷档（值 = 占纸宽的百分比） */
const TS_SIZES = [
  { n: '小',   v: 4 },
  { n: '中',   v: 5.5 },
  { n: '大',   v: 7.5 },
  { n: '特大', v: 10.5 }
];
/* 对齐三档 + 图标（用一个「左」字不如三条长短线好认）。
   三条线宽度拉开差距、贴左 / 居中 / 贴右各对齐一条边，缩到 17px 也一眼分得出 */
const TS_ALIGN = ['left', 'center', 'right'];
const TS_ALIGN_TXT = { left: '左', center: '中', right: '右' };
function alignSVG(a) {
  const ws = [12, 6, 9];
  const xs = ws.map(w => a === 'right' ? 14 - w : (a === 'center' ? (16 - w) / 2 : 2));
  return '<svg fill="none" height="17" stroke="currentColor" stroke-linecap="round" stroke-width="1.8" viewBox="0 0 16 16" width="17">'
    + xs.map((x, i) => `<path d="M${x} ${4 + i * 4}h${ws[i]}"/>`).join('') + '</svg>';
}
function textStyle(t) {
  const fs = (t.size || 5.5) / 100;
  const cn = textFontVar(t.font);
  const en = textEnVar(t.fontEn);
  /* 英文字体排前面：拉丁字走它，汉字自动落到后面的中文字体（英文那几档都不带通用族） */
  const fam = [en, cn].filter(Boolean).join(',') || 'inherit';
  return `font-size:calc(var(--pw,340px) * ${fs.toFixed(4)});color:${t.color || '#2b2f3d'};`
    + `text-align:${t.align || 'left'};${t.bold ? 'font-weight:700;' : ''}`
    + `${t.italic ? 'font-style:italic;' : ''}`
    + `${t.underline ? 'text-decoration:underline;' : (t.strike ? 'text-decoration:line-through;' : '')}`
    + `${t.bg ? 'background:' + t.bg + ';' : ''}`
    + `font-family:${fam};`;
}
function textById(pid, iid) {
  const pg = cur() && cur().pages[pid];
  return pg ? pageTexts(pg).find(x => x.id === iid) : null;
}
function textWrap(iid) {
  return $(`#slotL .ptext-wrap[data-id="${iid}"], #slotR .ptext-wrap[data-id="${iid}"]`);
}
/* ==================== 工具条自动避让 ====================
   工具条长在被旋转的那个盒子里（它自己反着转，所以永远是正的），默认挂在正上方 13px 处。
   对象一旦挪到纸边、顶到底栏、或者被弹起来的面板压住，它就会被裁掉 / 盖住 ——
   所以每次定位都重新挑个地方：
     ① 四个候选：上 → 下 → 塞进对象内侧的上边 → 内侧的下边
     ② 每个候选按屏幕矩形打分：探出纸面的部分会被裁掉（扣满），压到界面上的部分按权重扣，
        盖住对象自己的部分折算着扣（盖住图 / 盖住刚打的字也不好看，但总好过被裁掉）
     ③ 挑损失最小的（一样好取靠前的；上一回那个位置有一点点粘性，拖动时不来回跳）
     ④ 还摆不下就再推一把：夹回纸内 → 往最近的出口推离挡住它的那块 → 再夹回纸内
   大部分时候（对象好好待在纸中间）第一个候选就是零损失，一个字都不用写。
   ⚠️ 算出来的位移是屏幕坐标，下发前要先转回对象自己的坐标系 —— 位移写在盒子里，
      盒子本身是转过的，乘一次 R(⁻¹) 才能让它再被盒子转回正（同一套推导见 media.js 的 rotShift） */
const BAR_GAP = 13;       // 工具条离对象边的距离（跟 text.css 里 --ob-gap 的默认值一致）
const BAR_PAD = 6;        // 离纸边、离遮挡界面留的余量
const BAR_IN = 8;         // 塞进对象内侧时离对象边的距离
const BAR_STICK = 500;    // 上一回那个位置的粘性：约等于 20×25 的一小块，拖动时不来回跳
const BAR_COVER = .35;    // 盖住对象自己的代价（比被裁掉轻，但也不是白盖的）
/* 会挡住工具条的东西：顶栏 / 底栏 / 左上那组按钮 / 编辑面板 / 页数轴 / 双页中缝 / 输入法。
   收起来的（[hidden] 或没 .show）量出来是零，自然跳过。
   k 是权重：不透明的界面算 1（真挡住），中缝那道半透明暗部算 .45（只是发灰） */
function barObstacles() {
  const out = [];
  const add = (l, t, r, b, k) => { if (r - l > 1 && b - t > 1) out.push({ r: { l, t, r, b }, k }); };
  const box = s => {
    const e = $(s); if (!e) return null;
    const b = e.getBoundingClientRect();
    return (b.width > 1 && b.height > 1) ? b : null;
  };
  ['#reader > .rtop', '#reader > .rbot', '#eflowTop', '#tsheet', '#bgsheet', '#addMenu', '#scrub.show']
    .forEach(s => { const b = box(s); if (b) add(b.left, b.top, b.right, b.bottom, 1); });
  const g = box('.book .gutter');
  if (g) add(g.left, g.top, g.right, g.bottom, .45);
  const kb = (window.__kbHeight ? window.__kbHeight() : 0);
  if (kb > 4) add(0, window.innerHeight - kb, window.innerWidth, window.innerHeight, 1);
  return out;
}
/* 对象的盒子（旋转前的布局盒子）：行内的 left/top/width/height 全是百分比。
   不能用 getBoundingClientRect —— 那量的是「转过之后」的外接框，锚点会跟着歪掉 */
function objBox(w, pr) {
  const st = w.style, pc = k => (parseFloat(st[k]) || 0) / 100;
  const ww = pc('width');
  return {
    x: pc('left'), y: pc('top'), w: ww, h: pc('height') || ww / .68,
    rot: parseFloat(st.getPropertyValue('--rot')) || 0, pr
  };
}
/* 盒子里的 (u,v)（0 = 左上角，1 = 右下角）→ 屏幕坐标：盒子是绕自己中心转的 */
function boxAt(b, u, v) {
  const a = b.rot * Math.PI / 180, cs = Math.cos(a), sn = Math.sin(a);
  const cx = b.pr.left + (b.x + b.w / 2) * b.pr.width;
  const cy = b.pr.top + (b.y + b.h / 2) * b.pr.height;
  const px = (u - .5) * b.w * b.pr.width, py = (v - .5) * b.h * b.pr.height;
  return [cx + px * cs - py * sn, cy + px * sn + py * cs];
}
/* 盒子的「上」在屏幕上朝哪：转 90° 时它就朝右了 —— 工具条跟着这个方向走 */
function boxUp(b) {
  const a = b.rot * Math.PI / 180;
  return [Math.sin(a), -Math.cos(a)];
}
/* 对象在屏幕上的外接框（转过之后的外接矩形）：用来判断工具条有没有盖住它。
   转过之后这是个偏大的近似（四个角有空白），只是算代价，够用 */
function objAABB(b) {
  const cs = [boxAt(b, 0, 0), boxAt(b, 1, 0), boxAt(b, 0, 1), boxAt(b, 1, 1)];
  return {
    l: Math.min(cs[0][0], cs[1][0], cs[2][0], cs[3][0]), r: Math.max(cs[0][0], cs[1][0], cs[2][0], cs[3][0]),
    t: Math.min(cs[0][1], cs[1][1], cs[2][1], cs[3][1]), b: Math.max(cs[0][1], cs[1][1], cs[2][1], cs[3][1])
  };
}
/* 工具条摆在盒子上 / 下沿外侧 gap 处（gap < 0 就是塞进内侧）时的屏幕中心 */
function barSpot(b, below, gap, bh) {
  const p = boxAt(b, .5, below ? 1 : 0), up = boxUp(b);
  const s = (below ? -1 : 1) * (gap + bh / 2);
  return [p[0] + up[0] * s, p[1] + up[1] * s];
}
const mkR = (x, y, w, h) => ({ l: x - w / 2, t: y - h / 2, r: x + w / 2, b: y + h / 2 });
const rArea = r => Math.max(0, r.r - r.l) * Math.max(0, r.b - r.t);
const rCut = (a, b) => ({ l: Math.max(a.l, b.l), t: Math.max(a.t, b.t), r: Math.min(a.r, b.r), b: Math.min(a.b, b.b) });
/* 把矩形中心夹进 area（area 比它还小的话就直接居中） */
function clampIn(c, A, w, h) {
  return [
    A.r - A.l >= w ? clamp(c[0], A.l + w / 2, A.r - w / 2) : (A.l + A.r) / 2,
    A.b - A.t >= h ? clamp(c[1], A.t + h / 2, A.b - h / 2) : (A.t + A.b) / 2
  ];
}
/* 压得最狠的那一块遮挡物（一点都没压到就 null；1px² 以内的那点边角不算） */
function barHit(xy, bw, bh, obs) {
  const R = mkR(xy[0], xy[1], bw, bh);
  let hit = null, most = 1;
  for (const o of obs) {
    const a = o.k * rArea(rCut(R, o.r));
    if (a > most) { most = a; hit = o; }
  }
  return hit;
}
/* 从遮挡物里推出来：上 / 下 / 左 / 右里挑「动得最少」的那个方向 */
function barPush(xy, o, bw, bh) {
  const r = o.r;
  const opts = [
    [xy[0], r.t - BAR_PAD - bh / 2], [xy[0], r.b + BAR_PAD + bh / 2],
    [r.l - BAR_PAD - bw / 2, xy[1]], [r.r + BAR_PAD + bw / 2, xy[1]]
  ];
  let best = xy, bd = Infinity;
  for (const p of opts) {
    const d = Math.hypot(p[0] - xy[0], p[1] - xy[1]);
    if (d < bd) { bd = d; best = p; }
  }
  return best;
}
/* ctx 是手势期间复用的那一份（纸和界面都不动，量一次就够，省掉每帧的重排） */
function fitObjBar(w, ctx) {
  if (!w) return;
  const bar = w.querySelector('.objbar'); if (!bar) return;
  const c = ctx || {};
  if (!c.bw || !c.bh) { c.bw = bar.offsetWidth; c.bh = bar.offsetHeight; }
  const bw = c.bw, bh = c.bh;
  if (!bw || !bh) return;                     // 没展开（display:none）就没什么可摆的
  if (!c.pr) { const p = w.closest('.paper'); if (!p) return; c.pr = p.getBoundingClientRect(); }
  if (!c.obs) c.obs = barObstacles();
  const pr = c.pr;
  if (pr.width < 8 || pr.height < 8) return;
  const A = { l: pr.left + BAR_PAD, t: pr.top + BAR_PAD, r: pr.right - BAR_PAD, b: pr.bottom - BAR_PAD };
  const b = objBox(w, pr), own = objAABB(b);
  const inGap = -(bh + BAR_IN);
  const cands = [[0, BAR_GAP], [1, BAR_GAP], [0, inGap], [1, inGap]];   // [挂下方?, 间距]
  let best = 0, bestLoss = Infinity;
  for (let i = 0; i < cands.length; i++) {
    const s = barSpot(b, !!cands[i][0], cands[i][1], bh);
    const R = mkR(s[0], s[1], bw, bh);
    let loss = rArea(R) - rArea(rCut(R, A)) + BAR_COVER * rArea(rCut(R, own));
    for (const o of c.obs) loss += o.k * rArea(rCut(R, o.r));
    if (i === w.__barCand) loss -= BAR_STICK;   // 上一回的位置粘一点
    if (loss < bestLoss) { bestLoss = loss; best = i; }
  }
  const raw = barSpot(b, !!cands[best][0], cands[best][1], bh);
  let xy = raw;
  /* 放不下就再推一把：夹回纸内 → 往最近的出口推离遮挡物 → 再夹回纸内 */
  for (let n = 0; n < 2; n++) {
    xy = clampIn(xy, A, bw, bh);
    const o = barHit(xy, bw, bh, c.obs); if (!o) break;
    xy = barPush(xy, o, bw, bh);
  }
  xy = clampIn(xy, A, bw, bh);
  /* 屏幕位移 → 对象自己的坐标系（见上面那段注释） */
  const rad = b.rot * Math.PI / 180, cs = Math.cos(rad), sn = Math.sin(rad);
  const dx = xy[0] - raw[0], dy = xy[1] - raw[1];
  const vx = cs * dx + sn * dy, vy = cs * dy - sn * dx;
  const below = !!cands[best][0], gap = cands[best][1];
  const sig = (below ? 'b' : 't') + '|' + gap.toFixed(0) + '|' + vx.toFixed(1) + '|' + vy.toFixed(1);
  if (sig !== w.__barSig) {                    // 值没变就别重写，省一次样式重算
    w.__barSig = sig;
    w.classList.toggle('bar-below', below);
    bar.style.setProperty('--ob-gap', gap.toFixed(1) + 'px');
    bar.style.setProperty('--ob-dx', vx.toFixed(1) + 'px');
    bar.style.setProperty('--ob-dy', vy.toFixed(1) + 'px');
  }
  w.__barCand = best;
}
/* 当前选中的那一个重新摆一次（转屏 / 面板起落 / 键盘升降都要） */
function refitObjBars() {
  $$('.pimg-wrap.sel, .ptext-wrap.adjust, .ptext-wrap.editing').forEach(w => fitObjBar(w));
}
let refitRaf = 0;
const refitLater = () => {
  if (refitRaf) return;
  refitRaf = requestAnimationFrame(() => { refitRaf = 0; refitObjBars(); });
};
window.addEventListener('resize', refitLater);
window.addEventListener('orientationchange', () => setTimeout(refitLater, 320));
if (window.visualViewport) {
  window.visualViewport.addEventListener('resize', refitLater);
  window.visualViewport.addEventListener('scroll', refitLater);
}
window.__refitObjBars = refitLater;
/* 工具条上的按钮状态（位置交给 fitObjBar 管） */
function syncBar(w, im) {
  if (!w || !im) return;
  const b = w.querySelector('.objbar .ob[data-ob="edit"]');
  if (b && w.classList.contains('pimg-wrap')) {
    b.classList.toggle('on', !!im.fill);
    b.title = im.fill ? '还原原比例' : '铺满整页';
  }
}
function syncTextBar() {
  if (!selText) { setEditBar(false); shSyncHist(); return; }
  const t = textById(selText.pid, selText.iid);
  if (!t) { setEditBar(false); return; }
  setEditBar(true);
  shSync();
}
/* 底栏切换：行内编辑文字时隐藏页码与翻页按钮 */
function setEditBar(on) {
  const rbot = $('.rbot'); if (!rbot) return;
  rbot.classList.toggle('editing', !!on);
  if (window.__syncBotBar) setTimeout(window.__syncBotBar, 30);   // 底栏跟着输入法抬 / 落
}
function showTextBar(w, pid, iid) {
  closeScrub();
  selText = { pid, iid };
  if (w) { w.classList.add('adjust'); syncBar(w, textById(pid, iid)); fitObjBar(w); }
  syncTextBar();
}
function hideTextBar() {
  closeTextSheet(false);
  selText = null;
  setEditBar(false);
  updateEflow();
}
/* ==================== 编辑文字面板 ==================== */
const sh = {
  open: false, tab: 'font', pid: null, iid: null,
  hist: [], pos: -1, lastPush: 0, lastKind: ''
};
function shCur() { return sh.open ? textById(sh.pid, sh.iid) : null; }
/* 面板要记的字段 */
function shSnap(t) {
  return {
    text: t.text || '', size: +(t.size || 5.5), color: t.color || '#2b2f3d', bg: t.bg || '',
    align: t.align || 'left', bold: !!t.bold, italic: !!t.italic,
    underline: !!t.underline, strike: !!t.strike,
    font: normFont(t.font), fontEn: normEnFont(t.fontEn)
  };
}
/* 撤销栈：存的是「改动之后」的状态；连续打字（800ms 内）合并成一步 */
function shPush(kind) {
  const t = shCur(); if (!t) return;
  const now = Date.now();
  const snap = shSnap(t);
  if (kind === 'text' && sh.pos >= 0 && sh.lastKind === 'text' && now - sh.lastPush < 800) {
    sh.hist[sh.pos] = snap; sh.lastPush = now; return;
  }
  sh.hist = sh.hist.slice(0, sh.pos + 1);
  sh.hist.push(snap);
  if (sh.hist.length > 80) sh.hist.shift();
  sh.pos = sh.hist.length - 1;
  sh.lastPush = now; sh.lastKind = kind;
  shSyncHist();
}
function shSyncHist() {
  const u = $('#efUndo'), r = $('#efRedo');
  if (!u || !r) return;
  const on = sh.open && sh.hist.length > 1;
  u.disabled = !on || sh.pos <= 0;
  r.disabled = !on || sh.pos >= sh.hist.length - 1;
}
function shUndo(dir) {
  const t = shCur(); if (!t) return;
  const np = sh.pos + dir;
  if (np < 0 || np >= sh.hist.length) return;
  sh.pos = np;
  const s = sh.hist[np];
  Object.assign(t, s);
  sh.lastKind = '';                         // 撤销之后就别再往这一步里合并打字了
  save();
  shPaint();
}
/* 把当前文字画回纸面：样式、正文、框高一起跟 */
function shPaint() {
  const t = shCur(); if (!t) return;
  const w = textWrap(sh.iid);
  if (w) {
    const el = w.querySelector('.ptxt');
    if (el) {
      const has = !!(t.text || '').trim();
      el.className = 'ptxt' + (has ? '' : ' placeholder');
      el.setAttribute('style', textStyle(t));
      el.textContent = has ? t.text : '双击编辑文字';
      fitTextHeight(w, el, false);
    }
    syncBar(w, t);
    fitObjBar(w);
  }
  shSync();
}
/* 面板界面跟上当前文字：选中态、滑块、开关全刷一遍 */
function shSync() {
  const t = shCur(); if (!t) return;
  const inp = $('#tsInput');
  if (inp && document.activeElement !== inp) { inp.value = t.text || ''; shGrowInput(); }
  const cn = normFont(t.font), en = normEnFont(t.fontEn);
  $$('#tsFonts button').forEach(b => b.classList.toggle('on', b.dataset.f === cn));
  $$('#tsEnFonts button').forEach(b => b.classList.toggle('on', b.dataset.ef === en));
  /* 颜色：不在预设里的色值就点亮「自定义」那颗，并把它染成当前色 */
  const cur = t.color || '#2b2f3d';
  $$('#tsColors button[data-c]').forEach(b => {
    if (b.dataset.c === '__custom') {
      const std = TEXT_COLORS.includes(cur);
      b.classList.toggle('on', !std);
      b.style.background = std ? '' : cur;
    } else b.classList.toggle('on', b.dataset.c === cur);
  });
  const bg = t.bg || '';
  $$('#tsBgs button[data-bg]').forEach(b => {
    if (b.dataset.bg === '__custom') {
      const std = TEXT_BGS.includes(bg);
      b.classList.toggle('on', !std && !!bg);
      b.style.background = (std || !bg) ? '' : bg;
    } else b.classList.toggle('on', b.dataset.bg === bg);
  });
  const size = +(t.size || 5.5);
  const rg = $('#tsSize');
  if (rg && document.activeElement !== rg) rg.value = size;
  const sv = $('#tsSizeVal');
  if (sv) sv.textContent = (size / 100 * (state.pw || PAGE_W_DEFAULT)).toFixed(1) + 'px';
  $$('#tsSizes button').forEach(b => b.classList.toggle('on', Math.abs(+b.dataset.s - size) < .05));
  const fmt = { bold: !!t.bold, italic: !!t.italic, underline: !!t.underline, strike: !!t.strike };
  $$('#tsFmt button').forEach(b => b.classList.toggle('on', !!fmt[b.dataset.fmt]));
  $$('#tsAlignRow button').forEach(b => b.classList.toggle('on', b.dataset.align === (t.align || 'left')));
  shSyncHist();
}
/* 面板开关时：顶栏 / 底栏让位，面板高度记到 #reader 上供排版避让。
   「本页底色」弹窗（#bgsheet）借同一套编辑态，只是它没有撤销栈，把撤销 / 重做收起来 */
/* 现在开着的是哪一张底部面板（文字 / 底色 / 边框 / 贴纸）。
   同一时刻只会开一张，但「有没有开」这一问在好几处都要用，集中成一句话 */
const SHEET_SELS = ['#tsheet', '#bgsheet', '#frsheet', '#stsheet'];
function openSheetEl() { for (const s of SHEET_SELS) { const el = $(s); if (el && !el.hidden) return el; } return null; }
function anySheetOpen() { return !!openSheetEl() || !!$('.ptext-wrap.editing'); }
function updateEflow() {
  const reader = $('#reader'); if (!reader) return;
  const inline = !!$('.ptext-wrap.editing');
  const on = sh.open || inline || !!openSheetEl();
  reader.classList.toggle('eflow', on);
  const top = $('#eflowTop');
  if (top) top.hidden = !on;
  const hist = $('#efHist');
  if (hist) hist.hidden = !sh.open;               // 只有文字面板才有撤销 / 重做
  if (!sh.open && !openSheetEl()) { window.__sheetCov = 0; reader.style.setProperty('--stage-shift', '0px'); }
  shSyncHist();
  refitLater();                  // 顶栏 / 左上角那组按钮一出一进，工具条要重新挑位置
}
/* 面板压住了下半截纸：量出重叠高度，书排版时避开、并整体上移一半 */
function sheetLayout() {
  const reader = $('#reader'), stage = $('#stage');
  const sheet = openSheetEl();
  if (!reader || !stage || !sheet || sheet.hidden) {
    window.__sheetCov = 0;
    if (reader) reader.style.setProperty('--stage-shift', '0px');
    return 0;
  }
  const sr = stage.getBoundingClientRect(), hr = sheet.getBoundingClientRect();
  const cov = Math.max(0, Math.round(sr.bottom - hr.top + 4));
  window.__sheetCov = cov;
  reader.style.setProperty('--sheet-h', cov + 'px');
  reader.style.setProperty('--stage-shift', (-cov / 2).toFixed(1) + 'px');
  return cov;
}
function shGrowInput() {
  const el = $('#tsInput'); if (!el) return;
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight || 0, 124) + 'px';
}
/* 输入法弹起：整块面板抬到键盘上方，并把高度收到可见范围里 */
function shKb() {
  const sheet = $('#tsheet');
  if (!sheet || sheet.hidden) return;
  const reader = $('#reader');
  const kb = (window.__kbHeight ? window.__kbHeight() : 0);
  if (kb > 4) {
    sheet.style.transform = `translateY(${-kb}px)`;
    sheet.style.maxHeight = Math.max(220, Math.round(reader.clientHeight - kb - 10)) + 'px';
  } else {
    sheet.style.transform = '';
    sheet.style.maxHeight = '';
  }
}
function openTextSheet(pid, iid, focus) {
  const t = textById(pid, iid); if (!t) return;
  commitTextEdit();                       // 正在行内打字的话先落盘，两种编辑不并存
  sh.open = true; sh.pid = pid; sh.iid = iid;
  sh.hist = [shSnap(t)]; sh.pos = 0; sh.lastPush = 0; sh.lastKind = '';
  selText = { pid, iid };
  t.locked = false; save();               // 编辑期间保持可选中态（框一直挂着）
  const w = textWrap(iid);
  if (w) { w.classList.remove('locked'); w.classList.add('adjust'); syncBar(w, t); fitObjBar(w); }
  const sheet = $('#tsheet');
  sheet.hidden = false;
  shTab('font'); shSync();
  updateEflow();
  /* 面板撑开会把纸压小（layoutBook 会避开它），纸一缩工具条就得重新挑位置 */
  requestAnimationFrame(() => { sheetLayout(); layoutBook(); refitObjBars(); });
  setTimeout(() => { sheetLayout(); layoutBook(); refitLater(); }, 340);   // 展开动画走完再量一次
  if (focus) setTimeout(() => { const i = $('#tsInput'); if (i) { i.focus(); shGrowInput(); } }, 60);
  syncTextBar();
}
function closeTextSheet(commit) {
  if (!sh.open) return;
  sh.open = false;
  const t = textById(sh.pid, sh.iid);
  const w = textWrap(sh.iid);
  const inp = $('#tsInput');
  if (t && commit && inp) t.text = (inp.value || '').replace(/[\r\n]+$/, '');
  if (t) {
    t.locked = true;                      // 编辑完默认固定，免得随手一碰就把字挪走
    if (w) {
      const el = w.querySelector('.ptxt');
      const has = !!(t.text || '').trim();
      if (el) { el.textContent = has ? t.text : '双击编辑文字'; el.className = 'ptxt' + (has ? '' : ' placeholder'); fitTextHeight(w, el, false); }
    }
  }
  save();
  const sheet = $('#tsheet');
  if (sheet) { sheet.hidden = true; sheet.style.transform = ''; sheet.style.maxHeight = ''; }
  /* 记一下收面板的时刻：紧接着那一下点击只是「关面板」，不该顺手把页翻过去 */
  markFlipSuppressed();
  sh.hist = []; sh.pos = -1; sh.pid = null; sh.iid = null;
  window.__sheetCov = 0;
  const reader = $('#reader');
  if (reader) { reader.style.setProperty('--stage-shift', '0px'); }
  updateEflow();
  if (window.__syncTypeShift) window.__syncTypeShift();
  if (window.__syncBotBar) window.__syncBotBar();
  renderReader();
}
/* ---- 面板：一次建好，之后只切选中态 ---- */
function shTab(name) {
  sh.tab = name || 'font';
  $$('#tsTabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === sh.tab));
  $$('#tsPanes .ts-pane').forEach(p => p.classList.toggle('on', p.dataset.pane === sh.tab));
}
function buildSheet() {
  const tabs = $('#tsTabs');
  if (!tabs) return;
  tabs.addEventListener('click', e => {
    const b = e.target.closest('button[data-tab]'); if (!b) return;
    shTab(b.dataset.tab);
  });
  /* 中文字体：每档用自己那套字族显示，点之前就看得出写出来是什么样 */
  $('#tsFonts').innerHTML = TEXT_FONTS.map(f =>
    `<button data-f="${f.k}" title="${f.n}" style="font-family:${f.css || 'inherit'}">${f.abbr}</button>`).join('');
  $('#tsEnFonts').innerHTML = EN_FONTS.map(f =>
    `<button data-ef="${f.k}" title="${f.n}" style="${f.css ? 'font-family:' + f.css : ''}">${f.n}</button>`).join('');
  $('#tsColors').innerHTML = TEXT_COLORS.map(c =>
    `<button data-c="${c}" style="background:${c}" title="${c}"></button>`).join('')
    + '<button class="custom" data-c="__custom" title="自定义颜色"></button>';
  $('#tsBgs').innerHTML = TEXT_BGS.map(c => c
    ? `<button data-bg="${c}" style="background:${c}" title="${c}"></button>`
    : '<button class="none" data-bg="" title="不加高亮"></button>').join('')
    + '<button class="custom" data-bg="__custom" title="自定义高亮"></button>';
  $('#tsSizes').innerHTML = TS_SIZES.map(s => `<button data-s="${s.v}">${s.n}</button>`).join('');
  $('#tsFmt').innerHTML = [['bold', 'B', 'fx', '加粗'], ['italic', 'I', 'fi', '斜体'],
    ['underline', 'U', 'fu', '下划线'], ['strike', 'S', 'fs', '删除线']]
    .map(([k, txt, cls, title]) => `<button class="${cls}" data-fmt="${k}" title="${title}">${txt}</button>`).join('');
  $('#tsAlignRow').innerHTML = TS_ALIGN.map(a =>
    `<button data-align="${a}" title="对齐：${TS_ALIGN_TXT[a]}">${alignSVG(a)}</button>`).join('');

  /* ---- 一处改动统一走这里：改数据 → 存盘 → 画回纸面 → 记一步撤销 ---- */
  const act = (fn, kind) => {
    const t = shCur(); if (!t) return;
    fn(t);
    save();
    shPaint();
    shPush(kind);
  };
  /* 面板上的按钮都吃 pointerdown：比 click 跟手，也不会被底下页面把手势抢走 */
  const bind = (sel, fn) => {
    const box = $(sel); if (!box) return;
    box.addEventListener('pointerdown', e => {
      const b = e.target.closest('button'); if (!b) return;
      e.preventDefault(); e.stopPropagation();
      fn(b);
    });
  };
  bind('#tsFonts', b => act(t => { t.font = b.dataset.f; }, 'font'));
  bind('#tsEnFonts', b => act(t => { t.fontEn = b.dataset.ef; }, 'font'));
  bind('#tsFmt', b => act(t => { t[b.dataset.fmt] = !t[b.dataset.fmt]; }, 'fmt'));
  bind('#tsAlignRow', b => act(t => { t.align = b.dataset.align; }, 'align'));
  bind('#tsSizes', b => act(t => { t.size = +b.dataset.s; }, 'size'));
  bind('#tsColors', b => {
    if (b.dataset.c !== '__custom') { act(t => { t.color = b.dataset.c; }, 'color'); return; }
    const cur = shCur(); if (!cur) return;
    openColorPicker('文字颜色', cur.color || '', hex => act(t => { t.color = hex; }, 'color'));
  });
  bind('#tsBgs', b => {
    if (b.dataset.bg !== '__custom') { act(t => { t.bg = b.dataset.bg; }, 'bg'); return; }
    const cur = shCur(); if (!cur) return;
    openColorPicker('文字高亮', cur.bg || '', hex => act(t => { t.bg = hex; }, 'bg'));
  });
  /* 字号滑块：拖着走就实时跟，松手才算一步（走 'text' 之外的 kind，不合并） */
  const rg = $('#tsSize');
  if (rg) rg.addEventListener('input', () => {
    const t = shCur();
    if (!t) return;
    t.size = +rg.value;
    $('#tsSizeVal').textContent = (t.size / 100 * (state.pw || PAGE_W_DEFAULT)).toFixed(1) + 'px';
    save(); shPaint();
  });
  if (rg) rg.addEventListener('change', () => { const t = shCur(); if (t) shPush('size'); });
  /* 正文输入：边打边画回纸面，800ms 内的连续输入合并成一步撤销 */
  const inp = $('#tsInput');
  inp.addEventListener('input', () => {
    const t = shCur(); if (!t) return;
    t.text = inp.value;
    save();
    shGrowInput();
    shPaint();
    shPush('text');
  });
  inp.addEventListener('focus', () => setTimeout(shKb, 60));
  inp.addEventListener('blur', () => setTimeout(shKb, 120));
  inp.addEventListener('keydown', e => e.stopPropagation());   // 打字别触发翻页快捷键
  /* 右上角「完成」：底色面板开着就是「按完成落盘」，文字面板开着收面板，行内打字中就结束输入 */
  $('#efOk').onclick = () => {
    if (window.__bgOk) { window.__bgOk(); return; }
    /* 边框 / 贴纸面板：左上角这颗 ✓ 就是「收面板」（改动早就当场存过了） */
    if (window.__frOk) { window.__frOk(); return; }
    if (window.__stOk) { window.__stOk(); return; }
    if (sh.open) { closeTextSheet(true); return; }
    const w = $('.ptext-wrap.editing');
    if (w) stopTextEdit(w, true); else hideTextBar();
  };
  $('#efUndo').onclick = () => shUndo(-1);
  $('#efRedo').onclick = () => shUndo(1);
}
buildSheet();
/* ==================== 行内编辑（双击直接打字） ==================== */
/* 把光标放到「手指点的那个字」上，而不是一律跳到末尾 —— 改中间某个字时不用再挪半天。
   两种浏览器的接口不一样，都试一遍；定位不到就退回末尾 */
function caretRangeAt(el, x, y) {
  try {
    if (document.caretRangeFromPoint) {
      const r = document.caretRangeFromPoint(x, y);
      if (r && el.contains(r.startContainer)) return r;
    }
    if (document.caretPositionFromPoint) {
      const p = document.caretPositionFromPoint(x, y);
      if (p && el.contains(p.offsetNode)) {
        const r = document.createRange(); r.setStart(p.offsetNode, p.offset); r.collapse(true); return r;
      }
    }
  } catch (_) {}
  return null;
}
/* 内容真正的高度：临时把 height 放开成 auto 再读布局高度。
   两个坑（都踩过）：
   ① 不能读 scrollHeight —— 它是「max(框高, 内容高)」，内容没顶满框时量到的就是框高，
      配合下面的「+余量」就成了正反馈：每输入一次 +几 px，框一路长下去停不下来
      （旋转过的框原先用 scrollHeight 兜底，正是这个毛病：打一下长一下）。
   ② 不能用 Range.getBoundingClientRect —— 它量的是「文字的字体外框」而不是行盒，
      一行只有 line-height 的七成，多行就更少，框会一直比内容矮、最后一行被裁掉；
      转过角度时它量的是旋转后的外接框，会虚高一大截。
   offsetHeight 是布局高度，不受 transform 影响 —— 旋转多少度都量得准 */
function textContentH(el) {
  if (!el) return 0;
  const prev = el.style.height;
  el.style.height = 'auto';
  const h = el.offsetHeight;                 // 同步读一次布局，紧接着就还原，不会闪
  el.style.height = prev;
  return h || 0;
}
/* 把框高对齐到内容：growOnly 时只长不缩，否则两头都收（打字时也收紧，删字才不会留空白） */
function fitTextHeight(w, el, growOnly) {
  /* 落盘认框自己的 data-page / data-id：面板开着时 selText 可能是空的 */
  const t = (selText ? textById(selText.pid, selText.iid) : null)
    || textById(+w.dataset.page, w.dataset.id);
  if (!t || !el) return;
  const pageEl = w.closest('.paper'); if (!pageEl) return;
  const pr = pageEl.getBoundingClientRect();
  /* 用 offset* 而不是 getBoundingClientRect：后者量的是「转过之后的外接框」，
     文字一旋转就会比实际高出一大截，框会被越撑越大 */
  const wh = w.offsetHeight, wt = w.offsetTop;
  if (!pr.height || !wh) return;
  const lh = (parseFloat(getComputedStyle(el).lineHeight) || parseFloat(getComputedStyle(el).fontSize) * 1.42);
  const need = Math.max(textContentH(el) + 2, lh);         // 至少留一行，空框也不会塌成一条线
  const cur = wh;
  const maxH = pr.height - Math.max(0, wt);                // 不许越过纸的下边缘
  if (growOnly) { if (need <= cur) return; }               // 还没顶到框底：不动
  const nh = clamp(need, lh, Math.max(lh, maxH));
  if (Math.abs(nh - cur) < 1.5) return;
  /* 旋转过的文字：框长高 = 中心往下挪 = 整块会被转出去一段（原因见 media.js 的 rotShift）。
     补回去之后顶边和已经打好的字才留在原地，不会一边打字一边整块飘 */
  const sf = rotShift(pr, t.rot, 0, (nh - cur) / 2);
  if (sf.x || sf.y) {
    t.x = clamp((t.x ?? 0) + sf.x, OBJ_MIN, OBJ_MAX);
    t.y = clamp((t.y ?? 0) + sf.y, OBJ_MIN, OBJ_MAX);
    w.style.left = (t.x * 100).toFixed(2) + '%';
    w.style.top = (t.y * 100).toFixed(2) + '%';
  }
  t.h = clamp(nh / pr.height, .02, 1);
  w.style.height = (t.h * 100).toFixed(2) + '%';
  if (window.__syncTypeShift) window.__syncTypeShift();    // 框变高了，重新算要不要再抬一点
}
function startTextEdit(w, pid, iid, pt) {
  if (sh.open) return;                    // 面板开着的时候，改字走面板
  const t = textById(pid, iid); if (!t) return;
  selText = { pid, iid };
  $$('.ptext-wrap.editing').forEach(x => { if (x !== w) stopTextEdit(x, true); });
  const el = w.querySelector('.ptxt'); if (!el) return;
  if (w.__editing) { el.focus(); return; }      // 已在编辑：只把焦点拿回来
  w.__editing = true;
  w.classList.add('editing');
  if (!t.text) el.textContent = '';
  el.contentEditable = 'true';
  el.spellcheck = false;
  el.focus();
  /* 光标落在双击的那个字上（pt 是那一下的坐标）；定位不到或空框就落到末尾 */
  let placed = false;
  if (pt && t.text) {
    const r = caretRangeAt(el, pt.x, pt.y);
    if (r) {
      try {
        const s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
        placed = true;
      } catch (_) {}
    }
  }
  if (!placed) {
    try {
      const r = document.createRange(); r.selectNodeContents(el); r.collapse(false);
      const s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
    } catch (_) {}
  }
  el.addEventListener('blur', () => stopTextEdit(w, true), { once: true });
  el.addEventListener('keydown', ev => {
    ev.stopPropagation();                       // 打字时不要触发翻页快捷键
    if (ev.key === 'Escape') { ev.preventDefault(); el.blur(); }
  });
  /* 打字时框跟着内容走：长了跟着长，删掉几行也跟着收回去。
     内容高度现在是「放开 height 后实量的」，不会自己越长越大，所以两头都收是安全的 */
  w.__onInput = () => fitTextHeight(w, el, false);
  el.addEventListener('input', w.__onInput);
  // 点纸面空白处不会触发 contentEditable 的 blur，得自己兜住
  // 编辑面板上的按键自己会保住焦点，不能在这里先提交掉
  w.__docDown = ev => {
    if (w.contains(ev.target)) return;
    if (ev.target.closest && ev.target.closest('.rbot, #tsheet, #bgsheet, #eflowTop, #addMenu, #confirmMask, .cp-mask')) return;
    /* 直接去点另一个文本框：先存下这个，但不要整页重绘 ——
       重绘会把那边刚按下的第一下吃掉，双击就进不去了 */
    const other = ev.target.closest && ev.target.closest('.ptext-wrap');
    if (other && other !== w) { stopTextEdit(w, true, true); return; }
    stopTextEdit(w, true);
  };
  document.addEventListener('pointerdown', w.__docDown, true);
  updateEflow();
  syncTextBar();
  if (window.__syncTypeShift) requestAnimationFrame(window.__syncTypeShift);
}
function stopTextEdit(w, commit, noRender) {
  if (!w || !w.__editing) return;               // 已结束：避免 blur / 点击重复提交
  w.__editing = false;
  if (w.__docDown) { document.removeEventListener('pointerdown', w.__docDown, true); w.__docDown = null; }
  const el = w.querySelector('.ptxt');
  if (el && w.__onInput) { el.removeEventListener('input', w.__onInput); w.__onInput = null; }
  w.classList.remove('editing', 'adjust', 'sel');
  w.classList.add('locked');                       // 编辑完文字默认自动固定
  if (el) {
    el.contentEditable = 'false';
    /* 收尾时把框收紧到内容高度：删掉几行后不会留一大块空白 */
    if (commit) fitTextHeight(w, el, false);
  } else { hideTextBar(); return; }
  if (commit) {
    /* 落盘认框自己的 data-page / data-id，不认 selText ——
       点纸面空白处时「取消选中」会先把 selText 清掉，只看它这里就白打字了 */
    const t = textById(+w.dataset.page, w.dataset.id)
      || (selText ? textById(selText.pid, selText.iid) : null);
    if (t) { t.text = (el.innerText || '').replace(/[\r\n]+$/, ''); t.locked = true; }
    markFlipSuppressed();          // 结束行内打字的这一下，同样不该顺手翻页
    save();
  }
  if (!noRender && w.isConnected) renderReader();
  hideTextBar();                          // 退出输入：底栏恢复页码与翻页
  if (window.__syncTypeShift) window.__syncTypeShift();   // 撤掉为输入法让位的抬升
  $$('.pimg-wrap,.ptext-wrap').forEach(x => x.classList.remove('sel', 'adjust'));
}
/* 翻页 / 关闭前先落盘正在编辑的文字 */
function commitTextEdit() {
  const w = document.querySelector('.ptext-wrap.editing');
  if (w) stopTextEdit(w, true, true);
}
