/* =====================================================================
 * Carnet · 文字贴 · 编辑面板与行内编辑   （脚本 15 / 24）
 * ---------------------------------------------------------------------
 * ① 底部「编辑文字」面板 .tsheet：正文 + 字体 / 颜色 / 字号 / 格式四个标签页
 * ② 面板会话内的撤销栈 shPush / shUndo，每一次改动即时画回纸面
 * ③ 编辑态 eflow：顶栏底栏让位、书整体上移避让（updateEflow / sheetLayout，底色面板复用同一套）
 * ④ 行内编辑（双击直接打字）startTextEdit / stopTextEdit
 *
 * 对外接口：openTextSheet, closeTextSheet, startTextEdit, stopTextEdit, commitTextEdit, pageBusy, syncBar, updateEflow, sheetLayout
 *
 * 依赖模块：core, state, visuals（widgets / scrub / page-bg 后置，只在运行时调用）
 *
 * 说明：模块间共用全局作用域，加载顺序即依赖顺序（见 index.html 与 README）。
 * ===================================================================== */
/* ==================== 文字贴：编辑面板 ==================== */
let selText = null;                     // {pid, iid}
/* 页面里正忙：拖图 / 拉伸 / 打字 —— 这些时候不能重绘，否则会打断 */
function pageBusy() {
  return !!(state.imgDragging || state.imgResizing || document.querySelector('.ptext-wrap.editing'));
}
/* 字号档位：面板上的快捷档（值 = 占纸宽的百分比） */
const TS_SIZES = [
  { n: '小',   v: 4 },
  { n: '中',   v: 5.5 },
  { n: '大',   v: 7.5 },
  { n: '特大', v: 10.5 }
];
/* 对齐三档 + 图标（用一个「左」字不如三条长短线好认）。
   三条线宽度拉开差距、贴左 / 居中 / 贴右各对齐一条边，缩到 17px 也一眼分得出 */
