/* =====================================================================
 * Carnet 商店后端（零第三方依赖，Node 18+ 直接运行）
 * - GET  /api/products   商品目录（按 catalog.json 实时展开资源文件）
 * - GET  /api/events     SSE 热更新推送，资源/目录变化前端自动刷新
 * - GET  /store/<类型>/<文件>   三类资源静态读取
 * - POST /api/upload?type=Template|Sticker|font&name=xxx   热上传资源
 * - POST /api/catalog    热更新商品目录 JSON
 * 写接口需要 header: x-admin-token
 * ===================================================================== */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const config = require('./config');

const TYPES = ['Template', 'Sticker', 'font'];
const MIME = {
  '.json': 'application/json; charset=utf-8',
  '.lbl': 'application/json; charset=utf-8',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8'
};
const catalogPath = path.join(config.dataDir, 'catalog.json');
const sseClients = new Set();

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': config.corsOrigin,
    'Access-Control-Allow-Headers': 'Content-Type, x-admin-token',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Expose-Headers': 'Content-Type'
  };
}
function send(res, code, body, extra) {
  const headers = Object.assign({ 'Cache-Control': 'no-store' }, corsHeaders(), extra || {});
  if (body && typeof body === 'object') {
    const payload = JSON.stringify(body);
    res.writeHead(code, Object.assign({ 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(payload) }, headers));
    res.end(payload);
  } else {
    res.writeHead(code, headers);
    res.end(body == null ? '' : String(body));
  }
}
function ok(res, data) { send(res, 200, data); }
function fail(res, code, error, message) { send(res, code, { error, message }); }
function safeName(name) {
  return typeof name === 'string' && name !== '..' && !name.includes('..') && /^[A-Za-z0-9._-]+$/.test(name);
}
function resolveAsset(type, name) {
  if (!TYPES.includes(type) || !safeName(name)) return null;
  const dir = path.join(config.dataDir, type);
  const file = path.join(dir, name);
  return file.startsWith(dir + path.sep) ? file : null;
}
function baseUrl(req) {
  return config.publicBaseUrl || `http://${req.headers.host || `127.0.0.1:${config.port}`}`;
}
function readCatalog() {
  const raw = fs.readFileSync(catalogPath, 'utf8');
  const data = JSON.parse(raw);
  return Array.isArray(data) ? data : (data && Array.isArray(data.products) ? data.products : []);
}
function catalogUpdatedAt() {
  try { return new Date(fs.statSync(catalogPath).mtimeMs).toISOString(); }
  catch (_) { return new Date(0).toISOString(); }
}
function folderOf(type) {
  return type === 'journal' ? 'Template' : type === 'stickers' ? 'Sticker' : type === 'font' ? 'font' : null;
}
function expand(entry, base) {
  const type = String(entry.type || '');
  const out = {
    id: String(entry.id || ''),
    type,
    code: String(entry.code || 'CARNET'),
    description: String(entry.description || '')
  };
  if (entry.name) out.name = String(entry.name);
  if (typeof entry.sort_order === 'number') out.sort_order = entry.sort_order;
  if (type === 'journal' || type === 'stickers') {
    const key = type === 'journal' ? 'journal' : 'pack';
    let value = entry.payload && entry.payload[key];
    if (entry.resource) {
      const file = resolveAsset(folderOf(type), path.basename(String(entry.resource)));
      if (file) {
        const data = JSON.parse(fs.readFileSync(file, 'utf8'));
        value = type === 'journal'
          ? (data.journal || (data.app === 'carnet' ? data : null))
          : (data.pack || (data.app === 'carnet-stickers' ? data : null));
      }
    }
    if (value) out[key] = value;
  } else if (type === 'font') {
    const font = Object.assign({}, entry.font || (entry.payload && entry.payload.font) || {});
    if (entry.resource) {
      font.url = `${base}/store/font/${encodeURIComponent(path.basename(String(entry.resource)))}`;
    } else if (font.url && !/^https?:\/\//i.test(font.url)) {
      font.url = new URL(font.url, base + '/').href;
    }
    out.font = font;
  }
  return out;
}
function allProducts(req) {
  return readCatalog()
    .map((entry, i) => ({ entry, i }))
    .filter(({ entry }) => entry && entry.id && (!entry.status || entry.status === 'published'))
    .sort((a, b) => (Number(a.entry.sort_order) || a.i + 1) - (Number(b.entry.sort_order) || b.i + 1))
    .map(({ entry }) => expand(entry, baseUrl(req)))
    .filter(p => p.id && (p.journal || p.pack || p.font));
}
function broadcast() {
  const message = `event: products\ndata: {"type":"products","at":${Date.now()}}\n\n`;
  for (const res of sseClients) {
    try { res.write(message); }
    catch (_) { sseClients.delete(res); }
  }
}
function readBody(req, limit, cb) {
  let size = 0, done = false;
  const chunks = [];
  req.on('data', chunk => {
    if (done) return;
    size += chunk.length;
    if (size > limit) {
      done = true;
      cb(new Error('too-large'));
      req.destroy();
      return;
    }
    chunks.push(chunk);
  });
  req.on('end', () => { if (!done) cb(null, Buffer.concat(chunks)); });
  req.on('error', e => { if (!done) { done = true; cb(e); } });
}
function requireAdmin(req, res) {
  if (config.adminToken && req.headers['x-admin-token'] !== config.adminToken) {
    fail(res, 401, 'unauthorized');
    return false;
  }
  return true;
}
function fileTag(file) {
  try { const st = fs.statSync(file); return `${st.mtimeMs}:${st.size}`; }
  catch (_) { return 'missing'; }
}
function signature() {
  const parts = [fileTag(catalogPath)];
  for (const type of TYPES) {
    const dir = path.join(config.dataDir, type);
    let names = [];
    try { names = fs.readdirSync(dir); } catch (_) {}
    for (const name of names.sort()) parts.push(`${type}/${name}:${fileTag(path.join(dir, name))}`);
  }
  return parts.join('|');
}
let lastSignature = '';
try { lastSignature = signature(); } catch (_) {}
function markSynced() {
  try { lastSignature = signature(); } catch (_) {}
}
setInterval(() => {
  try {
    const now = signature();
    if (now !== lastSignature) {
      lastSignature = now;
      broadcast();
      console.log('[watch] 目录或资源变更，已通知前端刷新');
    }
  } catch (_) {}
}, config.watchInterval).unref();

