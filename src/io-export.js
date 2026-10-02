/* =====================================================================
 * Carnet · 导出 · 单本序列化与落盘   （脚本 4 / 24）
 * ---------------------------------------------------------------------
 * ① 稳定序列化 stableStringify / 内容摘要 checksum / 资产计数 countAssets
 * ② 导出文件名 exportName、保存位置选择 pickSaveTarget
 * ③ deliverBlob「另存为 / 系统分享 / 下载」与 downloadBlob、exportJournal
 *
 * 对外接口：stableStringify, checksum, exportName, downloadBlob, deliverBlob, exportJournal
 *
 * 依赖模块：core, storage
 *
 * 说明：模块间共用全局作用域，加载顺序即依赖顺序（见 index.html 与 README）。
 * ===================================================================== */
/* ==================== 导出 / 导入 ==================== */
const EXPORT_TAG = 'carnet';
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
function exportBaseName(j) {
  const n = String((j && j.name) || '手帐本').replace(/[\\/:*?"<>|\n\r\t]/g, '_').trim();
  return n || '手帐本';
}
/* 导出文件名：只用「手帐本名.json」，不再夹 .journal 这一段 */
function exportName(j) { return exportBaseName(j) + '.json'; }
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
/* PDF / 图片导出时让用户挑位置，文件类型说明跟着变 */
async function pickExportTarget(name, label, ext, mime) {
  if (!window.showSaveFilePicker) return null;
  const dot = String(ext).charAt(0) === '.' ? ext : '.' + ext;
  try {
    return await window.showSaveFilePicker({
      suggestedName: name,
      types: [{ description: label, accept: { [mime]: [dot] } }]
    });
  } catch (e) {
    return (e && e.name === 'AbortError') ? 'cancel' : null;
  }
}
/* 普通下载：造个隐藏 <a> 点一下。多个文件连续导出时也是走这条路 */
function downloadBlob(name, blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; a.style.display = 'none';
  document.body.appendChild(a); a.click();
  setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 4000);
}
/* 把导出的 Blob 交出去：优先写到用户刚选的位置，其次系统分享，最后普通下载 */
async function deliverBlob(target, name, blob, mime, okMsg) {
  const type = mime || blob.type || 'application/octet-stream';
  if (target) {
    try {
      const w = await target.createWritable();
      await w.write(blob);
      await w.close();
      toast(okMsg || ('已导出 ' + name + ' · 已存到你选择的位置'), 3000);
      return;
    } catch (e) {
      if (e && e.name === 'AbortError') { toast('已取消导出'); return; }
      console.warn('[export] 写文件失败，退回普通下载：', e);
    }
  }
  const file = new File([blob], name, { type });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: name });
      return;
    } catch (e) {
      if (e && e.name === 'AbortError') return;
      console.warn('[export] 分享失败，退回普通下载：', e);
    }
  }
  downloadBlob(name, blob);
  toast(okMsg || ('已导出 ' + name + ' · 已存到浏览器下载目录'), 3000);
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

