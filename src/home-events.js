/* =====================================================================
 * Carnet · 主页交互 · 书架排序 / 菜单 / 搜索   （脚本 23 / 27）
 * ---------------------------------------------------------------------
 * ① 轮播点击、书架长按 / 单击、书架拖动排序（FLIP 位移 + 命中判定）
 *    单层书架：书脊悬停预览、长按拖动排序
 * ② 右上角菜单、分享菜单、多选选择条、删除二次确认 askConfirm
 * ③ 搜索面板：按名称过滤并跳转 toggleSearch / renderSearch
 *
 * 对外接口：askConfirm, toggleSearch, renderSearch, toggleMenu, closeMenus
 *
 * 依赖模块：core, state, home-view, editor, io-*
 *
 * 说明：模块间共用全局作用域，加载顺序即依赖顺序（见 index.html 与 README）。
 * ===================================================================== */
/* ==================== 主页交互 ==================== */
$('#carousel').addEventListener('click', e => {
  if (carousel.consumeClick()) return;
  const gear = e.target.closest('[data-gear]');
  if (gear) { openEditor(cur()); return; }
  const item = e.target.closest('.book-item');
  if (!item) return;
  const i = +item.dataset.i;
  if (i !== state.sel) selectJournal(i);
  else openReader();
});
/* ⚠️ 选中用 shelfPick 而不是 selectJournal —— 后者会 scrollIntoView 把那一排滚到屏幕中间，
      鼠标只是路过就整页滑动，非常晕。
   ⚠️ 只在真有悬停能力的设备上生效：手机上 tap 会补发一次 mouseover，
      那样「点一下先选中、再点一下翻开」的两段式会被吞掉 */
/* ==================== 书架模式：悬停即选中，离开即取消 ====================
   书架不像左右滑动那样必须停在某本上：鼠标停在封面上，「当前手帐本」就是这一本
   （抬起 + 露出页数与编辑按钮）；鼠标一离开这本书就取消选中，把它放回架上。
   ⚠️ 取消的只是**画出来的选中态**：state.sel 照旧跟着鼠标更新 —— 翻开 / 搜索跳转 /
      导出都要有一个目标，把它置空会连这些一起打空。
   ⚠️ shelfHoverAt 记的是「这一刻 DOM 里到底谁挂着 .active」，不能用 state.sel 代替：
      搜索跳转、排序落位、开了书再回来都会单独动 state.sel，DOM 却不一定跟着抬起 */
let shelfHoverAt = -1;
/* 鼠标最后的位置（两种书架共用）：书架整块重画后不会再有 mouseover / pointerover
   （鼠标没动），靠这个坐标把选中态补回鼠标底下那一本
   （见 renderShelf 末尾的 shelfHoverRestore、renderSpineShelf 末尾的 spineHoverRestore） */
const pointerXY = { x: 0, y: 0, has: false, hover: false };
function shelfHoverLive() {
  /* 多选勾选时不参与：那一屏看到的就是勾选痕迹，再多一层「选中」会混成两套记号 */
  return state.prefs.view === 'shelf' && !state.picking && !shelfSort && spineCanHover();
}
/* 撤掉画出来的选中态 —— 抬起的那一本自己放回去 */
function shelfUnpick() {
  shelfHoverAt = -1;
  $$('#shelfWrap .book-item.active').forEach(el => el.classList.remove('active'));
}
/* 书架 DOM 整块重建时同步记账：新节点上一个 .active 都没有 */
function shelfHoverReset() { shelfHoverAt = -1; }
/* 重画之后按鼠标此刻的位置把选中态补回去（鼠标没动时浏览器不再派发 mouseover） */
function shelfHoverRestore() {
  if (!shelfHoverLive() || !pointerXY.has || !pointerXY.hover) return;
  const el = document.elementFromPoint(pointerXY.x, pointerXY.y);
  const item = el && el.closest ? el.closest('#shelfWrap .book-item') : null;
  if (item) { const i = +item.dataset.i; if (Number.isFinite(i)) shelfPick(i); return; }
  shelfHoverAt = -1;      // 鼠标不在任何一本书上
}
$('#shelfWrap').addEventListener('mouseover', e => {
  if (!spineCanHover() || state.picking || shelfSort || shelfHold.el) return;
  const item = e.target.closest && e.target.closest('.book-item');
  if (!item) return;
  const i = +item.dataset.i;
  if (Number.isFinite(i) && i !== shelfHoverAt) shelfPick(i);
});
/* 鼠标离开这一本 = 取消选中：书架上不必非得留着一本被抬起的书 */
$('#shelfWrap').addEventListener('mouseout', e => {
  if (!spineCanHover() || state.picking || shelfSort) return;
  const item = e.target.closest && e.target.closest('.book-item');
  if (!item) return;
  /* 还在同一本书的范围内挪（比如移到它的编辑按钮上）就不算离开 */
  const to = e.relatedTarget;
  if (to && to.closest && to.closest('.book-item') === item) return;
  shelfUnpick();
});
/* 鼠标移出窗口时也要放手：这最后一下 mouseout / pointerout 有时会被系统吞掉 */
document.addEventListener('mouseleave', () => {
  pointerXY.has = false;
  shelfUnpick();
  if (state.prefs.view === 'spine') spineSetHover(-1);
});
/* 书架模式：点一下直接翻开；长按进入拖动排序，
   长按后原地不动就松手则只是把编辑按钮唤出来 */
const shelfHold = { timer: 0, el: null, x: 0, y: 0, cx: 0, cy: 0, touch: false, moved: false, fired: false };
let shelfSort = null;
function shelfClearTouched(except) {
  $$('#shelfWrap .book-item.touched').forEach(el => { if (el !== except) el.classList.remove('touched'); });
}
function shelfPick(i) {
  state.sel = clamp(i, 0, Math.max(state.journals.length - 1, 0));
  $$('#shelfWrap .book-item').forEach(el => el.classList.toggle('active', +el.dataset.i === state.sel));
  shelfHoverAt = Number.isFinite(i) ? state.sel : -1;
  syncHomeHead();
}
/* 鼠标位置记账（两种书架共用）：整块重画后靠它把选中态补回鼠标底下那一本 / 那一根。
   触摸设备记着也没用 —— 那边从来不产生悬停，restore 先看 hover 标记再动 */
