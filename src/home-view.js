/* =====================================================================
 * Carnet · 主页渲染 · 书架与轮播骨架   （脚本 11 / 27）
 * ---------------------------------------------------------------------
 * ① 封面 coverHTML / 单本书 bookItemHTML / 多层书架 renderShelf
 * ② 单层书架 spineItemHTML / renderSpineShelf / renderSpineDetail / syncSpineSelection
 * ③ 书架多选模式 enterPickMode / exitPickMode / togglePick 与选择条 syncPickBar
 * ④ 主页总渲染 renderHome、三种展示模式切换 syncViewToggle / setView
 *
 * 对外接口：renderHome, renderShelf, renderSpineShelf, renderSpineDetail, spineSetHover, syncSpineSelection, coverHTML, bookItemHTML, enterPickMode, exitPickMode, togglePick, setView
 *
 * 依赖模块：core, visuals, state, storage（carousel 后置，只在运行时调用）
 *
 * 说明：模块间共用全局作用域，加载顺序即依赖顺序（见 index.html 与 README）。
 * ===================================================================== */
/* ==================== 封面渲染 ====================
   封面按 j.style 分成三种装帧（见 visuals.js 的 BOOK_STYLES）：
     笔记本 / 方形画册 —— 左侧硬壳书脊（笔记本才有彩带）
     活页手帐 —— 左侧一排金属活页环（6 颗）
   共同的那几层（由下往上）：底色 → 图案 → 光泽 → 装订。
   ⚠️ 活页那档要把 .cover 的 overflow 放开（环要探出左边一点才像真的环），
      放开的代价是里面每一层都得自己按封面圆角裁（见 book-style.css 的 border-radius:inherit） */
function coverHTML(j) {
  const st = bookStyleOf(j);
  const bg = j.cover.img ? `background-image:url('${j.cover.img}');background-size:cover;background-position:center;` : `background:${j.cover.value};`;
  /* 上传了封面图片就不叠图案（图案是按底色深浅配色的，压在照片上只会糊成一片） */
  const pat = j.cover.img ? '' : patternStyle(j.cover.pattern, j.cover);
  /* ---- 装订那一列 ----
     ⚠️ 彩带只有笔记本这一档有（bookHasRibbon）：活页有金属环、画册是方开本，
        都不画那条竖带，编辑器里那排颜色也一并藏了（见 editor.js 的 syncEditor） */
  let bind = '';
  if (st.rings) {
    const n = st.rings, gap = 92 / n;
    bind = `<div class="rings n${n}">`
      + Array.from({ length: n }, (_, i) => `<i style="top:${(4 + i * gap).toFixed(2)}%"></i>`).join('')
      + `</div>`;
  } else if (st.ribbon) {
    const spine = ribbonSpine(j.ribbon);               // 彩带选「透明」时为空
    /* 透明彩带：颜色带不画，但保留装订处那道压暗阴影 + 内侧高光，封面才不像一张平卡 */
    bind = spine ? `<div class="spine" style="background:${spine}"></div>`
                 : `<div class="spine ghost"></div>`;
  } else {
    /* 硬壳但不带彩带（方形画册）：只留装订压痕，避免封面看着像一张平卡 */
    bind = `<div class="spine ghost"></div>`;
  }
  return `<div class="cover s-${st.k}" style="${bg}">
    <div class="pattern" data-pat="${j.cover.img ? 'none' : (j.cover.pattern || 'none')}" style="${pat}"></div>
    <div class="gloss"></div>
    ${bind}
  </div>`;
}

