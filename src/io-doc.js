/* =====================================================================
 * Carnet · 导出 · PDF 与 SVG 矢量   （脚本 6 / 28）
 * ---------------------------------------------------------------------
 * ① 把每一页渲染成 XHTML：pageExportXHTML（PDF / SVG 共用这一份实现）
 * ② 纯前端拼 PDF：JPEG 转字节流、写 PDF 对象表 buildPdf
 * ③ 竖向拼接生成 SVG 矢量长图 exportJournalSVG
 * ④ 导出字体探测 exportFontStack：导出文档吃不到本页的 @font-face，只能退到系统字体
 * ⑤ 项目自带的 17 款英文字体：按本子实际用到的档位转 base64 内嵌进 SVG，PDF / SVG 都能用真字体
 *
 * 对外接口：pageExportHTML, pageExportXHTML, buildPdf, exportJournalPDF, exportJournalSVG,
 *            probeExportFont, prepareExportEnFaces, exportEnFaceCSS, exportPages, renderExportCanvas, canvasBytes
 *
 * 依赖模块：core, visuals
 *
 * 说明：模块间共用全局作用域，加载顺序即依赖顺序（见 index.html 与 README）。
 * ===================================================================== */
/* ==================== 导出 PDF / 长图（纯前端生成，无外部依赖） ==================== */
/* 手写体是随页面 @font-face 加载的，而导出的 XHTML 要塞进 SVG 图片里栅格化——
   那是个独立文档，吃不到本页的 @font-face，只能用系统里真装了的字体。
   所以导出前实际画一次探针：拿手写体字族和一个「一定不存在」的字族各渲染一小块，
   两者像素完全相同就说明手写体在导出环境里没生效（都退回了默认字体），整段改按楷体导出。
   结果整个会话只测一次，探测本身失败就按原字族导，不冒险乱换 */
