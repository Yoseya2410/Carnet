/* =====================================================================
 * Carnet · 手帐本编辑器 · 新建 / 编辑弹窗   （脚本 23 / 28）
 * ---------------------------------------------------------------------
 * ① 名称、封面底色、封面图案与图案色、封面图片、彩带色、内页模板、页数
 * ② 每一项都是一块折叠小节 .fold-sec，收起时标题后跟当前取值 ED_SEC_HINT
 * ③ 图案颜色未选图案时整栏收起；页数只在新建时给填（编辑时整块隐藏）
 * ④ 内页模板：六档内置纸面 + 每张自定义图片各占一格 + 末尾「＋添加」（可一次选多张）。
 *    图存 ed.temp.tplImgs 素材库，选中的那张写进 ed.temp.tplImg（唯一样式源）；
 *    cover / stretch / tile 三种铺法与屏幕、导出共用 visuals.js 的 tplStyle
 * ⑤ 封面图案栏最后一格是「DIY 封面」：跳到独立全屏页面 #diyPage，
 *    纸面对象与阅读器同款（images / texts + x/y/w/h/z/rot），复用 imgWrapHTML / textWrapHTML /
 *    objBarHTML / newText / nextZ / applyBox 与贴纸库；完成时合成成 cover.img，草稿存 cover.diym
 *
 * 对外接口：openEditor, closeEditor, syncEditor, openDiyCover, closeDiyCover, normDiyCover
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
  /* 装帧样式：笔记本 / 活页手帐 / 方形画册 */
  style: () => (BOOK_STYLES.find(s => s.k === normBookStyle(ed.temp.style)) || BOOK_STYLES[0]).n,
  cover: () => ed.temp.cover.img ? '已上传图片'
    : /gradient|^url\(/i.test(String(ed.temp.cover.value || '')) ? '渐变'
    : String(ed.temp.cover.value || '').toUpperCase(),
  /* 封面圆角：没设过就走这一档装帧的默认度数，设过才存进 cover.radius */
  radius: () => (ed.temp.cover.radius == null ? '默认' : '自定义')
    + ' · ' + coverRadiusOf(ed.temp).toFixed(0) + 'px',
  /* 图案：普通上传封面会被锁死收起（提示语另有说法）；DIY 封面本身就是从这栏进去的，不锁 */
  pattern: () => (ed.temp.cover.diym && ed.temp.cover.img ? '自定义封面'
    : (PATTERNS.find(p => p.k === normPat(ed.temp.cover.pattern)) || PATTERNS[0]).n),
  image:  () => ed.temp.cover.img ? (ed.temp.cover.diym ? '自定义封面' : '已上传') : '',
  ribbon: () => ribbonIsNone(ed.temp.ribbon) ? '透明 · 隐藏彩带与书槽'
    : String(ribbonSpine(ed.temp.ribbon) || '').toUpperCase()
      + (coverGrooveOn(ed.temp) ? '' : ' · 书槽关'),
  /* 活页封面内侧：缺省 auto = 自动取封面主色 */
  inside: () => ({ auto: '封面主色', match: '与封面一致', custom: '自定义' })[insideModeOf(ed.temp)],
  template: () => {
    const base = (TEMPLATES.find(t => t.k === ed.temp.template) || TEMPLATES[0]).n;
    const n = tplTileImgs().length;
    return base === '自定义图片' && n ? `自定义图片 · ${n} 张` : base;
  },
  pages:  () => ed.temp.pages.length + ' 页',
  /* 加密：折叠时一眼看出这本有没有上锁、用的是哪种密钥 */
  lock: () => !journalHasLock(ed.temp) ? '未加密'
    : '已加密 · ' + (ed.temp.lock.mode === 'question' ? '保密问题' : '直接输密码')
};
/* 唯一被锁死的小节：用了**普通上传**的封面图片，图案压在照片上不起作用，整段强制收起。
   DIY 封面也是 cover.img，但它正是从图案栏进去的 —— 不锁，用户还得回来改 / 切回内置图案 */