/* ==================== 主页渲染 ==================== */
/* 单本书的 HTML，轮播和书架共用（书架里不带 gear，用长按/点击区分） */
function bookItemHTML(j, i, sel) {
  const s = (sel == null ? state.sel : sel);
  const on = state.picking && state.picked.has(j.id);
  return `
    <div class="book-item${i === s ? ' active' : ''}${on ? ' picked' : ''}" data-i="${i}" data-id="${j.id || ''}">
      ${coverHTML(j)}
      <i class="pick" title="选择"></i>
      <div class="gear" data-gear="${i}" title="编辑">
        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round"><path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2.1"/><circle cx="8" cy="17" r="2.1"/></svg>
      </div>
      <div class="cover-badge">${j.pages.length} 页</div>
    </div>`;
}
/* 顶部标题、页数、计数胶囊这些跟选中项绑定的东西，两种模式共用 */
function syncHomeHead() {
  const j = cur();
  const has = !!j;
  $('#homeName').textContent = has ? j.name : '还没有手帐本';
  $('#homePages').innerHTML = has ? `<span>▤</span><span>${j.pages.length} 页</span>` : `<span>▤</span><span>点右下角 ＋ 新建</span>`;
  $('#countPill').textContent = has ? `${state.sel + 1} / ${state.journals.length}` : '0 / 0';
  $$('.actionbar .icon-btn[data-act="del"],.actionbar .icon-btn[data-act="share"],.actionbar .icon-btn[data-act="more"]').forEach(b => b.disabled = !has);
}
/* 书架模式：一行能放几本、每本多宽，全部按屏幕宽度的比例算，
   屏幕越宽书越大、每行放得越多，跟手机上的书架 App 一个思路 */
/* order / sel 只在拖动排序过程中传入：用临时的排列渲染，不动 state */
/* ⚠️「一行固定放 per 本」这个算法不能用 —— 它按**常规书宽** bw 算容量，
   可方形画册比常规本宽 4.05/3 ≈ 1.35 倍（见 book-style.css 的 .cover.s-square），
   一排里只要混进一本画册，整排书的宽度就超过搁板、甚至戳出屏幕
   （书架容器是 overflow-x:hidden，超出去的那本会被直接裁掉）。
   所以改成**逐本试放**：累加这一排的真实宽度，下一本放不下就换行。 */
const SHELF_SQ_K = 4.05 / 3;        // 方形画册相对常规本的宽度倍数，与 CSS 的 .s-square 保持一致
function renderShelf(order, sel) {
  const wrap = $('#shelfWrap');
  if (!wrap) return;
  const js = order || state.journals;
  wrap.dataset.per = '';
  if (!js.length) {
    wrap.innerHTML = '<div class="shelf-empty">书架还空着，点右下角 ＋ 新建一本吧</div>';
    return;
  }
  /* 可用宽度要扣掉左右内边距，否则搁板会算得比容器还宽、超出屏幕 */
  const cs = getComputedStyle(wrap);
  const padX = (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0);
  const W = Math.max((wrap.clientWidth || 0) - padX, 240);
  const bw = Math.round(clamp(W * 0.205, 86, 158));   // 书宽 ≈ 容器宽的两成，不过窄不过宽
  const gap = Math.round(clamp(W * 0.032, 14, 44));   // 间隙也跟着缩放
  const endPad = Math.round(clamp(gap * 0.85, 10, 26));  // 搁板两端要留出的余量
  wrap.style.setProperty('--sbw', bw + 'px');
  wrap.style.setProperty('--sgap', gap + 'px');
  /* 一本手帐本在书架上实际占多宽：只有方形画册更宽（一样高、只是方） */
  const wOf = j => (bookStyleOf(j).k === 'square' ? bw * SHELF_SQ_K : bw);
  /* 逐本试放：usable 是「这一排书最多能占多宽」。取 W 减两端的最小余量 ——
     只要求**最小**余量而不是完整的 endPad：够放下就尽量多放一本，
     搁板长度另有下限（W*0.86），少留一点余量看着照样是一块完整的板子。
     ⚠️ 关键是 inner ≤ usable ≤ W：boardW 取的是 min(W, inner + endPad*2)，
        只要书排不超出 usable，它就既不会超出搁板、也不会超出屏幕。
     cur.length 为 0 时无条件放，保证每行至少有一本（哪怕一本画册比 usable 还宽，
     也不会出现空行死循环） */
  const minPad = Math.round(clamp(gap * 0.4, 6, 14));
  const usable = Math.max(W - minPad * 2, 1);
  const rows = [];
  let cur = [], curW = 0;
  for (const j of js) {
    const w = wOf(j);
    if (cur.length && curW + gap + w > usable) { rows.push(cur); cur = []; curW = 0; }
    curW += (cur.length ? gap : 0) + w;
    cur.push(j);
  }
  if (cur.length) rows.push(cur);
  /* 各行的本数不一定相同，整串写进 dataset.per（逗号分隔）——
     拖动排序搬 DOM 节点时要照同样的分行走 */
  wrap.dataset.per = rows.map(r => r.length).join(',');

  let html = '', s = 0;
  for (const row of rows) {
    const inner = row.reduce((a, j) => a + wOf(j), 0) + gap * (row.length - 1);
    /* 搁板长度：至少比这一排书占的宽度多出两端余量，同时尽量铺满整格。
       上限是容器宽，保证不会溢出屏幕；下限保证整排书一定站得下。
       上面已经保证 inner ≤ usable ≤ W，所以 boardW 一定不会小于 inner ——
       书排永远落在板子上，不会戳出去 */
    const boardW = Math.round(Math.min(W, Math.max(inner + endPad * 2, W * 0.86)));
    html += '<div class="shelf-row" style="--bw:' + boardW + 'px">' +
      '<div class="shelf-books">' +
      row.map((j, k) => bookItemHTML(j, s + k, sel)).join('') +
      '</div>' +
      '<div class="shelf-board"><i class="screw sl"></i><i class="screw sr"></i></div>' +
      '</div>';
    s += row.length;
  }
  wrap.innerHTML = html;
}