let __expHand = null;                   // null=未测 / true=手写体可用 / false=回退楷体
function rasterExportText(family) {
  const W = 320, H = 110;
  const root = `<div xmlns="http://www.w3.org/1999/xhtml" style="width:${W}px;height:${H}px;overflow:hidden;`
    + `font-family:-apple-system,BlinkMacSystemFont,'PingFang SC','Hiragino Sans GB','Microsoft YaHei','Segoe UI',Roboto,sans-serif;">`
    + `<div style="font-family:${family};font-size:64px;line-height:1.5;color:#000;white-space:nowrap">手帐Abj</div></div>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><foreignObject width="100%" height="100%">${root}</foreignObject></svg>`;
  return new Promise((res, rej) => {
    const im = new Image();
    im.onload = () => {
      const c = document.createElement('canvas');
      c.width = W; c.height = H;
      const ctx = c.getContext('2d', { willReadFrequently: true });
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H);
      ctx.drawImage(im, 0, 0, W, H);
      res(ctx.getImageData(0, 0, W, H).data);
    };
    im.onerror = () => rej(new Error('字体探针渲染失败'));
    im.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  });
}
function samePix(a, b) {
  if (!a || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
async function probeExportFont() {
  if (__expHand != null) return __expHand;
  try {
    /* @font-face 不一定加载完了，先等它就绪再测，否则会误判成「画不出来」；
       load 失败（比如字体文件丢了）也不拦着，往下按没加载测 */
    try { await document.fonts.load('64px "CarnetHand"', '手帐Abj'); } catch (_) {}
    const hand = await rasterExportText(`'CarnetHand'`);
    const none = await rasterExportText(`'__CarnetNoSuchFont__'`);
    __expHand = !samePix(hand, none);
    if (!__expHand) toast('导出环境用不了手写体，手写文字将按楷体导出');
  } catch (e) { __expHand = true; }
  return __expHand;
}
/* ==================== 导出用的项目自带英文字体 ====================
   手写体太大（2.55MB）且系统里没有，导出只能探测后退化成楷体；17 款英文字体不一样，
   合计约 890KB（其中 Gaegu 290KB、Playfair / Inter 各约 118KB），仍可以把 woff2 直接转成
   base64 写进 SVG 根级的 <style> 里 —— 关键是只嵌这一本真正用到的那几档，大字体也一样。
   已实测：SVG-as-image 的「安全静态模式」允许 data: 的 @font-face，栅格化出来的像素
   跟回退字体明显不同；而且根级 <style> 一处定义，所有 foreignObject 都能吃到。
   ⚠️ 只内嵌这一本真正用到的档位 —— 没用到时 <style> 为空，老导出结果一个字节都不变。
   ⚠️ font-display:block 不能省：导出是「Image 一 load 就画」，swap 会先把回退字画进画布。
   fetch 在 file:// 下会被浏览器拦掉，那时静默返回空串，textEnStack() 里还有近似系统字体
   链接着（见 visuals.js 的 EN_FONTS.fallback），不至于整条 font-family 作废。 */
const EN_FACE_BASE = new URL('assets/font/en/', document.baseURI).href;
let __expEnFaces = '';                 // 本次导出插进 SVG 根的 <style>，没用到自带字体时是空串
const __enFaceCache = {};             // 档位 k → @font-face 规则；整会话只取一次文件
async function readEnFace(k) {
  if (k in __enFaceCache) return __enFaceCache[k];
  const f = (EN_FONTS.find(x => x.k === k) || {}).face;
  if (!f) return (__enFaceCache[k] = '');
  try {
    const r = await fetch(EN_FACE_BASE + f.file);
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const bytes = new Uint8Array(await r.arrayBuffer());
    /* btoa 的参数表一次塞不下 60KB，按 32KB 分块拼成二进制串再编码 */
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000)
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return (__enFaceCache[k] = `@font-face{font-family:'${f.family}';`
      + `src:url(data:font/woff2;base64,${btoa(bin)}) format('woff2');`
      + `font-display:block;font-weight:400;font-style:normal;}`);
  } catch (e) {
    console.warn('[Carnet] 导出内嵌英文字体失败，改走系统近似字体：', f.file, e);
    return (__enFaceCache[k] = '');
  }
}
/* 给一组文字贴备好自带英文字体的 <style>。DIY 自定义封面合成 cover.img 时也是
   SVG foreignObject 独立文档，一样吃不到本页 @font-face，所以这条不专属于导出：
   谁要栅格化一页带英文文字贴的 XHTML，就传那一页的 texts 进来。 */
async function exportEnFaceCSS(texts) {
  const used = new Set();
  (texts || []).forEach(t => {
    const f = EN_FONTS.find(x => x.k === t.fontEn);
    if (f && f.face) used.add(f.k);
  });
  const css = (await Promise.all([...used].map(readEnFace))).filter(Boolean).join('');
  return css ? `<style type="text/css">${css}</style>` : '';
}
async function prepareExportEnFaces(j) {
  const texts = [];
  (j && j.pages ? j.pages : []).forEach(pg => (pg.texts || []).forEach(t => texts.push(t)));
  __expEnFaces = await exportEnFaceCSS(texts);
}
/* 导出用的字族串：手写体不可用时整段换楷体（含行高也跟着走） */
function exportFontStack(k) {
  const nk = normFont(k);
  if (nk === 'plain') return 'inherit';
  if (nk === 'hand' && __expHand === false) return textFontStack('kai');
  return textFontStack(nk);
}
function exportFontIsHand(k) { return normFont(k) === 'hand' && __expHand !== false; }
const EX_W = 900;                       // 导出页面的像素宽（PDF 与长图共用）
function exportPages(j) { return [-1].concat(j.pages.map((_, i) => i)); }      // -1 = 封面
/* 把一页画成 canvas：页面结构按应用的真实渲染规则重排成 XHTML，
   塞进 SVG foreignObject 交给浏览器栅格化 —— 图片 / 文字位置、模板纹理都和屏幕上一样 */
function pageExportHTML(j, idx, W, H) {
  const k = W / PAGE_W_DEFAULT;         // 模板纹理的 px 尺寸按页宽等比缩放（PAGE_W_DEFAULT = 屏幕上一页的宽）
  if (idx === -1) {
    const cv = j.cover || {};
    const bg = cv.img ? `background-image:url('${cv.img}');background-size:cover;background-position:center;` : `background:${cv.value || '#ddd'};`;
    const pat = (cv.pattern && cv.pattern !== 'none' && !cv.img) ? patternStyle(cv.pattern, cv) : '';
    /* 封面材质：跟屏幕 coverHTML 同一份 textureStyle()（贴片尺寸按封面宽百分比，
       导出不用再乘 sc）。⚠️ 有封面图时 textureStyle 返回空：上传图 / DIY 合成图
       盖在底色之上，不能在导出里再把纹理压到照片和文字上。 */
    const tex = textureStyle(cv);
    const st = bookStyleOf(j);
    /* 装订那一列与屏幕封面严格一致（2026-11-09 用户定稿）：
       ① 有彩带 → 只画一条平色带，**不叠压槽**；
       ② 没彩带的装帧（画册 / 精装书）→ **画压槽**，恢复原来那套暗槽底＋亮槽沿的立体断面
          （用户复评更逼真）；仍不画上下两端折边暗边、四周黑色投影、槽沿 1px 浅白线；
       ③ 活页 → 整列不画（不画环、也不留压痕）；
       ④ 书槽关（cover.groove === false）或笔记本选了「透明」彩带 → 与活页一样整列不画，
          **不补压槽**（coverNoSpine，跟屏幕封面同源）。
       导出吃不到本页 CSS，所以断面渐变必须内联。 */
    const spine = st.ribbon ? ribbonSpine(j.ribbon) : '';
    /* 与 home.css / book-style.css 同一套：画册 6%、精装书 8%、其余 6.5% */
    const w = st.k === 'square' ? 6 : st.k === 'hardcover' ? 8 : 6.5;
    /* 与 home.css 完全同一套：左亮右暗，亮沿 22%~38% 加宽成平台、暗底 50%~62% 收窄；
       色标按视觉位置写 90deg，导出吃不到本页 CSS 所以必须内联。
       ⚠️ 2026-11-14 书槽变浅：alpha 与 home.css / diy-cover.css / color-picker.css
          四处同源（暗槽底 .09，白底最暗约 232），只降浓度、几何档位不动。 */
    const groove = `background:linear-gradient(90deg,`
      + `rgba(0,0,0,.01) 0%,rgba(0,0,0,.02) 12%,`
      + `rgba(255,255,255,.08) 22%,rgba(255,255,255,.08) 38%,`
      + `rgba(255,255,255,.05) 44%,`
      + `rgba(0,0,0,.09) 50%,rgba(0,0,0,.07) 56%,rgba(0,0,0,.02) 62%,`
      + `rgba(255,255,255,.01) 78%,rgba(255,255,255,.05) 100%)`;
    /* 彩带是纯色带（ribbonSpine 已不给渐变，去掉彩带上的黑影）；
       右侧两层接触影是彩带压在封面上的投影，用户明确要保留。
       ⚠️ 只加外投影，不加上下折边暗边 / 槽沿细线；没彩带的装帧走 groove 分支，不吃这条。
       阴影 px 按屏幕封面基准宽 246px（--cover-w 上限）等比放大到导出宽 W。 */
    const cs = W / 246;
    const ribbonShadow = `box-shadow:${(2 * cs).toFixed(1)}px 0 ${(6 * cs).toFixed(1)}px -${(2 * cs).toFixed(1)}px rgba(7,9,16,.18),`
      + `${(1 * cs).toFixed(1)}px 0 ${(2 * cs).toFixed(1)}px rgba(7,9,16,.06)`;
    /* 跟屏幕封面同源：书槽关 / 笔记本透明档时这一列整个不画（彩带 / 压槽都不画） */
    const bind = (st.rings || coverNoSpine(j)) ? ''
      : `<div style="position:absolute;left:0;top:0;bottom:0;width:${w}%;`
        + (spine ? `background:${spine};${ribbonShadow}` : groove) + `"></div>`;
    /* 封面右侧两角跟屏幕上同一本（cover.radius，基准 246px 宽等比放大到导出宽 W）；
       左侧书脊两角固定 3px 基准，不参与自定义。四角露出的就是画布那层纸色。 */
    const rL = (3 * cs).toFixed(1), rR = (coverRadiusOf(j) * cs).toFixed(1);
    const radius = `border-radius:${rL}px ${rR}px ${rR}px ${rL}px;`;
    return `<div style="position:relative;width:${W}px;height:${H}px;overflow:hidden;${radius}${bg}">`
      + (tex ? `<div style="position:absolute;inset:0;${tex}"></div>` : '')
      + `<div style="position:absolute;inset:0;${pat}"></div>`
      + `<div style="position:absolute;inset:0;background:linear-gradient(112deg,rgba(255,255,255,.28) 0%,rgba(255,255,255,0) 34%,rgba(255,255,255,0) 68%,rgba(255,255,255,.12) 100%)"></div>`
      + bind
      + `</div>`;
  }
  const pg = j.pages[idx] || { images: [], texts: [] };
  const kraft = (j.template === 'kraft' || j.template === 'kraftplain');
  /* 自定义内页底色（单页 > 整本）优先于模板自己的底色，跟屏幕上的取舍一致 */
  const pbg = pageBgOf(pg, j);
  const bg = pbg ? 'background:' + pbg + ';'
    : (kraft ? 'background:linear-gradient(160deg,#ecdec4,#e0cfae);' : 'background:#fffdf8;');
  const tpl = String(tplStyle(j.template, j) || '').replace(/(\d+(?:\.\d+)?)px/g, (m, n) => (n * k).toFixed(2) + 'px');
  /* ⚠️ 模板只铺在「版心」里、四周留一圈空白纸边 —— 跟屏幕上 .tplbg 的 --pmx / --pmy 同一套比例
     （见 image-tools.css）：两边不一样的话，导出的图跟屏幕上看到的就不是同一张纸。
     唯一例外是自定义图片模板：它是整页的图，屏幕上 .paper.t-custom .tplbg 也把 inset 归零了，
     所以这里同步把四周留白设成 0，不然导出会被裁掉一圈。 */
  const customTpl = j.template === 'custom' && !!tplImgOf(j);
  const mx = customTpl ? '0' : (W * .055).toFixed(1), my = customTpl ? '0' : (H * .032).toFixed(1);
  const imgHTML = im => {
    const hw = im.h || clamp(im.w / 0.68, .04, IMG_MAX);
    /* 「铺满」的盒子由 fillGeom 算好（可能有限度地拉过），一律不裁：
       算过几何的（im.fit）按盒子拉满；老数据（整页 1×1）退回 contain 按原比例完整导出 */
    const fit = im.fill ? (im.fit ? 'object-fit:fill;border-radius:0;' : 'object-fit:contain;border-radius:0;')
                        : 'object-fit:fill;';
    const rot = im.rot ? `transform:rotate(${im.rot}deg);` : '';
    const box = `position:absolute;left:${(im.x * 100).toFixed(2)}%;top:${(im.y * 100).toFixed(2)}%;width:${(im.w * 100).toFixed(2)}%;height:${(hw * 100).toFixed(2)}%;${rot}`;
    const img = `<img src="${im.src}" style="width:100%;height:100%;display:block;${fit}${frameImgStyle(im)}" />`;
    /* 有边框就套一层 .pframe 的等价物：样式由 frameBoxStyle 现算（跟屏幕上是同一个函数），
       sc = W / PAGE_W_DEFAULT 把阴影那几个 px 按导出尺寸放大，大图小图看起来一样 */
    return hasFrame(im)
      ? `<div style="${box}"><div style="position:absolute;inset:0;box-sizing:border-box;${frameBoxStyle(im, W / PAGE_W_DEFAULT)}">${img}${frameInsetHTML(im, W / PAGE_W_DEFAULT)}</div></div>`
      : `<div style="${box}">${img}</div>`;
  };
  const txtHTML = t => {
    const fs = (t.size || 5.5) / 100 * W;
    const ff = exportFontStack(t.font);     // 导出是独立文档，CSS 变量认不到；手写体画不出就换楷体
    const ffe = t.fontEn ? textEnStack(t.fontEn) : '';   // 英文字体排在中文字体前面
    const lh = exportFontIsHand(t.font) ? 1.42 : 1.32;
    const fam = [ffe, ff === 'inherit' ? '' : ff].filter(Boolean).join(',') || 'inherit';
    /* 便利贴：一张带纸色的便签（跟屏幕上 .ptext-wrap.note .ptxt 同一套：纸色底 + 折角 + 落地影） */
    const nc = normHex6(t.note);
    const note = nc
      ? `background:${nc};padding:.5em .66em;border-radius:3px;`
        + `box-shadow:${(W * .006).toFixed(1)}px ${(W * .011).toFixed(1)}px ${(W * .024).toFixed(1)}px -${(W * .008).toFixed(1)}px rgba(24,26,44,.45),`
        + `inset 0 0 0 ${(W * .004).toFixed(1)}px rgba(255,255,255,.34),inset 0 -${(W * .004).toFixed(1)}px 0 rgba(0,0,0,.08);`
      : '';
    const inner = `width:100%;height:100%;overflow:hidden;font-size:${fs.toFixed(2)}px;color:${t.color || '#2b2f3d'};text-align:${t.align || 'left'};`
      + `${t.bold ? 'font-weight:700;' : ''}${t.italic ? 'font-style:italic;' : ''}`
      + `${t.underline ? 'text-decoration:underline;' : (t.strike ? 'text-decoration:line-through;' : '')}`
      + `${t.bg ? 'background:' + t.bg + ';' : ''}`
      + `${note}`
      + `font-family:${fam};line-height:${lh};letter-spacing:.01em;white-space:pre-wrap;word-break:break-word;`;
    const rot = t.rot ? `transform:rotate(${t.rot}deg);` : '';
    /* 便利贴右下角那个折角 —— 用一层绝对定位的小三角盖上去（导出文档里没有伪元素可借） */
    const fold = nc ? `<div style="position:absolute;right:0;bottom:0;width:${(W * .026).toFixed(0)}px;height:${(W * .026).toFixed(0)}px;`
      + `background:linear-gradient(135deg,transparent 50%,rgba(0,0,0,.16) 50%)"></div>` : '';
    return `<div style="position:absolute;left:${((t.x ?? .16) * 100).toFixed(2)}%;top:${((t.y ?? .16) * 100).toFixed(2)}%;width:${((t.w ?? .56) * 100).toFixed(2)}%;height:${((t.h ?? .12) * 100).toFixed(2)}%;${rot}"><div style="position:relative;width:100%;height:100%"><div style="${inner}">${esc(t.text || '')}</div>${fold}</div></div>`;
  };
  /* 上下层跟应用里一致：按 z 从小到大排，先加的在下、后加的盖在上面 */
  ensureZ(pg);
  const objs = [];
  (pg.images || []).forEach(im => objs.push({ k: 'img', o: im }));
  (pg.texts || []).forEach(t => objs.push({ k: 'txt', o: t }));
  objs.sort((a, b) => (a.o.z || 0) - (b.o.z || 0));
  const body = objs.map(o => o.k === 'img' ? imgHTML(o.o) : txtHTML(o.o)).join('');
  return `<div style="position:relative;width:${W}px;height:${H}px;overflow:hidden;${bg}">`
    + `<div style="position:absolute;left:${mx}px;right:${mx}px;top:${my}px;bottom:${my}px;${tpl}"></div>`
    + `<div style="position:absolute;inset:0">${body}</div>`
    + `<div style="position:absolute;right:${(W * .045).toFixed(0)}px;bottom:${(H * .02).toFixed(0)}px;font-size:${(W * .033).toFixed(1)}px;color:#9aa1b5;letter-spacing:.1em">${idx + 1}</div>`
    + `</div>`;
}
/* 一页的 XHTML 片段（PDF / 长图 / SVG 三种导出共用） */
function pageExportXHTML(j, idx, W, H) {
  return `<div xmlns="http://www.w3.org/1999/xhtml" style="width:${W}px;height:${H}px;overflow:hidden;`
    + `font-family:-apple-system,BlinkMacSystemFont,'PingFang SC','Hiragino Sans GB','Microsoft YaHei','Segoe UI',Roboto,sans-serif;">`
    + pageExportHTML(j, idx, W, H) + `</div>`;
}
async function renderExportCanvas(j, idx, W) {
  const H = Math.round(W * pageRatioOf(j));
  const root = pageExportXHTML(j, idx, W, H);
  /* 根级 <style>：一页一份（PDF 每页是独立 SVG）。__expEnFaces 由 prepareExportEnFaces 备好 */
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${__expEnFaces}<foreignObject width="100%" height="100%">${root}</foreignObject></svg>`;
  const img = await new Promise((res, rej) => {
    const im = new Image();
    im.onload = () => res(im);
    im.onerror = () => rej(new Error('页面渲染失败'));
    im.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  });
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fffdf8';
  ctx.fillRect(0, 0, W, H);
  ctx.drawImage(img, 0, 0, W, H);
  return c;
}
function canvasBytes(c, q) {
  return new Promise((res, rej) => {
    if (c.toBlob) { c.toBlob(b => b ? res(b) : rej(new Error('图片编码失败')), 'image/jpeg', q); return; }
    try { res(new Blob([dataURLtoBytes(c.toDataURL('image/jpeg', q))], { type: 'image/jpeg' })); }
    catch (e) { rej(e); }
  });
}
function dataURLtoBytes(u) {
  const bin = atob(String(u).split(',')[1] || '');
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
/* 最小 PDF 组装：每页一张 JPEG（DCTDecode），手写 xref 表，零依赖 */
function buildPdf(jpegs, pw, ph) {
  const parts = [];
  let off = 0;
  const xr = [0];
  const push = b => { parts.push(b); off += b.length; };
  const pushS = s => { const b = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i) & 0xff; push(b); };
  push(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2D, 0x31, 0x2E, 0x34, 0x0A, 0x25, 0xE2, 0xE3, 0xCF, 0xD3, 0x0A]));
  const beginObj = num => { xr[num] = off; pushS(num + ' 0 obj\n'); };
  beginObj(1); pushS('<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');
  beginObj(2);
  pushS('<< /Type /Pages /Kids [' + jpegs.map((_, i) => (3 + i * 3) + ' 0 R').join(' ') + `] /Count ${jpegs.length} >>\nendobj\n`);
  jpegs.forEach((jp, i) => {
    const pid = 3 + i * 3;
    beginObj(pid);
    pushS(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pw} ${ph}] /Resources << /XObject << /Im0 ${pid + 2} 0 R >> >> /Contents ${pid + 1} 0 R >>\nendobj\n`);
    beginObj(pid + 1);
    const cs = `q ${pw} 0 0 ${ph} 0 0 cm /Im0 Do Q`;
    pushS(`<< /Length ${cs.length} >>\nstream\n${cs}\nendstream\nendobj\n`);
    beginObj(pid + 2);
    pushS(`<< /Type /XObject /Subtype /Image /Width ${jp.w} /Height ${jp.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jp.data.length} >>\nstream\n`);
    push(jp.data);
    pushS('\nendstream\nendobj\n');
  });
  const xrefOff = off;
  let x = `xref\n0 ${3 + jpegs.length * 3}\n0000000000 65535 f\r\n`;
  for (let i = 1; i < 3 + jpegs.length * 3; i++) x += String(xr[i]).padStart(10, '0') + ' 00000 n\r\n';
  pushS(x + `trailer\n<< /Size ${3 + jpegs.length * 3} /Root 1 0 R >>\nstartxref\n${xrefOff}\n%%EOF`);
  const out = new Uint8Array(off);
  let p = 0;
  for (const b of parts) { out.set(b, p); p += b.length; }
  return out;
}
/* 导出 PDF：先趁手势有效挑好保存位置，再慢慢渲染（页多时渲染要好几秒，手势等不了那么久） */
async function exportJournalPDF(j) {
  if (!j) return;
  /* PDF 是明文副本：加密本必须先解锁。解锁成功后 state 里换成了新对象，按 id 重新取一次 */
  if (!guardUnlocked(j, () => exportJournalPDF(lkById(j.id)))) return;
  await probeExportFont();
  await prepareExportEnFaces(j);        // 把这本用到的自带英文字体备进 SVG 根
  const pages = exportPages(j);
  const name = exportBaseName(j) + '.pdf';
  toast(`正在准备导出…（含封面共 ${pages.length} 页）`);
  const target = await pickExportTarget(name, 'PDF 文件', '.pdf', 'application/pdf');
  if (target === 'cancel') { toast('已取消导出'); return; }
  try {
    const CW = EX_W, CH = Math.round(EX_W * pageRatioOf(j));
    const jpegs = [];
    for (let i = 0; i < pages.length; i++) {
      toast(`正在生成 PDF… ${i + 1} / ${pages.length}`);
      const c = await renderExportCanvas(j, pages[i], CW);
      const blob = await canvasBytes(c, 0.9);
      jpegs.push({ w: CW, h: CH, data: new Uint8Array(await blob.arrayBuffer()) });
    }
    const bytes = buildPdf(jpegs, 595, +(595 * pageRatioOf(j)).toFixed(2));
    await deliverBlob(target, name, new Blob([bytes], { type: 'application/pdf' }), 'application/pdf',
      `已导出《${j.name}》PDF · 共 ${jpegs.length} 页`);
  } catch (e) {
    console.error('[export pdf] 失败：', e);
    toast('导出 PDF 失败：' + ((e && e.message) || e), 4200);
  }
}
/* 导出 SVG：每页一个 foreignObject，竖向拼成一张矢量长图。
   版式跟长图一致，但文字是真矢量，放大多少倍都不糊，也方便再拿去改 */
