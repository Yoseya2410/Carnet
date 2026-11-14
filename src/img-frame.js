/* =====================================================================
 * Carnet · 图片边框 · 底部弹窗   （脚本 21 / 28）
 * ---------------------------------------------------------------------
 * 选中一张图片 → 工具条上的「边框」→ 从底部升起这张面板：
 * 六种框（无 / 拍立得 / 纯色 / 细线 / 相框（金色雕花图片）/ 凹陷）+ 八档预设色 + 自定义色 + 一根粗细拖动条。
 *
 * 挑一档**立刻生效**并且当场存档：跟「本页底色」那套「预览 + 完成」不一样 ——
 * 边框是加在已选中的那张图上的，一边挑一边在纸上看着变，比「挑完再确认」直观得多；
 * 不想要了就点回「无边框」，一样是一步。
 * 换框不整页重绘：只改那张图的 .pframe（paintFrame），选中态、工具条、位置全保留。
 *
 * 对外接口：openFrameSheet, closeFrameSheet, paintFrame
 *
 * 依赖模块：core, visuals, state（reader-view / text-sticker / widgets 后置，只在运行时用）
 *
 * 说明：模块间共用全局作用域，加载顺序即依赖顺序（见 index.html 与 README）。
 * ===================================================================== */
const frs = { open: false, pid: 0, iid: null, built: false };

function frObj() {
  const j = cur(); if (!j) return null;
  const pg = j.pages[frs.pid]; if (!pg) return null;
  return (pg.images || []).find(x => x.id === frs.iid) || null;
}
function frWrap() {
  return $(`#slotL .pimg-wrap[data-id="${frs.iid}"], #slotR .pimg-wrap[data-id="${frs.iid}"]`);
}
/* ---- 就地换框：只动这一张图自己的两层节点，不惊动整页 ----
   整页重绘会把选中态、工具条、正在用的手势一起冲掉，所以这里手工改：
     没框 → 有框：把 <img> 塞进一层新建的 .pframe
     有框 → 没框：把 <img> 从 .pframe 里摘出来，.pframe 删掉
     换框 / 换色 / 换粗细：.pframe 的 style 整段重写 */
function paintFrame(w, im) {
  if (!w) return;
  const img = w.querySelector('.pimg');
  if (!img) return;
  let box = w.querySelector('.pframe');
  if (!hasFrame(im)) {
    if (box) { box.parentNode.insertBefore(img, box); box.remove(); }
    img.setAttribute('style', frameImgStyle(im));
    return;
  }
  if (!box) {
    box = document.createElement('div');
    box.className = 'pframe';
    w.insertBefore(box, img);
    box.appendChild(img);
  }
  box.setAttribute('style', frameBoxStyle(im));
  img.setAttribute('style', frameImgStyle(im));
  let shade = box.querySelector('.pinset-shade');
  if (normFrame(im.fr) === 'inset') {
    if (!shade) {
      box.insertAdjacentHTML('beforeend', frameInsetHTML(im));
      shade = box.querySelector('.pinset-shade');
    }
    if (shade) shade.setAttribute('style', frameInsetStyle(im));
  } else if (shade) shade.remove();
}
/* 画完顺手把工具条上那颗「边框」点亮 / 熄灭 */
function syncFrameBtn(w, im) {
  const b = w && w.querySelector('.ob[data-ob="frame"]');
  if (b) b.classList.toggle('on', hasFrame(im));
}
/* ---- 大预览 = 纸面对象的等比缩小照片 ----
   DOM 结构跟纸面完全一致：.pimg-wrap > .pframe > .pimg，样式也全走全局那套，
   只把 .pimg-wrap 撑到纸上对象的**真实像素尺寸**再整体 scale(k)。
   ⚠️ 关键：CSS 的百分比 padding 是按「包含块宽度」算的。以前 #frDemo 的
      包含块是 79px 的缩放容器，5.4% 算出来 4.27px；纸上的 .pframe 包含块是
      230px 的对象盒，算出来 12.4px —— 预览的框一直薄一半。现在包含块 = pw，
      和纸面同一个基准；固定 px（阴影 / 颗粒 / 圆角）再由 scale 一起等比缩。
   ⚠️ frameBoxStyle 用 sc=1：px 不要预先缩，否则又变成各缩各的。 */
