/* =====================================================================
 * Carnet · 图片 · 上传压缩与落位   （脚本 18 / 27）
 * ---------------------------------------------------------------------
 * ① 选图入口与压缩 shrinkImageFile（统一缩到长边像素上限）
 * ② 图片按真实比例落位、补齐高度 ensureImageHeights、「铺满整页」的等比几何 fillGeom
 * ③ 对象盒子与旋转的统一下发 applyBox（内部调 applyRot）
 * ④ 换图 replaceImage：只换图源，位置 / 宽 / 旋转 / 上下层不动（文件读取 readFileDataURL）
 * ⑤ 封面图片上传（会用到 editor.js 的 ed / syncEditor）
 *
 * 对外接口：shrinkImageFile, ensureImageHeights, applyBox, applyRot, applyCur, cursorValue,
 *           rotShift, paperAspect, imgRatio, fillGeom, applyFillGeom, ensureFillGeom, replaceImage
 *
 * 依赖模块：core（state / storage / reader-view / editor 后置，只在运行时回调里用）
 *
 * 说明：模块间共用全局作用域，加载顺序即依赖顺序（见 index.html 与 README）。
 * ===================================================================== */
/* ==================== 图片上传 ==================== */
/* 纸张宽高比：图片数据的 h 是“占页高的比例”，需要用纸的比例换算 */
/* 纸的宽高比兜底值：量不到真实纸张时用（真实值从 .paper 量，见 paperAspect） */
const PAPER_ASPECT_FALLBACK = 0.68;
function paperAspect() {
  const el = $('#slotR .paper') || $('#slotL .paper');
  if (el) {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) return r.width / r.height;
  }
  return PAPER_ASPECT_FALLBACK;
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
/* 旋转：整块（内容 + 四角手柄）一起转，绕中心；--rot 同时给工具条反着转回来用。
   --cur-a / --cur-b 是拉伸手柄的指针（跟着角度走，见 applyCur） */
function applyRot(w, im) {
  if (!w) return;
  const r = (+(im.rot || 0)).toFixed(1) + 'deg';
  w.style.setProperty('--rot', r);
  w.style.transform = 'rotate(' + r + ')';
  applyCur(w, im.rot);
}
/* ---- 拉伸手柄的鼠标指针：箭头方向要跟拖动方向一致 ----
   手柄长在被旋转的这个盒子里，拖动方向自然也跟着转，可 CSS 那几个 resize 指针
   （nwse / nesw / ns / ew）一共就四个方向、没有「转个角度」的说法 ——
   对象一转，箭头指的方向就跟实际拖动的方向对不上了（转 90° 时最明显：明明该上下拉，
   箭头还指着斜角）。所以干脆自己按当前方向画一根双箭头。
   落在 0/45/90/135 这几个正角度上时直接沿用系统指针（更清晰、跟系统一个模样），
   落在两个正角度之间才用画出来的 PNG。
   角度 0~180（一根线不分首尾），按 5° 量化 → 最多 36 张，画一次缓存起来。
   tl / br 走 --cur-a、tr / bl 走 --cur-b（两条对角线正好差 90°），CSS 见 image-tools.css */
