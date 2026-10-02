/* =====================================================================
 * Carnet · 视觉素材 · SVG 图案 / 色板 / 字体 / 纸色   （脚本 2 / 24）
 * ---------------------------------------------------------------------
 * ① 封面与纸面的 SVG 图案：三角、圆、星、心、小花、叶
 * ② 封面明暗 coverLum、图案层 patternLayers / faceLayers、模板纸面 tplStyle
 * ③ 色板 COLORS / GRADS / RIBBONS / PAT_COLORS、内页模板 TEMPLATES
 * ④ 文字贴字体 TEXT_FONTS / EN_FONTS 与字族解析 textFontStack（字族名一律单引号，多一个引号整条作废）
 * ⑤ 内页底色色阶 PAPER_RAMPS、三级取值 pageBgOf，以及面板预览用的 pageBgShown
 * ⑥ 全项目共用的尺寸与阈值：PAGE_RATIO / PAGE_W_DEFAULT / LUM_DARK
 *
 * 对外接口：patternLayers, patternStyle, faceLayers, coverLum, TEMPLATES, TEXT_FONTS, normFont, textFontStack, PAPER_RAMPS, pageBgOf, pageBgShown, OB_*_SVG, ROT_SVG
 *
 * 依赖模块：core
 *
 * 说明：模块间共用全局作用域，加载顺序即依赖顺序（见 index.html 与 README）。
 * ===================================================================== */
/* ==================== 全项目共用的尺寸与阈值 ====================
   这里的几个值在渲染、排版、导出三处都要用到，集中放一处，改的时候不会漏 */
/* 纸张统一 3 : 4.05（和封面 .cover 同比例），阅读器排版、导出、封面渲染都按它 */
const PAGE_RATIO = 4.05 / 3;         // 页高 ÷ 页宽
const PAGE_W_DEFAULT = 340;          // 一页的基准宽（px）：模板纹理缩放、字号换算都按这个宽
const LUM_DARK = 0.55;               // 亮度低于它算「深色」：封面图案转金色、深色纸的页码转浅色

/* ==================== 图案（SVG） ==================== */
/* ===== 图案（SVG） ===== */
/* 三角形：等边三角的网格镶嵌 —— 每个三角形的三个顶点都落在网格格点上，
   与左邻右舍共用同一个顶点（一个格点上汇聚六个三角形，两两共用一整条边），
   所以任何一个三角形的三个角都连着其他三角形的角。
   配色：只画尖朝上的那一半（主色实心），尖朝下的那一半一个都不画 ——
   中间那块是彻底的镂空，直接透出封面原本的底色（纯色也好、渐变也好，原样露出来），
   相邻三角一有一无，三角形的形状一眼就能分出来。
   几何：边长 S，三角形高 H = S×√3/2；水平线上的相邻格点间距 S，上下两条线错开半格 S/2，
   竖直方向要两行才 repeating（所以贴片是 2S 宽 × 2H 高）。
   被贴片边界切开的三角形也照样画（比如贴片左右边缘那半个），平铺时相邻贴片会把它拼回去 */
function triangleTile(color) {
  const S = 24, H = +(S * Math.sqrt(3) / 2).toFixed(3);      // 20.785
  const W = 2 * S, T = +(2 * H).toFixed(3);
  /* 底边压在 y0 上、底边左端在 x，边长 S；dir=1 尖朝上（顶点在 y0-H），dir=-1 尖朝下（顶点在 y0+H） */
  const tri = (x, y0, dir, fill) => `<polygon points="`
    + [[x, y0], [x + S, y0], [x + S / 2, y0 - dir * H]]
      .map(([px, py]) => px.toFixed(2) + ',' + py.toFixed(2)).join(' ') + `" fill="${fill}"/>`;
  const up = [];
  /* 上一行：底边压在 H 线上、尖顶落在 0 线上 */
  for (let m = 0; m <= 1; m++) up.push(tri(m * S, H, 1, color));
  /* 下一行整体错开半格：底边压在 2H 线上、尖顶落在 H 线上 */
  for (let m = -1; m <= 1; m++) up.push(tri(m * S + S / 2, 2 * H, 1, color));
  return enc(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${T}" width="${W}" height="${T}">`
    + up.join('') + `</svg>`);
}
/* 圆形：56×97 贴片，圆心走三角网格 —— 相邻三个圆心间距相等、彼此成 60 度。
   四个角上的圆被贴片边界切开，平铺后自动拼回完整的大圆 */
