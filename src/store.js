/* Carnet · 商店：云端/本地商品、三类素材、3D 预览与对应素材库导入。 */
(function () {
  'use strict';
  let products = [], activeType = 'journal';
  const grid = document.getElementById('storeGrid');
  const message = document.getElementById('storeMessage');
  const source = document.getElementById('storeSource');
  const detail = document.getElementById('storeDetail');
  const closeBtn = document.getElementById('detailClose');
  const book3d = document.getElementById('book3d');
  const stage = document.getElementById('bookStage');
  const assetPreview = document.getElementById('assetPreview');
  const previewTools = document.querySelector('.preview-tools');
  const downloadBtn = document.getElementById('downloadBtn');
  const downloadText = downloadBtn.querySelector('span');
  const status = document.getElementById('downloadStatus');
  const openShelf = document.getElementById('openShelf');
  const removeBtn = document.getElementById('removeFontBtn');
  const installed = new Set(), previewFonts = new Set();
  let active = null, lastTrigger = null, saving = false, closeTimer = 0;

  /* 手账本按装帧分成四个板块，顺序与新建本里的 BOOK_STYLES 一致。 */
  const BOOK_GROUPS = [
    { k: 'hardcover', label: '精装书' },
    { k: 'square', label: '画册' },
    { k: 'personal', label: '活页手账' },
    { k: 'classic', label: '笔记本' }
  ];

  function productName(p) {
    return p.type === 'journal' ? p.journal.name
      : p.type === 'stickers' ? p.pack.name : p.font.n;
  }
  function tr(key, ...args) {
    let out = window.CarnetI18n && CarnetI18n.t ? CarnetI18n.t(key) : key;
    args.forEach((v, i) => { out = out.split('{' + i + '}').join(String(v)); });
    return out;
  }
  function normalizeProduct(raw, fallbackId) {
    if (!raw || typeof raw !== 'object') return null;
    const meta = raw.store && typeof raw.store === 'object' ? raw.store : raw;
    const type = raw.type || (raw.journal ? 'journal' : raw.pack || raw.app === 'carnet-stickers' ? 'stickers' : raw.font ? 'font' : '');
    const id = String(meta.id || fallbackId || '');
    const pack = raw.pack || (type === 'stickers' ? raw : null);
    if (!id || !['journal', 'stickers', 'font'].includes(type)) return null;
    if (type === 'journal' && (!raw.journal || !Array.isArray(raw.journal.pages))) return null;
    if (type === 'stickers' && (!pack || !Array.isArray(pack.stickers))) return null;
    if (type === 'font' && (!raw.font || !/^[A-Za-z0-9 _-]+$/.test(String(raw.font.family || '')))) return null;
    return {
      id, type,
      code: String(meta.code || 'CARNET'),
      description: String(meta.description || ''),
      ...(type === 'journal' ? { journal: raw.journal } : type === 'stickers' ? { pack } : { font: raw.font })
    };
  }
  /* 本地兜底与手动上架：资源按类型放 store/Template、store/Sticker、store/font，清单里登记相对 store 的路径。 */
  async function loadLocalProducts() {
    const res = await fetch('store/manifest.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error('manifest-' + res.status);
    const manifest = await res.json();
    const files = Array.isArray(manifest.files) ? manifest.files : [];
    const list = await Promise.all(files.map(async entry => {
      /* 字体直接登记 WOFF/WOFF2 文件，不再需要一个额外的字体 JSON 商品文件。 */
      if (entry && typeof entry === 'object' && entry.type === 'font' && entry.font) {
        const file = String(entry.file || '').trim();
        return normalizeProduct({
          ...entry,
          font: { ...entry.font, url: entry.font.url || (file ? encodeURI('store/' + file) : '') }
        }, file.replace(/^.*\//, '').replace(/\.(woff2?|json)$/i, ''));
      }
      const file = entry;
      if (typeof file !== 'string' || !file.trim()) return null;
      try {
        const r = await fetch(encodeURI('store/' + file.trim()), { cache: 'no-cache' });
        if (!r.ok) throw new Error(String(r.status));
        return normalizeProduct(await r.json(), file.replace(/^.*\//, '').replace(/\.(json|lbl)$/i, ''));
      } catch (e) {
        console.warn('[store] 商品文件未能读取：' + file, e);
        return null;
      }
    }));
    return list.filter(Boolean);
  }
  function remoteToProducts(remote) {
    return remote.map((p, i) => normalizeProduct(p, p.id || ('cloud-' + i))).filter(Boolean);
  }
  async function loadCatalog() {
    if (window.CarnetStoreCloud) {
      try {
        const valid = remoteToProducts(await window.CarnetStoreCloud.loadProducts());
        if (valid.length) { source.textContent = '云端已同步'; return valid; }
      } catch (e) {
        console.warn('[store] 云端商品暂时不可用：', e);
        if (window.CarnetStoreCloud.strictRemote) throw e;
      }
    }
    source.textContent = window.CarnetStoreCloud ? '云端离线 · 本地商品' : '本地商品';
    return loadLocalProducts();
  }
  /* 后端推送目录/资源变更时重新拉商品并原地重绘，不刷新页面。 */
  function subscribeHotUpdate() {
    if (!window.CarnetStoreCloud || !window.CarnetStoreCloud.subscribe) return;
    window.CarnetStoreCloud.subscribe(async () => {
      try {
        const valid = remoteToProducts(await window.CarnetStoreCloud.loadProducts());
        products = valid;
        source.textContent = '云端已同步';
        renderGrid();
        products.filter(p => p.type === 'font').forEach(registerFontPreview);
        console.info('[store] 已热更新云端商品');
      } catch (e) {
        console.warn('[store] 热更新拉取失败：', e);
      }
    });
  }
  /* 笔记本吃彩带色；其它装帧吃封面底色，与单层书架的 ribbon 规则同源。 */
  function spineStyle(j) {
    const base = bookHasRibbon(j) && !ribbonIsNone(j.ribbon)
      ? j.ribbon : (j.cover && j.cover.value ? j.cover.value : '#8a8a8a');
    return `background:linear-gradient(90deg,rgba(0,0,0,.28),rgba(255,255,255,.20) 48%,rgba(0,0,0,.22)),${base};`;
  }
  function metaOf(p) {
    if (p.type === 'journal') return `${p.journal.pages.length} 页 · ${bookStyleOf(p.journal).n}`;
    if (p.type === 'stickers') return `${p.pack.stickers.length} 张贴纸`;
    return '英文字体';
  }
  function stickerImages(p, detailView) {
    return p.pack.stickers.slice(0, detailView ? 240 : 4).map(s =>
      `<img src="${esc(s.src)}" alt="${esc(s.n || '')}" loading="lazy">`).join('');
  }
  function cardPreview(p) {
    if (p.type === 'journal') return coverHTML(p.journal);
    if (p.type === 'stickers') return `<span class="sticker-card-grid">${stickerImages(p, false)}</span>`;
    return `<span class="font-card-sample" style="font-family:'${p.font.family}'">Aa</span><span class="font-card-word">Carnet</span>`;
  }
  function cardHTML(p) {
    const i = products.indexOf(p);
    return `<button class="store-card asset-${p.type}${installed.has(p.id) ? ' installed' : ''}" type="button" data-store-id="${esc(p.id)}" aria-label="查看${esc(productName(p))}">
      <span class="store-card-preview" aria-hidden="true">${cardPreview(p)}</span>
      <span class="store-card-added">已加入</span>
      <span class="store-card-name" data-i18n-skip>${esc(productName(p))}</span>
      <span class="store-card-meta">${esc(p.code)} · ${String(i + 1).padStart(2, '0')}</span>
    </button>`;
  }
  /* 装帧未知的老文件按默认「笔记本」归位，与 normBookStyle 的兜底一致。 */
  function journalGroup(p) {
    const k = typeof normBookStyle === 'function' ? normBookStyle(p.journal && p.journal.style) : 'classic';
    return BOOK_GROUPS.some(g => g.k === k) ? k : 'classic';
  }
  function renderGrid() {
    const list = products.filter(p => p.type === activeType);
    if (activeType === 'journal') {
      grid.classList.add('as-rows');
      grid.innerHTML = BOOK_GROUPS.map(g => {
        const items = list.filter(p => journalGroup(p) === g.k);
        if (!items.length) return '';
        const label = tr(g.label);
        return `<section class="store-group" data-book-style="${g.k}">
          <header class="store-group-head">
            <h2>${esc(label)}</h2><span class="store-group-rule"></span>
            <span class="store-group-count">${String(items.length).padStart(2, '0')}</span>
          </header>
          <div class="store-group-row" tabindex="0" role="region" aria-label="${esc(label)}">${items.map(cardHTML).join('')}</div>
        </section>`;
      }).join('');
    } else {
      grid.classList.remove('as-rows');
      grid.innerHTML = list.map(cardHTML).join('');
    }
    message.hidden = list.length > 0;
    if (!list.length) message.textContent = tr('暂无商品');
  }
  async function registerFontPreview(p) {
    const f = p.font;
    if (previewFonts.has(f.family)) return;
    previewFonts.add(f.family);
    try {
      const data = f.data || await fontDataFromUrl(f.url, f.format);
      const face = new FontFace(f.family, fontFaceSource({ data, format: f.format }), {
        style: 'normal', weight: f.weight || '400'
      });
      await face.load(); document.fonts.add(face);
    } catch (e) {
      previewFonts.delete(f.family);
      console.warn('[store] 字体预览加载失败：', f.family, e);
    }
  }

  function syncInstalled() {
    grid.querySelectorAll('[data-store-id]').forEach(el => el.classList.toggle('installed', installed.has(el.dataset.storeId)));
    if (!active) return;
    const has = installed.has(active.id);
    downloadBtn.disabled = saving || has;
    downloadBtn.classList.toggle('busy', saving);
    downloadText.textContent = saving ? '正在下载…'
      : has ? (active.type === 'journal' ? '已在书架中' : active.type === 'stickers' ? '已在贴纸库中' : '已安装')
        : (active.type === 'journal' ? '下载并导入' : active.type === 'stickers' ? '下载贴纸包' : '下载并安装');
    openShelf.hidden = !has;
    openShelf.textContent = active.type === 'journal' ? '返回书架查看' : '返回应用';
    removeBtn.hidden = !(active.type === 'font' && has);
    removeBtn.disabled = saving;
  }
  function openProduct(id, trigger) {
    const p = products.find(x => x.id === id);
    if (!p) return;
    clearTimeout(closeTimer);
    active = p; lastTrigger = trigger || null;
    const at = products.indexOf(p), isBook = p.type === 'journal';
    stage.hidden = !isBook; assetPreview.hidden = isBook; previewTools.hidden = !isBook;
    book3d.innerHTML = ''; assetPreview.innerHTML = '';
    if (isBook) {
      book3d.innerHTML = `
        <div class="book-face back">${coverHTML(p.journal, true)}</div>
        <div class="book-spine" style="${spineStyle(p.journal)}"></div><div class="book-pages"></div>
        <div class="book-face front">${coverHTML(p.journal)}</div>`;
      resetView();
    } else if (p.type === 'stickers') {
      assetPreview.innerHTML = `<div class="sticker-detail-grid">${stickerImages(p, true)}</div>`;
    } else {
      assetPreview.innerHTML = `<div class="font-detail-sample" style="font-family:'${p.font.family}'"><b>Aa</b><strong>Carnet</strong><span>ABCDEFGHIJKLM<br>abcdefghijklm<br>0123456789</span></div>`;
      registerFontPreview(p);
    }
    document.getElementById('detailKicker').textContent = `EDITION ${String(at + 1).padStart(2, '0')} / ${p.code}`;
    document.getElementById('detailName').textContent = productName(p);
    document.getElementById('detailMeta').textContent = metaOf(p);
    document.getElementById('detailDescription').textContent = p.description;
    status.textContent = ''; status.classList.remove('error');
    syncInstalled();
    detail.hidden = false;
    document.body.classList.add('detail-open');
    requestAnimationFrame(() => { detail.classList.add('show'); closeBtn.focus({ preventScroll: true }); });
  }
  function closeProduct() {
    if (detail.hidden) return;
    detail.classList.remove('show');
    document.body.classList.remove('detail-open');
    closeTimer = setTimeout(() => {
      detail.hidden = true; active = null;
      if (lastTrigger && lastTrigger.isConnected) lastTrigger.focus({ preventScroll: true });
    }, 240);
  }

  async function saveJournal(p) {
    let data = await DB.get(KEY);
    if (!Array.isArray(data)) data = [];
    if (data.some(j => j && j.storeId === p.id)) return true;
    const j = JSON.parse(JSON.stringify(p.journal));
    j.id = uid(); j.created = Date.now(); j.fromStore = true; j.storeId = p.id;
    const ok = await DB.set(KEY, data.concat(j));
    if (!ok) throw new Error('storage-full');
    return true;
  }
  async function saveStickerPack(p) {
    const prefs = Object.assign(defaultPrefs(), (await DB.get(PREF_KEY)) || {});
    if (!Array.isArray(prefs.stickers)) prefs.stickers = [];
    if (prefs.stickers.some(s => s && s.storeId === p.id)) return true;
    const valid = p.pack.stickers.filter(s => s && /^data:image\//i.test(String(s.src || '')));
    if (!valid.length) throw new Error('invalid-stickers');
    if (prefs.stickers.length + valid.length > 60) throw new Error('sticker-lib-full');
    const taken = new Set(prefs.stickers.map(s => s.pack).filter(Boolean));
    const base = String(p.pack.name || productName(p));
    let packName = base, n = 2;
    while (taken.has(packName)) packName = base + ' (' + n++ + ')';
    const packId = uid(), at = Date.now();
    const items = valid.map(s => ({
      id: uid(), src: s.src, w: clamp(Math.round(Number(s.w) || 200), 8, 2000),
      h: clamp(Math.round(Number(s.h) || 200), 8, 2000), n: String(s.n || '').slice(0, 24),
      pack: packName, packId, packAt: at, at, storeId: p.id
    }));
    prefs.stickers = items.concat(prefs.stickers);
    const ok = await DB.set(PREF_KEY, prefs);
    if (!ok) throw new Error('storage-full');
    return true;
  }
  function downloadError(e) {
    if (e && e.message === 'sticker-lib-full') return '贴纸库最多 60 张，请先移除一些再下载。';
    if (e && e.message === 'font-lib-full') return '字体库最多 20 款，请先移除一些再下载。';
    return '下载失败，请检查网络或浏览器存储空间后重试';
  }
  async function downloadActive() {
    const p = active;
    if (!p || saving || installed.has(p.id)) return;
    saving = true; status.textContent = ''; status.classList.remove('error'); syncInstalled();
    try {
      /* 旧版用户直接打开商店时，也先走同一套迁移，避免只写新键遮住旧书架。 */
      try { await migrateLegacyStorage(); } catch (_) {}
      if (p.type === 'journal') await saveJournal(p);
      else if (p.type === 'stickers') await saveStickerPack(p);
      else await installFontProduct(p);
      installed.add(p.id);
      if (active && active.id === p.id) {
        const name = productName(p);
        status.textContent = p.type === 'journal' ? `已下载并导入《${name}》`
          : p.type === 'stickers' ? `已下载并加入我的贴纸《${name}》` : `已安装字体《${name}》`;
      }
    } catch (e) {
      console.error('[store] 下载导入失败：', e);
      if (active && active.id === p.id) {
        status.textContent = downloadError(e); status.classList.add('error');
      }
    } finally {
      saving = false; syncInstalled();
    }
  }
  async function uninstallActive() {
    const p = active;
    if (!p || p.type !== 'font' || saving || !installed.has(p.id)) return;
    saving = true; status.textContent = ''; status.classList.remove('error'); syncInstalled();
    try {
      await uninstallFontProduct(p);
      installed.delete(p.id);
      previewFonts.delete(p.font.family);
      renderGrid();
      status.textContent = tr('已卸载字体《{0}》', productName(p));
    } catch (e) {
      console.error('[store] 字体卸载失败：', e);
      status.textContent = tr('卸载失败，请重试'); status.classList.add('error');
    } finally {
      saving = false; syncInstalled();
    }
  }

  /* 每个板块是一行横向滚动的卡片：触屏原生滑动，鼠标可拖动，方向键也能翻。 */
  let rowDrag = null;
  grid.addEventListener('pointerdown', e => {
    if (e.pointerType !== 'mouse' || e.button !== 0) return;
    const row = e.target.closest('.store-group-row');
    if (!row) return;
    rowDrag = { row, x: e.clientX, left: row.scrollLeft, moved: false, id: e.pointerId };
  });
  grid.addEventListener('pointermove', e => {
    if (!rowDrag || rowDrag.id !== e.pointerId) return;
    const dx = e.clientX - rowDrag.x;
    if (!rowDrag.moved && Math.abs(dx) > 4) {
      rowDrag.moved = true;
      rowDrag.row.classList.add('dragging');
      rowDrag.row.setPointerCapture(e.pointerId);
    }
    if (rowDrag.moved) {
      rowDrag.row.scrollLeft = rowDrag.left - dx;
      e.preventDefault();
    }
  });
  function endRowDrag(e) {
    if (!rowDrag || (e && rowDrag.id !== e.pointerId)) return;
    const { row, moved } = rowDrag;
    row.classList.remove('dragging');
    rowDrag = null;
    if (moved) {
      row.dataset.dragged = '1';
      setTimeout(() => { delete row.dataset.dragged; }, 80);
    }
  }
  grid.addEventListener('pointerup', endRowDrag);
  grid.addEventListener('pointercancel', endRowDrag);
  grid.addEventListener('click', e => {
    const row = e.target.closest('.store-group-row');
    if (row && row.dataset.dragged === '1') {
      delete row.dataset.dragged;
      e.preventDefault(); e.stopPropagation();
      return;
    }
    const card = e.target.closest('[data-store-id]');
    if (card) openProduct(card.dataset.storeId, card);
  }, true);
  grid.addEventListener('keydown', e => {
    if (!['ArrowLeft', 'ArrowRight'].includes(e.key)) return;
    const row = e.target.closest('.store-group-row');
    if (!row) return;
    const card = row.querySelector('.store-card');
    const step = card ? card.getBoundingClientRect().width + 18 : 200;
    row.scrollBy({ left: (e.key === 'ArrowRight' ? 1 : -1) * step, behavior: 'smooth' });
    e.preventDefault();
  });
  document.getElementById('storeTabs').addEventListener('click', e => {
    const btn = e.target.closest('[data-store-tab]');
    if (!btn) return;
    activeType = btn.dataset.storeTab;
    document.querySelectorAll('[data-store-tab]').forEach(b => b.classList.toggle('on', b === btn));
    renderGrid();
  });
  closeBtn.addEventListener('click', closeProduct);
  downloadBtn.addEventListener('click', downloadActive);
  removeBtn.addEventListener('click', uninstallActive);
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !detail.hidden) { e.preventDefault(); closeProduct(); }
    if (e.key !== 'Tab' || detail.hidden) return;
    const focusable = Array.from(detail.querySelectorAll('button:not(:disabled),a[href],[tabindex="0"]')).filter(el => !el.hidden && el.getClientRects().length);
    if (!focusable.length) return;
    const first = focusable[0], last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });

  /* 3D：拖动只写一个 transform，并用 rAF 合帧；双击 / 按钮 / R 键复位。 */
  let rx = 7, ry = -24, drag = null, raf = 0;
  function paint() {
    raf = 0;
    book3d.style.transform = `rotateX(${rx.toFixed(2)}deg) rotateY(${ry.toFixed(2)}deg)`;
  }
  function queuePaint() { if (!raf) raf = requestAnimationFrame(paint); }
  function resetView() { rx = 7; ry = -24; drag = null; book3d.classList.remove('dragging'); paint(); }
  stage.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    drag = { x: e.clientX, y: e.clientY, rx, ry, id: e.pointerId };
    stage.setPointerCapture(e.pointerId); book3d.classList.add('dragging'); e.preventDefault();
  });
  stage.addEventListener('pointermove', e => {
    if (!drag || drag.id !== e.pointerId) return;
    ry = drag.ry + (e.clientX - drag.x) * .38;
    rx = clamp(drag.rx - (e.clientY - drag.y) * .25, -28, 28);
    queuePaint();
  });
  const endDrag = () => { drag = null; book3d.classList.remove('dragging'); };
  stage.addEventListener('pointerup', endDrag);
  stage.addEventListener('pointercancel', endDrag);
  stage.addEventListener('dblclick', resetView);
  stage.addEventListener('keydown', e => {
    if (e.key.toLowerCase() === 'r') { resetView(); e.preventDefault(); return; }
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
    if (e.key === 'ArrowLeft') ry -= 8;
    if (e.key === 'ArrowRight') ry += 8;
    if (e.key === 'ArrowUp') rx = clamp(rx - 5, -28, 28);
    if (e.key === 'ArrowDown') rx = clamp(rx + 5, -28, 28);
    paint(); e.preventDefault();
  });
  document.getElementById('resetView').addEventListener('click', resetView);

  (async () => {
    try {
      try { await migrateLegacyStorage(); } catch (_) {}
      const journals = await DB.get(KEY);
      if (Array.isArray(journals)) journals.forEach(j => { if (j && j.storeId) installed.add(j.storeId); });
      const prefs = await DB.get(PREF_KEY);
      if (prefs && Array.isArray(prefs.stickers)) prefs.stickers.forEach(s => { if (s && s.storeId) installed.add(s.storeId); });
      const fonts = await loadFontLibrary();
      fonts.forEach(f => { if (f.storeId) { installed.add(f.storeId); previewFonts.add(f.family); } });
    } catch (e) { console.warn('[store] 暂时无法读取本地下载状态：', e); }
    try {
      products = await loadCatalog();
      source.hidden = false;
      renderGrid();
      products.filter(p => p.type === 'font').forEach(registerFontPreview);
      subscribeHotUpdate();
    } catch (e) {
      console.error('[store] 商品清单读取失败：', e);
      message.hidden = false;
      message.textContent = tr('暂无商品');
    }
  })();
})();
