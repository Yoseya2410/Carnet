/* =====================================================================
 * Carnet · 阅读器渲染 · 书页与排版   （脚本 14 / 28）
 * ---------------------------------------------------------------------
 * ① 单页 / 双页摊开判定 isSpread、书的尺寸与中缝布局 layoutBook
 * ② 封面页与内页渲染 coverPageHTML / pageHTML（图片与文字按 z 合排 pageObjs）
 * ③ 对象的公共外壳：工具条 objBarHTML、旋转 rotStyle、四角与旋转手柄 rotHandleHTML
 * ④ renderReader 总渲染、currentIndices 当前左右页下标、跨页页序换算（分活页 / 无环两套）
 *
 * 对外接口：renderReader, layoutBook, pageHTML, objBarHTML, rotStyle, isSpread, isCoverView,
 *           currentIndices, spreadIndices, spreadIndexOfPage, spreadCount, spreadHasInsideCover
 *
 * 依赖模块：core, visuals, state（media / text-sticker 后置，只在运行时调用）
 *
 * 说明：模块间共用全局作用域，加载顺序即依赖顺序（见 index.html 与 README）。
 * ===================================================================== */
/* ==================== 阅读器 ==================== */
function isSpread() {
  return window.innerWidth >= 620 && window.innerWidth > window.innerHeight * 1.12;
}
/* 活页的尺寸关系：内页之外还压着一层封面内侧，四周露出 --bleed（左右）与上下 --bu-*；
   两页之间还有活页夹的机构缝 --ggap（单页态只占它的一半）。
   ⚠️ padX / padY / gap 三个系数来自 visuals.js 的 BOOK_STYLES，也必须和 CSS
      （reader.css 的 --bleed / --bu-t / --bu-b / --ggap）一致 —— 差一个，
      封面就会跟封面内侧差一圈。 */
