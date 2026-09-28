/* =====================================================================
 * Carnet · 阅读器交互 · 开合书动画   （脚本 20 / 23）
 * ---------------------------------------------------------------------
 * ① 打开：封面飞入放大成书 flyCover / openReader
 * ② 关闭：合书、连翻回封面、书缩回主页封面
 * ③ 阅读器内的手势与添加菜单联动
 *
 * 依赖模块：core, state, reader-view, page-flip
 *
 * 说明：模块间共用全局作用域，按下面的顺序加载，顺序即依赖顺序。
 * ===================================================================== */
/* ==================== 阅读器交互 ==================== */
/* 开合动画：把主页封面「飞」成书，关闭时再飞回去 */
const FLY_MS = 560;
const FLY_OUT_MS = 600;                          // 关闭：慢慢缩回主页
const FLY_EASE = 'cubic-bezier(.22,1,.28,1)';   // 收尾更绵长，落地不生硬
const FOLD_MS = 400;                             // 合书：右页沿书脊翻到左侧
const FLIP_BACK_STEP = 160;                      // 回封面：连续快翻的节奏（比原来更急）
const FLIP_BACK_BUDGET = 720;                    // 回封面总预算，翻太久就直接落到封面
let flyBusy = false;
function coverRect() {
  /* 书架里一眼能看到好几本，必须认准当前那一本，动画才不会从别的位置飞出去 */
  const root = state.prefs && state.prefs.view === 'shelf' ? '#shelfWrap' : '#carousel';
  const el = $(`${root} .book-item[data-i="${state.sel}"] .cover`)
    || $('.book-item.active .cover') || $('.book-item .cover');
  return el ? el.getBoundingClientRect() : null;
}
/* 画面上「封面那一页」的位置：合上书之后封面躺在左槽，平时在右槽；
   也不能去量整本书 —— 封面单独成页时书比封面宽一倍 */
