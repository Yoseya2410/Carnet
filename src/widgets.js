/* =====================================================================
 * Carnet · 通用控件 · 取色盘与背景面板   （脚本 20 / 28）
 * ---------------------------------------------------------------------
 * ① 自定义取色盘 openColorPicker：HSV 面板 + 色相条 + 手输色值
 *    （App 内置浏览器常唤不起原生 input[type=color]，所以自己实现一套）
 * ② 吸管取色 openEyedropper：只取手账本里的内容，现场取色、不弹窗
 *    （点吸管后浮层一律让位藏起，直接在活页面上点；从 elementsFromPoint 逐层合成取色，
 *      图片把屏幕坐标逆映射回原始像素采样，CSS 渐变 / 图案 / 模板细线则把 background-*
 *      塞进 SVG foreignObject 栅格化后再按点取样；放大镜按半个 CSS 像素取样，旋转 / 缩放都对得上）
 * ③ 背景设置面板 openBgPanel：预设色 / 自定义色 / 背景图片 / 恢复默认
 *
 * 对外接口：openColorPicker, closeColorPicker, openEyedropper, openBgPanel
 *
 * 依赖模块：core, storage
 *
 * 说明：模块间共用全局作用域，加载顺序即依赖顺序（见 index.html 与 README）。
 * ===================================================================== */
/* ==================== 自定义取色盘 ====================
   三种输入方式共用一份 HSV 状态：规则色阶网格、纵向色相光谱、RGB / HEX 精确输入。
   所有修改先落在面板里，点「使用颜色」才调用 apply，避免拖滑块时反复改动本子。 */
const CP_DEFAULT_SWATCHES = ['#ffffff', '#ffe600', '#f38ff2', '#1687d9', '#086b4d'];
const CP_GRID_HUES = [180, 210, 240, 270, 300, 330, 0, 25, 40, 55, 75, 95];
const CP_GRID_LEVELS = [[.86, .30], [.90, .40], [.92, .52], [.94, .66], [.96, .82], [.90, 1], [.64, 1], [.40, 1], [.20, 1]];
const cp = { h: 0, s: 0, v: 1, apply: null, dragging: false, kbTimer: 0,
  mode: 'spectrum', built: false, colors: [], gridOn: null };