function layoutBook() {
  const stage = $('#stage'), book = $('#book');
  const availW = stage.clientWidth;
  /* 文字编辑面板占住下半截时，书只在上面那一段里排版（__sheetCov 由 sheetLayout() 量出来） */
  const availH = Math.max(140, stage.clientHeight - (window.__sheetCov || 0));
  const spread = state.mode === 'spread';
  const cover = isCoverView();
  const st = bookStyleOf(cur());
  const ringed = !!st.rings;
  const bx = ringed ? (st.padX || 0) : 0;
  const by = ringed ? (st.padY || 0) : 0;
  const gf = ringed ? (st.gap || 0) : 0;
  /* 封面与内页分别取比例：笔记本 A5、画册方页、活页内页 95×170（封面比例把露边也算进去）。 */
  const RATIO = 1 / (cover ? coverRatioOf(cur()) : pageRatioOf(cur())); // 页宽 ÷ 页高
  const hScale = cover ? 1 : pageHeightScaleOf(cur());
  /* 这一屏真正要装下的横向宽度：封面态 = 一张封面（双页骨架下是两张）；
     活页摊开 = 内页 + 两侧封面露边 + 中缝；活页单页 = 内页 + 外侧封面露边 + 半道中缝。 */
  const wRatio = cover ? (spread ? 2 : 1)
    : (spread ? 2 * (1 + bx) + gf : 1 + bx + gf / 2);
  let pageH, pageW;
  if (spread) {
    pageH = Math.min(availH * 0.9 * hScale, (availW * 0.94) / (wRatio * RATIO));
    pageW = pageH * RATIO;
  } else {
    pageW = Math.min((availW * 0.94) / wRatio, availH * 0.94 * hScale * RATIO);
    pageH = pageW / RATIO;
  }
  pageH = Math.max(pageH, 180);
  /* 活页摊开 / 单页翻到内页：那道机构缝（金属条从这里伸出、环从条上跨过去）按页宽走，
     写成 px 交给 --ggap；封面态是 0。算完再按实际缝宽收一次宽度，免得缝被 clamp 放大后顶出屏幕 */
  let ggap = (ringed && !cover) ? clamp(pageW * gf, 12, 30) : 0;
  if (ringed && !cover && pageW > 0) {
    const maxW = (availW * 0.94 - (spread ? ggap : ggap / 2)) / (spread ? 2 * (1 + bx) : 1 + bx);
    if (pageW > maxW) { pageW = Math.max(maxW, 120); pageH = pageW / RATIO; }
  }
  book.style.setProperty('--pw', pageW.toFixed(1) + 'px');
  book.style.setProperty('--ph', pageH.toFixed(1) + 'px');
  book.style.setProperty('--ggap', ggap.toFixed(1) + 'px');
  /* 封面右侧两角的圆角（每本可自定义）：整本外框 / 内页纸角 / 叶片都吃这个 --cr，
     reader.css 里 --book-r 系列与 --cover-r 由它推导。左侧两角在 CSS 里写死，不动。 */
  book.style.setProperty('--cr', coverRadiusOf(cur()).toFixed(1) + 'px');
  /* 封面硬壳那张板（封面内侧 = 它的背面）在**内页坐标系**里的尺寸与偏移 ——
     宽 = 内页 + 外侧露边 + 半道中缝，高 = 内页 + 上下露边；
     板的左上角相对「左页 / 单页那一格」= -(外侧露边 or 半道缝, 上露边)。
     封面内侧照这张板来画，图案贴片才能跟封面正面一格不差（见 coverBoardHTML）。
     非活页 / 封面态三个系数都是 1 / 0，板正好铺满那一格，行为不变。 */
  const inner = ringed && !cover;
  const cw = pageW * (inner ? 1 + bx + gf / 2 : 1);
  const ch = pageH * (inner ? 1 + by * 2 : 1);
  book.style.setProperty('--cbrd-w', cw.toFixed(1) + 'px');
  book.style.setProperty('--cbrd-h', ch.toFixed(1) + 'px');
  book.style.setProperty('--cbrd-x', (inner ? -(spread ? bx : gf / 2) * pageW : 0).toFixed(1) + 'px');
  book.style.setProperty('--cbrd-y', (inner ? -by * pageH : 0).toFixed(1) + 'px');
  state.pw = pageW;          // page-flip.js 翻页时按半页宽做位移，字号换算也用它（见 state 的注释）
}
/* 页号约定：-1 = 封面正面（合着的书），-2 = 封面内侧（翻开后左半边那张皮），0 起是正文。
   ⚠️ 活页的第一跨页是「封面内侧 + 第 1 页」，不是「第 1 页 + 第 2 页」 ——
      真本子翻开就是这样，环的左边挂着的是封面内侧，不是另一张纸。 */
const PAGE_INSIDE_COVER = -2;
/* 封面页：不属于正文页，-1 表示“封面” */
function coverPageHTML() {
  const j = cur();
  return `<div class="paper coverpage">${coverHTML(j)}</div>`;
}
/* 封面硬壳那**一张板**（封面内侧，翻开后躺在左边 / 垫在活页内页底下）。
   ⚠️ 板要按**封面的真实尺寸**铺（--cbrd-w × --cbrd-h，见 layoutBook），再按板的偏移摆好 ——
      图案贴片是 .cover 上的百分比背景，只有盒子跟封面同尺寸、同比例，贴片的大小 / 疏密
      才跟封面正面一模一样；直接把背景铺在「内页那一格」上，贴片会被放大 1.21 倍（活页封面的
      宽倍率），看着就是「封面和封面内侧是两个图案」。
   ⚠️ 不画光泽（.gloss）也不画装订（.spine）：背面是哑光的、也没有书脊沟；
      压深与那层柔光交给宿主（.paper.cover-inside::after / .book-under::after）。
   ⚠️ 皮面样式只认 visuals.js 的 coverInsideStyle(j)：活页可自定义内衬
      （封面主色 / 与封面一致 / 自定义颜色或图片），其它装帧仍是「背面就是封面」。 */
