/* =====================================================================
 * Carnet · 一键成书 · 图片 → 手帐本   （脚本 9 / 25）
 * ---------------------------------------------------------------------
 * ① pickBookImages：一次选多张图片（多选文件框，选完即成书）
 * ② 排序：按文件名自然序（IMG_2 排在 IMG_10 前面）—— 文件框给回来的
 *    顺序各家浏览器不一致，排好序才谈得上「按顺序成书」
 * ③ 逐张读图：小图直接用原图（保留 PNG 透明与无损），大图压到长边上限再存
 * ④ makePhotoBook：一张图一页，图片一律铺满整页并固定；封面用第一张图
 * ⑤ 进度胶囊 #mkBusy：toast 只进控制台，成书这种几秒的活儿得有看得见的进度
 *
 * 对外接口：pickBookImages, buildPhotoBook, makePhotoBook, mkPhotoPage
 *
 * 依赖模块：core, media（state / storage / home-view / carousel / reader-flow 后置，只在运行时回调里用）
 *
 * 说明：模块间共用全局作用域，加载顺序即依赖顺序（见 index.html 与 README）。
 * ===================================================================== */
/* 一次最多做多少页：跟编辑器「页数」的上限（200）保持一致，再多也翻不动了 */
const PB_MAX_PAGES = 200;
/* 大图压缩后的长边上限：够铺满整页（含导出），又不至于把本地库撑爆 */
const PB_MAX_SIDE = 1600;
/* 原文件没超过这个体积就直接用：不重编码、不丢透明通道，也不多读一遍磁盘 */
const PB_KEEP_BYTES = 220 * 1024;
/* 成书用的图比背景图讲究，压的时候给高一点质量；透明 PNG 转 JPEG 会发黑，先铺一层纸白 */
const PB_JPEG_Q = .86;
const PB_JPEG_BG = '#fffdf8';
let pbBusy = false;                 // 正在成书：挡住重复触发

/* ---- 名字自然序：'2' 排在 '10' 前面 ---- */
function pbNameCmp(a, b) {
  const s = String(a || ''), t = String(b || '');
  try { return s.localeCompare(t, undefined, { numeric: true, sensitivity: 'base' }); }
  catch (_) { return s < t ? -1 : (s > t ? 1 : 0); }   // 老浏览器不认 numeric
}
function fileToDataURL(f) {
  return new Promise(res => {
    const r = new FileReader();
    r.onload = () => res(String(r.result || ''));
    r.onerror = () => res(null);
    r.readAsDataURL(f);
  });
}
/* 读一张图进页面：小图原样进（省一次重编码），大图压完再进 */
async function readPageImage(f) {
  if (f && f.size && f.size <= PB_KEEP_BYTES) return await fileToDataURL(f);
  const s = await shrinkImageFile(f, PB_MAX_SIDE, { q: PB_JPEG_Q, bg: PB_JPEG_BG });
  if (s) return s;
  return await fileToDataURL(f);                  // 压缩失败（画不出画布）退回原图
}
/* 一张图一页：铺满整页（fill = 按封面式裁切，不拉伸变形）并固定 ——
   不固定的话整张纸都是图片，左右一划就成了拖图，翻不了页（跟工具条「铺满整页」同一套设置） */
function mkPhotoPage(src) {
  return { images: [{ id: uid(), src, x: 0, y: 0, w: 1, h: 1, locked: true, fill: true, z: 0 }], texts: [] };
}
/* 默认书名：图片手帐 M.D；同一天再来一本就往后加序号，不重名 */
function pbDefaultName() {
  const d = new Date();
  return `图片手帐 ${d.getMonth() + 1}.${d.getDate()}`;
}
function uniqJournalName(base) {
  const has = n => state.journals.some(j => j.name === n);
  if (!has(base)) return base;
  for (let k = 2; k < 200; k++) { const n = base + ' ' + k; if (!has(n)) return n; }
  return base;
}
/* 由一组图片 src 造一本：封面用第一张图，内页一图一页 */
function makePhotoBook(srcs, name) {
  const j = newJournal();
  j.name = uniqJournalName(name || pbDefaultName());
  j.template = 'blank';                 // 照片自己就是底，别再压网格 / 横线
  j.pageBg = '';
  j.pages = (srcs || []).filter(Boolean).map(mkPhotoPage);
  if (j.pages.length) j.cover.img = j.pages[0].images[0].src;
  j.created = Date.now();
  return j;
}
/* ---- 进度胶囊 ---- */
function pbProgress(done, total) {
  const box = $('#mkBusy'); if (!box) return;
  $('#mkTx').textContent = total > 1 ? `正在成书 ${done} / ${total}` : '正在成书…';
  box.hidden = false;
}
function pbHideProgress() { const box = $('#mkBusy'); if (box) box.hidden = true; }

/* ---- 成书 ---- */
async function buildPhotoBook(files) {
  if (pbBusy) return;
  const all = [...(files || [])].filter(f => f && (!f.type || /^image\//.test(f.type)));
  if (!all.length) return;                                  // 没选 / 选的不是图片：静静收场
  all.sort((a, b) => pbNameCmp(a.name, b.name));
  const list = all.slice(0, PB_MAX_PAGES);
  pbBusy = true;
  pbProgress(0, list.length);
  const srcs = [];
  for (let i = 0; i < list.length; i++) {
    pbProgress(i + 1, list.length);
    const s = await readPageImage(list[i]);
    if (s) srcs.push(s);
    await new Promise(r => setTimeout(r, 0));               // 让出一帧，进度数字才画得出来
  }
  pbHideProgress();
  pbBusy = false;
  if (!srcs.length) { toast('这些图片都读不出来，换几张试试'); return; }
  const j = makePhotoBook(srcs);
  state.journals.push(j);
  state.sel = state.journals.length - 1;
  save(); renderHome(); selectJournal(state.sel, false);
  const skipped = list.length - srcs.length;
  const over = all.length - list.length;
  toast(`《${j.name}》已成书 · ${j.pages.length} 页`
    + (over > 0 ? ` · 只取前 ${PB_MAX_PAGES} 张` : '')
    + (skipped > 0 ? ` · ${skipped} 张读不出来已跳过` : ''));
  /* 成书直接翻开看：读者打开动画要在主页渲染完之后才量得到封面位置 */
  setTimeout(() => {
    if (!$('#reader').classList.contains('show')) openReader();
  }, 240);
}
/* 选图：多选文件框。取消选择不会触发 change，靠 cancel 事件把临时 input 收掉 */
function pickBookImages() {
  if (pbBusy) return;
  const inp = document.createElement('input');
  inp.type = 'file'; inp.accept = 'image/*'; inp.multiple = true;
  inp.style.display = 'none';
  document.body.appendChild(inp);
  const drop = () => { if (inp.parentNode) inp.remove(); };
  inp.addEventListener('cancel', drop);
  inp.onchange = () => {
    const files = [...(inp.files || [])];
    drop();
    buildPhotoBook(files);
  };
  inp.click();
}