/* 取色盘遮罩上「这一下按下是不是点在遮罩空白处」，见下面的 click 判定 */
let cpPressOutside = false;
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
  /* 保留小数色相，避免 HEX→HSV→HEX 往返时通道差 1。 */
  return { h, s: max ? d / max : 0, v: max };
}
const CP_GRID_COLORS = [
  ...Array.from({ length: 12 }, (_, i) => hsvToHex(0, 0, 1 - i / 11)),
  ...CP_GRID_LEVELS.flatMap(([s, v]) => CP_GRID_HUES.map(h => hsvToHex(h, s, v)))
];
function cpRGB() {
  const h = hsvToHex(cp.h, cp.s, cp.v);
  return { r: parseInt(h.slice(1, 3), 16), g: parseInt(h.slice(3, 5), 16), b: parseInt(h.slice(5, 7), 16) };
}
function cpRGBToHex(rgb) {
  return '#' + [rgb.r, rgb.g, rgb.b].map(n => clamp(Math.round(n), 0, 255).toString(16).padStart(2, '0')).join('');
}
function cpSetHex(hex, keepInput) {
  const hsv = hexToHsv(hex);
  if (!hsv) return false;
  cp.h = hsv.h; cp.s = hsv.s; cp.v = hsv.v;
  paintCP(!!keepInput);
  return true;
}
function cpSetChannel(k, value) {
  if (value === '' || !isFinite(+value)) return;
  const rgb = cpRGB(); rgb[k] = clamp(Math.round(+value), 0, 255);
  cpSetHex(cpRGBToHex(rgb));
}
function cpBuildSwatches() {
  $('#cpSwatches').innerHTML = cp.colors.map(c =>
    `<button class="cp-swatch" data-color="${c}" style="background:${c}" title="${c.toUpperCase()}" aria-label="选择 ${c.toUpperCase()}"></button>`).join('');
}
function cpSaveSwatches() {
  try { localStorage.setItem('carnet_cp_swatches_v1', JSON.stringify(cp.colors)); } catch (_) {}
}
function buildCP() {
  if (cp.built) return;
  let saved = [];
  try {
    const raw = JSON.parse(localStorage.getItem('carnet_cp_swatches_v1') || '[]');
    if (Array.isArray(raw)) saved = raw.filter(c => !!hexToHsv(c)).map(c => {
      const h = hexToHsv(c); return hsvToHex(h.h, h.s, h.v);
    });
  } catch (_) {}
  cp.colors = (saved.length ? saved : CP_DEFAULT_SWATCHES).slice(0, 8);
  $('#cpGrid').innerHTML = CP_GRID_COLORS.map(c =>
    `<button class="cp-cell" data-color="${c}" style="background:${c}" title="${c.toUpperCase()}" aria-label="选择 ${c.toUpperCase()}"></button>`).join('');
  cpBuildSwatches();
  $('#cpGrid').addEventListener('click', e => {
    const b = e.target.closest('.cp-cell'); if (b) cpSetHex(b.dataset.color);
  });
  $('#cpSwatches').addEventListener('click', e => {
    const b = e.target.closest('.cp-swatch'); if (b) cpSetHex(b.dataset.color);
  });
  $$('.cp-tab').forEach(b => b.addEventListener('click', () => setCPMode(b.dataset.cpmode)));
  [['r', '#cpR', '#cpRN'], ['g', '#cpG', '#cpGN'], ['b', '#cpB', '#cpBN']].forEach(([k, sk, nk]) => {
    const slider = $(sk), num = $(nk);
    slider.addEventListener('input', () => cpSetChannel(k, slider.value));
    slider.addEventListener('keydown', e => e.stopPropagation());
    num.addEventListener('input', () => cpSetChannel(k, num.value));
  });
  $('#cpAdd').onclick = () => {
    const hex = hsvToHex(cp.h, cp.s, cp.v), at = cp.colors.indexOf(hex);
    if (at >= 0) cp.colors.splice(at, 1);
    cp.colors.push(hex);
    while (cp.colors.length > 8) cp.colors.shift();
    cpSaveSwatches(); cpBuildSwatches(); paintCP();
    const last = $('#cpSwatches').lastElementChild;
    if (last) last.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
  };
  cp.built = true;
}
function setCPMode(mode) {
  cp.mode = ['grid', 'spectrum', 'sliders'].includes(mode) ? mode : 'spectrum';
  const ids = { grid: '#cpModeGrid', spectrum: '#cpModeSpectrum', sliders: '#cpModeSliders' };
  Object.keys(ids).forEach(k => { $(ids[k]).hidden = k !== cp.mode; });
  $$('.cp-tab').forEach(b => {
    const on = b.dataset.cpmode === cp.mode;
    b.classList.toggle('on', on); b.setAttribute('aria-selected', on ? 'true' : 'false');
  });
  paintCP();
}
/* keepInput：正在手输 HEX 时不回写，免得把光标和已输入内容打乱。 */
function paintCP(keepInput) {
  const hex = hsvToHex(cp.h, cp.s, cp.v), rgb = cpRGB();
  /* 光谱横轴左半是白→纯色，右半是纯色→黑，纵轴是完整色相。
     任意 HSV 色切回光谱时，投影到这两条边上；不会仅因切换模式改变颜色。 */
  let x;
  if (cp.s < .001) x = cp.v >= .5 ? 0 : 1;
  else {
    const x1 = clamp(cp.s / 2, 0, .5), x2 = clamp(1 - cp.v / 2, .5, 1);
    const e1 = (cp.s - 2 * x1) ** 2 + (cp.v - 1) ** 2;
    const e2 = (cp.s - 1) ** 2 + (cp.v - (2 - 2 * x2)) ** 2;
    x = e1 < e2 ? x1 : x2;
  }
  $('#cpDot').style.left = (x * 100).toFixed(2) + '%';
  $('#cpDot').style.top = (cp.h / 360 * 100).toFixed(2) + '%';
  $('#cpPrev').style.background = hex;
  $('#cpPrev').title = '当前颜色 ' + hex.toUpperCase();
  if (cp.gridOn) cp.gridOn.classList.remove('on');
  cp.gridOn = $(`#cpGrid .cp-cell[data-color="${hex}"]`) || null;
  if (cp.gridOn) cp.gridOn.classList.add('on');
  $$('#cpSwatches .cp-swatch').forEach(b => b.classList.toggle('on', b.dataset.color === hex));
  [['r', '#cpR', '#cpRN'], ['g', '#cpG', '#cpGN'], ['b', '#cpB', '#cpBN']].forEach(([k, sk, nk]) => {
    const slider = $(sk), num = $(nk);
    slider.value = rgb[k];
    if (document.activeElement !== num) num.value = rgb[k];
    const lo = { r: rgb.r, g: rgb.g, b: rgb.b }, hi = { r: rgb.r, g: rgb.g, b: rgb.b };
    lo[k] = 0; hi[k] = 255;
    slider.style.setProperty('--cp-track', `linear-gradient(90deg,${cpRGBToHex(lo)},${cpRGBToHex(hi)})`);
    slider.setAttribute('aria-valuetext', String(rgb[k]));
    num.setAttribute('aria-label', ({ r: '红色', g: '绿色', b: '蓝色' })[k] + '数值');
  });
  if (!keepInput) $('#cpHex').value = hex.toUpperCase();
  return hex;
}
function openColorPicker(title, hex, apply) {
  buildCP();
  const hsv = hexToHsv(hex);
  /* 白、黑与灰色也必须原样打开，不能像旧版那样替换成高饱和默认色。 */
  if (hsv) { cp.h = hsv.h; cp.s = hsv.s; cp.v = hsv.v; }
  cp.apply = apply;
  clearTimeout(cp.kbTimer);
  cpPressOutside = false;
  $('#cpTitle').textContent = title || '颜色';
  $('#cpMask').classList.remove('kb');
  setCPMode(cp.mode);
  $('#cpMask').classList.add('show');
}
function closeColorPicker() {
  clearTimeout(cp.kbTimer);
  $('#cpMask').classList.remove('show', 'kb');
  cp.apply = null; cp.dragging = false; cpPressOutside = false;
}
$('#cpClose').onclick = closeColorPicker;
/* 点遮罩外面才收面板：按下与 click 都必须落在遮罩，键盘顶起面板时也不会误关。 */
$('#cpMask').addEventListener('pointerdown', e => { cpPressOutside = (e.target === $('#cpMask')); });
$('#cpMask').addEventListener('click', e => {
  if (cpPressOutside && e.target === $('#cpMask')) closeColorPicker();
  cpPressOutside = false;
});
$('#cpOk').onclick = () => {
  const apply = cp.apply, hex = hsvToHex(cp.h, cp.s, cp.v);
  closeColorPicker();
  if (apply) apply(hex);
};
$('#cpHex').addEventListener('input', () => cpSetHex($('#cpHex').value, true));
/* 输入框按键不漏给全局快捷键；Enter 应用、Esc 只收取色盘。
   键盘弹起后面板延后再移位，避免 mousedown / mouseup 之间换位置而吞掉点击。 */