function coverBoardHTML(j, extra) {
  const st = bookStyleOf(j), ins = coverInsideStyle(j);
  /* 板是封面的背面，圆角跟正面同一本（--cr）；宿主另有 border-radius:0 覆盖，见 reader.css */
  return `<div class="cover s-${st.k} cover-board${extra ? ' ' + extra : ''}" style="${ins.bg}${coverRadiusVar(j)}">`
    + (ins.tex ? `<div class="texture" style="${ins.tex}"></div>` : '')
    + `<div class="pattern" data-pat="${ins.patKey}" style="${ins.pat}"></div>`
    + `</div>`;
}
/* 封面内侧：翻开后躺在左边那一页（PAGE_INSIDE_COVER = -2） */
function insideCoverPageHTML() {
  return `<div class="paper cover-inside">${coverBoardHTML(cur())}</div>`;
}
/* 内页底下那层「封面内侧」：摊开 = 前、后两张封面板各占一半（右半那张是后封面，左右镜像）；
   单页 = 一整张。压深与受光交给 .book-under::after（见 reader.css） */
function coverUnderBoardsHTML() {
  const j = cur();
  return state.mode === 'spread'
    ? coverBoardHTML(j, 'cbrd-l') + coverBoardHTML(j, 'cbrd-r')
    : coverBoardHTML(j, 'cbrd-l');
}
/* 环的纵向位置（% 页高）：实物活页夹的环**分上下两组**，中段那截是机构面板本身、没有环，
   所以不能把 n 根环均匀铺满 —— 均匀铺看着像一把串起来的铁丝，不像活页夹。
   孔（pageHolesHTML）与环（gutterRingsHTML）共用这一组数，两端才对得上 */
function ringTops(n) {
  if (n <= 1) return [50];
  const up = Math.ceil(n / 2);          // 上组的根数（总数奇数时上组多一根）
  const step = 13, first = 12, gap = 24;
  const out = [];
  for (let i = 0; i < up; i++) out.push(first + i * step);
  const base = first + (up - 1) * step + gap;
  for (let i = 0; i < n - up; i++) out.push(base + i * step);
  return out;
}
/* 活页手帐的金属环：每根都是横跨左右孔心的一根钢丝，端点与 pageHolesHTML 共用 ringTops；
   CSS 再用 ggap + 2 × hole-x 保证横向也对准。
   ⚠️ 钢丝是**平直**的，只在中间留一丝几乎看不出的拱起（弧顶比两端高 3.7/100 个盒高 ≈ .1 环径）：
      实物活页本摊平后，环是从纸面穿过去、贴着纸走的一根杆，不是拱成半圆的钥匙圈
      （原来那版弧顶抬到盒高的一半，六根环看着像一排衣架，明显过了）。
      四层描边依次为接触影、深色轮廓、银色圆柱明暗和细高光，环压在机构条与孔洞之上。 */
function gutterRingsHTML() {
  const st = bookStyleOf(cur());
  if (!st.rings) return '';
  const tops = ringTops(st.rings);
  const ARC = 'M0 50 C70 45 130 45 200 50';
  return tops.map((t, i) => {
    const gid = `ring-metal-${i}`;
    return `<i class="ring" style="top:${t.toFixed(2)}%">`
      + `<svg class="wire" viewBox="0 0 200 100" preserveAspectRatio="none" aria-hidden="true">`
      + `<defs><linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1">`
      + `<stop offset="0" stop-color="#747c79"/><stop offset=".14" stop-color="#f8faf8"/>`
      + `<stop offset=".30" stop-color="#ffffff"/><stop offset=".48" stop-color="#c7ceca"/>`
      + `<stop offset=".66" stop-color="#777f7b"/><stop offset=".84" stop-color="#e9eeea"/>`
      + `<stop offset="1" stop-color="#fafcf9"/></linearGradient></defs>`
      + `<g fill="none" stroke-linecap="round">`
      + `<path class="ring-cast" d="${ARC}" transform="translate(0 2)" vector-effect="non-scaling-stroke"/>`
      + `<path class="ring-rim" d="${ARC}" transform="translate(0 0.7)" vector-effect="non-scaling-stroke"/>`
      + `<path class="ring-body" d="${ARC}" stroke="url(#${gid})" vector-effect="non-scaling-stroke"/>`
      + `<path class="ring-glint" d="${ARC}" transform="translate(0 -1.4)" vector-effect="non-scaling-stroke"/>`
      + `</g></svg></i>`;
  }).join('');
}
/* 每一页自己的打孔：孔洞必须跟着纸张走，不能只挂在中缝上。
   否则翻页叶片盖住中缝后，正在翻起的那一页就会看起来「没有孔」。
   左页的装订边在右，右页 / 单页的装订边在左；环由中缝的 .grings 绘制。
   位置与环共用 ringTops —— 各算一套的话环压不到孔上。 */
