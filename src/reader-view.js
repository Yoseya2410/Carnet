/* =====================================================================
 * Carnet · 阅读器渲染 · 书页与排版   （脚本 12 / 24）
 * ---------------------------------------------------------------------
 * ① 单页 / 双页摊开判定 isSpread、书的尺寸与中缝布局 layoutBook
 * ② 封面页与内页渲染 coverPageHTML / pageHTML（图片与文字按 z 合排 pageObjs）
 * ③ 对象的公共外壳：工具条 objBarHTML、旋转 rotStyle、四角与旋转手柄 rotHandleHTML
 * ④ renderReader 总渲染、currentIndices 当前左右页下标
 *
 * 对外接口：renderReader, layoutBook, pageHTML, objBarHTML, rotStyle, isSpread, isCoverView, currentIndices
 *
 * 依赖模块：core, visuals, state（media / text-sticker 后置，只在运行时调用）
 *
 * 说明：模块间共用全局作用域，加载顺序即依赖顺序（见 index.html 与 README）。
 * ===================================================================== */
/* ==================== 阅读器 ==================== */
function isSpread() {
  return window.innerWidth >= 620 && window.innerWidth > window.innerHeight * 1.12;
}
function layoutBook() {
  const stage = $('#stage'), book = $('#book');
  const availW = stage.clientWidth;
  /* 文字编辑面板占住下半截时，书只在上面那一段里排版（__sheetCov 由 sheetLayout() 量出来） */
  const availH = Math.max(140, stage.clientHeight - (window.__sheetCov || 0));
  const spread = state.mode === 'spread';
  /* 纸张统一用 3:4.05 —— 与封面（.cover）同比例，
     这样阅读器里铺满整页的封面和主页显示的封面完全一样 */
  const RATIO = 1 / PAGE_RATIO;                 // 页宽 ÷ 页高（PAGE_RATIO 是页高 ÷ 页宽）
  let pageH, pageW;
  if (spread) {
    pageH = Math.min(availH * 0.9, (availW * 0.94) / (2 * RATIO));
    pageW = pageH * RATIO;
  } else {
    pageW = Math.min(availW * 0.94, availH * 0.94 * RATIO);
    pageH = pageW / RATIO;
  }
  pageH = Math.max(pageH, 180);
  book.style.setProperty('--pw', pageW + 'px');
  book.style.setProperty('--ph', pageH + 'px');
  state.pw = pageW;          // page-flip.js 翻页时按半页宽做位移，字号换算也用它（见 state 的注释）
}
/* 封面页：不属于正文页，-1 表示“封面” */
function coverPageHTML() {
  const j = cur();
  return `<div class="paper coverpage">${coverHTML(j)}</div>`;
}
/* 选中对象时浮在它上方的那条工具条（形状在 style/text.css 的 .objbar 里）。
   直接挂进对象内部：拖动 / 拉伸 / 重绘都自动跟着走，不用另算坐标。
   kind='text' 第三颗是「编辑文字」，kind='image' 换成「铺满整页 / 还原原比例」 */