function bindCPField(el) {
  el.addEventListener('keydown', e => {
    e.stopPropagation();
    if (e.key === 'Enter') { e.preventDefault(); $('#cpOk').click(); }
    else if (e.key === 'Escape') { e.preventDefault(); closeColorPicker(); }
  });
  el.addEventListener('focus', () => {
    clearTimeout(cp.kbTimer);
    cp.kbTimer = setTimeout(() => {
      if (document.activeElement === el) $('#cpMask').classList.add('kb');
    }, 160);
  });
  el.addEventListener('blur', () => {
    clearTimeout(cp.kbTimer); paintCP();
    setTimeout(() => {
      const a = document.activeElement;
      if (!a || !a.matches('#cpHex,.cp-num')) $('#cpMask').classList.remove('kb');
    }, 240);
  });
}
bindCPField($('#cpHex'));
$$('.cp-num').forEach(bindCPField);
/* 光谱按下即取色，拖动连续取色；移动事件按帧合并，松手 flush 补上最终位置。 */
function bindCPDrag(el, onPick) {
  let rect = null;
  const q = frameQueue(ev => {
    if (!rect) return;
    onPick(clamp((ev.clientX - rect.left) / rect.width, 0, 1),
           clamp((ev.clientY - rect.top) / rect.height, 0, 1));
  });
  el.addEventListener('pointerdown', ev => {
    cp.dragging = true;
    rect = el.getBoundingClientRect();
    try { el.setPointerCapture(ev.pointerId); } catch (_) {}
    q.push(ev); q.flush();
    ev.preventDefault();
  });
  el.addEventListener('pointermove', ev => { if (cp.dragging) q.push(ev); });
  const end = () => { cp.dragging = false; q.flush(); rect = null; };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
}
bindCPDrag($('#cpSV'), (x, y) => {
  cp.h = clamp(y * 360, 0, 359.999);
  if (x <= .5) { cp.s = x * 2; cp.v = 1; }
  else { cp.s = 1; cp.v = (1 - x) * 2; }
  paintCP();
});

/* ==================== 吸管取色（现场取色，不弹窗） ====================
   只取手账本里此刻真正显示在屏幕上的内容 —— 不碰系统吸管、不碰截屏、也不碰素材原图：
     原图    ≠ 屏幕上看到的：贴图常被裁剪 / 缩放 / 旋转，还叠着纸面纹理
     EyeDropper / getDisplayMedia 又会吸到手账本以外的东西，所以一条都不用。

   做法是「现场取色」：点吸管后所有浮层让位藏起来，手账本页面照常可见可点，
   指针指到哪，就从活的 DOM 上读出那一点的颜色 ——
     elementsFromPoint 拿到「从上到下」的元素栈，从最底层往上做 alpha 合成；
     图片则把屏幕坐标逆映射回原始像素再采样（旋转 / 祖先缩放都能对上）。

   全程只有一个跟着指针的放大镜和底部一条细操作条，没有弹窗挡页面。 */
