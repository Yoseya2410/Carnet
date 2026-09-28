/* =====================================================================
 * Carnet · 主页交互 · 书架拖动排序 · 菜单与搜索   （脚本 19 / 23）
 * ---------------------------------------------------------------------
 * ① 轮播点击、书架长按/单击、书架拖动排序（FLIP 位移 + 命中判定）
 * ② 右上角菜单、分享菜单、多选选择条、删除二次确认
 * ③ 搜索面板：按名称过滤并跳转
 *
 * 依赖模块：core, state, home-view, editor, io-*
 *
 * 说明：模块间共用全局作用域，按下面的顺序加载，顺序即依赖顺序。
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
  syncHomeHead();
}
/* 把某一本标记为「被碰过」，露出编辑按钮和页数，同时选中它 */
function shelfTouched(i) {
  const el = $('#shelfWrap .book-item[data-i="' + i + '"]');
  shelfClearTouched(el);
  if (el) el.classList.add('touched');
  shelfPick(i);
}

/* ==================== 书架拖动排序 ==================== */
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
    sx: x, sy: y, px: x, py: y, moved: false, raf: 0, flipRaf: 0, slots: null
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
  const per = Math.max(1, parseInt(wrap.dataset.per || '', 10) || rows[0].children.length || 3);
  const byId = new Map();
  wrap.querySelectorAll('.book-item').forEach(el => { if (el.dataset.id) byId.set(el.dataset.id, el); });
  const selId = s.selJ && s.selJ.id;
  for (let k = 0; k < s.order.length; k++) {
    const el = byId.get(s.order[k] && s.order[k].id);
    if (!el) continue;
    /* k 递增着往后 append，同一行内自然就排成了想要的顺序 */
    rows[Math.min(Math.floor(k / per), rows.length - 1)].appendChild(el);
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
  const wr = wrap.getBoundingClientRect();
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
  const r = wrap.getBoundingClientRect();
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
  if (!shelfSort) return;
  if (e.cancelable) e.preventDefault();
  const t = e.touches && e.touches[0];
  if (t) shelfSortPointer(t.clientX, t.clientY);
}
document.addEventListener('touchmove', shelfTouchMoveGuard, { passive: false });
function shelfEndSort() {
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
$('#shelfWrap').addEventListener('pointerup', () => clearTimeout(shelfHold.timer));
$('#shelfWrap').addEventListener('pointercancel', () => { clearTimeout(shelfHold.timer); shelfHold.el = null; });
window.addEventListener('pointermove', e => {
  if (!shelfSort) return;
  e.preventDefault();                    // 拖动时别让页面 / 书架跟着滚
  shelfSortPointer(e.clientX, e.clientY);
}, { passive: false });
window.addEventListener('pointerup', () => { if (shelfSort) shelfEndSort(); });
window.addEventListener('pointercancel', () => { if (shelfSort) shelfEndSort(); });
/* 触摸时以 touch 事件兜底收尾：即使 pointer 流被浏览器中途掐了，抬手也一定收得了尾 */
window.addEventListener('touchend', () => { if (shelfSort) shelfEndSort(); }, { passive: true });
window.addEventListener('touchcancel', () => { if (shelfSort) shelfEndSort(); }, { passive: true });
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
/* 左右滑动 / 书架 的切换按钮 */
$$('#viewToggle button').forEach(btn => {
  btn.addEventListener('click', () => setView(btn.dataset.vt));
});
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
    return `<div class="sr-item" data-i="${i}">
      <div class="sr-thumb">${coverHTML(j)}</div>
      <div class="info"><div class="nm">${nm}</div><div class="meta">${j.pages.length} 页 · ${date}</div></div>
    </div>`;
  }).join('');
  $$('#searchResults .sr-item').forEach(el => el.onclick = () => {
    const i = +el.dataset.i;
    toggleSearch(false);
    if (i >= 0) selectJournal(i, true);
  });
}
$('#searchBtn').onclick = () => toggleSearch(!$('#searchPanel').classList.contains('show'));
$('#searchClose').onclick = () => toggleSearch(false);
$('#searchInput').oninput = e => renderSearch(e.target.value);
document.addEventListener('pointerdown', e => {
  if (!$('#searchPanel').classList.contains('show')) return;
  if (e.target.closest('#searchPanel') || e.target.closest('#searchBtn')) return;
  toggleSearch(false);
});

// 底部按钮
$$('.actionbar .icon-btn').forEach(b => b.onclick = () => {
  const a = b.dataset.act;
  if (a === 'new') { openEditor(null); }
  else if (a === 'more') { openBgPanel(); }
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
$$('#homeMenu button').forEach(b => b.onclick = () => {
  closeMenus();
  const a = b.dataset.menuact;
  if (a === 'import') pickImportFile();
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

