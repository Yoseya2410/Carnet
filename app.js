/* 纸间手账 · Paper Journal —— 脚本
   原 index.html 内联 <script> 抽出，内容未做改动 */
/* ==================== 输入法弹起时锁住应用高度 ====================
   键盘出现会把视口压矮，导致底栏被顶上去。这里把 #app 的高度固定在
   “未弹起输入法时的高度”，底栏就一直待在原位（被键盘盖住而不是上移）。 */
(() => {
  let baseH = window.innerHeight;
  const isTyping = () => {
    const a = document.activeElement;
    return !!a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.isContentEditable);
  };
  const apply = () => document.documentElement.style.setProperty('--app-h', baseH + 'px');
  const sync = () => {
    const h = window.innerHeight;
    if (!h) return;
    if (!isTyping() || h > baseH) baseH = h;   // 正在输入时只在变高（键盘收起）才跟随
    apply();
  };
  apply();
  window.addEventListener('resize', sync);
  window.addEventListener('orientationchange', () => setTimeout(sync, 260));
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', sync);
    window.visualViewport.addEventListener('scroll', sync);
  }
  // 聚焦输入框的瞬间先把高度记下来，键盘随后弹起也不受影响
  document.addEventListener('focusin', () => { if (isTyping() && window.innerHeight > baseH) { baseH = window.innerHeight; apply(); } });
  /* 编辑文字时反过来：底栏要跟着输入法一起抬起来，别被键盘盖住 */
  const coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
  let kbWasUp = false;
  const syncBotBar = () => {
    const el = document.querySelector('.rbot');
    if (!el) return;
    const vv = window.visualViewport;
    let kb = 0;
    // 键盘高度 = 锁定住的应用高度 - 当前可视高度
    if (el.classList.contains('editing') && vv) kb = Math.max(0, Math.round(baseH - vv.height - (vv.offsetTop || 0)));
    /* 输入法收起（键盘高度归零）后自动退出文字编辑，不用再点一下别处 */
    const w = coarse ? document.querySelector('.ptext-wrap.editing') : null;
    if (w) {
      if (kb > 60) kbWasUp = true;
      else if (kbWasUp && kb <= 4 && w.isConnected) { kbWasUp = false; stopTextEdit(w, true); return; }
      else if (kb <= 4) kbWasUp = false;
    }
    el.style.transform = kb > 4 ? `translateY(${-kb}px)` : '';
  };
  window.__syncBotBar = syncBotBar;
  const syncAll = () => { sync(); syncBotBar(); };
  window.addEventListener('resize', syncAll);
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', syncBotBar);
    window.visualViewport.addEventListener('scroll', syncBotBar);
  }
  document.addEventListener('focusin', () => setTimeout(syncBotBar, 40));
  document.addEventListener('focusout', () => setTimeout(syncBotBar, 120));
  document.addEventListener('focusout', () => setTimeout(sync, 60));
})();

/* ==================== 工具 ==================== */
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const uid = () => 'x' + Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const enc = svg => 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function shade(hex, pct) {
  let c = hex.replace('#', '');
  if (c.length === 3) c = c.split('').map(x => x + x).join('');
  const n = parseInt(c, 16);
  let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const f = v => clamp(Math.round(v + (pct / 100) * 255), 0, 255);
  return '#' + ((1 << 24) + (f(r) << 16) + (f(g) << 8) + f(b)).toString(16).slice(1);
}

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
const EDIT_SVG = '<svg fill="none" height="13" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2.2" viewBox="0 0 24 24" width="13"><path d="M15.2 4.8l4 4L9 19H5v-4z"/><path d="M13.2 6.8l4 4"/></svg>';
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

/* ==================== 存储 ==================== */
const KEY = 'paper_journal_v2';
const DB = (() => {
  let p = null;
  let lowered = false;            // 是否已经降级到 localStorage（IndexedDB 不可用）
  function open() {
    if (p) return p;
    p = new Promise((res, rej) => {
      if (!window.indexedDB) return rej('noidb');
      const r = indexedDB.open('paper_journal_db', 1);
      r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains('kv')) r.result.createObjectStore('kv'); };
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    return p;
  }
  return {
    get lowered() { return lowered; },
    async get(k) { try { const db = await open(); return await new Promise((res, rej) => { const q = db.transaction('kv').objectStore('kv').get(k); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); }); } catch (e) { const s = localStorage.getItem(k); return s ? JSON.parse(s) : undefined; } },
    /* 写入成功返回 true，两边都失败返回 false（不再静默吞掉：调用方要据此提醒用户） */
    async set(k, v) {
      try {
        const db = await open();
        await new Promise((res, rej) => { const q = db.transaction('kv', 'readwrite').objectStore('kv').put(v, k); q.onsuccess = () => res(); q.onerror = () => rej(q.error); });
        return true;
      } catch (e) {
        try { localStorage.setItem(k, JSON.stringify(v)); lowered = true; return true; }
        catch (e2) { console.error('[storage] 写入失败：', e2, e); return false; }
      }
    }
  };
})();
let saveTimer = null;
let lowWarned = false;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    try {
      const ok = await DB.set(KEY, state.journals);
      if (!ok) toast('保存失败：没能写入本地存储，请先导出备份再继续操作', 4200);
      else if (DB.lowered && !lowWarned) { lowWarned = true; toast('注意：当前只能用 localStorage 存储（IndexedDB 不可用），建议定期导出备份', 4200); }
    } catch (e) { toast('保存失败：' + ((e && e.message) || e), 4200); }
  }, 260);
}

/* ==================== 导出 / 导入 ==================== */
const EXPORT_TAG = 'paper-journal';
const EXPORT_VERSION = 1;
const HELP_MAIL = 'yoseya2410@qq.com';

/* ---------- 导出/导入的保真工具：稳定序列化 + 摘要 + 资产计数 ---------- */
/* key 排序后再序列化：不管对象字段顺序怎么变，同一份内容算出来的串都一样，
   导入时才能和导出时写进文件里的校验值对上 */
function stableStringify(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v === undefined ? null : v);
  if (Array.isArray(v)) return '[' + v.map(stableStringify).join(',') + ']';
  return '{' + Object.keys(v).sort().filter(k => v[k] !== undefined)
    .map(k => JSON.stringify(k) + ':' + stableStringify(v[k])).join(',') + '}';
}
/* 内容摘要：优先 WebCrypto 的 SHA-256（取前 8 字节），非安全上下文里退回 FNV-1a 哈希 */
async function checksum(str) {
  try {
    if (window.crypto && crypto.subtle && crypto.subtle.digest) {
      const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
      return 'sha256:' + Array.prototype.slice.call(new Uint8Array(buf), 0, 8)
        .map(b => b.toString(16).padStart(2, '0')).join('');
    }
  } catch (e) { /* 退回简单哈希 */ }
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = (h + (h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24)) >>> 0;
  }
  return 'fnv:' + h.toString(16).padStart(8, '0');
}
/* 两本手帐是否「内容完全一样」：比对除 id / created 之外的一切
   （名字、封面、彩带、模板、每页的图片与文字），用于导入去重 */
async function journalFP(j) {
  return checksum(stableStringify({
    name: j.name, cover: j.cover, ribbon: j.ribbon, template: j.template, pages: j.pages
  }));
}
/* 数一数文件里实际写了多少资产。注意这里数的是条目本身、不做有效性过滤：
   导入后 normalizeJournal 会剔掉 src 非法的图片，两边一减就知道丢了什么 */
function countAssets(j) {
  const pages = Array.isArray(j && j.pages) ? j.pages : [];
  let img = 0, txt = 0;
  pages.forEach(p => {
    img += (Array.isArray(p && p.images) ? p.images : []).length;
    txt += (Array.isArray(p && p.texts) ? p.texts : []).length;
  });
  return { pages: pages.length, img, txt };
}
/* 复制文本：无剪贴板权限时（App 内浏览器常见）会抛错，静默吞掉，不影响主流程 */
function copyText(t) {
  try { const p = navigator.clipboard && navigator.clipboard.writeText(t); if (p && p.catch) p.catch(() => {}); }
  catch (e) {}
}

/* 文件名去掉系统不允许的字符，空名兜底 */
function exportName(j) {
  const n = String((j && j.name) || '手帐本').replace(/[\\/:*?"<>|\n\r\t]/g, '_').trim();
  return (n || '手帐本') + '.journal.json';
}
/* 让用户自己挑保存位置（File System Access API，目前只有桌面版 Chrome / Edge 有）。
   返回三种结果：文件句柄 / 'cancel'（用户点了取消）/ null（不支持，走原来那套） */
async function pickSaveTarget(name) {
  if (!window.showSaveFilePicker) return null;
  try {
    return await window.showSaveFilePicker({
      suggestedName: name,
      types: [{ description: '手帐本文件', accept: { 'application/json': ['.json'] } }]
    });
  } catch (e) {
    return (e && e.name === 'AbortError') ? 'cancel' : null;
  }
}
/* 导出当前手帐本：
   桌面 Chrome/Edge 走「另存为」对话框自己选目录；不支持时先试系统分享，最后退回普通下载。
   文件里带一个 checksum，导入时可以验证内容有没有被动过 */
async function exportJournal(j) {
  j = j || cur();
  if (!j) { toast('还没有手帐本可以导出'); return; }
  const name = exportName(j);
  /* 趁这次点击的用户手势还有效，先问「存到哪」 */
  const target = await pickSaveTarget(name);
  if (target === 'cancel') { toast('已取消导出'); return; }
  try {
    const sum = await checksum(stableStringify(j));
    const text = JSON.stringify({
      app: EXPORT_TAG, version: EXPORT_VERSION, exportedAt: Date.now(), checksum: sum, journal: j
    });
    const blob = new Blob([text], { type: 'application/json' });
    if (target) {
      try {
        const w = await target.createWritable();
        await w.write(blob);
        await w.close();
        toast('已导出《' + j.name + '》· 已存到你选择的位置', 2600);
        return;
      } catch (e) {
        if (e && e.name === 'AbortError') { toast('已取消导出'); return; }
        console.warn('[export] 写文件失败，退回普通下载：', e);
      }
    }
    const file = new File([blob], name, { type: 'application/json' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: j.name, text: `我的电子手帐《${j.name}》，共 ${j.pages.length} 页。` });
        toast('已导出《' + j.name + '》', 2200);
        return;
      } catch (e) {
        /* 用户主动取消就到此为止，不再谎报成功；其它错误才继续走下载 */
        if (e && e.name === 'AbortError') { toast('已取消分享'); return; }
      }
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = name; a.style.display = 'none';
    document.body.appendChild(a); a.click();
    setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 2000);
    toast('已导出《' + j.name + '》· 已存到浏览器下载目录', 2600);
  } catch (e) {
    console.error('[export] 失败：', e);
    toast('导出失败：' + ((e && e.message) || e), 4200);
  }
}
/* 校验收进来的数据并补全缺省字段：封面、彩带、内页图片与文字原样保留，导入后照常可编辑 */
function normalizeJournal(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const j = (raw.journal && typeof raw.journal === 'object') ? raw.journal : raw;
  if (!j || typeof j !== 'object' || !Array.isArray(j.pages)) return null;
  const cv = (j.cover && typeof j.cover === 'object') ? j.cover : {};
  const val = typeof cv.value === 'string' && cv.value ? cv.value : GRADS[1];
  /* 以原对象为底逐项兜底，而不是重建一个新对象：
     凡是现在用不到、将来会新增的字段（含封面上、页面上的额外字段）都会原样留下，
     导出→导入不再把它们悄悄丢掉 */
  const out = {
    ...j,
    id: uid(),                                  // 换新 id，避免和已有的手帐本撞车
    name: String(j.name || '导入的手帐'),
    cover: {
      ...cv,
      type: (cv.type === 'solid' || cv.type === 'gradient') ? cv.type : (/gradient/i.test(val) ? 'gradient' : 'solid'),
      value: val,
      pattern: normPat(cv.pattern),
      img: (typeof cv.img === 'string' && cv.img) ? cv.img : null
    },
    ribbon: /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(String(j.ribbon || '')) ? j.ribbon : '#c98a8a',
    /* 已下线的「日历」模板映射到现在的空白牛皮纸，导入老文件时页面不丢 */
    template: j.template === 'calendar' ? 'kraftplain'
      : (TEMPLATES.some(t => t.k === j.template) ? j.template : 'blank'),
    pages: j.pages.map(pg => {
      const p = (pg && typeof pg === 'object') ? pg : {};
      return {
        ...p,
        images: Array.isArray(p.images)
          ? p.images.filter(im => im && typeof im.src === 'string' && im.src).map(im => ({ ...im, id: im.id || uid() }))
          : [],
        texts: Array.isArray(p.texts)
          ? p.texts.filter(t => t && typeof t === 'object').map(t => ({ ...t, id: t.id || uid() }))
          : []
      };
    }),
    created: Number(j.created) || Date.now()
  };
  return out;
}
/* 兼容三种写法：本应用导出的单本、裸手帐本对象、多本数组。
   返回 { items:[{ journal, sum, declared, ok, src }] }：
   ok = true 校验通过 / false 校验不符（文件被动过或传输出错）/ null 该文件没写校验值 */