/* ==================== 单层书架：书脊与下方预览 ====================
   高度由 id 确定性地算出来：同一本书每次重绘都保持原样，
   不会因为选中、编辑或换模式而在整排里突然变高变矮。
   宽度跟页数走 —— 越厚越宽，但要用对数压过：
   1 页和 64 页之间才拉开 [最窄, 最宽] 这一小段，再往后加页也几乎看不出变化，
   免得一本厚的把整排书挤歪。最窄宽度写在 CSS 里（--spine-min-w），薄本也有下限。 */
const SPINE_PAGES_FULL = 64;     // 到这个页数，书脊宽到头
function spineWidthRatio(j) {
  const p = Math.max(1, (j && j.pages) ? j.pages.length : 1);
  /* log2 让「页数翻一倍」只换来等量的宽度增量，而不是跟着页数线性变胖 */
  return clamp(Math.log2(1 + p) / Math.log2(1 + SPINE_PAGES_FULL), 0, 1).toFixed(3);
}
function spineItemHTML(j, i) {
  const text = String(j.id || j.name || i);
  let seed = (i + 1) * 37;
  for (let k = 0; k < text.length; k++) seed = ((seed * 33) + text.charCodeAt(k)) >>> 0;
  const heights = [0.72, 0.88, 0.64, 0.96, 0.80, 0.69, 0.92, 0.76, 0.86];
  const h = heights[(seed >>> 3) % heights.length];
  const bg = j.cover.img
    ? `background-image:url('${j.cover.img}');background-size:cover;background-position:center;`
    : `background:${j.cover.value};`;
  const ink = coverLum(j.cover) > 0.58 ? '#28241f' : '#fffaf2';
  const pat = j.cover.img ? '' : patternStyle(j.cover.pattern, j.cover);
  const name = esc(j.name);
  return `<button type="button" class="spine-item${i === state.sel ? ' active' : ''}"
    data-i="${i}" data-id="${j.id || ''}" title="${name}" aria-label="${name}，${j.pages.length} 页"
    aria-pressed="${i === state.sel}" style="--spine-p:${spineWidthRatio(j)};--spine-h:${h};--spine-ink:${ink};${bg}">
    <span class="spine-pattern" style="${pat}"></span>
    <span class="spine-art deco-${seed % 6}" aria-hidden="true"><i></i><i></i><i></i></span>
    <span class="spine-title">${name}</span>
    <span class="spine-foot" aria-hidden="true"></span>
  </button>`;
}
/* 下方那块是「预览图」：鼠标停在哪根书脊上就显示哪一本的封面，移开书脊整块淡出。
   ⚠️ 只有能悬停的设备（鼠标）才有预览：手机上没有悬停这一说，
      而且屏幕就那么大 —— 预览框白占一截高度，不如把空间还给书脊（见 .no-preview）。
   ⚠️ 预览归预览，选中归选中：预览只是跟着鼠标走，不影响 state.sel */