const server = http.createServer((req, res) => {
  let pathname;
  try { pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); }
  catch (_) { return fail(res, 400, 'bad-url'); }

  if (req.method === 'OPTIONS') { res.writeHead(204, corsHeaders()); return res.end(); }

  if (pathname === '/api/health') {
    try { return ok(res, { ok: true, products: allProducts(req).length, updatedAt: catalogUpdatedAt() }); }
    catch (e) { return fail(res, 500, 'catalog-failed', String(e.message || e)); }
  }
  if (pathname === '/api/products') {
    try {
      const list = allProducts(req);
      return ok(res, { updatedAt: catalogUpdatedAt(), count: list.length, products: list });
    } catch (e) { return fail(res, 500, 'catalog-failed', String(e.message || e)); }
  }
  if (pathname === '/api/events') {
    res.writeHead(200, Object.assign({
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive'
    }, corsHeaders()));
    res.write(': connected\n\n');
    sseClients.add(res);
    const timer = setInterval(() => { try { res.write(': ping\n\n'); } catch (_) {} }, 25000);
    req.on('close', () => { clearInterval(timer); sseClients.delete(res); });
    return;
  }
  if (pathname === '/api/catalog') {
    if (req.method === 'GET') {
      try { return ok(res, { updatedAt: catalogUpdatedAt(), products: readCatalog() }); }
      catch (e) { return fail(res, 500, 'catalog-failed', String(e.message || e)); }
    }
    if (req.method === 'POST') {
      if (!requireAdmin(req, res)) return;
      return readBody(req, config.maxUploadBytes, (err, buf) => {
        if (err) return fail(res, 413, 'too-large');
        let data;
        try { data = JSON.parse(buf.toString('utf8')); }
        catch (_) { return fail(res, 400, 'invalid-json'); }
        const list = Array.isArray(data) ? data : (data && Array.isArray(data.products) ? data.products : null);
        if (!list || !list.every(x => x && x.id && x.type)) return fail(res, 400, 'invalid-catalog');
        try {
          const tmp = catalogPath + '.tmp';
          fs.writeFileSync(tmp, JSON.stringify(list, null, 2) + '\n');
          fs.renameSync(tmp, catalogPath);
          markSynced();
          broadcast();
          return ok(res, { ok: true, count: list.length, updatedAt: catalogUpdatedAt() });
        } catch (e) { return fail(res, 500, 'write-failed', String(e.message || e)); }
      });
    }
  }
  if (pathname === '/api/upload' && req.method === 'POST') {
    if (!requireAdmin(req, res)) return;
    const query = new URL(req.url, 'http://localhost').searchParams;
    const type = query.get('type'), name = query.get('name');
    const file = resolveAsset(type, name);
    if (!file) return fail(res, 400, 'bad-type-or-name');
    return readBody(req, config.maxUploadBytes, (err, buf) => {
      if (err) return fail(res, 413, 'too-large');
      try {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        const tmp = file + '.tmp';
        fs.writeFileSync(tmp, buf);
        fs.renameSync(tmp, file);
        markSynced();
        broadcast();
        return ok(res, { ok: true, path: `/store/${type}/${name}`, bytes: buf.length });
      } catch (e) { return fail(res, 500, 'write-failed', String(e.message || e)); }
    });
  }

  const asset = /^\/store\/([^/]+)\/([^/]+)$/.exec(pathname);
  if (asset && req.method === 'GET') {
    const file = resolveAsset(asset[1], asset[2]);
    if (!file || !fs.existsSync(file) || !fs.statSync(file).isFile()) return fail(res, 404, 'not-found');
    const headers = Object.assign({
      'Content-Type': MIME[path.extname(asset[2]).toLowerCase()] || 'application/octet-stream',
      'Content-Length': fs.statSync(file).size,
      'Cache-Control': 'no-store'
    }, corsHeaders());
    res.writeHead(200, headers);
    return fs.createReadStream(file).pipe(res);
  }

  return fail(res, 404, 'not-found');
});

server.listen(config.port, config.host, () => {
  const shown = config.publicBaseUrl || `http://127.0.0.1:${config.port}`;
  console.log('[Carnet Store] 已启动：' + shown);
  console.log('[Carnet Store] 商品接口：' + shown + '/api/products');
  console.log('[Carnet Store] 热更新事件：' + shown + '/api/events');
  console.log('[Carnet Store] 数据目录：' + config.dataDir);
  if (!config.adminToken || config.adminToken === 'change-me')
    console.warn('[Carnet Store] 警告：ADMIN_TOKEN 仍是默认值 change-me，上线前请修改！');
});