window.addEventListener('pointermove', e => {
  pointerXY.x = e.clientX; pointerXY.y = e.clientY;
  pointerXY.has = true;
  pointerXY.hover = !e.pointerType || e.pointerType === 'mouse' || e.pointerType === 'pen';
}, { passive: true });
/* 把某一本标记为「被碰过」，露出编辑按钮和页数，同时选中它 */
function shelfTouched(i) {
  const el = $('#shelfWrap .book-item[data-i="' + i + '"]');
  shelfClearTouched(el);
  if (el) el.classList.add('touched');
  shelfPick(i);
}

/* ==================== 书架拖动排序 ==================== */
/* 多层 / 单层书架的 pointermove 与 touchmove 共用一条逐帧队列：
   一帧只更新一次悬浮副本与命中判定（原来来一个事件就量一堆 rect 再写一堆 transform）。
   抬手前 flush() 补上攒着没画的最后一点位移，落位不会差一截。 */
const sortMoveQ = frameQueue(v => {
  if (v.spine) spineSortPointer(v.x, v.y);
  else shelfSortPointer(v.x, v.y);
});
function shelfBeginSort(item, x, y) {
  const i = +item.dataset.i;
  if (!Number.isFinite(i) || state.journals.length < 2) return false;
  const wrap = $('#shelfWrap');
  const r = item.getBoundingClientRect();
  const ghost = item.cloneNode(true);
  ghost.classList.remove('touched', 'active');
  ghost.classList.add('shelf-ghost');
  ghost.querySelectorAll('.gear,.cover-badge').forEach(n => n.remove());
  ghost.style.width = r.width + 'px';
  ghost.style.height = r.height + 'px';
  ghost.style.setProperty('--sbw', r.width + 'px');
  document.body.appendChild(ghost);
  shelfSort = {
    order: state.journals.slice(),   // 临时排列，松手才写回 state
    at: i, from: i, el: item,
    selJ: state.journals[state.sel], // 记住选中的是哪一本，重排后跟着走
    ghost, gdx: x - r.left, gdy: y - r.top,
    sx: x, sy: y, px: x, py: y, moved: false, raf: 0, flipRaf: 0, slots: null,
    rect: wrap.getBoundingClientRect()   // 拖动期间容器几何不变，边缘自动滚动只量这一次
  };
  shelfSort.slots = shelfMeasureSlots();
  wrap.classList.add('sorting');
  item.classList.add('lifted');
  try { navigator.vibrate && navigator.vibrate(12); } catch (_) {}
  shelfGhostMove(x, y);
  return true;
}
function shelfGhostMove(x, y) {
  const s = shelfSort; if (!s) return;
  s.ghost.style.transform = 'translate(' + (x - s.gdx).toFixed(1) + 'px,' +
    (y - s.gdy).toFixed(1) + 'px) scale(1.06) rotate(-1.5deg)';
}
/* 量出每本书在「书架内容坐标系」里的位置 —— 相对 wrap 内容，滚动多少都算进去。
   关键：这套坐标是布局位置，不受 FLIP 位移影响。命中判定和 FLIP 起点都用它，
   否则动画途中量到的是视觉位置，连续换位会来回抖 */
function shelfMeasureSlots() {
  const wrap = $('#shelfWrap');
  const wr = wrap.getBoundingClientRect();
  const sx = wrap.scrollLeft, sy = wrap.scrollTop;
  return [...wrap.querySelectorAll('.book-item')].map(el => {
    const a = el.getBoundingClientRect();
    return { l: a.left - wr.left + sx, t: a.top - wr.top + sy,
             r: a.right - wr.left + sx, b: a.bottom - wr.top + sy };
  });
}
/* 排序中途重排书架。**这里绝不能整块重建 DOM**（不能用 renderShelf 重画）：
   触摸手势从 touchstart 起就把目标节点锁死了，一旦那个 .cover 节点被 innerHTML
   冲掉，它就脱离了文档、再也传不到 window，之后的 touchmove / touchend 会被
   浏览器整条丢掉 —— 表现就是手机上拖动两下就卡死、松手也没反应。
   所以改成把现有的 .book-item 节点按顺序 append 到该在的那一行里，节点始终活着。
   节点原地复用会带来 data-i 暂时对不上号，但排序结束时 renderHome() 会整体重画、把下标刷回来，中间不会有人去读它 */
function shelfReorderNodes() {
  const s = shelfSort; if (!s) return;
  const wrap = $('#shelfWrap');
  const rows = [...wrap.querySelectorAll('.shelf-books')];
  if (!rows.length) return;
  /* 每行放几本由 renderShelf 试放算出来后写在 dataset.per 里（逗号分隔，**各行的本数可能不同**：
     方形画册比常规本宽，一排放不下就换行）。拿不到 / 对不上号时按平均分配兜底 */
  let caps = (wrap.dataset.per || '').split(',').map(n => parseInt(n, 10)).filter(n => n > 0);
  if (caps.length !== rows.length) {
    const n = Math.max(1, Math.ceil(s.order.length / rows.length));
    caps = rows.map(() => n);
  }
  const byId = new Map();
  wrap.querySelectorAll('.book-item').forEach(el => { if (el.dataset.id) byId.set(el.dataset.id, el); });
  const selId = s.selJ && s.selJ.id;
  let k = 0;
  for (let r = 0; r < rows.length && k < s.order.length; r++) {
    for (let c = 0; c < caps[r] && k < s.order.length; c++, k++) {
      const el = byId.get(s.order[k] && s.order[k].id);
      if (el) rows[r].appendChild(el);      // 依次 append，同一行内自然就排成了想要的顺序
    }
  }
  /* 兜底：行容量万一算少了（顺序变了、画册换了行），剩下的全挂到最后一行，
     别把节点留在旧位置上 —— 那样 FLIP 会量错位、动画乱飞 */
  for (; k < s.order.length; k++) {
    const el = byId.get(s.order[k] && s.order[k].id);
    if (el) rows[rows.length - 1].appendChild(el);
  }
  wrap.querySelectorAll('.book-item').forEach(el =>
    el.classList.toggle('active', !!selId && el.dataset.id === selId));
}
/* 重排：留在原位当一个淡淡的「坑」的是被拖的那本。
   节点是搬过去的，硬搬会跳，所以走 FLIP：先把每本书摆回旧位置，下一帧再放开，
   让它们自己滑过去 */