async function exportJournalSVG(j) {
  if (!j) return;
  /* 同上：SVG 长图也是明文副本，未解锁的加密本不能出 */
  if (!guardUnlocked(j, () => exportJournalSVG(lkById(j.id)))) return;
  await probeExportFont();
  await prepareExportEnFaces(j);        // 把这本用到的自带英文字体备进 SVG 根
  const pages = exportPages(j);
  const name = exportBaseName(j) + '.svg';
  toast(`正在准备导出…（含封面共 ${pages.length} 页）`);
  const target = await pickExportTarget(name, 'SVG 文件', '.svg', 'image/svg+xml');
  if (target === 'cancel') { toast('已取消导出'); return; }
  try {
    const W = EX_W;
    const H = Math.round(W * pageRatioOf(j));
    const totalH = H * pages.length;
    const body = pages.map((idx, i) =>
      `<foreignObject x="0" y="${i * H}" width="${W}" height="${H}">`
      + pageExportXHTML(j, idx, W, H) + `</foreignObject>`
    ).join('');
    const svg = '<?xml version="1.0" encoding="UTF-8"?>\n'
      + `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${totalH}" viewBox="0 0 ${W} ${totalH}">`
      + `<rect width="${W}" height="${totalH}" fill="#fffdf8"/>` + __expEnFaces + body + `</svg>`;
    const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
    await deliverBlob(target, name, blob, 'image/svg+xml', `已导出《${j.name}》SVG · ${pages.length} 页`);
  } catch (e) {
    console.error('[export svg] 失败：', e);
    toast('导出 SVG 失败：' + ((e && e.message) || e), 4200);
  }
}

