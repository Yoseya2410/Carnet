/* =====================================================================
 * Carnet · 图片 · 上传压缩与落位   （脚本 17 / 24）
 * ---------------------------------------------------------------------
 * ① 选图入口与压缩 shrinkImageFile（统一缩到长边像素上限）
 * ② 图片按真实比例落位、补齐高度 ensureImageHeights
 * ③ 对象盒子与旋转的统一下发 applyBox（内部调 applyRot）
 * ④ 封面图片上传（会用到 editor.js 的 ed / syncEditor）
 *
 * 对外接口：shrinkImageFile, ensureImageHeights, applyBox, applyRot, paperAspect
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
/* 旋转：整块（内容 + 四角手柄）一起转，绕中心；--rot 同时给工具条反着转回来用 */
function applyRot(w, im) {
  if (!w) return;
  const r = (+(im.rot || 0)).toFixed(1) + 'deg';
  w.style.setProperty('--rot', r);
  w.style.transform = 'rotate(' + r + ')';
}
function applyBox(w, im) {
  w.style.left = (im.x * 100).toFixed(2) + '%';
  w.style.top = (im.y * 100).toFixed(2) + '%';
  w.style.width = (im.w * 100).toFixed(2) + '%';
  if (im.h) w.style.height = (im.h * 100).toFixed(2) + '%';
  applyRot(w, im);
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
/* 背景图没必要存原图：超过 maxSide 就等比缩一下再压成 JPEG，
   几 MB 的截图压完通常只有几百 KB，存 IndexedDB 不心疼 */
function shrinkImageFile(file, maxSide) {
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
        c.getContext('2d').drawImage(im, 0, 0, w, h);
        try { res(c.toDataURL('image/jpeg', 0.82)); }
        catch (_) { res(fr.result); }          // 极端情况拿不到画布，退回原图
      };
      im.src = fr.result;
    };
    fr.readAsDataURL(file);
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

