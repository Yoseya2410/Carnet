/* =====================================================================
 * Carnet · 图片边框 · 底部弹窗   （脚本 20 / 27）
 * ---------------------------------------------------------------------
 * 选中一张图片 → 工具条上的「边框」→ 从底部升起这张面板：
 * 五种框（无 / 拍立得 / 纯色 / 细线 / 拟物相框）+ 八档预设色 + 自定义色 + 一根粗细拖动条。
 *
 * 挑一档**立刻生效**并且当场存档：跟「本页底色」那套「预览 + 完成」不一样 ——
 * 边框是加在已选中的那张图上的，一边挑一边在纸上看着变，比「挑完再确认」直观得多；
 * 不想要了就点回「无边框」，一样是一步。
 * 换框不整页重绘：只改那张图的 .pframe（paintFrame），选中态、工具条、位置全保留。
 *
 * 对外接口：openFrameSheet, closeFrameSheet, paintFrame
 *
 * 依赖模块：core, visuals, state（reader-view / text-sticker / widgets 后置，只在运行时用）
 *
 * 说明：模块间共用全局作用域，加载顺序即依赖顺序（见 index.html 与 README）。
 * ===================================================================== */
const frs = { open: false, pid: 0, iid: null, built: false, out: null };

function frObj() {
  const j = cur(); if (!j) return null;
  const pg = j.pages[frs.pid]; if (!pg) return null;
  return (pg.images || []).find(x => x.id === frs.iid) || null;
}
function frWrap() {
  return $(`#slotL .pimg-wrap[data-id="${frs.iid}"], #slotR .pimg-wrap[data-id="${frs.iid}"]`);
}
/* ---- 就地换框：只动这一张图自己的两层节点，不惊动整页 ----
   整页重绘会把选中态、工具条、正在用的手势一起冲掉，所以这里手工改：
     没框 → 有框：把 <img> 塞进一层新建的 .pframe
     有框 → 没框：把 <img> 从 .pframe 里摘出来，.pframe 删掉
     换框 / 换色 / 换粗细：.pframe 的 style 整段重写 */