const EP_ZOOM = 15;       // 放大镜每边取 15 个点
const EP_STEP = .5;       // 相邻取样点间距（CSS px）：半个屏幕像素，颗粒度比原来细一倍
const EP_LOUPE = 90;      // 放大镜直径（px，与 CSS / canvas 一致），每格 90/15 = 6px
const EP_CAP = 1600;      // 图片取样画布的最大边长
const EP_BG_CAP = 1600;   // CSS 背景栅格的最大边长
const EP_BG_SCALE = 2;    // 背景按 2× 分辨率栅格化，1px 的网格线也留得住
/* 取色时要让位的浮层：取色盘、通用弹窗、确认框、底部弹窗、添加菜单。
   藏起来而不是关掉 —— 取完色要原样回来，调用方的状态不能被破坏 */
const EP_DUCK = '.cp-mask,.modal-mask,.confirm-mask,.tsheet,.addmenu';
const ep = { on: false, hex: null, raf: 0, pt: null, ducked: [],
  cache: new Map(),                 // src → 取样画布
  bg: new Map(),                    // 元素 → CSS 背景栅格画布（整次取色期间有效）
  affs: new Map(),                  // 元素 → 仿射变换（每帧清一次）
  frame: new Map(),                 // 元素 → 背景色（每帧清一次，省掉大量 getComputedStyle）
  bgRect: new Map(),                // 元素 → 包围盒（每帧清一次）
  rects: new Map() };               // 文本节点 → 行盒（每帧清一次，getClientRects 会强制重排）

/* ---------- 颜色 ---------- */
/* "rgb()" / "rgba()" → {r,g,b,a}；透明返回 null，让下面那层透上来 */
function epParseColor(s) {
  const m = String(s || '').match(/rgba?\(([^)]+)\)/);
  if (!m) return null;
  const p = m[1].split(',').map(Number);
  if (p.length < 3 || p.some(n => !isFinite(n))) return null;
  return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
}
/* 标准 source-over：top 盖在 bot 上面 */
function epOver(top, bot) {
  const ba = bot.a * (1 - top.a), a = top.a + ba;
  if (a <= 0) return { r: 0, g: 0, b: 0, a: 0 };
  return { r: (top.r * top.a + bot.r * ba) / a, g: (top.g * top.a + bot.g * ba) / a,
           b: (top.b * top.a + bot.b * ba) / a, a };
}
function epToHex(c) {
  return '#' + [c.r, c.g, c.b].map(n => Math.round(clamp(n, 0, 255)).toString(16).padStart(2, '0')).join('').toUpperCase();
}

/* ---------- 图片取样 ---------- */
/* 把 <img> 画一份到离屏画布，按 src 缓存，之后 getImageData 反复用。
   先读一个像素试毒：万一画布被判定为跨域污染，趁早知道，别等用户点了才发现取不到色 */
function epImgCanvas(img) {
  const src = img.currentSrc || img.src;
  if (ep.cache.has(src)) return ep.cache.get(src);
  let c = null;
  try {
    const w0 = img.naturalWidth, h0 = img.naturalHeight;
    if (w0 && h0) {
      const k = Math.min(1, EP_CAP / Math.max(w0, h0));
      const cv = document.createElement('canvas');
      cv.width = Math.max(1, Math.round(w0 * k));
      cv.height = Math.max(1, Math.round(h0 * k));
      const cx = cv.getContext('2d', { willReadFrequently: true });
      cx.drawImage(img, 0, 0, cv.width, cv.height);
      cx.getImageData(0, 0, 1, 1);
      c = cv;
    }
  } catch (_) { c = null; }
  ep.cache.set(src, c);
  return c;
}
/* 屏幕坐标 → 元素内的比例坐标 (u,v)。
   贴图会旋转、祖先还可能缩放，光用 getBoundingClientRect 的外接框算不准；
   所以插一个看不见的探针，量出元素盒子三个角在屏幕上的位置，反解出这个仿射变换 ——
   旋转、缩放、祖先变换全都自动包含在内。一次量完按元素缓存，取色时页面是静止的，不用每帧重量 */