async function readJournals(text) {
  let d;
  try { d = JSON.parse(text); } catch (e) { return { items: [] }; }
  if (!d || typeof d !== 'object') return { items: [] };
  const raws = Array.isArray(d) ? d : (Array.isArray(d.journals) ? d.journals : [d]);
  const items = [];
  for (const r of raws) {
    const p = normalizeJournal(r);
    if (!p) continue;
    const body = (r && typeof r === 'object' && r.journal && typeof r.journal === 'object') ? r.journal : r;
    const own = (r && typeof r === 'object' && typeof r.checksum === 'string') ? r.checksum : null;
    const pkg = (!Array.isArray(d) && typeof d.checksum === 'string') ? d.checksum : null;
    const want = own || (raws.length === 1 ? pkg : null);
    const sum = await checksum(stableStringify(body));
    items.push({ journal: p, sum, declared: want, ok: want ? want === sum : null, src: countAssets(body) });
  }
  return { items };
}
/* 导入后的核对报告：告诉用户实际收了多少页 / 图 / 文字，有没有东西没进去 */
function importReport(items, dupCount, badFiles) {
  let pages = 0, img = 0, txt = 0, damaged = 0, lost = 0;
  const detail = [];
  items.forEach(it => {
    const c = countAssets(it.journal);
    pages += c.pages; img += c.img; txt += c.txt;
    if (it.ok === false) damaged++;
    const s = it.src;
    if (s.pages !== c.pages || s.img !== c.img || s.txt !== c.txt) {
      lost += Math.max(0, s.img - c.img) + Math.max(0, s.txt - c.txt);
      detail.push(`《${it.journal.name}》 文件里 ${s.pages}页/${s.img}图/${s.txt}段 → 实际存入 ${c.pages}页/${c.img}图/${c.txt}段`);
    }
  });
  let msg = items.length > 1
    ? `已导入 ${items.length} 本 · ${pages} 页 · ${img} 图 · ${txt} 段文字`
    : `已导入《${items[0].journal.name}》· ${pages} 页 · ${img} 图 · ${txt} 段文字`;
  const warn = [];
  if (damaged) warn.push(`${damaged} 本校验未通过，文件可能已损坏`);
  if (lost) warn.push(`有 ${lost} 项内容无法识别，已跳过`);
  if (dupCount) warn.push(`跳过 ${dupCount} 本内容重复的`);
  if (badFiles) warn.push(`有 ${badFiles} 个文件没能识别`);
  if (warn.length) {
    if (detail.length) console.warn('[import] 对账明细：\n' + detail.join('\n'));
    toast(msg + '（' + warn.join('；') + '）', 4200);
  } else {
    const verified = items.filter(it => it.ok === true).length;
    toast(msg + (verified === items.length ? ' · 校验通过' : ''), 3000);
  }
}
/* 导入：按内容摘要查重 → 收进书架 → 出核对报告 */
async function importJournals(items, badFiles) {
  if (!items || !items.length) {
    toast(badFiles ? '没能识别这个文件，请选择本应用导出的 .json 手帐本' : '文件是空的', 2800);
    return;
  }
  const fps = new Set();
  for (const j of state.journals) fps.add(await journalFP(j));
  const accept = [], dup = [];
  for (const it of items) {
    const fp = await journalFP(it.journal);
    if (fps.has(fp)) { dup.push(it); continue; }
    fps.add(fp); accept.push(it);
  }
  const commit = list => {
    const at = state.journals.length;
    list.forEach(it => state.journals.push(it.journal));
    state.sel = at;
    save(); renderHome();
    importReport(list, dup.length, badFiles || 0);
  };
  /* 全是重复：问一句要不要仍旧存一份（默认＝跳过） */
  if (dup.length && !accept.length) {
    const nm = dup.slice(0, 2).map(d => `《${d.journal.name}》`).join('、');
    askConfirm(`${nm}${dup.length > 2 ? ` 等 ${dup.length} 本` : ''}的内容和书架里已有的一本完全相同，确定还要再存一份吗？`, {
      title: '重复的手帐本', ok: '仍然导入', onOk: () => commit(items)
    });
    return;
  }
  commit(accept);
}
/* 读文本：老浏览器没有 Blob.text() 时退回 FileReader */
function readFileText(f) {
  if (f && f.text) return f.text();
  return new Promise(res => {
    const r = new FileReader();
    r.onload = () => res(String(r.result || ''));
    r.onerror = () => res('');
    r.readAsText(f);
  });
}
/* 选文件：支持一次选多个 .json */
function pickImportFile() {
  const inp = document.createElement('input');
  inp.type = 'file'; inp.accept = '.json,application/json,text/plain'; inp.multiple = true;
  inp.style.display = 'none';
  document.body.appendChild(inp);
  inp.onchange = async () => {
    const files = [...(inp.files || [])];
    inp.remove();
    if (!files.length) return;
    let items = [], bad = 0;
    for (const f of files) {
      try {
        const r = await readJournals(await readFileText(f));
        if (r.items.length) items.push(...r.items); else bad++;
      } catch (e) { console.warn('[import] 读取失败：' + f.name, e); bad++; }
    }
    try { await importJournals(items, bad); }
    catch (e) { console.error('[import] 失败：', e); toast('导入失败：' + ((e && e.message) || e), 4200); }
  };
  inp.click();
}
/* 帮助与反馈：唤起邮件，邮箱同时复制到剪贴板，防止 App 内拉不起邮件客户端 */
function openHelpMail() {
  const sub = encodeURIComponent('纸间手账 - 帮助与反馈');
  const body = encodeURIComponent('\n\n（请描述遇到的问题或建议）\n\n— 来自「纸间手账」');
  copyText(HELP_MAIL);
  window.location.href = `mailto:${HELP_MAIL}?subject=${sub}&body=${body}`;
  toast('已唤起邮件；若没打开可粘贴 ' + HELP_MAIL);
}

/* ==================== 状态 ==================== */
const state = { journals: [], sel: 0, mode: 'single', page: 0, spread: 0, flipping: false, imgDragging: false, imgResizing: false };
const cur = () => state.journals[state.sel];
const pageCount = () => cur() ? cur().pages.length : 0;

/* ==================== 初始数据 ==================== */
function mkPage() { return { images: [], texts: [] }; }
function mkPages(n) { return Array.from({ length: n }, mkPage); }
function pageTexts(pg) { if (!pg.texts) pg.texts = []; return pg.texts; }
function newText(x, y, t) {
        return { id: uid(), text: t || '', x: x ?? .16, y: y ?? .16, w: .56, h: .12,
                size: 5.5, color: '#2b2f3d', align: 'left', bold: false };
}
/* 预置小贴图（星星/爱心/叶子）的特征路径：用于把老数据里自带的装饰图案清理掉 */
function isSeedSticker(src) {
  const s = String(src || '');
  if (!s.startsWith('data:image/svg')) return false;
  let svg = '';
  try { svg = decodeURIComponent(s.split(',')[1] || ''); } catch (_) { return false; }
  return svg.indexOf('M12 2l2.9 6.2 6.8.8-5 4.6 1.3 6.7L12 17.9 6 20.3l1.3-6.7-5-4.6 6.8-.8z') > -1
      || svg.indexOf('M12 21s-8-5.2-8-11a4.7 4.7 0 018-3.3A4.7 4.7 0 0120 10c0 5.8-8 11-8 11z') > -1
      || svg.indexOf('M12 2C7 6 4 11 4 15a8 8 0 0016 0c0-4-3-9-8-13z') > -1;
}
function seed() {
  return [
    {
      id: uid(), name: '花之法典',
      /* 淡粉底（色板第二个粉）+ 爱心图案 + 彩带色板第二个色 */
      cover: { type: 'solid', value: COLORS[1], pattern: 'heart', img: null },
      ribbon: RIBBONS[1], template: 'grid', pages: mkPages(50), created: Date.now()
    },
    {
      id: uid(), name: '日志',
      cover: { type: 'gradient', value: GRADS[6], pattern: 'leaf', img: null },
      ribbon: '#7a5230', template: 'grid', pages: mkPages(7), created: Date.now() - 1000
    },
    {
      id: uid(), name: '冷少!',
      cover: { type: 'gradient', value: GRADS[5], pattern: 'star', img: null },
      ribbon: '#e0668a', template: 'dots', pages: mkPages(18), created: Date.now() - 2000
    },
  ];
}
function newJournal() {
  return {
    id: uid(), name: '未命名手帐',
    cover: { type: 'gradient', value: GRADS[1], pattern: 'none', img: null },
    ribbon: '#c98a8a', template: 'blank', pages: mkPages(1), created: Date.now()
  };
}

/* ==================== 封面渲染 ==================== */
function coverHTML(j) {
  const bg = j.cover.img ? `background-image:url('${j.cover.img}');background-size:cover;background-position:center;` : `background:${j.cover.value};`;
  return `<div class="cover" style="${bg}">
    <div class="pattern" data-pat="${j.cover.pattern || 'none'}" style="${patternStyle(j.cover.pattern, j.cover)}"></div>
    <div class="gloss"></div>
    <div class="spine" style="background:linear-gradient(90deg,${shade(j.ribbon, -22)},${j.ribbon} 55%,${shade(j.ribbon, 14)})"></div>
    <div class="edge"></div>
  </div>`;
}