function coverPageRect() {
  const el = $('#slotL .paper.coverpage') || $('#slotR .paper.coverpage');
  return (el || $('#book')).getBoundingClientRect();
}
function flyCover(from, to, reverse) {
  const j = cur(); if (!j || !from || !to) return null;
  const ghost = document.createElement('div');
  ghost.className = 'cover-ghost';
  ghost.innerHTML = coverHTML(j);
  ghost.style.width = from.width + 'px';
  ghost.style.height = from.height + 'px';
  const at = r => `translate(${r.left}px,${r.top}px)`;
  const sx = to.width / Math.max(from.width, 1), sy = to.height / Math.max(from.height, 1);
  const fromT = reverse ? `${at(to)} scale(${sx},${sy})` : at(from);
  const toT = reverse ? at(from) : `${at(to)} scale(${sx},${sy})`;
  ghost.style.transform = fromT;
  // 关闭时不做渐变：封面一路保持不透明，直接缩回主页封面大小
  if (!reverse) ghost.style.animation = `ghostOut ${FLY_MS}ms ease both`;
  $('#app').appendChild(ghost);
  const ms = reverse ? FLY_OUT_MS : FLY_MS;
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      ghost.style.transition = `transform ${ms}ms ${FLY_EASE}`;
      ghost.style.transform = toT;
    });
  });
  setTimeout(() => ghost.remove(), ms + 60);
  return ghost;
}
function openReader() {
  if (flyBusy || !cur()) return;
  cancelFlip();
  closeScrub();
  closeAddMenu();
  hideTextBar();
  state.page = -1; state.spread = -1;   // 先展示封面
  const home = $('#home'), reader = $('#reader'), book = $('#book');
  const from = coverRect();
  const reduced = window.matchMedia('(prefers-reduced-motion:reduce)').matches;
  if (!from || reduced) {
    reader.classList.add('show');
    home.classList.remove('book-returning');
    book.classList.remove('book-in', 'book-out', 'gone', 'folded');
    renderReader();
    return;
  }
  flyBusy = true;
  home.classList.remove('book-returning');
  home.classList.add('book-opening');
  reader.classList.add('book-opening');
  reader.classList.add('show');
  book.classList.remove('book-out', 'gone', 'folded');
  renderReader();
  /* 量封面那一页本身，而不是整本书 —— 封面单独成页时书比封面宽一倍 */
  const to = coverPageRect();
  book.classList.add('book-in');
  flyCover(from, to, false);
  setTimeout(() => {
    flyBusy = false;
    reader.classList.remove('book-opening');
    book.classList.remove('book-in');
  }, FLY_MS + 40);
}
function atCoverView() {
  return state.mode === 'spread' ? state.spread <= -1 : state.page <= -1;
}
/* ① 无论停在第几页，先连续快翻回封面 */
function flipBackToCover() {
  return new Promise(done => {
    let budget = FLIP_BACK_BUDGET;
    const tick = () => {
      if (!$('#reader').classList.contains('show') || !cur()) { done(); return; }
      if (flipA) endFlip();                     // 先让上一页落定，否则 flip 的边界守卫会用到滞后的页码，翻过头
      if (atCoverView()) {
        if (state.spread <= -1) state.page = -1;
        done(); return;
      }
      if (budget <= 0) {                       // 页数太多就别磨蹭，直接落到封面
        state.page = -1; state.spread = -1; renderReader(); done(); return;
      }
      budget -= FLIP_BACK_STEP;
      flip(-1);                                // 上一页没翻完会被立刻落定，形成"哗哗翻"的快翻手感
      setTimeout(tick, FLIP_BACK_STEP);
    };
    tick();
  });
}
/* ② 合上书：把右页沿书脊翻到左侧，封面朝外，再把书收拢成一本 */
function foldBook() {
  const END = '<div class="paper endpaper"></div>';
  return new Promise(done => {
    const book = $('#book'), leaf = $('#leaf'), lf = $('#leafF'), lb = $('#leafB');
    lf.innerHTML = $('#slotR').innerHTML;        // 正面：当前摊着的右页，原样搬走，视觉不断
    lb.innerHTML = coverPageHTML();              // 背面：翻过去之后朝外的就是封面
    $('#slotR').innerHTML = END;                 // 右页被"掀"起来，底下露出衬页
    leaf.classList.add('show', 'turning');
    leaf.style.transition = 'none';
    leaf.style.transform = 'rotateY(0deg)';
    /* 直接用翻页引擎合书：一次完整的翻页，手感跟平时翻页一模一样。
       不自己写 CSS transition —— leaf 刚从隐藏变可见时首帧起点容易丢，动画会被吞掉 */
    flipA = {
      dir: -1, from: 0, to: -180, dur: FOLD_MS, raf: 0, t0: performance.now(),
      onEnd: () => {
        $('#slotL').innerHTML = coverPageHTML();    // 交接给左边槽位，封面位置纹丝不动
        leaf.classList.remove('show', 'turning');
        leaf.style.transition = 'none';
        leaf.style.transform = 'none';
        state.page = -1; state.spread = -1;         // 书已合上，状态回到封面（不重绘，免得合拢形态被冲掉）
        $('#pager').textContent = '封面';            // 底栏页码跟上（整体重绘会破坏合拢形态，这里只改文字）
        book.classList.add('folded');              // 收成一本合着的书
        done();
      }
    };
    requestAnimationFrame(stepFlip);
  });
}
/* 收尾清理：无论走到哪一步被打断，都能把现场还原干净 */
function endClose() {
  flyBusy = false;
  cancelFlip();                                // 合书没跑完就被跳过时，别让它的收尾再给书加上合拢态
  const leaf = $('#leaf');
  if (leaf) { leaf.classList.remove('show', 'turning'); leaf.style.transition = 'none'; leaf.style.transform = 'none'; }
  $('#reader').classList.remove('show', 'closing');
  $('#book').classList.remove('book-out', 'gone', 'folded');
  $('#book').style.transform = '';
  $('#home').classList.remove('book-returning');
}
/* 退场：先翻回封面 → 合上书 → 缩小回主页 */
async function runCloseSequence(to) {
  const reader = $('#reader'), book = $('#book');
  const alive = () => reader.classList.contains('show') && !!cur();
  await flipBackToCover();
  if (!alive()) { endClose(); return; }
  /* 单页模式本来就「合着」，停在封面时也只有一张封面，都不用再合一次 */
  if (state.mode === 'spread' && !atCoverView()) {
    await foldBook();
    if (!alive()) { endClose(); return; }
  }
  const from = coverPageRect();                 // 封面那一页的位置（可能是左槽也可能是右槽）
  state.page = -1; state.spread = -1;          // 单页模式没经过合书，这里统一归位到封面态
  flyCover(to, from, true);
  /* 封面交给 ghost 去飞回主页：这里立刻隐藏，不留淡出 */
  book.classList.add('gone');
  // 封面还在飞的时候主页就淡入接住它，落地那一刻两边已经长得一样，看不出接缝
  setTimeout(() => $('#home').classList.remove('book-returning'), FLY_OUT_MS * 0.52);
  setTimeout(endClose, FLY_OUT_MS * 0.8);
}
function closeReader() {
  cancelFlip();
  closeScrub();
  closeAddMenu();
  commitTextEdit();
  hideTextBar();
  const home = $('#home'), reader = $('#reader'), book = $('#book');
  if (!reader.classList.contains('show')) return;
  const reduced = window.matchMedia('(prefers-reduced-motion:reduce)').matches;
  /* 书架模式先把要落位的那本滚进视野，不然封面飞回去会飞到屏幕外 */
  if (state.prefs.view === 'shelf') {
    const el = $(`#shelfWrap .book-item[data-i="${state.sel}"]`);
    if (el && el.scrollIntoView) el.scrollIntoView({ block: 'center' });
  }
  /* 主页先无过渡地回到最终布局，再量封面位置 —— 否则量到的是缩放中的尺寸，落点会偏 */
  home.classList.add('noanim');
  home.classList.remove('book-opening');
  home.classList.add('book-returning');
  void home.offsetWidth;                       // 强制回流，让上面的变化立即生效
  home.classList.remove('noanim');
  const to = coverRect();
  book.classList.remove('folded', 'gone');
  if (!to || reduced) {
    reader.classList.remove('show');
    home.classList.remove('book-returning');
    book.classList.remove('book-in', 'book-out', 'gone', 'folded');
    return;
  }
  if (flyBusy) {                               // 退场动画没播完就再点一次：直接收掉
    endClose();
    return;
  }
  flyBusy = true;
  reader.classList.add('closing');
  runCloseSequence(to);
}
$('#backBtn').onclick = closeReader;
$('#prevBtn').onclick = () => flip(-1);
$('#nextBtn').onclick = () => flip(1);
/* 右上角「添加」：弹出菜单选加页 / 图片 / 文字 */
$('#rAdd').onclick = e => {
  e.stopPropagation();
  toggleAddMenu();
};
$$('#addMenu [data-addact]').forEach(btn => {
  btn.addEventListener('click', e => {
    e.stopPropagation();
    const act = btn.dataset.addact;
    closeAddMenu();
    if (act === 'img') { addImageTo(currentAddPage()); return; }
    if (act === 'text') { addTextTo(currentAddPage()); return; }
    if (act === 'del') { deleteCurrentPage(); return; }
    addPageAfter();
  });
});
/* 「左页 / 右页」切换：直接选新内容加到哪一页，菜单保持展开 */
$$('#amTarget .am-side').forEach(btn => {
  btn.addEventListener('click', e => {
    e.stopPropagation();
    const [a, b] = currentIndices();
    const pid = btn.dataset.side === 'L' ? a : b;
    if (pid < 0 || !cur().pages[pid]) return;
    setAddTarget(pid); markAddTarget(); updateAddMenuHint();
  });
});
let menuClosedAt = 0;                  // 点空白处刚关掉菜单：这一下不该翻页
document.addEventListener('pointerdown', e => {
  const m = $('#addMenu');
  if (!m || !m.classList.contains('show')) return;
  if (e.target.closest('#addMenu') || e.target.closest('#rAdd')) return;
  if (e.target.closest('#book')) return;      // 菜单展开时点页面 = 挑加到哪一页，不关菜单
  closeAddMenu();
  menuClosedAt = performance.now();
}, true);

