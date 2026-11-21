/* Carnet · 商店字体库：下载字体持久化、FontFace 注册、文字面板与导出共用。 */
const FONT_LIB_KEY = 'carnet_font_lib';
const FONT_LIB_MAX = 20;

function fontFormatOf(f) {
  const v = String(f && f.format || '').toLowerCase();
  return ['woff', 'woff2'].includes(v) ? v : 'woff2';
}
function fontFaceSource(rec) { return `url("${rec.data}") format("${fontFormatOf(rec)}")`; }
async function fontDataFromUrl(url, format) {
  const r = await fetch(new URL(url, document.baseURI).href);
  if (!r.ok) throw new Error('font-http-' + r.status);
  const bytes = new Uint8Array(await r.arrayBuffer());
  if (!bytes.length || bytes.length > 8 * 1024 * 1024) throw new Error('font-size');
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000)
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  const fmt = fontFormatOf({ format });
  const mime = fmt === 'woff' ? 'font/woff' : 'font/woff2';
  return `data:${mime};base64,${btoa(bin)}`;
}
async function registerFontRecord(rec) {
  if (!rec || !rec.family || !rec.data) throw new Error('invalid-font');
  if (typeof FontFace === 'undefined' || !document.fonts) throw new Error('font-unsupported');
  const face = new FontFace(rec.family, fontFaceSource(rec), {
    style: 'normal', weight: rec.weight || '400'
  });
  await face.load();
  document.fonts.add(face);
  if (!EN_FONTS.some(f => f.k === rec.k)) {
    EN_FONTS.push({
      k: rec.k, n: rec.n || rec.en || rec.family, en: rec.en || rec.family,
      hint: rec.hint || rec.n || rec.family,
      css: `'${rec.family}'`, fallback: rec.fallback || '',
      face: { family: rec.family, data: rec.data, format: fontFormatOf(rec) }
    });
  }
  return rec;
}
async function loadFontLibrary() {
  const data = await DB.get(FONT_LIB_KEY);
  const list = Array.isArray(data) ? data : [];
  const loaded = [];
  for (const rec of list.slice(0, FONT_LIB_MAX)) {
    try { loaded.push(await registerFontRecord(rec)); }
    catch (e) { console.warn('[Carnet] 已下载字体加载失败：', rec && rec.k, e); }
  }
  return loaded;
}
async function installFontProduct(p) {
  const f = p && p.font;
  if (!f || !f.family) throw new Error('invalid-font-product');
  const old = await DB.get(FONT_LIB_KEY);
  const list = Array.isArray(old) ? old : [];
  if (list.some(x => x && x.storeId === p.id)) return { duplicate: true, list };
  if (list.length >= FONT_LIB_MAX) throw new Error('font-lib-full');
  if (!f.data && !f.url) throw new Error('font-source-missing');
  const data = f.data || await fontDataFromUrl(f.url, f.format);
  const rec = {
    storeId: p.id, k: String(f.k || p.id), n: String(f.n || f.family),
    en: String(f.en || f.family), hint: String(f.hint || f.n || f.family),
    family: String(f.family), fallback: String(f.fallback || ''),
    format: fontFormatOf(f), weight: String(f.weight || '400'), data, at: Date.now()
  };
  /* 先注册，确认字体文件可用；再落盘，避免商店显示成功但下次启动加载不了。 */
  await registerFontRecord(rec);
  const ok = await DB.set(FONT_LIB_KEY, list.concat(rec));
  if (!ok) throw new Error('font-storage');
  return { duplicate: false, record: rec, list: list.concat(rec) };
}
