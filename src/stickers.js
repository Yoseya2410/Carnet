/* =====================================================================
 * Carnet · 贴纸 · 便利贴 / 装饰胶带 / 我的贴纸   （脚本 22 / 28）
 * ---------------------------------------------------------------------
 * 阅读器右上角「＋ → 贴纸」升起一张分三档的面板，点一下就落到当前页上：
 *   ① 便利贴 —— 带便签纸皮肤的**文字贴**（能打字、挪位置、旋转，就是一张便签）
 *   ② 装饰胶带 —— 半透明的和纸胶带（撕边 + 花纹），压在照片角上做固定
 *   ③ 我的贴纸 —— 用户自己导入的图片，存在贴纸库里（state.prefs.stickers），下次继续用
 *
 * 后两档落下去就是普通的图片对象（dataURL），拖动 / 缩放 / 旋转 / 上下层
 * 全都复用图片那套；便利贴落下去是文字对象，接着就开编辑面板等你打字。
 *
 * 对外接口：openStickerSheet, closeStickerSheet, addSticker, addNoteTo,
 *           stickerLib, addStickerToLib, addStickersToLib, stickerImportMsg,
 *           removeStickerFromLib
 *
 * 依赖模块：core, visuals, state（media / text-sticker / reader-view 后置，只在运行时用）
 *
 * 说明：模块间共用全局作用域，加载顺序即依赖顺序（见 index.html 与 README）。
 * ===================================================================== */
const sts = {
  open: false, pid: 0, built: false, tab: 'note',
  selectMode: false, selected: new Set(), collapsed: new Set(),   // .lbl 多选导出 / 分组折叠
  tape: null                                                     // 当前选中、等待在纸上拖出的胶带
};

/* ==================== 素材 ==================== */
/* ---- 装饰胶带：120×30 的一条，两头是撕开的锯齿边，花纹裁在带子里 ---- */
const TAPE_BODY = 'M5 .9 L115 .9 L118 6 L115.2 12 L118 18 L115.2 24 L118 29.1 L5 29.1 L7.8 24 L5 18 L7.8 12 L5 6 Z';
function tapePattern(kind, color) {
  switch (kind) {
    /* 斜纹：45° 转一下的条纹 */
    case 'stripe': return `<pattern id="p" width="11" height="11" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">`
      + `<rect width="5" height="11" fill="rgba(255,255,255,.52)"/></pattern>`;
    /* 波点 */
    case 'dot': return `<pattern id="p" width="11" height="11" patternUnits="userSpaceOnUse">`
      + `<circle cx="5.5" cy="5.5" r="2.6" fill="rgba(255,255,255,.62)"/></pattern>`;
    /* 网格 */
    case 'grid': return `<pattern id="p" width="12" height="12" patternUnits="userSpaceOnUse">`
      + `<path d="M0 .8h12M.8 0v12" stroke="rgba(255,255,255,.5)" stroke-width="1.6"/></pattern>`;
    /* 格纹（横竖各两条） */
    case 'check': return `<pattern id="p" width="14" height="14" patternUnits="userSpaceOnUse">`
      + `<rect width="7" height="7" fill="rgba(255,255,255,.34)"/><rect x="7" y="7" width="7" height="7" fill="rgba(255,255,255,.34)"/></pattern>`;
    /* 蕾丝：一道道小波浪 */
    case 'lace': return `<pattern id="p" width="12" height="12" patternUnits="userSpaceOnUse">`
      + `<path d="M0 3q3-3.4 6 0t6 0" fill="none" stroke="rgba(255,255,255,.72)" stroke-width="1.5"/></pattern>`;
    default: return '';
  }
}
/* 任意长度的胶带：w/h 直接用 px 单位（生成后 1:1 贴到纸上，花纹 tile 不缩放）。
   两头各三段撕边，端头宽度按长度收一下，短胶带也不会被锯齿吃光。 */