function epAffine(el) {
  let t = ep.affs.get(el);
  if (t !== undefined) return t;
  let p = el.__epProbe;
  if (!p) {
    p = document.createElement('i');
    p.style.cssText = 'position:absolute;width:0;height:0;left:0;top:0;pointer-events:none;visibility:hidden';
    el.appendChild(p);
    el.__epProbe = p;
  }
  p.style.left = '0px'; p.style.top = '0px';
  const r0 = p.getBoundingClientRect();                    // 局部 (0,0)
  p.style.left = '100%';
  const r1 = p.getBoundingClientRect();                    // 局部 (W,0)
  p.style.left = '0px'; p.style.top = '100%';
  const r2 = p.getBoundingClientRect();                    // 局部 (0,H)
  p.style.left = '0px'; p.style.top = '0px';
  const ax = r1.left - r0.left, ay = r1.top - r0.top;      // 局部 x 轴
  const bx = r2.left - r0.left, by = r2.top - r0.top;      // 局部 y 轴
  const det = ax * by - bx * ay;
  t = (isFinite(det) && Math.abs(det) > 1e-6) ? { x0: r0.left, y0: r0.top, ax, ay, bx, by, det } : null;
  ep.affs.set(el, t);
  return t;
}
function epUV(el, x, y) {
  const t = epAffine(el);
  if (!t) return null;
  const dx = x - t.x0, dy = y - t.y0;
  /* 解 [ax bx; ay by] · [u v] = [dx dy] */
  return { u: (dx * t.by - t.bx * dy) / t.det, v: (t.ax * dy - dx * t.ay) / t.det };
}
/* 图片上一点的颜色。.pimg 默认 object-fit:fill（拉伸铺满盒子），所以比例坐标直接乘原始宽高。
   唯一例外是「铺满」里还没校准的老数据（object-fit:contain，图居中留白）—— 那种翻到就会被
   ensureFillGeom 重算成 fill，取色偏一点也是一瞬间的事，不值得为它单独算一遍留白 */
function epImgColor(wrap, x, y) {
  const img = wrap.querySelector('.pimg');
  if (!img) return null;
  const cv = epImgCanvas(img);
  if (!cv) return null;
  const uv = epUV(wrap, x, y);
  if (!uv) return null;
  const px = Math.floor(uv.u * cv.width), py = Math.floor(uv.v * cv.height);
  if (px < 0 || py < 0 || px >= cv.width || py >= cv.height) return null;
  let d;
  try { d = cv.getContext('2d').getImageData(px, py, 1, 1).data; }
  catch (_) { return null; }
  return { r: d[0], g: d[1], b: d[2], a: d[3] / 255 };
}

/* ---------- CSS 背景栅格化 ----------
   getComputedStyle().backgroundColor 只有「纯色」那一层：渐变封面、封面图案层、
   内页网格 / 横线 / 点阵模板全都画在 background-image 上。以前只读 backgroundColor，
   这些地方会一路透明到底，吸管只能拿到最底下的白 —— 主页编辑器里点渐变封面取不到
   指向处的颜色、阅读器里也分不出 1px 的网格线（用户说的「颗粒度不够细」）。
   办法：把这一层的 background-* 原样塞进 SVG foreignObject 交给浏览器栅格化，
   再按点 getImageData。按元素缓存，取色期间页面静止，缓存一直有效。 */
function epBgCanvas(el) {
  if (ep.bg.has(el)) return ep.bg.get(el);
  ep.bg.set(el, null);                    // 先占位：一帧几百个取样点只栅格化一次
  let cs;
  try { cs = getComputedStyle(el); } catch (_) { return null; }
  const bi = cs.backgroundImage;
  if (!bi || bi === 'none') return null;
  const r = el.getBoundingClientRect();
  const w = Math.max(1, Math.round(r.width)), h = Math.max(1, Math.round(r.height));
  const k = Math.max(.25, Math.min(EP_BG_SCALE, EP_BG_CAP / Math.max(w, h)));
  const W = Math.max(1, Math.round(w * k)), H = Math.max(1, Math.round(h * k));
  /* 内层 div 用原始 CSS 尺寸（background-size / position 的 px、% 都按它算），
     外面套 transform:scale(k) 把整块提到 2× 分辨率，细线才不会糊掉 */
  const box = document.createElement('div');
  box.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml');
  box.style.cssText = 'width:' + w + 'px;height:' + h + 'px;'
    + 'transform-origin:0 0;transform:scale(' + k + ');';
  box.style.backgroundColor = cs.backgroundColor;
  box.style.backgroundImage = bi;
  box.style.backgroundSize = cs.backgroundSize;
  box.style.backgroundPosition = cs.backgroundPosition;
  box.style.backgroundRepeat = cs.backgroundRepeat;
  box.style.backgroundOrigin = cs.backgroundOrigin;
  box.style.backgroundClip = cs.backgroundClip;
  box.style.borderRadius = cs.borderRadius;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  svg.setAttribute('width', W); svg.setAttribute('height', H);
  const fo = document.createElementNS('http://www.w3.org/2000/svg', 'foreignObject');
  fo.setAttribute('width', W); fo.setAttribute('height', H);
  fo.appendChild(box); svg.appendChild(fo);
  let url;
  try {
    url = 'data:image/svg+xml;charset=utf-8,'
      + encodeURIComponent(new XMLSerializer().serializeToString(svg));
  } catch (_) { return null; }
  const img = new Image();
  img.onload = () => {
    const cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    try {
      cv.getContext('2d', { willReadFrequently: true }).drawImage(img, 0, 0);
      cv.getContext('2d').getImageData(0, 0, 1, 1);   // 试毒：污染画布会抛错
      ep.bg.set(el, cv);
    } catch (_) { /* 保持 null，回落成 backgroundColor */ }
  };
  img.src = url;
  return null;                            // 首帧还没栅格化完，先走兜底；下一帧就准了
}
/* 这一层在 (x,y) 上的背景色。栅格还没好 / 这一点透明 → 让下面那层透上来 */
function epBgColor(el, x, y) {
  const cv = epBgCanvas(el);
  if (!cv) {
    if (!ep.frame.has(el)) ep.frame.set(el, epParseColor(getComputedStyle(el).backgroundColor));
    return ep.frame.get(el);
  }
  let r = ep.bgRect.get(el);
  if (!r) { r = el.getBoundingClientRect(); ep.bgRect.set(el, r); }
  if (!r.width || !r.height) return null;
  const u = (x - r.left) / r.width, v = (y - r.top) / r.height;
  if (u < 0 || u > 1 || v < 0 || v > 1) return null;
  try {
    const px = clamp(Math.floor(u * cv.width), 0, cv.width - 1);
    const py = clamp(Math.floor(v * cv.height), 0, cv.height - 1);
    const d = cv.getContext('2d').getImageData(px, py, 1, 1).data;
    if (d[3] > 0) return { r: d[0], g: d[1], b: d[2], a: d[3] / 255 };
  } catch (_) { /* 落到下面 */ }
  return null;
}