function shelfRenderSort(prev) {
  const s = shelfSort; if (!s) return;
  const wrap = $('#shelfWrap');
  if (s.flipRaf) cancelAnimationFrame(s.flipRaf);
  const before = s.slots;

  shelfReorderNodes();
  s.slots = shelfMeasureSlots();          // 趁还没加位移，量下新布局

  const els = wrap.querySelectorAll('.book-item');
  const slid = [];
  els.forEach((el, m) => {
    const a = s.slots[m];
    const b = before && before[prev ? prev.indexOf(s.order[m]) : m];
    if (!a || !b) return;
    const dx = b.l - a.l, dy = b.t - a.t;
    if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return;
    el.style.transition = 'none';
    el.style.transform = 'translate(' + dx.toFixed(1) + 'px,' + dy.toFixed(1) + 'px)';
    slid.push(el);
  });
  s.flipRaf = requestAnimationFrame(() => {
    s.flipRaf = 0;
    slid.forEach(el => {
      el.style.transition = 'transform .19s cubic-bezier(.25,.8,.3,1)';
      el.style.transform = '';
    });
  });
  s.el = els[s.at] || null;
  if (s.el) s.el.classList.add('lifted');
}
/* 手指压到哪一格，就把拖着的这本插到那一格，其余书顺移让位。
   和轮播模式的排序保持一致（不是两两对调）。
   命中用布局格子算，不用 elementFromPoint —— 后者在 FLIP 动画途中量到的是
   正在滑动的视觉位置，会把顺序来回换回去 */
function shelfHitTest(x, y) {
  const s = shelfSort; if (!s || !s.slots) return;
  const wrap = $('#shelfWrap');
  const wr = s.rect;                     // 拖动开始时量过的容器位置，滚动改的是 scrollTop
  const px = x - wr.left + wrap.scrollLeft, py = y - wr.top + wrap.scrollTop;
  let j = -1;
  for (let k = 0; k < s.slots.length; k++) {
    const a = s.slots[k];
    if (px >= a.l && px <= a.r && py >= a.t && py <= a.b) { j = k; break; }
  }
  if (j < 0 || j === s.at) return;
  const prev = s.order.slice();
  s.order.splice(j, 0, s.order.splice(s.at, 1)[0]);
  s.at = j;
  shelfRenderSort(prev);
  try { navigator.vibrate && navigator.vibrate(8); } catch (_) {}
}
/* 拖到书架上下边缘时自动滚动，够得着屏幕外的位置 */
function shelfSortTick() {
  const s = shelfSort;
  if (!s) return;
  const wrap = $('#shelfWrap');
  const r = s.rect;                        // 缓存的容器位置，滚动的是内容、盒子本身不动
  const edge = Math.min(78, r.height * 0.28);
  let d = 0;
  if (s.py < r.top + edge) d = -Math.min(1, (r.top + edge - s.py) / edge);
  else if (s.py > r.bottom - edge) d = Math.min(1, (s.py - (r.bottom - edge)) / edge);
  if (d) {
    const before = wrap.scrollTop;
    wrap.scrollTop = clamp(before + d * 13, 0, Math.max(0, wrap.scrollHeight - wrap.clientHeight));
    if (wrap.scrollTop !== before) { shelfGhostMove(s.px, s.py); shelfHitTest(s.px, s.py); }
  }
  s.raf = requestAnimationFrame(shelfSortTick);
}
function shelfSortPointer(x, y) {
  const s = shelfSort; if (!s) return;
  s.px = x; s.py = y;
  if (Math.abs(x - s.sx) > 6 || Math.abs(y - s.sy) > 6) s.moved = true;
  shelfGhostMove(x, y);
  shelfHitTest(x, y);
  if (!s.raf) s.raf = requestAnimationFrame(shelfSortTick);
}
/* 手机上真正拦住滚动的一步。
   touch-action 是「手势落下那一刻」就定死的：等长按计时到了再给 .sorting 加
   touch-action:none 已经来不及，浏览器照旧抢走手势去滚书架，然后甩一个
   pointercancel 把拖动掐断。pointermove 里的 preventDefault 也不管用 ——
   触摸滚动只认 touchmove。所以这里用非被动的 touchmove 监听，
   只要处在排序中就 preventDefault，位置更新也顺便一起做掉 */
function shelfTouchMoveGuard(e) {
  const s = shelfSort || spineSort;    // 多层书架 / 单层书架共用这条防线
  if (!s) return;
  if (e.cancelable) e.preventDefault();
  const t = e.touches && e.touches[0];
  if (!t) return;
  sortMoveQ.push({ x: t.clientX, y: t.clientY, spine: !!spineSort });
}
document.addEventListener('touchmove', shelfTouchMoveGuard, { passive: false });
function shelfEndSort() {
  sortMoveQ.flush();                     // 补上最后一次移动，s.at / s.slots 才是松手时的位置
  const s = shelfSort; shelfSort = null;
  if (!s) return;
  if (s.raf) cancelAnimationFrame(s.raf);
  if (s.flipRaf) cancelAnimationFrame(s.flipRaf);
  $('#shelfWrap').classList.remove('sorting');
  if (s.el && s.el.isConnected) s.el.classList.remove('lifted');
  if (!s.moved) {                        // 长按后原地松手：只唤出编辑按钮，不重排
    s.ghost.remove();
    shelfTouched(s.at);
    shelfHold.fired = true;
    return;
  }
  /* 落位动画：副本先滑回它要去的那一格，滑到了再把书架按新顺序重画一遍，
     避免松手瞬间「啪」地跳一下。落点用布局格子算，不受 FLIP 位移影响 */
  const wrap = $('#shelfWrap');
  const wr = wrap.getBoundingClientRect();
  const g = s.slots && s.slots[s.at];
  const slot = g ? {
    left: wr.left + g.l - wrap.scrollLeft,
    top: wr.top + g.t - wrap.scrollTop
  } : null;
  state.journals = s.order;
  const ns = state.journals.indexOf(s.selJ);
  state.sel = ns < 0 ? clamp(s.at, 0, state.journals.length - 1) : ns;
  save();
  if (!slot) { s.ghost.remove(); renderHome(); return; }
  s.ghost.style.transition = 'transform .17s cubic-bezier(.25,.8,.3,1)';
  s.ghost.style.transform = 'translate(' + slot.left.toFixed(1) + 'px,' + slot.top.toFixed(1) + 'px)';
  setTimeout(() => { s.ghost.remove(); renderHome(); }, 175);
}