const CUR_STEP = 5;
const NATIVE_CUR = { 0: 'ew-resize', 45: 'nwse-resize', 90: 'ns-resize', 135: 'nesw-resize' };
const curPNGCache = new Map();
function drawArrowCursor(deg) {
  const S = 32, k = S / 2;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  if (deg) { g.translate(k, k); g.rotate(deg * Math.PI / 180); g.translate(-k, -k); }
  /* 一根中间带柄的双箭头：白底 + 深色描边，压在浅色纸上、深色图上都能看清 */
  const p = new Path2D('M5 16 L11 10.6 L11 14 L21 14 L21 10.6 L27 16 L21 21.4 L21 18 L11 18 L11 21.4 Z');
  g.lineJoin = 'round';
  g.fillStyle = '#fff'; g.fill(p);
  g.lineWidth = 1.3; g.strokeStyle = '#1c1e2e'; g.stroke(p);
  return c.toDataURL('image/png');
}
/* dir 是箭头该指的方向（0~180，一根线不分首尾）；返回一段能直接写进 cursor 的值 */
function cursorValue(dir) {
  const d = ((dir % 180) + 180) % 180;
  if (NATIVE_CUR[d]) return NATIVE_CUR[d];
  const k = Math.round(d / CUR_STEP) * CUR_STEP % 180;
  if (NATIVE_CUR[k]) return NATIVE_CUR[k];
  const fb = NATIVE_CUR[((Math.round(k / 45) * 45) % 180 + 180) % 180];   // 拿不到自定义图片时的兜底
  let u = curPNGCache.get(k);
  if (u === undefined) { try { u = drawArrowCursor(k) || ''; } catch (_) { u = ''; } curPNGCache.set(k, u); }
  if (!u) return fb;
  /* url() 里别加引号：这串值还要塞进 style="..." 属性，引号会把属性截断 */
  return 'url(' + u + ') 16 16, ' + fb;
}
function applyCur(w, rot) {
  if (!w) return;
  const r = +(rot || 0);
  if (w.__curRot === r) return;       // 角度没变就别重写：dataURL 挺长，写一次是一份开销
  w.__curRot = r;
  w.style.setProperty('--cur-a', cursorValue(r + 45));   // tl / br
  w.style.setProperty('--cur-b', cursorValue(r - 45));   // tr / bl
}
/* ---- 旋转对象「改了尺寸」的位移补偿 ----
   盒子是先按 left/top/width/height 摆好、再绕自己中心 rotate 的（见 image-tools.css）。
   所以宽高一变，中心就跟着挪 —— 屏幕上整块会被甩出去一段。没旋转时完全看不出来，
   转过之后就变成「拽右下角、左上角跟着跑」「转 90° 后拖大小，横竖乱串」。
   屏幕位置 S(p) = C + R·(p − C)（C 是中心，R 是旋转矩阵，cos/sin 见下）。
   想让「局部没动过的点」（比如拉伸时对角那个角、文字长高时的顶边）留在原处，
   除了改尺寸还得把盒子整体平移一段：
       S'(p) = C + ΔC + t + R·(p − C − ΔC)  =  S(p)   ⟹   t = (R − I)·ΔC
   也就是 t = ((cosθ−1)·dx − sinθ·dy, sinθ·dx + (cosθ−1)·dy)。
   θ = 0 时 cosθ−1 与 sinθ 都正好是 0，返回值恒为 0 —— 跟没旋转时一模一样。
   dx / dy 是中心位移（像素），rect 是纸的尺寸；返回的是占页比例，直接加到 x / y 上。 */
function rotShift(rect, rot, dxPx, dyPx) {
  const a = (+(rot || 0)) * Math.PI / 180;
  const cs = Math.cos(a), sn = Math.sin(a);
  const W = rect && rect.width ? rect.width : 1, H = rect && rect.height ? rect.height : 1;
  return { x: ((cs - 1) * dxPx - sn * dyPx) / W, y: (sn * dxPx + (cs - 1) * dyPx) / H };
}
function applyBox(w, im) {
  w.style.left = (im.x * 100).toFixed(2) + '%';
  w.style.top = (im.y * 100).toFixed(2) + '%';
  w.style.width = (im.w * 100).toFixed(2) + '%';
  if (im.h) w.style.height = (im.h * 100).toFixed(2) + '%';
  applyRot(w, im);
  syncTiny(w, im);
}
/* ---- 「铺满整页」的几何：整张图完整落进纸里（不裁），允许有限度地拉伸 ----
   两步走：① 先按图片自己的比例撑到最大（贴住左右或上下一对边）；
   ② 再往「填满整页」那个方向拉一把 —— 只拉短的那一边，最多拉 FILL_STRETCH。
   比例跟纸差得不多的图（3:4、方图、5:4…）拉完基本就满页了；差太远的（全景、长图）
   只拉到上限，剩下的留白透出纸色 —— 硬拉满会把人拉扁，那不是「一定程度」。
   盒子比例 ≠ 图片比例，所以 .pimg 必须 object-fit: fill（拉满盒子），见 image-tools.css。
   ratio 是「高 ÷ 宽」（跟 imgRatio 一致），返回的全是占页比例。
   ⚠️ 纸张比例用 PAGE_RATIO 常量而不是量 DOM：一键成书时阅读器还没打开、量不到 .paper，
      量出来的值还可能被最小页高顶偏；纸的模样全项目统一是 3:4.05，跟导出也是同一套 */