/* 文字：文字背景是透明的，得看这一点是不是正压在某个字上。
   用 Range 取文本节点的行盒，落在盒子里才算命中 —— 字与字之间的空隙不会误判成文字色 */
function epTextColor(el, x, y) {
  for (const n of el.childNodes) {
    if (n.nodeType !== 3 || !n.nodeValue.trim()) continue;
    let rects = ep.rects.get(n);
    if (!rects) {
      const rg = document.createRange();
      rg.selectNodeContents(n);
      rects = [...rg.getClientRects()];          // 存成数组，DOMRectList 是一次性的
      ep.rects.set(n, rects);
    }
    for (const rc of rects) {
      if (x >= rc.left - .5 && x <= rc.right + .5 && y >= rc.top - .5 && y <= rc.bottom + .5) {
        const cs = getComputedStyle(el);
        return epParseColor(cs.webkitTextFillColor || cs.color);
      }
    }
  }
  return null;
}

/* ---------- 取样主流程 ---------- */
/* 单个元素在这一点上贡献的颜色（不含它下面压着的东西） */
function epLayerColor(el, x, y) {
  if (el.classList && el.classList.contains('pimg-wrap')) {
    const c = epImgColor(el, x, y);
    if (c) return c;
  }
  /* 渐变 / 图案 / 模板细线都在 background-image 上，走栅格化；纯色层仍读 backgroundColor */
  const bg = epBgColor(el, x, y);
  const txt = epTextColor(el, x, y);
  if (txt && txt.a > 0) return bg && bg.a > 0 ? epOver(txt, bg) : txt;
  return bg;
}
/* 屏幕上一点最终显示出来的颜色：从最底层往上逐层合成 */
function epSampleAt(x, y) {
  const els = document.elementsFromPoint(x, y);
  let base = null;
  for (let i = els.length - 1; i >= 0; i--) {          // 从底往顶
    const el = els[i];
    if (!el || el.nodeType !== 1) continue;
    if (el.id === 'epLive' || (el.closest && el.closest('#epLive'))) continue;   // 自己的 UI 不算
    const c = epLayerColor(el, x, y);
    if (!c || c.a <= 0) continue;
    base = base ? epOver(c, base) : c;
  }
  /* 一路透明到底（理论上不会，#app / body 都有底色）就按白底算 */
  return base ? epOver(base, { r: 255, g: 255, b: 255, a: 1 }) : { r: 255, g: 255, b: 255, a: 1 };
}
function epSetHex(hex) {
  ep.hex = hex;
  $('#epPrev').style.background = hex;
  $('#epHex').textContent = hex;
}
/* 放大镜：指针周围 15×15 个取样点，相邻点只隔半个 CSS 像素（EP_STEP），
   所以 1px 的网格线 / 图案边缘也能在镜里分辨出来；坐标不取整，保留亚像素精度。 */