$('#shelfWrap').addEventListener('pointerdown', e => {
  clearTimeout(shelfHold.timer);
  if (state.picking) { shelfHold.el = null; return; }   // 多选时只勾选，不长按排序
  const item = e.target.closest('.book-item');
  shelfHold.el = (item && !e.target.closest('[data-gear]')) ? item : null;
  shelfHold.x = e.clientX; shelfHold.y = e.clientY;
  shelfHold.cx = e.clientX; shelfHold.cy = e.clientY;   // 最新的手指位置，拿起时用它对齐
  shelfHold.touch = e.pointerType === 'touch';
  shelfHold.moved = false; shelfHold.fired = false;
  if (!shelfHold.el) return;
  shelfHold.timer = setTimeout(() => {
    if (shelfHold.moved || !shelfHold.el || !shelfHold.el.isConnected) return;
    shelfHold.fired = true;              // 这次抬手不翻开（拖动或唤出按钮）
    const i = +shelfHold.el.dataset.i;
    if (!shelfBeginSort(shelfHold.el, shelfHold.cx, shelfHold.cy) && Number.isFinite(i)) shelfTouched(i);
  }, 380);
});
$('#shelfWrap').addEventListener('pointermove', e => {
  if (shelfSort) { shelfHold.cx = e.clientX; shelfHold.cy = e.clientY; return; }
  if (!shelfHold.el) return;
  shelfHold.cx = e.clientX; shelfHold.cy = e.clientY;
  /* 手指没鼠标稳，触摸时放宽一点，免得轻轻一抖就把长按作废 */
  const slop = shelfHold.touch ? 13 : 8;
  if (Math.abs(e.clientX - shelfHold.x) > slop || Math.abs(e.clientY - shelfHold.y) > slop) {
    shelfHold.moved = true;              // 开始滚动书架了，长按作废
    clearTimeout(shelfHold.timer);
  }
}, { passive: true });
$('#shelfWrap').addEventListener('pointerup', () => {
  clearTimeout(shelfHold.timer);
  /* 松手就得把这一次按压忘掉：不清的话鼠标只要点过一本书，
     mouseover 里那条 shelfHold.el 判断会一直拦着，悬停选中就再也不灵了 */
  shelfHold.el = null;
});
$('#shelfWrap').addEventListener('pointercancel', () => { clearTimeout(shelfHold.timer); shelfHold.el = null; });
window.addEventListener('pointermove', e => {
  if (spineSort) {                       // 单层书架：拖动时别让书排跟着滚
    e.preventDefault();                  // 拦滚动必须同步做，位置更新才交给逐帧队列
    sortMoveQ.push({ x: e.clientX, y: e.clientY, spine: true });
    return;
  }
  if (!shelfSort) return;
  e.preventDefault();                    // 拖动时别让页面 / 书架跟着滚
  sortMoveQ.push({ x: e.clientX, y: e.clientY, spine: false });
}, { passive: false });
window.addEventListener('pointerup', () => {
  if (spineSort) spineEndSort();
  if (shelfSort) shelfEndSort();
});
window.addEventListener('pointercancel', () => {
  if (spineSort) spineEndSort();
  if (shelfSort) shelfEndSort();
});
/* 触摸时以 touch 事件兜底收尾：即使 pointer 流被浏览器中途掐了，抬手也一定收得了尾 */
window.addEventListener('touchend', () => {
  if (spineSort) spineEndSort();
  if (shelfSort) shelfEndSort();
}, { passive: true });
window.addEventListener('touchcancel', () => {
  if (spineSort) spineEndSort();
  if (shelfSort) shelfEndSort();
}, { passive: true });
/* 长按封面时别弹出系统菜单（保存图片 / 拷贝），在手机上它会把手势一起吃掉 */
$('#shelfWrap').addEventListener('contextmenu', e => {
  if (shelfSort || shelfHold.el) e.preventDefault();
});
$('#shelfWrap').addEventListener('click', e => {
  if (state.picking) {                       // 多选时点封面 = 切换勾选，不翻开
    const it = e.target.closest('.book-item');
    if (it) { const i = +it.dataset.i; if (Number.isFinite(i)) togglePick(i); }
    return;
  }
  const gear = e.target.closest('[data-gear]');
  if (gear) {
    const i = +gear.dataset.gear;
    if (Number.isFinite(i)) shelfPick(i);
    openEditor(cur());
    return;
  }
  const item = e.target.closest('.book-item');
  if (!item) { shelfClearTouched(null); return; }
  if (shelfHold.fired) { shelfHold.fired = false; return; }   // 长按的抬手被吞掉
  const i = +item.dataset.i;
  if (!Number.isFinite(i)) return;
  shelfPick(i);
  openReader();
});
/* ==================== 单层书架：悬停即选中 ====================
   鼠标停在哪根书脊上，那一根就是「当前手帐本」：抬起一截、描一圈白边，
   下方预览框显出它的封面；鼠标一离开书脊全部复原 —— 落回架上、预览收起。
   默认一根都不选中（见 home-view 的 spineItemHTML / renderSpineShelf）。
   用 pointerover / pointerout 挂在容器上做委托 —— 整排书会整块重画，
   逐个监听节点会跟着一起没掉。触摸设备没有悬停，那边没有预览，点一下直接翻开 */
const HOVER_POINTERS = { mouse: 1, pen: 1 };
function spineIsHoverPointer(e) { return !e.pointerType || HOVER_POINTERS[e.pointerType]; }
function spineCanRestore() { return state.prefs.view === 'spine' && !spineSort && spineCanHover(); }
/* 整排重画后浏览器不会再派发 pointerover（鼠标没动），照最后记录的坐标把选中态补回去 */
function spineHoverRestore() {
  if (!spineCanRestore() || !pointerXY.has || !pointerXY.hover) return;
  const el = document.elementFromPoint(pointerXY.x, pointerXY.y);
  const it = el && el.closest ? el.closest('#spineRow .spine-item') : null;
  spineSetHover(it ? +it.dataset.i : -1);
}
$('#spineWrap').addEventListener('pointerover', e => {
  if (spineSort || !spineIsHoverPointer(e)) return;
  const it = e.target.closest && e.target.closest('.spine-item');
  if (!it) return;
  const i = +it.dataset.i;
  if (Number.isFinite(i)) spineSetHover(i);
}, { passive: true });
$('#spineWrap').addEventListener('pointerout', e => {
  if (!spineIsHoverPointer(e)) return;
  const it = e.target.closest && e.target.closest('.spine-item');
  if (!it) return;
  const to = e.relatedTarget;
  if (to && to.closest && to.closest('.spine-item') === it) return;   // 还在同一根书脊上
  spineSetHover(-1);
}, { passive: true });
/* 键盘 Tab 到书脊上时也给预览，纯键盘也能看清停在哪个上 */
$('#spineWrap').addEventListener('focusin', e => {
  const it = e.target.closest && e.target.closest('.spine-item');
  if (!it) return;
  const i = +it.dataset.i;
  if (Number.isFinite(i)) spineSetHover(i);
});
$('#spineWrap').addEventListener('focusout', e => {
  if (e.target.closest && e.target.closest('.spine-item')) spineSetHover(-1);
});