const TS_ALIGN = ['left', 'center', 'right'];
const TS_ALIGN_TXT = { left: '左', center: '中', right: '右' };
function alignSVG(a) {
  const ws = [12, 6, 9];
  const xs = ws.map(w => a === 'right' ? 14 - w : (a === 'center' ? (16 - w) / 2 : 2));
  return '<svg fill="none" height="17" stroke="currentColor" stroke-linecap="round" stroke-width="1.8" viewBox="0 0 16 16" width="17">'
    + xs.map((x, i) => `<path d="M${x} ${4 + i * 4}h${ws[i]}"/>`).join('') + '</svg>';
}
function textStyle(t) {
  const fs = (t.size || 5.5) / 100;
  const cn = textFontVar(t.font);
  const en = textEnVar(t.fontEn);
  /* 英文字体排前面：拉丁字走它，汉字自动落到后面的中文字体（英文那几档都不带通用族） */
  const fam = [en, cn].filter(Boolean).join(',') || 'inherit';
  return `font-size:calc(var(--pw,340px) * ${fs.toFixed(4)});color:${t.color || '#2b2f3d'};`
    + `text-align:${t.align || 'left'};${t.bold ? 'font-weight:700;' : ''}`
    + `${t.italic ? 'font-style:italic;' : ''}`
    + `${t.underline ? 'text-decoration:underline;' : (t.strike ? 'text-decoration:line-through;' : '')}`
    + `${t.bg ? 'background:' + t.bg + ';' : ''}`
    + `font-family:${fam};`;
}
function textById(pid, iid) {
  const pg = cur() && cur().pages[pid];
  return pg ? pageTexts(pg).find(x => x.id === iid) : null;
}
function textWrap(iid) {
  return $(`#slotL .ptext-wrap[data-id="${iid}"], #slotR .ptext-wrap[data-id="${iid}"]`);
}
/* 工具条整条比纸还宽时（对象贴在纸边）横向推回来，别被纸裁掉 */
function fitObjBar(w) {
  if (!w) return;
  const bar = w.querySelector('.objbar'); if (!bar) return;
  bar.style.setProperty('--ob-x', '0px');
  const paper = w.closest('.paper'); if (!paper) return;
  const pr = paper.getBoundingClientRect(), br = bar.getBoundingClientRect();
  if (!pr.width || !br.width) return;
  let dx = 0;
  if (br.left < pr.left + 6) dx = pr.left + 6 - br.left;
  else if (br.right > pr.right - 6) dx = pr.right - 6 - br.right;
  if (dx) bar.style.setProperty('--ob-x', dx.toFixed(1) + 'px');
}
/* 对象贴着纸的上沿时，工具条改挂到下方 */
function syncBar(w, im) {
  if (!w || !im) return;
  w.classList.toggle('bar-below', (im.y ?? 0) < .13);
  const b = w.querySelector('.objbar .ob[data-ob="edit"]');
  if (b && w.classList.contains('pimg-wrap')) {
    b.classList.toggle('on', !!im.fill);
    b.title = im.fill ? '还原原比例' : '铺满整页';
  }
}
function syncTextBar() {
  if (!selText) { setEditBar(false); shSyncHist(); return; }
  const t = textById(selText.pid, selText.iid);
  if (!t) { setEditBar(false); return; }
  setEditBar(true);
  shSync();
}
/* 底栏切换：行内编辑文字时隐藏页码与翻页按钮 */
function setEditBar(on) {
  const rbot = $('.rbot'); if (!rbot) return;
  rbot.classList.toggle('editing', !!on);
  if (window.__syncBotBar) setTimeout(window.__syncBotBar, 30);   // 底栏跟着输入法抬 / 落
}
function showTextBar(w, pid, iid) {
  closeScrub();
  selText = { pid, iid };
  if (w) { w.classList.add('adjust'); syncBar(w, textById(pid, iid)); fitObjBar(w); }
  syncTextBar();
}
function hideTextBar() {
  closeTextSheet(false);
  selText = null;
  setEditBar(false);
  updateEflow();
}
/* ==================== 编辑文字面板 ==================== */
const sh = {
  open: false, tab: 'font', pid: null, iid: null,
  hist: [], pos: -1, lastPush: 0, lastKind: ''
};
function shCur() { return sh.open ? textById(sh.pid, sh.iid) : null; }
/* 面板要记的字段 */
function shSnap(t) {
  return {
    text: t.text || '', size: +(t.size || 5.5), color: t.color || '#2b2f3d', bg: t.bg || '',
    align: t.align || 'left', bold: !!t.bold, italic: !!t.italic,
    underline: !!t.underline, strike: !!t.strike,
    font: normFont(t.font), fontEn: normEnFont(t.fontEn)
  };
}
/* 撤销栈：存的是「改动之后」的状态；连续打字（800ms 内）合并成一步 */
function shPush(kind) {
  const t = shCur(); if (!t) return;
  const now = Date.now();
  const snap = shSnap(t);
  if (kind === 'text' && sh.pos >= 0 && sh.lastKind === 'text' && now - sh.lastPush < 800) {
    sh.hist[sh.pos] = snap; sh.lastPush = now; return;
  }
  sh.hist = sh.hist.slice(0, sh.pos + 1);
  sh.hist.push(snap);
  if (sh.hist.length > 80) sh.hist.shift();
  sh.pos = sh.hist.length - 1;
  sh.lastPush = now; sh.lastKind = kind;
  shSyncHist();
}
function shSyncHist() {
  const u = $('#efUndo'), r = $('#efRedo');
  if (!u || !r) return;
  const on = sh.open && sh.hist.length > 1;
  u.disabled = !on || sh.pos <= 0;
  r.disabled = !on || sh.pos >= sh.hist.length - 1;
}
function shUndo(dir) {
  const t = shCur(); if (!t) return;
  const np = sh.pos + dir;
  if (np < 0 || np >= sh.hist.length) return;
  sh.pos = np;
  const s = sh.hist[np];
  Object.assign(t, s);
  sh.lastKind = '';                         // 撤销之后就别再往这一步里合并打字了
  save();
  shPaint();
}
/* 把当前文字画回纸面：样式、正文、框高一起跟 */
function shPaint() {
  const t = shCur(); if (!t) return;
  const w = textWrap(sh.iid);
  if (w) {
    const el = w.querySelector('.ptxt');
    if (el) {
      const has = !!(t.text || '').trim();
      el.className = 'ptxt' + (has ? '' : ' placeholder');
      el.setAttribute('style', textStyle(t));
      el.textContent = has ? t.text : '双击编辑文字';
      fitTextHeight(w, el, false);
    }
    syncBar(w, t);
    fitObjBar(w);
  }
  shSync();
}
/* 面板界面跟上当前文字：选中态、滑块、开关全刷一遍 */
function shSync() {
  const t = shCur(); if (!t) return;
  const inp = $('#tsInput');
  if (inp && document.activeElement !== inp) { inp.value = t.text || ''; shGrowInput(); }
  const cn = normFont(t.font), en = normEnFont(t.fontEn);
  $$('#tsFonts button').forEach(b => b.classList.toggle('on', b.dataset.f === cn));
  $$('#tsEnFonts button').forEach(b => b.classList.toggle('on', b.dataset.ef === en));
  /* 颜色：不在预设里的色值就点亮「自定义」那颗，并把它染成当前色 */
  const cur = t.color || '#2b2f3d';
  $$('#tsColors button[data-c]').forEach(b => {
    if (b.dataset.c === '__custom') {
      const std = TEXT_COLORS.includes(cur);
      b.classList.toggle('on', !std);
      b.style.background = std ? '' : cur;
    } else b.classList.toggle('on', b.dataset.c === cur);
  });
  const bg = t.bg || '';
  $$('#tsBgs button[data-bg]').forEach(b => {
    if (b.dataset.bg === '__custom') {
      const std = TEXT_BGS.includes(bg);
      b.classList.toggle('on', !std && !!bg);
      b.style.background = (std || !bg) ? '' : bg;
    } else b.classList.toggle('on', b.dataset.bg === bg);
  });
  const size = +(t.size || 5.5);
  const rg = $('#tsSize');
  if (rg && document.activeElement !== rg) rg.value = size;
  const sv = $('#tsSizeVal');
  if (sv) sv.textContent = (size / 100 * (state.pw || PAGE_W_DEFAULT)).toFixed(1) + 'px';
  $$('#tsSizes button').forEach(b => b.classList.toggle('on', Math.abs(+b.dataset.s - size) < .05));
  const fmt = { bold: !!t.bold, italic: !!t.italic, underline: !!t.underline, strike: !!t.strike };
  $$('#tsFmt button').forEach(b => b.classList.toggle('on', !!fmt[b.dataset.fmt]));
  $$('#tsAlignRow button').forEach(b => b.classList.toggle('on', b.dataset.align === (t.align || 'left')));
  shSyncHist();
}
/* 面板开关时：顶栏 / 底栏让位，面板高度记到 #reader 上供排版避让。
   「本页底色」弹窗（#bgsheet）借同一套编辑态，只是它没有撤销栈，把撤销 / 重做收起来 */
