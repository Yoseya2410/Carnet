/* 从项目 store/ 目录生成 Backend/data/catalog.json（首次部署或批量上架时用）。 */
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..', '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'store', 'manifest.json'), 'utf8'));
const files = Array.isArray(manifest.files) ? manifest.files : [];
const catalog = [];

files.forEach((entry, i) => {
  if (typeof entry === 'string' && entry.trim()) {
    const file = entry.trim();
    const type = /\.lbl$/i.test(file) ? 'stickers' : 'journal';
    const folder = type === 'stickers' ? 'Sticker' : 'Template';
    const data = JSON.parse(fs.readFileSync(path.join(root, 'store', file), 'utf8'));
    const meta = data.store || {};
    const name = type === 'journal'
      ? (data.journal && data.journal.name || meta.code || meta.id)
      : (data.pack && data.pack.name || data.name || meta.code || meta.id);
    catalog.push({
      id: meta.id || path.basename(file).replace(/\.(json|lbl)$/i, ''),
      type,
      name,
      code: meta.code || 'CARNET',
      description: meta.description || '',
      sort_order: i + 1,
      status: 'published',
      resource: `${folder}/${path.basename(file)}`
    });
    return;
  }
  if (entry && entry.type === 'font' && entry.font) {
    const file = String(entry.file || '').replace(/^.*\//, '');
    const s = entry.store || {}, f = entry.font || {};
    catalog.push({
      id: s.id || f.k || file.replace(/\.woff2?$/i, ''),
      type: 'font',
      name: f.n || f.en || file,
      code: s.code || 'FONT',
      description: s.description || '',
      sort_order: i + 1,
      status: 'published',
      resource: `font/${file}`,
      font: {
        k: f.k, n: f.n, en: f.en, hint: f.hint,
        family: f.family, fallback: f.fallback,
        format: f.format || 'woff2', weight: f.weight || '400'
      }
    });
  }
});

const out = path.resolve(__dirname, '..', 'data', 'catalog.json');
fs.writeFileSync(out, JSON.stringify(catalog, null, 2) + '\n');
console.log('已生成 ' + out + '，商品数：' + catalog.length);