/* ==================== 单层书架：长按书脊拖动排序 ====================
   书脊挤在一排里，只能左右挪：命中判定按每根书脊的横向区间算，
   拖到哪两本之间就插到哪一格，其余书顺移让位（不是两两对调）。
   ⚠️ 排序中途绝不能整块重建 DOM（不能用 renderSpineShelf 重画）：
      触摸手势从 touchstart 起就把目标节点锁死了，节点被 innerHTML 冲掉后
      之后的 touchmove / touchend 会被浏览器整条丢掉 —— 表现就是拖两下卡死。
      所以只把现有节点按新顺序 append 回同一行，节点始终活着 */
const spineHold = { timer: 0, el: null, x: 0, y: 0, cx: 0, cy: 0, touch: false, moved: false, fired: false };
let spineSort = null;
/* 量出每根书脊在「书排内容坐标系」里的位置（含横向滚动量）。
   这是布局位置，不受 FLIP 位移影响 —— 命中判定和 FLIP 起点都用它，
   否则动画途中量到的是视觉位置，连续换位会来回抖 */
function spineMeasureSlots() {
  const sc = $('#spineScroll');
  if (!sc) return [];
  const sr = sc.getBoundingClientRect();
  const sx = sc.scrollLeft;
  return [...sc.querySelectorAll('.spine-item')].map(el => {
    const a = el.getBoundingClientRect();
    return { l: a.left - sr.left + sx, r: a.right - sr.left + sx,
             t: a.top - sr.top, b: a.bottom - sr.top };
  });
}
function spineBeginSort(item, x, y) {
  const i = +item.dataset.i;
  if (!Number.isFinite(i) || state.journals.length < 2) return false;
  const row = $('#spineRow');
  const nodes = [...row.querySelectorAll('.spine-item')];
  if (nodes.length !== state.journals.length) return false;
  const r = item.getBoundingClientRect();
  const ghost = item.cloneNode(true);
  ghost.classList.remove('touched', 'active', 'lifted');
  ghost.classList.add('spine-ghost');
  ghost.style.width = r.width + 'px';
  ghost.style.height = r.height + 'px';
  ghost.style.margin = '0';
  document.body.appendChild(ghost);
  spineSort = {
    order: state.journals.slice(),   // 临时排列，松手才写回 state
    dom: nodes.slice(),              // 与 order 一一对应的活节点
    at: i, from: i, el: item,
    selJ: state.journals[state.sel], // 记住选中的是哪一本，重排后跟着走
    ghost, gdx: x - r.left, gdy: y - r.top,
    sx: x, sy: y, px: x, py: y, moved: false, raf: 0, flipRaf: 0, slots: spineMeasureSlots(),
    rect: $('#spineScroll').getBoundingClientRect()  // 横滑时容器不动，边缘判定复用这一份
  };
  spineSetHover(-1);                 // 拖起来的时候不要有预览挡着
  $('#spineWrap').classList.add('sorting');
  item.classList.add('lifted');
  try { navigator.vibrate && navigator.vibrate(12); } catch (_) {}
  spineGhostMove(x, y);
  return true;
}
function spineGhostMove(x, y) {
  const s = spineSort; if (!s) return;
  s.ghost.style.transform = 'translate(' + (x - s.gdx).toFixed(1) + 'px,' +
    (y - s.gdy).toFixed(1) + 'px) scale(1.05) rotate(-1.5deg)';
}
/* 按新顺序把节点 append 回同一行，再走 FLIP：先摆回旧位置，下一帧放开让它们滑过去 */
function spineRenderSort(prev) {
  const s = spineSort; if (!s) return;
  const row = $('#spineRow');
  if (s.flipRaf) cancelAnimationFrame(s.flipRaf);
  const before = prev || s.slots;
  s.dom.forEach(el => row.appendChild(el));
  s.slots = spineMeasureSlots();
  const slid = [];
  s.dom.forEach((el, m) => {
    const a = s.slots[m], b = before && before[m];
    if (!a || !b) return;
    const dx = b.l - a.l, dy = b.t - a.t;
    if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return;
    el.style.transition = 'none';
    el.style.transform = 'translate(' + dx.toFixed(1) + 'px,' + dy.toFixed(1) + 'px)';
    slid.push(el);
  });
  s.flipRaf = requestAnimationFrame(() => {
    s.flipRaf = 0;
    slid.forEach(el => {
      el.style.transition = 'transform .19s cubic-bezier(.25,.8,.3,1)';
      el.style.transform = '';
    });
  });
}
/* 命中：手指落在哪根书脊的横向区间里，就插到那一格 */
function spineHitTest(x) {
  const s = spineSort; if (!s || !s.slots) return;
  const sc = $('#spineScroll');
  const sr = s.rect;                     // 同上：横滑改的是 scrollLeft，盒子位置不变
  const px = x - sr.left + sc.scrollLeft;
  let j = -1;
  for (let k = 0; k < s.slots.length; k++) {
    const a = s.slots[k];
    if (px >= a.l && px <= a.r) { j = k; break; }
  }
  if (j < 0) {                       // 落在书脊之间的缝里：就近取一根
    let best = -1, bd = Infinity;
    for (let k = 0; k < s.slots.length; k++) {
      const c = (s.slots[k].l + s.slots[k].r) / 2, d = Math.abs(c - px);
      if (d < bd) { bd = d; best = k; }
    }
    j = best;
  }
  if (j < 0 || j === s.at) return;
  const prev = s.slots.slice();
  s.order.splice(j, 0, s.order.splice(s.at, 1)[0]);
  s.dom.splice(j, 0, s.dom.splice(s.at, 1)[0]);
  s.at = j;
  spineRenderSort(prev);
  try { navigator.vibrate && navigator.vibrate(8); } catch (_) {}
}
/* 拖到书排左右边缘时自动横滚，够得着屏幕外的位置 */
function spineSortTick() {
  const s = spineSort;
  if (!s) return;
  const sc = $('#spineScroll');
  const r = s.rect;                        // 缓存的容器位置
  const edge = Math.min(70, r.width * 0.2);
  let d = 0;
  if (s.px < r.left + edge) d = -Math.min(1, (r.left + edge - s.px) / edge);
  else if (s.px > r.right - edge) d = Math.min(1, (s.px - (r.right - edge)) / edge);
  if (d) {
    const before = sc.scrollLeft;
    sc.scrollLeft = clamp(before + d * 13, 0, Math.max(0, sc.scrollWidth - sc.clientWidth));
    if (sc.scrollLeft !== before) { spineGhostMove(s.px, s.py); spineHitTest(s.px); }
  }
  s.raf = requestAnimationFrame(spineSortTick);
}
function spineSortPointer(x, y) {
  const s = spineSort; if (!s) return;
  s.px = x; s.py = y;
  if (Math.abs(x - s.sx) > 6 || Math.abs(y - s.sy) > 6) s.moved = true;
  spineGhostMove(x, y);
  spineHitTest(x);
  if (!s.raf) s.raf = requestAnimationFrame(spineSortTick);
}
function spineEndSort() {
  sortMoveQ.flush();                     // 补上最后一次移动，松手落在哪一格要按它算
  const s = spineSort; spineSort = null;
  if (!s) return;
  if (s.raf) cancelAnimationFrame(s.raf);
  if (s.flipRaf) cancelAnimationFrame(s.flipRaf);
  $('#spineWrap').classList.remove('sorting');
  if (s.el && s.el.isConnected) s.el.classList.remove('lifted');
  if (!s.moved) {                        // 长按后原地松手：唤出编辑器，不重排
    s.ghost.remove();
    spineHold.fired = true;
    const j = state.journals[s.at];
    if (j) { state.sel = s.at; syncSpineSelection(false); openEditor(j); }
    return;
  }
  /* 落位动画：副本先滑回它要去的那一格，滑到了再按新顺序重画整排 */
  const sc = $('#spineScroll');
  const sr = sc.getBoundingClientRect();
  const g = s.slots && s.slots[s.at];
  const slot = g ? { left: sr.left + g.l - sc.scrollLeft, top: sr.top + g.t } : null;
  state.journals = s.order;
  const ns = state.journals.indexOf(s.selJ);
  state.sel = ns < 0 ? clamp(s.at, 0, state.journals.length - 1) : ns;
  save();
  spineHold.fired = true;
  if (!slot) { s.ghost.remove(); renderSpineShelf(); return; }
  s.ghost.style.transition = 'transform .17s cubic-bezier(.25,.8,.3,1)';
  s.ghost.style.transform = 'translate(' + slot.left.toFixed(1) + 'px,' + slot.top.toFixed(1) + 'px)';
  setTimeout(() => { s.ghost.remove(); renderSpineShelf(); }, 175);
}
$('#spineWrap').addEventListener('pointerdown', e => {
  clearTimeout(spineHold.timer);
  const item = e.target.closest('.spine-item');
  spineHold.el = item || null;
  spineHold.x = spineHold.cx = e.clientX;
  spineHold.y = spineHold.cy = e.clientY;
  spineHold.touch = e.pointerType === 'touch';
  spineHold.moved = false; spineHold.fired = false;
  if (!spineHold.el) return;
  spineHold.timer = setTimeout(() => {
    if (spineHold.moved || !spineHold.el || !spineHold.el.isConnected) return;
    spineHold.fired = true;              // 这次抬手不翻开
    const i = +spineHold.el.dataset.i;
    /* 只有一本时排不了序，长按就当作「要改它」—— 直接开编辑，别白按一下 */
    if (!spineBeginSort(spineHold.el, spineHold.cx, spineHold.cy) && Number.isFinite(i)) {
      const j = state.journals[i];
      if (j) { state.sel = i; syncSpineSelection(false); openEditor(j); }
    }
  }, 380);
});
$('#spineWrap').addEventListener('pointermove', e => {
  if (spineSort) { spineHold.cx = e.clientX; spineHold.cy = e.clientY; return; }
  if (!spineHold.el) return;
  spineHold.cx = e.clientX; spineHold.cy = e.clientY;
  /* 手指没鼠标稳，触摸时放宽一点，免得轻轻一抖就把长按作废 */
  const slop = spineHold.touch ? 13 : 8;
  if (Math.abs(e.clientX - spineHold.x) > slop || Math.abs(e.clientY - spineHold.y) > slop) {
    spineHold.moved = true;              // 开始横向滑书排了，长按作废
    clearTimeout(spineHold.timer);
  }
}, { passive: true });
$('#spineWrap').addEventListener('pointerup', () => clearTimeout(spineHold.timer));
$('#spineWrap').addEventListener('pointercancel', () => { clearTimeout(spineHold.timer); spineHold.el = null; });
/* 长按书脊时别弹系统菜单（保存图片 / 拷贝），在手机上它会把手势一起吃掉 */
$('#spineWrap').addEventListener('contextmenu', e => {
  if (spineSort || spineHold.el) e.preventDefault();
});
/* ==================== 单层书架：把书脊从架子上抽出来翻开 ====================
   先让那根书脊自己往上抽出一截（.pulling），等它抬起来再交给 openReader ——
   起飞点是书脊**抽出后**的位置（coverRect 读的是实时 rect，含 transform），
   于是整个过程就是「从一排书里抽出来 → 展开成书」，而不是凭空冒出一张封面 */