/* ==================== 主页渲染 ==================== */
function renderHome() {
  const track = $('#carousel');
  track.innerHTML = state.journals.map((j, i) => `
    <div class="book-item${i === state.sel ? ' active' : ''}" data-i="${i}">
      ${coverHTML(j)}
      <div class="gear" data-gear="${i}" title="编辑">
        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round"><path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2.1"/><circle cx="8" cy="17" r="2.1"/></svg>
      </div>
      <div class="cover-badge">${j.pages.length} 页</div>
    </div>`).join('');
  const j = cur();
  const has = !!j;
  $('#homeName').textContent = has ? j.name : '还没有手帐本';
  $('#homePages').innerHTML = has ? `<span>▤</span><span>${j.pages.length} 页</span>` : `<span>▤</span><span>点右下角 ＋ 新建</span>`;
  $('#countPill').textContent = has ? `${state.sel + 1} / ${state.journals.length}` : '0 / 0';
  $('#hint').style.opacity = state.journals.length > 1 ? '.6' : '0';
  $$('.actionbar .icon-btn[data-act="del"],.actionbar .icon-btn[data-act="share"],.actionbar .icon-btn[data-act="more"]').forEach(b => b.disabled = !has);
  requestAnimationFrame(() => layoutCarousel(true));
}
/* 轮播：跟手拖拽 + 速度惯性吸附，缩放/明暗随与中心的距离实时变化 */
const carousel = (() => {
  const wrap = $('#carouselWrap'), track = $('#carousel');
  const EASE = 'transform .46s cubic-bezier(.22,.92,.24,1)';
  let items = [], off = 0, minOff = 0, maxOff = 0;
  let dragging = false, moved = false, startX = 0, startOff = 0, lastX = 0, lastT = 0, vel = 0;
  let suppressClick = false, wheelLock = 0;
  let holdTimer = 0, pendingEl = null, pendingX = 0, sorting = null;
  const HOLD_MS = 420;                          // 长按多久进入排序

  const centerOf = el => el.offsetLeft + el.offsetWidth / 2;
  function measure() {
    items = [...track.children];
    if (!items.length) { minOff = maxOff = 0; return; }
    const w = wrap.clientWidth;
    maxOff = w / 2 - centerOf(items[0]);
    minOff = w / 2 - centerOf(items[items.length - 1]);
    if (minOff > maxOff) { const t = minOff; minOff = maxOff; maxOff = t; }
  }
  function styleItems() {
    const view = wrap.clientWidth / 2 - off;
    items.forEach(el => {
      const d = Math.abs(centerOf(el) - view) / Math.max(el.offsetWidth * 1.25, 1);
      const k = Math.max(0, 1 - d);
      el.style.transform = `scale(${(1 + 0.055 * k).toFixed(4)})`;
      el.style.filter = `saturate(${(0.86 + 0.14 * k).toFixed(3)}) brightness(${(0.94 + 0.06 * k).toFixed(3)})`;
    });
  }
  function paint() {
    track.style.transform = `translate3d(${off.toFixed(2)}px,0,0)`;
    styleItems();
  }
  function ease(animate) {
    track.style.transition = animate ? EASE : 'none';
    items.forEach(el => el.style.transition = animate ? EASE + ',filter .46s ease' : 'none');
  }
  function snap(i, animate) {
    measure();
    if (!items.length) { track.style.transform = 'translate3d(0,0,0)'; return; }
    const idx = clamp(i, 0, items.length - 1);
    state.sel = idx;
    items.forEach((el, k) => el.classList.toggle('active', k === idx));
    const j = cur();
    if (j) {
      $('#homeName').textContent = j.name;
      $('#homePages').innerHTML = `<span>▤</span><span>${j.pages.length} 页</span>`;
    }
    $('#countPill').textContent = `${idx + 1} / ${items.length}`;
    off = wrap.clientWidth / 2 - centerOf(items[idx]);
    ease(animate);
    paint();
  }

  /* ===== 长按拖动排序：选中一本，左右拖到目标位置，松手落位 ===== */
  function buzz(ms) { try { navigator.vibrate && navigator.vibrate(ms); } catch (_) {} }
  function beginSort(el, x) {
    const els = [...track.children];
    const from = els.indexOf(el);
    if (from < 0 || els.length < 2) return;
    const bases = els.map(e => e.offsetLeft);
    const step = Math.abs(bases[1] - bases[0]) || el.offsetWidth;
    sorting = { el, els, bases, step, from, to: from, lastTo: from, startX: x,
                x, dx: 0, scroll: 0, auto: 0, raf: 0, lastT: 0, dragged: false };
    dragging = false; vel = 0;                  // 交出横向滚动的控制权
    wrap.classList.add('sortmode');
    el.classList.add('picked');
    buzz(12);
    applySort();
  }
  /* 手指拖不动了（到屏幕边）就用 scroll 接力：其余的书持续往反方向送，
     远处够不着的手帐本会一路被送到手边 */
  function scrollRange(s) {
    const lo = -s.from * s.step - s.dx, hi = (s.els.length - 1 - s.from) * s.step - s.dx;
    return [Math.min(lo, hi), Math.max(lo, hi)];
  }
  function autoTick(now) {
    const s = sorting;
    if (!s || !s.auto) { if (s) s.raf = 0; return; }
    const dt = Math.min(now - s.lastT, 60) / 1000;
    s.lastT = now;
    const [lo, hi] = scrollRange(s);
    const speed = s.step * (1.8 + 2.2 * (s.depth || 0));   // 手指越贴边，送得越快
    s.scroll = clamp(s.scroll + s.auto * speed * dt, lo, hi);
    applySort();
    s.raf = requestAnimationFrame(autoTick);
  }
  function applySort() {
    const s = sorting; if (!s) return;
    s.to = clamp(s.from + Math.round((s.dx + s.scroll) / s.step), 0, s.els.length - 1);
    if (s.to !== s.lastTo) { s.lastTo = s.to; buzz(8); }
    s.el.style.transform = `translateX(${s.dx.toFixed(1)}px) scale(1.07)`;
    const view = wrap.clientWidth / 2 - off;
    s.els.forEach((e, i) => {
      if (e === s.el) return;
      let shift = 0;
      if (s.to > s.from) { if (i > s.from && i <= s.to) shift = -s.step; }
      else if (s.to < s.from) { if (i >= s.to && i < s.from) shift = s.step; }
      shift -= s.scroll;
      const d = Math.abs(s.bases[i] + e.offsetWidth / 2 + shift - view) / Math.max(e.offsetWidth * 1.25, 1);
      const k = Math.max(0, 1 - d);
      e.style.transform = `translateX(${shift.toFixed(1)}px) scale(${(1 + 0.055 * k).toFixed(4)})`;
    });
  }
  function moveSort(x) {
    const s = sorting;
    s.x = x; s.dx = x - s.startX;
    if (Math.abs(s.dx) > 6) s.dragged = true;    // 真的拖动了才吞掉随后的 click
    const r = wrap.getBoundingClientRect(), edge = Math.max(56, r.width * 0.18);
    let a = 0, depth = 0;
    if (x > r.right - edge) { a = 1; depth = Math.min(1, (x - (r.right - edge)) / Math.max(edge, 1)); }
    else if (x < r.left + edge) { a = -1; depth = Math.min(1, ((r.left + edge) - x) / Math.max(edge, 1)); }
    s.depth = depth;
    if (a && !s.raf) { s.auto = a; s.lastT = performance.now(); s.raf = requestAnimationFrame(autoTick); }
    else if (!a && s.raf) { s.auto = 0; cancelAnimationFrame(s.raf); s.raf = 0; }
    else s.auto = a;
    applySort();
  }
  function endSort() {
    const s = sorting; sorting = null;
    if (s.raf) cancelAnimationFrame(s.raf);
    wrap.classList.remove('sortmode');
    s.el.classList.remove('picked');
    s.els.forEach(e => { e.style.transform = ''; });
    if (s.dragged) { suppressClick = true; setTimeout(() => suppressClick = false, 340); }
    const { from, to } = s;
    if (to === from) { snap(state.sel, true); return; }
    const arr = state.journals;
    arr.splice(to, 0, arr.splice(from, 1)[0]);
    save();
    let ns = state.sel;                          // 选中的那本跟着走
    if (state.sel === from) ns = to;
    else if (from < state.sel && to >= state.sel) ns = state.sel - 1;
    else if (from > state.sel && to <= state.sel) ns = state.sel + 1;
    renderHome();
    snap(clamp(ns, 0, state.journals.length - 1), false);
  }

  wrap.addEventListener('pointerdown', e => {
    if (e.target.closest('.gear')) return;
    measure();
    dragging = true; moved = false; vel = 0;
    startX = lastX = e.clientX; lastT = performance.now();
    startOff = off;
    ease(false);
    /* 手指按住不动才算长按；一旦开始横向滑就把长按作废，让位给滚动 */
    clearTimeout(holdTimer);
    pendingEl = e.target.closest('.book-item'); pendingX = e.clientX;
    holdTimer = setTimeout(() => { if (pendingEl) beginSort(pendingEl, pendingX); }, HOLD_MS);
  });
  window.addEventListener('pointermove', e => {
    if (sorting) { moveSort(e.clientX); return; }
    if (!dragging) return;
    const x = e.clientX, now = performance.now();
    const dx = x - startX;
    if (Math.abs(dx) > 5) { moved = true; clearTimeout(holdTimer); pendingEl = null; }
    const dt = now - lastT;
    if (dt > 6) { vel = vel * 0.7 + ((x - lastX) / dt) * 0.3 * 16.7; lastX = x; lastT = now; }
    let t = startOff + dx;
    if (t > maxOff) t = maxOff + (t - maxOff) * 0.3;
    else if (t < minOff) t = minOff + (t - minOff) * 0.3;
    off = t;
    paint();
  }, { passive: true });
  const endDrag = () => {
    clearTimeout(holdTimer); pendingEl = null;
    if (sorting) { endSort(); return; }
    if (!dragging) return;
    dragging = false;
    const proj = off + vel * 5;
    let best = state.sel, bd = Infinity;
    items.forEach((el, i) => {
      const d = Math.abs(centerOf(el) + proj - wrap.clientWidth / 2);
      if (d < bd) { bd = d; best = i; }
    });
    best = clamp(best, state.sel - 2, state.sel + 2);
    if (moved) { suppressClick = true; setTimeout(() => suppressClick = false, 340); }
    vel = 0;
    snap(best, true);
  };
  window.addEventListener('pointerup', endDrag);
  window.addEventListener('pointercancel', endDrag);
  wrap.addEventListener('wheel', e => {
    if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;
    const now = performance.now();
    if (now < wheelLock) return;
    wheelLock = now + 230;
    snap(state.sel + (e.deltaX > 0 ? 1 : -1), true);
  }, { passive: true });

  return {
    layout(animate) { measure(); snap(state.sel, animate); },
    snap,
    consumeClick() { const s = suppressClick; suppressClick = false; return s; }
  };
})();
function layoutCarousel(animate) { carousel.layout(animate); }
function selectJournal(i, animate = true) { carousel.snap(i, animate); }

/* ==================== 阅读器 ==================== */
function isSpread() {
  return window.innerWidth >= 620 && window.innerWidth > window.innerHeight * 1.12;
}
function layoutBook() {
  const stage = $('#stage'), book = $('#book');
  const availW = stage.clientWidth, availH = stage.clientHeight;
  const spread = state.mode === 'spread';
  /* 纸张统一用 3:4.05 —— 与封面（.cover）同比例，
     这样阅读器里铺满整页的封面和主页显示的封面完全一样 */
  const RATIO = 3 / 4.05;
  let pageH, pageW;
  if (spread) {
    pageH = Math.min(availH * 0.9, (availW * 0.94) / (2 * RATIO));
    pageW = pageH * RATIO;
  } else {
    pageW = Math.min(availW * 0.94, availH * 0.94 * RATIO);
    pageH = pageW / RATIO;
  }
  pageH = Math.max(pageH, 180);
  book.style.setProperty('--pw', pageW + 'px');
  book.style.setProperty('--ph', pageH + 'px');
  state.pw = pageW;                              // 封面翻页时要按半页宽做位移
}
/* 封面页：不属于正文页，-1 表示“封面” */
function coverPageHTML() {
  const j = cur();
  return `<div class="paper coverpage">${coverHTML(j)}</div>`;
}
function pageHTML(i, side) {
  const j = cur();
  const n = j.pages.length;
  if (i === -1) return coverPageHTML();
  if (i < 0 || i >= n) return `<div class="paper endpaper"></div>`;
  const pg = j.pages[i];
  const imgs = pg.images.map(im => {
    const hw = im.h || clamp(im.w / 0.68, .04, IMG_MAX);   // 老数据补兜底高度，加载后自动校准
    return `
    <div class="pimg-wrap${String(im.src).startsWith('data:image/svg') ? ' sticker' : ''}${im.locked ? ' locked' : ''}${im.fill ? ' fill' : ''}${tinyCls(im, hw)}" data-page="${i}" data-id="${im.id}"
         style="left:${(im.x * 100).toFixed(2)}%;top:${(im.y * 100).toFixed(2)}%;width:${(im.w * 100).toFixed(2)}%;height:${(hw * 100).toFixed(2)}%">
      <img class="pimg" draggable="false" src="${im.src}" alt="">
      <button class="img-del" title="删除">${DEL_SVG}</button>
      <div class="hdl tl" data-h="tl"></div>
      <div class="hdl tr" data-h="tr"></div>
      <div class="hdl bl" data-h="bl"></div>
      <div class="hdl br" data-h="br"></div>
      <button class="img-lock" title="固定到这一页">${LOCK_SVG}</button>
      <button class="img-lock img-fill" title="${im.fill ? '还原原比例' : '铺满整页'}">${im.fill ? RESTORE_SVG : FILL_SVG}</button>
    </div>`;
  }).join('');
  const txts = pageTexts(pg).map(t => {
    const st = textStyle(t);
    const cls = (t.text || '').trim() ? '' : ' placeholder';
    return `
    <div class="ptext-wrap${t.locked === false ? '' : ' locked'}" data-page="${i}" data-id="${t.id}"
         style="left:${(t.x * 100).toFixed(2)}%;top:${(t.y * 100).toFixed(2)}%;width:${(t.w * 100).toFixed(2)}%;height:${(t.h * 100).toFixed(2)}%">
      <div class="ptxt${cls}" style="${st}">${t.text ? esc(t.text) : '双击输入文字'}</div>
      <button class="img-del" title="删除文字">${DEL_SVG}</button>
      <div class="hdl tl" data-h="tl"></div>
      <div class="hdl tr" data-h="tr"></div>
      <div class="hdl bl" data-h="bl"></div>
      <div class="hdl br" data-h="br"></div>
    </div>`;
  }).join('');
  const kraft = (j.template === 'kraft' || j.template === 'kraftplain') ? 'background:linear-gradient(160deg,#ecdec4,#e0cfae);' : '';
  return `<div class="paper t-${j.template}" style="${kraft}">
    <div class="tplbg" style="${tplStyle(j.template)}"></div>
    <div class="pcontent">${imgs}${txts}</div>
    <div class="pnum">${i + 1}</div>
  </div>`;
}
function currentIndices() {
  if (state.mode === 'spread') return [state.spread * 2, state.spread * 2 + 1];
  return [state.page];
}
function isCoverView() {
  return state.mode === 'spread' ? state.spread < 0 : state.page < 0;
}
function renderReader() {
  commitTextEdit();                    // 重绘前先把正在编辑的文字存下来
  const book = $('#book');
  state.mode = isSpread() ? 'spread' : 'single';
  /* 封面就是「合着的书」：单独一整页，左边不再配一张空页 */
  const cov = isCoverView();
  /* 封面单独成页：不再加 single / spread，改用 cover-only 的骨架（跨页尺寸 + 左页收起 + 整本左移半页） */
  book.classList.toggle('single', state.mode === 'single');
  book.classList.toggle('spread', state.mode === 'spread' && !cov);
  book.classList.toggle('cover-only', cov && state.mode === 'spread');
  const n = pageCount();
  const [a, b] = currentIndices();
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
    if (r < n) txt = `${l + 1}–${r + 1} / ${n}`;
    else txt = `${l + 1} / ${n}`;
    pager.textContent = txt;
    pager.classList.add('jumpable');
    pager.title = '长按拖动选页';
    $('#prevBtn').disabled = false;
    $('#nextBtn').disabled = state.spread >= Math.ceil(n / 2) - 1;
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
  // 重绘后恢复选中态（字号/颜色调整会触发重绘）
  try {
    if (selText) {
      const w = $(`#slotL .ptext-wrap[data-id="${selText.iid}"], #slotR .ptext-wrap[data-id="${selText.iid}"]`);
      const t = textById(selText.pid, selText.iid);
      if (w && t && t.locked === false) w.classList.add('adjust');   // 只有解锁状态才保留调整框
    }
  } catch (_) {}
  syncTextBar();                       // 底栏跟着当前是否选中文字切换
  const sc = $('#scrub');
  if (sc && sc.classList.contains('show')) paintScrub();
  markAddTarget();                     // 翻页后目标页描边跟着走（不在本跨页就回落到左页）
  updateAddMenuHint();
}

