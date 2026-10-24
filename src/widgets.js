/* =====================================================================
 * Carnet · 通用控件 · 取色盘与背景面板   （脚本 19 / 25）
 * ---------------------------------------------------------------------
 * ① 自定义取色盘 openColorPicker：HSV 面板 + 色相条 + 手输色值
 *    （App 内置浏览器常唤不起原生 input[type=color]，所以自己实现一套）
 * ② 吸管取色 openEyedropper：只取手账本里的内容，现场取色、不弹窗
 *    （点吸管后浮层一律让位藏起，直接在活页面上点；从 elementsFromPoint 逐层合成取色，
 *      图片把屏幕坐标逆映射回原始像素采样，旋转 / 缩放都对得上）
 * ③ 背景设置面板 openBgPanel：预设色 / 自定义色 / 背景图片 / 恢复默认
 *
 * 对外接口：openColorPicker, closeColorPicker, openEyedropper, openBgPanel
 *
 * 依赖模块：core, storage
 *
 * 说明：模块间共用全局作用域，加载顺序即依赖顺序（见 index.html 与 README）。
 * ===================================================================== */
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
  /* 色相保留小数：吸管取到 #C83B4A 后要走 hex→HSV→hex 这一圈，
     h 取整到度数会丢精度（0.5° 的误差就够把某个通道差 1），
     于是「取到 #C83B4A、用上的却是 #C83B49」。 */
  return { h, s: max ? d / max : 0, v: max };
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

/* ==================== 吸管取色（现场取色，不弹窗） ====================
   只取手账本里此刻真正显示在屏幕上的内容 —— 不碰系统吸管、不碰截屏、也不碰素材原图：
     原图    ≠ 屏幕上看到的：贴图常被裁剪 / 缩放 / 旋转，还叠着纸面纹理
     EyeDropper / getDisplayMedia 又会吸到手账本以外的东西，所以一条都不用。

   做法是「现场取色」：点吸管后所有浮层让位藏起来，手账本页面照常可见可点，
   指针指到哪，就从活的 DOM 上读出那一点的颜色 ——
     elementsFromPoint 拿到「从上到下」的元素栈，从最底层往上做 alpha 合成；
     图片则把屏幕坐标逆映射回原始像素再采样（旋转 / 祖先缩放都能对上）。

   全程只有一个跟着指针的放大镜和底部一条细操作条，没有弹窗挡页面。 */
const EP_ZOOM = 9;        // 放大镜取指针周围 9×9 个屏幕像素
const EP_LOUPE = 72;      // 放大镜直径（px，与 CSS 一致），每格 72/9 = 8px
const EP_CAP = 1600;      // 图片取样画布的最大边长
/* 取色时要让位的浮层：取色盘、通用弹窗、确认框、底部弹窗、添加菜单。
   藏起来而不是关掉 —— 取完色要原样回来，调用方的状态不能被破坏 */
const EP_DUCK = '.cp-mask,.modal-mask,.confirm-mask,.tsheet,.addmenu';
const ep = { on: false, hex: null, raf: 0, pt: null, ducked: [],
  cache: new Map(),                 // src → 取样画布
  affs: new Map(),                  // 元素 → 仿射变换（每帧清一次）
  frame: new Map(),                 // 元素 → 背景色（每帧清一次，省掉大量 getComputedStyle）
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
/* 图片上一点的颜色。.pimg 是 object-fit:fill（拉伸铺满），所以比例坐标直接乘原始宽高 */
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
  if (!ep.frame.has(el)) ep.frame.set(el, epParseColor(getComputedStyle(el).backgroundColor));
  const bg = ep.frame.get(el);
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
/* 放大镜：把指针周围 9×9 个屏幕像素逐个取样画成格子 */
function epDrawLoupe(x, y) {
  const cx = $('#epLoupeCv').getContext('2d');
  const cell = EP_LOUPE / EP_ZOOM, half = (EP_ZOOM - 1) / 2;
  ep.affs.clear(); ep.frame.clear(); ep.rects.clear();   // 一帧量一次就够，81 个点共用
  /* 纸面、纯色块这些大片同色的地方占绝大多数：先探中心和四角，
     五个点都一样就直接铺满，省掉 81 次取样 */
  const c0 = epToHex(epSampleAt(x, y));
  let same = true;
  for (const d of [-half, half]) {
    if (epToHex(epSampleAt(Math.round(x + d), Math.round(y + d))) !== c0
      || epToHex(epSampleAt(Math.round(x + d), Math.round(y - d))) !== c0) { same = false; break; }
  }
  if (same) { cx.fillStyle = c0; cx.fillRect(0, 0, EP_LOUPE, EP_LOUPE); return; }
  for (let j = 0; j < EP_ZOOM; j++) {
    for (let i = 0; i < EP_ZOOM; i++) {
      cx.fillStyle = epToHex(epSampleAt(Math.round(x + (i - half)), Math.round(y + (j - half))));
      cx.fillRect(i * cell, j * cell, cell, cell);
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
  ep.affs.clear(); ep.frame.clear(); ep.rects.clear();
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
  ep.affs.clear(); ep.frame.clear(); ep.rects.clear();
  ep.hex = null;
  $('#epHex').textContent = '点手账本上任意位置取色';
  $('#epPrev').style.background = 'transparent';
  $('#epLoupe').style.display = 'none';
  epDuck(true);                           // 浮层让位，页面露出来
  $('#epLive').hidden = false;
}
function closeEyedropper() {
  if (!ep.on) return;
  ep.on = false;
  $('#epLive').hidden = true;
  epDuck(false);                          // 浮层原样回来
  if (ep.raf) { cancelAnimationFrame(ep.raf); ep.raf = 0; }
  ep.pt = null;
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
  const f = e.target.files[0];
  e.target.value = '';
  if (!f) return;
  toast('正在处理图片…');
  const img = await shrinkImageFile(f, 1920);
  if (!img) { toast('图片读取失败'); return; }
  setBg({ mode: 'image', value: '', img });
  syncBgPanel();
  toast('背景已更新');
});

