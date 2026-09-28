/* =====================================================================
 * Carnet · 文字贴 · 样式条与编辑   （脚本 15 / 23）
 * ---------------------------------------------------------------------
 * ① 选中文字贴后底部样式条：字号 / 加粗 / 对齐 / 颜色
 * ② 进入编辑、提交、退出编辑（输入法收起自动结束）
 *
 * 依赖模块：core, state
 *
 * 说明：模块间共用全局作用域，按下面的顺序加载，顺序即依赖顺序。
 * ===================================================================== */
/* ==================== 文字贴：选中样式条 + 编辑 ==================== */
let selText = null;                     // {pid, iid}
/* 页面里正忙：拖图 / 拉伸 / 打字 —— 这些时候不能重绘，否则会打断 */
function pageBusy() {
  return !!(state.imgDragging || state.imgResizing || document.querySelector('.ptext-wrap.editing'));
}
function textStyle(t) {
  const fs = (t.size || 5.5) / 100;
  return `font-size:calc(var(--pw,340px) * ${fs.toFixed(4)});color:${t.color || '#2b2f3d'};`
    + `text-align:${t.align || 'left'};${t.bold ? 'font-weight:700;' : ''}`;
}
function textById(pid, iid) {
  const pg = cur().pages[pid];
  return pg ? pageTexts(pg).find(x => x.id === iid) : null;
}
function syncTextBar() {
  const bar = $('#tstyle'); if (!bar) return;
  const t = selText ? textById(selText.pid, selText.iid) : null;
  if (!t) { setEditBar(false); return; }
  setEditBar(true);
  $('#tsBold').classList.toggle('on', !!t.bold);
  const al = $('#tsAlign');
  if (al) { al.innerHTML = alignSVG(t.align || 'left'); al.title = '对齐：' + (TS_ALIGN_TXT[t.align] || '左'); }
  $$('#tsColors .sw').forEach(b => b.classList.toggle('on', b.dataset.color === t.color));
}
/* 底栏切换：编辑文字时显示工具栏，隐藏页码与翻页按钮 */
function setEditBar(on) {
  const rbot = $('.rbot'); if (!rbot) return;
  rbot.classList.toggle('editing', !!on);
  if (window.__syncBotBar) setTimeout(window.__syncBotBar, 30);   // 底栏跟着输入法抬 / 落
}
function showTextBar(w, pid, iid) { closeScrub(); selText = { pid, iid }; syncTextBar(); }
function hideTextBar() { selText = null; setEditBar(false); }
/* 直接改样式，不整页重绘 —— 避免打字时把输入框重建掉 */
function patchText(fn) {
  if (!selText) return;
  const t = textById(selText.pid, selText.iid); if (!t) return;
  fn(t); save();
  const w = $(`#slotL .ptext-wrap[data-id="${selText.iid}"], #slotR .ptext-wrap[data-id="${selText.iid}"]`);
  if (w) {
    const el = w.querySelector('.ptxt');
    if (el) el.setAttribute('style', textStyle(t));
  }
  syncTextBar();
}
/* ---- 文字样式条：字号 / 加粗 / 对齐 / 颜色 / 编辑 ---- */
const TS_ALIGN = ['left', 'center', 'right'];
const TS_ALIGN_TXT = { left: '左', center: '中', right: '右' };
/* 对齐用图标表示，比一个「左」字更好认 */
function alignSVG(a) {
  const ws = [13, 9, 11];
  const xs = ws.map(w => a === 'right' ? 16 - 3 - w : (a === 'center' ? (16 - w) / 2 : 3));
  return '<svg fill="none" height="17" stroke="currentColor" stroke-linecap="round" stroke-width="1.8" viewBox="0 0 16 16" width="17">'
    + xs.map((x, i) => `<path d="M${x} ${4 + i * 4}h${ws[i]}"/>`).join('') + '</svg>';
}
function buildTextBar() {
  const box = $('#tsColors'); if (!box) return;
  box.innerHTML = TEXT_COLORS.map(c =>
    `<button class="sw" data-color="${c}" style="background:${c}" title="文字颜色"></button>`).join('');
  box.addEventListener('pointerdown', e => {
    const b = e.target.closest('.sw'); if (!b) return;
    e.preventDefault(); e.stopPropagation();
    patchText(t => { t.color = b.dataset.color; });
  });
  const minus = $('#tsMinus'), plus = $('#tsPlus'), bold = $('#tsBold'), align = $('#tsAlign');
  if (minus) minus.addEventListener('pointerdown', e => {
    e.preventDefault(); e.stopPropagation();
    patchText(t => { t.size = clamp(+(t.size || 5.5) - .5, 2.2, 22); });
  });
  if (plus) plus.addEventListener('pointerdown', e => {
    e.preventDefault(); e.stopPropagation();
    patchText(t => { t.size = clamp(+(t.size || 5.5) + .5, 2.2, 22); });
  });
  if (bold) bold.addEventListener('pointerdown', e => {
    e.preventDefault(); e.stopPropagation();
    patchText(t => { t.bold = !t.bold; });
  });
  if (align) align.addEventListener('pointerdown', e => {
    e.preventDefault(); e.stopPropagation();
    patchText(t => {
      const i = TS_ALIGN.indexOf(t.align || 'left');
      t.align = TS_ALIGN[(i + 1) % TS_ALIGN.length];
    });
  });
}
buildTextBar();
function startTextEdit(w, pid, iid) {
  const t = textById(pid, iid); if (!t) return;
  selText = { pid, iid };
  $$('.ptext-wrap.editing').forEach(x => { if (x !== w) stopTextEdit(x, true); });
  const el = w.querySelector('.ptxt'); if (!el) return;
  if (w.__editing) { el.focus(); return; }      // 已在编辑：只把焦点拿回来
  w.__editing = true;
  w.classList.add('editing');
  if (!t.text) el.textContent = '';
  el.contentEditable = 'true';
  el.spellcheck = false;
  el.focus();
  try {
    const r = document.createRange(); r.selectNodeContents(el); r.collapse(false);
    const s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
  } catch (_) {}
  el.addEventListener('blur', () => stopTextEdit(w, true), { once: true });
  el.addEventListener('keydown', ev => {
    ev.stopPropagation();                       // 打字时不要触发翻页快捷键
    if (ev.key === 'Escape') { ev.preventDefault(); el.blur(); }
  });
  // 点纸面空白处不会触发 contentEditable 的 blur，得自己兜住
  // 底栏工具栏上的按键自己会保住焦点，不能在这里先提交掉，否则加粗 / 换色全失效
  w.__docDown = ev => {
    if (w.contains(ev.target)) return;
    if (ev.target.closest && ev.target.closest('.rbot, #tstyle, #addMenu, #confirmMask')) return;
    stopTextEdit(w, true);
  };
  document.addEventListener('pointerdown', w.__docDown, true);
  syncTextBar();
}
function stopTextEdit(w, commit, noRender) {
  if (!w || !w.__editing) return;               // 已结束：避免 blur / 点击重复提交
  w.__editing = false;
  if (w.__docDown) { document.removeEventListener('pointerdown', w.__docDown, true); w.__docDown = null; }
  const el = w.querySelector('.ptxt');
  w.classList.remove('editing', 'adjust', 'sel');
  w.classList.add('locked');                       // 编辑完文字默认自动固定
  if (el) el.contentEditable = 'false';
  if (!el) { hideTextBar(); return; }
  if (commit && selText) {
    const t = textById(selText.pid, selText.iid);
    if (t) { t.text = (el.innerText || '').replace(/[\r\n]+$/, ''); t.locked = true; }
    window.__textCommitAt = performance.now();
    save();
  }
  if (!noRender && w.isConnected) renderReader();
  hideTextBar();                          // 退出输入：底栏恢复页码与翻页
  $$('.pimg-wrap,.ptext-wrap').forEach(x => x.classList.remove('sel', 'adjust'));
}
/* 翻页 / 关闭前先落盘正在编辑的文字 */
function commitTextEdit() {
  const w = document.querySelector('.ptext-wrap.editing');
  if (w) stopTextEdit(w, true, true);
}