/* ==================== 翻页 ==================== */
/* 逐帧驱动：翻页过程中可以立刻接受下一次翻页，不必等动画播完 */
/* 三次贝塞尔求值器：用牛顿迭代反解 t，翻页曲线可以随手调 */
function cubicBezier(x1, y1, x2, y2) {
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
  const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  const fx = t => ((ax * t + bx) * t + cx) * t;
  const dfx = t => (3 * ax * t + 2 * bx) * t + cx;
  const fy = t => ((ay * t + by) * t + cy) * t;
  return x => {
    if (x <= 0) return 0; if (x >= 1) return 1;
    let t = x;
    for (let i = 0; i < 6; i++) {
      const e = fx(t) - x; if (Math.abs(e) < 1e-5) break;
      const d = dfx(t); if (Math.abs(d) < 1e-6) break;
      t -= e / d;
    }
    return fy(Math.min(Math.max(t, 0), 1));
  };
}
/* 起步稍缓、中段快、收尾绵长 —— 比对称的 easeInOut 更接近真纸 */
const EASE_FLIP = cubicBezier(.42, 0, .24, 1);
let flipA = null, lastFlipAt = 0;
function endFlip() {
  if (!flipA) return;
  cancelAnimationFrame(flipA.raf);
  const dir = flipA.dir;
  flipA = null;
  if (state.mode === 'spread') state.spread += dir; else state.page += dir;
  const leaf = $('#leaf');
  leaf.classList.remove('show', 'turning');
  leaf.style.transition = 'none';
  leaf.style.transform = 'none';
  clearBookShift();                            // 清掉「翻开 / 合上」时的临时位移
  renderReader();
}
/* 清掉翻开 / 合上封面时临时写在书上的横移（内联样式优先于 cover-only 的类） */
function clearBookShift() { const bk = $('#book'); if (bk) bk.style.transform = ''; }
function cancelFlip() {
  if (flipA) { cancelAnimationFrame(flipA.raf); flipA = null; }
  clearBookShift();
}
function stepFlip(now) {
  if (!flipA) return;
  const p = clamp((now - flipA.t0) / flipA.dur, 0, 1);
  const e = EASE_FLIP(p);
  const deg = flipA.from + (flipA.to - flipA.from) * e;
  // 翻到中途把纸轻轻"抬"起来一点，避免转动看起来是纯 2D 压扁
  const lift = Math.sin(p * Math.PI) * 30;
  $('#leaf').style.transform = `translateZ(${lift.toFixed(1)}px) rotateY(${deg.toFixed(3)}deg)`;
  /* 封面 ↔ 第一跨页：书同时「摊开 / 合拢」——整本横移半页宽，
     前 42% 就把位移补齐，剩下的动作跟普通翻页一模一样 */
  if (flipA.slide) {
    const sp = clamp(p / 0.42, 0, 1), se = sp * sp * (3 - 2 * sp);
    const [s0, s1] = flipA.slide;
    $('#book').style.transform = `translateX(${(s0 + (s1 - s0) * se).toFixed(1)}px)`;
  }
  if (p < 1) flipA.raf = requestAnimationFrame(stepFlip);
  // onEnd：合书时借这套引擎翻一次，翻完自行收束，不走 endFlip（那会改页码并重绘）
  else if (flipA.onEnd) { const cb = flipA.onEnd; flipA = null; cb(); }
  else endFlip();
}
function flip(dir) {
  const n = pageCount();
  if (!n) return;
  commitTextEdit();                    // 翻页前先把正在编辑的文字存下来
  if (state.mode === 'spread') {
    const pairs = Math.ceil(n / 2), s = state.spread;
    if (dir > 0 && s >= pairs - 1) return;
    if (dir < 0 && s <= -1) return;
  } else {
    const p = state.page;
    if (dir > 0 && p >= n - 1) return;
    if (dir < 0 && p <= -1) return;
  }
  // 上一次翻页还没结束：立即落定，接着翻下一页，实现连续快翻
  if (flipA) endFlip();

  const leaf = $('#leaf'), lf = $('#leafF'), lb = $('#leafB');
  let start, end, slide = null;
  if (state.mode === 'spread') {
    const s = state.spread;
    let front, back, sL, sR;
    if (dir > 0) { front = s * 2 + 1; back = s * 2 + 2; sL = s * 2; sR = s * 2 + 3; }
    else { front = s * 2 - 1; back = s * 2; sL = s * 2 - 2; sR = s * 2 + 1; }
    $('#slotL').innerHTML = pageHTML(sL, 'left');
    $('#slotR').innerHTML = pageHTML(sR, 'right');
    lf.innerHTML = pageHTML(front, 'right');
    lb.innerHTML = pageHTML(back, 'left');
    start = dir > 0 ? 0 : -180;
    end = dir > 0 ? -180 : 0;
    /* 封面单独一页 ↔ 第一跨页：照样翻纸，同时让整本书横移半页宽完成摊开 / 合拢。
       封面打开：位移 -半页 → 0；合回封面：0 → -半页 */
    const half = (state.pw || 0) / 2;
    if (s === -1 && dir > 0) slide = [-half, 0];
    else if (s === 0 && dir < 0) { slide = [0, -half]; $('#book').classList.add('cover-only'); }
    if (slide) $('#slotL').innerHTML = '';   // 摊开 / 合拢过程中，左页不参与
  } else {
    const p = state.page;
    if (dir > 0) {
      $('#slotR').innerHTML = pageHTML(p + 1, 'single');
      lf.innerHTML = pageHTML(p, 'single');
      lb.innerHTML = pageHTML(p + 1, 'single');
      start = 0; end = -180;
    } else {
      $('#slotR').innerHTML = pageHTML(p, 'single');
      lf.innerHTML = pageHTML(p - 1, 'single');
      lb.innerHTML = pageHTML(p, 'single');
      start = -180; end = 0;
    }
  }

  const now = performance.now();
  const gap = now - lastFlipAt;
  lastFlipAt = now;
  // 连着翻：动画自动缩短，越点越快，且不会出现"排队等前一页"
  const dur = gap < 150 ? 200 : (gap < 320 ? 270 : (gap < 620 ? 370 : 500));

  leaf.classList.add('show', 'turning');
  leaf.style.transition = 'none';
  leaf.style.transform = `rotateY(${start}deg)`;
  flipA = { dir, from: start, to: end, slide, t0: now, dur, raf: requestAnimationFrame(stepFlip) };
}

