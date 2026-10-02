/* =====================================================================
 * Carnet · 手帐本编辑器 · 新建 / 编辑弹窗   （脚本 19 / 24）
 * ---------------------------------------------------------------------
 * ① 名称、封面底色、封面图案与图案色、封面图片、彩带色、内页模板、页数
 * ② 每一项都是一块折叠小节 .fold-sec，收起时标题后跟当前取值 ED_SEC_HINT
 * ③ 图案颜色未选图案时整栏收起；页数只在新建时给填（编辑时整块隐藏）
 *
 * 对外接口：openEditor, closeEditor, syncEditor
 *
 * 依赖模块：core, visuals, state, widgets
 *
 * 说明：模块间共用全局作用域，加载顺序即依赖顺序（见 index.html 与 README）。
 * ===================================================================== */
/* ==================== 编辑器 ==================== */
const ed = { temp: null, isNew: true, fold: {} };
/* 折叠小节收起时，标题后面补一句当前取值（省得反复展开确认）。
   key 就是 .fold-sec 上的 data-sec，见 index.html 里的编辑器 */
const ED_SEC_HINT = {
  name:  () => ($('#edName').value || '').trim(),
  cover: () => ed.temp.cover.img ? '已上传图片'
    : /gradient|^url\(/i.test(String(ed.temp.cover.value || '')) ? '渐变'
    : String(ed.temp.cover.value || '').toUpperCase(),
  /* 图案：有封面图片时这一档会被锁死收起，提示语另有说法（见 syncEditor） */
  pattern: () => (PATTERNS.find(p => p.k === normPat(ed.temp.cover.pattern)) || PATTERNS[0]).n,
  image:  () => ed.temp.cover.img ? '已上传' : '',
  ribbon: () => ed.temp.ribbon === RIBBON_NONE ? '透明（不显示）' : String(ed.temp.ribbon || '').toUpperCase(),
  template: () => (TEMPLATES.find(t => t.k === ed.temp.template) || TEMPLATES[0]).n,
  pages:  () => ed.temp.pages.length + ' 页'
};
/* 唯一被锁死的小节：用了封面图片，图案压在照片上不起作用，整段强制收起、点了也不展开 */
function edSecLocked(key) { return key === 'pattern' && !!ed.temp.cover.img; }
function openEditor(journal) {
  ed.isNew = !journal;
  ed.temp = journal ? JSON.parse(JSON.stringify(journal)) : newJournal();
  $('#edTitle').textContent = ed.isNew ? '新建手帐本' : '编辑手帐本';
  $('#edName').value = ed.temp.name;
  $('#edPages').value = ed.temp.pages.length;
  buildEditor();
  syncEditor();
  $('#mask').classList.add('show');
  $('#modal').scrollTop = 0;          // 每次打开都从最上面开始
  $('#mask').scrollTop = 0;
}
function closeEditor() { $('#mask').classList.remove('show'); }
/* 自定义「＋」色块直接追加到该组色块的末尾（同排显示，色值提示紧跟其后） */
function appendCustomChip(boxSel, id, tipId, title) {
  const box = $(boxSel); if (!box) return;
  box.insertAdjacentHTML('beforeend',
    `<div class="swatch custom" id="${id}" title="${title}"><span class="cus-ico">＋</span></div>`
    + `<span class="cus-tip" id="${tipId}">自定义</span>`);
}
$('#mask').addEventListener('click', e => { if (e.target === $('#mask')) closeEditor(); });
function buildEditor() {
  $('#edColors').innerHTML = COLORS.map(c =>
    `<div class="swatch" data-color="${c}" style="background:${c}"></div>`).join('');
  $('#edGrads').innerHTML = GRADS.map(g =>
    `<div class="swatch grad" data-grad="${g}" style="background:${g}"></div>`).join('');
  /* 彩带第一格是「透明」——选中后封面左侧的书脊整条不画 */
  $('#edRibbons').innerHTML =
    `<div class="swatch ribbon-none" data-ribbon="${RIBBON_NONE}" title="透明（不显示彩带）"></div>`
    + RIBBONS.map(c => `<div class="swatch" data-ribbon="${c}" style="background:${c}"></div>`).join('');
  $('#edPatterns').innerHTML = PATTERNS.map(p => `
    <div class="pat" data-pat="${p.k}" title="${p.n}">
      <i class="pspine"></i><div class="pv"></div><span>${p.n}</span>
    </div>`).join('');
  $('#edTemplates').innerHTML = TEMPLATES.map(t =>
    `<div class="tpl" data-tpl="${t.k}" title="${t.n}" style="background:#fffdf8">
      <div class="tplbg" style="position:absolute;inset:0;${tplStyle(t.k)}"></div><span>${t.n}</span></div>`).join('');
  // 绑定
  $$('#edColors .swatch:not(.custom)').forEach(s => s.onclick = () => { ed.temp.cover.value = s.dataset.color; ed.temp.cover.img = null; ed.temp.cover.type = 'solid'; syncEditor(); });
  $$('#edGrads .swatch:not(.custom)').forEach(s => s.onclick = () => { ed.temp.cover.value = s.dataset.grad; ed.temp.cover.img = null; ed.temp.cover.type = 'gradient'; syncEditor(); });
  $$('#edRibbons .swatch:not(.custom)').forEach(s => s.onclick = () => { ed.temp.ribbon = s.dataset.ribbon; syncEditor(); });
  /* 自定义「＋」色块：直接接在预设色块后面，不再单起一行
     （封面底色的自定义跟在「纯色」那组后面；渐变是另一组，不挂它） */
  appendCustomChip('#edColors', 'edCoverCustom', 'edCoverTip', '自定义封面底色');
  appendCustomChip('#edRibbons', 'edRibbonCustom', 'edRibbonTip', '自定义彩带颜色');
  /* 自定义颜色：点 ＋ 打开取色盘，选好的颜色写进封面底色 / 彩带颜色 */
  $('#edCoverCustom').onclick = () => openColorPicker('自定义封面底色', ed.temp.cover.img ? '' : ed.temp.cover.value,
    hex => { ed.temp.cover.value = hex; ed.temp.cover.img = null; ed.temp.cover.type = 'solid'; syncEditor(); });
  $('#edRibbonCustom').onclick = () => openColorPicker('自定义彩带颜色', ed.temp.ribbon,
    hex => { ed.temp.ribbon = hex; syncEditor(); });
  $$('#edPatterns .pat').forEach(s => s.onclick = () => { ed.temp.cover.pattern = ed.temp.cover.pattern === s.dataset.pat ? 'none' : s.dataset.pat; syncEditor(); });
  /* 图案颜色：预设色块 + 「自动」重置；「＋」接在末尾，走自定义取色盘 */
  $('#edPatColors').innerHTML =
    `<div class="swatch pat-auto" data-patcolor="" title="自动（跟随底色深浅）">自动</div>` +
    PAT_COLORS.map(c => `<div class="swatch" data-patcolor="${c}" style="background:${c}"></div>`).join('');
  appendCustomChip('#edPatColors', 'edPatCustom', 'edPatTip', '自定义图案颜色');
  $$('#edPatColors .swatch:not(.custom)').forEach(s => s.onclick = () => {
    const v = s.dataset.patcolor || '';
    if (v) ed.temp.cover.patColor = v; else delete ed.temp.cover.patColor;
    syncEditor();
  });
  $('#edPatCustom').onclick = () => openColorPicker('自定义图案颜色', ed.temp.cover.patColor || '',
    hex => { ed.temp.cover.patColor = hex; syncEditor(); });
  $$('#edTemplates .tpl').forEach(s => s.onclick = () => { ed.temp.template = s.dataset.tpl; syncEditor(); });
  /* 注：这里没有「整本内页底色」——底色改成在阅读器里按页挑（#bgsheet）。
     数据里的 j.pageBg 仍然认（老本子、导入的本子照旧生效），只是不给入口了 */
  /* 每一项设置的标题都点得动：收起 / 展开整块内容（图案区在有封面图片时锁死） */
  $$('#modal .fold-sec').forEach(sec => {
    const key = sec.dataset.sec; if (!key) return;
    const head = sec.querySelector('.fold-head'); if (!head) return;
    head.onclick = () => {
      if (edSecLocked(key)) { toast('已上传封面图片，封面图案不可用'); return; }
      ed.fold[key] = !ed.fold[key]; syncEditor();
    };
  });
  $('#edUpload').onclick = () => $('#coverFile').click();
  $('#edClearImg').onclick = () => { ed.temp.cover.img = null; syncEditor(); };
  $('#edName').oninput = e => { ed.temp.name = e.target.value; };
  $('#edPages').oninput = e => { ed.temp.pagesN = clamp(parseInt(e.target.value) || 1, 1, 200); };
}
/* 自定义色块：选了自定义颜色就把它显示成那个颜色（彩虹「＋」作占位），
   没选自定义色时清掉内联底色，落回 CSS 里的彩虹取色盘样式 */
function syncCustomSwatch(boxSel, tipSel, value, presets) {
  const v = String(value || '').trim().toLowerCase();
  const hex = /^#[0-9a-f]{6}$/.test(v) ? v : '';
  const custom = !!hex && !presets.some(c => String(c).toLowerCase() === hex);
  const box = $(boxSel);
  box.classList.toggle('on', custom);
  box.style.background = custom ? hex : '';
  $(tipSel).textContent = custom ? hex.toUpperCase() : '自定义';
}
function syncEditor() {
  $('#edPreview').innerHTML = coverHTML(ed.temp);
  $$('#edColors .swatch:not(.custom)').forEach(s => s.classList.toggle('on', !ed.temp.cover.img && ed.temp.cover.value === s.dataset.color));
  $$('#edGrads .swatch:not(.custom)').forEach(s => s.classList.toggle('on', !ed.temp.cover.img && ed.temp.cover.value === s.dataset.grad));
  $$('#edRibbons .swatch').forEach(s => s.classList.toggle('on', ed.temp.ribbon === s.dataset.ribbon));
  /* 自定义色块：跟着当前颜色走，取到预设之外的颜色就高亮并给出色值 */
  syncCustomSwatch('#edCoverCustom', '#edCoverTip', ed.temp.cover.img ? '' : ed.temp.cover.value, COLORS);
  syncCustomSwatch('#edRibbonCustom', '#edRibbonTip', ed.temp.ribbon, RIBBONS);
  /* 图案颜色：没选图案时整栏收起，选了图案才展开（图案都没选，颜色无从谈起） */
  const patOn = ed.temp.cover.pattern && ed.temp.cover.pattern !== 'none';
  $('#edPatColorWrap').classList.toggle('fold', !patOn);
  {
    const pc = /^#[0-9a-fA-F]{6}$/i.test(String(ed.temp.cover.patColor || '')) ? ed.temp.cover.patColor.toLowerCase() : '';
    $$('#edPatColors .swatch:not(.custom)').forEach(s =>
      s.classList.toggle('on', (s.dataset.patcolor || '').toLowerCase() === pc));
    syncCustomSwatch('#edPatCustom', '#edPatTip', pc, PAT_COLORS);
  }
  const spineBg = ribbonSpine(ed.temp.ribbon);
  $$('#edPatterns .pat').forEach(s => {
    s.classList.toggle('on', ed.temp.cover.pattern === s.dataset.pat);
    const L = faceLayers(ed.temp.cover, s.dataset.pat);
    const pv = s.querySelector('.pv');
    pv.style.backgroundImage = L.image;
    pv.style.backgroundColor = L.color || '';
    pv.style.backgroundSize = L.size;
    pv.style.backgroundPosition = L.pos;
    pv.style.backgroundRepeat = L.rep;
    const sp = s.querySelector('.pspine');
    if (sp) {
      const none = ed.temp.ribbon === RIBBON_NONE;
      sp.style.background = spineBg || 'transparent';
      sp.classList.toggle('ghost', none);                    // 透明彩带：预览里留一道压痕
      sp.classList.toggle('hid', !spineBg && !none);
    }
  });
  $$('#edTemplates .tpl').forEach(s => s.classList.toggle('on', ed.temp.template === s.dataset.tpl));
  const hasImg = !!ed.temp.cover.img;
  $('#edThumb').style.display = hasImg ? 'block' : 'none';
  $('#edThumb').style.backgroundImage = hasImg ? `url(${ed.temp.cover.img})` : '';
  $('#edClearImg').style.display = hasImg ? 'block' : 'none';
  /* 页数只有新建时才给填：编辑已有本子时页数由「加页 / 删本页」管，这里改会整本截断 */
  const ps = $('#edSecPages'); if (ps) ps.classList.toggle('gone', !ed.isNew);
  /* 折叠小节：统一刷新收起 / 展开，收起时把当前取值写在标题后面 */
  $$('#modal .fold-sec').forEach(sec => {
    const key = sec.dataset.sec; if (!key) return;
    const locked = edSecLocked(key);
    const folded = locked || !!ed.fold[key];
    sec.classList.toggle('folded', folded);
    const hint = sec.querySelector('.fold-hint');
    if (!hint) return;
    hint.textContent = !folded ? ''
      : (locked ? '已用封面图片，图案不可用' : (ED_SEC_HINT[key] || (() => ''))());
  });
}
$('#edCancel').onclick = closeEditor;
$('#edSave').onclick = () => {
  const t = ed.temp;
  t.name = ($('#edName').value || '').trim() || '未命名手帐';
  /* 页数只在新建时生效（编辑时那一栏是藏起来的，别拿它的旧值去截断本子） */
  if (ed.isNew) {
    const want = clamp(parseInt($('#edPages').value) || t.pages.length, 1, 200);
    if (want > t.pages.length) while (t.pages.length < want) t.pages.push({ images: [], texts: [] });
    else if (want < t.pages.length) t.pages = t.pages.slice(0, want);
  }
  if (ed.isNew) { state.journals.push(t); state.sel = state.journals.length - 1; }
  else { state.journals[state.sel] = t; }
  save(); closeEditor(); renderHome(); renderReader();
  toast(ed.isNew ? '手帐本已创建' : '已保存修改');
};

