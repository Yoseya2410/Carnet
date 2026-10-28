/* =====================================================================
 * Carnet · 一键成书 · 图片 / PDF / 跨页图 → 手帐本   （脚本 9 / 27）
 * ---------------------------------------------------------------------
 * ① pickBookImages：一次选多张图片（多选文件框，选完即成书）
 * ② 排序：按文件名自然序（IMG_2 排在 IMG_10 前面）—— 文件框给回来的
 *    顺序各家浏览器不一致，排好序才谈得上「按顺序成书」
 * ③ 逐张读图：小图直接用原图（保留 PNG 透明与无损），大图压到长边上限再存
 * ④ makePhotoBook：一张图一页，图片一律铺满整页并固定；封面用第一张图
 * ⑤ 进度胶囊 #mkBusy：toast 只进控制台，成书这种几秒的活儿得有看得见的进度
 * ⑥ PDF 导入 pickBookPDF：pdfjs 把每一页渲染成 JPEG，之后和图片成书同一条流水线
 *    （pdfjs 只在真要导入 PDF 时才喂进来，不拖慢首屏；见 ensurePdfLib）
 * ⑦ 跨页图 pickSpreadImage：一张横图从中间裁成左右两半，各占一页，
 *    摊开来两半严丝合缝拼成一张（见 sliceSpread）
 *
 * 对外接口：pickBookImages, buildPhotoBook, makePhotoBook, mkPhotoPage,
 *           pickBookPDF, buildPdfBook, ensurePdfLib,
 *           pickSpreadImage, addSpreadImage, sliceSpread, spreadInsertIndex
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
/* ---- PDF ---- */
/* pdfjs（v3 legacy UMD）：放在 assets/vendor/ 下，只在真要导入 PDF 时才喂进来。
   放外面（file:// 或离线也能用）而不是走 CDN：中文网络上的公共 CDN 时好时坏，
   一次加载失败整个功能就废了。代价是多了约 1.5M 的静态资源，但它们不进首屏 */
const PDF_LIB = 'assets/vendor/pdf.min.js';
const PDF_WORKER = 'assets/vendor/pdf.worker.min.js';
/* 引擎本体（约 1.5M）必须本地有，离线 / file:// 都能跑；
   cmaps 与标准字体（Base-14，如 Helvetica）只在 PDF 里真用到未内嵌字体时才按需去拉，
   所以这两样走 CDN 即可，不进仓库。国内直连用 npmmirror 的文件镜像 */
const PDF_RES = 'https://registry.npmmirror.com/pdfjs-dist/3.11.174/files';
const PDF_CMAPS = PDF_RES + '/cmaps/';
const PDF_FONTS = PDF_RES + '/standard_fonts/';
/* PDF 渲染的一次最多页数、渲染长边上限：页数多了自动降档，别把内存吃穿 */
const PDF_MAX_PAGES = PB_MAX_PAGES;
const PDF_SIDE_HIGH = 1500, PDF_SIDE_MID = 1100, PDF_SIDE_LOW = 820;
/* ---- 跨页图 ---- */
/* 半页的像素宽：半页高 = 它 × PAGE_RATIO，跟纸一个比例，落进页面不用再拉伸变形。
   整页规模：width 1200 → 每半张 1200×1620，两张合起来是一张 2400×1620 的横图 */
const SPREAD_HALF_W = 1200;

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
/* 一张图一页：铺满整页（fill = 等比撑到最大、完整显示不裁切）并固定 ——
   不固定的话整张纸都是图片，左右一划就成了拖图，翻不了页（跟工具条「铺满整页」同一套设置）
   w/h = 1 只是占位，真实几何在成书后按每张图的比例重算（见 applyFillGeom） */