const FILL_STRETCH = .3;      // 最多拉 30%（往填满的那一维拉）。想更满调大，想更保真调小
const FILL_GEOM_V = 2;        // 几何版本号：fillGeom 的算法一改就 +1，老数据按新规矩重算一次
function fillGeom(ratio, pa) {
  const a = (typeof pa === 'number' && pa > 0) ? pa : 1 / PAGE_RATIO;   // 纸宽 ÷ 纸高
  const r = (ratio > 0 && isFinite(ratio)) ? ratio : 1;
  let w = 1, h = w * r * a;                  // 先按「贴住左右两边」算（横图 / 方图走这条）
  if (h > 1) { h = 1; w = 1 / (r * a); }     // 图比纸还瘦高 → 改成贴住上下两边
  /* 需要拉的倍数 = 短边补满到 1 的倍率；只拉到上限，别把人拉扁 */
  const need = w >= h ? 1 / h : 1 / w;
  const s = Math.min(need, 1 + FILL_STRETCH);
  if (h < 1) h = Math.min(1, h * s); else w = Math.min(1, w * s);
  return { x: (1 - w) / 2, y: (1 - h) / 2, w: clamp(w, .02, 1), h: clamp(h, .02, 1) };
}
/* 按图片的真实比例把上面这套几何写进 im（异步：得先解码图片才量得到比例）。
   j 不传就按当前这本 —— 方形画册的纸是方的，铺满的几何跟 3:4.05 不一样 */