function pageHolesHTML(j, side) {
  const st = bookStyleOf(j);
  if (!st.rings) return '';
  const bind = side === 'left' ? 'bind-right' : 'bind-left';
  return `<div class="page-holes ${bind}" aria-hidden="true">`
    + ringTops(st.rings).map(t => `<i class="page-hole" style="top:${t.toFixed(2)}%"></i>`).join('')
    + `</div>`;
}
/* 选中对象时浮在它上方的那条胶囊工具条（形状在 style/text.css 的 .objbar 里）。
   直接挂进对象内部：拖动 / 拉伸 / 重绘都自动跟着走，不用另算坐标。
   共用「完成 / 复制 / 剪切 / 编辑 / 删除」：图片那颗编辑是「铺满整页 ⇄ 还原」，
   文字贴那颗是「编辑文字」；图片另多「换图 / 边框」，文字贴另多「字随框缩放」。
   ⚠️「复制」只把对象写进剪贴板、不就地生副本，要再执行「粘贴」才会多出一份
      （触屏空白长按菜单 / 桌面右键 / Ctrl+V），见 page-edit.js 的 objAction('copy')。
   ⚠️ 「剪切」带 .ob-cut，只在触屏 + 这个对象**被编辑过**时才露出来（刚添加的内容先收着）；
      「粘贴」不放在工具条里 —— 空白纸面长按弹的那张菜单才是粘贴入口。桌面仍走纸面右键。 */
function objBarHTML(kind, o) {
  const mid = kind === 'image'
    ? { t: o && o.fill ? '还原原比例' : '铺满整页', svg: o && o.fill ? RESTORE_SVG : FILL_SVG, cls: o && o.fill ? ' on' : '' }
    : { t: '编辑文字', svg: OB_EDIT_SVG, cls: '' };
  const swap = kind === 'image'
    ? `<button class="ob" data-ob="swap" title="换一张图">${OB_SWAP_SVG}</button>` : '';
  /* 边框只有图片有：开底部那张「图片边框」面板（拍立得 / 纯色 / 细线 / 相框 / 凹陷，颜色可自定义）。
     已经加了边框就把这颗点亮，一眼看得出这张图是带框的 */
  const frame = kind === 'image'
    ? `<button class="ob${hasFrame(o) ? ' on' : ''}" data-ob="frame" title="图片边框">${OB_FRAME_SVG}</button>` : '';
  /* 文字贴专属的「字随框缩放」开关：默认点亮（拖四角时字号一起等比缩放）。
     点灭就回到老的自由拉伸（字号不动）；桌面临时按住 Alt 拖也是这个效果。
     状态存在文字贴自己的 fsLink 上，整页重绘后按钮还是对的。 */
  const fsOn = !(o && o.fsLink === false);
  const fslink = kind === 'text'
    ? `<button class="ob${fsOn ? ' on' : ''}" data-ob="fslink" title="${fsOn ? '字随框缩放：开 · 点一下改成只改框' : '字随框缩放：关 · 点一下让字跟着框变大变小'}">${OB_FSLINK_SVG}</button>`
    : '';
  return `<div class="objbar">
      <button class="ob" data-ob="close" title="完成">${OB_OK_SVG}</button>
      <button class="ob" data-ob="copy" title="复制（粘贴后才会生成一份）">${OB_COPY_SVG}</button>
      <button class="ob ob-cut" data-ob="cut" title="剪切这个文字框或图片">${OB_CUT_SVG}</button>
      ${swap}
      ${frame}
      ${fslink}
      <button class="ob${mid.cls}" data-ob="edit" title="${mid.t}">${mid.svg}</button>
      <button class="ob ob-del" data-ob="del" title="删除">${OB_DEL_SVG}</button>
    </div>`;
}
/* 旋转写进 style：transform 转整块，--rot 留给工具条反着转回来（见 text.css 的 .objbar）。
   --cur-a / --cur-b 是拉伸手柄的指针 —— 渲染完就该是对的，不能等到动手转一圈才纠正 */