/* 加页：插在「目标页」的后面（双页模式下可以在左页后，也可以在右页后） */
function addPageAfter() {
  const j = cur(); if (!j) return;
  if (state.mode === 'spread' && !isCoverView()) {
    const [a, b] = currentIndices();
    const t = currentAddPage();
    // 目标页是右页就插在右页后（落到下一跨页的左页），否则插在左页后（就是当前跨页的右页）
    const at = (t === b && j.pages[b]) ? b + 1 : a + 1;
    j.pages.splice(at, 0, mkPage());
    save();
    state.spread = clamp(Math.floor(at / 2), 0, Math.max(Math.ceil(j.pages.length / 2) - 1, 0));
    setAddTarget(at);              // 新页直接成为下一个添加目标
    renderReader();
    toast('已在第 ' + at + ' 页后加一页');
  } else {
    const at = state.page + 1;                 // 封面态 page=-1 → 插到最前面
    j.pages.splice(Math.max(at, 0), 0, mkPage());
    save();
    state.page = Math.max(at, 0);
    renderReader();
    toast(at <= 0 ? '已在封面后加一页' : '已在第 ' + at + ' 页后加一页');
  }
  renderHome();                 // 主页封面的「N 页」角标跟着更新
}
/* 删除当前目标页：双页模式下先在菜单里点「左页 / 右页」挑要删哪一页，再点删除 */
function deleteCurrentPage() {
  const j = cur(); if (!j) return;
  if (!j.pages.length) { toast('这一本已经没有页面了'); return; }
  const p = currentAddPage();
  const pg = j.pages[p];
  if (!pg) { toast('这一页不存在'); return; }
  if (j.pages.length <= 1) { toast('至少得留一页，不能再删了'); return; }
  const nImg = (pg.images || []).length, nTxt = (pg.texts || []).length;
  const doDelete = () => {
    j.pages.splice(p, 1);
    /* 删完把视图拉回合法范围，别停在已经不存在的页上 */
    if (state.mode === 'spread') {
      state.spread = clamp(state.spread, 0, Math.max(Math.ceil(j.pages.length / 2) - 1, 0));
    } else {
      state.page = clamp(state.page, 0, j.pages.length - 1);
    }
    setAddTarget(Math.min(p, j.pages.length - 1));
    state.pendingPage = null;
    save(); renderReader(); renderHome();
    toast('已删除第 ' + (p + 1) + ' 页');
  };
  /* 空白页直接删，有内容的先问一句 */
  if (!nImg && !nTxt) { doDelete(); return; }
  const what = [nImg ? nImg + ' 张图片' : '', nTxt ? nTxt + ' 段文字' : ''].filter(Boolean).join(' 和 ');
  askConfirm(`第 ${p + 1} 页上的 ${what}会一起删掉，删了就找不回来了。`, {
    title: '删除这一页', ok: '删除', onOk: doDelete
  });
}