/* ==================== 页面交互（图片拖拽 / 缩放 / 删除 / 添加） ==================== */
function bindPage() {
  const track = (startX, startY, move, done) => {
    const mv = ev => move(ev, startX, startY);
    const up = () => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up); done && done(); };
    window.addEventListener('pointermove', mv);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  };

  $$('#slotL .pimg-wrap, #slotR .pimg-wrap, #slotL .ptext-wrap, #slotR .ptext-wrap').forEach(w => {
    const pid = +w.dataset.page, iid = w.dataset.id;
    const pageEl = w.closest('.paper');
    const isText = w.classList.contains('ptext-wrap');
    /* 图片和文字共用一套拖拽 / 缩放 / 删除逻辑 */
    const getIm = () => {
      const pg = cur().pages[pid]; if (!pg) return null;
      return isText ? pageTexts(pg).find(x => x.id === iid) : (pg.images || []).find(x => x.id === iid);
    };

    /* 文字贴：解锁后（adjust 模式）拖动可移动，没挪动就当作轻点 → 进入编辑 */
    const startTextDrag = e => {
      e.preventDefault();
      state.imgDragging = true;
      const im = getIm(); if (!im) { state.imgDragging = false; return; }
      const rect = pageEl.getBoundingClientRect();
      const ox = im.x, oy = im.y;
      let moved = false;
      track(e.clientX, e.clientY, (ev, sx, sy) => {
        const dx = (ev.clientX - sx) / rect.width, dy = (ev.clientY - sy) / rect.height;
        if (Math.abs(dx) > .002 || Math.abs(dy) > .002) moved = true;
        im.x = clamp(ox + dx, -.15, .95);
        im.y = clamp(oy + dy, -.15, .95);
        w.style.left = (im.x * 100).toFixed(2) + '%';
        w.style.top = (im.y * 100).toFixed(2) + '%';
      }, () => {
        state.imgDragging = false;
        if (moved) save();
      });
    };
    /* 文字贴解锁 → 进入调整模式；点框外自动重新固定 */
    const lockText = () => {
      const im = getIm(); if (!im) return;
      im.locked = true; save();
      w.classList.add('locked');
      w.classList.remove('adjust', 'sel');
      if (w.__outDown) { document.removeEventListener('pointerdown', w.__outDown, true); w.__outDown = null; }
      hideTextBar();
    };
    const unlockText = () => {
      const im = getIm(); if (!im) return;
      im.locked = false; save();
      w.classList.remove('locked');
      w.classList.add('adjust');
      if (navigator.vibrate) { try { navigator.vibrate(12); } catch (_) {} }
      toast('已解锁 · 拖四角调大小');
      if (w.__outDown) document.removeEventListener('pointerdown', w.__outDown, true);
      w.__outDown = ev => {
        if (w.contains(ev.target)) return;
        if (ev.target.closest && ev.target.closest('.rbot, #tstyle, #addMenu')) return;
        document.removeEventListener('pointerdown', w.__outDown, true);
        w.__outDown = null;
        lockText();
      };
      document.addEventListener('pointerdown', w.__outDown, true);
    };

    const startDrag = e => {
      e.preventDefault();
      state.imgDragging = true;
      $$('.pimg-wrap,.ptext-wrap').forEach(x => x.classList.remove('sel', 'adjust'));
      w.classList.add('sel');
      const im = getIm(); if (!im) { state.imgDragging = false; return; }
      if (isText) { w.classList.remove('sel'); w.classList.add('adjust'); }
      const rect = pageEl.getBoundingClientRect();
      const ox = im.x, oy = im.y;
      let moved = false, brought = false;
      track(e.clientX, e.clientY, (ev, sx, sy) => {
        const dx = (ev.clientX - sx) / rect.width, dy = (ev.clientY - sy) / rect.height;
        if (Math.abs(dx) > .002 || Math.abs(dy) > .002) moved = true;
        im.x = clamp(ox + dx, -.15, .95);
        im.y = clamp(oy + dy, -.15, .95);
        w.style.left = (im.x * 100).toFixed(2) + '%';
        w.style.top = (im.y * 100).toFixed(2) + '%';
        // 只有真的动起来才把元素挪到最上层 —— 否则会打断双击判定
        if (moved && !brought) { brought = true; pageEl.querySelector('.pcontent').appendChild(w); }
      }, () => { state.imgDragging = false; if (moved) save(); });
    };

    w.addEventListener('pointerdown', e => {
      if (e.target.closest('.img-del') || e.target.closest('.hdl') || e.target.closest('.img-lock') || e.target.closest('.txt-edit')) return;
      const im = getIm(); if (!im) return;
      if (isText) {
        if (w.classList.contains('editing')) return;      // 正在打字：让光标正常工作
        /* 只有双击才进入输入：单击不做任何事，避免误触 */
        const now = performance.now();
        if (now - (w.__tTap || 0) < 340 &&
            Math.abs(e.clientX - (w.__xTap || 0)) < 26 && Math.abs(e.clientY - (w.__yTap || 0)) < 26) {
          w.__tTap = 0;
          e.preventDefault(); e.stopPropagation();
          startTextEdit(w, pid, iid);
          return;
        }
        w.__tTap = now; w.__xTap = e.clientX; w.__yTap = e.clientY;
        if (w.classList.contains('adjust')) { startTextDrag(e); return; }   // 已解锁：按住可拖动挪位置
        /* 已固定：单击无反应；长按 400ms = 解锁并调整大小 */
        e.preventDefault();
        const sx0 = e.clientX, sy0 = e.clientY;
        let far = false;
        const timer = setTimeout(() => unlockText(), 400);
        const mv = ev => {
          if (far) return;
          if (Math.abs(ev.clientX - sx0) > 8 || Math.abs(ev.clientY - sy0) > 8) { far = true; clearTimeout(timer); }
        };
        const up = () => {
          clearTimeout(timer);
          window.removeEventListener('pointermove', mv);
          window.removeEventListener('pointerup', up);
          window.removeEventListener('pointercancel', up);
        };
        window.addEventListener('pointermove', mv);
        window.addEventListener('pointerup', up);
        window.addEventListener('pointercancel', up);
        return;
      }
      if (!im.locked) { startDrag(e); return; }
      // 已固定：需要长按 420ms 才能重新移动
      e.preventDefault();
      const sx = e.clientX, sy = e.clientY;
      let timer = setTimeout(() => {
        timer = null;
        im.locked = false;
        w.classList.remove('locked');
        save();
        toast('已解除固定 · 可以移动了');
        if (navigator.vibrate) { try { navigator.vibrate(12); } catch (_) {} }
        startDrag({ clientX: sx, clientY: sy, preventDefault() {} });
      }, 420);
      const cancel = ev => {
        if (!timer) return;
        if (Math.abs(ev.clientX - sx) > 10 || Math.abs(ev.clientY - sy) > 10) { clearTimeout(timer); timer = null; }
      };
      const up = () => { clearTimeout(timer); timer = null; window.removeEventListener('pointermove', cancel); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up); };
      window.addEventListener('pointermove', cancel);
      window.addEventListener('pointerup', up);
      window.addEventListener('pointercancel', up);
    });

    // 四角拉伸：横竖都能自由调节，对角线另一端保持不动
    w.querySelectorAll('.hdl').forEach(h => {
      h.addEventListener('pointerdown', e => {
        e.preventDefault(); e.stopPropagation();
        const im = getIm(); if (!im || im.locked) return;
        const rect = pageEl.getBoundingClientRect();
        const c = h.dataset.h;
        const ox = im.x, oy = im.y, ow = im.w, oh = im.h || ow / 0.68;
        const oL = ox, oR = ox + ow, oT = oy, oB = oy + oh;
        const ratio = ow / Math.max(oh, 1e-4);
        const moveLeft = c === 'tl' || c === 'bl', moveTop = c === 'tl' || c === 'tr';
        let moved = false;
        // 拉伸期间让按钮让位：不抢手势、也不挡住角上的视线
        w.classList.add('resizing');
        state.imgResizing = true;
        syncTiny(w, im);
        track(e.clientX, e.clientY, (ev, sx, sy) => {
          const dx = (ev.clientX - sx) / rect.width, dy = (ev.clientY - sy) / rect.height;
          // 用四条边来算：被拖的角移动两条边，对角固定
          let L = moveLeft ? oL + dx : oL;
          let R = moveLeft ? oR : oR + dx;
          let T = moveTop ? oT + dy : oT;
          let B = moveTop ? oB : oB + dy;
          if (ev.shiftKey) {                        // 按住 Shift 等比缩放
            const nw0 = R - L, nh0 = nw0 / ratio;
            if (moveTop) T = B - nh0; else B = T + nh0;
          }
          // 限制在纸内，四个角的调节手柄始终看得见、点得到
          L = clamp(L, IMG_M, 1 - IMG_M); R = clamp(R, IMG_M, 1 - IMG_M);
          T = clamp(T, IMG_M, 1 - IMG_M); B = clamp(B, IMG_M, 1 - IMG_M);
          if (R - L < IMG_MIN_W) { if (moveLeft) L = Math.max(IMG_M, R - IMG_MIN_W); else R = Math.min(1 - IMG_M, L + IMG_MIN_W); }
          if (B - T < IMG_MIN_H) { if (moveTop) T = Math.max(IMG_M, B - IMG_MIN_H); else B = Math.min(1 - IMG_M, T + IMG_MIN_H); }
          const nw = Math.max(R - L, IMG_MIN_W), nh = Math.max(B - T, IMG_MIN_H);
          if (Math.abs(nw - ow) > .002 || Math.abs(nh - oh) > .002 || Math.abs(L - ox) > .002 || Math.abs(T - oy) > .002) moved = true;
          im.x = L; im.y = T; im.w = nw; im.h = nh;
          applyBox(w, im);
          syncTiny(w, im);
          pageEl.querySelector('.pcontent').appendChild(w);
        }, () => {
          w.classList.remove('resizing');
          state.imgResizing = false;
          if (moved) {
            save();
            if (isText) { lockText(); toast('已固定'); }   // 文字调完大小默认自动固定
          }
        });
      });
    });
    const delBtn = w.querySelector('.img-del');
    if (delBtn) delBtn.addEventListener('pointerdown', e => {
      e.preventDefault(); e.stopPropagation();
      if (isText) {
        const arr = pageTexts(cur().pages[pid]);
        const k = arr.indexOf(getIm());
        if (k >= 0) arr.splice(k, 1);
        if (w.__outDown) { document.removeEventListener('pointerdown', w.__outDown, true); w.__outDown = null; }
        hideTextBar();
        toast('已删除文字');
      }
      else cur().pages[pid].images = cur().pages[pid].images.filter(x => x.id !== iid);
      save(); renderReader();
    });
    // 文字贴没有铺满按钮
    if (!w.querySelector('.img-lock:not(.img-fill)')) return;
    w.querySelector('.img-lock:not(.img-fill)').addEventListener('pointerdown', e => {
      e.preventDefault(); e.stopPropagation();
      const im = getIm(); if (!im) return;
      im.locked = true;
      w.classList.add('locked', 'justlock');
      w.classList.remove('sel');
      setTimeout(() => w.classList.remove('justlock'), 460);
      save();
      toast('已固定在第 ' + (pid + 1) + ' 页 · 长按可重新移动');
    });
    /* 铺满整页：撑满整张纸（object-fit:cover 裁切，不拉伸），并自动固定
       —— 不固定的话整页都是图片，左右滑动就变成拖图、没法翻页了 */
    const fillBtn = w.querySelector('.img-fill');
    if (fillBtn && !isText) fillBtn.addEventListener('pointerdown', async e => {
      e.preventDefault(); e.stopPropagation();
      const im = getIm(); if (!im) return;
      if (im.fill) {
        const r = await imgRatio(im.src);
        im.fill = false; im.locked = false;
        im.w = .42;
        im.h = clamp(im.w * r * paperAspect(), .04, IMG_MAX);
        im.x = .22; im.y = .2;
        save(); renderReader();
        toast('已还原原比例');
      } else {
        im.fill = true; im.x = 0; im.y = 0; im.w = 1; im.h = 1;
        im.locked = true;
        save(); renderReader();
        toast('已铺满整页 · 已固定，长按可解锁');
      }
    });
  });

}

/* ==================== 右上角「添加」：加页 / 图片 / 文字 ==================== */
/* 新内容加到哪一页。双页模式下左右两页都能加：
   - 默认落在当前跨页的左页
   - 「+」菜单展开时点某一页，就把那一页设为目标（右页也能选）
   - 在某一页上拖图片 / 编辑文字，也会把那一页记为最近操作页 */