function epDrawLoupe(x, y) {
  const cx = $('#epLoupeCv').getContext('2d');
  const cell = EP_LOUPE / EP_ZOOM, half = (EP_ZOOM - 1) / 2;
  ep.affs.clear(); ep.frame.clear(); ep.rects.clear(); ep.bgRect.clear();   // 一帧量一次就够
  const at = (i, j) => epToHex(epSampleAt(
    x + (i - half) * EP_STEP, y + (j - half) * EP_STEP));
  /* 纸面、纯色块这些大片同色的地方占绝大多数：先探中心和四角，
     五个点都一样就直接铺满，省掉 225 次取样 */
  const c0 = at(half, half);
  let same = true;
  for (const [i, j] of [[0, 0], [EP_ZOOM - 1, 0], [0, EP_ZOOM - 1], [EP_ZOOM - 1, EP_ZOOM - 1]]) {
    if (at(i, j) !== c0) { same = false; break; }
  }
  if (same) { cx.fillStyle = c0; cx.fillRect(0, 0, EP_LOUPE, EP_LOUPE); return; }
  for (let j = 0; j < EP_ZOOM; j++) {
    for (let i = 0; i < EP_ZOOM; i++) {
      cx.fillStyle = at(i, j);
      cx.fillRect(Math.floor(i * cell), Math.floor(j * cell), Math.ceil(cell), Math.ceil(cell));
    }
  }
}
function epMove(x, y) {
  const lp = $('#epLoupe'), host = $('#epLive').getBoundingClientRect();
  lp.style.display = 'block';
  /* 挂在指针斜上方，贴边就翻到另一侧，别跑出屏幕 */
  let lx = x + 22, ly = y - EP_LOUPE - 22;
  if (lx + EP_LOUPE > host.right - 6) lx = x - EP_LOUPE - 22;
  if (ly < host.top + 6) ly = y + 22;
  lp.style.left = clamp(lx - host.left, 6, Math.max(6, host.width - EP_LOUPE - 6)) + 'px';
  lp.style.top = clamp(ly - host.top, 6, Math.max(6, host.height - EP_LOUPE - 6)) + 'px';
  epDrawLoupe(x, y);
}
function epPickAt(x, y) {
  ep.affs.clear(); ep.frame.clear(); ep.rects.clear(); ep.bgRect.clear();
  epSetHex(epToHex(epSampleAt(x, y)));
}

/* ---------- 进出取色模式 ---------- */
function epDuck(on) {
  $$(EP_DUCK).forEach(el => {
    if (on) { if (getComputedStyle(el).display !== 'none') { el.classList.add('ep-duck'); ep.ducked.push(el); } }
    else el.classList.remove('ep-duck');
  });
  if (!on) ep.ducked.length = 0;
}
function openEyedropper() {
  ep.on = true; ep.hex = null;
  ep.cache.clear();                       // 图片可能刚被换过，别拿旧画布
  ep.bg.clear(); ep.bgRect.clear();       // CSS 背景栅格同理，重开一次重新栅格化
  ep.affs.clear(); ep.frame.clear(); ep.rects.clear();
  ep.hex = null;
  $('#epHex').textContent = '点手账本上任意位置取色';
  $('#epPrev').style.background = 'transparent';
  $('#epLoupe').style.display = 'none';
  epDuck(true);                           // 浮层让位，页面露出来
  /* 装饰层（图案 / 光泽 / 书脊 / 模板网格）平时 pointer-events:none，
     elementsFromPoint 会漏掉它们；取色期间临时放进来，才能取到这些细节 */
  document.body.classList.add('ep-picking');
  $('#epLive').hidden = false;
}
function closeEyedropper() {
  if (!ep.on) return;
  ep.on = false;
  $('#epLive').hidden = true;
  document.body.classList.remove('ep-picking');
  epDuck(false);                          // 浮层原样回来
  if (ep.raf) { cancelAnimationFrame(ep.raf); ep.raf = 0; }
  ep.pt = null;
  ep.bg.clear(); ep.bgRect.clear();       // 栅格画布可能很大，退出就还回去
}
/* 只把颜色填回取色盘，应用还是走取色盘自己的「确定」 */
function epApply() {
  const hex = ep.hex;
  if (!hex) { toast('先在手账本上点一下取色'); return; }
  closeEyedropper();
  const hsv = hexToHsv(hex);
  if (hsv) { cp.h = hsv.h; cp.s = hsv.s; cp.v = hsv.v; paintCP(); }
}
$('#cpEye').onclick = openEyedropper;
$('#epOk').onclick = epApply;
$('#epCancel').onclick = closeEyedropper;
/* Esc 退出取色。scrub.js 也监听 window 的 Esc 并且会「关掉整个阅读器」，
   而本模块先于它加载、监听器先注册，所以这里必须 stopImmediatePropagation 把事件吞掉，
   否则按一下 Esc 会连手账本一起退出去 */
window.addEventListener('keydown', ev => {
  if (!ep.on || ev.key !== 'Escape') return;
  ev.preventDefault(); ev.stopImmediatePropagation();
  closeEyedropper();
});