function objBarHTML(kind, on) {
  const mid = kind === 'image'
    ? { t: on ? '还原原比例' : '铺满整页', svg: on ? RESTORE_SVG : FILL_SVG, cls: on ? ' on' : '' }
    : { t: '编辑文字', svg: OB_EDIT_SVG, cls: '' };
  return `<div class="objbar">
      <button class="ob" data-ob="close" title="完成">${OB_OK_SVG}</button>
      <button class="ob" data-ob="copy" title="复制一份">${OB_COPY_SVG}</button>
      <button class="ob${mid.cls}" data-ob="edit" title="${mid.t}">${mid.svg}</button>
      <button class="ob ob-del" data-ob="del" title="删除">${OB_DEL_SVG}</button>
    </div>`;
}
/* 旋转写进 style：transform 转整块，--rot 留给工具条反着转回来（见 text.css 的 .objbar） */
function rotStyle(o) {
  const r = +(o.rot || 0);
  return r ? `--rot:${r.toFixed(1)}deg;transform:rotate(${r.toFixed(1)}deg);` : '';
}
function imgWrapHTML(im, i) {
  const hw = im.h || clamp(im.w / 0.68, .04, IMG_MAX);   // 老数据补兜底高度，加载后自动校准
  return `
    <div class="pimg-wrap${String(im.src).startsWith('data:image/svg') ? ' sticker' : ''}${im.locked ? ' locked' : ''}${im.fill ? ' fill' : ''}${tinyCls(im, hw)}" data-page="${i}" data-id="${im.id}"
         style="left:${(im.x * 100).toFixed(2)}%;top:${(im.y * 100).toFixed(2)}%;width:${(im.w * 100).toFixed(2)}%;height:${(hw * 100).toFixed(2)}%;${rotStyle(im)}">
      <img class="pimg" draggable="false" src="${im.src}" alt="">
      ${objBarHTML('image', !!im.fill)}
      ${rotHandleHTML()}
      <div class="hdl tl" data-h="tl"></div>
      <div class="hdl tr" data-h="tr"></div>
      <div class="hdl bl" data-h="bl"></div>
      <div class="hdl br" data-h="br"></div>
    </div>`;
}
function textWrapHTML(t, i) {
  const st = textStyle(t);
  const cls = (t.text || '').trim() ? '' : ' placeholder';
  return `
    <div class="ptext-wrap${t.locked === false ? '' : ' locked'}" data-page="${i}" data-id="${t.id}"
         style="left:${(t.x * 100).toFixed(2)}%;top:${(t.y * 100).toFixed(2)}%;width:${(t.w * 100).toFixed(2)}%;height:${(t.h * 100).toFixed(2)}%;${rotStyle(t)}">
      <div class="ptxt${cls}" style="${st}">${t.text ? esc(t.text) : '双击编辑文字'}</div>
      ${objBarHTML('text')}
      ${rotHandleHTML()}
      <div class="hdl tl" data-h="tl"></div>
      <div class="hdl tr" data-h="tr"></div>
      <div class="hdl bl" data-h="bl"></div>
      <div class="hdl br" data-h="br"></div>
    </div>`;
}
/* 旋转手柄：挂在右边外侧的正中，往外挪开不跟四角抢位置；拖着转，双击摆正 */
function rotHandleHTML() {
  return `<div class="hdl rot" data-h="rot" title="拖动旋转 · 双击摆正">${ROT_SVG}</div>`;
}
/* 一页里的图片与文字按 z 从小到大排（z 越大越靠上）：先加的在下、后加的盖在上面。
   不再「图片一律在下、文字一律在上」—— 后贴的图就该压住先前写的字 */
