/* =====================================================================
 * Carnet · 阅读器渲染 · 书页与排版   （脚本 12 / 23）
 * ---------------------------------------------------------------------
 * ① 单页 / 双页摊开判定，书的尺寸与中缝布局 layoutBook
 * ② 封面页、内页（图片 / 文字 / 模板）渲染 coverPageHTML / pageHTML
 * ③ renderReader 总渲染
 *
 * 依赖模块：core, visuals, state, carousel
 *
 * 说明：模块间共用全局作用域，按下面的顺序加载，顺序即依赖顺序。
 * ===================================================================== */
/* ==================== 阅读器 ==================== */
function isSpread() {
  return window.innerWidth >= 620 && window.innerWidth > window.innerHeight * 1.12;
}
function layoutBook() {
  const stage = $('#stage'), book = $('#book');
  const availW = stage.clientWidth, availH = stage.clientHeight;
  const spread = state.mode === 'spread';
  /* 纸张统一用 3:4.05 —— 与封面（.cover）同比例，
     这样阅读器里铺满整页的封面和主页显示的封面完全一样 */
  const RATIO = 3 / 4.05;
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
  state.pw = pageW;                              // 封面翻页时要按半页宽做位移
}
/* 封面页：不属于正文页，-1 表示“封面” */
function coverPageHTML() {
  const j = cur();
  return `<div class="paper coverpage">${coverHTML(j)}</div>`;
}
function pageHTML(i, side) {
  const j = cur();
  const n = j.pages.length;
  if (i === -1) return coverPageHTML();
  if (i < 0 || i >= n) return `<div class="paper endpaper"></div>`;
  const pg = j.pages[i];
  const imgs = pg.images.map(im => {
    const hw = im.h || clamp(im.w / 0.68, .04, IMG_MAX);   // 老数据补兜底高度，加载后自动校准
    return `
    <div class="pimg-wrap${String(im.src).startsWith('data:image/svg') ? ' sticker' : ''}${im.locked ? ' locked' : ''}${im.fill ? ' fill' : ''}${tinyCls(im, hw)}" data-page="${i}" data-id="${im.id}"
         style="left:${(im.x * 100).toFixed(2)}%;top:${(im.y * 100).toFixed(2)}%;width:${(im.w * 100).toFixed(2)}%;height:${(hw * 100).toFixed(2)}%">
      <img class="pimg" draggable="false" src="${im.src}" alt="">
      <button class="img-del" title="删除">${DEL_SVG}</button>
      <div class="hdl tl" data-h="tl"></div>
      <div class="hdl tr" data-h="tr"></div>
      <div class="hdl bl" data-h="bl"></div>
      <div class="hdl br" data-h="br"></div>
      <button class="img-lock" title="固定到这一页">${LOCK_SVG}</button>
      <button class="img-lock img-fill" title="${im.fill ? '还原原比例' : '铺满整页'}">${im.fill ? RESTORE_SVG : FILL_SVG}</button>
    </div>`;
  }).join('');
  const txts = pageTexts(pg).map(t => {
    const st = textStyle(t);
    const cls = (t.text || '').trim() ? '' : ' placeholder';
    return `
    <div class="ptext-wrap${t.locked === false ? '' : ' locked'}" data-page="${i}" data-id="${t.id}"
         style="left:${(t.x * 100).toFixed(2)}%;top:${(t.y * 100).toFixed(2)}%;width:${(t.w * 100).toFixed(2)}%;height:${(t.h * 100).toFixed(2)}%">
      <div class="ptxt${cls}" style="${st}">${t.text ? esc(t.text) : '双击输入文字'}</div>
      <button class="img-del" title="删除文字">${DEL_SVG}</button>
      <div class="hdl tl" data-h="tl"></div>
      <div class="hdl tr" data-h="tr"></div>
      <div class="hdl bl" data-h="bl"></div>
      <div class="hdl br" data-h="br"></div>
    </div>`;
  }).join('');
  const kraft = (j.template === 'kraft' || j.template === 'kraftplain') ? 'background:linear-gradient(160deg,#ecdec4,#e0cfae);' : '';
  return `<div class="paper t-${j.template}" style="${kraft}">
    <div class="tplbg" style="${tplStyle(j.template)}"></div>
    <div class="pcontent">${imgs}${txts}</div>
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

