/* =====================================================================
 * Carnet · 阅读器交互 · 开合书动画与增删页   （脚本 25 / 28）
 * ---------------------------------------------------------------------
 * ① 打开：封面飞入放大成书 flyCover / openReader
 * ② 关闭：合上书（只合一次，不再先连翻回封面）、书缩回主页封面 closeReader
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
const FOLD_MS = 400;                             // 合书：左半边沿书脊翻到右侧（统一从左往右）
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
      （约 42×384），终点是 A5 封面（约 190×270），scale 的横纵比差 6 倍以上，
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
     套用封面的大圆角会在细条上糊成一团。从封面起飞时右侧两角按这一本自定义的圆角走
     （默认 10px → 13px，跟原来的起点一致），左侧书脊两角固定 5px。 */
  const spineStart = (state.prefs && state.prefs.view) === 'spine';
  const rHome = coverRadiusOf(j);
  const rStart = spineStart ? '1.5px 2.5px 2px 1.5px'
    : `5px ${(rHome * 1.3).toFixed(1)}px ${(rHome * 1.3).toFixed(1)}px 5px`;
  /* 落地圆角必须等于**这一本合书态整本外框**的 --book-r：
     笔记本 / 画册 5px 16px 16px 5px、活页 5px 25px 25px 5px（翻开后改为四角统一、
     但角度仍是同一个 --cr-round；飞入时先落到合着的封面，所以取合书那一档）。
     ⚠️ 现在 --book-r 是带 calc()/var() 的公式，读 getComputedStyle 拿到的可能是
        未解析的变量串（塞给 ghost 的 border-radius 就作废了），所以直接由
        bookRadiusOf(j) 算同一组合书态数值：右侧两角跟着本子的封面圆角走，左侧固定 5px。 */
  const rr = bookRadiusOf(j).toFixed(1);
  const rEnd = `5px ${rr}px ${rr}px 5px`;
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
  /* 加密本还没解锁就先解密：本机记住过密钥时静默完成（不弹框），
     从外部导入 / 点过「立即上锁」的才弹输入框；解锁成功后会重新跑一次 openReader。 */
  if (!guardUnlocked(cur(), () => openReader())) return;
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
    book.classList.remove('book-in', 'book-out', 'gone', 'folded', 'folding', 'cover-flip');
    renderReader();
    return;
  }
  flyBusy = true;
  home.classList.remove('book-returning');
  home.classList.add('book-opening');
  reader.classList.add('book-opening');
  reader.classList.add('show');
  book.classList.remove('book-out', 'gone', 'folded', 'folding', 'cover-flip');
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
/* ① 合上书：一次动画，不再先「哗哗翻回封面」。
   ⚠️ 以前是 flipBackToCover() 翻回封面（它最后一翻本身就把书合上了，而且只播 160ms 就被掐断，
      是个半截的「小合上」），完了再走 foldBook() —— 合上看着演了两遍，第一遍还只演了一半。
      现在合上**只留一次**：当前这一跨直接合。 */
function closeBookOnce() {
  /* 单页模式本来就「合着」（一次只有一张纸），不补合书动画，直接回封面 */
  if (state.mode !== 'spread') { state.page = -1; renderReader(); return Promise.resolve(); }
  /* 第一跨页（封面内侧 + 第 1 页）：走翻页那套 —— 封面摊开 / 合拢的那段横移在里面。
     ⚠️ 它是「从左往右」合上的（叶片从 -180° 转到 0°），下面的 foldBook 必须同向 */
  if (state.spread === 0) return flipDone(-1);
  /* 其它跨页：右页沿书脊翻到左边，封面朝外 */
  return foldBook();
}
/* 翻一次页并等到它播完：flip 是逐帧驱动的、没有完成回调，这里盯着 flipA 判结束
   （flip 因边界守卫没启动时会立刻 resolve） */
function flipDone(dir) {
  return new Promise(done => {
    flip(dir);
    (function wait() { if (flipA) requestAnimationFrame(wait); else done(); })();
  });
}
/* ② 合上书：**一律从左往右** —— 把左半边抬起来，沿书脊翻到右边盖上，落定后朝外的是封面。
   ⚠️ 方向跟「第一跨页合回封面」那一翻（closeBookOnce 里的 flip(-1)）必须是同一个：
      以前第二跨往后是反着来（把右页往左掀），同一个「返回」一会儿左合一会儿右合，
      看着像两套本子 —— 现在两处都是「从左往右」。
   ⚠️ 起步那一格（-180°，正盖住左槽）放的是**当前左页**：整格内容原样搬进叶背，
      画面从静止接得上，不会在第一帧跳一下；
      落那一格（0°，盖住右槽）放封面 —— 合上之后朝外的自然是它。
      ⚠️ 落点必须是 slotR（不是 slotL）：封面单独成页时 `.cover-only` 会把左槽收起来，
         放在左槽里它是 display:none，量出来的位置是 0×0，
         紧接着飞回主页那张 ghost 就会从屏幕左上角那么一个「无」里长出来。 */