const SPINE_PULL_MS = 230;     /* 跟 .spine-item.pulling 的 .23s 对齐：抽到位了再交给封面飞 */
function spineOpen(i) {
  const el = $(`#spineRow .spine-item[data-i="${i}"]`);
  const reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion:reduce)').matches;
  if (!el || !el.isConnected || reduced) { openReader(); return; }
  el.classList.add('pulling');
  /* 抽到位后先顿一下再起飞：连着走会看成「书脊抖了一下封面就冒出来」，
     停这 70ms 才分得出「抽出来 → 飞出去 → 打开」三段 */
  setTimeout(() => {
    openReader();
    /* 只有真翻开了才把书脊藏起来：开书被挡下（动画忙 / 没有手帐本）时立刻放回去，
       不然那一格会永久空着 */
    if ($('#reader').classList.contains('show')) el.classList.add('gone');
    else el.classList.remove('pulling');
  }, SPINE_PULL_MS + 70);
}
/* 单层书架：鼠标已经悬停在这一根上 = 它已经是选中的，点一下就是翻开
   （没鼠标的场景 —— 键盘 Tab、手机 —— 仍保留「先选中、再点一次翻开」的两段式：
   那里选中的才是刚跳到的那一根，不该一下就开到别的书去） */
$('#spineWrap').addEventListener('click', e => {
  if (spineHold.fired) { spineHold.fired = false; return; }   // 长按的抬手被吞掉
  const item = e.target.closest('.spine-item');
  if (item) {
    const i = +item.dataset.i;
    if (!Number.isFinite(i)) return;
    const tapOpen = !spineCanHover();    // 手机 / 平板：直接翻开
    /* ⚠️ 先看**点下去之前**它是不是已经选中的那本：下面 selectJournal 会把 sel 改成 i，
        再比就永远相等 —— 第一次点就翻开，两段式点击没了 */
    const wasSel = i === state.sel;
    if (!wasSel) selectJournal(i, false);
    if (tapOpen || wasSel) spineOpen(i);
    return;
  }
  const open = e.target.closest('[data-spine-open]');
  if (open) {
    const i = +open.dataset.i;           // 预览的可能不是当前选中那本，先跟过去
    if (Number.isFinite(i) && i !== state.sel) selectJournal(i, false);
    spineOpen(state.sel);
  }
});
$('#spineWrap').addEventListener('keydown', e => {
  if (!e.target.closest('[data-spine-open]') || (e.key !== 'Enter' && e.key !== ' ')) return;
  e.preventDefault();
  openReader();
});
/* 书排横滑时下方预览要跟着那根书脊走（偏移量是照着实时位置算的）。
   ⚠️ 滑动中临时关掉对位过渡：否者预览会比书脊慢半拍，快速一甩能看到它在后面追 */