function mkPhotoPage(src) {
  return { images: [{ id: uid(), src, x: 0, y: 0, w: 1, h: 1, locked: true, fill: true, z: 0 }], texts: [] };
}
/* 逐页按图片真实比例重算「铺满」的几何：撑到最大贴边 + 居中，整张照片都在纸里 */
async function fitPhotoPages(j) {
  const ims = [];
  j.pages.forEach(pg => (pg.images || []).forEach(im => { if (im.fill) ims.push(im); }));
  await Promise.all(ims.map(im => applyFillGeom(im)));
  return j;
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
/* 由一组图片 src 造一本：封面用第一张图，内页一图一页。
   彩带默认走「透明」那一档：成书本来就是拿自己的照片 / PDF 当封面，
   再硬加一条别的颜色的书脊会跟封面打架，不想要的心智负担全部去掉 */
function makePhotoBook(srcs, name) {
  const j = newJournal();
  j.name = uniqJournalName(name || pbDefaultName());
  j.template = 'blank';                 // 照片自己就是底，别再压网格 / 横线
  j.pageBg = '';
  j.ribbon = RIBBON_NONE;
  j.pages = (srcs || []).filter(Boolean).map(mkPhotoPage);
  if (j.pages.length) j.cover.img = j.pages[0].images[0].src;
  j.created = Date.now();
  return j;
}
/* ---- 进度胶囊 ---- */
function pbProgress(done, total, label) {
  const box = $('#mkBusy'); if (!box) return;
  const t = label || '正在成书';
  $('#mkTx').textContent = total > 1 ? `${t} ${done} / ${total}` : t + '…';
  box.hidden = false;
}
function pbHideProgress() { const box = $('#mkBusy'); if (box) box.hidden = true; }

/* ---- 成书 ---- */
/* 一本做好的新书交出去：入库 → 选中 → 重绘主页 → 直接翻开看。
   tail 是插在书名后面的那句补充说明（跳过了几张 / 只取前多少页） */
async function pbDeliver(j, tail) {
  state.journals.push(j);
  state.sel = state.journals.length - 1;
  save(); renderHome(); selectJournal(state.sel, false);
  toast(`《${j.name}》已成书 · ${j.pages.length} 页` + (tail || ''));
  /* 成书直接翻开看：读者打开动画要在主页渲染完之后才量得到封面位置 */
  setTimeout(() => {
    if (!$('#reader').classList.contains('show')) openReader();
  }, 240);
}
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
  const j = await fitPhotoPages(makePhotoBook(srcs));
  const skipped = list.length - srcs.length;
  const over = all.length - list.length;
  await pbDeliver(j, (over > 0 ? ` · 只取前 ${PB_MAX_PAGES} 张` : '')
    + (skipped > 0 ? ` · ${skipped} 张读不出来已跳过` : ''));
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

/* ==================================================================
 * PDF → 手帐本
 * ------------------------------------------------------------------
 * 一页 PDF 一张图：pdfjs 把每一页渲染成 canvas，压成 JPEG，之后跟「一键成书」
 * 完全是同一条流水线（makePhotoBook → fitPhotoPages），越往后越省心。
 * pdfjs 是按需加载的：没点过这个功能，那两个文件一个字节都不会下下来。
 * ================================================================== */
let pdfLibTask = null;
function loadScriptOnce(src) {
  return new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = src; s.async = true;
    s.onload = () => res(true);
    s.onerror = () => rej(new Error(src + ' 加载失败'));
    document.head.appendChild(s);
  });
}
async function ensurePdfLib() {
  if (window.pdfjsLib) {
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDF_WORKER;
    return window.pdfjsLib;
  }
  if (!pdfLibTask) {
    pdfLibTask = loadScriptOnce(PDF_LIB).then(() => {
      const lib = window.pdfjsLib;
      if (!lib) throw new Error('PDF 引擎没起来');
      lib.GlobalWorkerOptions.workerSrc = PDF_WORKER;   // 起 Worker；起不来时 pdfjs 自己会退回主线程跑
      return lib;
    });
    pdfLibTask.catch(() => { pdfLibTask = null; });     // 失败就别把坏的那份 Promise 一直留着
  }
  return pdfLibTask;
}
/* PDF 的书名：拿文件名（去掉 .pdf），跟同名的排到后面一本 */
function pdfBookName(file) {
  return uniqJournalName(String((file && file.name) || '').replace(/\.pdf$/i, '').trim() || pbDefaultName());
}
/* 渲染密度：页数越多越降一档 —— 一百多页全按 1500 渲，手机端内存先崩的是它 */
function pdfRenderSide(n) {
  return n > 90 ? PDF_SIDE_LOW : (n > 40 ? PDF_SIDE_MID : PDF_SIDE_HIGH);
}
/* 一页 PDF → JPEG：先把纸白铺上（PDF 没底色的地方是透明的，转 JPEG 会发黑），
   再按上面的密度选渲染倍数 */