function pageObjs(pg) {
  ensureZ(pg);
  const list = [];
  (pg.images || []).forEach(im => list.push({ k: 'img', o: im }));
  (pg.texts || []).forEach(t => list.push({ k: 'txt', o: t }));
  list.sort((a, b) => (a.o.z || 0) - (b.o.z || 0));
  return list;
}
function pageHTML(i, side) {
  const j = cur();
  const n = j.pages.length;
  if (i === -1) return coverPageHTML();
  if (i < 0 || i >= n) return `<div class="paper endpaper"></div>`;
  const pg = j.pages[i];
  const inner = pageObjs(pg).map(o => o.k === 'img' ? imgWrapHTML(o.o, i) : textWrapHTML(o.o, i)).join('');
  const kraft = (j.template === 'kraft' || j.template === 'kraftplain') ? 'background:linear-gradient(160deg,#ecdec4,#e0cfae);' : '';
  /* 自定义内页底色写在 kraft 后面：设了色就盖住模板自己的底色，没设才沿用。
     用 pageBgShown 而不是 pageBgOf：底色面板开着时按「正在挑的那一档」显示，
     按了「完成」才真写进 pg.bg（没按就是预览，关掉面板纸面自己会回去） */
  const shown = pageBgShown(pg, j, i);
  const dark = pageBgDarkShown(pg, j, i) ? ' dark' : '';    // 深色纸：页码改浅色才看得见
  return `<div class="paper t-${j.template}${dark}" style="${kraft}${shown ? 'background:' + shown + ';' : ''}">
    <div class="tplbg" style="${tplStyle(j.template)}"></div>
    <div class="pcontent">${inner}</div>
    <div class="pnum">${i + 1}</div>
  </div>`;
}
function currentIndices() {
  if (state.mode === 'spread') return [state.spread * 2, state.spread * 2 + 1];
  return [state.page];
}
function isCoverView() {
  return state.mode === 'spread' ? state.spread < 0 : state.page < 0;
}
function renderReader() {
  commitTextEdit();                    // 重绘前先把正在编辑的文字存下来
  const book = $('#book');
  state.mode = isSpread() ? 'spread' : 'single';
  /* 封面就是「合着的书」：单独一整页，左边不再配一张空页 */
  const cov = isCoverView();
  /* 封面单独成页：不再加 single / spread，改用 cover-only 的骨架（跨页尺寸 + 左页收起 + 整本左移半页） */
  book.classList.toggle('single', state.mode === 'single');
  book.classList.toggle('spread', state.mode === 'spread' && !cov);
  book.classList.toggle('cover-only', cov && state.mode === 'spread');
  const n = pageCount();
  const [a, b] = currentIndices();
  // 重建前先摘掉文字贴挂在 document 上的监听，避免节点被换掉后残留
  $$('#slotL .ptext-wrap, #slotR .ptext-wrap').forEach(x => {
    if (x.__outDown) { document.removeEventListener('pointerdown', x.__outDown, true); x.__outDown = null; }
  });
  if (state.mode === 'spread' && !cov) {
    $('#slotL').innerHTML = pageHTML(a, 'left');
    $('#slotR').innerHTML = pageHTML(b, 'right');
  } else {
    $('#slotL').innerHTML = '';
    $('#slotR').innerHTML = pageHTML(state.mode === 'spread' ? b : state.page, 'single');
  }
  $('#leaf').classList.remove('show');
  $('#leaf').style.transform = 'none';
  // 文本
  const j = cur();
  $('#rName').textContent = j.name;
  $('#rPages').textContent = `${n} 页 · ${state.mode === 'spread' ? '双页' : '单页'}`;
  const pager = $('#pager');
  if (isCoverView()) {
    // 封面不算页数：底栏不显示页码
    pager.textContent = '封面';
    pager.classList.remove('jumpable');
    pager.title = '';
    $('#prevBtn').disabled = true;
    $('#nextBtn').disabled = n <= 0;
  } else if (state.mode === 'spread') {
    const l = a, r = b;
    let txt = '';
    if (r < n) txt = `${l + 1}–${r + 1} / ${n}`;
    else txt = `${l + 1} / ${n}`;
    pager.textContent = txt;
    pager.classList.add('jumpable');
    pager.title = '长按拖动选页';
    $('#prevBtn').disabled = false;
    $('#nextBtn').disabled = state.spread >= Math.ceil(n / 2) - 1;
  } else {
    pager.textContent = `${state.page + 1} / ${n}`;
    pager.classList.add('jumpable');
    pager.title = '长按拖动选页';
    $('#prevBtn').disabled = false;
    $('#nextBtn').disabled = state.page >= n - 1;
  }
  layoutBook();
  bindPage();
  ensureImageHeights();
  // 重绘后恢复选中态（字号/颜色调整会触发重绘）
  try {
    if (selText) {
      const w = $(`#slotL .ptext-wrap[data-id="${selText.iid}"], #slotR .ptext-wrap[data-id="${selText.iid}"]`);
      const t = textById(selText.pid, selText.iid);
      if (w && t && t.locked === false) w.classList.add('adjust');   // 只有解锁状态才保留调整框
    }
  } catch (_) {}
  syncTextBar();                       // 底栏跟着当前是否选中文字切换
  const sc = $('#scrub');
  if (sc && sc.classList.contains('show')) paintScrub();
  markAddTarget();                     // 翻页后目标页描边跟着走（不在本跨页就回落到左页）
  updateAddMenuHint();
}

