/* =====================================================================
 * Carnet · 导出 · PDF 与 SVG 矢量   （脚本 5 / 23）
 * ---------------------------------------------------------------------
 * ① 把每一页渲染成 XHTML（PDF/长图/SVG 共用一页的实现）
 * ② 纯前端拼 PDF：JPEG 转字节流、写 PDF 对象表 buildPdf
 * ③ 竖向拼接 foreignObject 生成 SVG 矢量长图
 *
 * 依赖模块：core, visuals
 *
 * 说明：模块间共用全局作用域，按下面的顺序加载，顺序即依赖顺序。
 * ===================================================================== */
/* ==================== 导出 PDF / 长图（纯前端生成，无外部依赖） ==================== */
const EX_W = 900;                       // 导出页面的像素宽（PDF 与长图共用）
function exportPages(j) { return [-1].concat(j.pages.map((_, i) => i)); }      // -1 = 封面
/* 把一页画成 canvas：页面结构按应用的真实渲染规则重排成 XHTML，
   塞进 SVG foreignObject 交给浏览器栅格化 —— 图片 / 文字位置、模板纹理都和屏幕上一样 */
function pageExportHTML(j, idx, W, H) {
  const k = W / 340;                    // 模板纹理的 px 尺寸按页宽等比缩放（应用里页面约 340px 宽）
  if (idx === -1) {
    const cv = j.cover || {};
    const rb = j.ribbon || '#c98a8a';
    const bg = cv.img ? `background-image:url('${cv.img}');background-size:cover;background-position:center;` : `background:${cv.value || '#ddd'};`;
    const pat = (cv.pattern && cv.pattern !== 'none') ? patternStyle(cv.pattern, cv) : '';
    return `<div style="position:relative;width:${W}px;height:${H}px;overflow:hidden;${bg}">`
      + `<div style="position:absolute;inset:0;${pat}"></div>`
      + `<div style="position:absolute;inset:0;background:linear-gradient(112deg,rgba(255,255,255,.28) 0%,rgba(255,255,255,0) 34%,rgba(255,255,255,0) 68%,rgba(255,255,255,.12) 100%)"></div>`
      + `<div style="position:absolute;left:0;top:0;bottom:0;width:8.5%;background:linear-gradient(90deg,${shade(rb, -22)},${rb} 55%,${shade(rb, 14)})"></div>`
      + `<div style="position:absolute;right:0;top:2%;bottom:2%;width:2.5%;background:linear-gradient(90deg,rgba(0,0,0,.06),rgba(255,255,255,.5))"></div>`
      + `</div>`;
  }
  const pg = j.pages[idx] || { images: [], texts: [] };
  const kraft = (j.template === 'kraft' || j.template === 'kraftplain');
  const bg = kraft ? 'background:linear-gradient(160deg,#ecdec4,#e0cfae);' : 'background:#fffdf8;';
  const tpl = String(tplStyle(j.template) || '').replace(/(\d+(?:\.\d+)?)px/g, (m, n) => (n * k).toFixed(2) + 'px');
  const lined = j.template === 'lined' ? `<div style="position:absolute;left:${(34 * k).toFixed(1)}px;top:0;bottom:0;width:1px;background:#eab7c2;opacity:.8"></div>` : '';
  const imgs = (pg.images || []).map(im => {
    const hw = im.h || clamp(im.w / 0.68, .04, IMG_MAX);
    const fit = im.fill ? 'object-fit:cover;border-radius:0;' : 'object-fit:fill;';
    return `<img src="${im.src}" style="position:absolute;left:${(im.x * 100).toFixed(2)}%;top:${(im.y * 100).toFixed(2)}%;width:${(im.w * 100).toFixed(2)}%;height:${(hw * 100).toFixed(2)}%;${fit}" />`;
  }).join('');
  const txts = (pg.texts || []).map(t => {
    const fs = (t.size || 5.5) / 100 * W;
    const inner = `width:100%;height:100%;overflow:hidden;font-size:${fs.toFixed(2)}px;color:${t.color || '#2b2f3d'};text-align:${t.align || 'left'};${t.bold ? 'font-weight:700;' : ''}line-height:1.32;white-space:pre-wrap;word-break:break-word;`;
    return `<div style="position:absolute;left:${((t.x ?? .16) * 100).toFixed(2)}%;top:${((t.y ?? .16) * 100).toFixed(2)}%;width:${((t.w ?? .56) * 100).toFixed(2)}%;height:${((t.h ?? .12) * 100).toFixed(2)}%"><div style="${inner}">${esc(t.text || '')}</div></div>`;
  }).join('');
  return `<div style="position:relative;width:${W}px;height:${H}px;overflow:hidden;${bg}">`
    + `<div style="position:absolute;inset:0;${tpl}"></div>${lined}`
    + `<div style="position:absolute;inset:0">${imgs}${txts}</div>`
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
  const H = Math.round(W * 4.05 / 3);
  const root = pageExportXHTML(j, idx, W, H);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><foreignObject width="100%" height="100%">${root}</foreignObject></svg>`;
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
  const pages = exportPages(j);
  const name = exportBaseName(j) + '.pdf';
  toast(`正在准备导出…（含封面共 ${pages.length} 页）`);
  const target = await pickExportTarget(name, 'PDF 文件', '.pdf', 'application/pdf');
  if (target === 'cancel') { toast('已取消导出'); return; }
  try {
    const CW = EX_W, CH = Math.round(EX_W * 4.05 / 3);
    const jpegs = [];
    for (let i = 0; i < pages.length; i++) {
      toast(`正在生成 PDF… ${i + 1} / ${pages.length}`);
      const c = await renderExportCanvas(j, pages[i], CW);
      const blob = await canvasBytes(c, 0.9);
      jpegs.push({ w: CW, h: CH, data: new Uint8Array(await blob.arrayBuffer()) });
    }
    const bytes = buildPdf(jpegs, 595, +(595 * 4.05 / 3).toFixed(2));
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
  const pages = exportPages(j);
  const name = exportBaseName(j) + '.svg';
  toast(`正在准备导出…（含封面共 ${pages.length} 页）`);
  const target = await pickExportTarget(name, 'SVG 文件', '.svg', 'image/svg+xml');
  if (target === 'cancel') { toast('已取消导出'); return; }
  try {
    const W = EX_W;
    const H = Math.round(W * 4.05 / 3);
    const totalH = H * pages.length;
    const body = pages.map((idx, i) =>
      `<foreignObject x="0" y="${i * H}" width="${W}" height="${H}">`
      + pageExportXHTML(j, idx, W, H) + `</foreignObject>`
    ).join('');
    const svg = '<?xml version="1.0" encoding="UTF-8"?>\n'
      + `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${totalH}" viewBox="0 0 ${W} ${totalH}">`
      + `<rect width="${W}" height="${totalH}" fill="#fffdf8"/>` + body + `</svg>`;
    const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
    await deliverBlob(target, name, blob, 'image/svg+xml', `已导出《${j.name}》SVG · ${pages.length} 页`);
  } catch (e) {
    console.error('[export svg] 失败：', e);
    toast('导出 SVG 失败：' + ((e && e.message) || e), 4200);
  }
}