function foldBook() {
  return new Promise(done => {
    const book = $('#book'), leaf = $('#leaf'), lf = $('#leafF'), lb = $('#leafB');
    /* 换掉左槽前先把文字贴挂在 document 上的监听摘掉（跟 renderReader 同一套做法），
       不然这些节点被冲掉之后监听会残留 */
    $$('#slotL .ptext-wrap').forEach(x => {
      if (x.__outDown) { document.removeEventListener('pointerdown', x.__outDown, true); x.__outDown = null; }
    });
    /* 活页合上的是**整本左半边**，封面比内页大一圈：
       ① 叶片换到「整张封面板」那套几何（.book.cover-flip，见 reader.css）—— 沿用内页尺寸的话，
          落地那张封面是内页大小，看着就是「一张纸合上了」，不是外面那张封面合上了；
       ② 背上那一面（起点，还躺在左边）照摊开的样子摆：板（封面内侧）+ 压在板上的那张内页
          （.leaf-page-inset 让出四周的露边），这样第一帧和静止时一模一样，不会跳一下。
       胶装本封面与内页同大、也没有封面内侧那层皮，照老样子把纸铺满整格即可。 */
    const ringed = !!bookStyleOf(cur()).rings;
    const leftHTML = $('#slotL').innerHTML;
    lb.innerHTML = ringed
      ? insideCoverPageHTML() + `<div class="leaf-page-inset">${leftHTML}</div>`
      : leftHTML;                             // 背面：当前左页（起点那一面）
    lf.innerHTML = coverPageHTML();           // 正面：封面（落地那一面）
    /* 左页被"掀"起来带走：**整格一起收掉**（.book.folding，见 book-anim.css）——
       空槽自己垫的那层纸色看着就是「一张白纸停在左边」，而合上的是整本左半边，
       纸和封面都跟着翻过去了，那一格合书期间本来就该什么都没有 */
    $('#slotL').innerHTML = '';
    book.classList.add('folding');
    if (ringed) book.classList.add('cover-flip');
    leaf.classList.add('show', 'turning');
    leaf.style.transition = 'none';
    leaf.style.transform = 'rotateY(-180deg)';
    flipA = {
      dir: -1, from: -180, to: 0, dur: FOLD_MS, raf: 0, t0: performance.now(),
      onEnd: () => {
        $('#slotR').innerHTML = coverPageHTML();    // 交接给右槽：封面就停在自己落地的位置
        leaf.classList.remove('show', 'turning');
        leaf.style.transition = 'none';
        leaf.style.transform = 'none';
        state.page = -1; state.spread = -1;         // 书已合上，状态回到封面（不重绘，免得合拢形态被冲掉）
        $('#pager').textContent = '封面';            // 底栏页码跟上（整体重绘会破坏合拢形态，这里只改文字）
        /* 形态改到「封面单独成页」再按封面态重算尺寸：活页封面比内页大一圈
           （--pw 从内页宽变成封面宽），不重算的话收拢出来的是内页大小的一张封面 */
        book.classList.remove('spread', 'first-spread', 'last-spread', 'has-under', 'folding', 'cover-flip');
        book.classList.add('cover-only');
        layoutBook();
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
  $('#book').classList.remove('book-out', 'gone', 'folded', 'folding', 'cover-flip');
  $('#book').style.transform = '';
  $('#home').classList.remove('book-returning');
}
/* 退场：合上书（一次动画） → 缩小回主页 */
async function runCloseSequence(to) {
  const reader = $('#reader'), book = $('#book');
  const alive = () => reader.classList.contains('show') && !!cur();
  /* 停在封面就不用再合；否则**合一次**就够（见 closeBookOnce 的注释） */
  if (!isCoverView()) {
    await closeBookOnce();
    if (!alive()) { endClose(); return; }
  }
  const from = coverPageRect();                 // 封面那一页的位置（可能是左槽也可能是右槽）
  state.page = -1; state.spread = -1;          // 统一归位到封面态
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
    book.classList.remove('book-in', 'book-out', 'gone', 'folded', 'folding', 'cover-flip');
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
    state.spread = clamp(spreadIndexOfPage(at), 0, spreadCount(j.pages.length) - 1);
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
      state.spread = clamp(state.spread, 0, spreadCount(j.pages.length) - 1);
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