function updateEflow() {
  const reader = $('#reader'); if (!reader) return;
  const inline = !!$('.ptext-wrap.editing');
  const on = sh.open || inline || !!window.__bgSheetOpen;
  reader.classList.toggle('eflow', on);
  const top = $('#eflowTop');
  if (top) top.hidden = !on;
  const hist = $('#efHist');
  if (hist) hist.hidden = !sh.open;               // 只有文字面板才有撤销 / 重做
  if (!sh.open && !window.__bgSheetOpen) { window.__sheetCov = 0; reader.style.setProperty('--stage-shift', '0px'); }
  shSyncHist();
}
/* 面板压住了下半截纸：量出重叠高度，书排版时避开、并整体上移一半 */
function sheetLayout() {
  const reader = $('#reader'), stage = $('#stage');
  const ts = $('#tsheet'), bs = $('#bgsheet');
  const sheet = (ts && !ts.hidden) ? ts : ((bs && !bs.hidden) ? bs : null);
  if (!reader || !stage || !sheet || sheet.hidden) {
    window.__sheetCov = 0;
    if (reader) reader.style.setProperty('--stage-shift', '0px');
    return 0;
  }
  const sr = stage.getBoundingClientRect(), hr = sheet.getBoundingClientRect();
  const cov = Math.max(0, Math.round(sr.bottom - hr.top + 4));
  window.__sheetCov = cov;
  reader.style.setProperty('--sheet-h', cov + 'px');
  reader.style.setProperty('--stage-shift', (-cov / 2).toFixed(1) + 'px');
  return cov;
}
function shGrowInput() {
  const el = $('#tsInput'); if (!el) return;
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight || 0, 124) + 'px';
}
/* 输入法弹起：整块面板抬到键盘上方，并把高度收到可见范围里 */
function shKb() {
  const sheet = $('#tsheet');
  if (!sheet || sheet.hidden) return;
  const reader = $('#reader');
  const kb = (window.__kbHeight ? window.__kbHeight() : 0);
  if (kb > 4) {
    sheet.style.transform = `translateY(${-kb}px)`;
    sheet.style.maxHeight = Math.max(220, Math.round(reader.clientHeight - kb - 10)) + 'px';
  } else {
    sheet.style.transform = '';
    sheet.style.maxHeight = '';
  }
}
function openTextSheet(pid, iid, focus) {
  const t = textById(pid, iid); if (!t) return;
  commitTextEdit();                       // 正在行内打字的话先落盘，两种编辑不并存
  sh.open = true; sh.pid = pid; sh.iid = iid;
  sh.hist = [shSnap(t)]; sh.pos = 0; sh.lastPush = 0; sh.lastKind = '';
  selText = { pid, iid };
  t.locked = false; save();               // 编辑期间保持可选中态（框一直挂着）
  const w = textWrap(iid);
  if (w) { w.classList.remove('locked'); w.classList.add('adjust'); syncBar(w, t); fitObjBar(w); }
  const sheet = $('#tsheet');
  sheet.hidden = false;
  shTab('font'); shSync();
  updateEflow();
  requestAnimationFrame(() => { sheetLayout(); layoutBook(); });
  setTimeout(() => { sheetLayout(); layoutBook(); }, 340);   // 展开动画走完再量一次
  if (focus) setTimeout(() => { const i = $('#tsInput'); if (i) { i.focus(); shGrowInput(); } }, 60);
  syncTextBar();
}
function closeTextSheet(commit) {
  if (!sh.open) return;
  sh.open = false;
  const t = textById(sh.pid, sh.iid);
  const w = textWrap(sh.iid);
  const inp = $('#tsInput');
  if (t && commit && inp) t.text = (inp.value || '').replace(/[\r\n]+$/, '');
  if (t) {
    t.locked = true;                      // 编辑完默认固定，免得随手一碰就把字挪走
    if (w) {
      const el = w.querySelector('.ptxt');
      const has = !!(t.text || '').trim();
      if (el) { el.textContent = has ? t.text : '双击编辑文字'; el.className = 'ptxt' + (has ? '' : ' placeholder'); fitTextHeight(w, el, false); }
    }
  }
  save();
  const sheet = $('#tsheet');
  if (sheet) { sheet.hidden = true; sheet.style.transform = ''; sheet.style.maxHeight = ''; }
  /* 记一下收面板的时刻：紧接着那一下点击只是「关面板」，不该顺手把页翻过去 */
  markFlipSuppressed();
  sh.hist = []; sh.pos = -1; sh.pid = null; sh.iid = null;
  window.__sheetCov = 0;
  const reader = $('#reader');
  if (reader) { reader.style.setProperty('--stage-shift', '0px'); }
  updateEflow();
  if (window.__syncTypeShift) window.__syncTypeShift();
  if (window.__syncBotBar) window.__syncBotBar();
  renderReader();
}
/* ---- 面板：一次建好，之后只切选中态 ---- */
function shTab(name) {
  sh.tab = name || 'font';
  $$('#tsTabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === sh.tab));
  $$('#tsPanes .ts-pane').forEach(p => p.classList.toggle('on', p.dataset.pane === sh.tab));
}
function buildSheet() {
  const tabs = $('#tsTabs');
  if (!tabs) return;
  tabs.addEventListener('click', e => {
    const b = e.target.closest('button[data-tab]'); if (!b) return;
    shTab(b.dataset.tab);
  });
  /* 中文字体：每档用自己那套字族显示，点之前就看得出写出来是什么样 */
  $('#tsFonts').innerHTML = TEXT_FONTS.map(f =>
    `<button data-f="${f.k}" title="${f.n}" style="font-family:${f.css || 'inherit'}">${f.abbr}</button>`).join('');
  $('#tsEnFonts').innerHTML = EN_FONTS.map(f =>
    `<button data-ef="${f.k}" title="${f.n}" style="${f.css ? 'font-family:' + f.css : ''}">${f.n}</button>`).join('');
  $('#tsColors').innerHTML = TEXT_COLORS.map(c =>
    `<button data-c="${c}" style="background:${c}" title="${c}"></button>`).join('')
    + '<button class="custom" data-c="__custom" title="自定义颜色"></button>';
  $('#tsBgs').innerHTML = TEXT_BGS.map(c => c
    ? `<button data-bg="${c}" style="background:${c}" title="${c}"></button>`
    : '<button class="none" data-bg="" title="不加高亮"></button>').join('')
    + '<button class="custom" data-bg="__custom" title="自定义高亮"></button>';
  $('#tsSizes').innerHTML = TS_SIZES.map(s => `<button data-s="${s.v}">${s.n}</button>`).join('');
  $('#tsFmt').innerHTML = [['bold', 'B', 'fx', '加粗'], ['italic', 'I', 'fi', '斜体'],
    ['underline', 'U', 'fu', '下划线'], ['strike', 'S', 'fs', '删除线']]
    .map(([k, txt, cls, title]) => `<button class="${cls}" data-fmt="${k}" title="${title}">${txt}</button>`).join('');
  $('#tsAlignRow').innerHTML = TS_ALIGN.map(a =>
    `<button data-align="${a}" title="对齐：${TS_ALIGN_TXT[a]}">${alignSVG(a)}</button>`).join('');

  /* ---- 一处改动统一走这里：改数据 → 存盘 → 画回纸面 → 记一步撤销 ---- */
  const act = (fn, kind) => {
    const t = shCur(); if (!t) return;
    fn(t);
    save();
    shPaint();
    shPush(kind);
  };
  /* 面板上的按钮都吃 pointerdown：比 click 跟手，也不会被底下页面把手势抢走 */
  const bind = (sel, fn) => {
    const box = $(sel); if (!box) return;
    box.addEventListener('pointerdown', e => {
      const b = e.target.closest('button'); if (!b) return;
      e.preventDefault(); e.stopPropagation();
      fn(b);
    });
  };
  bind('#tsFonts', b => act(t => { t.font = b.dataset.f; }, 'font'));
  bind('#tsEnFonts', b => act(t => { t.fontEn = b.dataset.ef; }, 'font'));
  bind('#tsFmt', b => act(t => { t[b.dataset.fmt] = !t[b.dataset.fmt]; }, 'fmt'));
  bind('#tsAlignRow', b => act(t => { t.align = b.dataset.align; }, 'align'));
  bind('#tsSizes', b => act(t => { t.size = +b.dataset.s; }, 'size'));
  bind('#tsColors', b => {
    if (b.dataset.c !== '__custom') { act(t => { t.color = b.dataset.c; }, 'color'); return; }
    const cur = shCur(); if (!cur) return;
    openColorPicker('文字颜色', cur.color || '', hex => act(t => { t.color = hex; }, 'color'));
  });
  bind('#tsBgs', b => {
    if (b.dataset.bg !== '__custom') { act(t => { t.bg = b.dataset.bg; }, 'bg'); return; }
    const cur = shCur(); if (!cur) return;
    openColorPicker('文字高亮', cur.bg || '', hex => act(t => { t.bg = hex; }, 'bg'));
  });
  /* 字号滑块：拖着走就实时跟，松手才算一步（走 'text' 之外的 kind，不合并） */
  const rg = $('#tsSize');
  if (rg) rg.addEventListener('input', () => {
    const t = shCur();
    if (!t) return;
    t.size = +rg.value;
    $('#tsSizeVal').textContent = (t.size / 100 * (state.pw || PAGE_W_DEFAULT)).toFixed(1) + 'px';
    save(); shPaint();
  });
  if (rg) rg.addEventListener('change', () => { const t = shCur(); if (t) shPush('size'); });
  /* 正文输入：边打边画回纸面，800ms 内的连续输入合并成一步撤销 */
  const inp = $('#tsInput');
  inp.addEventListener('input', () => {
    const t = shCur(); if (!t) return;
    t.text = inp.value;
    save();
    shGrowInput();
    shPaint();
    shPush('text');
  });
  inp.addEventListener('focus', () => setTimeout(shKb, 60));
  inp.addEventListener('blur', () => setTimeout(shKb, 120));
  inp.addEventListener('keydown', e => e.stopPropagation());   // 打字别触发翻页快捷键
  /* 右上角「完成」：底色面板开着就是「按完成落盘」，文字面板开着收面板，行内打字中就结束输入 */
  $('#efOk').onclick = () => {
    if (window.__bgOk) { window.__bgOk(); return; }
    if (sh.open) { closeTextSheet(true); return; }
    const w = $('.ptext-wrap.editing');
    if (w) stopTextEdit(w, true); else hideTextBar();
  };
  $('#efUndo').onclick = () => shUndo(-1);
  $('#efRedo').onclick = () => shUndo(1);
}
buildSheet();
/* ==================== 行内编辑（双击直接打字） ==================== */
/* 把光标放到「手指点的那个字」上，而不是一律跳到末尾 —— 改中间某个字时不用再挪半天。
   两种浏览器的接口不一样，都试一遍；定位不到就退回末尾 */
function caretRangeAt(el, x, y) {
  try {
    if (document.caretRangeFromPoint) {
      const r = document.caretRangeFromPoint(x, y);
      if (r && el.contains(r.startContainer)) return r;
    }
    if (document.caretPositionFromPoint) {
      const p = document.caretPositionFromPoint(x, y);
      if (p && el.contains(p.offsetNode)) {
        const r = document.createRange(); r.setStart(p.offsetNode, p.offset); r.collapse(true); return r;
      }
    }
  } catch (_) {}
  return null;
}
/* 内容真正的高度：临时把 height 放开成 auto 再读布局高度。
   两个坑（都踩过）：
   ① 不能读 scrollHeight —— 它是「max(框高, 内容高)」，内容没顶满框时量到的就是框高，
      配合下面的「+余量」就成了正反馈：每输入一次 +几 px，框一路长下去停不下来
      （旋转过的框原先用 scrollHeight 兜底，正是这个毛病：打一下长一下）。
   ② 不能用 Range.getBoundingClientRect —— 它量的是「文字的字体外框」而不是行盒，
      一行只有 line-height 的七成，多行就更少，框会一直比内容矮、最后一行被裁掉；
      转过角度时它量的是旋转后的外接框，会虚高一大截。
   offsetHeight 是布局高度，不受 transform 影响 —— 旋转多少度都量得准 */
function textContentH(el) {
  if (!el) return 0;
  const prev = el.style.height;
  el.style.height = 'auto';
  const h = el.offsetHeight;                 // 同步读一次布局，紧接着就还原，不会闪
  el.style.height = prev;
  return h || 0;
}
/* 把框高对齐到内容：growOnly 时只长不缩，否则两头都收（打字时也收紧，删字才不会留空白） */
function fitTextHeight(w, el, growOnly) {
  /* 落盘认框自己的 data-page / data-id：面板开着时 selText 可能是空的 */
  const t = (selText ? textById(selText.pid, selText.iid) : null)
    || textById(+w.dataset.page, w.dataset.id);
  if (!t || !el) return;
  const pageEl = w.closest('.paper'); if (!pageEl) return;
  const pr = pageEl.getBoundingClientRect();
  /* 用 offset* 而不是 getBoundingClientRect：后者量的是「转过之后的外接框」，
     文字一旋转就会比实际高出一大截，框会被越撑越大 */
  const wh = w.offsetHeight, wt = w.offsetTop;
  if (!pr.height || !wh) return;
  const lh = (parseFloat(getComputedStyle(el).lineHeight) || parseFloat(getComputedStyle(el).fontSize) * 1.42);
  const need = Math.max(textContentH(el) + 2, lh);         // 至少留一行，空框也不会塌成一条线
  const cur = wh;
  const maxH = pr.height - Math.max(0, wt);                // 不许越过纸的下边缘
  if (growOnly) { if (need <= cur) return; }               // 还没顶到框底：不动
  const nh = clamp(need, lh, Math.max(lh, maxH));
  if (Math.abs(nh - cur) < 1.5) return;
  t.h = clamp(nh / pr.height, .02, 1);
  w.style.height = (t.h * 100).toFixed(2) + '%';
  if (window.__syncTypeShift) window.__syncTypeShift();    // 框变高了，重新算要不要再抬一点
}
function startTextEdit(w, pid, iid, pt) {
  if (sh.open) return;                    // 面板开着的时候，改字走面板
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
  /* 光标落在双击的那个字上（pt 是那一下的坐标）；定位不到或空框就落到末尾 */
  let placed = false;
  if (pt && t.text) {
    const r = caretRangeAt(el, pt.x, pt.y);
    if (r) {
      try {
        const s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
        placed = true;
      } catch (_) {}
    }
  }
  if (!placed) {
    try {
      const r = document.createRange(); r.selectNodeContents(el); r.collapse(false);
      const s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
    } catch (_) {}
  }
  el.addEventListener('blur', () => stopTextEdit(w, true), { once: true });
  el.addEventListener('keydown', ev => {
    ev.stopPropagation();                       // 打字时不要触发翻页快捷键
    if (ev.key === 'Escape') { ev.preventDefault(); el.blur(); }
  });
  /* 打字时框跟着内容走：长了跟着长，删掉几行也跟着收回去。
     内容高度现在是「放开 height 后实量的」，不会自己越长越大，所以两头都收是安全的 */
  w.__onInput = () => fitTextHeight(w, el, false);
  el.addEventListener('input', w.__onInput);
  // 点纸面空白处不会触发 contentEditable 的 blur，得自己兜住
  // 编辑面板上的按键自己会保住焦点，不能在这里先提交掉
  w.__docDown = ev => {
    if (w.contains(ev.target)) return;
    if (ev.target.closest && ev.target.closest('.rbot, #tsheet, #bgsheet, #eflowTop, #addMenu, #confirmMask, .cp-mask')) return;
    /* 直接去点另一个文本框：先存下这个，但不要整页重绘 ——
       重绘会把那边刚按下的第一下吃掉，双击就进不去了 */
    const other = ev.target.closest && ev.target.closest('.ptext-wrap');
    if (other && other !== w) { stopTextEdit(w, true, true); return; }
    stopTextEdit(w, true);
  };
  document.addEventListener('pointerdown', w.__docDown, true);
  updateEflow();
  syncTextBar();
  if (window.__syncTypeShift) requestAnimationFrame(window.__syncTypeShift);
}
function stopTextEdit(w, commit, noRender) {
  if (!w || !w.__editing) return;               // 已结束：避免 blur / 点击重复提交
  w.__editing = false;
  if (w.__docDown) { document.removeEventListener('pointerdown', w.__docDown, true); w.__docDown = null; }
  const el = w.querySelector('.ptxt');
  if (el && w.__onInput) { el.removeEventListener('input', w.__onInput); w.__onInput = null; }
  w.classList.remove('editing', 'adjust', 'sel');
  w.classList.add('locked');                       // 编辑完文字默认自动固定
  if (el) {
    el.contentEditable = 'false';
    /* 收尾时把框收紧到内容高度：删掉几行后不会留一大块空白 */
    if (commit) fitTextHeight(w, el, false);
  } else { hideTextBar(); return; }
  if (commit) {
    /* 落盘认框自己的 data-page / data-id，不认 selText ——
       点纸面空白处时「取消选中」会先把 selText 清掉，只看它这里就白打字了 */
    const t = textById(+w.dataset.page, w.dataset.id)
      || (selText ? textById(selText.pid, selText.iid) : null);
    if (t) { t.text = (el.innerText || '').replace(/[\r\n]+$/, ''); t.locked = true; }
    markFlipSuppressed();          // 结束行内打字的这一下，同样不该顺手翻页
    save();
  }
  if (!noRender && w.isConnected) renderReader();
  hideTextBar();                          // 退出输入：底栏恢复页码与翻页
  if (window.__syncTypeShift) window.__syncTypeShift();   // 撤掉为输入法让位的抬升
  $$('.pimg-wrap,.ptext-wrap').forEach(x => x.classList.remove('sel', 'adjust'));
}
/* 翻页 / 关闭前先落盘正在编辑的文字 */
function commitTextEdit() {
  const w = document.querySelector('.ptext-wrap.editing');
  if (w) stopTextEdit(w, true, true);
}
