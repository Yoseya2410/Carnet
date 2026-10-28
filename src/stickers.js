/* =====================================================================
 * Carnet · 贴纸 · 便利贴 / 装饰胶带 / 我的贴纸   （脚本 21 / 27）
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
 *           stickerLib, addStickerToLib, removeStickerFromLib
 *
 * 依赖模块：core, visuals, state（media / text-sticker / reader-view 后置，只在运行时用）
 *
 * 说明：模块间共用全局作用域，加载顺序即依赖顺序（见 index.html 与 README）。
 * ===================================================================== */
const sts = { open: false, pid: 0, built: false, out: null, tab: 'note' };

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
function tapeSVG(color, kind) {
  const pat = tapePattern(kind, color);
  /* ⚠️ 里面写 url(#p) 这样带 # 的引用就好 —— 下面 enc() 会把 # 转成 %23，
     自己先写成 %23 的话会被 enc 再转一道（%25 23），引用就断了 */
  return enc(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 30" width="120" height="30">`
    + `<defs>${pat}<clipPath id="c"><path d="${TAPE_BODY}"/></clipPath>`
    + `<linearGradient id="g" x1="0" y1="0" x2="0" y2="1">`
    + `<stop offset="0" stop-color="rgba(0,0,0,.22)"/><stop offset=".34" stop-color="rgba(255,255,255,.22)"/>`
    + `<stop offset="1" stop-color="rgba(0,0,0,.18)"/></linearGradient></defs>`
    + `<path d="${TAPE_BODY}" fill="${color}" opacity=".9"/>`
    + (pat ? `<path d="${TAPE_BODY}" fill="url(#p)"/>` : '')
    /* 上缘压一点暗、中间留一道高光：胶带是贴在纸上的一条实物，不是一块色块 */
    + `<g clip-path="url(#c)"><rect x="0" y="0" width="120" height="30" fill="url(#g)"/></g>`
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
/* 把一张图压成贴纸素材：缩到长边 400、PNG 存（保透明） */
function packSticker(file) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onerror = () => reject(new Error('读图失败'));
    fr.onload = () => {
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
      img.src = String(fr.result);
    };
    fr.readAsDataURL(file);
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
async function removeStickerFromLib(id) {
  const lib = stickerLib();
  const i = lib.findIndex(x => x.id === id);
  if (i < 0) return;
  lib.splice(i, 1);
  state.prefs.stickers = lib;
  await saveStickerLib();
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
      <button class="st-opt tape" data-tape="${t.k}" title="${t.n}">
        <img src="${tapeSVG(t.c, t.p)}" alt="">
      </button>`).join('');
    tapes.addEventListener('click', e => {
      const b = e.target.closest('.st-opt'); if (!b) return;
      const t = TAPES.find(x => x.k === b.dataset.tape); if (!t) return;
      const im = addSticker(sts.pid, tapeSVG(t.c, t.p), .42, 30 / 120, -5.5);
      if (!im) return;
      renderReader();
      toast('胶带已加到第 ' + (sts.pid + 1) + ' 页');
    });
  }
  /* 导入按钮：选一张图 → 压成贴纸存进库 → 立刻出现在「我的贴纸」里 */
  const imp = $('#stImport'), file = $('#stFile');
  if (imp && file) {
    imp.onclick = () => file.click();
    file.onchange = async () => {
      const f = file.files && file.files[0];
      file.value = '';                          // 清掉，同一张图可以连着导两次
      if (!f) return;
      const item = await addStickerToLib(f);
      stTab('mine');
      renderMinePane();
      if (item) toast('已存进贴纸库，点它就能贴到页面上');
    };
  }
  const tabs = $('#stTabs');
  if (tabs) tabs.addEventListener('click', e => {
    const b = e.target.closest('button[data-tab]'); if (!b) return;
    stTab(b.dataset.tab);
    if (b.dataset.tab === 'mine') renderMinePane();
  });
  const mine = $('#stMine');
  if (mine) {
    /* 点贴纸 = 贴到页面上；右下角那颗 × = 从库里删掉（长按容易误触，所以给个明确的叉） */
    mine.addEventListener('click', async e => {
      const del = e.target.closest('.st-del');
      if (del) {
        e.stopPropagation();
        await removeStickerFromLib(del.dataset.del);
        renderMinePane();
        toast('已从贴纸库删除');
        return;
      }
      const b = e.target.closest('.st-opt'); if (!b) return;
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
/* 「我的贴纸」那一格：库的当前内容（导入 / 删除后都会重画一次） */
function renderMinePane() {
  const box = $('#stMine'), empty = $('#stMineEmpty');
  if (!box) return;
  const lib = stickerLib();
  box.innerHTML = lib.map(s => `
    <button class="st-opt mine" data-mine="${s.id}" title="点一下贴到页面上">
      <img src="${s.src}" alt="">
      <i class="st-del" data-del="${s.id}" title="从贴纸库删除">×</i>
    </button>`).join('');
  if (empty) empty.style.display = lib.length ? 'none' : '';
}
function stArmOutside() {
  stDisarmOutside();
  sts.out = ev => {
    if (ev.target.closest && ev.target.closest('#stsheet, #eflowTop, .cp-mask, #addMenu')) return;
    closeStickerSheet();
  };
  document.addEventListener('pointerdown', sts.out, true);
}
function stDisarmOutside() {
  if (sts.out) { document.removeEventListener('pointerdown', sts.out, true); sts.out = null; }
}
function openStickerSheet(pid) {
  const j = cur(); if (!j || !j.pages[pid]) return;
  closeAddMenu();
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
  requestAnimationFrame(() => { sheetLayout(); layoutBook(); });
  setTimeout(() => { sheetLayout(); layoutBook(); }, 340);
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
  window.__sheetCov = 0;
  const reader = $('#reader');
  if (reader) reader.style.setProperty('--stage-shift', '0px');
  updateEflow();
  if (typeof layoutBook === 'function') layoutBook();
}