function circleTile(color) {
  const d = 56, H = 97, r = 22;
  const pts = [[0, 0], [d, 0], [0, H], [d, H], [d / 2, H / 2]];
  const cs = pts.map(([x, y]) => `<circle cx="${x}" cy="${y}" r="${r}"/>`).join('');
  return enc(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${d} ${H}" width="${d}" height="${H}">`
    + `<g fill="${color}">${cs}</g></svg>`);
}
function starURL(color) {
  return enc(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M12 2l2.9 6.2 6.8.8-5 4.6 1.3 6.7L12 17.9 6 20.3l1.3-6.7-5-4.6 6.8-.8z" fill="${color}"/></svg>`);
}
function heartURL(color) {
  return enc(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M12 21s-8-5.2-8-11a4.7 4.7 0 018-3.3A4.7 4.7 0 0120 10c0 5.8-8 11-8 11z" fill="${color}"/></svg>`);
}
function leafURL() {
  return enc(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M12 2C7 6 4 11 4 15a8 8 0 0016 0c0-4-3-9-8-13z" fill="none" stroke="rgba(120,170,130,.9)" stroke-width="1.4"/><path d="M12 6v14" stroke="rgba(120,170,130,.7)" stroke-width="1.2"/></svg>`);
}
/* 小花：六片圆瓣 + 白花心，配几片淡色叶子 —— 仿碎花包装纸的样子。
   花心走三角网格（相邻花心间距相等、彼此成 60 度，平面上最密的一种排法），
   贴片取 W × W√3（64 × 110.85）：四角各一朵、正中间一朵。
   角上那朵被贴片边界切成四瓣，平铺时由相邻三块贴片各补一瓣，接缝处拼回完整的一朵。
   花瓣用图案色，花心固定白色（浅底上像镂空、深底上像纸花，和参考图一致），叶子用更淡的图案色 */
function flowerTile(flower, leaf) {
  const W = 64, H = +(W * Math.sqrt(3)).toFixed(2);        // 110.85
  const petals = (x, y, s, rot) => `<g fill="${flower}"`
    + ` transform="translate(${x} ${y}) rotate(${rot}) scale(${s})">`
    + [0, 60, 120, 180, 240, 300].map(a => `<ellipse cy="-9" rx="6.6" ry="10.5" transform="rotate(${a})"/>`).join('')
    + `<circle r="4.6" fill="rgba(255,255,255,.92)"/></g>`;
  const lf = (x, y, r, s) => `<path d="M0 -13C7.5 -6.5 7.5 6.5 0 13C-7.5 6.5 -7.5 -6.5 0 -13Z" fill="${leaf}"`
    + ` transform="translate(${x} ${y}) rotate(${r}) scale(${s})"/>`;
  /* 花放大到 1.3：花瓣尖直径 39×1.3≈50.7，花心间距 64 —— 相邻两朵只留约 13 的一条窄缝，
     比原来（1.15、间距 68、缝 23）大一圈也密一圈。中间那朵转 30 度错开花瓣朝向，看着更散。
     叶子缩小到 .6 填在三朵花围出的三角空隙里（空隙内切半径约 11.6，叶子半长 7.8 塞得下） */
  return enc(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">`
    + petals(0, 0, 1.3, 0) + petals(W, 0, 1.3, 0) + petals(0, H, 1.3, 0) + petals(W, H, 1.3, 0)
    + petals(W / 2, H / 2, 1.3, 30)
    + lf(W / 2, H / 6, 24, .6) + lf(W / 6, H / 2, -34, .6)
    + lf(W * 5 / 6, H / 2, 40, .6) + lf(W / 2, H * 5 / 6, -18, .6)
    + `</svg>`);
}
/* 铺满整页 / 还原原比例：四角向外为铺满，向内为还原 */
const FILL_SVG =
  '<svg fill="none" height="13" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2.2" viewBox="0 0 24 24" width="13">'
  + '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>';
const RESTORE_SVG =
  '<svg fill="none" height="13" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2.2" viewBox="0 0 24 24" width="13">'
  + '<path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5"/></svg>';
/* ---- 选中对象时那条工具条上的图标（完成 / 复制 / 编辑 / 删除 / 铺满） ---- */
/* 「完成」用对勾（这颗钮的意思是「做好了、固定下来」，不是「关掉」） */
const OB_OK_SVG =
  '<svg fill="none" height="16" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2.4" viewBox="0 0 24 24" width="16">'
  + '<path d="M5 12.6l4.6 4.6L19 7.4"/></svg>';
const OB_COPY_SVG =
  '<svg fill="none" height="16" stroke="currentColor" stroke-linejoin="round" stroke-width="1.9" viewBox="0 0 24 24" width="16">'
  + '<rect height="11.4" rx="2.6" width="11.4" x="8.4" y="8.4"/>'
  + '<path d="M15.9 8.4V6.3a2.3 2.3 0 00-2.3-2.3H6.3A2.3 2.3 0 004 6.3v7.3a2.3 2.3 0 002.3 2.3h2.1"/></svg>';
const OB_EDIT_SVG =
  '<svg fill="none" height="16" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.9" viewBox="0 0 24 24" width="16">'
  + '<path d="M4.4 19.6h4.1L19.4 8.7a1.9 1.9 0 000-2.7l-1.4-1.4a1.9 1.9 0 00-2.7 0L4.4 15.5v4.1z"/>'
  + '<path d="M14.6 5.9l3.5 3.5"/></svg>';
const OB_DEL_SVG =
  '<svg fill="none" height="16" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" viewBox="0 0 24 24" width="16">'
  + '<path d="M4.6 6.7h14.8"/>'
  + '<path d="M9.7 6.7V4.9h4.6v1.8"/>'
  + '<path d="M6.5 6.7l.85 11.7a1 1 0 001 .93h7.3a1 1 0 001-.93l.85-11.7"/>'
  + '<path d="M10.4 10.4v5.5"/>'
  + '<path d="M13.6 10.4v5.5"/></svg>';
/* 旋转手柄上的图标：一个转圈的箭头，让人一眼看出这颗管的是转 */
const ROT_SVG =
  '<svg fill="none" height="13" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2.3" viewBox="0 0 24 24" width="13">'
  + '<path d="M21 12a9 9 0 11-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/>'
  + '<path d="M21 3v5h-5"/></svg>';
/* 文字色板：深浅都在，白色给深色纸用 */
const TEXT_COLORS = ['#2b2f3d', '#ffffff', '#e0668a', '#4a6ea8', '#4d8a6a', '#b5651d', '#8d94ab'];
/* 文字高亮：空串 = 不加高亮（面板上画成一个空心圆） */
const TEXT_BGS = ['', '#ffe066', '#ffc2d8', '#bfe4ff', '#c9f0d4', '#e6d4ff'];
/* 文字贴字体：手写体打头（也是新建文字的默认值）。
   字族本身写在 style/base.css 的 --font-hand / --font-kai 里，这里只存 CSS 变量引用，
   页面内直接吃变量；导出时再用 textFontStack() 把变量读成真实的字族串。
   song 走系统字体栈（项目里只自带一套手写体，宋体靠系统），栈末的通用族不能省。
   黑体（hei）2026-10-02 撤掉了，见下面的 FONT_ALIAS。 */
const TEXT_FONTS = [
  { k: 'hand',  n: '手写体',    abbr: '手写', css: 'var(--font-hand)' },
  { k: 'kai',   n: '楷体',      abbr: '楷体', css: 'var(--font-kai)' },
  { k: 'song',  n: '宋体',      abbr: '宋体', css: "'Songti SC','STSong','SimSun','宋体',serif" },
  { k: 'plain', n: '默认字体',  abbr: '默认', css: '' }
];
/* 撤掉的字体档：老本子里可能还存着 'hei'，给它指个去处（同是无衬线系统字，落到「默认字体」），
   免得 normFont 兜底成手写体、把以前的字整页换了样 */
const FONT_ALIAS = { hei: 'plain' };
/* 英文字体：排在中文前面，拉丁字走它、汉字自动落到后面的中文字体。
   ⚠️ 这里一档都不能带通用族（serif / monospace / cursive 之类）——通用族能匹配所有字符，
   写在前面会把中文字体整条截胡，汉字全变成默认字体。收尾的通用族留给中文字体那条栈。 */
const EN_FONTS = [
  { k: '',       n: '跟随中文', css: '' },
  { k: 'serif',  n: '衬线',    css: "'Georgia','Times New Roman',Cambria" },
  { k: 'mono',   n: '等宽',    css: "'Consolas','Menlo','Courier New'" },
  { k: 'script', n: '手写',    css: "'Segoe Script','Bradley Hand','Lucida Handwriting'" }
];
function normFont(k) {
  const key = FONT_ALIAS[k] || k;
  return TEXT_FONTS.some(f => f.k === key) ? key : 'hand';
}
function textFontVar(k) { return (TEXT_FONTS.find(f => f.k === normFont(k)) || TEXT_FONTS[0]).css; }
function normEnFont(k) { return EN_FONTS.some(f => f.k === k) ? k : ''; }
function textEnVar(k) { return (EN_FONTS.find(f => f.k === normEnFont(k)) || EN_FONTS[0]).css; }
/* 导出用：把 CSS 变量解析成字族原文（导出的 XHTML 是独立文档，认不到本页的变量）。
   字族名一律用单引号——这串要塞进 style="…" 里，双引号会把属性提前截断。 */
function textFontStack(k) {
  const f = TEXT_FONTS.find(x => x.k === normFont(k)) || TEXT_FONTS[0];
  if (f.k === 'plain') return 'inherit';
  /* hand / kai 存的是 CSS 变量引用，导出前得读成真实字族；song 本身就是字族串，直接用 */
  if (f.css && f.css.indexOf('var(') !== 0) return f.css.replace(/"/g, "'");
  const v = getComputedStyle(document.documentElement)
    .getPropertyValue(f.k === 'kai' ? '--font-kai' : '--font-hand');
  const s = (v || '').trim() || (f.k === 'kai' ? '"KaiTi","楷体",serif' : 'cursive');
  return s.replace(/"/g, "'");
}
function textEnStack(k) {
  return ((EN_FONTS.find(f => f.k === normEnFont(k)) || EN_FONTS[0]).css || '').replace(/"/g, "'");
}
const PATTERNS = [
  { k: 'none', n: '无' },
  { k: 'dots', n: '圆点' },
  { k: 'grid', n: '网格' },
  { k: 'lines', n: '斜纹' },
  { k: 'stripe', n: '竖纹' },
  { k: 'check', n: '菱格' },
  { k: 'circle', n: '圆形' },
  { k: 'triangle', n: '三角形' },
  { k: 'star', n: '星光' },
  { k: 'heart', n: '爱心' },
  { k: 'flower', n: '小花' },
  { k: 'leaf', n: '叶脉' },
];
/* 旧图案名 → 新图案名：曼陀罗改为圆形、齿轮改为三角形。
   老数据和旧版本导出的文件都靠它兼容，遇到其它非法值一律按「无图案」处理 */
const PAT_MAP = { mandala: 'circle', gear: 'triangle' };
function normPat(p) { return PAT_MAP[p] || (PATTERNS.some(x => x.k === p) ? p : 'none'); }
/* 计算封面亮度，让图案在深/浅底上都清晰 */
function coverLum(cover) {
  if (cover.img) return 0.45;
  const m = String(cover.value || '').match(/#[0-9a-fA-F]{3,6}/);
  let hex = m ? m[0].replace('#', '') : '888888';
  if (hex.length === 3) hex = hex.split('').map(x => x + x).join('');
  const n = parseInt(hex.slice(0, 6), 16);
  const r = (n >> 16 & 255) / 255, g = (n >> 8 & 255) / 255, b = (n & 255) / 255;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
/* 用户自定义的图案颜色：六位 hex 才生效，否则回落到「跟随底色深浅」的自动配色 */
function hexA(hex, a) {
  let h = String(hex || '').replace('#', '');
  if (h.length === 3) h = h.split('').map(x => x + x).join('');
  const n = parseInt(h.slice(0, 6), 16);
  return `rgba(${n >> 16 & 255},${n >> 8 & 255},${n & 255},${a})`;
}
/* 结构化返回图案的每一层，供封面渲染与预览共用，保证两边完全一致 */
function patternLayers(k, cover) {
  const dark = !cover || coverLum(cover) < LUM_DARK;
  const pc = cover && /^#[0-9a-fA-F]{6}$/i.test(String(cover.patColor || '')) ? cover.patColor : null;
  /* 设了图案颜色就以它为准：主形状 85% 不透明度，网格 / 斜纹这类细线用 50% */
  const c  = pc ? hexA(pc, .85) : (dark ? 'rgba(255,255,255,.52)' : 'rgba(92,80,112,.32)');
  const c2 = pc ? hexA(pc, .5)  : (dark ? 'rgba(255,255,255,.34)' : 'rgba(92,80,112,.2)');
  const gold = pc ? c : (dark ? 'rgba(246,216,144,.95)' : 'rgba(214,162,54,.9)');
  const pink = pc ? c : (dark ? 'rgba(255,158,190,.9)' : 'rgba(226,110,150,.9)');
  /* 三角用蓝、圆用橙；深底上提亮、浅底上压深，保证两种封面都看得清 */
  const blue = pc ? c : (dark ? 'rgba(138,186,232,.92)' : 'rgba(58,110,181,.85)');
  const orange = pc ? c : (dark ? 'rgba(246,170,96,.92)' : 'rgba(226,113,28,.85)');
  /* 平铺尺寸用百分比（宽相对封面宽、高相对封面高，宿主都是 3:4.05 的封面），
     图案随封面等比缩放——主页、阅读器、搜索缩略图里的疏密完全一致（以 238px 宽为基准） */
  switch (k) {
    case 'dots': return { img: `radial-gradient(${c} 1.7px,transparent 1.9px)`, size: '9.4% 6.96%', pos: '0 0', rep: 'repeat' };
    case 'grid': return { img: `linear-gradient(${c2} 1px,transparent 1px),linear-gradient(90deg,${c2} 1px,transparent 1px)`, size: '14.1% 10.44%,14.1% 10.44%', pos: '0 0,0 0', rep: 'repeat,repeat' };
    /* 斜纹：色标沿 45° 渐变线取百分比（渐变线长度 = (宽+高)×sin45°，同比例封面下随宽度等比缩放），
       主页小封面 / 阅读器大封面 / 导出大图疏密一致 —— 写死 px 会两头不一样（2.02%≈238px 封面上的 8px） */
    case 'lines': return { img: `repeating-linear-gradient(45deg,${c2} 0,${c2} 2.02%,transparent 2.02%,transparent 5.56%)`, size: 'auto', pos: '0 0', rep: 'repeat' };
    /* 竖纹：条纹宽度用百分比（相对封面宽），主页小封面与阅读器大封面疏密一致 */
    case 'stripe': return { img: `repeating-linear-gradient(90deg,${c} 0 11%,transparent 11% 18.5%)`, size: 'auto', pos: '0 0', rep: 'repeat' };
    /* 菱格：旋转 45° 的棋盘格，深浅两色相间；贴片必须保持正方形（宽高按 3:4.05 折算）菱形才不变形 */
    case 'check': return { img: `conic-gradient(from 45deg,${c} 25%,transparent 0 50%,${c} 0 75%,transparent 0)`, size: '23.5% 17.4%', pos: '0 0', rep: 'repeat' };
    case 'circle': return { img: `url('${circleTile(orange)}')`, size: '33% 42.3%', pos: '0 0', rep: 'repeat' };
    /* 三角形：48×41.57 的贴片（边长 24 的等边三角），高度按贴片比例折算（÷1.35 = 封面的高宽比 4.05/3）
       横向 40% —— 一个贴片横着放两个三角，所以单个三角约占封面宽的 20%
       只画朝上的三角，朝下的那三块留空（完全透明），透出封面底色 */
    case 'triangle': return { img: `url('${triangleTile(blue)}')`, size: '40% 25.66%', pos: '0 0', rep: 'repeat' };
    case 'star': return { img: `url('${starURL(gold)}')`, size: '27.1% 20.1%', pos: '0 0', rep: 'repeat' };
    case 'heart': return { img: `url('${heartURL(pink)}')`, size: '20% 14.8%', pos: '0 0', rep: 'repeat' };
    /* 小花：贴片 64×110.85（三角网格），size 两维按「宽 27% / 高 34.64%」折算
       （34.64% × 1.35 ÷ 27% = 1.732 = 贴片的高宽比）才不会被拉变形；
       一朵花约占封面宽的 21%（原来 15.9%），花心间距 27%，缝只剩 5.6% */
    case 'flower': return { img: `url('${flowerTile(pink, c2)}')`, size: '27% 34.64%', pos: '0 0', rep: 'repeat' };
    case 'leaf': return { img: `url('${leafURL()}')`, size: '27.1% 20.1%', pos: '0 0', rep: 'repeat' };
    default: return null;
  }
}
function patternStyle(k, cover) {
  const L = patternLayers(k, cover);
  if (!L) return '';
  return `background-image:${L.img};background-size:${L.size};background-position:${L.pos};background-repeat:${L.rep};`;
}
/* 把底色与图案合成成一组 background 层：图案在上、底色在下。
   注意：纯色底色只能走 background-color——塞进 background-image 会让整条声明失效，图案预览就画不出来了 */
function faceLayers(cover, patKey) {
  const raw = cover.img ? `url("${cover.img}")` : String(cover.value || '');
  const asImage = cover.img || /^(repeating-)?(linear|radial|conic)-gradient|^url\(/i.test(raw.trim());
  const face = asImage ? raw : '';
  const color = asImage ? '' : raw;
  /* 用了上传的封面图片就不叠图案：图案是按底色深浅配色的，压在照片上只会糊成一片 */
  const L = patKey && patKey !== 'none' && !cover.img ? patternLayers(patKey, cover) : null;
  if (!L) return { image: face, color, size: 'cover', pos: 'center', rep: 'no-repeat' };
  return {
    image: face ? L.img + ', ' + face : L.img,
    color,
    size: face ? L.size + ', cover' : L.size,
    pos: face ? L.pos + ', center' : L.pos,
    rep: face ? L.rep + ', no-repeat' : L.rep
  };
}

/* ==================== 调色板 ==================== */
const COLORS = ['#f6d6c8','#f4a9b8','#e97ea0','#f3c98b','#f0e2b0','#cfe3c9','#9fc9b6','#bcd4f0','#8fb0e0','#c9b8ec','#a596d4','#b8bdd0','#6d748f','#3a4358','#222838','#f4f1ea'];
const GRADS = [
  'linear-gradient(160deg,#f7c6c9,#efa2b3 60%,#e2819f)',
  'linear-gradient(160deg,#fbe3b6,#f5c886 60%,#e8a559)',
  'linear-gradient(160deg,#cfe3f7,#a8c8ed 60%,#84abdd)',
  'linear-gradient(160deg,#d8f0e4,#a7dbc5 60%,#78c1a4)',
  'linear-gradient(160deg,#e7daf5,#c8b2e8 60%,#a78dd5)',
  'linear-gradient(160deg,#3d4a6b,#2b3550 60%,#1b2135)',
  'linear-gradient(160deg,#f3e2c7,#e2c69a 60%,#c8a675)',
  'linear-gradient(160deg,#f0f0f2,#d8dae3 60%,#b9bdcb)',
];
const RIBBONS = ['#2b3550','#c98a8a','#e0668a','#d9a94f','#6f9e7a','#4f7ab5','#8a5fbf','#b5533f','#333333','#f0e6d2','#0f6b6b','#7a5230'];
/* 彩带那一档「透明」：书脊（封面左侧那条）整个不画，只留封面本身。
   存成 'none' 而不是颜色值，导入导出和比对都按普通字符串走 */
const RIBBON_NONE = 'none';
/* 书脊的背景渐变：透明档 / 非法值都返回空串，由调用方决定画不画书脊 */
function ribbonSpine(ribbon) {
  let r = String(ribbon || '').trim();
  if (!r || r === RIBBON_NONE) return '';
  if (!/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(r)) return '';
  if (r.length === 4) r = '#' + r.slice(1).split('').map(x => x + x).join('');
  return `linear-gradient(90deg,${shade(r, -22)},${r} 55%,${shade(r, 14)})`;
}
/* 图案颜色预设：饱和度高一档，压在浅底 / 深底上都醒目 */
const PAT_COLORS = ['#e2819f','#e0668a','#e8a559','#d6a236','#78c1a4','#4f9e7a','#84abdd','#3a6db5','#a78dd5','#6d5fbf','#b5533f','#2b3550'];
const TEMPLATES = [
  { k: 'blank', n: '空白' }, { k: 'lined', n: '横线' }, { k: 'grid', n: '方格' },
  { k: 'dots', n: '点阵' }, { k: 'kraftplain', n: '牛皮纸' }, { k: 'kraft', n: '牛皮纸（横线）' },
];
function tplStyle(k) {
  switch (k) {
    case 'lined': return 'background-image:repeating-linear-gradient(transparent 0,transparent 27px,#dfe3ee 27px,#dfe3ee 28px);background-position:0 34px;';
    case 'grid': return 'background-image:linear-gradient(#e8ebf3 1px,transparent 1px),linear-gradient(90deg,#e8ebf3 1px,transparent 1px);background-size:23px 23px;';
    case 'dots': return 'background-image:radial-gradient(#d2d8e8 1.35px,transparent 1.45px);background-size:20px 20px;';
    /* kraftplain 空白牛皮纸不画纹理，底色由 .paper.t-kraftplain 提供 */
    case 'kraft': return 'background-image:repeating-linear-gradient(transparent 0,transparent 27px,rgba(120,96,64,.22) 27px,rgba(120,96,64,.22) 28px);background-position:0 34px;';
    default: return '';
  }
}
/* ---- 内页底色 ----
   两级：单页 pg.bg 盖住整本 j.pageBg，整本再盖住模板自己的底色。
   色阶：九组（纸 / 暖 / 粉 / 黄 / 绿 / 蓝 / 紫 / 灰 / 墨），每组六档「由浅到深」。
   「本页底色」弹窗把九组整组摆出来；前八组的前三档是能写字的纸
   （牛皮纸模板亮度约 .84，浅纸档都压在这个附近，再浅就跟没设一样、看不出换了色），
   末尾「灰 / 墨」两组的深色档是给深色手帐用的。
   硬约束：写字用的那些档 `hexLum` 要留在 LUM_DARK（.55）以上，低于它 pageBgDarkShown 会把页码转浅 */
const PAPER_RAMPS = [
  { n: '纸', c: ['#fdfaf3', '#f7f1e3', '#efe4cb', '#e5d5ac', '#d3bf95', '#b99f74'] },
  { n: '暖', c: ['#fbeee7', '#f6dfd2', '#f0c9b6', '#e8ad94', '#d68f74', '#b9705a'] },
  { n: '粉', c: ['#fdeef2', '#f9dde5', '#f4c6d4', '#eea9bf', '#dc86a3', '#b86583'] },
  { n: '黄', c: ['#fdf6e3', '#faedc4', '#f3df9a', '#e8cd72', '#d4b455', '#ad8f3c'] },
  { n: '绿', c: ['#eef7ee', '#dcecdc', '#c4dfc5', '#a5cda8', '#84b589', '#5f9265'] },
  { n: '蓝', c: ['#eef4fb', '#dce8f6', '#c2d8ee', '#a3c4e3', '#83a9d3', '#5d86b3'] },
  { n: '紫', c: ['#f2eefa', '#e5ddf5', '#d1c5ee', '#b8a8e2', '#9a86cd', '#7665a8'] },
  { n: '灰', c: ['#f4f4f3', '#e4e5e2', '#cccec9', '#adb1ac', '#8b908e', '#6a706e'] },
  { n: '墨', c: ['#8f97a8', '#6f7891', '#545d78', '#3f4759', '#2f3542', '#1e222b'] },
];
/* 只认 #rgb / #rrggbb；其它（空、'auto'、乱填的）一律当「没设」，落回模板底色 */
function normPaperBg(v) {
  let s = String(v || '').trim();
  if (!s || s === 'auto') return '';
  if (/^#[0-9a-fA-F]{3}$/.test(s)) s = '#' + s.slice(1).split('').map(x => x + x).join('');
  return /^#[0-9a-fA-F]{6}$/.test(s) ? s.toLowerCase() : '';
}
/* 这一页实际该用什么底色：'' = 沿用模板（牛皮纸仍是牛皮纸） */
function pageBgOf(pg, j) { return normPaperBg(pg && pg.bg) || normPaperBg(j && j.pageBg) || ''; }
/* 底色面板开着时纸面按「正在挑的那一档」显示，按了「完成」才真写进 pg.bg。
   预览只活在 window.__bgPv（{ pid, hex }）上，数据一个字节都不动 ——
   所以关掉面板（取消）时纸面自动回到原色，导出 / 存档也一直是原色。
   hex 为 '' 表示「这一页不自带颜色」，跟 pageBgOf 的语义一致 */
function pageBgShown(pg, j, pid) {
  const pv = window.__bgPv;
  if (pv && pv.pid === pid) return normPaperBg(pv.hex);
  return pageBgOf(pg, j);
}
/* 预览版的「纸色偏深吗」：页码要不要转浅，得按屏幕上正在显示的那一档算 */
function pageBgDarkShown(pg, j, pid) {
  const c = pageBgShown(pg, j, pid);
  return !!c && hexLum(c) < LUM_DARK;
}
/* 任意 hex 的相对亮度（0~1）。纸色设得深时页码要换成浅色，否则看不见 */
function hexLum(hex) {
  let h = String(hex || '').replace('#', '');
  if (h.length === 3) h = h.split('').map(x => x + x).join('');
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return 1;
  const n = parseInt(h, 16);
  return (0.2126 * (n >> 16 & 255) + 0.7152 * (n >> 8 & 255) + 0.0722 * (n & 255)) / 255;
}