function rotStyle(o) {
  const r = +(o.rot || 0);
  if (!r) return '';
  return `--rot:${r.toFixed(1)}deg;transform:rotate(${r.toFixed(1)}deg);`
    + `--cur-a:${cursorValue(r + 45)};--cur-b:${cursorValue(r - 45)};`;
}
/* sc：边框里那几处 px（阴影 / 圆角 / 柔影长度 / 细线）按纸宽缩放的系数。
   阅读器内页纸宽就是 PAGE_W_DEFAULT=340，默认 1；DIY 自定义封面画布更宽，
   必须传 diy.W / PAGE_W_DEFAULT，才能跟封面合成（W / PAGE_W_DEFAULT）严格同源。 */
function imgWrapHTML(im, i, sc) {
  const hw = im.h || clamp(im.w / 0.68, .04, IMG_MAX);   // 老数据补兜底高度，加载后自动校准
  /* 边框：把 <img> 塞进一层 .pframe，边框画在这一层上（padding 撑出来），图片一个字节都不改。
     样式由 frameBoxStyle 算出来 —— 导出用的是同一个函数，屏幕和 PDF / SVG 长得一模一样 */
  const pic = `<img class="pimg" draggable="false" decoding="async" src="${im.src}" alt="" style="${frameImgStyle(im)}">`;
  const photo = hasFrame(im) ? `<div class="pframe" style="${frameBoxStyle(im, sc)}">${pic}${frameInsetHTML(im, sc)}</div>` : pic;
  return `
    <div class="pimg-wrap${String(im.src).startsWith('data:image/svg') ? ' sticker' : ''}${im.locked ? ' locked' : ''}${im.fill ? ' fill' : ''}${im.fit ? ' fit' : ''}${tinyCls(im, hw)}${objWasEdited(im.id) ? ' obj-edited' : ''}" data-page="${i}" data-id="${im.id}"
         style="left:${(im.x * 100).toFixed(2)}%;top:${(im.y * 100).toFixed(2)}%;width:${(im.w * 100).toFixed(2)}%;height:${(hw * 100).toFixed(2)}%;${rotStyle(im)}">
      <!-- decoding="async"：图片交给后台线程解码，翻页 / 重绘时主线程不等它，不会卡一下 -->
      ${photo}
      ${objBarHTML('image', im)}
      ${rotHandleHTML()}
      <div class="hdl tl" data-h="tl"></div>
      <div class="hdl tr" data-h="tr"></div>
      <div class="hdl bl" data-h="bl"></div>
      <div class="hdl br" data-h="br"></div>
    </div>`;
}
function textWrapHTML(t, i) {
  const st = textStyle(t);
  /* 空文字框不放任何占位文字：内容、innerText、导出三处都保持「真的没内容」。
     .empty 只负责画一条淡淡的提示（见 text.css），保存时空白框会被整条摘掉 */
  const empty = !(t.text || '').trim();
  /* 便利贴：就是一张带了便签纸皮肤的文字贴（t.note 存纸色）—— 照样能打字、挪位置、旋转 */
  const nc = normHex6(t.note);
  return `
    <div class="ptext-wrap${nc ? ' note' : ''}${empty ? ' empty' : ''}${t.locked === false ? '' : ' locked'}${objWasEdited(t.id) ? ' obj-edited' : ''}" data-page="${i}" data-id="${t.id}"
         style="left:${(t.x * 100).toFixed(2)}%;top:${(t.y * 100).toFixed(2)}%;width:${(t.w * 100).toFixed(2)}%;height:${(t.h * 100).toFixed(2)}%;${nc ? `--nc:${nc};` : ''}${rotStyle(t)}">
      <div class="ptxt${nc ? ' note' : ''}" style="${st}">${t.text ? esc(t.text) : ''}</div>
      ${objBarHTML('text', t)}
      ${rotHandleHTML()}
      <div class="hdl tl" data-h="tl"></div>
      <div class="hdl tr" data-h="tr"></div>
      <div class="hdl bl" data-h="bl"></div>
      <div class="hdl br" data-h="br"></div>
    </div>`;
}
/* 旋转手柄：挂在右边外侧的正中，往外挪开不跟四角抢位置；拖着转，双击摆正 */
function rotHandleHTML() {
  return `<div class="hdl rot" data-h="rot" title="拖动旋转 · 双击摆正">${ROT_SVG}</div>`;
}
/* 一页里的图片与文字按 z 从小到大排（z 越大越靠上）：先加的在下、后加的盖在上面。
   不再「图片一律在下、文字一律在上」—— 后贴的图就该压住先前写的字 */