function tapeBodyPath(w, h) {
  const e = Math.max(1.4, Math.min(4.6, w * .035));
  const y = [h * .03, h * .20, h * .40, h * .60, h * .80, h * .97].map(v => v.toFixed(2));
  const r = (w - e * 1.1).toFixed(2), rt = (w - e * .2).toFixed(2);
  const l = (e * 1.1).toFixed(2), lt = (e * .2).toFixed(2);
  return `M${e.toFixed(2)} ${y[0]} L${r} ${y[0]} L${rt} ${y[1]} L${r} ${y[2]} `
    + `L${rt} ${y[3]} L${r} ${y[4]} L${rt} ${y[5]} L${e.toFixed(2)} ${y[5]} `
    + `L${lt} ${y[4]} L${l} ${y[3]} L${lt} ${y[2]} L${l} ${y[1]} Z`;
}
/* 预览小样是固定 120×30；拖出来那条按实际长度 / 厚度生成（见 tapeDrag）。 */
function tapeSVG(color, kind, w, h) {
  const W = Math.max(12, Math.round(w || 120)), H = Math.max(8, Math.round(h || 30));
  const body = (W === 120 && H === 30) ? TAPE_BODY : tapeBodyPath(W, H);
  const pat = tapePattern(kind, color);
  /* ⚠️ 里面写 url(#p) 这样带 # 的引用就好 —— 下面 enc() 会把 # 转成 %23，
     自己先写成 %23 的话会被 enc 再转一道（%25 23），引用就断了 */
  return enc(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">`
    + `<defs>${pat}<clipPath id="c"><path d="${body}"/></clipPath>`
    + `<linearGradient id="g" x1="0" y1="0" x2="0" y2="1">`
    + `<stop offset="0" stop-color="rgba(0,0,0,.22)"/><stop offset=".34" stop-color="rgba(255,255,255,.22)"/>`
    + `<stop offset="1" stop-color="rgba(0,0,0,.18)"/></linearGradient></defs>`
    + `<path d="${body}" fill="${color}" opacity=".9"/>`
    + (pat ? `<path d="${body}" fill="url(#p)"/>` : '')
    /* 上缘压一点暗、中间留一道高光：胶带是贴在纸上的一条实物，不是一块色块 */
    + `<g clip-path="url(#c)"><rect x="0" y="0" width="${W}" height="${H}" fill="url(#g)"/></g>`
    + `</svg>`);
}
const TAPES = [
  { k: 'plain-cream', n: '米白素色', c: '#f0e6d2', p: 'plain' },
  { k: 'stripe-pink', n: '粉斜纹',   c: '#f2a8bd', p: 'stripe' },
  { k: 'dot-blue',    n: '蓝波点',   c: '#9fc4e8', p: 'dot' },
  { k: 'grid-yellow', n: '黄网格',   c: '#efd089', p: 'grid' },
  { k: 'check-green', n: '绿格纹',   c: '#a9d6b4', p: 'check' },
  { k: 'stripe-lilac',n: '紫斜纹',   c: '#c3aede', p: 'stripe' },
  { k: 'lace-grey',   n: '灰蕾丝',   c: '#dcdde4', p: 'lace' },
  { k: 'dot-orange',  n: '橙波点',   c: '#f3b98a', p: 'dot' }
];
/* 便利贴：六种便签纸颜色（落下去是文字贴，颜色存在 t.note 上） */
const NOTE_COLORS = ['#ffe066', '#ffc2d8', '#bfe4ff', '#c9f0d4', '#ffd9a8', '#e6d4ff'];

/* ==================== 我的贴纸：导入图片，存进贴纸库下次接着用 ====================
   存在 state.prefs.stickers（跟展示偏好同一份 IndexedDB 记录，不进手帐数据、不进导出），
   每条是 { id, src, w, h } —— w/h 是图片原始比例算出来的，落页时按它定尺寸，不会变形。
   ⚠️ 图片压到长边 400 / PNG 储存（保留透明通道）：贴纸小、数量多，
      不压缩的话几十张就把 IndexedDB 撑爆了。 */
const STICKER_MAX_EDGE = 400;
const STICKER_LIB_MAX = 60;

function stickerLib() {
  return Array.isArray(state.prefs && state.prefs.stickers) ? state.prefs.stickers : [];
}
async function saveStickerLib() {
  const ok = await DB.set(PREF_KEY, state.prefs);
  if (!ok) toast('贴纸没能保存，稍后重试', 2600);
  return ok;
}
/* 把一张图压成贴纸素材：缩到长边 400、PNG 存（保透明）。
   input 可以是 File，也可以是移动端选图链路已经读好的 dataURL 字符串。 */