function edSecLocked(key) { return key === 'pattern' && !!ed.temp.cover.img && !ed.temp.cover.diym; }
function openEditor(journal) {
  /* 加密本未解锁时先解密（编辑要读整本内容，不能拿空壳来改），解开后照用户意图重开编辑器。
     ⚠️ 解锁后的落地动作按**入口**分流，全靠各调用方自己的 done，守卫里不改道：
        点封面 → openReader() 的 done = 打开手帐本；
        点编辑按钮（封面齿轮 / 单层书架长按）→ 这里的 done = 打开「编辑手帐本」弹窗。
        所以未解锁的书点编辑按钮、输完密码后就要进编辑弹窗，静默解锁时同样如此。 */
  if (journal && !guardUnlocked(journal, () => openEditor(cur()))) return;
  ed.isNew = !journal;
  ed.temp = journal ? JSON.parse(JSON.stringify(journal)) : newJournal();
  /* 非法色值回落默认彩带色；'none' 是合法的「透明」档，别把它归一化掉
     （色板要有选中态、预览封面要整列不画，点「完成」后原样写回数据） */
  ed.temp.ribbon = ribbonIsNone(ed.temp.ribbon) ? RIBBON_NONE : ribbonSpine(ed.temp.ribbon);
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
/* ---- 内页模板栏 ----
   六档内置纸面 + 每一张自定义图片模板各占一格 + 最后一格「＋添加」。
   图片来自两处：① 这本手帐自带的 ed.temp.tplImgs（随源文件导出）；
                ② 全局模板库 tplLib（添加时立刻写盘，任何本子 / 下次打开都能接着用）。
   当前选中那张仍是 ed.temp.tplImg —— 那是 tplStyle / 纸面 / PDF 导出唯一认的样式源，
   别让下游改读数组。渲染 / 选中 / 删除全走 tplTileImgs() 这一份合并列表。
   ⚠️ 只在建面板 / 增删图片时重建 DOM；syncEditor 每次只改选中态，别反复解析大 base64。 */
function tplTileImgs() {
  const out = [];
  for (const s of tplImgsOf(ed.temp).concat(tplLibImgs())) {
    if (s && !out.includes(s) && out.length < TPL_IMGS_MAX) out.push(s);
  }
  return out;
}
function renderTplTiles() {
  const box = $('#edTemplates'); if (!box) return;
  const imgs = tplTileImgs();
  const fit = normTplFit(ed.temp.tplFit);
  box.innerHTML = TEMPLATES.filter(t => t.k !== 'custom').map(t =>
    `<div class="tpl" data-tpl="${t.k}" title="${t.n}" style="background:#fffdf8">
      <div class="tplbg" style="position:absolute;inset:0;${tplStyle(t.k)}"></div><span>${t.n}</span></div>`).join('')
    + imgs.map((src, i) =>
      `<div class="tpl tpl-img" data-tpl-img="${i}" title="自定义图片模板 ${i + 1}">
         <div class="tplbg" style="position:absolute;inset:0;${tplStyle('custom', { tplImg: src, tplFit: fit })}"></div>
         <i class="tpl-del" data-tpl-del="${i}" title="移除这张模板">×</i><span>模板 ${i + 1}</span></div>`).join('')
    + `<div class="tpl tpl-add" data-tpl="add" title="添加图片模板（可多选）">
         <i class="tpl-plus">＋</i><span>添加</span></div>`;
  syncTplTiles();
}
/* 选中态 / 缩略图铺法 / 铺法按钮 / 说明跟着 ed.temp 走 */
function syncTplTiles() {
  const imgs = tplTileImgs();
  const cur = tplImgOf(ed.temp);
  $$('#edTemplates .tpl').forEach(s => {
    const i = s.dataset.tplImg;
    const on = i === undefined
      ? (s.dataset.tpl !== 'add' && ed.temp.template === s.dataset.tpl && ed.temp.template !== 'custom')
      : (ed.temp.template === 'custom' && imgs[Number(i)] === cur);
    s.classList.toggle('on', on);
    if (i !== undefined) {
      const bg = s.querySelector('.tplbg');
      if (bg) bg.style.cssText = 'position:absolute;inset:0;'
        + tplStyle('custom', { tplImg: imgs[Number(i)], tplFit: normTplFit(ed.temp.tplFit) });
    }
  });
  const fitBox = $('#edTplFit');
  if (fitBox) fitBox.classList.toggle('fold', !imgs.length);
  $$('#edTplFit button').forEach(b => b.classList.toggle('on', normTplFit(ed.temp.tplFit) === b.dataset.fit));
  const note = $('#edTplNote');
  if (note) note.textContent = imgs.length
    ? `已有 ${imgs.length} 张图片模板：点格子切换、点右上角 × 从模板库移除。模板存进本机模板库，下次打开或新建手帐本都能接着用，也会随这本一起导出。`
    : '点「＋」添加图片模板，可一次选多张；添加后立刻存进模板库，下次打开或新建手帐本都能继续用。';
}
function buildEditor() {
  /* 装帧样式：每张卡里各放一个真封面（按各自的装订方式渲染），选样式时看到的就是成品 */
  $('#edStyles').innerHTML = BOOK_STYLES.map(s => `
    <div class="sty" data-sty="${s.k}" title="${s.d}">
      <div class="sty-pv">${coverHTML({ ...ed.temp, style: s.k })}</div>
      <div class="sty-n">${s.n}</div>
      <div class="sty-d">${s.d}</div>
    </div>`).join('');
  $$('#edStyles .sty').forEach(s => s.onclick = () => {
    if (ed.temp.style === s.dataset.sty) return;
    ed.temp.style = normBookStyle(s.dataset.sty);
    syncEditor();
    if (ed.temp.style === 'square') toast('方形画册：封面和内页都变成 1:1 方开本');
    /* 离开「笔记本」才提：彩带那一小节会收起来，免得用户以为设置丢了 */
    if (!bookHasRibbon(ed.temp)) toast('这一档装帧没有封面彩带，颜色设置已暂时收起');
  });
  $('#edColors').innerHTML = COLORS.map(c =>
    `<div class="swatch" data-color="${c}" style="background:${c}"></div>`).join('');
  $('#edGrads').innerHTML = GRADS.map(g =>
    `<div class="swatch grad" data-grad="${g}" style="background:${g}"></div>`).join('');
  /* 彩带第一格是「透明」：选中后封面左侧整列都不画 —— 彩带隐藏，也不补压槽。
     后面 12 格是预设纯色，末格 ＋ 自定义取色。 */
  $('#edRibbons').innerHTML =
    `<div class="swatch ribbon-none" data-ribbon="${RIBBON_NONE}" title="透明（隐藏彩带，也不画书槽）"></div>`
    + RIBBONS.map(c => `<div class="swatch" data-ribbon="${c}" style="background:${c}"></div>`).join('');
  /* 内置图案格 + 最后一格「自定义」。DIY 格不带 data-pat，所有按 data-pat 走的
     绑定 / 同步都要用 :not(.diy-pat) 排除它，别把合成图预览刷成图案层。
     没做过封面时这一格是「白纸 + 中间一个＋」，标签写「自定义」；
     做好之后 .has-img 换成合成图当缩略图，＋ 收起来。 */
  $('#edPatterns').innerHTML = PATTERNS.map(p => `
    <div class="pat" data-pat="${p.k}" title="${p.n}">
      <i class="pspine"></i><div class="pv"></div><span>${p.n}</span>
    </div>`).join('')
    + `<div class="pat diy-pat" data-diy="1" title="自定义封面：加图片、文字、改底色">
         <div class="pv" id="edDiyPv"></div><i class="pat-plus" id="edDiyPlus">＋</i><span>自定义</span>
       </div>`;
  /* 六档内置纸面 + 每张自定义图片模板 + 添加格，见 renderTplTiles() */
  renderTplTiles();
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
  /* 透明档不是色值，取色盘初值给空，别把 'none' 塞进 HSV 换算 */
  $('#edRibbonCustom').onclick = () => openColorPicker('自定义彩带颜色',
    /^#/.test(ed.temp.ribbon) ? ed.temp.ribbon : '',
    hex => { ed.temp.ribbon = hex; syncEditor(); });
  $$('#edPatterns .pat:not(.diy-pat)').forEach(s => s.onclick = () => {
    /* 从 DIY 封面切回内置图案：撤掉合成图（否则图案压不上去、点了像没反应），
       草稿 cover.diym 留着，随时能点 DIY 格回画板接着改 */
    if (ed.temp.cover.img && ed.temp.cover.diym) delete ed.temp.cover.img;
    ed.temp.cover.pattern = ed.temp.cover.pattern === s.dataset.pat ? 'none' : s.dataset.pat;
    syncEditor();
  });
  $('#edPatterns .diy-pat').onclick = () => openDiyCover();
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
  /* 模板格：事件委托到整块网格。图片格 / 添加格 / × 移除各自分开处理。
     用 onxxx 赋值而不是 addEventListener：编辑器每开一次都会 buildEditor，别叠监听 */
  $('#edTemplates').onclick = async e => {
    const del = e.target.closest('[data-tpl-del]');
    if (del) {
      const imgs = tplTileImgs();
      const src = imgs[Number(del.dataset.tplDel)];
      if (src) {
        /* ⚠️ 剩余列表直接用过滤后的数组算，别再调 tplImgsOf：那个函数会把
           「当前 tplImg 不在库里」当成老数据兜底并回列表，删掉的图会当场复活。
           本子里的原始数组也直接过滤，同样是怕兜底逻辑把删掉的图并回来。 */
        const left = imgs.filter(x => x !== src);
        const own = Array.isArray(ed.temp.tplImgs) ? ed.temp.tplImgs : [];
        ed.temp.tplImgs = own.filter(x => x !== src);
        await dropTplLib(src);                 // 全局素材库里也一并移除并落盘，下次别再冒出来
        /* 删掉的正好是当前模板：切到剩下第一张，没了就落回空白 */
        if (tplImgOf(ed.temp) === src) {
          if (left.length) { ed.temp.tplImg = left[0]; ed.temp.template = 'custom'; }
          else { ed.temp.tplImg = ''; ed.temp.template = 'blank'; }
        }
        renderTplTiles(); syncEditor();
        toast('已移除这张模板 · 模板库同步删除');
      }
      return;
    }
    const s = e.target.closest('.tpl'); if (!s) return;
    if (s.dataset.tpl === 'add') { $('#tplFile').click(); return; }
    if (s.dataset.tplImg !== undefined) {
      const src = tplTileImgs()[Number(s.dataset.tplImg)];
      if (!src) return;
      /* 从全局模板库挑的图：顺手写进这本的 tplImgs，源文件 / PDF 导出仍带着它 */
      if (!Array.isArray(ed.temp.tplImgs)) ed.temp.tplImgs = [];
      if (!ed.temp.tplImgs.includes(src)) ed.temp.tplImgs.push(src);
      ed.temp.tplImg = src; ed.temp.template = 'custom'; syncEditor(); return;
    }
    ed.temp.template = s.dataset.tpl; syncEditor();
  };
  /* 铺法整本共用一套：改完 syncTplTiles 会把每个缩略图重新铺一遍 */
  $('#edTplFit').onclick = e => {
    const b = e.target.closest('button[data-fit]'); if (!b) return;
    ed.temp.tplFit = normTplFit(b.dataset.fit);
    syncEditor();
  };
  /* 一次可挑多张：逐张压缩 → 白名单校验 → 去重入库，最后一张直接设为当前模板。
     ⚠️ 走 readPickedFiles：移动端先把 File 同步读成 dataURL 再清 input，
        否则清空 value 会让底层 Blob 失效，解压那一步全军覆没。
     ⚠️ 新图同时写进全局模板库并**立刻落盘**：不用等编辑器「完成」，
        下次打开 / 新建一本 / 换一本都还能接着用。 */
  $('#tplFile').onchange = async e => {
    const files = await readPickedFiles(e);
    if (!files.length) return;
    const imgs = tplTileImgs();
    const fresh = [];
    let failed = 0, full = false;
    for (const s0 of files) {
      if (imgs.length + fresh.length >= TPL_IMGS_MAX) { full = true; break; }
      const src = await packTemplateImage(s0);
      /* tplImgOf 这道校验不能省：这串要塞进 style 和导出的 XHTML */
      if (!tplImgOf({ tplImg: src })) { failed++; continue; }
      if (imgs.includes(src) || fresh.includes(src)) continue;
      fresh.push(src);
    }
    if (!fresh.length) { toast(failed ? '这些图读不出来，换图片试试' : (full ? '图片模板已达上限' : '没有新图片')); return; }
    const own = Array.isArray(ed.temp.tplImgs) ? ed.temp.tplImgs.slice() : [];
    for (const s of fresh) if (!own.includes(s)) own.push(s);
    ed.temp.tplImgs = own.slice(0, TPL_IMGS_MAX);
    ed.temp.tplImg = fresh[fresh.length - 1];
    ed.temp.tplFit = normTplFit(ed.temp.tplFit);
    ed.temp.template = 'custom';
    await mergeTplLib(fresh);                 // 全局库立即写盘，不等「完成」
    renderTplTiles(); syncEditor();
    toast(`已添加 ${fresh.length} 张图片模板 · 已存进模板库` + (failed ? `，${failed} 张读不出来` : '') + (full ? '（已达上限）' : ''));
  };
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
  /* 封面翻口圆角：只写右侧两角，左侧书脊两角固定。没滑过就不往数据里写字段，
     让老本子 / 新建本子继续吃这一档装帧的默认度数（见 visuals.js 的 coverRadiusOf）。 */
  $('#edRadius').oninput = e => {
    ed.temp.cover.radius = clamp(parseInt(e.target.value, 10) || 0, COVER_R_MIN, COVER_R_MAX);
    syncEditor();
  };
  $('#edRadiusReset').onclick = () => {
    delete ed.temp.cover.radius;
    syncEditor();
    toast('已恢复这一档装帧的默认圆角');
  };
  /* ---- 活页封面内侧（内衬）：三档模式 + 自定义色板 / 内衬图 ---- */
  $('#edInsideColors').innerHTML = COLORS.map(c =>
    `<div class="swatch" data-incolor="${c}" style="background:${c}"></div>`).join('');
  appendCustomChip('#edInsideColors', 'edInsideCus', 'edInsideCusTip', '自定义内衬颜色');
  $('#edInsideModes').onclick = e => {
    const b = e.target.closest('button[data-inside]'); if (!b) return;
    edSetInside(v => { v.mode = normInsideMode(b.dataset.inside); });
  };
  /* 封面主色候选：点第几个就把 inside.pick 记成几，auto 模式按它取色 */
  $('#edInsidePalette').onclick = e => {
    const b = e.target.closest('button[data-pick]'); if (!b) return;
    edSetInside(v => { v.mode = 'auto'; v.pick = +b.dataset.pick; });
  };
  $('#edInsideColors').onclick = e => {
    const s = e.target.closest('.swatch:not(.custom)');
    if (s && s.dataset.incolor) {
      edSetInside(v => { v.mode = 'custom'; v.color = s.dataset.incolor; v.img = ''; });
      return;
    }
    if (e.target.closest('#edInsideCus')) {
      const cur0 = insideOf(ed.temp) || {};
      openColorPicker('自定义内衬颜色', cur0.img ? '' : (cur0.color || ''),
        hex => edSetInside(v => { v.mode = 'custom'; v.color = hex; v.img = ''; }));
    }
  };
  $('#edInsideUpload').onclick = () => $('#edInsideFile').click();
  $('#edInsideFile').onchange = async e => {
    const [f] = await readPickedFiles(e);
    if (!f) return;
    /* 跟自定义内页模板同一套压缩 + 白名单校验：这串要塞进 style 属性，
       只认 base64 位图 dataURL，别让外链 / svg 文本混进来 */
    const src = await packTemplateImage(f);
    if (!tplImgOf({ tplImg: src })) { toast('这张图读不出来，换一张试试'); return; }
    edSetInside(v => { v.mode = 'custom'; v.img = src; v.color = ''; });
    toast('已设为封面内衬');
  };
  $('#edInsideClearImg').onclick = () => {
    edSetInside(v => { v.mode = 'custom'; v.img = ''; });
    toast('已移除内衬图片');
  };
  /* 书槽「显示 / 隐藏」按钮已按用户要求移除（2026-11-12）：书槽跟着彩带档位走，
     不再单独给开关。cover.groove 的读取仍保留，只为让老本子里显式设过 false 的数据
     照旧生效，新本子不再写这个字段。 */
  $('#edUpload').onclick = () => $('#coverFile').click();
  $('#edClearImg').onclick = () => { ed.temp.cover.img = null; syncEditor(); };
  $('#edName').oninput = e => { ed.temp.name = e.target.value; };
  $('#edPages').oninput = e => { ed.temp.pagesN = clamp(parseInt(e.target.value) || 1, 1, 200); };
}
/* 改封面内侧的字段：没设过就先建一份草稿，别把 mode 丢失（缺省 auto 不写进数据，
   一旦用户动过这个小节就落一份完整的 inside 对象） */
function edSetInside(fn) {
  const cv = ed.temp.cover;
  if (!cv.inside || typeof cv.inside !== 'object') cv.inside = { mode: 'custom', color: '', img: '' };
  fn(cv.inside);
  syncEditor();
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
  /* 圆角滑杆跟着当前本子走：切换装帧时默认档会变（精装 10 / 活页 16），
     没自定义过就只显示数值、禁用「默认」按钮，不往数据里写东西。 */
  {
    const r = Math.round(coverRadiusOf(ed.temp));
    const s = $('#edRadius'), v = $('#edRadiusVal'), btn = $('#edRadiusReset');
    if (s) s.value = String(r);
    if (v) v.textContent = r + 'px';
    if (btn) btn.disabled = ed.temp.cover.radius == null;
  }
  /* 装帧样式：卡片里的封面预览要跟着当前底色 / 图案 / 彩带一起变，所以整块重画 */
  $$('#edStyles .sty').forEach(s => {
    s.classList.toggle('on', normBookStyle(ed.temp.style) === s.dataset.sty);
    const pv = s.querySelector('.sty-pv');
    if (pv) pv.innerHTML = coverHTML({ ...ed.temp, style: s.dataset.sty });
  });
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
  /* 图案缩略图左侧那一列必须跟真封面同源（coverHTML）：
     有彩带（笔记本且不是透明档）→ 平色彩带；透明 / 书槽关 → 整列不画（不补压槽）；
     没彩带的装帧（方形画册 / 精装书）→ 压槽；活页 → 整列不画。
     ⚠️ 别只看 ribbon 值：画册 / 精装书 / 活页的数据里也留着颜色值，
        直接拿它画会变成「真封面是书槽、缩略图却是彩带」。 */
  const hasRb = bookHasRibbon(ed.temp);
  const spineBg = hasRb ? ribbonSpine(ed.temp.ribbon) : '';
  const noSpine = coverNoSpine(ed.temp) || isRingStyle(ed.temp.style);
  /* 缩略图看的是「底色 + 这一档图案」，不该被已经上传 / 合成的封面图盖掉：
     传一份去掉 img 的 cover 副本，DIY 封面在场上时下面这排仍能正常挑图案。 */
  const cvPv = { ...ed.temp.cover, img: null };
  const isDiy = !!ed.temp.cover.img && !!ed.temp.cover.diym;
  $$('#edPatterns .pat:not(.diy-pat)').forEach(s => {
    s.classList.toggle('on', !isDiy && ed.temp.cover.pattern === s.dataset.pat);
    /* 第三参数 true = 预览档：缩略图统一用自动色，真实封面仍走各自的预设色 */
    const L = faceLayers(cvPv, s.dataset.pat, true);
    const pv = s.querySelector('.pv');
    pv.style.backgroundImage = L.image;
    pv.style.backgroundColor = L.color || '';
    pv.style.backgroundSize = L.size;
    pv.style.backgroundPosition = L.pos;
    pv.style.backgroundRepeat = L.rep;
    const sp = s.querySelector('.pspine');
    if (sp) {
      /* 只有「没彩带的装帧」走压槽断面；笔记本透明档直接整列收掉，
         别留那道 .ghost 压痕（用户明确要「透明时没有书槽」） */
      sp.style.background = spineBg || 'transparent';
      sp.classList.toggle('ghost', !spineBg && !noSpine);
      /* 透明 / 书槽关 / 活页（真封面本来就不画那一列）时整列收掉，跟真实封面保持一致 */
      sp.classList.toggle('hid', noSpine);
    }
  });
  /* DIY 格：没做过就是空白纸＋中间一个「＋」；做过就拿合成好的封面图当缩略图（成品的样子） */
  {
    const dp = $('#edPatterns .diy-pat');
    if (dp) {
      dp.classList.toggle('on', isDiy);
      dp.classList.toggle('has-img', !!ed.temp.cover.img);
      const pv = dp.querySelector('.pv');
      pv.style.backgroundImage = ed.temp.cover.img ? `url("${ed.temp.cover.img}")` : '';
      pv.style.backgroundSize = 'cover';
      pv.style.backgroundPosition = 'center';
      pv.style.backgroundRepeat = 'no-repeat';
    }
  }
  /* 模板栏：选中态 / 每张缩略图的铺法 / 铺法按钮 / 说明一起跟 ed.temp 走 */
  syncTplTiles();
  const hasImg = !!ed.temp.cover.img;
  $('#edThumb').style.display = hasImg ? 'block' : 'none';
  $('#edThumb').style.backgroundImage = hasImg ? `url(${ed.temp.cover.img})` : '';
  $('#edClearImg').style.display = hasImg ? 'block' : 'none';
  /* 页数只有新建时才给填：编辑已有本子时页数由「加页 / 删本页」管，这里改会整本截断 */
  const ps = $('#edSecPages'); if (ps) ps.classList.toggle('gone', !ed.isNew);
  /* 封面彩带只有「笔记本」这一档有（bookHasRibbon）：
     活页有金属环、画册是方开本，都不画彩带 —— 整小节收起，省得挑了没反应的颜色 */
  const rs = $('#edSecRibbon');
  if (rs) {
    const noRb = !bookHasRibbon(ed.temp);
    rs.classList.toggle('gone', noRb);
    const head = $('#edRibbonHead');
    if (head) head.title = noRb ? '只有「笔记本」装帧才有封面彩带' : '';
  }
  /* ---- 活页封面内侧：整小节只在活页装帧露出来 ---- */
  if ($('#edInsideColors')) {
    const sec = $('#edSecInside');
    if (sec) sec.classList.toggle('gone', !bookStyleOf(ed.temp).rings);
    const mode = insideModeOf(ed.temp), ins = insideOf(ed.temp) || {};
    $$('#edInsideModes button').forEach(b => b.classList.toggle('on', b.dataset.inside === mode));
    const cbox = $('#edInsideCustomBox'); if (cbox) cbox.classList.toggle('fold', mode !== 'custom');
    /* 预览吃的是阅读器同一份 coverInsideStyle()，主色算出来后会自动重绘一次 */
    const st = coverInsideStyle(ed.temp), pv = $('#edInsidePv');
    if (pv) pv.innerHTML = `<div style="position:absolute;inset:0;${st.bg}"></div>`
      + (st.pat ? `<div style="position:absolute;inset:0;${st.pat}"></div>` : '');
    /* auto 模式列出从封面提取的候选主色（最多五个），点一个即切换内衬 */
    const pal = $('#edInsidePalette');
    if (pal) {
      pal.classList.toggle('fold', mode !== 'auto');
      if (mode === 'auto') {
        const list = st.palette || [];
        pal.innerHTML = list.length
          ? list.map((c, i) => `<button data-pick="${i}" class="${i === (st.pick || 0) ? 'on' : ''}"`
              + ` style="background:${c}" title="主色 ${i + 1} · ${c}"></button>`).join('')
            + `<span class="tip">从封面提取的 ${list.length} 个主色，点一个用作内衬</span>`
          : `<span class="tip">正在提取封面主色…</span>`;
      }
    }
    const hasImg = isImgData(ins.img);
    $$('#edInsideColors .swatch:not(.custom)').forEach(s =>
      s.classList.toggle('on', !hasImg && normHex6(ins.color) === s.dataset.incolor));
    syncCustomSwatch('#edInsideCus', '#edInsideCusTip', hasImg ? '' : ins.color, COLORS);
    const th = $('#edInsideThumb');
    if (th) {
      th.style.display = hasImg ? 'block' : 'none';
      th.style.backgroundImage = hasImg ? `url("${ins.img}")` : '';
    }
    const clr = $('#edInsideClearImg'), upl = $('#edInsideUpload');
    if (clr) clr.style.display = hasImg ? 'block' : 'none';
    if (upl) upl.textContent = hasImg ? '更换图片' : '选择内衬图片';
  }
  /* 加密与密钥：状态卡跟着当前本子走。管理面板会先把编辑器保存并关掉，
     所以这一节只负责显示，不直接改 ed.temp 的 lock。 */
  {
    const box = $('#edLockState');
    if (box) {
      const has = journalHasLock(ed.temp);
      box.classList.toggle('on', has);
      const label = has ? '已加密 · ' + (ed.temp.lock.mode === 'question' ? '保密问题' : '直接输密码') : '未加密';
      const sub = has
        ? (lockRemembered(ed.temp) ? '这台设备已记住密钥，打开时自动解密' : '这台设备未记住密钥，打开时需要输入')
        : '内容与导出的源文件都是明文';
      box.innerHTML = `<span class="lk-state-ico">${LOCK_SVG}</span><div><b>${label}</b><small>${sub}</small></div>`;
    }
  }
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
/* 「设置 / 管理密钥…」：先把编辑器里的改动落盘并关掉弹窗，再去管 state 里那一本。
   ⚠️ 不能直接在 ed.temp 上改 lock —— ed.temp 是深拷贝，用户再点一次「完成」
      就会用没有（或旧）lock 的副本把刚设置好的密钥覆盖掉。 */
$('#edLockManage').onclick = () => {
  $('#edSave').click();
  openLockPanel(cur());
};

/* =====================================================================
 * 自定义封面 · 独立全屏页面（DIY Cover）
 * ---------------------------------------------------------------------
 * 与 #home / #reader 平级的 #diyPage，从编辑器「封面图案」栏的 DIY 格进入。
 * 纸面上的图片 / 文字 / 贴纸**就是阅读器那一页的对象**：
 *   cover.diym = { bg, images:[…], texts:[…] }
 *   · 字段、坐标（占纸比例）、z 上下层、rot 全跟 pg.images / pg.texts 一样
 *   · 渲染直接调 imgWrapHTML / textWrapHTML / objBarHTML / rotHandleHTML
 *   · 新建文字用 newText()、上下层用 nextZ()、盒子样式用 applyBox() / applyRot()
 *   · 图片边框复用 FRAMES / frameBoxStyle / frameImgStyle
 *   · 贴纸素材与贴纸库复用 stickers.js（便利贴 / 装饰胶带 / 我的贴纸）
 *   · 文字面板复用 TEXT_COLORS / TEXT_BGS / TEXT_FONTS / EN_FONTS（中英双轨字体）
 * 「完成」把纸面合成成一张封面图写进 cover.img：主页 / 阅读器 / PDF / 长图 /
 * 源文件导出本来就有「有封面图就铺图」这条路，所以那些渲染点一个字节都不用改。
 * ⚠️ 合成走 SVG foreignObject，那是独立文档、读不到本页 CSS，所以导出版必须全内联
 *    （diyExportHTML），且 <img> 要自闭合 />，否则整份 XHTML 解析失败。
 * ===================================================================== */
const DIY_MAX_OBJS = 40;
/* 刚加进来的文字：第一次收面板先不锁，抬手就能拖走（阅读器 FRESH_TEXT_IDS 同款） */
const DIY_FRESH_TEXTS = new Set();
const diy = {
  open: false, d: null, sel: null,          // sel = { k:'img'|'txt', id }
  sheet: '',                               // '' | bg | text | sticker | layer | frame
  /* 画布外壳跟着装帧走：比例 ratio（coverRatioOf）、圆角、左侧装订那一列的样子。
     装帧在编辑器里选，DIY 打开时读一次；DIY 页面内不改装帧。 */
  style: BOOK_STYLE_DEFAULT,
  stTab: 'note', ratio: PAGE_RATIO, W: 300, H: 426,
  drag: null, swapId: null,
  /* 纸面每次 pointerup 都会重绘 #diyContent，原生 dblclick 拿不到连续两次同一节点，
     所以自己按「对象 id + 时间 + 位移」判双击 */
  tap: { t: 0, id: '', x: 0, y: 0 },
  /* 文字贴两态，跟阅读器 page-edit.js 完全一致：
     · 双击 → 内容态 .editing（纸面 contentEditable 直接打字，手柄全收、拖不动）
     · 长按 420ms / 已解锁 → 版式态 .boxmode（移动 + 四角缩放 + 旋转）
     box 只活在本次选中里；editing 是正在行内打字的那条 id（null = 没在打字） */
  box: false, editing: null, caretPt: null, hold: null, stopping: false,
  textId: null,                                // 文字面板对应哪条文字（关面板时选中可能已被清掉）
  sideW: 0, sideDrag: null,                // 侧栏宽度（横屏）与拖动手势
  layerDrag: null, layerJustDragged: 0     // 图层拖拽排序 / 抑制拖完那一下 click
};
function diyBgOK(v) {
  const s = String(v || '').trim();
  if (/^#[0-9a-fA-F]{6}$/.test(s)) return s.toLowerCase();
  if (/^(linear|radial|conic)-gradient\([^"'<>;]{1,260}\)$/.test(s)) return s;
  return COLORS[0];
}
/* 草稿清洗：导入文件 / 老数据都过这一道。
   上一轮的 items 草稿（{type:'img'|'txt'}）在这里换算成阅读器同款对象，老封面不会白掉。 */
function normDiyCover(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const n = (v, def, lo, hi) => {
    const x = Number(v);
    return Number.isFinite(x) ? clamp(x, lo, hi) : def;
  };
  const base = o => ({
    id: String(o.id || uid()),
    x: n(o.x, .1, -.5, 1.5), y: n(o.y, .1, -.5, 1.5),
    w: n(o.w, .4, .04, 1.6), h: n(o.h, .12, .03, 1.6),
    rot: n(o.rot, 0, -180, 180), z: n(o.z, 0, 0, 999),
    name: diyNameOK(o.name)              // 图层重命名：空串 = 没改过，回退默认名
  });
  /* 「铺满整页 / 还原原比例」要能在草稿里来回切：fill / fit / pv 都得跟着存档走。
     丢了 fit 的话，重开画板时 .pimg-wrap 只有 .fill（object-fit:contain）会露出白边，
     而导出一直是 fill —— 画布与成品就不一致了。 */
  const pvOK = v => {
    if (!v || typeof v !== 'object') return null;
    const q = (k, d) => { const x = Number(v[k]); return Number.isFinite(x) ? clamp(x, -.5, 1.6) : d; };
    return { x: q('x', .2), y: q('y', .2), w: q('w', .42), h: q('h', .42) };
  };
  const images = [], texts = [];
  if (Array.isArray(raw.images) || Array.isArray(raw.texts)) {
    (raw.images || []).slice(0, DIY_MAX_OBJS).forEach(o => {
      if (!o || !isImgData(o.src)) return;
      images.push({ ...base(o), src: o.src, locked: false,
        fr: FRAMES.some(f => f.k === o.fr) ? o.fr : 'none',
        frc: normHex6(o.frc), frw: n(o.frw, 50, 1, 100),
        fill: !!o.fill, fit: n(o.fit, 0, 0, 999), pv: pvOK(o.pv) });
    });
    (raw.texts || []).slice(0, DIY_MAX_OBJS).forEach(o => {
      if (!o || typeof o !== 'object') return;
      const t = newText();
      texts.push({ ...t, ...base(o), text: String(o.text || '').slice(0, 300),
        size: n(o.size, 5.5, TS_SIZE_MIN, TS_SIZE_MAX), color: normHex6(o.color) || '#2b2f3d',
        font: normFont(o.font), fontEn: normEnFont(o.fontEn),
        align: ['left', 'center', 'right'].includes(o.align) ? o.align : 'left',
        bold: !!o.bold, italic: !!o.italic, underline: !!o.underline, strike: !!o.strike,
        bg: normHex6(o.bg), note: normHex6(o.note),
        /* 贴合文字框的三个量：ww = 折行宽度上限（用户拖四角改的就是它）、
           autoW = 是否自动贴宽、fitV = 贴合算法版本。丢了 ww 的话，重开画板会把
           「已经收紧到文字宽度」当成新的行宽上限，长段落再也长不回去。 */
        ww: n(o.ww, 0, 0, 1.6), autoW: o.autoW !== false, fitV: n(o.fitV, 0, 0, 999),
        /* 跟阅读器一致：改完字就固定住，单击不动、双击才进内容编辑、长按才解锁搬动 */
        locked: o.locked === false ? false : true });
    });
  } else if (Array.isArray(raw.items)) {
    raw.items.slice(0, DIY_MAX_OBJS).forEach(o => {
      if (!o || typeof o !== 'object') return;
      if (o.type === 'img' && isImgData(o.src)) {
        images.push({ ...base(o), src: o.src, locked: false, fr: 'none', frc: '', frw: 50 });
      } else if (o.type === 'txt') {
        const t = newText();
        texts.push({ ...t, ...base(o), text: String(o.text || '').slice(0, 300),
          size: n(o.size, .09, .022, .3) * 100, color: normHex6(o.color) || '#2b2f3d',
          font: o.font === 'serif' ? 'song' : 'plain', bold: !!o.bold, locked: false });
      }
    });
  } else return null;
  return { bg: diyBgOK(raw.bg), images, texts };
}
/* ---- 图层名 ----
   老草稿 / 没改过名的对象用「图片 1」「文字 2」这种带序号的默认名，彼此能区分；
   用户双击改过的名字存在 o.name 里，随 cover.diym 一起进草稿与导出。
   ⚠️ 默认名不写进数据：否则插入 / 删除图层后序号会变成错的陈旧值。 */
function diyNameOK(v) {
  return String(v == null ? '' : v).replace(/[\r\n\t]+/g, ' ').trim().slice(0, 24);
}
function diyObjById(id) {
  return (diy.d.images.find(x => x.id === id) || diy.d.texts.find(x => x.id === id)) || null;
}
function diyLayerLabel(o, k) {
  const nm = diyNameOK(o.name);
  if (nm) return nm;
  const arr = k === 'img' ? diy.d.images : diy.d.texts;
  const i = arr.indexOf(o) + 1;
  const base = k === 'img' ? '图片' : (normHex6(o.note) ? '便利贴' : '文字');
  return base + ' ' + (i > 0 ? i : '?');
}
function diyLayerSub(o, k) {
  if (k === 'img') {
    if (o.fill) return '铺满封面';
    return String(o.src).startsWith('data:image/svg') ? '贴纸' : '图片 · ' + Math.round(o.w * 100) + '% 宽';
  }
  const s = String(o.text || '').replace(/\s+/g, ' ').trim();
  return normHex6(o.note) ? (s || '空白便利贴') : (s || '空文字框');
}
/* 没写内容的文字框不留草稿（便利贴本身是色块，空着也留）—— 跟阅读器 dropEmptyText 同语义 */
function diyDropEmptyText() {
  let n = 0;
  diy.d.texts = diy.d.texts.filter(t => {
    if (!String(t.text || '').trim() && !normHex6(t.note)) {
      n++; DIY_FRESH_TEXTS.delete(t.id);
      if (diy.editing === t.id) diy.editing = null;
      return false;
    }
    return true;
  });
  if (n && diy.sel && diy.sel.k === 'txt' && !diy.d.texts.some(t => t.id === diy.sel.id)) diy.sel = null;
  return n;
}
/* 一页里的图片与文字按 z 混排 —— 跟 reader-view.js 的 pageObjs 同一套 */
function diyObjs() {
  const a = [];
  diy.d.images.forEach(o => a.push({ k: 'img', o }));
  diy.d.texts.forEach(o => a.push({ k: 'txt', o }));
  a.sort((x, y) => (x.o.z || 0) - (y.o.z || 0));
  return a;
}
function diyRefOf(el) {
  if (!el) return null;
  const id = el.dataset.id;
  if (diy.d.images.some(x => x.id === id)) return { k: 'img', id };
  if (diy.d.texts.some(x => x.id === id)) return { k: 'txt', id };
  return null;
}
function diyObj(ref) {
  if (!ref) return null;
  const a = ref.k === 'img' ? diy.d.images : diy.d.texts;
  return a.find(x => x.id === ref.id) || null;
}
/* ---- 画布外壳：按装帧把「这是一张什么封面」画出来 ----
   比例 diy.ratio（coverRatioOf）、圆角（cover.radius 按画布宽折算）、左侧装订那一列
   全都跟着当前装帧走。⚠️ 这些装饰**只画在编辑器画布上**，绝不烘进
   diyExportHTML / cover.img：成品封面由 coverHTML() 自己叠那一列，烘进去会叠成两道。
   活页成品封面是干净的一张硬壳（环在里侧），所以画布也不画装订列。 */
function diyPaperSkin() {
  const p = $('#diyPaper');
  if (!p || !diy.open) return;
  const j = ed.temp;
  BOOK_STYLES.forEach(s => p.classList.remove('s-' + s.k));
  p.classList.add('s-' + diy.style);
  /* 笔记本默认画彩带书脊；选「透明」/ 书槽关时打 .no-spine 把这一列整条藏掉
     （不补压槽，跟 coverHTML / 导出封面同源）。
     no-ribbon 只留给画册 / 精装书 / 活页这些本来就没有彩带的装帧。 */
  const noRb = !bookHasRibbon(j);
  p.classList.toggle('no-ribbon', noRb);
  p.classList.toggle('no-spine', coverNoSpine(j));
  /* --cr 是主页 246px 宽封面上的 px；画布比它小，必须按 --cr-scale 同比缩 */
  p.style.setProperty('--cr', coverRadiusOf(j) + 'px');
  p.style.setProperty('--cr-left', diy.style === 'personal' ? '6px' : '3px');
  p.style.setProperty('--cr-scale', (diy.W / 246).toFixed(4));
  /* 用 ribbonSpine 而不是 j.ribbon：非法值回落默认色；'none' 返回空串，
     但那一列已被 .no-spine 藏掉，不会露出 CSS 变量里的兜底色 */
  p.style.setProperty('--diy-ribbon', (noRb || coverNoSpine(j)) ? '' : ribbonSpine(j.ribbon));
}
function diySizePaper() {
  const st = $('#diyStage').getBoundingClientRect();
  if (!st.width || !st.height) return;
  let H = Math.min(st.height - 24, 640), W = H / diy.ratio;
  if (W > st.width - 24) { W = st.width - 24; H = W * diy.ratio; }
  diy.W = Math.max(90, Math.round(W));
  diy.H = Math.round(diy.W * diy.ratio);
  const p = $('#diyPaper');
  p.style.width = diy.W + 'px';
  p.style.height = diy.H + 'px';
  diyPaperSkin();
}
/* ---- 横屏侧栏宽度：拖左边缘改变，记在 localStorage（纯 UI 偏好，不进手帐数据）---- */
const DIY_SIDE_KEY = 'carnet.diy.sideW';
function diySideMax() { return Math.max(190, Math.min(560, window.innerWidth - 200)); }
function diyApplySideW(v, final) {
  const w = clamp(Number(v) || 190, 190, diySideMax());
  diy.sideW = w;
  const pg = $('#diyPage');
  pg.style.setProperty('--diy-side-w', w + 'px');
  pg.style.setProperty('--diy-btn-cols', w >= 300 ? 3 : 2);   // 两组按钮列数一致
  /* 拖动过程中只量纸、不重建 #diyContent：对象坐标是百分比、字号挂在 --pw 上，
     CSS 变量一更新就自动跟着缩放；落定后再整体重绘一次收尾。 */
  diySizePaper();
  const p = $('#diyPaper');
  p.style.setProperty('--pw', diy.W + 'px');
  p.style.setProperty('--ph', diy.H + 'px');
  diyFitObjBars();                         // 纸变窄/变宽但没重建 DOM，工具条要重新挑位置
  if (final) {
    try { localStorage.setItem(DIY_SIDE_KEY, String(w)); } catch (_) {}
    renderDiyPaper();
  }
}
function diyRestoreSideW() {
  let w = 0;
  try { w = Number(localStorage.getItem(DIY_SIDE_KEY)) || 0; } catch (_) {}
  if (w) diyApplySideW(w, false);       // 没存过就用 CSS 里的 clamp 默认值
}
/* ---- 文字贴「内容态」：双击直接在纸面上打字（阅读器 startTextEdit / stopTextEdit 同款）----
   纸面别处一有动作就会 renderDiyPaper() 整块重建 #diyContent，所以这里是「可拆装」的：
   重建前 diyDetachInline() 把内容落进数据、摘掉监听；重建后 diyAttachInline() 挂回新节点。
   ⚠️ 打字过程中只同步数据，绝不重建纸面或面板（会闪、丢焦点、丢光标）。 */
function diyInlineWrap() {
  return diy.editing ? $(`#diyContent [data-id="${diy.editing}"]`) : null;
}
function diySyncInline() {
  if (!diy.editing) return;
  const w = diyInlineWrap(), el = w && w.querySelector('.ptxt');
  const o = diyObjById(diy.editing);
  if (el && o) o.text = (el.innerText || '').replace(/[\r\n]+$/, '');
}
function diyDetachInline() {
  const w = diyInlineWrap(); if (!w) return;
  diySyncInline();                                   // 先把刚敲的字落到数据里
  const el = w.querySelector('.ptxt');
  if (w.__fitQ) { w.__fitQ.cancel(); w.__fitQ = null; }   // 排队中的那一帧别落在旧节点上
  if (el) {
    /* ⚠️ 先摘 blur 监听再关 contentEditable：把可编辑关掉本身会触发 blur，
       留着监听就会在 detach 里递归 stop → 整页重绘，把刚按下的工具条按钮冲掉
       （表现为「点编辑文字没反应」）。 */
    if (w.__onBlur) { el.removeEventListener('blur', w.__onBlur); w.__onBlur = null; }
    if (w.__onInput) { el.removeEventListener('input', w.__onInput); w.__onInput = null; }
    if (w.__onKey) { el.removeEventListener('keydown', w.__onKey); w.__onKey = null; }
    el.contentEditable = 'false';
  }
  if (w.__docDown) { document.removeEventListener('pointerdown', w.__docDown, true); w.__docDown = null; }
  w.classList.remove('editing');
}
/* 把光标放到双击的那一个字上（空框就落到末尾）。单独抽出来，是因为浏览器在
   dblclick 之后还会默认选中一个词，得在下一轮事件里再落一次才压得住它。 */
function diyPlaceCaret(el, pt) {
  el.focus();
  let placed = false;
  if (pt && typeof caretRangeAt === 'function') {
    const r = caretRangeAt(el, pt.x, pt.y);
    if (r) { try { const s = window.getSelection(); s.removeAllRanges(); s.addRange(r); placed = true; } catch (_) {} }
  }
  if (!placed) {
    try {
      const r = document.createRange(); r.selectNodeContents(el); r.collapse(false);
      const s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
    } catch (_) {}
  }
}
function diyAttachInline(w, focus, pt) {
  const el = w && w.querySelector('.ptxt'); if (!el) return;
  w.classList.add('editing', 'adjust');
  w.classList.remove('boxmode', 'locked', 'sel');
  el.contentEditable = 'true'; el.spellcheck = false;
  /* 每敲一个字按帧贴一次框：字多了往下长、删掉几行收回去、折行跟着行宽上限走。
     只改这一条的宽高，绝不重建纸面（会打断输入、丢光标）。 */
  w.__fitQ = frameQueue(() => {
    if (!diy.editing || !w.isConnected) return;
    diyFitText(diy.editing);
    diyFitObjBar(w);
  });
  w.__onInput = () => {
    diySyncInline();
    const o = diyObjById(diy.editing);
    w.classList.toggle('empty', !(o && String(o.text || '').trim()));
    w.__fitQ.push();
  };
  el.addEventListener('input', w.__onInput);
  w.__onBlur = () => diyStopInline(true);
  el.addEventListener('blur', w.__onBlur);
  w.__onKey = ev => {
    ev.stopPropagation();                          // 打字不触发页面快捷键
    if (ev.key === 'Escape') { ev.preventDefault(); el.blur(); }
  };
  el.addEventListener('keydown', w.__onKey);
  /* contentEditable 的 blur 不会覆盖「点纸面空白处」，自己兜一层 */
  w.__docDown = ev => {
    if (ev.button > 0 || !diy.editing) return;
    if (w.contains(ev.target)) return;
    if (ev.target.closest && ev.target.closest('#diySheet,#diyBar,#diyTop,.cp-mask,.confirm-box,#confirmMask')) return;
    /* 直接点另一个对象：只落盘、不整页重绘，否则那边刚按下的第一下会被吃掉 */
    const other = ev.target.closest && ev.target.closest('.ptext-wrap,.pimg-wrap');
    if (other && other !== w) { diyStopInline(true, true); return; }
    diyStopInline(true);
  };
  document.addEventListener('pointerdown', w.__docDown, true);
  if (focus || pt) diyPlaceCaret(el, pt);
}
function diyStartInline(id, pt) {
  if (diy.editing === id) { const w = diyInlineWrap(); if (w) diyAttachInlineFocus(w); return; }
  if (diy.editing) diyStopInline(true, true);      // 先落盘上一条，两种编辑不并存
  const o = diyObjById(id); if (!o) return;
  if (diy.sheet === 'text') diySheet('');          // 面板与行内打字互斥（同阅读器 openTextSheet）
  diyCancelHold();
  o.locked = false;
  diy.sel = { k: 'txt', id }; diy.box = false;
  diy.editing = id; diy.caretPt = pt || null;
  renderDiyPaper();                                // 内部按 diy.editing 把编辑态挂到新节点上
  diy.caretPt = null;
  if (pt) setTimeout(() => {                      // 压住 dblclick 的默认「选中一个词」
    if (!diy.open || diy.editing !== id) return;
    const w = diyInlineWrap(), el = w && w.querySelector('.ptxt');
    if (el) diyPlaceCaret(el, pt);
  }, 0);
}
function diyAttachInlineFocus(w) {
  const el = w && w.querySelector('.ptxt');
  if (el) el.focus();
}
function diyStopInline(commit, noRender) {
  const id = diy.editing;
  if (!id || diy.stopping) return;                 // blur / 点击 / 收尾可能同时来，只认第一次
  diy.stopping = true;
  try {
    const w = diyInlineWrap();
    if (w) { if (commit) diySyncInline(); diyDetachInline(); }
    diy.editing = null; diy.caretPt = null;
    diy.tap = { t: 0, id: '', x: 0, y: 0 };       // 退出内容态后别留着旧的第一击
    diy.sel = null; diy.box = false;               // 跟阅读器 stopTextEdit 一样撤掉选中框
    const o = diyObjById(id);
    if (o) o.locked = true;                        // 编辑完自动固定，跟阅读器一致
    diyDropEmptyText();                           // 空文字框当作没添加过
    if (!noRender) renderDiyPaper();
  } finally { diy.stopping = false; }
}
/* ---- 文字框贴合内容 / 工具条避让 ----
   ⚠️ 两边都复用阅读器的现成算法，别在 DIY 里另写一套：
   · fitTextBox(w, el, false, o, paper) —— 宽高都按文字实量，长文折行、短句收紧，
     旋转 / 对齐钉边 / 空框占位 全都在里面；DIY 的纸叫 .diy-paper，所以把纸直接传进去。
   · fitObjBar(w, ctx) —— 在「挂上方 / 挂下方 / 塞进框内上 / 塞进框内下」四个候选里
     挑被纸边裁得最少的那个；传空的 obs（DIY 没有阅读器那些顶栏 / 页数轴遮挡）。 */
function diyFitText(id) {
  if (!diy.d || !id) return false;
  const w = $(`#diyContent [data-id="${id}"]`), o = diyObjById(id);
  if (!w || !o || !w.classList.contains('ptext-wrap')) return false;
  const el = w.querySelector('.ptxt');
  return el ? fitTextBox(w, el, false, o, $('#diyPaper')) : false;
}
function diyFitObjBar(w) {
  if (!w || !w.isConnected) return;
  const p = $('#diyPaper'); if (!p) return;
  try { fitObjBar(w, { pr: p.getBoundingClientRect(), obs: [] }); } catch (_) {}
}
function diyFitObjBars() {
  $$('#diyContent .pimg-wrap.sel, #diyContent .ptext-wrap.adjust, #diyContent .ptext-wrap.editing')
    .forEach(diyFitObjBar);
}
function diyFitAllTexts() {
  if (!diy.d) return;
  diy.d.texts.forEach(t => diyFitText(t.id));
  diyFitObjBars();                    // 框变了，工具条要跟着重新挑位置
}
/* 自带的四款英文字体是懒加载的：刚选完那一帧量到的还是回退字体的字宽，
   字体真正到位后再贴一次，否则文字框会按旧宽度把新字形裁掉（阅读器同款，
   text-sticker.js 的 loadingdone 监听）。行内打字中不插手，免得打断输入。 */
if (typeof document !== 'undefined' && document.fonts && document.fonts.addEventListener) {
  document.fonts.addEventListener('loadingdone', () => {
    if (!diy.open || diy.editing || !diy.d) return;
    diyFitAllTexts();
  });
}
/* 屏幕上的纸：直接用阅读器那两个渲染函数，工具条 / 手柄 / 选中框一并带出来 */
function renderDiyPaper() {
  const p = $('#diyPaper');
  p.style.setProperty('--pw', diy.W + 'px');
  p.style.setProperty('--ph', diy.H + 'px');
  diyPaperSkin();
  p.style.background = diy.d.bg;
  /* 行内打字中重建：先落内容 + 拆监听，重建完再挂回编辑态 */
  const editingId = diy.editing;
  let hadFocus = false;
  if (editingId) {
    const old = diyInlineWrap(), oe = old && old.querySelector('.ptxt');
    hadFocus = !!oe && document.activeElement === oe;
    diyDetachInline();                            // 保留 diy.editing
  }
  $('#diyContent').innerHTML = diyObjs().map(({ k, o }) =>
    k === 'img' ? imgWrapHTML(o, 0) : textWrapHTML(o, 0)).join('');
  if (diy.sel) {
    const w = $(`#diyContent [data-id="${diy.sel.id}"]`);
    if (w) {
      /* 图片用 .sel；文字用 .adjust（选中虚线框 + 工具条），
         四角 / 旋转手柄只在长按版式态 .boxmode 才露出来 —— 跟阅读器一模一样 */
      if (diy.sel.k === 'img') w.classList.add('sel');
      else { w.classList.add('adjust'); if (diy.box) w.classList.add('boxmode'); }
    }
  }
  if (editingId && diyObjById(editingId)) {
    const w = $(`#diyContent [data-id="${editingId}"]`);
    if (w) diyAttachInline(w, hadFocus || !!diy.caretPt, diy.caretPt);
  }
  /* 重绘完统一贴一次：文字多少 / 换行 / 字号 / 框宽变了，框的高矮长短跟着走；
     工具条也在这之后重新挑位置，才不会贴着一个已经改过尺寸的旧框。 */
  diyFitAllTexts();
}
function diySel(ref, box) {
  if (diy.editing && (!ref || ref.id !== diy.editing)) diyStopInline(true, true);
  diy.sel = ref;
  if (ref && ref.k === 'txt') {
    const o = diyObj(ref);
    if (o) o.locked = false;                      // 选中文字贴 = 解除固定（阅读器 selectText）
  }
  diy.box = !!(box && ref && ref.k === 'txt');
  renderDiyPaper();
  /* 跟阅读器一致：点一下只选中，双击 / 工具条「编辑」才开文字面板，
     别一选中就把底栏弹起来挡住纸面 */
  if (diy.sheet === 'text' && (!ref || ref.k !== 'txt')) diySheet('');
  else if (diy.sheet) renderDiySheet();
}
function diyDel(ref) {
  if (diy.editing === ref.id) diyStopInline(false, true);   // 删的就是正在打字的那条
  const a = ref.k === 'img' ? diy.d.images : diy.d.texts;
  const i = a.findIndex(x => x.id === ref.id);
  if (i < 0) return;
  a.splice(i, 1);
  diy.sel = null;
  renderDiyPaper(); renderDiySheet();
}
function diyCopy(ref) {
  if (diyObjs().length >= DIY_MAX_OBJS) { toast('封面最多放 ' + DIY_MAX_OBJS + ' 个对象'); return; }
  const o = diyObj(ref); if (!o) return;
  const c = JSON.parse(JSON.stringify(o));
  c.id = uid(); c.x = clamp(c.x + .04, 0, .9); c.y = clamp(c.y + .04, 0, .9);
  c.name = diyNameOK(diyLayerLabel(o, ref.k) + ' 副本');
  c.z = nextZ(diy.d);
  (ref.k === 'img' ? diy.d.images : diy.d.texts).push(c);
  diySel({ k: ref.k, id: c.id });
}
/* ---- 加图片 / 加文字 / 加贴纸：入口逻辑与阅读器一致 ---- */
async function diyAddImage(file, swapId) {
  if (!diy.open) return;
  const src = await packTemplateImage(file);
  if (!isImgData(src)) { toast('这张图读不出来，换一张试试'); return; }
  const r = await imgRatio(src);
  if (swapId) {
    const im = diy.d.images.find(x => x.id === swapId);
    diy.swapId = null;
    if (im) { im.src = src; im.h = clamp(im.w * r / diy.ratio, .03, 1.4); renderDiyPaper(); }
    return;
  }
  if (diyObjs().length >= DIY_MAX_OBJS) { toast('封面最多放 ' + DIY_MAX_OBJS + ' 个对象'); return; }
  const w = .42, h = clamp(w * r / diy.ratio, .03, 1.2);
  const im = { id: uid(), src, x: (1 - w) / 2, y: (1 - h) / 2, w, h,
               rot: 0, z: nextZ(diy.d), locked: false, fr: 'none', frc: '', frw: 50 };
  diy.d.images.push(im);
  diySel({ k: 'img', id: im.id });
  toast('图片已加到封面，拖动可摆位置');
}
function diyAddText() {
  if (diyObjs().length >= DIY_MAX_OBJS) { toast('封面最多放 ' + DIY_MAX_OBJS + ' 个对象'); return; }
  /* ⚠️ 默认文字必须是空的：提示由 .ptext-wrap.empty::before 画，不进数据也不进导出。
     以前写死「双击编辑文字」，用户不改就把这行提示印到封面上了。 */
  const t = newText(.16, .36, '');
  t.w = .68; t.h = .16; t.z = nextZ(diy.d); t.locked = false;
  diy.d.texts.push(t);
  DIY_FRESH_TEXTS.add(t.id);                // 第一次收面板不锁，留在版式态好摆位置
  diySel({ k: 'txt', id: t.id });
  diySheet('text');
  const inp = $('#diyTextInput');
  if (inp) { inp.focus(); inp.select(); }   // 新建完直接能打字，不用再找输入框
  toast('文字已加到封面，输入内容即可');
}
/* 贴纸落下去就是普通图片对象 / 便利贴文字对象，跟 stickers.js 的 addSticker / addNoteTo 同一套 */
function diyAddSticker(src, ratio, rot) {
  if (diyObjs().length >= DIY_MAX_OBJS) { toast('封面最多放 ' + DIY_MAX_OBJS + ' 个对象'); return; }
  const w = .3, h = clamp(w * (ratio || 1) / diy.ratio, .03, .9);
  const im = { id: uid(), src, x: clamp(.5 - w / 2, 0, 1), y: clamp(.46 - h / 2, 0, 1),
               w, h, rot: rot || 0, z: nextZ(diy.d), locked: false, fr: 'none', frc: '', frw: 50 };
  diy.d.images.push(im);
  renderDiyPaper();
  toast('贴纸已加到封面');
}
function diyAddNote(color) {
  if (diyObjs().length >= DIY_MAX_OBJS) { toast('封面最多放 ' + DIY_MAX_OBJS + ' 个对象'); return; }
  const t = newText(.32, .42, '');
  t.w = .38; t.h = .26; t.z = nextZ(diy.d); t.locked = false;
  t.note = normHex6(color) || NOTE_COLORS[0];
  t.color = '#3a3f52'; t.rot = -2.5;
  diy.d.texts.push(t);
  diySel({ k: 'txt', id: t.id });
  toast('便利贴已加到封面，双击写字');
}
/* ---- 底部工具面板 ---- */
function diySheet(kind) {
  const was = diy.sheet;
  /* 面板与纸面行内打字互斥：开文字面板先把正在打的字落盘（同阅读器 openTextSheet） */
  if (kind === 'text' && diy.editing) diyStopInline(true, true);
  if (!kind) diyCommitRename();            // 没按回车就关面板：重命名先收尾
  diy.sheet = kind || '';
  if (diy.sheet === 'text') diy.textId = diy.sel && diy.sel.k === 'txt' ? diy.sel.id : null;
  $('#diySheet').hidden = !diy.sheet;
  $$('#diyBar button[data-diyact]').forEach(b =>
    b.classList.toggle('on', !!diy.sheet && b.dataset.diyact === diy.sheet));
  if (was === 'text' && diy.sheet !== 'text') {
    /* 收面板：空的普通文字框当作没添加；其余默认固定住，只有「刚加的第一条」
       继续留在版式态，抬手就能拖走（阅读器 FRESH_TEXT_IDS 同款）。
       ⚠️ 认 diy.textId 而不是 diy.sel：点工具条「完成」时 diySel(null) 已经把选中清掉了。 */
    const t = diy.textId ? diyObjById(diy.textId) : null;
    diy.textId = null;
    if (t) {
      const fresh = DIY_FRESH_TEXTS.has(t.id);
      DIY_FRESH_TEXTS.delete(t.id);
      t.locked = fresh ? false : true;
      if (fresh) diy.box = true;
    }
    diyDropEmptyText();
    renderDiyPaper();
  }
  if (diy.sheet) renderDiySheet();
  else {
    diy.layerDrag = null;
    /* 清空 body：否则隐藏的面板里还留着 #diyTextInput 等旧节点，重开面板时看着像还有个输入框 */
    $('#diySheetBody').innerHTML = '';
  }
  /* 竖屏：面板开 / 关会改变舞台高度，纸要重新量一次（文字字号挂在 --pw 上，跟着等比缩放）。
     横屏：面板挂在右侧一竖条里、舞台尺寸不变，这次重量是空跑但无害；
     横竖屏切换时的重量由文件末尾的 window.resize 监听负责。 */
  if (was !== diy.sheet) requestAnimationFrame(() => {
    if (!diy.open) return;
    diySizePaper(); renderDiyPaper();
  });
}
function renderDiySheet() {
  const titles = { bg: '封面底色', cover: '封面设置', text: '编辑文字', sticker: '贴纸', layer: '图层', frame: '图片边框' };
  $('#diySheetTitle').textContent = titles[diy.sheet] || '';
  const box = $('#diySheetBody');
  if (diy.sheet === 'bg') {
    const b = diy.d.bg;
    box.innerHTML =
      `<div class="diy-row"><span class="diy-lab">纯色</span><div class="diy-chips">`
      + COLORS.map(c => `<button class="diy-sw${b === c ? ' on' : ''}" data-bg="${c}" style="background:${c}" title="${c}"></button>`).join('')
      + `<button class="diy-mini" data-act="bgcustom">＋自定义</button></div></div>`
      + `<div class="diy-row"><span class="diy-lab">渐变</span><div class="diy-chips">`
      + GRADS.map((g, i) => `<button class="diy-sw grad${b === g ? ' on' : ''}" data-grad="${g}" style="background:${g}" title="渐变 ${i + 1}"></button>`).join('')
      + `</div></div>`;
    return;
  }
  /* 封面设置：彩带颜色（只有笔记本这一档有）+ 封面圆角。
     这两项都是**本子级**设置，直接写 ed.temp（不进 cover.diym 草稿）：
     diyDone() 只重写 cover.img / diym / pattern，不会把 ed.temp 冲掉。
     改完只需 diyPaperSkin() 重刷画布外壳，不必重建 #diyContent。 */
  if (diy.sheet === 'cover') {
    const j = ed.temp;
    const hasRb = bookHasRibbon(j);
    /* 'none' 是合法的「透明」档，别用 ribbonSpine() 回落成默认色，
       否则色板上一个都没选中；非法色值仍由 ribbonSpine 兜底 */
    const rb = ribbonIsNone(j.ribbon) ? RIBBON_NONE : ribbonSpine(j.ribbon);
    const r = coverRadiusOf(j);
    const custom = j.cover && j.cover.radius != null;
    box.innerHTML =
      (hasRb
        ? `<div class="diy-row"><span class="diy-lab wide">彩带颜色</span><div class="diy-chips">`
          + `<button class="diy-sw ribbon-none${rb === RIBBON_NONE ? ' on' : ''}" data-ribbon="${RIBBON_NONE}" title="透明（隐藏彩带，也不画书槽）"></button>`
          + RIBBONS.map(c => `<button class="diy-sw${rb === c ? ' on' : ''}" data-ribbon="${c}" style="background:${c}" title="${c}"></button>`).join('')
          + `<button class="diy-mini" data-act="ribboncustom">＋自定义</button></div></div>`
          + `<div class="diy-hint">选「透明」时封面彩带隐藏，左侧也不画书槽。</div>`
        : `<div class="diy-hint">当前装帧没有彩带：方形画册 / 精装书显示书槽，活页封面保持干净。</div>`)
      + `<div class="diy-row"><span class="diy-lab wide">封面圆角</span>`
      + `<input class="diy-range" id="diyRadius" type="range" min="${COVER_R_MIN}" max="${COVER_R_MAX}" step="1" value="${r}">`
      + `<span class="diy-rval" id="diyRadiusVal">${r.toFixed(0)}px</span>`
      + `<button class="diy-mini" id="diyRadiusDefault" data-act="radiusdefault"${custom ? '' : ' disabled'}>默认</button></div>`
      + `<div class="diy-hint">只调右侧翻口两个角，左侧书脊两角固定；画布与成品封面同度，点「完成」后保存。</div>`;
    return;
  }
  if (diy.sheet === 'text') {
    const t = diy.sel && diy.sel.k === 'txt' ? diyObj(diy.sel) : null;
    if (!t) { box.innerHTML = `<div class="diy-hint">先点纸上的文字框，或按底栏「＋文字」新建一条</div>`; return; }
    box.innerHTML =
      `<div class="diy-row"><span class="diy-lab">内容</span><input class="diy-input" id="diyTextInput" value="${esc(t.text)}" placeholder="写点什么…"></div>`
      + `<div class="diy-row"><span class="diy-lab">字体</span><div class="diy-chips">`
      + TEXT_FONTS.map(f => `<button class="diy-mini${normFont(t.font) === f.k ? ' on' : ''}" data-font="${f.k}">${f.n}</button>`).join('')
      + `</div></div>`
      /* 英文字体跟阅读器文字面板同一张表（EN_FONTS）：拉丁字母走这一档，汉字仍落回上面的中文字体。
         每档都补 Aa 样例（含衬线 / 等宽 / 手写），挑之前就看得见字体效果；
         悬浮提示写原字体名。第一档 k 是空串，判断选中 / 绑定都要用 !== undefined，别写成 if (d.ef)。 */
      + `<div class="diy-row"><span class="diy-lab wide">英文字体</span><div class="diy-chips">`
      + EN_FONTS.map(f => `<button class="diy-mini${normEnFont(t.fontEn) === f.k ? ' on' : ''}"`
          + ` data-ef="${f.k}" title="${f.hint || f.n}"${f.css ? ` style="font-family:${f.css}"` : ''}>`
          + `${enFontSample(f)}${f.n}</button>`).join('')
      + `</div></div>`
      + `<div class="diy-row"><span class="diy-lab">颜色</span><div class="diy-chips">`
      + TEXT_COLORS.map(c => `<button class="diy-sw${t.color === c ? ' on' : ''}" data-tcolor="${c}" style="background:${c}"></button>`).join('')
      + `<button class="diy-mini" data-act="txtcustom">＋</button></div></div>`
      + `<div class="diy-row"><span class="diy-lab">高亮</span><div class="diy-chips">`
      + TEXT_BGS.map(c => `<button class="diy-sw${t.bg === c ? ' on' : ''}" data-tbg="${c}" style="background:${c || 'transparent'}"></button>`).join('')
      + `</div></div>`
      + `<div class="diy-row"><span class="diy-lab">字号</span><input class="diy-range" type="range" id="diySize" min="${TS_SIZE_MIN}" max="${TS_SIZE_MAX}" step="0.1" value="${t.size}"></div>`
      + `<div class="diy-row"><span class="diy-lab">格式</span><div class="diy-chips">`
      + [['bold', '粗'], ['italic', '斜'], ['underline', '下划线'], ['strike', '删除线']]
          .map(([k, n]) => `<button class="diy-mini${t[k] ? ' on' : ''}" data-fmt="${k}">${n}</button>`).join('')
      + [['left', '左'], ['center', '中'], ['right', '右']]
          .map(([k, n]) => `<button class="diy-mini${t.align === k ? ' on' : ''}" data-align="${k}">${n}</button>`).join('')
      + `</div></div>`
      + `<div class="diy-hint">英文字体只作用于拉丁字母，汉字仍走上面的中文字体；双击纸面文字可直接输入，关掉面板后长按 420ms 解锁才能拖四角改框 / 拖右侧手柄旋转</div>`;
    return;
  }
  if (diy.sheet === 'sticker') {
    const panes = { note: () => NOTE_COLORS.map(c =>
        `<button class="diy-st note" data-note="${c}" title="便利贴 ${c}"><span class="st-note" style="--nc:${c}"></span></button>`).join(''),
      tape: () => TAPES.map(t =>
        `<button class="diy-st" data-tape="${t.k}" title="${t.n}"><img src="${tapeSVG(t.c, t.p)}" alt=""></button>`).join(''),
      mine: () => {
        const lib = stickerLib();
        return (lib.length ? lib.map(s =>
          `<button class="diy-st" data-mine="${s.id}" title="点一下贴到封面上"><img src="${s.src}" alt=""><i class="del" data-delsticker="${s.id}">×</i></button>`).join('')
          : `<div class="diy-hint">还没有导入过贴纸</div>`)
          + `<button class="diy-mini big" data-act="importsticker" title="可一次选择多张图片">＋ 导入贴纸（可多选）</button>`;
      }
    };
    box.innerHTML = `<div class="diy-tabs">`
      + [['note', '便利贴'], ['tape', '装饰胶带'], ['mine', '我的贴纸']]
          .map(([k, n]) => `<button class="${diy.stTab === k ? 'on' : ''}" data-tab="${k}">${n}</button>`).join('')
      + `</div><div class="diy-st-grid">${(panes[diy.stTab] || panes.note)()}</div>`;
    return;
  }
  if (diy.sheet === 'layer') {
    /* 界面顺序 = z 从大到小（最上层排最前），拖拽排序的下标也按这份来 */
    const list = diyObjs().slice().reverse();
    box.innerHTML = list.length
      ? `<div class="diy-hint ren">拖左侧把手改上下层级 · 双击名称可重命名</div>`
        + `<div class="diy-layers">` + list.map(({ k, o }) => {
          const label = diyLayerLabel(o, k), sub = diyLayerSub(o, k), nc = normHex6(o.note);
          const thumb = k === 'img'
            ? `<span class="diy-lthumb"><img src="${o.src}" alt=""></span>`
            : (nc ? `<span class="diy-lthumb tnote" style="--nc:${nc}">便</span>`
                  : `<span class="diy-lthumb">T</span>`);
          return `<div class="diy-layer${diy.sel && diy.sel.id === o.id ? ' on' : ''}" data-layer="${o.id}">`
            + `<span class="diy-lgrip" title="拖动排序">⋮⋮</span>` + thumb
            + `<span class="diy-lmeta">`
            + `<span class="diy-lname" data-rename="${o.id}" title="双击重命名：${esc(label)}">${esc(label)}</span>`
            + `<span class="diy-lsub" title="${esc(sub)}">${esc(sub)}</span></span>`
            + `<button class="diy-mini" data-up="${o.id}" title="上移一层">↑</button>`
            + `<button class="diy-mini" data-down="${o.id}" title="下移一层">↓</button>`
            + `<button class="diy-mini" data-dellayer="${o.id}" title="删除">×</button></div>`;
        }).join('')
        + `</div><button class="diy-mini" data-act="clear">清空全部</button>`
      : `<div class="diy-hint">封面还是空的，先加张图片或写点字吧</div>`;
    return;
  }
  if (diy.sheet === 'frame') {
    const im = diy.sel && diy.sel.k === 'img' ? diyObj(diy.sel) : null;
    if (!im) { box.innerHTML = `<div class="diy-hint">先选中一张图片</div>`; return; }
    box.innerHTML = `<div class="diy-row"><span class="diy-lab">框型</span><div class="diy-chips">`
      + FRAMES.map(f => `<button class="diy-mini${(im.fr || 'none') === f.k ? ' on' : ''}" data-frame="${f.k}">${f.n}</button>`).join('')
      + `</div></div><div class="diy-row"><span class="diy-lab">框色</span><div class="diy-chips">`
      + FRAME_COLORS.map(c => `<button class="diy-sw${im.frc === c ? ' on' : ''}" data-framecolor="${c}" style="background:${c}"></button>`).join('')
      + `</div></div>`;
  }
}
/* ---- 合成封面图：foreignObject 是独立文档，所有样式必须内联 ---- */
function diyExportHTML(W, H) {
  let s = `<div class="diy-canvas" style="position:relative;width:${W}px;height:${H}px;`
    + `overflow:hidden;background:${diy.d.bg};">`;
  diyObjs().forEach(({ k, o }) => {
    const box = `position:absolute;left:${(o.x * 100).toFixed(3)}%;top:${(o.y * 100).toFixed(3)}%;`
      + `width:${(o.w * 100).toFixed(3)}%;height:${((o.h || .12) * 100).toFixed(3)}%;`
      + `${o.rot ? `transform:rotate(${Number(o.rot)}deg);` : ''}overflow:hidden;`;
    if (k === 'img') {
      const img = `<img src="${o.src}" style="width:100%;height:100%;display:block;object-fit:fill;${frameImgStyle(o)}" />`;
      s += hasFrame(o)
        ? `<div style="${box}"><div style="position:absolute;inset:0;box-sizing:border-box;${frameBoxStyle(o, W / PAGE_W_DEFAULT)}">${img}${frameInsetHTML(o, W / PAGE_W_DEFAULT)}</div></div>`
        : `<div style="${box}">${img}</div>`;
    } else {
      const fs = (o.size || 5.5) / 100 * W;
      const fam = [textEnStack(o.fontEn), textFontStack(o.font)].filter(Boolean).join(',') || 'inherit';
      const nc = normHex6(o.note);
      const note = nc ? `background:${nc};padding:.5em .66em;border-radius:3px;` : '';
      s += `<div style="${box}display:flex;align-items:center;font-family:${fam};`
        + `font-size:${fs.toFixed(2)}px;color:${o.color || '#2b2f3d'};text-align:${o.align || 'left'};`
        + `line-height:${normFont(o.font) === 'hand' ? 1.42 : 1.32};letter-spacing:.01em;`
        + `${o.bold ? 'font-weight:700;' : ''}${o.italic ? 'font-style:italic;' : ''}`
        + `${o.underline ? 'text-decoration:underline;' : (o.strike ? 'text-decoration:line-through;' : '')}`
        + `${o.bg ? 'background:' + o.bg + ';' : ''}${note}`
        + `white-space:pre-wrap;word-break:break-word">${esc(o.text || '')}</div>`;
    }
  });
  return s + '</div>';
}
async function diyRenderCanvas(W) {
  const H = Math.round(W * diy.ratio);
  const xhtml = `<div xmlns="http://www.w3.org/1999/xhtml" style="width:${W}px;height:${H}px;`
    + `overflow:hidden;font-family:'PingFang SC','Microsoft YaHei','Segoe UI',sans-serif;">`
    + diyExportHTML(W, H) + `</div>`;
  /* 封面合成也是 SVG foreignObject 独立文档，读不到本页 @font-face：
     用到了项目自带的四款英文字体时，把对应 woff2 转 base64 内嵌进 SVG 根级 <style>，
     否则「完成」生成的 cover.img 会悄悄退回系统近似字体，跟画布上看到的不一样。
     跟 PDF / SVG 导出共用 io-doc.js 的 exportEnFaceCSS，字体缓存也共用。 */
  const enFaces = await exportEnFaceCSS(diy.d.texts);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">`
    + enFaces + `<foreignObject width="100%" height="100%">${xhtml}</foreignObject></svg>`;
  const im = new Image();
  await new Promise((res, rej) => {
    im.onload = res;
    im.onerror = () => rej(new Error('封面渲染失败'));
    im.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  });
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const cx = c.getContext('2d');
  cx.fillStyle = '#fffdf8'; cx.fillRect(0, 0, W, H);
  cx.drawImage(im, 0, 0, W, H);
  return c;
}
/* ---- 打开 / 关闭独立页面 ---- */
function openDiyCover() {
  if (!ed || !ed.temp) return;
  const cv = ed.temp.cover;
  let d = normDiyCover(cv.diym);
  if (!d) {
    d = { bg: diyBgOK(cv.img ? COLORS[0] : cv.value), images: [], texts: [] };
    /* 已有普通上传封面：把它当作铺满纸面的第一张图带进来，进页面不丢原有封面 */
    if (cv.img && /^data:image\/[^;]+;base64,/i.test(cv.img)) {
      d.images.push({ id: uid(), src: cv.img, x: 0, y: 0, w: 1, h: 1,
                      rot: 0, z: 0, locked: false, fr: 'none', frc: '', frw: 50,
                      fill: true, fit: FILL_GEOM_V, pv: null });
    }
  }
  diy.d = d; diy.sel = null; diy.sheet = ''; diy.stTab = 'note'; diy.drag = null; diy.swapId = null;
  diy.tap = { t: 0, id: '', x: 0, y: 0 }; diy.layerDrag = null; diy.layerJustDragged = 0;
  diy.box = false; diy.editing = null; diy.caretPt = null; diy.textId = null;
  diy.stopping = false; diyCancelHold();
  DIY_FRESH_TEXTS.clear();
  diy.ratio = coverRatioOf(ed.temp);
  diy.style = normBookStyle(ed.temp.style);
  diy.open = true;
  /* 编辑器弹窗让位：DIY 是一张独立页面，不是压在弹窗上的又一层浮窗 */
  $('#mask').style.display = 'none';
  $('#diyPage').hidden = false;
  diyRestoreSideW();                  // 上次拖出来的侧栏宽度
  requestAnimationFrame(() => {
    if (!diy.open) return;
    diySizePaper(); renderDiyPaper(); diySheet('');
  });
}
function closeDiyCover() {
  diyCancelHold();
  diyStopInline(true, true);             // 行内正在打的字别丢
  diy.open = false; diy.drag = null; diy.swapId = null;
  diyPaintQ.cancel();
  $('#diyPage').hidden = true;
  $('#mask').style.display = '';          // 交还给编辑器弹窗
  diySheet('');
}
async function diyDone() {
  const btn = $('#diyDone');
  if (btn.disabled) return;
  btn.disabled = true;
  try {
    diyCancelHold();
    diyStopInline(true, true);         // 点「完成」时还停在行内编辑：先把内容落进数据
    diyCommitRename();                 // 重命名没收尾的先存下
    diyDropEmptyText();                // 空文字框不进成品，也不进 cover.diym 草稿
    const c = await diyRenderCanvas(744);
    let src;
    try { src = c.toDataURL('image/jpeg', .92); }
    catch (_) { src = c.toDataURL('image/png'); }
    ed.temp.cover.img = src;
    ed.temp.cover.diym = JSON.parse(JSON.stringify(diy.d));
    ed.temp.cover.pattern = 'none';       // 自定义封面本身就有底图，不再叠图案
    closeDiyCover();
    syncEditor();
    toast('自定义封面已应用，点「完成」保存手帐本');
  } catch (e) {
    toast('封面合成失败：' + ((e && e.message) || e), 4200);
  } finally { btn.disabled = false; }
}
/* ---- 纸面手势：拖动 / 四角缩放 / 旋转，逐帧合帧，收尾 flush ---- */
const diyPaintQ = frameQueue(v => {
  const el = $(`#diyContent [data-id="${v.id}"]`);
  if (!el) return;
  applyBox(el, v.o);                       // 与阅读器同一套盒子下发
  diyFitObjBar(el);                        // 拖动 / 缩放途中工具条一路跟着躲纸边
});
/* 长按 420ms 才解锁固定文字贴 → 版式态（阅读器 armTextHold 同款）。
   没按够就松手、或中途划开了都算单击；解锁后手指不用抬就能接着拖走。 */
function diyCancelHold() { if (diy.hold) diy.hold.cleanup(); }
function diyArmTextHold(e, ref) {
  const sx = e.clientX, sy = e.clientY, pid = e.pointerId;
  diyCancelHold();
  const st = { timer: 0, cleanup: null };
  const cleanup = () => {
    clearTimeout(st.timer);
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onUp);
    if (diy.hold === st) diy.hold = null;
  };
  const onMove = ev => {
    if (Math.abs(ev.clientX - sx) > 10 || Math.abs(ev.clientY - sy) > 10) cleanup();
  };
  const onUp = () => cleanup();
  st.cleanup = cleanup;
  st.timer = setTimeout(() => {
    cleanup();
    const o = diyObj(ref); if (!o || !diy.open) return;
    o.locked = false;
    diy.tap = { t: 0, id: '', x: 0, y: 0 };     // 长按不算「第一下点」，别跟后面凑成双击
    diySel(ref, true);
    diyBeginDrag({ clientX: sx, clientY: sy, pointerId: pid, preventDefault() {} }, ref, 'move', '');
    toast('已解除固定 · 拖动挪位置，拖四角改大小');
  }, 420);
  diy.hold = st;
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onUp);
}
/* 拖动 / 缩放 / 旋转共用一套起手式；长按解锁后也走这里（传合成的事件对象） */
function diyBeginDrag(e, ref, mode, hKey) {
  const o = diyObj(ref); if (!o) return;
  const pr = $('#diyPaper').getBoundingClientRect();
  const cx = pr.left + (o.x + o.w / 2) * pr.width;
  const cy = pr.top + (o.y + o.h / 2) * pr.height;
  diy.drag = {
    ref, mode, h: hKey, sx: e.clientX, sy: e.clientY,
    ox: o.x, oy: o.y, ow: o.w, oh: o.h, orot: +(o.rot || 0),
    osize: +(o.size || 5.5), oww: o.ww > 0 ? o.ww : o.w,   // 文字拖四角时字号 / 折行宽度同比缩放
    cx, cy, a0: Math.atan2(e.clientY - cy, e.clientX - cx)
  };
  try { $('#diyContent').setPointerCapture(e.pointerId); } catch (_) {}
  e.preventDefault();
}
$('#diyContent').addEventListener('pointerdown', e => {
  if (!diy.open || e.button > 0) return;
  if (e.target.closest('.objbar')) return;                 // 工具条交给 click 委托
  const w = e.target.closest('.pimg-wrap,.ptext-wrap');
  const isText = !!w && w.classList.contains('ptext-wrap');
  /* 内容态（双击进来的行内打字）：整块放行给 contentEditable，落光标 / 拖选文字，
     不记 tap、不挂拖拽、手柄也不许缩放 —— 跟阅读器 page-edit.js 同一句 return */
  if (isText && w.classList.contains('editing')) return;
  const ref = diyRefOf(w);
  const h = e.target.closest('.hdl');
  /* ⚠️ 原生 dblclick 在 DIY 纸面上不可靠：纸面会被整块重绘，第二次点击落在新节点上。
     自己按「同一对象 id + 380ms + 位移 < 26px」判，鼠标 / 触摸都认。 */
  const now = performance.now(), tp = diy.tap;
  const dbl = !!ref && now - tp.t < 380 && tp.id === ref.id
    && Math.abs(e.clientX - tp.x) < 26 && Math.abs(e.clientY - tp.y) < 26;
  diy.tap = { t: now, id: ref ? ref.id : '', x: e.clientX, y: e.clientY };
  /* 双击旋转手柄摆正（文字贴只有版式态才有这颗手柄） */
  if (dbl && h && h.dataset.h === 'rot') {
    const o = diyObj(ref);
    if (o && (!isText || w.classList.contains('boxmode'))) { o.rot = 0; renderDiyPaper(); }
    diy.tap = { t: 0, id: '', x: 0, y: 0 };   // 双击已消费，别让下一按又凑成一次双击
    return;
  }
  if (isText) {
    const o = diyObj(ref); if (!o) return;
    const panelForThis = diy.sheet === 'text' && diy.sel && diy.sel.id === ref.id;
    /* 双击 = 内容态：直接在纸面打字，手柄全收、拖不动也缩不了 */
    if (dbl && !panelForThis) {
      e.preventDefault();          // 否则浏览器随后会把焦点从 contentEditable 抢走
      diy.tap = { t: 0, id: '', x: 0, y: 0 };
      diyStartInline(ref.id, { x: e.clientX, y: e.clientY });
      return;
    }
    /* 内容态 / 非版式态：四角与旋转手柄一律不响应 */
    if (h && (!w.classList.contains('boxmode') || panelForThis)) return;
    if (panelForThis) {
      /* 面板管打字、纸面只管位置：按下就能拖，但收掉版式手柄 */
      diy.box = false; renderDiyPaper();
      diyBeginDrag(e, ref, 'move', '');
      return;
    }
    if (w.classList.contains('boxmode') || o.locked === false) {
      if (!diy.sel || diy.sel.id !== ref.id || !diy.box) diySel(ref, true);
      diyBeginDrag(e, ref, h ? (h.dataset.h === 'rot' ? 'rot' : 'scale') : 'move', h ? h.dataset.h : '');
      return;
    }
    /* 固定态：单击零反应，按住 420ms 才解锁进版式态 */
    e.preventDefault();
    diyArmTextHold(e, ref);
    return;
  }
  if (!w) { diySel(null); return; }
  if (!ref) return;
  const o = diyObj(ref); if (!o) return;
  if (diy.sel === null || diy.sel.id !== ref.id) diySel(ref);
  diyBeginDrag(e, ref, h ? (h.dataset.h === 'rot' ? 'rot' : 'scale') : 'move', h ? h.dataset.h : '');
});
$('#diyContent').addEventListener('pointermove', e => {
  const g = diy.drag; if (!g) return;
  const r = $('#diyPaper').getBoundingClientRect();
  const dx = (e.clientX - g.sx) / r.width, dy = (e.clientY - g.sy) / r.height;
  const o = diyObj(g.ref); if (!o) return;
  if (g.mode === 'move') {
    o.x = clamp(g.ox + dx, -.2, 1.1);
    o.y = clamp(g.oy + dy, -.2, 1.1);
  } else if (g.mode === 'scale') {
    const signX = (g.h === 'tl' || g.h === 'bl') ? -1 : 1;
    const signY = (g.h === 'tl' || g.h === 'tr') ? -1 : 1;
    const k = clamp(1 + (signX * dx / Math.max(g.ow, .06) + signY * dy / Math.max(g.oh, .06)) / 2, .35, 3);
    o.w = clamp(g.ow * k, .04, 1.4);
    o.h = clamp(g.oh * k, .03, 1.4);
    /* 对角钉住：拖左边 / 上边时把 x / y 补回去 */
    o.x = signX < 0 ? g.ox + g.ow - o.w : g.ox;
    o.y = signY < 0 ? g.oy + g.oh - o.h : g.oy;
    /* 文字贴拖四角 = 连字一起放大（跟阅读器一样）：只改框不改字号的话，
       下一次贴合内容会立刻把框收回去，看起来像「拖了没反应」。 */
    if (g.ref.k === 'txt') {
      o.size = clamp(g.osize * k, TS_SIZE_MIN, TS_SIZE_MAX);
      const kk = o.size / Math.max(g.osize, .01);
      o.ww = clamp(g.oww * kk, .02, 1.6);
      const te = $(`#diyContent [data-id="${o.id}"] .ptxt`);
      if (te) te.style.fontSize = `calc(var(--pw,340px) * ${(o.size / 100).toFixed(6)})`;
    }
  } else {
    const a1 = Math.atan2(e.clientY - g.cy, e.clientX - g.cx);
    o.rot = Math.round(g.orot + (a1 - g.a0) * 180 / Math.PI);
  }
  diyPaintQ.push({ id: o.id, o });
});
function diyEndDrag(e) {
  if (!diy.drag) return;
  diyPaintQ.flush();
  diy.drag = null;
  try { $('#diyContent').releasePointerCapture(e.pointerId); } catch (_) {}
  renderDiyPaper();
}
$('#diyContent').addEventListener('pointerup', diyEndDrag);
$('#diyContent').addEventListener('pointercancel', diyEndDrag);
/* 双击（摆正旋转手柄 / 文字进编辑）已经挪进上面的 pointerdown 自定义判定，
   这里不再挂 dblclick —— 纸面重绘后它根本不会派发，留着只会让人误以为还能用。 */
/* 对象工具条：完成 / 复制 / 换图 / 边框 / 铺满或编辑文字 / 删除
   ⚠️ 用 pointerdown 而不是 click（跟阅读器 page-edit.js 一致）：行内打字时点工具条会先让
   contentEditable 失焦 → blur 收尾重绘纸面，click 就落在被换掉的节点上、永远不触发。 */
$('#diyContent').addEventListener('pointerdown', e => {
  if (e.button > 0) return;
  const b = e.target.closest('.objbar .ob'); if (!b) return;
  const w = b.closest('.pimg-wrap,.ptext-wrap');
  const ref = diyRefOf(w); if (!ref) return;
  const o = diyObj(ref); if (!o) return;
  const act = b.dataset.ob;
  if (act === 'close') { diySel(null); return; }
  if (act === 'copy') { diyCopy(ref); return; }
  if (act === 'del') { diyDel(ref); return; }
  if (act === 'swap') { diy.swapId = ref.id; $('#diySwapFile').click(); return; }
  if (act === 'frame') { diySheet('frame'); return; }
  if (act === 'edit') {
    if (ref.k === 'txt') {
      /* 从版式态 / 行内打字切进面板 = 回到内容态：先落盘正在打的字、收掉四角手柄 */
      if (diy.editing) diyStopInline(true, true);
      diySel(ref, false);
      diySheet('text');
      const inp = $('#diyTextInput'); if (inp) { inp.focus(); inp.select(); }
      return;
    }
    /* 图片：铺满整页 ⇄ 还原（还原尺寸记在 o.pv 上） */
    if (o.fill) {
      const p = o.pv || { x: .2, y: .2, w: .42, h: .42 };
      Object.assign(o, p); delete o.fill; delete o.pv;
    } else {
      o.pv = { x: o.x, y: o.y, w: o.w, h: o.h };
      /* fit 是「几何已按 fillGeom 校准过」的记号：有它 .pimg-wrap.fill.fit 才用
         object-fit:fill，跟 diyExportHTML / 封面预览用的铺法一致，画布不再露白边。 */
      Object.assign(o, { x: 0, y: 0, w: 1, h: 1 }); o.fill = true; o.fit = FILL_GEOM_V;
    }
    renderDiyPaper();
    return;
  }
  if (act === 'fslink') return;            // 封面里字号始终跟着框，不留这个开关
});
/* ---- 底栏与工具面板 ---- */
$('#diyBack').onclick = () => { closeDiyCover(); toast('已放弃本次修改'); };
$('#diyDone').onclick = diyDone;
$('#diySheetClose').onclick = () => diySheet('');
$('#diyBar').onclick = e => {
  const b = e.target.closest('button[data-diyact]'); if (!b) return;
  const a = b.dataset.diyact;
  if (a === 'image') { $('#diyFile').click(); return; }
  if (a === 'text') { diyAddText(); return; }
  diySheet(diy.sheet === a ? '' : a);
};
/* 封面圆角滑块：拖动中只重刷画布外壳的 --cr，不重建纸面、也不重绘面板
   （重绘会把手指正按着的 range 换掉，拖到一半就断）。 */
$('#diySheetBody').addEventListener('input', e => {
  if (!diy.open || e.target.id !== 'diyRadius') return;
  const v = clamp(Number(e.target.value) || 0, COVER_R_MIN, COVER_R_MAX);
  ed.temp.cover.radius = v;
  const lab = $('#diyRadiusVal'); if (lab) lab.textContent = v.toFixed(0) + 'px';
  const def = $('#diyRadiusDefault'); if (def) def.disabled = false;
  diyPaperSkin();
});
$('#diySheetBody').addEventListener('click', async e => {
  if (!diy.open) return;
  /* 贴纸右上角的 × 在 button 里，得先截住，否则会被当成「点这张贴纸」 */
  const del = e.target.closest('[data-delsticker]');
  if (del) { await removeStickerFromLib(del.dataset.delsticker); renderDiySheet(); return; }
  /* 名称区专留给双击重命名：这里一旦 diySel() 就会 renderDiySheet() 把整行重绘，
     输入框和 dblclick 都会丢（跟纸面双击那个坑同源）。点缩略图 / 副标题 / 空白处仍可选中。 */
  if (e.target.closest('.diy-rename, .diy-lname')) return;
  if (performance.now() - (diy.layerJustDragged || 0) < 120) return;  // 拖完排序那一下 click 不算
  const t = e.target.closest('button, .diy-layer'); if (!t) return;
  const d = t.dataset, act = d.act;
  if (d.bg) { diy.d.bg = d.bg; renderDiyPaper(); renderDiySheet(); return; }
  if (d.grad) { diy.d.bg = d.grad; renderDiyPaper(); renderDiySheet(); return; }
  if (act === 'bgcustom') {
    openColorPicker('自定义封面底色', /^#/.test(diy.d.bg) ? diy.d.bg : '',
      hex => { diy.d.bg = hex; renderDiyPaper(); renderDiySheet(); });
    return;
  }
  /* 封面设置：彩带颜色（仅笔记本有这一行）/ 自定义取色 / 恢复默认圆角 */
  if (d.ribbon !== undefined) {
    ed.temp.ribbon = d.ribbon;
    diyPaperSkin(); renderDiySheet();
    return;
  }
  if (act === 'ribboncustom') {
    openColorPicker('自定义彩带颜色', /^#/.test(ed.temp.ribbon) ? ed.temp.ribbon : '',
      hex => { ed.temp.ribbon = hex; diyPaperSkin(); renderDiySheet(); });
    return;
  }
  if (act === 'radiusdefault') {
    delete ed.temp.cover.radius;
    diyPaperSkin(); renderDiySheet();
    return;
  }
  /* 文字面板 */
  const txt = diy.sel && diy.sel.k === 'txt' ? diyObj(diy.sel) : null;
  if (d.font) { if (txt) { txt.font = normFont(d.font); renderDiyPaper(); renderDiySheet(); } return; }
  /* 第一档「跟随中文」的 k 是空串，必须按「有没有这个属性」判，不能按真值判 */
  if (d.ef !== undefined) {
    if (txt) { txt.fontEn = normEnFont(d.ef); renderDiyPaper(); renderDiySheet(); }
    return;
  }
  if (d.tcolor) { if (txt) { txt.color = d.tcolor; renderDiyPaper(); renderDiySheet(); } return; }
  if (d.tbg !== undefined) { if (txt) { txt.bg = d.tbg; renderDiyPaper(); renderDiySheet(); } return; }
  if (d.fmt) { if (txt) { txt[d.fmt] = !txt[d.fmt]; renderDiyPaper(); renderDiySheet(); } return; }
  if (d.align) { if (txt) { txt.align = d.align; renderDiyPaper(); renderDiySheet(); } return; }
  if (act === 'txtcustom') {
    openColorPicker('自定义文字颜色', txt ? txt.color : '#2b2f3d',
      hex => { if (txt) { txt.color = hex; renderDiyPaper(); renderDiySheet(); } });
    return;
  }
  /* 图片边框面板 */
  if (d.frame) {
    const im = diy.sel && diy.sel.k === 'img' ? diyObj(diy.sel) : null;
    if (im) { im.fr = d.frame; renderDiyPaper(); renderDiySheet(); }
    return;
  }
  if (d.framecolor) {
    const im = diy.sel && diy.sel.k === 'img' ? diyObj(diy.sel) : null;
    if (im) { im.frc = d.framecolor; renderDiyPaper(); renderDiySheet(); }
    return;
  }
  /* 贴纸面板 */
  if (d.tab) { diy.stTab = d.tab; renderDiySheet(); return; }
  if (d.note) { diyAddNote(d.note); return; }
  if (d.tape) {
    const tp = TAPES.find(x => x.k === d.tape);
    if (tp) diyAddSticker(tapeSVG(tp.c, tp.p), 30 / 120, -5.5);
    return;
  }
  if (d.mine) {
    const it = stickerLib().find(x => x.id === d.mine);
    if (it) diyAddSticker(it.src, (it.h || 1) / (it.w || 1), 0);
    return;
  }
  if (act === 'importsticker') { $('#diyStickerFile').click(); return; }
  /* 图层面板 */
  if (d.dellayer) { diyDel(diyRefOf({ dataset: { id: d.dellayer } })); return; }
  if (d.up || d.down) {
    const list = diyObjs().sort((a, b) => (a.o.z || 0) - (b.o.z || 0));
    const i = list.findIndex(x => x.o.id === (d.up || d.down));
    const j = i + (d.up ? 1 : -1);
    if (i >= 0 && j >= 0 && j < list.length) {
      const z = list[i].o.z; list[i].o.z = list[j].o.z; list[j].o.z = z;
      renderDiyPaper(); renderDiySheet();
    }
    return;
  }
  if (act === 'clear') {
    if (diy.editing) diyStopInline(false, true);
    diy.d.images.length = 0; diy.d.texts.length = 0; diy.sel = null;
    renderDiyPaper(); renderDiySheet();
    toast('封面已清空');
    return;
  }
  if (d.layer) { diySel(diyRefOf({ dataset: { id: d.layer } })); return; }
});
$('#diySheetBody').addEventListener('input', e => {
  if (!diy.open) return;
  const el = e.target;
  if (el.classList.contains('diy-rename')) return;   // 重命名靠回车 / 失焦提交，别逐字重绘
  const txt = diy.sel && diy.sel.k === 'txt' ? diyObj(diy.sel) : null;
  if (el.id === 'diyTextInput') {
    if (txt) {
      txt.text = el.value;
      /* 只改这一条文字的内容，不重建 #diyContent：全量重绘每敲一个字都闪一下，
         还会把选中框 / 四角手柄 / 对象工具条一起抖掉（面板本身更不能重建，会丢焦点）。 */
      const w = $(`#diyContent [data-id="${txt.id}"]`);
      const pt = w && w.querySelector('.ptxt');
      if (pt) {
        pt.innerHTML = esc(txt.text);
        w.classList.toggle('empty', !String(txt.text).trim());
        /* 面板里打字同样要贴框：换行 / 删字后高矮长短跟着内容走 */
        diyFitText(txt.id); diyFitObjBars();
      } else renderDiyPaper();
    }
    return;
  }
  if (el.id === 'diySize' && txt) { txt.size = +el.value; renderDiyPaper(); }
});

/* ---- 图层重命名：双击名称 → 内联输入框，回车 / 失焦保存，Esc 取消 ---- */
function diyCommitRename() {
  const inp = $('#diySheetBody .diy-rename');
  if (!inp || inp.dataset.done || inp.dataset.cancel) return;
  inp.dataset.done = '1';                 // 重绘会触发 focusout，先上锁防重入
  const o = diyObjById(inp.dataset.rename);
  const v = diyNameOK(inp.value);
  if (o) { if (v) o.name = v; else delete o.name; }
  renderDiySheet();
}
$('#diySheetBody').addEventListener('dblclick', e => {
  if (!diy.open || diy.sheet !== 'layer' || e.target.closest('.diy-rename')) return;
  const nm = e.target.closest('.diy-lname[data-rename]'); if (!nm) return;
  const id = nm.dataset.rename;
  const o = diyObjById(id); if (!o) return;
  if ($('#diySheetBody .diy-rename')) diyCommitRename();   // 先把上一条收掉（会重绘）
  const cur = $(`#diySheetBody .diy-lname[data-rename="${id}"]`);
  if (!cur) return;                                        // 重绘后重新取节点
  const k = diy.d.images.some(x => x.id === id) ? 'img' : 'txt';
  const inp = document.createElement('input');
  inp.className = 'diy-rename'; inp.dataset.rename = id;
  inp.maxLength = 24; inp.value = diyLayerLabel(o, k);
  cur.replaceWith(inp);
  inp.focus(); inp.select();
});
$('#diySheetBody').addEventListener('keydown', e => {
  const inp = e.target.closest && e.target.closest('.diy-rename'); if (!inp) return;
  if (e.key === 'Enter') { e.preventDefault(); diyCommitRename(); }
  else if (e.key === 'Escape') {
    e.preventDefault(); inp.dataset.cancel = '1'; renderDiySheet();
  }
});
$('#diySheetBody').addEventListener('focusout', e => {
  const inp = e.target.closest && e.target.closest('.diy-rename'); if (!inp) return;
  if (!inp.dataset.cancel && !inp.dataset.done) diyCommitRename();
});

/* ---- 图层拖拽排序 ----
   鼠标整行可拖；触摸必须抓 .diy-lgrip，否则 touch-action 会把面板滚动吞掉。
   拖动中只改 CSS 类画插入线、不重排 DOM；松手一次性重发连续 z
   （界面顺序是 z 从大到小，反过来就是 z 升序）。 */
$('#diySheetBody').addEventListener('pointerdown', e => {
  if (!diy.open || diy.sheet !== 'layer' || e.button > 0) return;
  /* 名称那一块留给双击重命名，不抢 pointer 捕获，否则 dblclick 会被拖动手势吃掉 */
  if (e.target.closest('button, .diy-rename, input, .diy-lname')) return;
  const row = e.target.closest('.diy-layer'); if (!row) return;
  if (e.pointerType !== 'mouse' && !e.target.closest('.diy-lgrip')) return;
  const rows = $$('#diySheetBody .diy-layer');
  const from = rows.indexOf(row); if (from < 0) return;
  diy.layerDrag = { from, to: from, rows, row, sy: e.clientY, moved: false };
  try { $('#diySheetBody').setPointerCapture(e.pointerId); } catch (_) {}
  e.preventDefault();
});
$('#diySheetBody').addEventListener('pointermove', e => {
  const g = diy.layerDrag; if (!g) return;
  if (!g.moved && Math.abs(e.clientY - g.sy) < 5) return;
  g.moved = true;
  g.row.classList.add('dragging');
  let to = 0;
  g.rows.forEach((r, i) => {
    const b = r.getBoundingClientRect();
    if (e.clientY > b.top + b.height / 2) to = i + 1;
  });
  g.to = clamp(to > g.from ? to - 1 : to, 0, g.rows.length - 1);
  g.rows.forEach((r, i) => {
    r.classList.toggle('drop-before', i === g.to && g.to < g.from);
    r.classList.toggle('drop-after', i === g.to && g.to > g.from);
  });
});
function diyEndLayerDrag(e) {
  const g = diy.layerDrag; if (!g) return;
  diy.layerDrag = null;
  try { $('#diySheetBody').releasePointerCapture(e.pointerId); } catch (_) {}
  g.rows.forEach(r => r.classList.remove('dragging', 'drop-before', 'drop-after'));
  if (e.type === 'pointercancel' || !g.moved || g.to === g.from) return;
  diy.layerJustDragged = performance.now();   // 抑制拖完抬起时那一下 click
  const ui = diyObjs().slice().reverse();
  const item = ui.splice(g.from, 1)[0]; if (!item) return;
  ui.splice(g.to, 0, item);
  ui.forEach((it, i) => { it.o.z = ui.length - 1 - i; });
  renderDiyPaper(); renderDiySheet();
}
$('#diySheetBody').addEventListener('pointerup', diyEndLayerDrag);
$('#diySheetBody').addEventListener('pointercancel', diyEndLayerDrag);

/* ---- 侧栏拖宽：逐帧合帧，松手记宽度 ---- */
const diySideQ = frameQueue(w => diyApplySideW(w, false));
$('#diyResizer').addEventListener('pointerdown', e => {
  if (!diy.open || e.button > 0) return;
  const w = $('#diySide').getBoundingClientRect().width || diy.sideW;
  if (!w) return;
  diy.sideW = w;
  diy.sideDrag = { x: e.clientX, w };
  $('#diyResizer').classList.add('on');
  try { $('#diyResizer').setPointerCapture(e.pointerId); } catch (_) {}
  e.preventDefault();
});
$('#diyResizer').addEventListener('pointermove', e => {
  const g = diy.sideDrag; if (!g) return;
  diySideQ.push(g.w + (g.x - e.clientX));    // 往左拖 = 变宽
});
function diyEndSideDrag(e) {
  const g = diy.sideDrag; if (!g) return;
  diy.sideDrag = null;
  diySideQ.flush();
  $('#diyResizer').classList.remove('on');
  try { $('#diyResizer').releasePointerCapture(e.pointerId); } catch (_) {}
  diyApplySideW(diy.sideW, true);            // 落定：重绘纸面 + 记住宽度
}
$('#diyResizer').addEventListener('pointerup', diyEndSideDrag);
$('#diyResizer').addEventListener('pointercancel', diyEndSideDrag);
/* 三路选图：加图片 / 换图 / 往贴纸库导入。
   ⚠️ 统一走 readPickedFiles：移动端先把 File 同步读成 dataURL，再清 input / 移除节点，
      否则底层 Blob 一释放，后面的压缩与解码全部拿到空串。 */
$('#diyFile').addEventListener('change', async e => {
  const [f] = await readPickedFiles(e);
  if (f) await diyAddImage(f);
});
$('#diySwapFile').addEventListener('change', async e => {
  const [f] = await readPickedFiles(e);
  if (!f) { diy.swapId = null; return; }
  await diyAddImage(f, diy.swapId);
});
/* 贴纸库可一次选多张 */
$('#diyStickerFile').addEventListener('change', async e => {
  const fs = await readPickedFiles(e);
  if (!fs.length) return;
  const r = await addStickersToLib(fs);
  diy.stTab = 'mine'; renderDiySheet();
  toast(stickerImportMsg(r), (r.failed || r.full) ? 3400 : undefined);
});
window.addEventListener('resize', () => {
  if (!diy.open) return;
  if (diy.sideW) diyApplySideW(diy.sideW, false);   // 窗口变小后把侧栏夹回合法范围
  diySizePaper(); renderDiyPaper();
});
