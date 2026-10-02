/* =====================================================================
 * Carnet · 本页底色 · 底部弹窗   （脚本 16 / 24）
 * ---------------------------------------------------------------------
 * 阅读器右上角「＋ → 本页底色」像「编辑文字」那样从底部升起一张面板：
 * 标题（第几页）+ 当前色预览 + 九种颜色、每种六档「由浅到深」+ 完成 / 自定义。
 *
 * 点色块**只是预览**：纸面立刻换色，但 pg.bg 一个字节都不动；
 * 只有按了「完成」（面板里那颗，或左上角那颗 ✓）才真正写进这一页 ——
 * 没按完成就把面板关掉（点纸面、点外面）＝ 取消，纸面自己回到原来的颜色。
 * 预览借 window.__bgPv（见 visuals.js 的 pageBgShown），导出 / 存档始终按原色走。
 *
 * 对外接口：openBgSheet, closeBgSheet, commitBgSheet, writePageBg
 *
 * 依赖模块：core, state, visuals, text-sticker, widgets
 *
 * 说明：模块间共用全局作用域，加载顺序即依赖顺序（见 index.html 与 README）。
 * ===================================================================== */
const bgs = { open: false, pid: 0, built: false, out: null, orig: '', pick: '' };

/* 真正落盘：v 是 hex 就写 pg.bg，'' 就是「这一页不自带颜色、沿用整本 / 模板」 */
function writePageBg(pid, v) {
  const j = cur(); if (!j) return;
  const pg = j.pages[pid]; if (!pg) return;
  if (v) pg.bg = v; else delete pg.bg;
  save();
  renderReader();
  syncBgSheet();
}
/* 挑一档：只换预览不落盘，按了「完成」才算数 */
function pickPageBg(hex) {
  if (!bgs.open) return;
  const v = normPaperBg(hex);
  if (!v || v === bgs.pick) return;
  bgs.pick = v;
  window.__bgPv = { pid: bgs.pid, hex: v };        // 纸面按这一档重画，数据不动
  renderReader();
  syncBgSheet();
}
/* 完成：把挑中的那一档写进这一页，然后收面板 */
function commitBgSheet() {
  if (!bgs.open) return;
  const pid = bgs.pid;
  const changed = bgs.pick !== bgs.orig;
  if (changed) writePageBg(pid, bgs.pick);         // 只有这一处会把颜色存下来
  closeBgSheet();
  toast(changed ? '第 ' + (pid + 1) + ' 页底色已改' : '第 ' + (pid + 1) + ' 页底色没变');
}
/* 这一页现在到底是什么色：本页 > 整本 > 模板（模板色只在牛皮纸那两档是渐变，这里用白纸兜底显示） */
function nowPageBg(pid) {
  const j = cur(); if (!j) return { mine: '', whole: '', eff: '#fffdf8' };
  const pg = j.pages[pid === undefined ? bgs.pid : pid];
  const mine = normPaperBg(pg && pg.bg);
  const whole = normPaperBg(j.pageBg);
  return { mine, whole, eff: pageBgOf(pg, j) || '#fffdf8' };
}
/* ---- 面板内容：一次建好，之后只刷选中态 ---- */
function buildBgSheet() {
  const box = $('#bsRamps'); if (!box) return;
  /* 九种颜色横着排成一列列，每种颜色自己竖着由浅到深（上浅下深），组名挂在最底下 */
  box.innerHTML = PAPER_RAMPS.map(r =>
    `<div class="bs-col">`
    + r.c.map(c => `<button class="bs-sw" data-bg="${c}" title="${r.n} · ${c.toUpperCase()}" style="background:${c}"></button>`).join('')
    + `<span class="bs-cn">${r.n}</span></div>`).join('');
  box.addEventListener('click', e => {
    const b = e.target.closest('.bs-sw'); if (!b) return;
    pickPageBg(b.dataset.bg);
  });
  const done = $('#bsDone');
  if (done) done.onclick = commitBgSheet;
  const cus = $('#bsCus');
  /* 自定义取色盘挑完也只是预览，照样要按「完成」 */
  if (cus) cus.onclick = () => {
    openColorPicker('第 ' + (bgs.pid + 1) + ' 页底色', bgs.pick || '', hex => pickPageBg(hex));
  };
}
/* 选中态 + 顶部那颗「当前色」预览 + 完成键的高亮 */
function syncBgSheet() {
  const j = cur(); if (!j) return;
  const pick = bgs.open ? bgs.pick : '';
  const whole = normPaperBg(j.pageBg);
  const eff = pick || whole || '#fffdf8';
  $$('#bsRamps .bs-sw').forEach(b => b.classList.toggle('on', normPaperBg(b.dataset.bg) === pick));
  const sw = $('#bsNowSw'), tx = $('#bsNowTx');
  if (sw) sw.style.background = eff;
  if (tx) {
    tx.textContent = pick
      ? pick.toUpperCase() + (pick === bgs.orig ? ' · 本页' : ' · 待完成')
      : (whole ? whole.toUpperCase() + ' · 整本' : '模板纸色');
  }
  /* 挑了新色才把「完成」点亮，提醒这一档还没存 */
  const done = $('#bsDone');
  if (done) done.classList.toggle('on', !!pick && pick !== bgs.orig);
}
/* 点面板外面（纸面 / 顶栏）就收面板；面板自己、左上角完成、取色盘、菜单都算「里面」 */
function bgArmOutside() {
  bgDisarmOutside();
  bgs.out = ev => {
    if (ev.target.closest && ev.target.closest('#bgsheet, #eflowTop, .cp-mask, #addMenu')) return;
    closeBgSheet();                                // 点外面 = 取消：没按完成就不落盘
  };
  document.addEventListener('pointerdown', bgs.out, true);
}
function bgDisarmOutside() {
  if (bgs.out) { document.removeEventListener('pointerdown', bgs.out, true); bgs.out = null; }
}
function openBgSheet(pid) {
  const j = cur(); if (!j || !j.pages[pid]) return;
  closeAddMenu();                                 // 菜单让位：面板是全宽的底部弹窗
  window.__bgSheetOpen = true;                    // 让文字面板那套「编辑态避让」也认这块面板
  window.__bgClose = closeBgSheet;                // 取消（点外面）
  window.__bgOk = commitBgSheet;                  // 完成（左上角那颗 ✓）
  commitTextEdit();                               // 正在行内打字的话先落盘，两种编辑不并存
  if (typeof hideTextBar === 'function' && sh && sh.open) hideTextBar();
  bgs.open = true; bgs.pid = pid;
  bgs.orig = nowPageBg(pid).mine;                 // 打开时这一页自己的色（'' = 用模板 / 整本）
  bgs.pick = bgs.orig;
  window.__bgPv = { pid, hex: bgs.orig };
  if (!bgs.built) { buildBgSheet(); bgs.built = true; }
  const sheet = $('#bgsheet'); if (!sheet) return;
  const pn = $('#bsPage'); if (pn) pn.textContent = pid + 1;
  sheet.hidden = false;
  syncBgSheet();
  updateEflow();
  requestAnimationFrame(() => { sheetLayout(); layoutBook(); });
  setTimeout(() => { sheetLayout(); layoutBook(); }, 340);   // 升起动画走完再量一次
  bgArmOutside();
}
function closeBgSheet() {
  if (!bgs.open) return;
  const dirty = bgs.pick !== bgs.orig;            // 挑了新色却没按完成：纸面要退回原样
  bgs.open = false;
  window.__bgSheetOpen = false;
  window.__bgClose = null;
  window.__bgOk = null;
  window.__bgPv = null;                           // 撤掉预览，pageBgShown 回到按数据取色
  bgDisarmOutside();
  const sheet = $('#bgsheet');
  if (sheet) { sheet.hidden = true; sheet.style.transform = ''; sheet.style.maxHeight = ''; }
  /* 记一下收面板的时刻：紧接着那一下点击只是「关面板」，不该顺手把页翻过去 */
  markFlipSuppressed();
  window.__sheetCov = 0;
  const reader = $('#reader');
  if (reader) reader.style.setProperty('--stage-shift', '0px');
  updateEflow();
  if (dirty && typeof renderReader === 'function') renderReader();
  if (typeof layoutBook === 'function') layoutBook();
}