async function packSticker(input) {
  const data = await readFileDataURL(input);
  if (!data) throw new Error('读图失败');
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onerror = () => reject(new Error('这不是能用的图片'));
    img.onload = () => {
      const w0 = img.naturalWidth || 1, h0 = img.naturalHeight || 1;
      const k = Math.min(1, STICKER_MAX_EDGE / Math.max(w0, h0));
      const w = Math.max(1, Math.round(w0 * k)), h = Math.max(1, Math.round(h0 * k));
      const cv = document.createElement('canvas');
      cv.width = w; cv.height = h;
      const cx = cv.getContext('2d');
      cx.drawImage(img, 0, 0, w, h);
      let src;
      try { src = cv.toDataURL('image/png'); }
      catch (e) { reject(new Error('这张图片不能用于贴纸')); return; }
      resolve({ src, w, h });
    };
    img.src = data;
  });
}
async function addStickerToLib(file) {
  if (stickerLib().length >= STICKER_LIB_MAX) {
    toast('贴纸最多存 ' + STICKER_LIB_MAX + ' 张，先删掉几张吧', 2800);
    return null;
  }
  let packed;
  try { packed = await packSticker(file); }
  catch (e) { toast(String(e && e.message || '导入失败')); return null; }
  const item = { id: uid(), src: packed.src, w: packed.w, h: packed.h, at: Date.now() };
  if (!state.prefs.stickers) state.prefs.stickers = [];
  state.prefs.stickers.unshift(item);          // 新导入的排在最前面
  await saveStickerLib();
  return item;
}
/* ---- 批量导入 ----
   一次选多张图时逐张压缩、但**只写一次贴纸库**：单张版每导一张就 await 一次 IndexedDB，
   几十张会把面板卡住。返回统计给调用处拼一句汇总提示，别每张都弹一次 toast。
   ⚠️ 上限 STICKER_LIB_MAX 按「库里已有 + 这次成功」算，装不下的图直接跳过并置 full。 */