let spineShiftTimer = 0;
/* 横滑时预览对位要量 3 次布局，逐帧做一次就够 */
const spineShiftQ = frameQueue(() => spineDetailShift());
$('#spineScroll').addEventListener('scroll', () => {
  const d = $('#spineDetail');
  if (d) {
    d.classList.add('sliding');
    clearTimeout(spineShiftTimer);
    spineShiftTimer = setTimeout(() => d.classList.remove('sliding'), 160);
  }
  spineShiftQ.push();
}, { passive: true });
/* 鼠标竖滚轮也能带动超出屏幕的单排书，手机上则直接横向滑 */
$('#spineScroll').addEventListener('wheel', e => {
  const sc = $('#spineScroll');
  if (sc.scrollWidth <= sc.clientWidth) return;
  const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
  if (!d) return;
  e.preventDefault();
  sc.scrollLeft += d;
}, { passive: false });
/* 多层书架 / 单层书架 / 左右滑动 的切换按钮 */
$$('#viewToggle button').forEach(btn => {
  btn.addEventListener('click', () => setView(btn.dataset.vt));
});
/* 书架上下滑动时把浮层按钮整块让开（顶栏底栏都不挡视线），停下 0.48s 再淡回来。
   书架已经吃满整屏高度，滑动的这一下屏幕上就只剩书 */
(function floatBarsAway() {
  const home = $('#home');
  let timer = 0, away = false;
  $('#shelfWrap').addEventListener('scroll', () => {
    if (!away) { home.classList.add('bars-away'); away = true; }  // 已在让位就别再写 class
    clearTimeout(timer);
    timer = setTimeout(() => { home.classList.remove('bars-away'); away = false; }, 480);
  }, { passive: true });
})();
/* ==================== 通用确认弹窗 ==================== */
let confirmCb = null;
function askConfirm(text, opt) {
  const o = opt || {};
  $('#confirmTitle').textContent = o.title || '确认操作';
  $('#confirmText').textContent = text;
  $('#confirmOk').textContent = o.ok || '确定';
  confirmCb = o.onOk;
  $('#confirmMask').classList.add('show');
}
function closeConfirm() { $('#confirmMask').classList.remove('show'); confirmCb = null; }
$('#confirmCancel').onclick = closeConfirm;
$('#confirmOk').onclick = () => { const cb = confirmCb; closeConfirm(); cb && cb(); };
$('#confirmMask').addEventListener('click', e => { if (e.target === $('#confirmMask')) closeConfirm(); });

/* ==================== 搜索 ==================== */
function toggleSearch(open) {
  const p = $('#searchPanel');
  p.classList.toggle('show', open);
  if (open) { renderSearch(''); setTimeout(() => { try { $('#searchInput').focus(); } catch (_) {} }, 320); }
  else $('#searchInput').value = '';
}
function renderSearch(q) {
  const box = $('#searchResults');
  const key = (q || '').trim().toLowerCase();
  const list = key
    ? state.journals.filter(j => String(j.name || '').toLowerCase().includes(key))
    : state.journals.slice();
  if (!list.length) {
    box.innerHTML = `<div class="sr-empty">${state.journals.length ? '没有找到匹配的手帐本' : '还没有手帐本，先新建一个吧'}</div>`;
    return;
  }
  const re = key ? new RegExp('(' + key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'ig') : null;
  /* 缩略图按主页真实封面宽度等比缩小，图案比例不走样 */
  const realCover = document.querySelector('.carousel .cover');
  const cw = Math.max(42, realCover ? Math.round(realCover.offsetWidth) || 148 : 148);
  box.style.setProperty('--sr-cw', cw + 'px');
  box.style.setProperty('--sr-k', (42 / cw).toFixed(4));
  box.innerHTML = list.map(j => {
    const i = state.journals.indexOf(j);
    const nm = re ? esc(j.name).replace(re, '<mark>$1</mark>') : esc(j.name);
    const d = new Date(j.created || Date.now());
    const date = `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
    /* 方形画册比其它本子宽 1.35 倍（一样高、只是方），缩略图容器要跟着放开，否则右边被裁 */
    const sq = bookStyleOf(j).k === 'square' ? ' sq' : '';
    return `<div class="sr-item" data-i="${i}">
      <div class="sr-thumb${sq}">${coverHTML(j)}</div>
      <div class="info"><div class="nm">${nm}</div><div class="meta">${j.pages.length} 页 · ${date}</div></div>
    </div>`;
  }).join('');
  $$('#searchResults .sr-item').forEach(el => el.onclick = () => {
    const i = +el.dataset.i;
    toggleSearch(false);
    if (i < 0) return;
    if (state.picking) { togglePick(i); return; }     // 多选勾选状态下：点结果 = 勾上这一本
    /* 书架模式：一眼能看到好几本，点搜索结果就是「找到就翻开」—— 跟直接点封面完全一个行为。
       ⚠️ 翻开前必须先把它滚进视口：开书动画要量这本封面**此刻**的位置（reader-flow.js 的 coverRect），
          滚到位之前量到的是屏幕外的坐标，封面会从画面外飞进来。
       ⚠️ 这里不能用 smooth：平滑滚动要跑几百毫秒，而 openReader 已经先把位置量走、动画也起了。 */
    if (state.prefs.view === 'shelf') {
      shelfPick(i);
      const target = $(`#shelfWrap .book-item[data-i="${i}"]`);
      if (target && target.scrollIntoView) target.scrollIntoView({ block: 'center' });
      openReader();
      return;
    }
    /* 单层书架：滑到那一根书脊，并把预览切到它 —— 不然鼠标没停在书脊上，
       下方空着，看不出搜索到底跳到哪一本了 */
    if (state.prefs.view === 'spine') { selectJournal(i, true); spineSetHover(i); return; }
    selectJournal(i, true);    // 左右滑动：先滑到这一本，再点一下封面才翻开（跟平时翻书一致）
  });
}
$('#searchBtn').onclick = () => toggleSearch(!$('#searchPanel').classList.contains('show'));
$('#searchClose').onclick = () => toggleSearch(false);
/* 每敲一个字都重建整列结果（含每本封面）太重，按帧合一次，手感不变 */
const searchQ = frameQueue(q => renderSearch(q));
$('#searchInput').oninput = e => searchQ.push(e.target.value);
document.addEventListener('pointerdown', e => {
  if (!$('#searchPanel').classList.contains('show')) return;
  if (e.target.closest('#searchPanel') || e.target.closest('#searchBtn')) return;
  toggleSearch(false);
});