let spineHover = -1;
function spineCanHover() {
  return !!(window.matchMedia && window.matchMedia('(hover:hover)').matches);
}
function spinePreviewIdx() {
  return (spineHover >= 0 && spineHover < state.journals.length) ? spineHover : -1;
}
function spineSetHover(i) {
  const n = Number.isFinite(i) ? i : -1;
  if (spineHover === n) return;
  spineHover = n;
  renderSpineDetail();
}
function renderSpineDetail() {
  const detail = $('#spineDetail');
  if (!detail) return;
  const i = spinePreviewIdx();
  const j = state.journals[i];
  detail.classList.toggle('empty', !j);
  /* 只放封面：书名就印在书脊上，页数点开就有，这里不再重复，也不挂编辑按钮
     （改这本走「长按书脊 → 原地松手」） */
  detail.innerHTML = j ? `
    <div class="spine-detail-cover book-item active" data-i="${i}" data-spine-open
      role="button" tabindex="0" aria-label="翻开${esc(j.name)}">
      ${coverHTML(j)}
    </div>` : '';
}
function syncSpineSelection(animate) {
  $$('#spineRow .spine-item').forEach(el => {
    const on = +el.dataset.i === state.sel;
    el.classList.toggle('active', on);
    el.setAttribute('aria-pressed', String(on));
  });
  renderSpineDetail();
  syncHomeHead();
  if (animate) requestAnimationFrame(() => {
    const el = $(`#spineRow .spine-item[data-i="${state.sel}"]`);
    if (el && el.scrollIntoView) el.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
  });
}
function renderSpineShelf() {
  const row = $('#spineRow');
  if (!row) return;
  spineHover = -1;                 // 整排重画后鼠标不一定还压在同一根书脊上
  /* 手机 / 平板没有悬停，预览框整块收掉：点书脊直接翻开，省下的高度全给书脊 */
  const wrap = $('#spineWrap');
  if (wrap) wrap.classList.toggle('no-preview', !spineCanHover());
  if (!state.journals.length) {
    row.innerHTML = '<div class="spine-empty">书架还空着，点右下角 ＋ 新建一本吧</div>';
    renderSpineDetail();
    return;
  }
  row.innerHTML = state.journals.map((j, i) => spineItemHTML(j, i)).join('');
  syncSpineSelection(false);
  /* 从其它模式切回来时，当前那本可能排在屏幕外；只横移书排，不动整页 */
  requestAnimationFrame(() => {
    const el = $(`#spineRow .spine-item[data-i="${state.sel}"]`);
    if (el && el.scrollIntoView) el.scrollIntoView({ block: 'nearest', inline: 'center' });
  });
}
/* ==================== 书架多选导出 ==================== */
/* 勾选用手帐本 id 记，不记下标 —— 中途增删或改顺序都不会认错人 */
function pickedList() { return state.journals.filter(j => state.picked.has(j.id)); }
function syncPickBar() {
  const n = pickedList().length, all = state.journals.length;
  const forDel = state.pickPurpose === 'del';
  $('#pickCount').textContent = n ? `已选 ${n} 本` : (forDel ? '勾选要删除的' : '勾选手帐本');
  $('#pickExport').disabled = !n;
  $('#pickDelete').disabled = !n;
  $('#pickAll').textContent = (n && n === all) ? '全不选' : '全选';
}
/* purpose: 'export' 从分享进来（导出为主）/ 'del' 从删除进来（删除为主） */
function enterPickMode(purpose) {
  if (state.picking) return;
  const forDel = purpose === 'del';
  if (!state.journals.length) { toast(forDel ? '还没有手帐本可以删除' : '还没有手帐本可以导出'); return; }
  state.picking = true;
  state.pickPurpose = forDel ? 'del' : 'export';
  state.picked = new Set();                            // 一本都不预勾，选什么由你决定
  const wrap = $('#shelfWrap');
  wrap.classList.add('picking');
  wrap.querySelectorAll('.book-item').forEach(el => {
    el.classList.toggle('picked', !!el.dataset.id && state.picked.has(el.dataset.id));
  });
  $('#pickBar').hidden = false;
  const bar = $('#home .actionbar:not(.pickbar)');
  if (bar) bar.hidden = true;
  $('#pickBar').classList.toggle('purpose-del', forDel);
  syncPickBar();
  toast(forDel ? '勾选手帐本，确认后删除' : '勾选手帐本，可批量导出或删除');
}
function exitPickMode() {
  if (!state.picking) return;
  state.picking = false;
  state.picked.clear();
  closeMenus();
  const wrap = $('#shelfWrap');
  wrap.classList.remove('picking');
  wrap.querySelectorAll('.book-item.picked').forEach(el => el.classList.remove('picked'));
  $('#pickBar').hidden = true;
  $('#pickBar').classList.remove('purpose-del');
  const bar = $('#home .actionbar:not(.pickbar)');
  if (bar) bar.hidden = false;
}
function togglePick(i) {
  const j = state.journals[i];
  if (!j) return;
  if (state.picked.has(j.id)) state.picked.delete(j.id);
  else state.picked.add(j.id);
  const el = $('#shelfWrap .book-item[data-i="' + i + '"]');
  if (el) el.classList.toggle('picked', state.picked.has(j.id));
  syncPickBar();
  try { navigator.vibrate && navigator.vibrate(8); } catch (_) {}
}