/* 指针移动：画放大镜要取 81 个点，按帧合一次，别每个 move 都算一遍 */
window.addEventListener('pointermove', ev => {
  if (!ep.on) return;
  const x = ev.clientX, y = ev.clientY;
  if (ep.raf) { ep.pt = { x, y }; return; }
  ep.raf = requestAnimationFrame(() => {
    ep.raf = 0;
    if (!ep.on) return;
    const p = ep.pt || { x, y }; ep.pt = null;
    epMove(p.x, p.y); epPickAt(p.x, p.y);
  });
}, { passive: true });
/* 捕获阶段拦下来：这一下是取色，不能让页面以为要拖贴图 */
const epIsUI = ev => !!(ev.target && ev.target.closest && ev.target.closest('#epLive'));
window.addEventListener('pointerdown', ev => {
  if (!ep.on || epIsUI(ev)) return;
  ev.preventDefault(); ev.stopPropagation();
  epPickAt(ev.clientX, ev.clientY);
  epMove(ev.clientX, ev.clientY);
}, true);
window.addEventListener('pointerup', ev => {
  if (!ep.on || epIsUI(ev)) return;
  ev.preventDefault(); ev.stopPropagation();
  epPickAt(ev.clientX, ev.clientY);
  epApply();                                // 松手即定，少一步操作
}, true);

/* ==================== 背景设置面板（主页 / 阅读器共用） ==================== */
const BG_PRESETS = ['#5b6182', '#445070', '#3a4358', '#232840', '#6e5a66', '#7a5c49', '#4f6b5d', '#3d5a66', '#8a8fa8', '#b8a98f'];
function bgCur() { return state.prefs.bg || { mode: 'default', value: '', img: null }; }
function syncBgPanel() {
  const b = bgCur();
  const box = $('#bgColors');
  if (!box.dataset.built) {
    box.innerHTML = BG_PRESETS.map(c => `<div class="swatch" data-bgcolor="${c}" style="background:${c}" title="${c}"></div>`).join('')
      + '<div class="swatch custom" id="bgCustom" title="自定义颜色"><span class="cus-ico">＋</span></div><span class="cus-tip" id="bgCustomTip">自定义</span>';
    box.dataset.built = '1';
    $$('#bgColors .swatch[data-bgcolor]').forEach(s => s.onclick = () => { setBg({ mode: 'color', value: s.dataset.bgcolor, img: null }); syncBgPanel(); });
    $('#bgCustom').onclick = () => openColorPicker('自定义背景颜色',
      bgCur().mode === 'color' ? bgCur().value : '',
      hex => { setBg({ mode: 'color', value: hex, img: null }); syncBgPanel(); });
  }
  $$('#bgColors .swatch[data-bgcolor]').forEach(s => s.classList.toggle('on', b.mode === 'color' && b.value === s.dataset.bgcolor));
  const cv = (b.mode === 'color' && /^#[0-9a-fA-F]{6}$/.test(String(b.value || '')) && !BG_PRESETS.includes(String(b.value).toLowerCase())) ? b.value : '';
  const chip = $('#bgCustom');
  chip.classList.toggle('on', !!cv);
  chip.style.background = cv || '';
  $('#bgCustomTip').textContent = cv ? cv.toUpperCase() : '自定义';
  $('#bgClearImg').disabled = b.mode !== 'image';
  $('#bgUpload').textContent = b.mode === 'image' ? '换一张图片' : '选择图片';
}
/* 只有一个面板：主页和阅读器共用同一份背景，不用再切来切去 */
function openBgPanel() {
  syncBgPanel();
  $('#bgMask').classList.add('show');
}
$('#bgClose').onclick = () => $('#bgMask').classList.remove('show');
$('#bgOk').onclick = () => $('#bgMask').classList.remove('show');
$('#bgMask').addEventListener('click', e => { if (e.target === $('#bgMask')) $('#bgMask').classList.remove('show'); });
$('#bgReset').onclick = () => { setBg({ mode: 'default', value: '', img: null }); syncBgPanel(); toast('已恢复默认背景'); };
$('#bgClearImg').onclick = () => { setBg({ mode: 'default', value: '', img: null }); syncBgPanel(); };
$('#bgUpload').onclick = () => $('#bgFile').click();
$('#bgFile').addEventListener('change', async e => {
  /* 移动端：先把 File 同步读成 dataURL 再清 input，别让底层 Blob 被提前释放 */
  const [f] = await readPickedFiles(e);
  if (!f) return;
  toast('正在处理图片…');
  const img = await shrinkImageFile(f, 1920);
  if (!img) { toast('图片读取失败'); return; }
  setBg({ mode: 'image', value: '', img });
  syncBgPanel();
  toast('背景已更新');
});

