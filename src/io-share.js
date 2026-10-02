/* =====================================================================
 * Carnet · 导出 · 多选批量导出   （脚本 6 / 24）
 * ---------------------------------------------------------------------
 * ① buildExportFile：造出一本要导出的文件（格式与单本导出一致，但不碰文件系统）
 * ② exportMany / exportPicked：书架多选后一本一个文件
 * ③ 可写时用 showDirectoryPicker 只问一次文件夹，否则逐个下载
 *
 * 对外接口：buildExportFile, exportMany, exportPicked
 *
 * 依赖模块：core, io-export, io-doc
 *
 * 说明：模块间共用全局作用域，加载顺序即依赖顺序（见 index.html 与 README）。
 * ===================================================================== */
/* ==================== 多选导出：一本一个文件 ==================== */
/* 造出一本要导出的文件：格式跟单本导出完全一致（源文件仍是单本那套带 checksum 的结构），
   只是不碰文件系统，交给外面决定「写到哪」 */
async function buildExportFile(j, kind) {
  if (kind !== 'json') await probeExportFont();    // 渲染前先探明手写体导不导得出，不行就按楷体
  if (kind === 'json') {
    const sum = await checksum(stableStringify(j));
    const text = JSON.stringify({
      app: EXPORT_TAG, version: EXPORT_VERSION, exportedAt: Date.now(), checksum: sum, journal: j
    });
    return {
      name: exportBaseName(j) + '.json', mime: 'application/json',
      blob: new Blob([text], { type: 'application/json' })
    };
  }
  if (kind === 'svg') {
    const pages = exportPages(j);
    const W = EX_W, H = Math.round(W * PAGE_RATIO);
    const body = pages.map((idx, i) =>
      `<foreignObject x="0" y="${i * H}" width="${W}" height="${H}">`
      + pageExportXHTML(j, idx, W, H) + `</foreignObject>`).join('');
    const total = H * pages.length;
    const svg = '<?xml version="1.0" encoding="UTF-8"?>\n'
      + `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${total}" viewBox="0 0 ${W} ${total}">`
      + `<rect width="${W}" height="${total}" fill="#fffdf8"/>` + body + `</svg>`;
    return {
      name: exportBaseName(j) + '.svg', mime: 'image/svg+xml',
      blob: new Blob([svg], { type: 'image/svg+xml;charset=utf-8' })
    };
  }
  /* pdf */
  const pages = exportPages(j);
  const CW = EX_W, CH = Math.round(EX_W * PAGE_RATIO);
  const jpegs = [];
  for (let i = 0; i < pages.length; i++) {
    const c = await renderExportCanvas(j, pages[i], CW);
    const b = await canvasBytes(c, 0.9);
    jpegs.push({ w: CW, h: CH, data: new Uint8Array(await b.arrayBuffer()) });
  }
  const bytes = buildPdf(jpegs, 595, +(595 * PAGE_RATIO).toFixed(2));
  return {
    name: exportBaseName(j) + '.pdf', mime: 'application/pdf',
    blob: new Blob([bytes], { type: 'application/pdf' })
  };
}
/* 勾了几本就出几个文件。能选文件夹就只问一次（选完一次性全写进去），
   浏览器不支持选文件夹时退回逐个下载 */
async function exportMany(list, kind) {
  const total = list.length;
  let dir = null, wrote = 0, failed = 0;
  if (window.showDirectoryPicker) {
    toast('选一个文件夹，这 ' + total + ' 本手帐都会存进去');
    try {
      dir = await window.showDirectoryPicker({ mode: 'readwrite' });
    } catch (e) {
      if (e && e.name === 'AbortError') { toast('已取消导出'); return; }
      dir = null;                                  // 不给写 / 不支持，走下载
    }
  }
  for (let n = 0; n < total; n++) {
    const j = list[n];
    toast(`正在导出 ${n + 1} / ${total}：《${j.name}》`);
    try {
      const f = await buildExportFile(j, kind);
      if (dir) {
        const fh = await dir.getFileHandle(f.name, { create: true });
        const w = await fh.createWritable();
        await w.write(f.blob);
        await w.close();
      } else {
        downloadBlob(f.name, f.blob);
      }
      wrote++;
    } catch (e) {
      failed++;
      console.error('[export many] 《' + j.name + '》失败：', e);
      toast(`《${j.name}》导出失败：${(e && e.message) || e}`, 3600);
    }
  }
  if (!wrote) return;
  toast(dir
    ? `已导出 ${wrote} 本手帐到你选的文件夹`
    : `已导出 ${wrote} 本手帐，每本一个文件`, 3200);
  if (failed) toast(`有 ${failed} 本没能导出，可以再来一次`, 3600);
}
async function exportPicked(kind) {
  const list = pickedList();
  if (!list.length) { toast('还没有勾选要导出的手帐本'); return; }
  if (list.length === 1) {
    /* 只勾了一本就走原来的老路：「另存为」/ 系统分享 / 下载，手感完全一致 */
    const j = list[0];
    if (kind === 'json') await exportJournal(j);
    else if (kind === 'pdf') await exportJournalPDF(j);
    else await exportJournalSVG(j);
  } else {
    await exportMany(list, kind);
  }
  exitPickMode();
}
