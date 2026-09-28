/* =====================================================================
 * Carnet · 主页渲染 · 书架与轮播骨架   （脚本 10 / 23）
 * ---------------------------------------------------------------------
 * ① 封面 HTML coverHTML / 单本书 bookItemHTML / 书架 renderShelf
 * ② 书架多选模式切换 enterPickMode / exitPickMode / togglePick
 * ③ 主页总渲染 renderHome、两种展示模式切换、模式按钮的液态玻璃折射贴图
 *
 * 依赖模块：core, visuals, state, storage, carousel
 *
 * 说明：模块间共用全局作用域，按下面的顺序加载，顺序即依赖顺序。
 * ===================================================================== */
/* ==================== 封面渲染 ==================== */
function coverHTML(j) {
  const bg = j.cover.img ? `background-image:url('${j.cover.img}');background-size:cover;background-position:center;` : `background:${j.cover.value};`;
  return `<div class="cover" style="${bg}">
    <div class="pattern" data-pat="${j.cover.pattern || 'none'}" style="${patternStyle(j.cover.pattern, j.cover)}"></div>
    <div class="gloss"></div>
    <div class="spine" style="background:linear-gradient(90deg,${shade(j.ribbon, -22)},${j.ribbon} 55%,${shade(j.ribbon, 14)})"></div>
    <div class="edge"></div>
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
  const per = Math.max(2, Math.floor((W - 8) / (bw + gap)));
  wrap.style.setProperty('--sbw', bw + 'px');
  wrap.style.setProperty('--sgap', gap + 'px');
  wrap.dataset.per = per;            // 拖动排序时要按同样的行数搬 DOM 节点

  let html = '';
  for (let s = 0; s < js.length; s += per) {
    const row = js.slice(s, s + per);
    /* 搁板长度：至少比这一排书占的宽度多出两端余量，同时尽量铺满整格。
       上限是容器宽，保证不会溢出屏幕；下限保证整排书一定站得下 */
    const inner = row.length * bw + (row.length - 1) * gap;
    const endPad = Math.round(clamp(gap * 0.85, 10, 26));
    const boardW = Math.round(Math.min(W, Math.max(inner + endPad * 2, W * 0.86)));
    html += '<div class="shelf-row" style="--bw:' + boardW + 'px">' +
      '<div class="shelf-books">' +
      row.map((j, k) => bookItemHTML(j, s + k, sel)).join('') +
      '</div>' +
      '<div class="shelf-board"><i class="screw sl"></i><i class="screw sr"></i></div>' +
      '</div>';
  }
  wrap.innerHTML = html;
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
  const shelfMode = state.prefs.view === 'shelf';
  if (!shelfMode) exitPickMode();     // 离开书架就把多选状态收干净
  $('#carouselWrap').hidden = shelfMode;
  $('#shelfWrap').hidden = !shelfMode;
  if (shelfMode) {
    renderShelf();
  } else {
    $('#carousel').innerHTML = state.journals.map((j, i) => bookItemHTML(j, i)).join('');
    requestAnimationFrame(() => layoutCarousel(true));
  }
  /* 书架模式：整排封面摆在那儿就是书名，顶部不再重复显示名称和页数 */
  const head = $('.home-head');
  if (head) head.hidden = shelfMode;
  syncHomeHead();
  if (state.picking) syncPickBar();     // 增删本之后「已选 N 本」跟着更新
}
/* 切换主页展示模式，记住选择，下次打开还是这个模式 */
function syncViewToggle() {
  $$('#viewToggle button').forEach(b => b.classList.toggle('on', b.dataset.vt === state.prefs.view));
}
function setView(v) {
  if (!v || state.prefs.view === v) { syncViewToggle(); return; }
  state.prefs.view = v;
  syncViewToggle();
  savePrefs();
  renderHome();
}
/* ==================== 模式切换按钮的「液态玻璃」折射贴图 ====================
   照 shuding/liquid-glass 的路子：用圆形 SDF 算出一张位移贴图喂给 feDisplacementMap，
   再把整个滤镜挂到 backdrop-filter 上，把按钮背后的画面在边缘那圈往圆心拉 ——
   被拉伸放大的这一圈就是玻璃的折射感。玻璃本身不吃任何白色高光，全靠 backdrop-filter。
   ⚠️ backdrop-filter 里带 url() 不是所有浏览器都吃，先探测；不支持就保持 CSS 里的纯模糊版本。 */
(function liquidGlassToggle() {
  const SIZE = 36, DPI = 2, REFRACT = .2;
  const smoothStep = (a, b, t) => { t = Math.max(0, Math.min(1, (t - a) / (b - a))); return t * t * (3 - 2 * t); };
  try {
    const p = document.createElement('div');
    p.style.backdropFilter = 'url(#__lg_probe) blur(1px)';
    p.style.webkitBackdropFilter = 'url(#__lg_probe) blur(1px)';
    if (!/url\(/.test(p.style.backdropFilter || p.style.webkitBackdropFilter || '')) return;
  } catch (_) { return; }

  const id = 'lgToggleBtn', w = SIZE * DPI, h = SIZE * DPI;
  const data = new Uint8ClampedArray(w * h * 4);
  const raw = new Float64Array(w * h * 2);
  let maxAbs = 0, k = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const ix = x / w - .5, iy = y / h - .5;
      const d = Math.sqrt(ix * ix + iy * iy) / .5;          // 0 圆心 → 1 边缘
      const scaled = 1 - smoothStep(.42, 1, d) * REFRACT;    // 只在靠外一圈把采样点往圆心拉
      const dx = (ix * scaled + .5) * w - x;
      const dy = (iy * scaled + .5) * h - y;
      raw[k++] = dx; raw[k++] = dy;
      if (Math.abs(dx) > maxAbs) maxAbs = Math.abs(dx);
      if (Math.abs(dy) > maxAbs) maxAbs = Math.abs(dy);
    }
  }
  if (!maxAbs) return;
  k = 0;
  for (let i = 0; i < data.length; i += 4) {
    data[i]     = (raw[k++] / maxAbs + .5) * 255;   // R → 横向位移
    data[i + 1] = (raw[k++] / maxAbs + .5) * 255;   // G → 纵向位移
    data[i + 3] = 255;                              // B 恒 0，A 满
  }
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  cv.getContext('2d').putImageData(new ImageData(data, w, h), 0, 0);

  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('width', '0'); svg.setAttribute('height', '0');
  svg.style.cssText = 'position:fixed;left:0;top:0;pointer-events:none';
  const defs = document.createElementNS(NS, 'defs'), f = document.createElementNS(NS, 'filter');
  f.setAttribute('id', id);
  f.setAttribute('filterUnits', 'userSpaceOnUse');
  f.setAttribute('colorInterpolationFilters', 'sRGB');
  f.setAttribute('x', '0'); f.setAttribute('y', '0');
  f.setAttribute('width', String(SIZE)); f.setAttribute('height', String(SIZE));
  const img = document.createElementNS(NS, 'feImage');
  img.setAttribute('id', id + '_map');
  img.setAttribute('width', String(SIZE)); img.setAttribute('height', String(SIZE));
  const disp = document.createElementNS(NS, 'feDisplacementMap');
  disp.setAttribute('in', 'SourceGraphic');
  disp.setAttribute('in2', id + '_map');
  disp.setAttribute('xChannelSelector', 'R');
  disp.setAttribute('yChannelSelector', 'G');
  disp.setAttribute('scale', String(maxAbs / DPI));
  f.appendChild(img); f.appendChild(disp);
  defs.appendChild(f); svg.appendChild(defs);
  document.body.appendChild(svg);
  const url = cv.toDataURL();
  img.setAttribute('href', url);
  img.setAttributeNS('http://www.w3.org/1999/xlink', 'href', url);
  document.documentElement.classList.add('lg-refract');   // 通知 CSS 可以上折射版
})();

/* 轮播：跟手拖拽 + 速度惯性吸附，缩放/明暗随与中心的距离实时变化 */