function pageObjs(pg) {
  ensureZ(pg);
  const list = [];
  (pg.images || []).forEach(im => list.push({ k: 'img', o: im }));
  (pg.texts || []).forEach(t => list.push({ k: 'txt', o: t }));
  list.sort((a, b) => (a.o.z || 0) - (b.o.z || 0));
  return list;
}
function pageHTML(i, side) {
  const j = cur();
  const n = j.pages.length;
  if (i === -1) return coverPageHTML();
  if (i === PAGE_INSIDE_COVER) return insideCoverPageHTML();
  if (i < 0 || i >= n) {
    /* 活页双页摊开翻到最后一跨时，右半边其实是**后封面内侧**，不是一张纸：
       这一格要透明，露出底下 .book-under 铺的那张皮（含用户自定义的内衬），
       不能再盖一张深蓝环衬。单页态 / 胶装本没有这层皮，仍按环衬画。 */
    const see = bookStyleOf(j).rings && side === 'right';
    return `<div class="paper endpaper${see ? ' see-through' : ''}"></div>`;
  }
  const pg = j.pages[i];
  const inner = pageObjs(pg).map(o => o.k === 'img' ? imgWrapHTML(o.o, i) : textWrapHTML(o.o, i)).join('');
  const kraft = (j.template === 'kraft' || j.template === 'kraftplain') ? 'background:linear-gradient(160deg,#ecdec4,#e0cfae);' : '';
  /* 自定义内页底色写在 kraft 后面：设了色就盖住模板自己的底色，没设才沿用。
     用 pageBgShown 而不是 pageBgOf：底色面板开着时按「正在挑的那一档」显示，
     按了「完成」才真写进 pg.bg（没按就是预览，关掉面板纸面自己会回去） */
  const shown = pageBgShown(pg, j, i);
  const dark = pageBgDarkShown(pg, j, i) ? ' dark' : '';    // 深色纸：页码改浅色才看得见
  /* 活页：打孔那一列是**每页自己的纸**上的东西（孔跟着纸走，翻页时叶片上就有孔），
     并且这一列不铺内页模板（bind-left / right 让 .tplbg 在那一侧被遮掉，见 reader.css） */
  const ringed = !!bookStyleOf(j).rings;
  const bind = side === 'left' ? 'right' : 'left';
  return `<div class="paper t-${j.template}${dark}${ringed ? ' ringed bind-' + bind : ''}" style="${kraft}${shown ? 'background:' + shown + ';' : ''}">
    <div class="tplbg" style="${tplStyle(j.template, j)}"></div>
    ${pageHolesHTML(j, side)}
    <div class="pcontent">${inner}</div>
    <div class="pnum">${i + 1}</div>
  </div>`;
}
/* 双页摊开的页序 —— **活页**与「笔记本 / 方形画册」是两套，别合并：
     活页（有环）：环的左边挂着的是封面内侧，不是另一张纸 ——
        0 = 封面内侧 + 第 1 页；1 = 第 2 页 + 第 3 页；以此类推。
        「第 N 页在第几跨」= floor((N+1)/2)，全书 ceil((页数+1)/2) 跨（封面内侧也占一格）。
     笔记本 / 画册（胶装、无环）：打开就是正文，左半边是第 1 页 ——
        0 = 第 1 页 + 第 2 页；1 = 第 3 页 + 第 4 页。
        「第 N 页在第几跨」= floor(N/2)，全书 ceil(页数/2) 跨。
   ⚠️ 这两套页序只在下面三个函数里换算，别处一律调用它们 —— 写死 *2 / ÷2 会错开一页，
      而且会给没有封面内侧那格的装帧凭空造出一张「封面内侧」（合书动画里它就露在左边）。 */
