/* =====================================================================
 * Carnet · 视觉素材 · SVG 图案与色板   （脚本 2 / 23）
 * ---------------------------------------------------------------------
 * ① 封面/纸面用的 SVG 图案：三角、圆、星、心、叶
 * ② 封面明暗计算 coverLum / 颜色叠加 hexA / 图案层 patternLayers / faceLayers
 * ③ 色板：COLORS / GRADS / 彩带 RIBBONS / 图案色 PAT_COLORS / 内页模板 TEMPLATES
 *
 * 依赖模块：core
 *
 * 说明：模块间共用全局作用域，按下面的顺序加载，顺序即依赖顺序。
 * ===================================================================== */
/* ==================== 图案（SVG） ==================== */
/* ===== 图案（SVG） ===== */
/* 三角形：一块 48×56 贴片里放四个实心三角 —— 上排两个尖朝上、下排两个尖朝下，
   排与排之间留 10px 空隙，平铺后就是界限分明的「一排朝上、一排朝下」，和星光/爱心一样铺满封面 */
function triangleTile(color) {
  const up = [[0, 23, 24, 23, 12, 5], [24, 23, 48, 23, 36, 5]];
  const down = [[0, 33, 24, 33, 12, 51], [24, 33, 48, 33, 36, 51]];
  const pg = ([a, b, c, d, e, f]) => `<polygon points="${a},${b} ${c},${d} ${e},${f}"/>`;
  return enc(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 56" width="48" height="56">`
    + `<g fill="${color}">${up.concat(down).map(pg).join('')}</g></svg>`);
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
const LOCK_SVG = '<svg fill="none" height="13" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="3.2" viewBox="0 0 24 24" width="13"><path d="M4.5 12.8l4.8 4.8L19.5 7.2"/></svg>';
/* 铺满整页 / 还原原比例：四角向外为铺满，向内为还原 */
const FILL_SVG = '<svg fill="none" height="13" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2.2" viewBox="0 0 24 24" width="13"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>';
const RESTORE_SVG = '<svg fill="none" height="13" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2.2" viewBox="0 0 24 24" width="13"><path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5"/></svg>';
const DEL_SVG = '<svg fill="none" height="13" stroke="currentColor" stroke-linecap="round" stroke-width="2.4" viewBox="0 0 24 24" width="13"><path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/></svg>';
const TEXT_COLORS = ['#2b2f3d', '#e0668a', '#4a6ea8', '#4d8a6a', '#8d94ab', '#b5651d'];
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
  const dark = !cover || coverLum(cover) < 0.55;
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
    case 'lines': return { img: `repeating-linear-gradient(45deg,${c2} 0,${c2} 8px,transparent 8px,transparent 22px)`, size: 'auto', pos: '0 0', rep: 'repeat' };
    /* 竖纹：条纹宽度用百分比（相对封面宽），主页小封面与阅读器大封面疏密一致 */
    case 'stripe': return { img: `repeating-linear-gradient(90deg,${c} 0 11%,transparent 11% 18.5%)`, size: 'auto', pos: '0 0', rep: 'repeat' };
    /* 菱格：旋转 45° 的棋盘格，深浅两色相间；贴片必须保持正方形（宽高按 3:4.05 折算）菱形才不变形 */
    case 'check': return { img: `conic-gradient(from 45deg,${c} 25%,transparent 0 50%,${c} 0 75%,transparent 0)`, size: '23.5% 17.4%', pos: '0 0', rep: 'repeat' };
    case 'circle': return { img: `url('${circleTile(orange)}')`, size: '33% 42.3%', pos: '0 0', rep: 'repeat' };
    case 'triangle': return { img: `url('${triangleTile(blue)}')`, size: '28.2% 24.4%', pos: '0 0', rep: 'repeat' };
    case 'star': return { img: `url('${starURL(gold)}')`, size: '27.1% 20.1%', pos: '0 0', rep: 'repeat' };
    case 'heart': return { img: `url('${heartURL(pink)}')`, size: '20% 14.8%', pos: '0 0', rep: 'repeat' };
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
  const L = patKey && patKey !== 'none' ? patternLayers(patKey, cover) : null;
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