function updateFrDemo(im) {
  const view = $('#frDemoView'), host = $('#frDemoWrap');
  const demo = $('#frDemo'), img = $('#frDemoImg');
  if (!view || !host || !demo) return;
  const w = frWrap();
  const wr = w && w.getBoundingClientRect();
  const pw = Math.max(24, Math.round((wr && wr.width) || 160));
  const ph = Math.max(24, Math.round((wr && wr.height) || 160));
  const k = Math.min(1, 112 / Math.max(pw, ph));
  /* 预览底铺当前内页的底色，浅纸 / 深色内页都跟着变 */
  const paper = w && w.closest('.paper');
  if (paper) {
    const bg = getComputedStyle(paper).backgroundColor;
    if (bg && bg !== 'rgba(0, 0, 0, 0)') view.style.backgroundColor = bg;
  }
  view.style.width = Math.round(pw * k) + 'px';
  view.style.height = Math.round(ph * k) + 'px';
  host.setAttribute('style',
    `width:${pw}px;height:${ph}px;transform-origin:top left;transform:scale(${k});`);
  /* 只复制会影响图片铺法的结构类：fill / fit / sticker / tiny 会改 object-fit 与底色 */
  if (w) ['fill', 'fit', 'sticker', 'tiny'].forEach(c =>
    host.classList.toggle(c, w.classList.contains(c)));
  demo.setAttribute('style', frameBoxStyle(im, 1));
  if (img) {
    /* 拖动中每帧重设大图 dataURL 会反复解码，滑块就卡住了：图没换就别写 src */
    if (img.getAttribute('src') !== im.src) img.setAttribute('src', im.src);
    img.setAttribute('style', frameImgStyle(im));
  }
  let shade = demo.querySelector('.pinset-shade');
  if (normFrame(im.fr) === 'inset') {
    if (!shade) {
      demo.insertAdjacentHTML('beforeend', frameInsetHTML(im, 1));
      shade = demo.querySelector('.pinset-shade');
    }
    if (shade) shade.setAttribute('style', frameInsetStyle(im, 1));
  } else if (shade) shade.remove();
}
/* ==================== 面板 ==================== */
/* light = 正在拖粗细：只改纸上和大预览的样式，跳过工具条避让 / 面板重建 / 滑块回写 */
function frApply(light) {
  const im = frObj(); if (!im) return;
  const w = frWrap();
  paintFrame(w, im);
  syncFrameBtn(w, im);
  save();
  if (w && !light) fitObjBar(w);
  syncFrSheet(!!light);
}
/* 点同一种框 = 取消（换回无边框）：挑错了不用再去点「无」 */
function pickFrame(k) {
  const im = frObj(); if (!im) return;
  im.fr = (normFrame(im.fr) === k && k !== 'none') ? 'none' : normFrame(k);
  if (!hasFrame(im)) { delete im.frc; delete im.frw; }
  frApply();
}
function pickFrameColor(hex) {
  const im = frObj(); if (!im) return;
  const c = normHex6(hex);
  if (c) im.frc = c; else delete im.frc;
  /* 现在是无边框：挑颜色时顺手给一档「纯色」，不然挑了半天看不出变化 */
  if (!hasFrame(im)) { im.fr = 'color'; if (!im.frw) im.frw = 2; }
  frApply();
}
function pickFrameWidth(v, light) {
  const im = frObj(); if (!im) return;
  /* 凹陷档没有「边框宽度」可调（粗细行已禁用、几何全固定）：挡住键盘 / 程序调用 */
  if (normFrame(im.fr) === 'inset') return;
  im.frw = clamp(Math.round(+v || FRAME_W_DEFAULT), 1, 100);
  /* 标记成「新版连续值」：1~5 别再被 frameWidth() 当成老数据的 1/2/3 档折算 */
  im.frwV = 1;
  if (!hasFrame(im)) { im.fr = 'color'; if (!im.frc) im.frc = '#ffffff'; }
  frApply(!!light);
}
/* 一次建好，之后只刷选中态 */
function buildFrSheet() {
  const g = $('#frGrid');
  if (g) {
    g.innerHTML = FRAMES.map(f =>
      `<button class="fr-opt" data-fr="${f.k}" title="${f.n}">`
      + `<span class="fr-ico" data-fr="${f.k}"><i></i></span><span class="fr-n">${f.n}</span></button>`).join('');
    /* 「相框」小样直接铺同一张素材（整张拉满，白窗正好被 i 盖住）。
       只在建面板时写一次：这串是 70KB 的 data URL，跟着颜色 / 粗细每帧重写会白白触发解码。 */
    const pico = g.querySelector('.fr-ico[data-fr="photo"]');
    if (pico) pico.style.background = `url('${FRAME_PHOTO_URL}') center/100% 100% no-repeat`;
    g.addEventListener('click', e => {
      const b = e.target.closest('.fr-opt'); if (!b) return;
      pickFrame(b.dataset.fr);
    });
  }
  const c = $('#frColors');
  if (c) {
    c.innerHTML = FRAME_COLORS.map(x =>
      `<button data-frcolor="${x}" style="background:${x}" title="${x}"></button>`).join('')
      + `<button class="custom" id="frColorCustom" title="自定义边框颜色"><span class="cus-ico">＋</span></button>`;
    c.addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.id === 'frColorCustom') {
        openColorPicker('自定义边框颜色', (frObj() && normHex6(frObj().frc)) || '', hex => pickFrameColor(hex));
        return;
      }
      if (b.dataset.frcolor) pickFrameColor(b.dataset.frcolor);
    });
  }
  /* 粗细是一根拖动条（1~100 连续），不是三档按钮 —— 边框粗细这种东西，
     手指拖着看纸上变化比「细 / 中 / 粗」三档选一个准得多。
     ⚠️ 每次 input 直接同步应用，别再走 rAF 合帧：以前合帧把一帧里的多次 input
        压成最后一次，而 frApply 每帧都完整重刷面板（重设大图 src、回写滑块值、
        重建五档小样），拖起来一跳一跳、frw 还常停在旧值。
        现在拖动时 frApply(true) 只改纸上 + 大预览两个 style，很轻；
        松手（change）再做一次完整同步，把滑块 / 小样 / 选中态对齐。 */
  const w = $('#frWidth');
  if (w) {
    w.min = '1'; w.max = '100'; w.step = '1';
    w.addEventListener('input', () => {
      const n = $('#frWidthVal');
      if (n) n.textContent = w.value;      // 数字本身很轻，即时跟手
      pickFrameWidth(w.value, true);
    });
    w.addEventListener('change', () => pickFrameWidth(w.value, false));
  }
  const done = $('#frDone');
  if (done) done.onclick = closeFrameSheet;
  frs.built = true;
}
function syncFrSheet(light) {
  const im = frObj(); if (!im) return;
  /* 拖粗细的时候面板其余部分都不动，只让大预览跟上纸面 */
  if (light) { updateFrDemo(im); return; }
  const k = normFrame(im.fr);
  $$('#frGrid .fr-opt').forEach(b => b.classList.toggle('on', b.dataset.fr === k));
  const c = normHex6(im.frc) || '';
  $$('#frColors button[data-frcolor]').forEach(b =>
    b.classList.toggle('on', !!c && normHex6(b.dataset.frcolor) === c));
  const cus = $('#frColorCustom');
  if (cus) {
    const mine = !!c && !FRAME_COLORS.some(x => normHex6(x) === c);
    cus.classList.toggle('on', mine);
    cus.style.background = mine ? c : '';
  }
  /* 拖动条当前值：换张图 / 松手时对齐；拖动途中**不回写**，免得把手指顶回去 */
  const wv = frameWidth(im), sl = $('#frWidth'), wn = $('#frWidthVal');
  if (sl) { sl.value = wv; sl.disabled = (k === 'inset'); }
  if (wn) wn.textContent = wv;
  updateFrDemo(im);
  /* 五档小样里的颜色跟着当前边框色走：挑颜色的时候几张小样一起变，不用一档档点过去看 */
  const shown = c || FRAME_DEFAULT_COLOR[k] || '#ffffff';
  $$('#frGrid .fr-ico').forEach(el => {
    const kind = el.dataset.fr;
    if (kind === 'color') el.style.background = shown;
    /* 凹陷档没有坑壁、边框色对它无意义，不上用户选的边框色 */
    else if (kind === 'inset') el.style.background = '';
    /* 相框档的素材在 buildFrSheet 里一次写好，不跟着边框色重刷 */
    else if (kind === 'line') {
      const i = el.querySelector('i');
      if (i) i.style.boxShadow = `inset 0 0 0 1.6px ${shown}`;
    }
  });
  /* 无边框、凹陷、相框都没有「边框颜色」可挑：凹陷是「图片直接压进纸里」、
     没有坑壁也没有框条，相框是固定素材（金色雕花图片，染不上色）。颜色行淡下去。
     ⚠️ 只有**凹陷**档把粗细彻底禁用（几何全固定，拖了也不会变）：标题 + 滑块一起淡、
     input.disabled。无边框档沿用老行为 —— 标题淡但滑块仍可拖，一拖就自动切到纯色档，
     别把这条便捷路径一起关掉；相框的框条、其余档照常可拖。 */
  const noColor = (k === 'none' || k === 'inset' || k === 'photo');
  const wrow = $('#frWidthRow');
  if (wrow) wrow.classList.toggle('dim', k === 'none' || k === 'inset');
  /* ⚠️ #frsheet 里那根滑块只有 data-page-node-id、没有 id，用类选择器找 */
  const wslider = $('#frsheet .fr-slider');
  if (wslider) wslider.classList.toggle('dim', k === 'inset');
  const row = $('#frColorRow');
  if (row) row.classList.toggle('dim', noColor);
  const dots = $('#frColors');
  if (dots) dots.classList.toggle('dim', noColor);
  const hint = $('#frHint');
  if (hint) hint.textContent = (FRAMES.find(f => f.k === k) || FRAMES[0]).n;
}
/* 点面板外面就收面板（改动已经当场存过了，收面板 ≠ 撤销） */
function frArmOutside() { armSheetOutside('#frsheet', closeFrameSheet); }
function frDisarmOutside() { disarmSheetOutside(); }
function openFrameSheet(pid, iid) {
  const j = cur(); if (!j) return;
  const pg = j.pages[pid]; if (!pg) return;
  if (!(pg.images || []).some(x => x.id === iid)) return;
  closeAddMenu();
  /* 别的编辑面板让位：同一时刻只开一张 */
  if (typeof hideTextBar === 'function' && typeof sh !== 'undefined' && sh && sh.open) hideTextBar();
  if (typeof closeBgSheet === 'function') closeBgSheet();
  if (typeof closeStickerSheet === 'function') closeStickerSheet();
  frs.open = true; frs.pid = pid; frs.iid = iid;
  window.__frSheetOpen = true;
  window.__frOk = closeFrameSheet;
  if (!frs.built) buildFrSheet();
  const sheet = $('#frsheet'); if (!sheet) return;
  sheet.hidden = false;
  syncFrSheet();
  updateEflow();
  /* ⚠️ 面板升起会 layoutBook() 把书缩小，syncFrSheet 里量到的对象尺寸是**布局前**的，
     预览按旧尺寸画就会比纸上厚/薄（实测纯色档 12.4px vs 9.8px）。
     rAF 落定和 340ms 收尾各补画一次，预览始终按最终尺寸重算。 */
  const redrawDemo = () => { const im = frObj(); if (im) updateFrDemo(im); };
  scheduleSheetLayout(
    () => { if (typeof refitObjBars === 'function') refitObjBars(); redrawDemo(); },
    redrawDemo
  );
  frArmOutside();
}
function closeFrameSheet() {
  if (!frs.open) return;
  frs.open = false;
  window.__frSheetOpen = false;
  window.__frOk = null;
  frDisarmOutside();
  const sheet = $('#frsheet');
  if (sheet) { sheet.hidden = true; sheet.style.transform = ''; sheet.style.maxHeight = ''; }
  markFlipSuppressed();
  resetSheetSpace();
  updateEflow();
  if (typeof layoutBook === 'function') layoutBook();
}