/* 这一本摊开后左半边是不是「封面内侧」：只有活页是（环上挂的那张皮），笔记本 / 画册不是 */
function spreadHasInsideCover() { return !!bookStyleOf(cur()).rings; }
function spreadIndices(s) {
  if (s < 0) return [-1, -1];
  if (spreadHasInsideCover()) return [s === 0 ? PAGE_INSIDE_COVER : s * 2 - 1, s * 2];
  return [s * 2, s * 2 + 1];
}
function spreadIndexOfPage(p) {
  if (p < 0) return -1;
  return Math.floor((p + (spreadHasInsideCover() ? 1 : 0)) / 2);
}
function spreadCount(n) {
  if (n <= 0) return 1;
  return Math.ceil((n + (spreadHasInsideCover() ? 1 : 0)) / 2);
}
function currentIndices() {
  if (state.mode === 'spread') return spreadIndices(state.spread);
  return [state.page];
}
function isCoverView() {
  return state.mode === 'spread' ? state.spread < 0 : state.page < 0;
}
function renderReader() {
  commitTextEdit();                    // 重绘前先把正在编辑的文字存下来
  const book = $('#book');
  state.mode = isSpread() ? 'spread' : 'single';
  /* 第三道防线：任何路径（快翻落定 / 页数轴 / 键盘 / 删页后 / 横竖屏切换）
     都可能留下越界页码，统一在重绘前夹回合法范围。-1 是封面态，必须保留。
     少了这一步，越界时 pageHTML 会把两页都画成深蓝环衬、页码显示成「3 / 2」。 */
  const n0 = pageCount();
  if (state.mode === 'spread') {
    state.spread = clamp(state.spread, -1, Math.max(spreadCount(n0) - 1, -1));
  } else {
    state.page = clamp(state.page, -1, Math.max(n0 - 1, -1));
  }
  /* 封面就是「合着的书」：单独一整页，左边不再配一张空页 */
  const cov = isCoverView();
  /* 封面单独成页：不再加 single / spread，改用 cover-only 的骨架（跨页尺寸 + 左页收起 + 整本左移半页） */
  book.classList.toggle('single', state.mode === 'single');
  book.classList.toggle('spread', state.mode === 'spread' && !cov);
  book.classList.toggle('cover-only', cov && state.mode === 'spread');
  /* 活页手帐：双页摊开时中缝那一列要画出金属环（环数跟封面一致，见 BOOK_STYLES.rings）——
     没环的两档（笔记本 / 方形画册）清空，中缝只剩原来的折痕 */
  const ringed = !!bookStyleOf(cur()).rings;
  book.classList.toggle('ringed', ringed);
  /* 第一跨页：只有活页的左半边是封面内侧（不是正文页），整格不铺纸、圆角也跟封面一致；
     笔记本 / 画册打开就是第 1 页，那一格照正文页来铺 */
  book.classList.toggle('first-spread', state.mode === 'spread' && !cov && state.spread === 0 && ringed);
  const grings = $('#gutterRings');
  if (grings) grings.innerHTML = gutterRingsHTML();
  /* 内页底下那层封面内侧：活页翻开后内页是压在封面上的，封面比内页大一圈、四周露一条边。
     封面态（整页就是封面）不需要 —— 那就成了「封面压封面」 */
  const under = !cov && ringed;
  book.classList.toggle('has-under', under);
  const bu = $('#bookUnder');
  if (bu) bu.innerHTML = under ? coverUnderBoardsHTML() : '';
  const n = pageCount();
  const [a, b] = currentIndices();
  /* 活页最后一跨的右页越界 = 后封面内侧：整格透明，露出 .book-under 那张皮。
     类名由这里统一管，page-flip.js 只负责动画期间同步一次。 */
  book.classList.toggle('last-spread',
    state.mode === 'spread' && !cov && ringed && b >= n);
  // 重建前先摘掉文字贴挂在 document 上的监听，避免节点被换掉后残留
  $$('#slotL .ptext-wrap, #slotR .ptext-wrap').forEach(x => {
    if (x.__outDown) { document.removeEventListener('pointerdown', x.__outDown, true); x.__outDown = null; }
  });
  if (state.mode === 'spread' && !cov) {
    $('#slotL').innerHTML = pageHTML(a, 'left');
    $('#slotR').innerHTML = pageHTML(b, 'right');
  } else {
    $('#slotL').innerHTML = '';
    $('#slotR').innerHTML = pageHTML(state.mode === 'spread' ? b : state.page, 'single');
  }
  $('#leaf').classList.remove('show');
  $('#leaf').style.transform = 'none';
  // 文本
  const j = cur();
  $('#rName').textContent = j.name;
  $('#rPages').textContent = `${n} 页 · ${state.mode === 'spread' ? '双页' : '单页'}`;
  const pager = $('#pager');
  if (isCoverView()) {
    // 封面不算页数：底栏不显示页码
    pager.textContent = '封面';
    pager.classList.remove('jumpable');
    pager.title = '';
    $('#prevBtn').disabled = true;
    $('#nextBtn').disabled = n <= 0;
  } else if (state.mode === 'spread') {
    const l = a, r = b;
    let txt = '';
    if (l < 0) txt = `${r + 1} / ${n}`;          // 封面内侧不算页，只报右页
    else if (r < n) txt = `${l + 1}–${r + 1} / ${n}`;
    else txt = `${l + 1} / ${n}`;
    pager.textContent = txt;
    pager.classList.add('jumpable');
    pager.title = '长按拖动选页';
    $('#prevBtn').disabled = false;
    $('#nextBtn').disabled = state.spread >= spreadCount(n) - 1;
  } else {
    pager.textContent = `${state.page + 1} / ${n}`;
    pager.classList.add('jumpable');
    pager.title = '长按拖动选页';
    $('#prevBtn').disabled = false;
    $('#nextBtn').disabled = state.page >= n - 1;
  }
  layoutBook();
  bindPage();
  ensureImageHeights();
  ensureFillGeom();        // 老数据里「铺满 = 整页裁切」的那些，翻到时按新规矩校准一次
  // 重绘后恢复选中态（字号/颜色调整会触发重绘）
  try {
    if (selText) {
      const w = $(`#slotL .ptext-wrap[data-id="${selText.iid}"], #slotR .ptext-wrap[data-id="${selText.iid}"]`);
      const t = textById(selText.pid, selText.iid);
      /* 只有解锁状态才保留调整框（纸可能刚被面板压小过，工具条跟着重摆一次）。
         重绘前若是长按进的版式态，连四角 / 旋转手柄一起放回来（selText.box 见 page-edit.js） */
      if (w && t && t.locked === false) {
        w.classList.add('adjust');
        if (selText.box) w.classList.add('boxmode');
        fitObjBar(w);
      }
    }
  } catch (_) {}
  syncTextBar();                       // 底栏跟着当前是否选中文字切换
  const sc = $('#scrub');
  if (sc && sc.classList.contains('show')) paintScrub();
  markAddTarget();                     // 翻页后目标页描边跟着走（不在本跨页就回落到左页）
  updateAddMenuHint();
}

