/* =====================================================================
 * Carnet · 视觉素材 · SVG 图案 / 色板 / 字体 / 纸色   （脚本 2 / 27）
 * ---------------------------------------------------------------------
 * ① 封面与纸面的 SVG 图案：圆、星、心、叶（三角 / 小花两档已下线）
 * ② 封面明暗 coverLum、图案层 patternLayers / faceLayers（缩略图统一自动色、成品保留预设色）、
 *    模板纸面 tplStyle
 * ③ 色板 COLORS / GRADS / RIBBONS / PAT_COLORS、内页模板 TEMPLATES（含自定义图片模板）
 * ④ 文字贴字体 TEXT_FONTS / EN_FONTS 与字族解析 textFontStack（字族名一律单引号，多一个引号整条作废；
 *    EN_FONTS 后四档是项目自带的 woff2，face 字段供导出内嵌用）
 * ⑤ 内页底色色阶 PAPER_RAMPS、三级取值 pageBgOf，以及面板预览用的 pageBgShown
 * ⑥ 全项目共用的尺寸与阈值：PAGE_RATIO / PAGE_W_DEFAULT / LUM_DARK / 封面翻口圆角
 * ⑦ 装帧样式 BOOK_STYLES（笔记本 / 活页 / 方形画册 / 精装书）与内页比例 pageRatioOf
 * ⑧ 图片边框 FRAMES：边框盒样式 frameBoxStyle / 图片样式 frameImgStyle（屏幕与导出共用）
 * ⑨ 活页封面内侧 coverInsideStyle（自动主色 / 与封面一致 / 自定义）、书槽开关 coverGrooveOn
 *
 * 对外接口：patternLayers, patternStyle, faceLayers, coverLum, isImgData, TEMPLATES, tplImgOf, TPL_IMGS_MAX, tplImgsOf, normTplFit, tplStyle, TEXT_FONTS, EN_FONTS, normFont, textFontVar, textFontStack, normEnFont, textEnVar, textEnStack, PAPER_RAMPS, pageBgOf, pageBgShown, OB_*_SVG, ROT_SVG, BOOK_STYLES, bookStyleOf, pageRatioOf, COVER_R_MIN, COVER_R_MAX, coverRadiusOf, coverRadiusVar, bookRadiusOf, INSIDE_MODES, INSIDE_PALETTE_MAX, normInsideMode, insideOf, insideModeOf, coverInsideStyle, dominantColorsOf, coverInsidePalette, enFontSample, coverGrooveOn, FRAMES, frameBoxStyle, frameImgStyle
 *
 * 依赖模块：core
 *
 * 说明：模块间共用全局作用域，加载顺序即依赖顺序（见 index.html 与 README）。
 * ===================================================================== */
/* ==================== 全项目共用的尺寸与阈值 ====================
   这里的几个值在渲染、排版、导出三处都要用到，集中放一处，改的时候不会漏 */
/* 默认笔记本采用 A5：148mm × 210mm；不同装帧的封面 / 内页尺寸在 BOOK_STYLES 中单独声明。 */
const PAGE_RATIO = 210 / 148;        // 默认内页高 ÷ 宽（A5）
const PAGE_W_DEFAULT = 340;          // 一页的基准宽（px）：模板纹理缩放、字号换算都按这个宽
const LUM_DARK = 0.55;               // 亮度低于它算「深色」：封面图案转金色、深色纸的页码转浅色

/* ==================== 封面翻口圆角（每本可自定义） ====================
   只放开**右侧两个角**（翻口）：左侧靠书脊那两个角属于装帧，固定不动。
   cover.radius 存的是「主页封面」上的 px（--cover-w 158~246px 时就是这么多像素），
   阅读器外框 / 导出版按各自倍率折算，四处弧度一起变。
   ⚠️ 老本子没有这个字段 = 按装帧走默认档（笔记本 / 画册 10px、活页 16px），
      故意不把默认值写进数据，将来调默认档老本子才会跟着走。
   ⚠️ 影响范围：主页 / 书架预览 / 搜索缩略图 / 编辑器预览 / 阅读器外框 / 飞入动画 /
      PDF · SVG · 长图导出的封面页，全部经 coverRadiusOf 这一处取值。 */
const COVER_R_MIN = 0, COVER_R_MAX = 36;
const COVER_R_DEFAULT = { classic: 10, personal: 16, square: 10, hardcover: 6 };
function coverRadiusOf(j) {
  const raw = j && j.cover ? j.cover.radius : undefined;
  const v = Number(raw);
  const def = COVER_R_DEFAULT[normBookStyle(j && j.style)] || 10;
  return (raw !== undefined && raw !== null && raw !== '' && Number.isFinite(v))
    ? clamp(v, COVER_R_MIN, COVER_R_MAX) : def;
}
/* 写进 .cover / .cover-board 的内联变量（它们的 border-radius 直接吃 --cr） */
function coverRadiusVar(j) { return `--cr:${coverRadiusOf(j).toFixed(1)}px`; }
/* 阅读器「整本外框」的翻口圆角：主页 10 → 阅读器 16（活页 16 → 25），按装帧倍率折算 */
function bookRadiusOf(j) {
  return coverRadiusOf(j) * (isRingStyle(j && j.style) ? 25 / 16 : 16 / 10);
}

/* ==================== 图案（SVG） ==================== */
/* ===== 图案（SVG） ===== */
/* 三角形与小花两档已下线（2026-11-08），贴片生成器一并删掉，老数据由 PAT_MAP / normPat 兜底。
   圆形：56×97 贴片，圆心走三角网格 —— 相邻三个圆心间距相等、彼此成 60 度。
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
/* 叶脉：轮廓 + 主脉两笔。
   · 预览缩略图 / 用户挑了图案色：只传 color，两笔同色、主脉压淡，跟圆点网格同一套。
   · 真封面的预设色：传 veinColor，恢复原来的绿色（轮廓 .9 / 主脉 .7）。 */