function paintFrame(w, im) {
  if (!w) return;
  const img = w.querySelector('.pimg');
  if (!img) return;
  let box = w.querySelector('.pframe');
  if (!hasFrame(im)) {
    if (box) { box.parentNode.insertBefore(img, box); box.remove(); }
    img.setAttribute('style', frameImgStyle(im));
    return;
  }
  if (!box) {
    box = document.createElement('div');
    box.className = 'pframe';
    w.insertBefore(box, img);
    box.appendChild(img);
  }
  box.setAttribute('style', frameBoxStyle(im));
  img.setAttribute('style', frameImgStyle(im));
}
/* 画完顺手把工具条上那颗「边框」点亮 / 熄灭 */
function syncFrameBtn(w, im) {
  const b = w && w.querySelector('.ob[data-ob="frame"]');
  if (b) b.classList.toggle('on', hasFrame(im));
}
/* ==================== 面板 ==================== */
function frApply() {
  const im = frObj(); if (!im) return;
  const w = frWrap();
  paintFrame(w, im);
  syncFrameBtn(w, im);
  save();
  if (w) fitObjBar(w);
  syncFrSheet();
}
/* 点同一种框 = 取消（换回无边框）：挑错了不用再去点「无」 */
function pickFrame(k) {
  const im = frObj(); if (!im) return;
  im.fr = (normFrame(im.fr) === k && k !== 'none') ? 'none' : normFrame(k);
  if (!hasFrame(im)) { delete im.frc; delete im.frw; }
  frApply();
}
function pickFrameColor(hex) {
  const im = frObj(); if (!im) return;
  const c = normHex6(hex);
  if (c) im.frc = c; else delete im.frc;
  /* 现在是无边框：挑颜色时顺手给一档「纯色」，不然挑了半天看不出变化 */
  if (!hasFrame(im)) { im.fr = 'color'; if (!im.frw) im.frw = 2; }
  frApply();
}
function pickFrameWidth(v) {
  const im = frObj(); if (!im) return;
  im.frw = clamp(Math.round(+v || FRAME_W_DEFAULT), 1, 100);
  if (!hasFrame(im)) { im.fr = 'color'; if (!im.frc) im.frc = '#ffffff'; }
  frApply();
}
/* 一次建好，之后只刷选中态 */
function buildFrSheet() {
  const g = $('#frGrid');
  if (g) {
    g.innerHTML = FRAMES.map(f =>
      `<button class="fr-opt" data-fr="${f.k}" title="${f.n}">`
      + `<span class="fr-ico" data-fr="${f.k}"><i></i></span><span class="fr-n">${f.n}</span></button>`).join('');
    g.addEventListener('click', e => {
      const b = e.target.closest('.fr-opt'); if (!b) return;
      pickFrame(b.dataset.fr);
    });
  }
  const c = $('#frColors');
  if (c) {
    c.innerHTML = FRAME_COLORS.map(x =>
      `<button data-frcolor="${x}" style="background:${x}" title="${x}"></button>`).join('')
      + `<button class="custom" id="frColorCustom" title="自定义边框颜色"><span class="cus-ico">＋</span></button>`;
    c.addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.id === 'frColorCustom') {
        openColorPicker('自定义边框颜色', (frObj() && normHex6(frObj().frc)) || '', hex => pickFrameColor(hex));
        return;
      }
      if (b.dataset.frcolor) pickFrameColor(b.dataset.frcolor);
    });
  }
  /* 粗细是一根拖动条（1~100 连续），不是三档按钮 —— 边框粗细这种东西，
     手指拖着看纸上变化比「细 / 中 / 粗」三档选一个准得多 */
  const w = $('#frWidth');
  if (w) {
    w.min = '1'; w.max = '100'; w.step = '1';
    /* input 事件：拖的过程中实时画到纸上；change 只在松手时补一次存档 */
    w.addEventListener('input', () => {
      const n = $('#frWidthVal');
      if (n) n.textContent = w.value;
      pickFrameWidth(w.value);
    });
  }
  const done = $('#frDone');
  if (done) done.onclick = closeFrameSheet;
  frs.built = true;
}
function syncFrSheet() {
  const im = frObj(); if (!im) return;
  const k = normFrame(im.fr);
  $$('#frGrid .fr-opt').forEach(b => b.classList.toggle('on', b.dataset.fr === k));
  const c = normHex6(im.frc) || '';
  $$('#frColors button[data-frcolor]').forEach(b =>
    b.classList.toggle('on', !!c && normHex6(b.dataset.frcolor) === c));
  const cus = $('#frColorCustom');
  if (cus) {
    const mine = !!c && !FRAME_COLORS.some(x => normHex6(x) === c);
    cus.classList.toggle('on', mine);
    cus.style.background = mine ? c : '';
  }
  /* 拖动条当前值（每次同步都要跟上，否则换张图数字还停在上一次） */
  const wv = frameWidth(im), sl = $('#frWidth'), wn = $('#frWidthVal');
  if (sl) sl.value = wv;
  if (wn) wn.textContent = wv;
  /* 缩略预览：就拿这张图本人，按当前这档画一个小样（阴影那几个 px 缩一半，小图才不糊） */
  const demo = $('#frDemo'), img = $('#frDemoImg');
  if (demo) demo.setAttribute('style', frameBoxStyle(im, .5));
  if (img) { img.src = im.src; img.setAttribute('style', frameImgStyle(im)); }
  /* 五档小样里的颜色跟着当前边框色走：挑颜色的时候几张小样一起变，不用一档档点过去看 */
  const shown = c || FRAME_DEFAULT_COLOR[k] || '#ffffff';
  $$('#frGrid .fr-ico').forEach(el => {
    const kind = el.dataset.fr;
    if (kind === 'color') el.style.background = shown;
    else if (kind === 'photo') el.style.background =
      `linear-gradient(145deg,rgba(255,255,255,.45),rgba(255,255,255,0) 42%,rgba(0,0,0,.34)),${shown}`;
    else if (kind === 'line') {
      const i = el.querySelector('i');
      if (i) i.style.boxShadow = `inset 0 0 0 1.6px ${shown}`;
    }
  });
  /* 无边框没有边框色可挑：整行淡下去。粗细那一行同理（无边框时谈粗细没意义） */
  const noColor = (k === 'none');
  const wrow = $('#frWidthRow');
  if (wrow) wrow.classList.toggle('dim', noColor);
  const row = $('#frColorRow');
  if (row) row.classList.toggle('dim', noColor);
  const dots = $('#frColors');
  if (dots) dots.classList.toggle('dim', noColor);
  const hint = $('#frHint');
  if (hint) hint.textContent = (FRAMES.find(f => f.k === k) || FRAMES[0]).n;
}
/* 点面板外面就收面板（改动已经当场存过了，收面板 ≠ 撤销） */
function frArmOutside() {
  frDisarmOutside();
  frs.out = ev => {
    if (ev.target.closest && ev.target.closest('#frsheet, #eflowTop, .cp-mask, #addMenu')) return;
    closeFrameSheet();
  };
  document.addEventListener('pointerdown', frs.out, true);
}
function frDisarmOutside() {
  if (frs.out) { document.removeEventListener('pointerdown', frs.out, true); frs.out = null; }
}
function openFrameSheet(pid, iid) {
  const j = cur(); if (!j) return;
  const pg = j.pages[pid]; if (!pg) return;
  if (!(pg.images || []).some(x => x.id === iid)) return;
  closeAddMenu();
  /* 别的编辑面板让位：同一时刻只开一张 */
  if (typeof hideTextBar === 'function' && typeof sh !== 'undefined' && sh && sh.open) hideTextBar();
  if (typeof closeBgSheet === 'function') closeBgSheet();
  if (typeof closeStickerSheet === 'function') closeStickerSheet();
  frs.open = true; frs.pid = pid; frs.iid = iid;
  window.__frSheetOpen = true;
  window.__frOk = closeFrameSheet;
  if (!frs.built) buildFrSheet();
  const sheet = $('#frsheet'); if (!sheet) return;
  sheet.hidden = false;
  syncFrSheet();
  updateEflow();
  requestAnimationFrame(() => { sheetLayout(); layoutBook(); refitObjBars(); });
  setTimeout(() => { sheetLayout(); layoutBook(); }, 340);
  frArmOutside();
}
function closeFrameSheet() {
  if (!frs.open) return;
  frs.open = false;
  window.__frSheetOpen = false;
  window.__frOk = null;
  frDisarmOutside();
  const sheet = $('#frsheet');
  if (sheet) { sheet.hidden = true; sheet.style.transform = ''; sheet.style.maxHeight = ''; }
  markFlipSuppressed();
  window.__sheetCov = 0;
  const reader = $('#reader');
  if (reader) reader.style.setProperty('--stage-shift', '0px');
  updateEflow();
  if (typeof layoutBook === 'function') layoutBook();
}