async function renderPdfPage(page, maxSide) {
  const v0 = page.getViewport({ scale: 1 });
  const base = Math.max(v0.width || 1, v0.height || 1);
  const vp = page.getViewport({ scale: maxSide / base });
  const W = Math.max(1, Math.round(vp.width)), H = Math.max(1, Math.round(vp.height));
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  if (!g) return null;
  g.fillStyle = PB_JPEG_BG; g.fillRect(0, 0, W, H);
  try {
    await page.render({ canvasContext: g, viewport: vp }).promise;
  } catch (e) {
    console.error('[pdf] 第 ' + page.pageNumber + ' 页渲染失败：', e);
  }
  try { return c.toDataURL('image/jpeg', PB_JPEG_Q); }
  catch (_) { return null; }
  finally { c.width = c.height = 0; }        // 画布还给浏览器，别让上百张一直挂着
}
async function buildPdfBook(file) {
  if (pbBusy || !file) return;
  pbBusy = true;
  let doc = null;
  try {
    pbProgress(0, 1, '正在准备 PDF 引擎');
    const lib = await ensurePdfLib();
    pbProgress(1, 2, '正在读取 PDF');
    const buf = await file.arrayBuffer();
    doc = await lib.getDocument({
      data: new Uint8Array(buf), disableAutoFetch: true,
      cMapUrl: PDF_CMAPS, cMapPacked: true,          // 未内嵌 CMap 的 CJK 文档按需取
      standardFontDataUrl: PDF_FONTS                 // 未内嵌的 Base-14 字体按需取
    }).promise;
    const n = doc.numPages || 0;
    if (!n) { toast('这个 PDF 里一页都没有'); return; }
    const total = Math.min(n, PDF_MAX_PAGES);
    const side = pdfRenderSide(total);
    const srcs = [];
    for (let i = 1; i <= total; i++) {
      pbProgress(i, total, '正在渲染 PDF');
      let page = null;
      try {
        page = await doc.getPage(i);
        const s = await renderPdfPage(page, side);
        if (s) srcs.push(s);
      } catch (e) {
        console.error('[pdf] 第 ' + i + ' 页出错：', e);
      } finally {
        if (page && page.cleanup) { try { page.cleanup(); } catch (_) {} }
      }
      await new Promise(r => setTimeout(r, 0));            // 让出一帧，进度数字才画得出来
    }
    if (!srcs.length) { toast('这个 PDF 一页都没渲出来，换个文件试试'); return; }
    const j = await fitPhotoPages(makePhotoBook(srcs, pdfBookName(file)));
    const skipped = total - srcs.length;
    await pbDeliver(j, (n > PDF_MAX_PAGES ? ` · 只取前 ${PDF_MAX_PAGES} 页` : '')
      + (skipped > 0 ? ` · ${skipped} 页没渲出来已跳过` : ''));
  } catch (e) {
    console.error('[pdf] 导入失败：', e);
    toast('PDF 导入失败：' + ((e && e.message) || e), 4200);
  } finally {
    pbHideProgress();
    pbBusy = false;
    if (doc && doc.destroy) { try { await doc.destroy(); } catch (_) {} }
  }
}
function pickBookPDF() {
  if (pbBusy) return;
  const inp = document.createElement('input');
  inp.type = 'file'; inp.accept = 'application/pdf,.pdf';
  inp.style.display = 'none';
  document.body.appendChild(inp);
  const drop = () => { if (inp.parentNode) inp.remove(); };
  inp.addEventListener('cancel', drop);
  inp.onchange = () => {
    const f = inp.files && inp.files[0];
    drop();
    if (f) buildPdfBook(f);
  };
  inp.click();
}

/* ==================================================================
 * 跨页图：一张横图 → 左右两页
 * ------------------------------------------------------------------
 * 整张图先等比撑满「摊开的两页」那么大（多余的部分裁掉，不拉伸），
 * 再从正中竖着切一刀 —— 左半张进左页、右半张进右页。
 * 两半都是整页铺满，摊开来刚好接上，看上去就是一张图被书脊压在中间。
 * ⚠️ 是切成两张真图而不是加一个「跨页标记」：文库 / 导出 / 存档全按普通图片走，
 *    新加的功能不许给别的地方添分支（这是全项目的老规矩，见 README 开发约定）。
 * ================================================================== */