let addPageIdx = null;                       // 用户指定的目标页；null = 跟随当前视图
function slotPageIndex(slotEl) {             // 某个页槽当前显示的是第几页（-1 = 封面 / 衬页）
  if (state.mode !== 'spread') return state.page;
  const [a, b] = currentIndices();
  return slotEl && slotEl.id === 'slotL' ? a : b;
}
function syncAddFocusFrom(el) {              // 交互发生在哪一页，就把目标页跟到哪一页
  const slot = el && el.closest ? el.closest('#slotL, #slotR') : null;
  if (!slot) return;
  const pid = slotPageIndex(slot);
  if (pid >= 0) addPageIdx = pid;
}
function setAddTarget(pid) {
  const j = cur(); if (!j) return;
  addPageIdx = clamp(pid, 0, Math.max(j.pages.length - 1, 0));
}
/* 新内容加到哪一页：停在某页上操作就加在那页，否则取当前跨页左页 */
function currentAddPage() {
  const j = cur(); if (!j || !j.pages.length) return 0;
  const n = j.pages.length;
  if (state.mode === 'spread') {
    const a = state.spread * 2, b = a + 1;
    if (addPageIdx === a || addPageIdx === b) return clamp(addPageIdx, 0, n - 1);
    return clamp(a, 0, n - 1);
  }
  return clamp(state.page, 0, n - 1);
}
/* 菜单上标出目标页码 + 双页时的「左页 / 右页」切换条 */
function updateAddMenuHint() {
  const j = cur(); if (!j) return;
  const p = currentAddPage();
  const ok = !!j.pages[p];
  $$('#addMenu .am-p').forEach(s => {
    const btn = s.closest('button');
    // 「加一页」说的是插在哪一页后面，其余两项说的是加到哪一页
    s.textContent = ok ? (btn && btn.dataset.addact === 'page'
      ? '· 在第 ' + (p + 1) + ' 页后' : '· 第 ' + (p + 1) + ' 页') : '';
  });
  const row = $('#amTarget'); if (!row) return;
  const two = state.mode === 'spread' && !isCoverView();
  const [a, b] = currentIndices();
  row.classList.toggle('hide', !two);
  $$('#amTarget .am-side').forEach(btn => {
    const pid = btn.dataset.side === 'L' ? a : b;
    const ok = pid >= 0 && !!j.pages[pid];
    btn.textContent = (btn.dataset.side === 'L' ? '左页 ' : '右页 ') + (pid + 1);
    btn.classList.toggle('on', ok && pid === p);
    btn.disabled = !ok;
  });
}
/* 两页描边，目标页更亮 + 顶上挂标签；菜单关掉就全部撤掉 */
function markAddTarget() {
  const book = $('#book'), m = $('#addMenu');
  const open = !!(m && m.classList.contains('show'));
  const two = state.mode === 'spread' && !isCoverView();
  book.classList.toggle('picking', open && two);
  const t = (open && two) ? currentAddPage() : -1;
  const [a, b] = currentIndices();
  $('#slotL').classList.toggle('add-target', two && t >= 0 && t === a);
  $('#slotR').classList.toggle('add-target', two && t >= 0 && t === b);
}
function addImageTo(pid) {
  state.pendingPage = pid;
  const fp = $('#filePicker'); if (fp) fp.click();
}
function addTextTo(pid) {
  const j = cur(); if (!j || !j.pages.length) return;
  pid = clamp(pid, 0, j.pages.length - 1);
  const t = newText(.16, .16);
  pageTexts(j.pages[pid]).push(t);
  save(); renderReader();
  const w = $(`#slotL .ptext-wrap[data-id="${t.id}"], #slotR .ptext-wrap[data-id="${t.id}"]`);
  if (w) startTextEdit(w, pid, t.id);
  else showTextBar(null, pid, t.id);
  toast('已添加到第 ' + (pid + 1) + ' 页 · 双击可再编辑');
}
function closeAddMenu() {
  const m = $('#addMenu'); if (m) m.classList.remove('show');
  const b = $('#rAdd'); if (b) b.classList.remove('on');
  markAddTarget();                    // 撤掉页面上的目标描边
}
function toggleAddMenu(force) {
  const m = $('#addMenu'); if (!m) return;
  const show = force !== undefined ? force : !m.classList.contains('show');
  m.classList.toggle('show', show);
  const b = $('#rAdd'); if (b) b.classList.toggle('on', show);
  if (show) updateAddMenuHint();      // 菜单里标出「· 第 N 页」
  markAddTarget();
}

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
function selTextWrap() {
  if (!selText) return null;
  return $(`#slotL .ptext-wrap[data-id="${selText.iid}"], #slotR .ptext-wrap[data-id="${selText.iid}"]`);
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

/* ==================== 图片上传 ==================== */
/* 纸张宽高比：图片数据的 h 是“占页高的比例”，需要用纸的比例换算 */
function paperAspect() {
  const el = $('#slotR .paper') || $('#slotL .paper');
  if (el) {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) return r.width / r.height;
  }
  return 0.68;
}
function imgRatio(src) {
  return new Promise(res => {
    const t = new Image();
    t.onload = () => res(t.naturalWidth > 0 && t.naturalHeight > 0 ? t.naturalHeight / t.naturalWidth : 1);
    t.onerror = () => res(1);
    t.src = src;
  });
}
/* 图片太小时，删除 / 固定按钮跟着缩小，避免占满图面干扰拉伸 */
const TINY_W = .22, TINY_H = .13;
/* 图片四角永远留在纸张范围内：手柄不会被页面裁掉，四个角都点得到 */
const IMG_M = .02;            // 距纸边留白，保证手柄可点
const IMG_MAX = 1 - IMG_M * 2; // 最大占页比例
/* 最小尺寸留够空间，删除 / 固定两个小按钮不会互相压住 */
const IMG_MIN_W = .1, IMG_MIN_H = .1;
function tinyCls(im, h) {
  const hh = h || im.h || clamp(im.w / 0.68, .04, IMG_MAX);
  let c = (im.w < TINY_W || hh < TINY_H) ? ' tiny' : '';
  // 贴到纸的上/下边缘时，删除 / 固定按钮改挂在内侧，免得被裁掉
  if ((im.y ?? 0) < .025) c += ' edge-t';
  if ((im.y ?? 0) + hh > .975) c += ' edge-b';
  return c;
}
function syncTiny(w, im) {
  if (im.w < TINY_W || (im.h || 0) < TINY_H) w.classList.add('tiny');
  else w.classList.remove('tiny');
}
function applyBox(w, im) {
  w.style.left = (im.x * 100).toFixed(2) + '%';
  w.style.top = (im.y * 100).toFixed(2) + '%';
  w.style.width = (im.w * 100).toFixed(2) + '%';
  if (im.h) w.style.height = (im.h * 100).toFixed(2) + '%';
  syncTiny(w, im);
}
/* 老数据只有宽度：按图片原始比例补齐高度，只跑一次 */
let fillingHeights = false;
function ensureImageHeights() {
  if (fillingHeights) return;
  const j = cur(); if (!j) return;
  const tasks = [];
  j.pages.forEach(pg => pg.images.forEach(im => { if (!im.h) tasks.push(im); }));
  if (!tasks.length) return;
  fillingHeights = true;
  const pa = paperAspect();
  // 占页高比例 = 占页宽比例 × 图片宽高比 × 纸张宽高比（保持原图比例，不被拉伸）
  Promise.all(tasks.map(im => imgRatio(im.src).then(r => { im.h = clamp(im.w * r * pa, .04, IMG_MAX); })))
    .then(() => {
      fillingHeights = false; save();
      // 正在拖 / 正在拉伸 / 正在打字时不要重绘，否则会打断手势和输入，稍后再补一次
      if (pageBusy()) {
        setTimeout(() => { if (!pageBusy()) renderReader(); }, 700);
        return;
      }
      renderReader();
    });
}
$('#filePicker').addEventListener('change', async e => {
  const f = e.target.files[0]; if (!f) return;
  const pid = state.pendingPage ?? (state.mode === 'spread' ? state.spread * 2 : state.page);
  const src = await new Promise(res => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = () => res(null);
    r.readAsDataURL(f);
  });
  e.target.value = '';
  if (!src) return;
  const j = cur();
  if (!j.pages[pid]) return;
  const w = 0.42;
  const h = clamp(w * (await imgRatio(src)) * paperAspect(), .04, IMG_MAX);   // 保持原始宽高比
  j.pages[pid].images.push({ id: uid(), src, x: 0.22, y: 0.2, w, h });
  save(); renderReader();
  toast('已添加到第 ' + (pid + 1) + ' 页');
});
$('#coverFile').addEventListener('change', e => {
  const f = e.target.files[0]; if (!f) return;
  const r = new FileReader();
  r.onload = () => { ed.temp.cover.img = r.result; syncEditor(); };
  r.readAsDataURL(f);
  e.target.value = '';
});

/* ==================== 自定义取色盘 ====================
   App 内置浏览器常常唤不起原生 input[type=color]，所以这里自己做一套：
   上面是饱和度 / 明度面板，下面是色相条，也可以直接填色值。 */
const cp = { h: 340, s: .68, v: .9, apply: null, dragging: false };
function hsvToHex(h, s, v) {
  const f = n => {
    const k = (n + h / 60) % 6;
    return Math.round(255 * (v - v * s * Math.max(0, Math.min(k, 4 - k, 1))));
  };
  return '#' + [f(5), f(3), f(1)].map(x => x.toString(16).padStart(2, '0')).join('');
}
function hexToHsv(hex) {
  let c = String(hex || '').replace('#', '').trim();
  if (c.length === 3) c = c.split('').map(x => x + x).join('');
  if (!/^[0-9a-fA-F]{6}$/.test(c)) return null;
  const r = parseInt(c.slice(0, 2), 16) / 255, g = parseInt(c.slice(2, 4), 16) / 255, b = parseInt(c.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0;
  if (d) {
    if (max === r) h = 60 * ((g - b) / d + (g < b ? 6 : 0));
    else if (max === g) h = 60 * ((b - r) / d + 2);
    else h = 60 * ((r - g) / d + 4);
  }
  return { h: Math.round(h), s: max ? d / max : 0, v: max };
}
/* keepInput：正在手输色值时不回写输入框，免得把光标和已输入内容打乱 */
function paintCP(keepInput) {
  const hex = hsvToHex(cp.h, cp.s, cp.v);
  $('#cpSV').style.background =
    `linear-gradient(to top,#000,rgba(0,0,0,0)),linear-gradient(to right,#fff,rgba(255,255,255,0)),hsl(${cp.h},100%,50%)`;
  $('#cpDot').style.left = (cp.s * 100).toFixed(2) + '%';
  $('#cpDot').style.top = ((1 - cp.v) * 100).toFixed(2) + '%';
  $('#cpHueDot').style.left = (cp.h / 360 * 100).toFixed(2) + '%';
  $('#cpPrev').style.background = hex;
  if (!keepInput) $('#cpHex').value = hex.toUpperCase();
  return hex;
}
function openColorPicker(title, hex, apply) {
  const hsv = hexToHsv(hex);
  if (hsv) { cp.h = hsv.h; cp.s = hsv.s > .02 ? hsv.s : .68; cp.v = hsv.v > .02 ? hsv.v : .9; }
  cp.apply = apply;
  $('#cpTitle').textContent = title || '自定义颜色';
  paintCP();
  $('#cpMask').classList.add('show');
}
function closeColorPicker() { $('#cpMask').classList.remove('show'); cp.apply = null; cp.dragging = false; }
$('#cpClose').onclick = closeColorPicker;
$('#cpCancel').onclick = closeColorPicker;
$('#cpMask').addEventListener('click', e => { if (e.target === $('#cpMask')) closeColorPicker(); });
$('#cpOk').onclick = () => {
  const apply = cp.apply, hex = hsvToHex(cp.h, cp.s, cp.v);
  closeColorPicker();
  if (apply) apply(hex);
};
$('#cpHex').addEventListener('input', () => {
  const hsv = hexToHsv($('#cpHex').value);
  if (!hsv) return;
  cp.h = hsv.h; cp.s = hsv.s; cp.v = hsv.v;
  paintCP(true);
});
$('#cpHex').addEventListener('focus', () => $('#cpMask').classList.add('kb'));
/* 失焦后面板回位要延后：立刻移位会正好吞掉「确定 / 取消」那一下点击 */
$('#cpHex').addEventListener('blur', () => { paintCP(); setTimeout(() => $('#cpMask').classList.remove('kb'), 240); });
/* 面板与色相条：按下即取色，拖动连续取色（自己接管手势，不依赖系统能力） */
function bindCPDrag(el, onPick) {
  const pick = ev => {
    const r = el.getBoundingClientRect();
    onPick(clamp((ev.clientX - r.left) / r.width, 0, 1), clamp((ev.clientY - r.top) / r.height, 0, 1));
  };
  el.addEventListener('pointerdown', ev => {
    cp.dragging = true;
    try { el.setPointerCapture(ev.pointerId); } catch (_) {}
    pick(ev); ev.preventDefault();
  });
  el.addEventListener('pointermove', ev => { if (cp.dragging) pick(ev); });
  el.addEventListener('pointerup', () => { cp.dragging = false; });
  el.addEventListener('pointercancel', () => { cp.dragging = false; });
}
bindCPDrag($('#cpSV'), (x, y) => { cp.s = x; cp.v = 1 - y; paintCP(); });
bindCPDrag($('#cpHue'), x => { cp.h = Math.round(x * 360); paintCP(); });

/* ==================== 编辑器 ==================== */
const ed = { temp: null, isNew: true };
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
  $('#edRibbons').innerHTML = RIBBONS.map(c =>
    `<div class="swatch" data-ribbon="${c}" style="background:${c}"></div>`).join('');
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
  /* 图案颜色：整栏常驻（不再整栏隐藏），没选图案时压暗 + 标题后给提示 */
  const patOn = ed.temp.cover.pattern && ed.temp.cover.pattern !== 'none';
  $('#edPatColorWrap').classList.toggle('pat-off', !patOn);
  {
    const pc = /^#[0-9a-fA-F]{6}$/i.test(String(ed.temp.cover.patColor || '')) ? ed.temp.cover.patColor.toLowerCase() : '';
    $$('#edPatColors .swatch:not(.custom)').forEach(s =>
      s.classList.toggle('on', (s.dataset.patcolor || '').toLowerCase() === pc));
    syncCustomSwatch('#edPatCustom', '#edPatTip', pc, PAT_COLORS);
  }
  const spineBg = `linear-gradient(90deg,${shade(ed.temp.ribbon, -22)},${ed.temp.ribbon} 55%,${shade(ed.temp.ribbon, 14)})`;
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
    if (sp) sp.style.background = spineBg;
  });
  $$('#edTemplates .tpl').forEach(s => s.classList.toggle('on', ed.temp.template === s.dataset.tpl));
  const hasImg = !!ed.temp.cover.img;
  $('#edThumb').style.display = hasImg ? 'block' : 'none';
  $('#edThumb').style.backgroundImage = hasImg ? `url(${ed.temp.cover.img})` : '';
  $('#edClearImg').style.display = hasImg ? 'block' : 'none';
}
$('#edCancel').onclick = closeEditor;
$('#edSave').onclick = () => {
  const t = ed.temp;
  t.name = ($('#edName').value || '').trim() || '未命名手帐';
  const want = clamp(parseInt($('#edPages').value) || t.pages.length, 1, 200);
  if (want !== t.pages.length) {
    if (want > t.pages.length) while (t.pages.length < want) t.pages.push({ images: [], texts: [] });
    else t.pages = t.pages.slice(0, want);
  }
  if (ed.isNew) { state.journals.push(t); state.sel = state.journals.length - 1; }
  else { state.journals[state.sel] = t; }
  save(); closeEditor(); renderHome(); renderReader();
  toast(ed.isNew ? '手帐本已创建' : '已保存修改');
};