async function addStickersToLib(files) {
  const list = Array.from(files || []).filter(f => f && (!f.type || /^image\//i.test(f.type)));
  const res = { added: 0, failed: 0, full: false };
  if (!list.length) return res;
  const room = Math.max(0, STICKER_LIB_MAX - stickerLib().length);
  const items = [];
  let used = 0;
  for (const f of list) {
    if (items.length >= room) { res.full = true; break; }
    used++;
    let packed;
    try { packed = await packSticker(f); }
    catch (_) { res.failed++; continue; }
    items.push({ id: uid(), src: packed.src, w: packed.w, h: packed.h, at: Date.now() });
  }
  if (used < list.length) res.full = true;       // 有没轮到的（库满 / 前面 break）
  if (!items.length) return res;
  if (!state.prefs.stickers) state.prefs.stickers = [];
  state.prefs.stickers = items.concat(state.prefs.stickers);   // 按选图顺序排在最前
  await saveStickerLib();
  res.added = items.length;
  return res;
}
/* 两处导入面板共用的一句汇总文案 */
function stickerImportMsg(r) {
  if (!r.added) return r.failed ? '这些图片读不出来，换几张试试' : '贴纸库已满，先删掉几张吧';
  let s = '已导入 ' + r.added + ' 张贴纸';
  if (r.failed) s += '；' + r.failed + ' 张读不出来';
  if (r.full) s += '；贴纸库最多 ' + STICKER_LIB_MAX + ' 张';
  return s;
}
async function removeStickerFromLib(id) {
  const lib = stickerLib();
  const i = lib.findIndex(x => x.id === id);
  if (i < 0) return;
  lib.splice(i, 1);
  state.prefs.stickers = lib;
  await saveStickerLib();
}

/* ==================== .lbl 贴纸包：多选导出 / 按文件分组导入 ====================
   一个 .lbl 就是一份 UTF-8 JSON（.lbl 只是扩展名，方便手机上认出是贴纸包）：
     { app:'carnet-stickers', version:1, name, exportedAt, stickers:[{n,src,w,h}] }
   src 只允许 data:image/* —— 不收外链，免得导入后图片失效 / 夹带 URL。
   导入时**每个文件单独给一个 packId**，即使同名文件导两次也分成两组；
   组名取文件名（去掉 .lbl），重名自动加 (2)(3)，面板按组渲染、可折叠 / 整组移除。 */
const LBL_TAG = 'carnet-stickers';
const LBL_VERSION = 1;
const LBL_LOOSE = '__loose__';       // 图片导入 / 老数据：没有来源文件，归到「散装贴纸」
function lblSafeName(s) {
  const n = String(s || '我的贴纸').replace(/[\\/:*?"<>|\n\r\t]/g, '_').trim();
  return (n || '我的贴纸').slice(0, 40);
}
/* 跟 readPickedFiles 同一个移动端规矩：先把选中的文件**全部读进内存**再清 input，
   否则 iOS / X5 会把底层 Blob 一起释放。这里要的是文本 + 文件名（分组要用）。 */
async function readPickedTexts(e) {
  const inp = e && e.target;
  if (!inp) return [];
  const files = Array.from(inp.files || []);
  const out = await Promise.all(files.map(f => new Promise(res => {
    const r = new FileReader();
    r.onload = () => res({ name: String(f.name || '贴纸包'), text: String(r.result || '') });
    r.onerror = () => res(null);
    try { r.readAsText(f, 'utf-8'); } catch (_) { res(null); }
  })));
  try { inp.value = ''; } catch (_) {}
  return out.filter(Boolean);
}
/* 按 packId 把贴纸库切成一组组（保持库里从新到旧的顺序） */
function stickerGroups() {
  const groups = [], map = new Map();
  stickerLib().forEach(s => {
    const key = s.packId || LBL_LOOSE;
    if (!map.has(key)) {
      const g = { key, name: s.pack || '散装贴纸', items: [] };
      map.set(key, g); groups.push(g);
    }
    map.get(key).items.push(s);
  });
  return groups;
}
async function exportStickerLbl(ids, name) {
  const lib = stickerLib().filter(s => ids.includes(s.id));
  if (!lib.length) { toast('先勾选要导出的贴纸'); return false; }
  const nm = lblSafeName(name);
  const text = JSON.stringify({
    app: LBL_TAG, version: LBL_VERSION, name: nm, exportedAt: Date.now(),
    stickers: lib.map((s, i) => ({
      n: String(s.n || ('贴纸 ' + (i + 1))).slice(0, 24),
      src: s.src, w: Math.round(s.w || 1), h: Math.round(s.h || 1)
    }))
  });
  const file = nm + '.lbl';
  try {
    await deliverBlob(null, file, new Blob([text], { type: 'application/octet-stream' }),
      'application/octet-stream', '已导出 ' + file + ' · 共 ' + lib.length + ' 张');
    return true;
  } catch (err) {
    toast('导出失败：' + ((err && err.message) || err), 3200);
    return false;
  }
}
async function importStickerLbl(e) {
  const files = await readPickedTexts(e);
  if (!files.length) return;
  if (!Array.isArray(state.prefs.stickers)) state.prefs.stickers = [];
  let packs = 0, added = 0, skipped = 0, full = false;
  for (const f of files) {
    let data = null;
    try { data = JSON.parse(f.text.replace(/^\uFEFF/, '')); } catch (_) { skipped++; continue; }
    if (!data || data.app !== LBL_TAG || !Array.isArray(data.stickers)) { skipped++; continue; }
    /* 组名 = 文件名；同名文件重复导入自动编号，绝不并成一组 */
    const base = lblSafeName(f.name.replace(/\.lbl$/i, '') || data.name);
    const taken = new Set(state.prefs.stickers.map(s => s.pack).filter(Boolean));
    let nm = base, k = 2;
    while (taken.has(nm)) nm = base + ' (' + k++ + ')';
    const packId = uid(), at = Date.now();
    const items = [];
    for (const s of data.stickers.slice(0, 240)) {
      if (!s || typeof s.src !== 'string' || !/^data:image\//i.test(s.src)) continue;
      if (state.prefs.stickers.length + items.length >= STICKER_LIB_MAX) { full = true; break; }
      items.push({
        id: uid(), src: s.src,
        w: clamp(Math.round(Number(s.w) || 200), 8, 2000),
        h: clamp(Math.round(Number(s.h) || 200), 8, 2000),
        n: String(s.n || '').slice(0, 24),
        pack: nm, packId, at, packAt: at
      });
    }
    if (!items.length) { skipped++; continue; }
    state.prefs.stickers = items.concat(state.prefs.stickers);
    packs++; added += items.length;
  }
  if (!added) { toast(skipped ? '这些不是可用的 .lbl 贴纸包' : '贴纸库已满，先删掉几张吧', 3000); return; }
  await saveStickerLib();
  stTab('mine');
  renderMinePane();
  toast('已导入 ' + added + ' 张 · 分到 ' + packs + ' 个贴纸包'
    + (skipped ? '；' + skipped + ' 个文件读不出来' : '')
    + (full ? '；贴纸库最多 ' + STICKER_LIB_MAX + ' 张' : ''), 3600);
}
async function removeStickerPack(packId) {
  const lib = stickerLib();
  const n = lib.filter(s => (s.packId || LBL_LOOSE) === packId).length;
  if (!n) return;
  const nm = (lib.find(s => s.packId === packId) || {}).pack || '这一组';
  askConfirm('「' + nm + '」里的 ' + n + ' 张贴纸会一起从贴纸库移除，已经贴到手帐页面上的不受影响。', {
    title: '移除这个贴纸包', ok: '移除',
    onOk: async () => {
      state.prefs.stickers = lib.filter(s => (s.packId || LBL_LOOSE) !== packId);
      await saveStickerLib();
      renderMinePane();
      toast('已移除贴纸包「' + nm + '」');
    }
  });
}

/* ==================== 落到页面上 ==================== */
/* 贴纸落点：页面正中偏上一点，同一页贴多张时依次错开，免得一张压一张看不出来 */
function stickerSpot(pg, w, h) {
  const n = ((pg && pg.images) || []).length % 6;
  return {
    x: clamp(.5 - w / 2 + n * .022 - .055, .02, .96 - w),
    y: clamp(.46 - h / 2 + n * .022 - .055, .02, .96 - h)
  };
}
/* 手绘图案 / 胶带：落下去就是一张图片对象（SVG dataURL，渲染时自动按贴纸处理） */
function addSticker(pid, src, w, ratio, rot) {
  const j = cur(); if (!j) return null;
  const pg = j.pages[pid]; if (!pg) return null;
  const h = clamp(w * (ratio || 1) * paperAspect(), .02, IMG_MAX);
  const s = stickerSpot(pg, w, h);
  const im = { id: uid(), src, x: s.x, y: s.y, w: clamp(w, .04, IMG_MAX), h, z: nextZ(pg), locked: false };
  if (rot) im.rot = rot;
  (pg.images || (pg.images = [])).push(im);
  save();
  return im;
}
/* 便利贴：落下去是文字贴（便签纸皮肤 + 随手一个小角度），接着就开面板等你打字 */
function addNoteTo(pid, color) {
  const j = cur(); if (!j) return null;
  const pg = j.pages[pid]; if (!pg) return null;
  const w = .38, h = .26;
  const s = stickerSpot(pg, w, h);
  const t = newText(s.x, s.y, '');
  t.w = w; t.h = h;
  t.note = normHex6(color) || NOTE_COLORS[0];
  t.color = '#3a3f52';
  t.align = 'left';
  t.rot = -2.5;                       // 便签随手贴上去总是歪一点
  t.locked = false;
  t.z = nextZ(pg);
  pageTexts(pg).push(t);
  /* 跟「添加文字」一样：便利贴第一次收面板也先别锁，落下去就能挪 */
  if (typeof markFreshText === 'function') markFreshText(t.id);
  save();
  return t;
}

/* ==================== 面板 ==================== */
function stTab(name) {
  sts.tab = name || 'note';
  $$('#stTabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === sts.tab));
  $$('#stPanes .ts-pane').forEach(p => p.classList.toggle('on', p.dataset.pane === sts.tab));
}
function buildStickerSheet() {
  const notes = $('#stNotes');
  if (notes) {
    notes.innerHTML = NOTE_COLORS.map(c => `
      <button class="st-opt note" data-note="${c}" title="便利贴 ${c}">
        <span class="st-note" style="--nc:${c}"></span>
      </button>`).join('');
    notes.addEventListener('click', e => {
      const b = e.target.closest('.st-opt'); if (!b) return;
      const t = addNoteTo(sts.pid, b.dataset.note);
      if (!t) return;
      closeStickerSheet();
      renderReader();
      openTextSheet(sts.pid, t.id, true);        // 落下去接着打字，一步到位
      toast('便利贴已加到第 ' + (sts.pid + 1) + ' 页');
    });
  }
  const tapes = $('#stTapes');
  if (tapes) {
    tapes.innerHTML = TAPES.map(t => `
      <button class="st-opt tape" data-tape="${t.k}" title="${t.n} · 选中后在页面上拖出直线">
        <img src="${tapeSVG(t.c, t.p)}" alt="">
      </button>`).join('');
    /* 11-17：胶带不再「点一下就落一条固定长度」。先选中款式，收起面板，
       再到纸面上按住拖出一条直线，长度 / 角度由这次拖动决定（见 armTape / tapeDrag）。 */
    tapes.addEventListener('click', e => {
      const b = e.target.closest('.st-opt'); if (!b) return;
      const t = TAPES.find(x => x.k === b.dataset.tape); if (!t) return;
      $$('#stTapes .st-opt').forEach(x => x.classList.toggle('on', x === b));
      armTape(t);
    });
  }
  /* 导入图片：可一次选多张 → 批量压成贴纸存进库 → 立刻出现在「我的贴纸」里。
     ⚠️ 走 readPickedFiles：移动端把 File 先同步读成 dataURL 再清 input，
        否则清空 value 会让底层 Blob 失效，接下来每张都「读不出来」。 */
  const imp = $('#stImport'), file = $('#stFile');
  if (imp && file) {
    imp.onclick = () => file.click();
    file.onchange = async e => {
      const fs = await readPickedFiles(e);
      if (!fs.length) return;
      const r = await addStickersToLib(fs);
      stTab('mine');
      renderMinePane();
      toast(stickerImportMsg(r), (r.failed || r.full) ? 3400 : undefined);
    };
  }
  /* ---- .lbl 贴纸包：导入（可多选文件）/ 导出（可多选贴纸）---- */
  const impLbl = $('#stImportLbl'), lblFile = $('#stLblFile');
  if (impLbl && lblFile) {
    impLbl.onclick = () => lblFile.click();
    lblFile.onchange = e => importStickerLbl(e);
  }
  const expLbl = $('#stExportLbl');
  if (expLbl) expLbl.onclick = () => stSelectMode(true);
  const selAll = $('#stSelAll');
  if (selAll) selAll.onclick = () => {
    stickerLib().forEach(s => sts.selected.add(s.id));
    renderMinePane(); stUpdateSelBar();
  };
  const selCancel = $('#stSelCancel');
  if (selCancel) selCancel.onclick = () => stSelectMode(false);
  const selExport = $('#stSelExport');
  if (selExport) selExport.onclick = async () => {
    const nm = $('#stLblName') ? $('#stLblName').value : '';
    if (await exportStickerLbl([...sts.selected], nm)) stSelectMode(false);
  };
  const tabs = $('#stTabs');
  if (tabs) tabs.addEventListener('click', e => {
    const b = e.target.closest('button[data-tab]'); if (!b) return;
    stTab(b.dataset.tab);
    if (b.dataset.tab === 'mine') renderMinePane();
  });
  const mine = $('#stMine');
  if (mine) {
    mine.addEventListener('click', async e => {
      const gdel = e.target.closest('.st-group-del');
      if (gdel) { e.stopPropagation(); await removeStickerPack(gdel.dataset.packdel); return; }
      const tg = e.target.closest('.st-group-toggle');
      if (tg) {
        const key = tg.dataset.toggle;
        if (sts.collapsed.has(key)) sts.collapsed.delete(key); else sts.collapsed.add(key);
        renderMinePane();
        return;
      }
      const del = e.target.closest('.st-del');
      if (del) {
        e.stopPropagation();
        await removeStickerFromLib(del.dataset.del);
        renderMinePane();
        toast('已从贴纸库删除');
        return;
      }
      const b = e.target.closest('.st-opt'); if (!b) return;
      /* 多选模式：点格子只切勾选，不往页面上贴 */
      if (sts.selectMode) {
        const id = b.dataset.mine;
        if (sts.selected.has(id)) sts.selected.delete(id); else sts.selected.add(id);
        b.classList.toggle('checked', sts.selected.has(id));
        stUpdateSelBar();
        return;
      }
      const it = stickerLib().find(x => x.id === b.dataset.mine); if (!it) return;
      const ratio = (it.h || 1) / (it.w || 1);
      const im = addSticker(sts.pid, it.src, .26, ratio, 0);
      if (!im) return;
      renderReader();
      toast('已贴到第 ' + (sts.pid + 1) + ' 页');
    });
  }
  sts.built = true;
}
function stUpdateSelBar() {
  const c = $('#stSelCount'); if (c) c.textContent = '已选 ' + sts.selected.size + ' 张';
  const b = $('#stSelExport'); if (b) b.disabled = !sts.selected.size;
}
function stSelectMode(on) {
  sts.selectMode = !!on;
  sts.selected = new Set();
  const bar = $('#stSelBar'), main = $('#stFootMain');
  if (bar) bar.hidden = !on;
  if (main) main.hidden = !!on;
  if (on) {
    stTab('mine');
    const nm = $('#stLblName'); if (nm) nm.value = '我的贴纸';
    toast('勾选要导出的贴纸，再点「导出 .lbl」');
  }
  renderMinePane();
  stUpdateSelBar();
}
/* 「我的贴纸」：按 .lbl 来源文件分组。每个文件一组（同名文件重复导入也各自一组），
   图片导入 / 老数据归到「散装贴纸」。组可折叠、可整组移除。 */
function renderMinePane() {
  const box = $('#stMine'), empty = $('#stMineEmpty');
  if (!box) return;
  const lib = stickerLib();
  box.innerHTML = stickerGroups().map(g => {
    const folded = sts.collapsed.has(g.key);
    const items = g.items.map(s => `
      <button class="st-opt mine${sts.selected.has(s.id) ? ' checked' : ''}" data-mine="${s.id}"
              title="${sts.selectMode ? '勾选 / 取消勾选' : '点一下贴到页面上'}">
        <img src="${s.src}" alt="">
        <i class="st-check" aria-hidden="true">✓</i>
        <i class="st-del" data-del="${s.id}" title="从贴纸库删除">×</i>
      </button>`).join('');
    return `<div class="st-group" data-pack="${esc(g.key)}">
      <div class="st-group-head">
        <button class="st-group-toggle${folded ? ' folded' : ''}" data-toggle="${esc(g.key)}" title="收起 / 展开">▾</button>
        <span class="st-group-name" title="${esc(g.name)}">${esc(g.name)}</span>
        <span class="st-group-n">${g.items.length} 张</span>
        ${g.key === LBL_LOOSE ? '' : `<button class="st-group-del" data-packdel="${esc(g.key)}" title="移除整个贴纸包">×</button>`}
      </div>
      <div class="st-grid st-mine st-group-body"${folded ? ' hidden' : ''}>${items}</div>
    </div>`;
  }).join('');
  if (empty) empty.style.display = lib.length ? 'none' : '';
  box.classList.toggle('selecting', sts.selectMode);
}
function stArmOutside() { armSheetOutside('#stsheet', closeStickerSheet); }
function stDisarmOutside() { disarmSheetOutside(); }
function openStickerSheet(pid) {
  const j = cur(); if (!j || !j.pages[pid]) return;
  closeAddMenu();
  /* 面板和「拖胶带」互斥：重新打开面板就退出待贴状态，免得手上还挂着一条没贴的胶带 */
  if (sts.tape) disarmTape();
  stSelectMode(false);
  /* 别的编辑面板让位：便利贴落下去要开文字面板，两套不能同时在场 */
  if (typeof hideTextBar === 'function' && typeof sh !== 'undefined' && sh && sh.open) hideTextBar();
  if (typeof closeBgSheet === 'function') closeBgSheet();
  if (typeof closeFrameSheet === 'function') closeFrameSheet();
  sts.open = true; sts.pid = pid;
  window.__stSheetOpen = true;
  window.__stOk = closeStickerSheet;
  if (!sts.built) buildStickerSheet();
  const p = $('#stPage'); if (p) p.textContent = ' · 第 ' + (pid + 1) + ' 页';
  const sheet = $('#stsheet'); if (!sheet) return;
  sheet.hidden = false;
  stTab(sts.tab === 'draw' ? 'mine' : (sts.tab || 'note'));   // 旧档位 draw 已下线，落到「我的贴纸」
  renderMinePane();
  updateEflow();
  scheduleSheetLayout();
  stArmOutside();
}
function closeStickerSheet() {
  if (!sts.open) return;
  sts.open = false;
  window.__stSheetOpen = false;
  window.__stOk = null;
  stDisarmOutside();
  const sheet = $('#stsheet');
  if (sheet) { sheet.hidden = true; sheet.style.transform = ''; sheet.style.maxHeight = ''; }
  markFlipSuppressed();
  resetSheetSpace();
  updateEflow();
  if (typeof layoutBook === 'function') layoutBook();
}

/* ==================== 装饰胶带：选中款式 → 在纸面上拖出一条直线 ====================
   11-17：长度不再固定。选中款式后收起面板，在纸面按住拖出一条**直线**，
   松手时按「起点 → 终点」的距离 / 角度生成一条胶带图片对象。
   ⚠️ 手指位移只取起点和当前点，不做折线 —— 胶带只能走直线。
   ⚠️ 手势走 document 的 capture 阶段并 stopPropagation：不然 stage 上的
      翻页 / 选中 / 长按菜单会跟这次拖动打架（scrub.js、page-edit.js 都挂在冒泡/capture）。
   ⚠️ 高频 pointermove 统一过 core.js 的 frameQueue，收尾 flush()。 */
const TAPE_THICK_K = .105;      // 厚度 = 纸宽 × .105（跟旧版 .42 宽 / 120:30 那条完全一致）
const TAPE_MIN_LEN = 26;        // 太短算误触，不落胶带
const tapeDrag = { active: false, pid: 0, x0: 0, y0: 0, x1: 0, y1: 0, rect: null };
const tapePreviewQ = frameQueue(paintTapePreview);

function armTape(t) {
  sts.tape = t;
  closeStickerSheet();
  const hint = $('#tapeHint');
  if (hint) {
    const nm = $('#tapeHintName'); if (nm) nm.textContent = t.n;
    hint.hidden = false;
  }
  toast('在页面上按住并拖动，拉出一条「' + t.n + '」', 2600);
}
function disarmTape() {
  sts.tape = null;
  tapeDrag.active = false;
  tapePreviewQ.cancel();
  const hint = $('#tapeHint'); if (hint) hint.hidden = true;
  const pv = $('#tapePreview'); if (pv) { pv.hidden = true; pv.style.transform = ''; }
  $$('#stTapes .st-opt').forEach(x => x.classList.remove('on'));
}
function tapeSnapshot() {
  const d = tapeDrag;
  return { x0: d.x0, y0: d.y0, x1: d.x1, y1: d.y1, thick: d.rect ? d.rect.w * TAPE_THICK_K : 30 };
}
function paintTapePreview(v) {
  const pv = $('#tapePreview');
  if (!pv || !sts.tape) return;
  const dx = v.x1 - v.x0, dy = v.y1 - v.y0;
  const len = Math.hypot(dx, dy);
  if (len < 2) { pv.hidden = true; return; }
  const h = v.thick;
  pv.hidden = false;
  pv.style.width = len.toFixed(1) + 'px';
  pv.style.height = h.toFixed(1) + 'px';
  pv.style.backgroundImage = `url("${tapeSVG(sts.tape.c, sts.tape.p, Math.max(12, len), h)}")`;
  pv.style.transform = `translate(${v.x0.toFixed(1)}px,${(v.y0 - h / 2).toFixed(1)}px) `
    + `rotate(${Math.atan2(dy, dx).toFixed(4)}rad)`;
}
function placeTape(len, rad) {
  const j = cur(), pg = j && j.pages[tapeDrag.pid];
  if (!pg || !sts.tape || !tapeDrag.rect) return;
  const r = tapeDrag.rect;
  const thick = r.w * TAPE_THICK_K;
  const w = clamp(len / r.w, .06, 1.6);
  const h = clamp(thick / r.h, .02, .9);
  const cx = (tapeDrag.x0 + tapeDrag.x1) / 2 - r.left;
  const cy = (tapeDrag.y0 + tapeDrag.y1) / 2 - r.top;
  const im = {
    id: uid(), src: tapeSVG(sts.tape.c, sts.tape.p, Math.max(12, len), Math.max(8, thick)),
    /* 对象以「未旋转包围盒」左上角定位、绕中心旋转：先把中点换回左上角 */
    x: clamp((cx - w * r.w / 2) / r.w, -.3, 1.1),
    y: clamp((cy - h * r.h / 2) / r.h, -.3, 1.1),
    w, h, rot: rad * 180 / Math.PI,
    z: nextZ(pg), locked: false
  };
  (pg.images || (pg.images = [])).push(im);
  save(); renderReader();
  toast('胶带已贴到第 ' + (tapeDrag.pid + 1) + ' 页 · 可继续拖下一条', 2200);
}
function tapeDown(e) {
  if (!sts.tape || e.button > 0) return;
  const reader = $('#reader');
  if (!reader || !reader.classList.contains('show')) return;
  const paper = e.target && e.target.closest ? e.target.closest('.paper') : null;
  if (!paper) return;
  const slot = paper.closest('.page-slot');
  let pid = slot && typeof slotPageIndex === 'function' ? slotPageIndex(slot) : -99;
  if (pid < 0 || !cur() || !cur().pages[pid]) pid = currentAddPage();
  if (pid < 0 || !cur().pages[pid]) return;
  e.preventDefault(); e.stopPropagation();
  const r = paper.getBoundingClientRect();
  tapeDrag.active = true;
  tapeDrag.pid = pid;
  tapeDrag.x0 = tapeDrag.x1 = e.clientX;
  tapeDrag.y0 = tapeDrag.y1 = e.clientY;
  tapeDrag.rect = { left: r.left, top: r.top, w: r.width, h: r.height };
  tapePreviewQ.push(tapeSnapshot());
}
function tapeMove(e) {
  if (!tapeDrag.active) return;
  e.preventDefault(); e.stopPropagation();
  tapeDrag.x1 = e.clientX; tapeDrag.y1 = e.clientY;
  tapePreviewQ.push(tapeSnapshot());
}
function tapeUp(e) {
  if (!tapeDrag.active) return;
  e.preventDefault(); e.stopPropagation();
  tapePreviewQ.flush();
  tapeDrag.active = false;
  const pv = $('#tapePreview'); if (pv) pv.hidden = true;
  const dx = tapeDrag.x1 - tapeDrag.x0, dy = tapeDrag.y1 - tapeDrag.y0;
  const len = Math.hypot(dx, dy);
  if (len < TAPE_MIN_LEN) { toast('再拖长一点，胶带只能走直线', 1800); return; }
  placeTape(len, Math.atan2(dy, dx));   // 保持 armed，可以接着拖下一条
}
(() => {
  document.addEventListener('pointerdown', tapeDown, true);
  document.addEventListener('pointermove', tapeMove, true);
  document.addEventListener('pointerup', tapeUp, true);
  document.addEventListener('pointercancel', e => {
    if (!tapeDrag.active) return;
    tapeDrag.active = false; tapePreviewQ.cancel();
    const pv = $('#tapePreview'); if (pv) pv.hidden = true;
  }, true);
  const cancel = $('#tapeHintCancel');
  if (cancel) cancel.onclick = () => { disarmTape(); toast('已退出贴胶带'); };
  window.addEventListener('keydown', e => {
    if (e.key === 'Escape' && sts.tape) { disarmTape(); e.stopPropagation(); }
  });
})();