async function loadImageEl(src) {
  return new Promise((res, rej) => {
    const im = new Image();
    im.onload = () => res(im);
    im.onerror = () => rej(new Error('这张图读不出来'));
    im.src = src;
  });
}
/* 一张图 → [左半张, 右半张]（都是 JPEG dataURL） */
async function sliceSpread(src) {
  const im = await loadImageEl(src);
  const W = SPREAD_HALF_W, H = Math.round(SPREAD_HALF_W * PAGE_RATIO);
  const SW = W * 2, SH = H;
  const full = document.createElement('canvas');
  full.width = SW; full.height = SH;
  const g = full.getContext('2d');
  if (!g) throw new Error('画布开不出来');
  g.fillStyle = PB_JPEG_BG; g.fillRect(0, 0, SW, SH);
  /* cover：等比撑到两页都填满为止（裁掉多出来的），多余的居中抹平 —— 不会被拉扁 */
  const k = Math.max(SW / (im.naturalWidth || 1), SH / (im.naturalHeight || 1));
  const dw = im.naturalWidth * k, dh = im.naturalHeight * k;
  g.drawImage(im, (SW - dw) / 2, (SH - dh) / 2, dw, dh);
  const cut = n => {
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const cg = c.getContext('2d');
    cg.drawImage(full, -n * W, 0);
    const s = c.toDataURL('image/jpeg', PB_JPEG_Q);
    c.width = c.height = 0;
    return s;
  };
  const out = [cut(0), cut(1)];
  full.width = full.height = 0;
  return { left: out[0], right: out[1], wide: (im.naturalWidth || 1) / (im.naturalHeight || 1) };
}
/* 跨页图插在哪儿：落在参考页所在跨页的「后面」那个跨页，起点永远是偶数页
   —— 左页只能在偶数下标上，不然摊开时是新页（左）配别人的页（右），看着是错页 */
function spreadInsertIndex(refPid) {
  const j = cur(); if (!j) return -1;
  const n = j.pages.length;
  if (!n) return 0;
  if (state.mode === 'spread' && isCoverView()) return 0;         // 停在封面 → 插到最前面
  const p = clamp(Number.isFinite(+refPid) ? +refPid : 0, 0, n - 1);
  /* 起点必须是偶数 + 两页要连着，这两个条件一起把落点夹住：
     参考的那个跨页已经走到最后时（比如全书只有奇数页），就从前一跨页的开头下手，
     落点始终 <= 页数，绝不会插出一个「跨搭配对」 */
  const maxEven = n % 2 === 0 ? n : n - 1;
  return clamp(Math.min((p - (p % 2)) + 2, maxEven), 0, n);
}
/* 选一张横图 → 裁左右两页 → 插进去 → 跳到那一跨页 */
async function addSpreadImage(file, refPid) {
  if (pbBusy || !file) return;
  const j = cur(); if (!j) return;
  if (j.pages.length + 2 > PB_MAX_PAGES) {
    toast(`这本已经有 ${j.pages.length} 页，再加就翻不动了`);
    return;
  }
  pbBusy = true;
  pbProgress(0, 1, '正在处理跨页图');
  try {
    const src = await readFileDataURL(file);
    if (!src) { toast('这张图读不出来，换一张试试'); return; }
    const pic = await sliceSpread(src);
    const at = spreadInsertIndex(refPid);
    if (at < 0) return;
    const pgs = [mkPhotoPage(pic.left), mkPhotoPage(pic.right)];
    /* 只给这两张算「铺满」的几何（fitPhotoPages 会把全书扫一遍，几百页的册子为加一张图白等几秒）。
       两半本来就是纸的比例，算完是满页 1×1；走这一趟是因为 fit / fill 的标记由 applyFillGeom 统一下发，
       导出与重绘两边才不会因为缺了标记各算一套 */
    await Promise.all(pgs.map(p => applyFillGeom(p.images[0])));
    j.pages.splice(at, 0, pgs[0], pgs[1]);
    save();
    const last = Math.max(j.pages.length - 1, 0);
    if (state.mode === 'spread') state.spread = clamp(Math.floor(at / 2), 0, Math.max(Math.ceil(j.pages.length / 2) - 1, 0));
    else state.page = clamp(at, 0, last);
    if (typeof addPageIdx !== 'undefined') addPageIdx = clamp(at, 0, last);
    renderReader(); renderHome();
    toast(pic.wide < 1.25
      ? `已铺成第 ${at + 1}–${at + 2} 页 · 这张图不够宽，已按整幅裁出中间一条`
      : `已铺成第 ${at + 1}–${at + 2} 页 · 双页摊开就是一张图`, 3200);
  } catch (e) {
    console.error('[spread] 失败：', e);
    toast('跨页图没做成：' + ((e && e.message) || e), 4200);
  } finally {
    pbHideProgress();
    pbBusy = false;
  }
}
function pickSpreadImage(refPid) {
  if (pbBusy) return;
  const inp = document.createElement('input');
  inp.type = 'file'; inp.accept = 'image/*';
  inp.style.display = 'none';
  document.body.appendChild(inp);
  const drop = () => { if (inp.parentNode) inp.remove(); };
  inp.addEventListener('cancel', drop);
  inp.onchange = () => {
    const f = inp.files && inp.files[0];
    drop();
    if (f) addSpreadImage(f, refPid);
  };
  inp.click();
}
