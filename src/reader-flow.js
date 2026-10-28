/* =====================================================================
 * Carnet · 阅读器交互 · 开合书动画与增删页   （脚本 24 / 27）
 * ---------------------------------------------------------------------
 * ① 打开：封面飞入放大成书 flyCover / openReader
 * ② 关闭：合书、连翻回封面、书缩回主页封面 closeReader
 * ③ 阅读器内的手势与「添加」菜单联动
 * ④ 加页 addPageAfter / 删页 deleteCurrentPage
 *
 * 对外接口：openReader, closeReader, addPageAfter, deleteCurrentPage
 *
 * 依赖模块：core, state, reader-view, page-flip（page-edit / text-sticker / page-bg / scrub 后置）
 *
 * 说明：模块间共用全局作用域，加载顺序即依赖顺序（见 index.html 与 README）。
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
  const view = state.prefs && state.prefs.view;
  /* 单层书架：从那根书脊本身起飞 —— 点它就是「从架子上抽出来」，
     动画自然得从书脊开始（此时它已被 .pulling 抬起，量到的就是抽出后的位置） */
  if (view === 'spine') {
    const sp = $(`#spineRow .spine-item[data-i="${state.sel}"]`);
    return sp ? sp.getBoundingClientRect() : null;
  }
  const root = view === 'shelf' ? '#shelfWrap' : '#carousel';
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
/* 飞行的封面。
   ⚠️ 这里**绝不能用非等比 scale 直接把起点撑成终点**：单层书架的起点是一根书脊
      （约 42×384），终点是 3:4.05 的封面（约 200×270），scale 的横纵比差 6 倍以上，
      封面内容会被先压扁再拉回来 —— 全程都是扭曲的。
   改成「窗口展开 + 内容等比填充」：
     ① ghost 本身是个**窗口**，用 width/height 从起点矩形过渡到终点矩形（尺寸变化不用 scale，
        所以窗口内部的东西不会被拉变形）；
     ② 内容单独包一层 .cover-ghost-fit，按**终点封面**的真实尺寸渲染，只做**等比** scale
        （cover 式填充：起点放大到能铺满细长窗口、且居中，所以一开始只露出中间一条竖缝，
        跟「书脊」的形状对得上），随窗口展开回落到 1 —— 内容比例从头到尾都是对的，
        只是被裁剪的范围在变：看着就是封面从书脊那条缝里展开。 */
function fitScale(win, to) {
  return Math.max(win.width / Math.max(to.width, 1), win.height / Math.max(to.height, 1));
}
function flyCover(from, to, reverse) {
  const j = cur(); if (!j || !from || !to) return null;
  const a = reverse ? to : from, b = reverse ? from : to;      // a = 起飞的窗口，b = 落地的窗口
  const ghost = document.createElement('div');
  ghost.className = 'cover-ghost';
  const fit = document.createElement('div');
  fit.className = 'cover-ghost-fit';
  fit.innerHTML = coverHTML(j);
  fit.style.width = to.width + 'px';
  fit.style.height = to.height + 'px';
  ghost.appendChild(fit);
  /* 起点圆角跟着起飞物走：从书脊出发时它就是一根窄条（书脊的圆角只有 1.5~2.5px），
     套用封面的 13px 大圆角会在细条上糊成一团 */
  const spineStart = (state.prefs && state.prefs.view) === 'spine';
  const rStart = spineStart ? '1.5px 2.5px 2px 1.5px' : '5px 13px 13px 5px';
  const rEnd = '5px 13px 13px 5px';
  ghost.style.width = a.width + 'px';
  ghost.style.height = a.height + 'px';
  ghost.style.borderRadius = reverse ? rEnd : rStart;
  ghost.style.transform = `translate(${a.left}px,${a.top}px)`;
  fit.style.transform = `translate(-50%,-50%) scale(${fitScale(a, to)})`;
  // 关闭时不做渐变：封面一路保持不透明，直接缩回主页封面大小
  if (!reverse) ghost.style.animation = `ghostOut ${FLY_MS}ms ease both`;
  $('#app').appendChild(ghost);
  const ms = reverse ? FLY_OUT_MS : FLY_MS;
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      /* 窗口的尺寸与位置、内容的等比缩放，三处必须用同一个 easing 同时长 ——
         否则中途会露出窗口空白（内容填不满）或被挤出可视区 */
      ghost.style.transition =
        `width ${ms}ms ${FLY_EASE},height ${ms}ms ${FLY_EASE},` +
        `transform ${ms}ms ${FLY_EASE},border-radius ${ms}ms ${FLY_EASE}`;
      ghost.style.width = b.width + 'px';
      ghost.style.height = b.height + 'px';
      ghost.style.borderRadius = reverse ? rStart : rEnd;
      ghost.style.transform = `translate(${b.left}px,${b.top}px)`;
      fit.style.transition = `transform ${ms}ms ${FLY_EASE}`;
      fit.style.transform = `translate(-50%,-50%) scale(${fitScale(b, to)})`;
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
/* 是否停在封面：统一用 reader-view.js 的 isCoverView()，这里不再留第二份判定 */
/* ① 无论停在第几页，先连续快翻回封面 */
function flipBackToCover() {
  return new Promise(done => {
    let budget = FLIP_BACK_BUDGET;
    const tick = () => {
      if (!$('#reader').classList.contains('show') || !cur()) { done(); return; }
      if (flipA) endFlip();                     // 先让上一页落定，否则 flip 的边界守卫会用到滞后的页码，翻过头
      if (isCoverView()) {
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
  /* 单层书架：把那根被「抽走」的书脊放回架上（抽出 + 隐藏的 class 一起摘掉） */
  $$('#spineRow .spine-item.pulling,#spineRow .spine-item.gone')
    .forEach(el => el.classList.remove('pulling', 'gone'));
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
  if (state.mode === 'spread' && !isCoverView()) {
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
  } else if (state.prefs.view === 'spine') {
    const el = $(`#spineRow .spine-item[data-i="${state.sel}"]`);
    if (el && el.scrollIntoView) el.scrollIntoView({ block: 'nearest', inline: 'center' });
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
    $$('#spineRow .spine-item.pulling,#spineRow .spine-item.gone')
      .forEach(el => el.classList.remove('pulling', 'gone'));
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
    /* 「本页底色」走底部弹窗（和编辑文字同一套），菜单先收，弹窗自己会关 */
    if (act === 'bg') { openBgSheet(currentAddPage()); return; }
    closeAddMenu();
    if (act === 'img') { addImageTo(currentAddPage()); return; }
    /* 跨页图：选一张横图 → 从中间裁成两半，各自铺满一页（见 io-photobook.js 的 addSpreadImage）。
       传进去的参考页决定它插在哪一跨页后面 */
    if (act === 'spread') { pickSpreadImage(currentAddPage()); return; }
    if (act === 'text') { addTextTo(currentAddPage()); return; }
    /* 贴纸：便利贴 / 装饰胶带 / 手绘图案，面板自己会关掉菜单 */
    if (act === 'sticker') { openStickerSheet(currentAddPage()); return; }
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
document.addEventListener('pointerdown', e => {
  const m = $('#addMenu');
  if (!m || !m.classList.contains('show')) return;
  if (e.target.closest('#addMenu') || e.target.closest('#rAdd')) return;
  if (e.target.closest('#book')) return;      // 菜单展开时点页面 = 挑加到哪一页，不关菜单
  closeAddMenu();
  markFlipSuppressed();             // 点空白处刚关掉菜单：这一下不该翻页
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