/* ==================== 主页交互 ==================== */
$('#carousel').addEventListener('click', e => {
  if (carousel.consumeClick()) return;
  const gear = e.target.closest('[data-gear]');
  if (gear) { openEditor(cur()); return; }
  const item = e.target.closest('.book-item');
  if (!item) return;
  const i = +item.dataset.i;
  if (i !== state.sel) selectJournal(i);
  else openReader();
});
/* ==================== 通用确认弹窗 ==================== */
let confirmCb = null;
function askConfirm(text, opt) {
  const o = opt || {};
  $('#confirmTitle').textContent = o.title || '确认操作';
  $('#confirmText').textContent = text;
  $('#confirmOk').textContent = o.ok || '确定';
  confirmCb = o.onOk;
  $('#confirmMask').classList.add('show');
}
function closeConfirm() { $('#confirmMask').classList.remove('show'); confirmCb = null; }
$('#confirmCancel').onclick = closeConfirm;
$('#confirmOk').onclick = () => { const cb = confirmCb; closeConfirm(); cb && cb(); };
$('#confirmMask').addEventListener('click', e => { if (e.target === $('#confirmMask')) closeConfirm(); });

/* ==================== 搜索 ==================== */
function toggleSearch(open) {
  const p = $('#searchPanel');
  p.classList.toggle('show', open);
  if (open) { renderSearch(''); setTimeout(() => { try { $('#searchInput').focus(); } catch (_) {} }, 320); }
  else $('#searchInput').value = '';
}
function renderSearch(q) {
  const box = $('#searchResults');
  const key = (q || '').trim().toLowerCase();
  const list = key
    ? state.journals.filter(j => String(j.name || '').toLowerCase().includes(key))
    : state.journals.slice();
  if (!list.length) {
    box.innerHTML = `<div class="sr-empty">${state.journals.length ? '没有找到匹配的手帐本' : '还没有手帐本，先新建一个吧'}</div>`;
    return;
  }
  const re = key ? new RegExp('(' + key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'ig') : null;
  /* 缩略图按主页真实封面宽度等比缩小，图案比例不走样 */
  const realCover = document.querySelector('.carousel .cover');
  const cw = Math.max(42, realCover ? Math.round(realCover.offsetWidth) || 148 : 148);
  box.style.setProperty('--sr-cw', cw + 'px');
  box.style.setProperty('--sr-k', (42 / cw).toFixed(4));
  box.innerHTML = list.map(j => {
    const i = state.journals.indexOf(j);
    const nm = re ? esc(j.name).replace(re, '<mark>$1</mark>') : esc(j.name);
    const d = new Date(j.created || Date.now());
    const date = `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
    return `<div class="sr-item" data-i="${i}">
      <div class="sr-thumb">${coverHTML(j)}</div>
      <div class="info"><div class="nm">${nm}</div><div class="meta">${j.pages.length} 页 · ${date}</div></div>
    </div>`;
  }).join('');
  $$('#searchResults .sr-item').forEach(el => el.onclick = () => {
    const i = +el.dataset.i;
    toggleSearch(false);
    if (i >= 0) selectJournal(i, true);
  });
}
$('#searchBtn').onclick = () => toggleSearch(!$('#searchPanel').classList.contains('show'));
$('#searchClose').onclick = () => toggleSearch(false);
$('#searchInput').oninput = e => renderSearch(e.target.value);
document.addEventListener('pointerdown', e => {
  if (!$('#searchPanel').classList.contains('show')) return;
  if (e.target.closest('#searchPanel') || e.target.closest('#searchBtn')) return;
  toggleSearch(false);
});

// 底部按钮
$$('.actionbar .icon-btn').forEach(b => b.onclick = () => {
  const a = b.dataset.act;
  if (a === 'new') { openEditor(null); }
  else if (a === 'more') { openEditor(cur()); }
  else if (a === 'del') {
    const j = cur(); if (!j) return;
    askConfirm(`手帐本「${j.name}」及其 ${j.pages.length} 页内容会被删除，此操作不可恢复。`, {
      title: '删除手帐本', ok: '删除',
      onOk: () => {
        state.journals.splice(state.sel, 1);
        state.sel = clamp(state.sel, 0, Math.max(0, state.journals.length - 1));
        save(); renderHome();
        toast('已删除「' + j.name + '」');
      }
    });
  } else if (a === 'share') {
    exportJournal(cur());
  }
});

/* ==================== 主页右上角菜单 / 分享菜单 ==================== */
function closeMenus() { $$('.addmenu.show').forEach(m => m.classList.remove('show')); }
function toggleMenu(el) {
  const open = !el.classList.contains('show');
  closeMenus();
  if (open) el.classList.add('show');
}
$$('#homeMenu button').forEach(b => b.onclick = () => {
  closeMenus();
  const a = b.dataset.menuact;
  if (a === 'import') pickImportFile();
  else if (a === 'help') openHelpMail();
});
/* 点空白处收起菜单 */
document.addEventListener('pointerdown', e => {
  if (e.target.closest('.addmenu') || e.target.closest('#menuBtn')) return;
  /* 阅读器的「+」菜单：点页面是「切换加到哪一页」，不能在这一步关掉它 */
  const am = $('#addMenu');
  if (am && am.classList.contains('show') && (e.target.closest('#book') || e.target.closest('#rAdd'))) return;
  closeMenus();
});
$('#menuBtn').onclick = () => toggleMenu($('#homeMenu'));

/* ==================== 阅读器交互 ==================== */
/* 开合动画：把主页封面「飞」成书，关闭时再飞回去 */
const FLY_MS = 560;
const FLY_OUT_MS = 600;                          // 关闭：慢慢缩回主页
const FLY_EASE = 'cubic-bezier(.22,1,.28,1)';   // 收尾更绵长，落地不生硬
const FOLD_MS = 400;                             // 合书：右页沿书脊翻到左侧
const FLIP_BACK_STEP = 160;                      // 回封面：连续快翻的节奏（比原来更急）
const FLIP_BACK_BUDGET = 720;                    // 回封面总预算，翻太久就直接落到封面
let flyBusy = false;
function coverRect() {
  const el = $('.book-item.active .cover') || $('.book-item .cover');
  return el ? el.getBoundingClientRect() : null;
}
/* 画面上「封面那一页」的位置：合上书之后封面躺在左槽，平时在右槽；
   也不能去量整本书 —— 封面单独成页时书比封面宽一倍 */
function coverPageRect() {
  const el = $('#slotL .paper.coverpage') || $('#slotR .paper.coverpage');
  return (el || $('#book')).getBoundingClientRect();
}
function flyCover(from, to, reverse) {
  const j = cur(); if (!j || !from || !to) return null;
  const ghost = document.createElement('div');
  ghost.className = 'cover-ghost';
  ghost.innerHTML = coverHTML(j);
  ghost.style.width = from.width + 'px';
  ghost.style.height = from.height + 'px';
  const at = r => `translate(${r.left}px,${r.top}px)`;
  const sx = to.width / Math.max(from.width, 1), sy = to.height / Math.max(from.height, 1);
  const fromT = reverse ? `${at(to)} scale(${sx},${sy})` : at(from);
  const toT = reverse ? at(from) : `${at(to)} scale(${sx},${sy})`;
  ghost.style.transform = fromT;
  // 关闭时不做渐变：封面一路保持不透明，直接缩回主页封面大小
  if (!reverse) ghost.style.animation = `ghostOut ${FLY_MS}ms ease both`;
  $('#app').appendChild(ghost);
  const ms = reverse ? FLY_OUT_MS : FLY_MS;
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      ghost.style.transition = `transform ${ms}ms ${FLY_EASE}`;
      ghost.style.transform = toT;
    });
  });
  setTimeout(() => ghost.remove(), ms + 60);
  return ghost;
}
function openReader() {
  if (flyBusy || !cur()) return;
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
    book.classList.remove('book-in', 'book-out', 'gone', 'folded');
    renderReader();
    return;
  }
  flyBusy = true;
  home.classList.remove('book-returning');
  home.classList.add('book-opening');
  reader.classList.add('book-opening');
  reader.classList.add('show');
  book.classList.remove('book-out', 'gone', 'folded');
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
function atCoverView() {
  return state.mode === 'spread' ? state.spread <= -1 : state.page <= -1;
}
/* ① 无论停在第几页，先连续快翻回封面 */
function flipBackToCover() {
  return new Promise(done => {
    let budget = FLIP_BACK_BUDGET;
    const tick = () => {
      if (!$('#reader').classList.contains('show') || !cur()) { done(); return; }
      if (flipA) endFlip();                     // 先让上一页落定，否则 flip 的边界守卫会用到滞后的页码，翻过头
      if (atCoverView()) {
        if (state.spread <= -1) state.page = -1;
        done(); return;
      }
      if (budget <= 0) {                       // 页数太多就别磨蹭，直接落到封面
        state.page = -1; state.spread = -1; renderReader(); done(); return;
      }
      budget -= FLIP_BACK_STEP;
      flip(-1);                                // 上一页没翻完会被立刻落定，形成"哗哗翻"的快翻手感
      setTimeout(tick, FLIP_BACK_STEP);
    };
    tick();
  });
}
/* ② 合上书：把右页沿书脊翻到左侧，封面朝外，再把书收拢成一本 */
function foldBook() {
  const END = '<div class="paper endpaper"></div>';
  return new Promise(done => {
    const book = $('#book'), leaf = $('#leaf'), lf = $('#leafF'), lb = $('#leafB');
    lf.innerHTML = $('#slotR').innerHTML;        // 正面：当前摊着的右页，原样搬走，视觉不断
    lb.innerHTML = coverPageHTML();              // 背面：翻过去之后朝外的就是封面
    $('#slotR').innerHTML = END;                 // 右页被"掀"起来，底下露出衬页
    leaf.classList.add('show', 'turning');
    leaf.style.transition = 'none';
    leaf.style.transform = 'rotateY(0deg)';
    /* 直接用翻页引擎合书：一次完整的翻页，手感跟平时翻页一模一样。
       不自己写 CSS transition —— leaf 刚从隐藏变可见时首帧起点容易丢，动画会被吞掉 */
    flipA = {
      dir: -1, from: 0, to: -180, dur: FOLD_MS, raf: 0, t0: performance.now(),
      onEnd: () => {
        $('#slotL').innerHTML = coverPageHTML();    // 交接给左边槽位，封面位置纹丝不动
        leaf.classList.remove('show', 'turning');
        leaf.style.transition = 'none';
        leaf.style.transform = 'none';
        state.page = -1; state.spread = -1;         // 书已合上，状态回到封面（不重绘，免得合拢形态被冲掉）
        $('#pager').textContent = '封面';            // 底栏页码跟上（整体重绘会破坏合拢形态，这里只改文字）
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
  const leaf = $('#leaf');
  if (leaf) { leaf.classList.remove('show', 'turning'); leaf.style.transition = 'none'; leaf.style.transform = 'none'; }
  $('#reader').classList.remove('show', 'closing');
  $('#book').classList.remove('book-out', 'gone', 'folded');
  $('#book').style.transform = '';
  $('#home').classList.remove('book-returning');
}
/* 退场：先翻回封面 → 合上书 → 缩小回主页 */
async function runCloseSequence(to) {
  const reader = $('#reader'), book = $('#book');
  const alive = () => reader.classList.contains('show') && !!cur();
  await flipBackToCover();
  if (!alive()) { endClose(); return; }
  /* 单页模式本来就「合着」，停在封面时也只有一张封面，都不用再合一次 */
  if (state.mode === 'spread' && !atCoverView()) {
    await foldBook();
    if (!alive()) { endClose(); return; }
  }
  const from = coverPageRect();                 // 封面那一页的位置（可能是左槽也可能是右槽）
  state.page = -1; state.spread = -1;          // 单页模式没经过合书，这里统一归位到封面态
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
    book.classList.remove('book-in', 'book-out', 'gone', 'folded');
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
    closeAddMenu();
    if (act === 'img') { addImageTo(currentAddPage()); return; }
    if (act === 'text') { addTextTo(currentAddPage()); return; }
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
let menuClosedAt = 0;                  // 点空白处刚关掉菜单：这一下不该翻页
document.addEventListener('pointerdown', e => {
  const m = $('#addMenu');
  if (!m || !m.classList.contains('show')) return;
  if (e.target.closest('#addMenu') || e.target.closest('#rAdd')) return;
  if (e.target.closest('#book')) return;      // 菜单展开时点页面 = 挑加到哪一页，不关菜单
  closeAddMenu();
  menuClosedAt = performance.now();
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
    state.spread = clamp(Math.floor(at / 2), 0, Math.max(Math.ceil(j.pages.length / 2) - 1, 0));
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
}
/* ==================== 页数轴：长按页码拖着选页 ==================== */
const SCRUB_PAD = 18;            // 轴两端留白，滑块不会顶到边缘
let scrubOn = false, scrubHideT = null, scrubRaf = 0, scrubJob = null;
function scrubCount() {
  const n = pageCount();
  return state.mode === 'spread' ? Math.max(Math.ceil(n / 2), 1) : Math.max(n, 1);
}
function scrubIndex() {
  return state.mode === 'spread' ? state.spread : state.page;
}
function buildScrub() {
  const count = scrubCount();
  const step = count > 40 ? Math.ceil(count / 24) : 1;
  let html = '';
  for (let i = 0; i < count; i++) html += `<i class="${i % step === 0 ? 'maj' : ''}"></i>`;
  $('#scrubTicks').innerHTML = html;
}
function paintScrub() {
  const track = $('#scrubTrack');
  if (!track) return;
  const w = track.clientWidth - SCRUB_PAD * 2;
  const i = clamp(scrubIndex(), 0, Math.max(scrubCount() - 1, 0));
  const last = Math.max(scrubCount() - 1, 1);
  const x = SCRUB_PAD + (i / last) * Math.max(w, 1);
  const xs = x.toFixed(1) + 'px';
  const bar = $('#scrubBar'), num = $('#scrubNum');
  if (bar) bar.style.left = xs;
  if (num) { num.style.left = xs; num.textContent = state.mode === 'spread' ? String(i * 2 + 1) : String(i + 1); }
  const fill = $('#scrubFill'); if (fill) fill.style.width = xs;
}
/* 落位到某一格：页面立刻跟着变，实现“页数随拖动条变化” */
function setScrubIndex(idx) {
  idx = clamp(Math.round(idx), 0, Math.max(scrubCount() - 1, 0));
  if (idx === scrubIndex()) return;
  if (state.mode === 'spread') state.spread = idx; else state.page = idx;
  renderReader();
  if (navigator.vibrate) { try { navigator.vibrate(6); } catch (_) {} }
}
/* 手指在轴上：按绝对位置落格 */
function idxFromAbs(clientX) {
  const t = $('#scrubTrack'); if (!t) return scrubIndex();
  const r = t.getBoundingClientRect();
  const w = Math.max(r.width - SCRUB_PAD * 2, 1);
  const ratio = clamp((clientX - r.left - SCRUB_PAD) / w, 0, 1);
  return Math.round(ratio * Math.max(scrubCount() - 1, 0));
}
/* 从页码长按出来的：按位移量走，滑块不会跳到手指下方 */
function idxFromDelta(clientX, startX, startIdx) {
  const t = $('#scrubTrack'); if (!t) return scrubIndex();
  const per = Math.max((t.clientWidth - SCRUB_PAD * 2) / Math.max(scrubCount() - 1, 1), 1);
  return startIdx + Math.round((clientX - startX) / per);
}
/* 每帧最多重绘一次 */
function queueScrub(fn) {
  scrubJob = fn;
  if (scrubRaf) return;
  scrubRaf = requestAnimationFrame(() => {
    scrubRaf = 0;
    const job = scrubJob; scrubJob = null;
    if (!job || !scrubOn) return;
    setScrubIndex(job());
    paintScrub();
  });
}
function openScrub(clientX, absolute) {
  const n = pageCount();
  if (!n) { toast('还没有页面'); return; }
  if (isCoverView()) {                       // 停在封面时，从第 1 页开始选
    if (state.mode === 'spread') state.spread = 0; else state.page = 0;
    renderReader();
  }
  buildScrub();
  hideTextBar();                             // 页数轴和文字样式条不同时出现
  $('#scrub').classList.add('show', 'dragging');
  scrubOn = true;
  clearTimeout(scrubHideT);
  paintScrub();
  const startX = clientX, startIdx = scrubIndex();
  const mv = ev => queueScrub(() => absolute ? idxFromAbs(ev.clientX) : idxFromDelta(ev.clientX, startX, startIdx));
  const up = () => {
    window.removeEventListener('pointermove', mv);
    window.removeEventListener('pointerup', up);
    window.removeEventListener('pointercancel', up);
    $('#scrub').classList.remove('dragging');
    scrubOn = false;
    clearTimeout(scrubHideT);
    scrubHideT = setTimeout(closeScrub, 800);
  };
  window.addEventListener('pointermove', mv);
  window.addEventListener('pointerup', up);
  window.addEventListener('pointercancel', up);
}
function closeScrub() {
  clearTimeout(scrubHideT);
  scrubOn = false;
  const s = $('#scrub');
  if (s) { s.classList.remove('show', 'dragging'); }
  const p = $('#pager');
  if (p) p.classList.remove('pressing');
}
/* 长按页码 320ms 唤出页数轴；轻点给出提示 */
(() => {
  const p = $('#pager');
  let timer = null, sx = 0, sy = 0, fired = false;
  p.addEventListener('pointerdown', e => {
    if (scrubOn) return;
    e.preventDefault();
    sx = e.clientX; sy = e.clientY; fired = false;
    p.classList.add('pressing');
    timer = setTimeout(() => {
      timer = null; fired = true;
      openScrub(e.clientX);
      if (navigator.vibrate) { try { navigator.vibrate(12); } catch (_) {} }
    }, 320);
    const move = ev => {
      if (Math.abs(ev.clientX - sx) > 10 || Math.abs(ev.clientY - sy) > 10) {
        clearTimeout(timer); timer = null; p.classList.remove('pressing');
      }
    };
    const up = () => {
      clearTimeout(timer); timer = null;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      if (!fired) { p.classList.remove('pressing'); toast('长按页码，拖动选页'); }
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  });
  // 轴还在的这会儿，可以直接按在轴上拖动（绝对定位落格）
  $('#scrubTrack').addEventListener('pointerdown', e => {
    if (scrubOn) return;
    e.preventDefault(); e.stopPropagation();
    clearTimeout(scrubHideT);
    openScrub(e.clientX, true);
  });
})();
// 键盘
window.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    if ($('#confirmMask').classList.contains('show')) { closeConfirm(); return; }
    if ($('#searchPanel').classList.contains('show')) { toggleSearch(false); return; }
    if ($('#mask').classList.contains('show')) { closeEditor(); return; }
  }
  if (!$('#reader').classList.contains('show')) return;
  if (e.key === 'ArrowRight') flip(1);
  else if (e.key === 'ArrowLeft') flip(-1);
  else if (e.key === 'Escape') closeReader();
});
// 滑动翻页：图片未固定时在图片上拖动是移动图片；固定后，图片上也能左右滑动翻页
(() => {
  const stage = $('#stage');
  let sx = 0, sy = 0, active = false;
  stage.addEventListener('pointerdown', e => {
    if (performance.now() - menuClosedAt < 500) { active = false; return; }  // 刚关菜单：只关菜单
    if (e.target.closest('.tstyle')) return;
    syncAddFocusFrom(e.target);               // 在哪一页上操作，新内容就默认加到那一页
    const img = e.target.closest('.pimg-wrap');
    if (img && !img.classList.contains('locked')) return;
    const tw = e.target.closest('.ptext-wrap');
    // 正在输入 / 正在调整大小的文字贴自己处理手势；已固定的文字和固定图片一样可以滑动翻页
    if (tw && (tw.classList.contains('editing') || tw.classList.contains('adjust'))) return;
    if (!e.target.closest('.img-del,.hdl,.img-lock,.txt-edit')) {
      hideTextBar();                                // 点空白处：收起文字样式条
    }
    $$('.pimg-wrap,.ptext-wrap').forEach(x => { if (x !== tw) x.classList.remove('sel', 'adjust'); });
    sx = e.clientX; sy = e.clientY; active = true;
  });
  stage.addEventListener('pointerup', e => {
    if (!active) return; active = false;
    if (state.imgDragging) return;
    const dx = e.clientX - sx, dy = e.clientY - sy;
    if (Math.abs(dx) > 46 && Math.abs(dx) > Math.abs(dy)) flip(dx < 0 ? 1 : -1);
    else if (Math.abs(dx) < 6 && Math.abs(dy) < 6) {
      // 刚收尾文字编辑：这一下只是「退出输入」，不要顺手翻页
      if (performance.now() - (window.__textCommitAt || 0) < 450) return;
      /* 「+」菜单开着时点页面 = 切换目标页（右页也能选），不翻页 */
      const m = $('#addMenu');
      if (m && m.classList.contains('show') && state.mode === 'spread' && !isCoverView()) {
        const slot = e.target.closest('#slotL, #slotR');
        if (slot) {
          const pid = slotPageIndex(slot);
          if (pid >= 0 && cur().pages[pid]) {
            setAddTarget(pid); markAddTarget(); updateAddMenuHint();
            return;
          }
        }
      }
      // 点击左右半区翻页（图片 / 文字区域除外，避免误触）
      if (e.target.closest('.pimg-wrap') || e.target.closest('.ptext-wrap')) return;
      if (e.target.closest('.img-del') || e.target.closest('.hdl') || e.target.closest('.img-lock') || e.target.closest('.txt-edit')) return;
      const r = stage.getBoundingClientRect();
      const x = e.clientX - r.left;
      flip(x > r.width / 2 ? 1 : -1);
    }
  });
  stage.addEventListener('pointercancel', () => active = false);
})();

/* ==================== 自适应 ==================== */
let rzTimer = null, lastVW = window.innerWidth;
window.addEventListener('resize', () => {
  clearTimeout(rzTimer);
  rzTimer = setTimeout(() => {
    layoutCarousel(false);
    const vw = window.innerWidth;
    const widthChanged = vw !== lastVW;
    lastVW = vw;
    /* 只有宽度真变了（转屏 / 窗口缩放）才重排阅读器。
       输入法弹起只改高度，这时候重绘会把正在编辑的文本框重建掉，输入法就被收走了。 */
    if (!widthChanged || pageBusy()) return;
    if ($('#reader').classList.contains('show')) {
      const wasSpread = state.mode === 'spread';
      const nowSpread = isSpread();
      if (wasSpread && !nowSpread) state.page = Math.max(state.spread * 2, -1);   // 停在封面时转单页仍然是封面
      else if (!wasSpread && nowSpread) state.spread = Math.floor(state.page / 2);
      renderReader();
    }
  }, 160);
});

/* ==================== toast ==================== */
let toastTimer = null;
function toast(msg, ms) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), Number(ms) > 0 ? Math.min(Number(ms), 8000) : 1800);
}

/* ==================== 启动 ==================== */
(async function init() {
  let data = await DB.get(KEY);
  if (!data || !Array.isArray(data) || !data.length) { data = seed(); await DB.set(KEY, data); }
  /* 一次性迁移：「日历」模板已下线，老数据自动换成现在的空白牛皮纸 */
  let migrated = false;
  /* 已下线的「日历」模板迁移到空白牛皮纸 */
  data.forEach(j => { if (j && j.template === 'calendar') { j.template = 'kraftplain'; migrated = true; } });
  /* 一次性迁移：封面图案「曼陀罗」换成「圆形」、「齿轮」换成「三角形」，老封面自动跟着改 */
  data.forEach(j => {
    if (j && j.cover && PAT_MAP[j.cover.pattern]) { j.cover.pattern = PAT_MAP[j.cover.pattern]; migrated = true; }
  });
  if (migrated) await DB.set(KEY, data);
  /* 一次性换装：预置手帐《花之法典》换成淡粉底 + 爱心图案 + 第二条彩带色。
     只认「还是老样子」的那一本，用户自己改过的封面不会被覆盖 */
  let restyled = false;
  data.forEach(j => {
    if (j && j.name === '花之法典' && j.cover && !j.cover.img
        && j.cover.value === GRADS[0] && j.cover.pattern === 'circle') {
      j.cover.type = 'solid'; j.cover.value = COLORS[1]; j.cover.pattern = 'heart';
      j.ribbon = RIBBONS[1];
      restyled = true;
    }
  });
  if (restyled) await DB.set(KEY, data);
  /* 一次性清理：把老数据里预置的星星/爱心/叶子小贴图整批去掉，内页不再自带装饰图案 */
  let cleaned = false;
  data.forEach(j => (j && j.pages ? j.pages : []).forEach(pg => {
    if (pg && Array.isArray(pg.images) && pg.images.some(im => isSeedSticker(im && im.src))) {
      pg.images = pg.images.filter(im => !isSeedSticker(im && im.src));
      cleaned = true;
    }
  }));
  if (cleaned) await DB.set(KEY, data);
  state.journals = data;
  state.sel = 0;
  renderHome();
  window.addEventListener('load', () => layoutCarousel(false));
  setTimeout(() => layoutCarousel(true), 60);
})();