// 底部按钮
$$('.actionbar .icon-btn').forEach(b => b.onclick = () => {
  const a = b.dataset.act;
  if (a === 'new') { openEditor(null); }
  else if (a === 'del') {
    /* 书架模式下一眼能看好几本，删除前先进多选勾要删哪几本；轮播模式本来就只删当前这本 */
    if (state.prefs.view === 'shelf') { enterPickMode('del'); return; }
    const j = cur(); if (!j) return;
    askConfirm(`手帐本「${j.name}」及其 ${j.pages.length} 页内容会被删除，此操作不可恢复。`, {
      title: '删除手帐本', ok: '删除',
      onOk: () => {
        state.journals.splice(state.sel, 1);
        state.sel = clamp(state.sel, 0, Math.max(0, state.journals.length - 1));
        save(); renderHome();
        toast('已删除「' + j.name + '」');
      }
    });
  } else if (a === 'share') {
    /* 书架模式下一眼能看好几本，导出前先勾选要哪几本；轮播模式本来就只导出当前这本 */
    if (state.prefs.view === 'shelf') enterPickMode('export');
    else toggleMenu($('#shareMenu'));
  }
});
/* 书架多选导出的选择条 */
$('#pickExport').onclick = () => {
  if (!pickedList().length) { toast('先勾选手帐本再导出'); return; }
  toggleMenu($('#pickMenu'));
};
$$('#pickMenu button').forEach(b => b.onclick = async () => {
  const a = b.dataset.pickact;
  closeMenus();
  await exportPicked(a);
});
$('#pickAll').onclick = () => {
  const all = state.journals.length;
  if (pickedList().length === all) state.picked.clear();
  else state.journals.forEach(j => state.picked.add(j.id));
  $$('#shelfWrap .book-item').forEach(el => {
    el.classList.toggle('picked', !!el.dataset.id && state.picked.has(el.dataset.id));
  });
  syncPickBar();
};
$('#pickCancel').onclick = () => exitPickMode();
/* 书架多选删除：勾选多本后一次性删掉，删除前弹确认，避免误删 */
$('#pickDelete').onclick = () => {
  const list = pickedList();
  if (!list.length) { toast('先勾选手帐本再删除'); return; }
  const n = list.length;
  const names = list.slice(0, 3).map(j => '「' + j.name + '」').join('、');
  const more = n > 3 ? ` 等 ${n} 本` : '';
  askConfirm(`确认删除选中的 ${n} 本手帐本？${names}${more} 内的全部内容都会被删除，此操作不可恢复。`, {
    title: '批量删除', ok: '删除',
    onOk: () => {
      state.journals = state.journals.filter(j => !state.picked.has(j.id));
      state.sel = clamp(state.sel, 0, Math.max(0, state.journals.length - 1));
      state.picked = new Set();
      save(); renderHome(); syncPickBar();
      toast(`已删除 ${n} 本手帐本`);
    }
  });
};

/* ==================== 主页右上角菜单 / 分享菜单 ==================== */
function closeMenus() { $$('.addmenu.show').forEach(m => m.classList.remove('show')); }
function toggleMenu(el) {
  const open = !el.classList.contains('show');
  closeMenus();
  if (open) el.classList.add('show');
}
/* 右上角「菜单」：导入 / 一键成书 / 导入 PDF / 背景设置 / 帮助与反馈。
   后三项原先挂在底栏那颗「更多」上，现在一并收在这里（底栏只留 分享 · 删除 · 新建） */
$$('#homeMenu button').forEach(b => b.onclick = () => {
  closeMenus();
  const a = b.dataset.menuact;
  if (a === 'import') pickImportFile();
  else if (a === 'book') pickBookImages();
  else if (a === 'pdf') pickBookPDF();
  else if (a === 'bg') openBgPanel();
  else if (a === 'help') openHelpMail();
});
/* 分享菜单：备份 / PDF / 长图 */
$$('#shareMenu button').forEach(b => b.onclick = async () => {
  const a = b.dataset.shareact;
  closeMenus();
  const j = cur();
  if (!j) { toast('还没有手帐本可以导出'); return; }
  if (a === 'json') exportJournal(j);
  else if (a === 'pdf') exportJournalPDF(j);
  else if (a === 'svg') exportJournalSVG(j);
});
/* 点空白处收起菜单 */
document.addEventListener('pointerdown', e => {
  if (e.target.closest('.addmenu') || e.target.closest('#menuBtn') || e.target.closest('.share-wrap')) return;
  /* 阅读器的「+」菜单：点页面是「切换加到哪一页」，不能在这一步关掉它 */
  const am = $('#addMenu');
  if (am && am.classList.contains('show') && (e.target.closest('#book') || e.target.closest('#rAdd'))) return;
  closeMenus();
});
$('#menuBtn').onclick = () => toggleMenu($('#homeMenu'));