async function applyFillGeom(im, j) {
  const r = await imgRatio(im.src);
  const jj = j || cur();
  Object.assign(im, fillGeom(r, jj ? 1 / pageRatioOf(jj) : undefined));
  /* 记号 = 几何版本号：老数据没有它（那会儿是整页 1×1 + 裁切），靠它只校准一次；
     算法改了版本号也对不上，会按新规矩重算 —— 只认尺寸不行，正好和纸同比例的图算出来也是 1×1 */
  im.fit = FILL_GEOM_V;
  return im;
}
/* 老数据（整页 1×1 + cover 裁切）或按旧算法算过的，翻到的那一本顺手校准一次 */
let fixingFill = false;
function ensureFillGeom() {
  if (fixingFill) return;
  const j = cur(); if (!j) return;
  const tasks = [];
  j.pages.forEach(pg => (pg.images || []).forEach(im => {
    if (im.fill && im.fit !== FILL_GEOM_V) tasks.push(im);
  }));
  if (!tasks.length) return;
  fixingFill = true;
  Promise.all(tasks.map(im => applyFillGeom(im))).then(() => {
    fixingFill = false; save();
    /* 正在拖 / 拉伸 / 打字时别重绘，会打断手势和输入，稍后再补一次 */
    if (pageBusy()) { setTimeout(() => { if (!pageBusy()) renderReader(); }, 700); return; }
    renderReader();
  });
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
/* 背景图没必要存原图：超过 maxSide 就等比缩一下再压成 JPEG，
   几 MB 的截图压完通常只有几百 KB，存 IndexedDB 不心疼。
   opt = { q, bg }：q 是 JPEG 质量（默认 .82）、bg 是打底色（默认不打底）。
   「一键成书」那一路用更高质量，并先铺一层纸白 —— 透明 PNG 转 JPEG 会发黑 */
function shrinkImageFile(file, maxSide, opt) {
  const q = (opt && opt.q) || .82;
  const bg = (opt && opt.bg) || '';
  return new Promise(res => {
    const fr = new FileReader();
    fr.onerror = () => res(null);
    fr.onload = () => {
      const im = new Image();
      im.onerror = () => res(null);
      im.onload = () => {
        const k = Math.min(1, maxSide / Math.max(im.width, im.height));
        const w = Math.max(1, Math.round(im.width * k));
        const h = Math.max(1, Math.round(im.height * k));
        const c = document.createElement('canvas');
        c.width = w; c.height = h;
        const ctx = c.getContext('2d');
        if (bg) { ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h); }
        ctx.drawImage(im, 0, 0, w, h);
        try { res(c.toDataURL('image/jpeg', q)); }
        catch (_) { res(fr.result); }          // 极端情况拿不到画布，退回原图
      };
      im.src = fr.result;
    };
    fr.readAsDataURL(file);
  });
}
/* 读一个图片文件 → dataURL。失败给回 null（不抛，调用处各自兜着） */
function readFileDataURL(f) {
  return new Promise(res => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = () => res(null);
    r.readAsDataURL(f);
  });
}
/* ---- 换图：把页面上已有的一张图换成另一张 ----
   只换图源：位置 x/y、旋转 rot、上下层 z 一个字节都不动。
   两种档位都要按新图的真实比例重算盒子 —— 图片是铺进盒子里的，盒子比例跟新图对不上
   就会把人拉扁（铺满那档重算的是「贴边 + 居中」那一套，见 fillGeom）。
   跟「添加图片」一样存原图、不重编码（透明通道也留着） */
async function replaceImage(pid, iid, file) {
  const j = cur(); if (!j) return;
  const pg = j.pages[pid]; if (!pg) return;
  const im = (pg.images || []).find(x => x.id === iid); if (!im) return;
  const src = await readFileDataURL(file);
  if (!src) { toast('这张图读不出来，换一张试试'); return; }
  im.src = src;
  if (im.fill) await applyFillGeom(im);                                       // 铺满：按新图比例重新贴边居中
  else im.h = clamp(im.w * (await imgRatio(src)) * paperAspect(), .04, IMG_MAX);  // 原比例：只改高度
  save(); renderReader();
  /* 重绘换了节点：原来选中的话把选中态接回去，工具条继续留在那儿（已固定的图不接） */
  if (!im.locked) {
    const nw = $(`#slotL .pimg-wrap[data-id="${iid}"], #slotR .pimg-wrap[data-id="${iid}"]`);
    if (nw) { nw.classList.add('sel'); syncBar(nw, im); fitObjBar(nw); }
  }
  toast('已换图 · 第 ' + (pid + 1) + ' 页');
}
$('#swapFile').addEventListener('change', e => {
  const f = e.target.files[0]; e.target.value = '';
  const t = state.swapTarget; state.swapTarget = null;   // 不管成不成，目标只消费一次
  if (f && t) replaceImage(t.pid, t.iid, f);
});
$('#filePicker').addEventListener('change', async e => {
  const f = e.target.files[0]; if (!f) return;
  const pid = state.pendingPage ?? (state.mode === 'spread' ? state.spread * 2 : state.page);
  const src = await readFileDataURL(f);
  e.target.value = '';
  if (!src) return;
  const j = cur();
  if (!j.pages[pid]) return;
  const w = 0.42;
  const h = clamp(w * (await imgRatio(src)) * paperAspect(), .04, IMG_MAX);   // 保持原始宽高比
  j.pages[pid].images.push({ id: uid(), src, x: 0.22, y: 0.2, w, h, z: nextZ(j.pages[pid]) });
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