function renderHome() {
  const view = state.prefs.view;
  const shelfMode = view === 'shelf';
  const spineMode = view === 'spine';
  if (!shelfMode) exitPickMode();     // 离开多层书架就把多选状态收干净
  $('#carouselWrap').hidden = view !== 'carousel';
  $('#shelfWrap').hidden = !shelfMode;
  $('#spineWrap').hidden = !spineMode;
  if (shelfMode) {
    renderShelf();
  } else if (spineMode) {
    renderSpineShelf();
  } else {
    $('#carousel').innerHTML = state.journals.map((j, i) => bookItemHTML(j, i)).join('');
    requestAnimationFrame(() => layoutCarousel(true));
  }
  /* 两种书架都把名称放在书籍本身或下方详情里，顶部不再重复 */
  const head = $('.home-head');
  if (head) head.hidden = view !== 'carousel';
  /* 换模式 / 增删本时把「滑动中让开的浮层按钮」收回来，免得停在隐藏态 */
  $('#home').classList.remove('bars-away');
  syncHomeHead();
  if (state.picking) syncPickBar();     // 增删本之后「已选 N 本」跟着更新
}
/* 切换主页展示模式，记住选择，下次打开还是这个模式 */
function syncViewToggle() {
  const box = $('#viewToggle');
  if (box) box.dataset.vt = state.prefs.view;      // 白色圆钮滑到哪一格（CSS 只管位移）
  $$('#viewToggle button').forEach(b => b.classList.toggle('on', b.dataset.vt === state.prefs.view));
}
function setView(v) {
  if (!['carousel', 'shelf', 'spine'].includes(v)) return;
  if (state.prefs.view === v) { syncViewToggle(); return; }
  state.prefs.view = v;
  syncViewToggle();
  savePrefs();
  renderHome();
}