function leafURL(color, veinColor) {
  const vein = veinColor
    ? `<path d="M12 6v14" stroke="${veinColor}" stroke-width="1.2"/>`
    : `<path d="M12 6v14" stroke="${color}" stroke-width="1.2" opacity=".72"/>`;
  return enc(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M12 2C7 6 4 11 4 15a8 8 0 0016 0c0-4-3-9-8-13z" fill="none" stroke="${color}" stroke-width="1.4"/>${vein}</svg>`);
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
/* 图片工具条上的「换图」：两个反向的箭头，意思是把现在这张换成另一张 */
const OB_SWAP_SVG =
  '<svg fill="none" height="16" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.9" viewBox="0 0 24 24" width="16">'
  + '<path d="M4 8h14"/><path d="M15 5l3 3-3 3"/>'
  + '<path d="M20 16H6"/><path d="M9 13l-3 3 3 3"/></svg>';
/* 图片工具条上的「边框」：外面一个方框、里面再套一个 —— 一眼就是「给照片加个框」 */
const OB_FRAME_SVG =
  '<svg fill="none" height="16" stroke="currentColor" stroke-linejoin="round" stroke-width="1.8" viewBox="0 0 24 24" width="16">'
  + '<rect height="16" rx="2.4" width="16" x="4" y="4"/>'
  + '<rect height="8" rx="1.2" width="8" x="8" y="8"/></svg>';
/* 文字贴工具条上的「字随框缩放」：一个 A 加一支指向右下的放大箭头。
   点亮 = 拖四角时字号跟着等比缩放；点灭 = 只改框、字号不动 */
const OB_FSLINK_SVG =
  '<svg fill="none" height="16" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.9" viewBox="0 0 24 24" width="16">'
  + '<path d="M3.2 18.6L8.6 5.4l5.4 13.2"/><path d="M5.2 14.2h6.8"/>'
  + '<path d="M15.6 15.6l4.5 4.5"/><path d="M20.1 15.6v4.5h-4.5"/></svg>';
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
   写在前面会把中文字体整条截胡，汉字全变成默认字体。收尾的通用族留给中文字体那条栈。
   前四档用系统字体；后四档是项目自带的 woff2（@font-face 见 style/base.css 顶部）。
   · face：{ family, file }，导出时 io-doc.js 把 woff2 转 base64 内嵌进 XHTML，
     独立文档才认得这个字族。family 必须与 base.css 里的字族名一字不差。
   · fallback：内嵌拿不到字体时（file:// 下 fetch 被禁、文件被删）的近似系统字体链，
     只写具体字体名、不写通用族，免得截胡中文。
   · hint：面板按钮的悬浮说明，写着原字体名，比两字中文名好认。 */
const EN_FONTS = [
  { k: '',       n: '跟随中文', css: '' },
  { k: 'serif',  n: '衬线',    css: "'Georgia','Times New Roman',Cambria" },
  { k: 'mono',   n: '等宽',    css: "'Consolas','Menlo','Courier New'" },
  { k: 'script', n: '手写',    css: "'Segoe Script','Bradley Hand','Lucida Handwriting'" },
  { k: 'courier', n: '打字机', hint: 'Courier Prime · 打字机等宽',
    css: "'CarnetCourierPrime'", fallback: "'Courier New','Courier'",
    face: { family: 'CarnetCourierPrime', file: 'CourierPrime-Regular.woff2' } },
  { k: 'cutive', n: '复古等宽', hint: 'Cutive Mono · 复古打字机',
    css: "'CarnetCutiveMono'", fallback: "'Courier New','Courier'",
    face: { family: 'CarnetCutiveMono', file: 'CutiveMono-Regular.woff2' } },
  { k: 'pixel', n: '像素', hint: 'Pixelify Sans · 像素风',
    css: "'CarnetPixelifySans'", fallback: "'Consolas','Courier New'",
    face: { family: 'CarnetPixelifySans', file: 'PixelifySans-Regular.woff2' } },
  { k: 'elite', n: '旧打字机', hint: 'Special Elite · 做旧打字机',
    css: "'CarnetSpecialElite'", fallback: "'Courier New','Courier'",
    face: { family: 'CarnetSpecialElite', file: 'SpecialElite-Regular.woff2' } }
];
function normFont(k) {
  const key = FONT_ALIAS[k] || k;
  return TEXT_FONTS.some(f => f.k === key) ? key : 'hand';
}
function textFontVar(k) { return (TEXT_FONTS.find(f => f.k === normFont(k)) || TEXT_FONTS[0]).css; }
function normEnFont(k) { return EN_FONTS.some(f => f.k === k) ? k : ''; }
/* 英文字体按钮上的拉丁样例（阅读器文字面板 / DIY 封面文字面板共用）：
   这些字族只有拉丁字形，按钮上光写「衬线 / 等宽 / 手写」这种中文名，
   点之前一点都看不出字体长什么样 —— 补一个套了对应字族的 Aa。
   第一档「跟随中文」没有独立字族，不显示样例。 */
function enFontSample(f) {
  if (!f || !f.k || !f.css) return '';
  return `<span style="font-family:${f.css};font-size:1.16em;font-weight:600;font-style:normal;letter-spacing:.01em">Aa</span> `;
}
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
/* 导出用：自带字体那几档后面再接一条近似系统字体链。内嵌成功时第一个字族就把拉丁字吃掉了，
   fallback 用不上；内嵌失败（file:// 下 fetch 被禁、字体文件被删）时也不会整条落到中文字体上去。
   前四档没有 fallback，输出跟以前一字不差。 */
function textEnStack(k) {
  const f = EN_FONTS.find(x => x.k === normEnFont(k)) || EN_FONTS[0];
  return [f.css, f.fallback].filter(Boolean).join(',').replace(/"/g, "'");
}
const PATTERNS = [
  { k: 'none', n: '无' },
  { k: 'dots', n: '圆点' },
  { k: 'grid', n: '网格' },
  { k: 'lines', n: '斜纹' },
  { k: 'stripe', n: '竖纹' },
  { k: 'check', n: '菱格' },
  { k: 'circle', n: '圆形' },
  { k: 'star', n: '星光' },
  { k: 'heart', n: '爱心' },
  { k: 'leaf', n: '叶脉' },
];
/* 旧图案名 → 新图案名：曼陀罗改为圆形；齿轮原本映射三角形，三角形下线后落回「无」。
   「三角形」「小花」两档 2026-11-08 已删除，老数据 / 旧导出文件里还存着这两个值时一律按「无图案」渲染，
   main.js 的启动迁移也用这张表把它们就地改写成 none。 */
const PAT_MAP = { mandala: 'circle', gear: 'none', triangle: 'none', flower: 'none' };
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
/* 结构化返回图案的每一层。
   ⚠️ 预览图与真封面的配色是**两条路**（用户 2026-11-08 明确要求）：
     · preview = true（只给 #edPatterns 缩略图 / faceLayers 用）：所有图案统一用 c，
       一整排摆在一起颜色一致；圆形也在这一档里，不再单独露橙色。
     · preview 不传（patternStyle，主页 / 阅读器 / 导出）：每个装饰图案用自己的预设色 ——
       圆形橙、星光金、爱心粉、叶脉绿。圆点 / 网格 / 斜纹 / 竖纹 / 菱格本来就是 c / c2 自动色。
     · 用户显式挑了 patColor：两条路都以它为准，预览和成品不会打架。 */
function patternLayers(k, cover, preview) {
  const dark = !cover || coverLum(cover) < LUM_DARK;
  const pc = cover && /^#[0-9a-fA-F]{6}$/i.test(String(cover.patColor || '')) ? cover.patColor : null;
  /* 设了图案颜色就以它为准：主形状 85% 不透明度，网格 / 斜纹这类细线用 50% */
  const c  = pc ? hexA(pc, .85) : (dark ? 'rgba(255,255,255,.52)' : 'rgba(92,80,112,.32)');
  const c2 = pc ? hexA(pc, .5)  : (dark ? 'rgba(255,255,255,.34)' : 'rgba(92,80,112,.2)');
  const preset = v => (preview || pc) ? c : v;
  const orange = preset(dark ? 'rgba(246,170,96,.92)' : 'rgba(226,113,28,.85)');
  const gold   = preset(dark ? 'rgba(246,216,144,.95)' : 'rgba(214,162,54,.9)');
  const pink   = preset(dark ? 'rgba(255,158,190,.9)' : 'rgba(226,110,150,.9)');
  const leafOutline = preset('rgba(120,170,130,.9)'), leafVein = 'rgba(120,170,130,.7)';
  /* 平铺尺寸用百分比（宽相对封面宽、高相对封面高，宿主默认按 A5 封面 148:210 折算），
     图案随封面等比缩放——主页、阅读器、搜索缩略图里的疏密完全一致（以 238px 宽为基准）。
     ⚠️ 高百分比 = 宽百分比 × (1 ÷ 封面高宽比 210/148)：换封面比例时这两维要一起改，
        否则贴片会被拉扁 / 拉长（方形画册是 1:1，疏密差一档，属于已知取舍） */
  switch (k) {
    case 'dots': return { img: `radial-gradient(${c} 1.7px,transparent 1.9px)`, size: '9.4% 6.62%', pos: '0 0', rep: 'repeat' };
    case 'grid': return { img: `linear-gradient(${c2} 1px,transparent 1px),linear-gradient(90deg,${c2} 1px,transparent 1px)`, size: '14.1% 9.93%,14.1% 9.93%', pos: '0 0,0 0', rep: 'repeat,repeat' };
    /* 斜纹：色标沿 45° 渐变线取百分比（渐变线长度 = (宽+高)×sin45°，同比例封面下随宽度等比缩放），
       主页小封面 / 阅读器大封面 / 导出大图疏密一致 —— 写死 px 会两头不一样（2.02%≈238px 封面上的 8px） */
    case 'lines': return { img: `repeating-linear-gradient(45deg,${c2} 0,${c2} 2.02%,transparent 2.02%,transparent 5.56%)`, size: 'auto', pos: '0 0', rep: 'repeat' };
    /* 竖纹：条纹宽度用百分比（相对封面宽），主页小封面与阅读器大封面疏密一致 */
    case 'stripe': return { img: `repeating-linear-gradient(90deg,${c} 0 11%,transparent 11% 18.5%)`, size: 'auto', pos: '0 0', rep: 'repeat' };
    /* 菱格：旋转 45° 的棋盘格，深浅两色相间；贴片必须保持正方形（宽高按 A5 封面 210/148 折算）菱形才不变形 */
    case 'check': return { img: `conic-gradient(from 45deg,${c} 25%,transparent 0 50%,${c} 0 75%,transparent 0)`, size: '23.5% 16.55%', pos: '0 0', rep: 'repeat' };
    case 'circle': return { img: `url('${circleTile(orange)}')`, size: '33% 40.25%', pos: '0 0', rep: 'repeat' };
    case 'star': return { img: `url('${starURL(gold)}')`, size: '27.1% 19.12%', pos: '0 0', rep: 'repeat' };
    case 'heart': return { img: `url('${heartURL(pink)}')`, size: '20% 14.08%', pos: '0 0', rep: 'repeat' };
    case 'leaf': return {
      img: `url('${(preview || pc) ? leafURL(c) : leafURL(leafOutline, leafVein)}')`,
      size: '27.1% 19.12%', pos: '0 0', rep: 'repeat'
    };
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
function faceLayers(cover, patKey, preview) {
  const raw = cover.img ? `url("${cover.img}")` : String(cover.value || '');
  const asImage = cover.img || /^(repeating-)?(linear|radial|conic)-gradient|^url\(/i.test(raw.trim());
  const face = asImage ? raw : '';
  const color = asImage ? '' : raw;
  /* 用了上传的封面图片就不叠图案：图案是按底色深浅配色的，压在照片上只会糊成一片。
     preview 只影响配色（统一自动色），贴片尺寸 / 平铺方式两边完全一样 */
  const L = patKey && patKey !== 'none' && !cover.img ? patternLayers(patKey, cover, preview) : null;
  if (!L) return { image: face, color, size: 'cover', pos: 'center', rep: 'no-repeat' };
  return {
    image: face ? L.img + ', ' + face : L.img,
    color,
    size: face ? L.size + ', cover' : L.size,
    pos: face ? L.pos + ', center' : L.pos,
    rep: face ? L.rep + ', no-repeat' : L.rep
  };
}

/* ==================== 装帧样式 ====================
   一本手帐本长什么样由 j.style 决定（缺字段 / 非法值一律按 'classic' 笔记本处理）。
   asp    = 封面「宽 ÷ 高」
   rings  = 活页环的颗数（0 表示不是活页）。⚠️ 环**只画在翻开的内页中缝**上
            （reader-view.js 的 gutterRingsHTML）：封面不画环 —— 真活页本的环在里侧，
            封面是一张干净硬壳。有环的那一档，内页双页摊开时两页之间还会留出一道缝
   ribbon = 这一档**有没有封面彩带**：只有笔记本有，活页 / 画册都不画，
            编辑器里对应那排颜色也跟着藏起来（见 editor.js 的 syncEditor）
   ⚠️ 方形画册 square 的 asp 是 1，内页也跟着变成方的（见 pageRatioOf）——
      封面比例、阅读器排版、导出三处都按它，缺一处就会歪。 */
const BOOK_STYLES = [
  /* asp = 封面宽÷高；pageAsp = 内页宽÷高；pageHScale = 同比例展示时内页相对封面的高度。
     笔记本：A5 148×210；画册：方页；活页内页：95×170。
   ⚠️ 活页的封面比例**不是另写一个 B6**：它是「内页 + 封面内侧露边 + 半道中缝」算出来的
     （95×(1+padX+gap/2) : 170×(1+2×padY)），所以封面与封面内侧永远一样大。
     padX / padY / gap 三个系数同时供 reader-view.js 的 layoutBook 与 reader.css 的露边使用。 */
  { k: 'classic',  n: '笔记本',   d: '硬壳 · 书脊彩带',  asp: 148 / 210, pageAsp: 148 / 210, pageHScale: 1, padX: 0, padY: 0, gap: 0, rings: 0, ribbon: true },
  { k: 'personal', n: '活页手帐', d: '六孔金属环 · 可换页',
    asp: (95 * (1 + .18 + .06 / 2)) / (170 * (1 + 2 * .025)),
    pageAsp: 95 / 170, pageHScale: 1 / (1 + 2 * .025), padX: .18, padY: .025, gap: .06, rings: 6, ribbon: false },
  { k: 'square',   n: '方形画册', d: '方开本 · 硬壳',    asp: 1,        pageAsp: 1,        pageHScale: 1, padX: 0, padY: 0, gap: 0, rings: 0, ribbon: false },
  /* 精装书（2026-11-11 新增）：跟笔记本同为 A5 硬壳，但**没有彩带**、书槽常显且更宽。
     ⚠️ asp 必须跟 book-style.css 的 .cover 默认 aspect-ratio(148/210) 一致：
        改这里却不动 CSS，主页封面和阅读器 layoutBook 会算出两种不同的比例。 */
  { k: 'hardcover', n: '精装书', d: '硬壳 · 立体书槽',  asp: 148 / 210, pageAsp: 148 / 210, pageHScale: 1, padX: 0, padY: 0, gap: 0, rings: 0, ribbon: false }
];
const BOOK_STYLE_DEFAULT = 'classic';
/* 已下线的档位：老数据里存的这个值要转成现在的某一档，不能直接落回 classic
   （11 环线圈本 ring → 六孔活页 personal，都是活页，外观最接近） */
const BOOK_STYLE_LEGACY = { ring: 'personal' };
function normBookStyle(s) {
  const k = BOOK_STYLE_LEGACY[s] || s;
  return BOOK_STYLES.some(x => x.k === k) ? k : BOOK_STYLE_DEFAULT;
}
function bookStyleOf(j) { return BOOK_STYLES.find(x => x.k === normBookStyle(j && j.style)) || BOOK_STYLES[0]; }
/* 这一本的装订方式是不是「活页」（有环）：有环就不画硬壳书脊，改画金属环 */
function isRingStyle(k) { return !!bookStyleOf({ style: k }).rings; }
/* 这一档有没有封面彩带（只有笔记本有） */
function bookHasRibbon(j) { return !!bookStyleOf(j).ribbon; }
/* 内页比例（高 ÷ 宽）：笔记本 A5、活页内页 95×170、画册方页。 */
function pageRatioOf(j) {
  const st = bookStyleOf(j);
  return 1 / (st.pageAsp || st.asp || (148 / 210));
}
/* 封面比例（高 ÷ 宽）：封面与内页可以不同，尤其是 B6 活页封面。 */
function coverRatioOf(j) { return 1 / (bookStyleOf(j).asp || (148 / 210)); }
/* 活页内页比封面短 6mm；其它装帧内页与封面等高。 */
function pageHeightScaleOf(j) { return bookStyleOf(j).pageHScale || 1; }

/* ==================== 图片边框 ====================
   边框挂在图片盒子上（.pframe），不动画源：换框 / 换色 / 拖粗细都是改一个字段的事。
   im.fr  = 边框样式（见 FRAMES，缺省 / 非法值 = 无边框）
   im.frc = 边框颜色（六位 hex；空串时各档用自己的默认色）
   im.frw = 粗细，1~100 的连续值（面板上是一根拖动条），缺省 FRAME_W_DEFAULT
   屏幕与导出共用 frameBoxStyle / frameImgStyle 这两个函数，免得两边画得不一样。
   边框尺寸一律用百分比（相对盒子宽）+ 少量 px（阴影 / 细线），导出时按 sc 缩放那部分 px。

   ⚠️ 细线那一档必须用 border，不能用 inset 阴影：
      inset box-shadow 画在「背景之上、内容之下」，而 .pframe 里整块内容就是那张 <img>，
      线会被图片整个盖住 —— 症状就是「选了细线但一条都看不见」。
      border 会占一点点位置（图片缩一线），但 .pframe 是 border-box、图片 100%×100%，
      缩的是等比的内容区，不会变形。 */
const FRAMES = [
  { k: 'none',     n: '无边框' },
  { k: 'polaroid', n: '拍立得' },
  { k: 'color',    n: '纯色' },
  { k: 'line',     n: '细线' },
  { k: 'photo',    n: '相框' }
];
/* 边框预设色：白 / 米 / 墨 三档打头（最常用的边框色），后面几档是彩色纸框 */
const FRAME_COLORS = ['#ffffff', '#f6efe2', '#1f2330', '#e0668a', '#84abdd', '#78c1a4', '#d6a236', '#8a5fbf'];
const FRAME_DEFAULT_COLOR = {
  polaroid: '#ffffff', color: '#ffffff', line: '#22242f', photo: '#c8a675'
};
/* 粗细拖动条的默认值与取值域（1~100）。老数据里的 1/2/3 三档由 frameWidth 折算过来 */
const FRAME_W_DEFAULT = 50;
function normFrame(f) { return FRAMES.some(x => x.k === f) ? f : 'none'; }
/* 只认 #rgb / #rrggbb，其它一律当「没设」——各档回落到自己的默认色 */
function normHex6(v) {
  let s = String(v || '').trim();
  if (/^#[0-9a-fA-F]{3}$/.test(s)) s = '#' + s.slice(1).split('').map(x => x + x).join('');
  return /^#[0-9a-fA-F]{6}$/.test(s) ? s.toLowerCase() : '';
}

/* ==================== 封面内侧（活页内衬）与书槽开关 ====================
   j.cover.inside = { mode, color, img, pick }
     · auto（缺省）：从封面提取最多五个候选主色，pick 指定用哪一个（缺省 0 = 占比最多）
     · match：与封面完全一致（沿用封面色 / 图 / 图案，也就是加这个功能之前的样子）
     · custom：自定义纯色或自定义内衬图片
   ⚠️ 主色提取要读图片像素，只能异步；coverInsideStyle() 是渲染路径上的同步函数，
      所以先给一个兜底色、顺手触发一次异步计算，算完放**模块内缓存**再重绘一次。
      缓存按封面源串做 key，不写进手帐数据 —— 换封面自然换 key，也不会污染导出文件。
   ⚠️ 只有活页装帧（bookStyleOf(j).rings）有「翻开后露出的封面内侧」；
      其它装帧若没显式设过 inside，一律走 match，保持老样子。 */
const INSIDE_MODES = ['auto', 'match', 'custom'];
const INSIDE_FALLBACK = '#ece5d8';
const INSIDE_PALETTE_MAX = 5;      // 从封面里最多提取五个候选主色
function normInsideMode(m) { return INSIDE_MODES.includes(m) ? m : 'auto'; }
function insideOf(j) {
  const v = j && j.cover && j.cover.inside;
  return (v && typeof v === 'object') ? v : null;
}
function insideModeOf(j) { const v = insideOf(j); return v ? normInsideMode(v.mode) : 'auto'; }
/* 书槽开关：只有笔记本（有彩带那一档）能关；缺省 / true = 显示，
   关闭时封面左侧整列（彩带或透明档的压槽）都不画。
   ⚠️ 方形画册 / 精装书 / 活页固定走「显示」这一支：画册与精装书常显压槽、
      活页本来就不画那一列（coverHTML 的 isRingStyle 分支），都跟
      「精装书和画册显示书槽、活页不显示彩带」这条规则一致。 */
function coverGrooveOn(j) {
  if (!bookStyleOf(j).ribbon) return true;
  return !(j && j.cover && j.cover.groove === false);
}
/* 纯色 / 渐变封面取第一个色标当主色（渐变没有「出现最多」可言） */
function firstHexOf(v) {
  const m = String(v || '').match(/#[0-9a-fA-F]{6}|#[0-9a-fA-F]{3}/);
  return m ? normHex6(m[0]) : '';
}
/* 纯色 / 渐变封面没有像素可统计：把里面所有色标抽出来当候选（渐变通常有 3 个）。
   用户仍可从中挑一个，跟图片封面走同一套「五个候选」的交互。 */
function hexListOf(v) {
  const ms = String(v || '').match(/#[0-9a-fA-F]{6}|#[0-9a-fA-F]{3}/g) || [];
  const out = [];
  ms.forEach(s => { const h = normHex6(s); if (h && !out.includes(h)) out.push(h); });
  return out.slice(0, INSIDE_PALETTE_MAX);
}
function coverFaceStyle(cv) {
  const bg = cv.img
    ? `background-image:url('${cv.img}');background-size:cover;background-position:center;`
    : `background:${cv.value};`;
  return { bg, pat: cv.img ? '' : patternStyle(cv.pattern, cv),
    patKey: cv.img ? 'none' : (cv.pattern || 'none') };
}
function coverImgStyle(src) {
  return `background-image:url('${src}');background-size:cover;background-position:center;`;
}
const __insideCache = new Map();       // 封面源串 → 候选主色 hex[]（按占比从多到少）
const __insidePending = new WeakSet(); // 同一本别重复触发
/* 把封面缩到 64×64 量化统计：每通道 32 级分桶，按像素数从多到少取最多五个主色。
   纯白底 / 纯黑描边通常是留白而不是「封面的颜色」，统计时跳过；
   整张图都被跳过了就退回全量统计。
   ⚠️ 挑候选时先甩掉跟已选颜色太近的（RGB 距离 < 34），否则五个格子会是一串几乎一样的色；
      颜色确实不足五种时再按占比补齐，保证单色封面也能给满可点的格子。 */
function dominantColorsOf(src, limit = INSIDE_PALETTE_MAX) {
  return new Promise(resolve => {
    const im = new Image();
    im.onerror = () => resolve([]);
    im.onload = () => {
      const S = 64, c = document.createElement('canvas');
      c.width = S; c.height = S;
      const cx = c.getContext('2d');
      if (!cx) { resolve([]); return; }
      cx.drawImage(im, 0, 0, S, S);
      let d;
      try { d = cx.getImageData(0, 0, S, S).data; } catch (_) { resolve([]); return; }
      const bins = new Map(), all = new Map();
      const add = (m, r, g, b) => {
        const k = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
        const e = m.get(k);
        if (e) { e.n++; e.r += r; e.g += g; e.b += b; }
        else m.set(k, { n: 1, r, g, b });
      };
      for (let i = 0; i < d.length; i += 4) {
        if (d[i + 3] < 128) continue;
        const r = d[i], g = d[i + 1], b = d[i + 2];
        add(all, r, g, b);
        if (r > 248 && g > 248 && b > 248) continue;
        if (r < 8 && g < 8 && b < 8) continue;
        add(bins, r, g, b);
      }
      const source = bins.size ? bins : all;
      const sorted = [...source.values()].sort((x, y) => y.n - x.n);
      if (!sorted.length) { resolve([]); return; }
      const hx = n => clamp(Math.round(n), 0, 255).toString(16).padStart(2, '0');
      const list = sorted.map(e => {
        const r = Math.round(e.r / e.n), g = Math.round(e.g / e.n), b = Math.round(e.b / e.n);
        return { r, g, b, hex: '#' + hx(r) + hx(g) + hx(b) };
      });
      const picked = [];
      for (const c1 of list) {
        if (picked.length >= limit) break;
        const far = picked.every(p =>
          Math.sqrt((p.r - c1.r) ** 2 + (p.g - c1.g) ** 2 + (p.b - c1.b) ** 2) >= 34);
        if (far) picked.push(c1);
      }
      for (const c1 of list) {
        if (picked.length >= limit) break;
        if (!picked.includes(c1)) picked.push(c1);
      }
      resolve(picked.slice(0, limit).map(c => c.hex));
    };
    im.src = src;
  });
}
function ensureInsideDominant(j, key) {
  if (__insidePending.has(j)) return;
  __insidePending.add(j);
  const cv = j.cover || {};
  const p = isImgData(cv.img) ? dominantColorsOf(cv.img) : Promise.resolve(hexListOf(cv.value));
  Promise.resolve(p).then(list => {
    __insidePending.delete(j);
    if (!list || !list.length) return;
    __insideCache.set(key, list);
    /* 算完重绘一次：命中缓存后 coverInsideStyle 不再触发，不会循环。 */
    try {
      if (typeof ed !== 'undefined' && ed && ed.temp === j && typeof syncEditor === 'function') syncEditor();
      const rd = document.getElementById('reader');
      if (rd && rd.classList.contains('show') && typeof renderReader === 'function') renderReader();
    } catch (_) {}
  });
}
/* 编辑器里那排候选色块读同一份缓存：还没算好就返回空数组并触发一次计算 */
function coverInsidePalette(j) {
  const cv = (j && j.cover) || {};
  const key = isImgData(cv.img) ? cv.img : String(cv.value || '');
  const list = __insideCache.get(key);
  if (list) return list;
  ensureInsideDominant(j, key);
  return [];
}
/* 屏幕 / 编辑器预览共用的内侧样式源，交给 coverBoardHTML 铺那张皮 */
function coverInsideStyle(j) {
  const cv = (j && j.cover) || {}, custom = insideOf(j);
  /* 只有活页翻开会露出封面内侧；其它装帧一律「背面就是封面」，
     哪怕数据里还留着上一档装帧设过的 inside 也不生效（切回活页会原样恢复）。 */
  if (!bookStyleOf(j).rings) return coverFaceStyle(cv);
  const mode = insideModeOf(j);
  if (mode === 'match') return coverFaceStyle(cv);
  const ins = custom || {};
  if (mode === 'custom') {
    const img = isImgData(ins.img) ? ins.img : '';
    if (img) return { bg: coverImgStyle(img), pat: '', patKey: 'none' };
    return { bg: `background:${normHex6(ins.color) || INSIDE_FALLBACK};`, pat: '', patKey: 'none' };
  }
  /* auto：从封面提取的候选色里挑 inside.pick 那一个（缺省 0 = 占比最多）。
     还没算好先给兜底色，异步算完自动重绘一次；palette / pick 一并回给编辑器渲染色块。 */
  const list = coverInsidePalette(j);
  const pk = Number(ins.pick);
  const pick = Number.isFinite(pk) ? clamp(Math.round(pk), 0, Math.max(0, list.length - 1)) : 0;
  const hex = list[pick] || firstHexOf(cv.value) || INSIDE_FALLBACK;
  return { bg: `background:${hex};`, pat: '', patKey: 'none', palette: list, pick };
}
/* 木框 / 纸框表面那层极细的颗粒（封面曾也用这张，现已去掉，只剩边框在用）。
   写在 JS 里是因为边框样式是内联下发的，导出也用同一串 —— 省得 CSS 与导出各存一份。
   ⚠️ 这串要塞进 style="…" 属性，所以整段只能走 encodeURIComponent：
      括号（url(#n) 里的）和引号都得转成 %xx，否则
      ① 引号会把 HTML 属性提前截断（背景图整个失效，只留个底色）
      ② 未加引号的 url() 里出现括号会被 CSS 判为非法
      用的时候写 url('${GRAIN_URL}') —— 单引号：整串值还要塞进 style="…" 属性，双引号会把属性截断 */
const GRAIN_URL = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(
  `<svg xmlns='http://www.w3.org/2000/svg' width='120' height='120'><filter id='n'>`
  + `<feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='3' stitchTiles='stitch'/>`
  + `<feColorMatrix type='saturate' values='0'/></filter>`
  + `<rect width='120' height='120' filter='url(#n)' opacity='.5'/></svg>`)
  /* encodeURIComponent 不管单引号，而 CSS 的未加引号 url() 里单引号同样非法
     （不许出现的字符是：空白、" ' ( ) 反斜杠）—— 单独补一道转义 */
  .replace(/'/g, '%27');
/* 粗细：1~100 的连续值（面板上是拖动条）。
   老数据存的是 1/2/3 三档（<=5 一定是旧的），折算成 20/50/80，看上去跟原来差不多 */
function frameWidth(im) {
  const v = Math.round(+((im && im.frw) || 0));
  if (!v) return FRAME_W_DEFAULT;
  if (v <= 5) return [20, 50, 80][v - 1] || FRAME_W_DEFAULT;
  return clamp(v, 1, 100);
}
function frameColor(im, k) {
  const c = normHex6(im && im.frc);
  return c || FRAME_DEFAULT_COLOR[k] || '#ffffff';
}
/* 边框盒子的样式（写在包住 <img> 的那层 .pframe 上）。
   拍立得下边故意留厚一条（底下能写字，是拍立得的招牌），相纸是**光滑**的、不要颗粒。
   sc = 导出缩放（导出画布比屏幕宽，阴影 / 细线那几处 px 要跟着放大，比例才对） */
function frameBoxStyle(im, sc) {
  const k = normFrame(im && im.fr);
  if (k === 'none') return '';
  const s = sc || 1, w = frameWidth(im) / 100, c = frameColor(im, k);
  const px = v => (v * s).toFixed(2) + 'px';
  const base = +(1.4 + w * 4).toFixed(2);              // 边框占盒子宽的百分比
  if (k === 'polaroid') {
    const p = base, b = +(p * 3.1).toFixed(2);
    /* 相纸是光滑的（带一层极淡的顶光就够了），加噪点反而像蒙了层脏东西 */
    return `padding:${p}% ${p}% ${b}%;background:#fff;`
      + `box-shadow:0 ${px(3 + w * 4)} ${px(9 + w * 16)} -${px(4)} rgba(24,26,44,.55),0 1px 2px rgba(0,0,0,.2);`;
  }
  if (k === 'color') {
    return `padding:${base}%;background-color:${c};background-image:url('${GRAIN_URL}');background-size:120px 120px;`
      + `box-shadow:0 ${px(2)} ${px(7)} -${px(3)} rgba(24,26,44,.42);`;
  }
  /* 细线：用 border 描（inset 阴影会被 <img> 盖住，一条都看不见）。
     .pframe 是 border-box，图片 100%×100% 跟着缩一点点，不会变形 */
  if (k === 'line') {
    return `padding:0;border:${px(0.7 + w * 2.6)} solid ${c};`
      + `box-shadow:0 ${px(1)} ${px(3)} -${px(2)} rgba(24,26,44,.3);`;
  }
  /* 拟物相框：木色底 + 顺纹的深浅条 + 一层颗粒 + 「左上亮、右下暗」的斜面光 —— 四层叠出木框的质感。
     少了纹理那两层，再好的斜面看着也只是一圈平涂的棕色 */
  if (k === 'photo') {
    const p = +(base * 1.35).toFixed(2);
    return `padding:${p}%;background-color:${c};`
      + `background-image:url('${GRAIN_URL}'),`
      + `repeating-linear-gradient(93deg,rgba(0,0,0,.24) 0 3px,rgba(255,255,255,.13) 3px 7px),`
      + `linear-gradient(145deg,rgba(255,255,255,.6),rgba(255,255,255,0) 38%,rgba(0,0,0,.46));`
      + `background-size:120px 120px,auto,auto;`
      /* 斜面：外圈一道受光的亮边、内圈一道背光的暗边，再补上下两道内外阴影 —— 框条是凸出来的 */
      + `box-shadow:inset 0 0 0 ${px(1)} rgba(255,255,255,.62),inset 0 0 0 ${px(2)} rgba(0,0,0,.3),`
      + `inset 0 ${px(2)} ${px(3)} rgba(0,0,0,.42),inset 0 -${px(2)} ${px(3)} rgba(255,255,255,.24),`
      + `0 ${px(4 + w * 6)} ${px(11 + w * 20)} -${px(5)} rgba(20,22,40,.6);`;
  }
  return '';
}
/* 图片本体要不要跟着改一点：拍立得 / 相框的照片是硬边直角，再压一道极淡的内框线更像实物。
   注意 <img> 的 inset 阴影是画在内容底下的（会被图盖住），所以一律用外描边 */
function frameImgStyle(im) {
  const k = normFrame(im && im.fr);
  if (k === 'polaroid') return 'border-radius:0;box-shadow:0 0 0 1px rgba(0,0,0,.1);';
  if (k === 'photo') return 'border-radius:0;box-shadow:0 0 0 1px rgba(0,0,0,.26);';
  return '';
}
/* 有没有边框（渲染与导出都要问一句） */
function hasFrame(im) { return normFrame(im && im.fr) !== 'none'; }

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
/* 彩带那一档「透明」：不画颜色带，封面左侧改画带立体断面的压槽
   （见 home.css 的 .spine.ghost；活页那档连压槽也不画）。
   存成 'none' 而不是颜色值，导入导出和比对都按普通字符串走 */
const RIBBON_NONE = 'none';
/* 彩带是**纯色**的一条带子（2026-11-12 用户定稿）：不要再叠左暗右亮的渐变，
   那条明暗会在带子上形成一道黑影（用户说的「彩带上的阴影」）。
   彩带贴在封面上压出来的那道投影由各处的 box-shadow 负责，要保留。
   透明档 / 非法值都返回空串，由调用方决定画不画书脊。 */
function ribbonSpine(ribbon) {
  let r = String(ribbon || '').trim();
  if (!r || r === RIBBON_NONE) return '';
  if (!/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(r)) return '';
  if (r.length === 4) r = '#' + r.slice(1).split('').map(x => x + x).join('');
  return r;
}
/* 图案颜色预设：饱和度高一档，压在浅底 / 深底上都醒目 */
const PAT_COLORS = ['#e2819f','#e0668a','#e8a559','#d6a236','#78c1a4','#4f9e7a','#84abdd','#3a6db5','#a78dd5','#6d5fbf','#b5533f','#2b3550'];
const TEMPLATES = [
  { k: 'blank', n: '空白' }, { k: 'lined', n: '横线' }, { k: 'grid', n: '方格' },
  { k: 'dots', n: '点阵' }, { k: 'kraftplain', n: '牛皮纸' }, { k: 'kraft', n: '牛皮纸（横线）' },
  { k: 'custom', n: '自定义图片' },
];
/* ---- 自定义内页模板 ----
   一本手帐可存多张图：j.tplImgs 是图片 dataURL 数组（素材库），
   当前选中的那张写进 j.tplImg，j.template === 'custom' 时生效；
   j.tplFit 决定怎么铺（cover 铺满 / stretch 拉伸 / tile 平铺）。
   ⚠️ tplStyle / 纸面 / PDF 只认 j.tplImg 这一张，别让下游改读数组。
   图存在手帐数据里，跟封面图片一样会随源文件 / PDF / 长图一起导出，换设备导入也带着。
   ⚠️ 只认 base64 的位图 dataURL：这串要塞进 style="…" 和导出的 XHTML 里，
      http 链接、带引号 / 括号的 svg 文本、乱填的值一律当「没设」，落回空白模板。 */
const TPL_FITS = ['cover', 'stretch', 'tile'];
function normTplFit(v) { return TPL_FITS.includes(v) ? v : 'cover'; }
/* 通用校验：base64 位图 dataURL。内页模板与 DIY 封面里的图片都过这一道，
   免得外链 / svg 文本 / 带引号的地址塞进 style="…" 或导出的 XHTML 里 */
function isImgData(v) {
  const s = String(v || '');
  return /^data:image\/(png|jpe?g|webp|gif);base64,[a-z0-9+/=]+$/i.test(s);
}
function tplImgOf(j) {
  const s = String((j && j.tplImg) || '');
  return isImgData(s) ? s : '';
}
/* 一本手帐可以存**好几张**自定义内页模板图：j.tplImgs 是图片 dataURL 数组，
   编辑器模板栏里每张各占一格、点哪张就把哪张写进 j.tplImg 当当前模板。
   ⚠️ j.tplImg 仍是单张且是唯一样式源（tplStyle / 导出 / 纸面都只认它），
      tplImgs 只是「素材库」，别让下游改读数组。
   ⚠️ 老数据只有 tplImg、没有 tplImgs：这里把当前那张兜底并进列表，
      升上来就能在模板栏里看到、也能继续往里加，不会凭空丢图。
   每张都过 isImgData 白名单、去重、限 TPL_IMGS_MAX 张（base64 很占地方）。 */
const TPL_IMGS_MAX = 12;
function tplImgsOf(j) {
  const out = [];
  const raw = j && Array.isArray(j.tplImgs) ? j.tplImgs : [];
  for (const s of raw) {
    const v = tplImgOf({ tplImg: s });
    if (v && !out.includes(v) && out.length < TPL_IMGS_MAX) out.push(v);
  }
  const one = tplImgOf(j);
  if (one && !out.includes(one)) out.unshift(one);
  return out.slice(0, TPL_IMGS_MAX);
}
/* 屏幕纸面、编辑器缩略图、PDF / 长图导出共用的样式源。
   j 只有 custom 档用得上（要拿图和铺法），其余六档传不传都一样。 */
function tplStyle(k, j) {
  if (k === 'custom') {
    const src = tplImgOf(j);
    if (!src) return '';                       // 标了 custom 却没图：干净的空白纸，不留半截样式
    const fit = normTplFit(j && j.tplFit);
    const img = `background-image:url('${src}');`;
    if (fit === 'stretch') return img + 'background-size:100% 100%;background-position:center;background-repeat:no-repeat;';
    if (fit === 'tile') return img + 'background-size:30% auto;background-position:0 0;background-repeat:repeat;';
    return img + 'background-size:cover;background-position:center;background-repeat:no-repeat;';
  }
  switch (k) {
    /* 横线 / 牛皮纸横线：平铺单元必须正好等于一个渐变周期（28px）。
       原来只写了 background-position:0 34px，单元高度却跟着元素高度走（不是 28 的整数倍），
       顶部那一截由上一个单元的尾部补上，接缝处首两条线间距变成 39px，后面才是 28px。
       撤掉偏移、把单元锁死成 28px，所有线严格等距；页边留白已由 .tplbg 的 --pmy 负责。 */
    case 'lined': return 'background-image:repeating-linear-gradient(transparent 0,transparent 27px,#dfe3ee 27px,#dfe3ee 28px);background-size:100% 28px;';
    case 'grid': return 'background-image:linear-gradient(#e8ebf3 1px,transparent 1px),linear-gradient(90deg,#e8ebf3 1px,transparent 1px);background-size:23px 23px;';
    case 'dots': return 'background-image:radial-gradient(#d2d8e8 1.35px,transparent 1.45px);background-size:20px 20px;';
    /* kraftplain 空白牛皮纸不画纹理，底色由 .paper.t-kraftplain 提供 */
    case 'kraft': return 'background-image:repeating-linear-gradient(transparent 0,transparent 27px,rgba(120,96,64,.22) 27px,rgba(120,96,64,.22) 28px);background-size:100% 28px;';
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

