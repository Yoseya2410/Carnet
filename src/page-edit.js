/* =====================================================================
 * Carnet · 页面内容编辑 · 图片与文字对象   （脚本 16 / 28）
 * ---------------------------------------------------------------------
 * ① bindPage：页面手势（拖动 / 四角拉伸 / 旋转 / 长按解锁）；首绘时把文字贴框收紧到内容
 *    图片四角 = 自由拉伸；文字贴四角 = 整块等比缩放（框宽、框高、字号同乘一个系数）
 * ② 选中对象后的胶囊工具条 objAction：完成 ✓ / 复制（只存剪贴板，粘贴才生成一份）/ 剪切（触屏且已编辑过）/ 换图（仅图片）/ 字随框缩放（仅文字）/ 编辑 / 删除
 * ③ 右上角「添加」菜单：加页 / 加图片 / 加文字 / 本页底色 / 删本页，目标页判定 currentAddPage
 * ④ 文字贴两种手势各管一件事（编辑逻辑在 text-sticker.js）：
 *    长按 = 版式态 .boxmode：解除固定 → 选中 → 拖动挪位置 + 四角改大小 + 旋转手柄；
 *    双击 = 内容态 .editing：只改文字，手柄收起、拖不动、缩不了；
 *    单击零反应（手势归翻页）。.boxmode 只活在本次选中里，不写进数据。
 *    ⚠️ 文字贴的最小尺寸按「一个字 / 一行」算，绝不能套图片那套 IMG_MIN_*（见四角拉伸分支）
 * ⑤ 纸面右键菜单 + 对象级剪贴板：桌面右键、触屏长按**空白纸面**都弹菜单（复制 / 剪切 / 粘贴）；
   触屏长按内容不弹，复制 / 剪切走胶囊工具条，粘贴不进工具条
 *
 * 对外接口：bindPage, objAction, addImageTo, addTextTo, currentAddPage, toggleAddMenu,
 *           clipSet, clipCopy, clipCut, clipPasteAt
 *
 * 依赖模块：core, state（media / text-sticker / page-bg 后置，只在运行时回调里用）
 *
 * 说明：模块间共用全局作用域，加载顺序即依赖顺序（见 index.html 与 README）。
 * ===================================================================== */
/* 对象允许露出纸面的范围（比例）：-.15 = 最多探出左边 15%，.95 = 最多探出右边 5%，
   目的是对象不会被完全拖出纸面找不回来 */
const OBJ_MIN = -0.15, OBJ_MAX = 0.95;

/* ==================== 工具条上的四个动作 ==================== */
/* 点一下对象就选中它，工具条（.objbar，长在对象内部）随即展开：
   完成 = 固定并收起；复制 = 原样再来一份；编辑 = 文字开面板 / 图片铺满还原；删除 = 移掉 */
function objAction(act, w, pid, iid, isText) {
  const pg = cur() && cur().pages[pid]; if (!pg) return;
  const arr = isText ? pageTexts(pg) : (pg.images || []);
  const im = arr.find(x => x.id === iid); if (!im) return;
  /* 正在行内打字时点工具条：先把打的字落盘（但不重绘），再执行动作 ——
     不然复制 / 删除拿到的还是编辑前的那份数据 */
  if (isText && w && w.classList && w.classList.contains('editing')) stopTextEdit(w, true, true);
  /* 触屏工具条：下面这些「真的在改这个对象」的动作会把它标记为已编辑，
     之后胶囊工具条上才露出「剪切」。单纯的复制 / 完成不算。 */
  const touchEdit = () => markObjEdited(iid);
  const disarmOut = () => { if (w.__outDown) { document.removeEventListener('pointerdown', w.__outDown, true); w.__outDown = null; } };
  const finish = () => {                             // 完成 = 固定到这一页
    im.locked = true; save();
    w.classList.add('locked');
    w.classList.remove('adjust', 'sel', 'boxmode');
    disarmOut();
    if (isText) { hideTextBar(); }                    // 面板一起收掉（内部会重绘）
    else { w.classList.add('justlock'); setTimeout(() => w.classList.remove('justlock'), 460); renderReader(); toast('已固定在第 ' + (pid + 1) + ' 页 · 长按可重新移动'); }
  };
  if (act === 'close') { finish(); return; }
  if (act === 'copy') {
    /* ⚠️ 复制**只进对象级剪贴板**，不在这里就地生一份：
       要得到新对象必须再执行一次「粘贴」（触屏空白长按菜单 / 桌面右键 / Ctrl+V）。
       跟右键「复制」、Ctrl+C 走的是同一条 clipCopy，三者表现一致。 */
    const ref = clipRefFromWrap(w) || clipSelectedRef();
    if (!ref) { toast('先选中一个文字框或图片再复制'); return; }
    clipCopy(ref);
    return;
  }
  /* 触屏：剪切收进胶囊工具条（只对编辑过的对象露出）；粘贴不放工具条，
     统一走空白纸面长按弹出的那张菜单。剪切复用对象级剪贴板。 */
  if (act === 'cut') {
    const ref = clipRefFromWrap(w) || clipSelectedRef();
    if (!ref) { toast('先选中一个文字框或图片再剪切'); return; }
    clipCut(ref);
    editedObjs.delete(iid);
    return;
  }
  /* 换图：弹出选图框，选完只换掉这张图的图源 —— 位置 / 大小 / 旋转 / 上下层原样保留。
     真正的换图动作在 media.js（#swapFile 的 change），这里只负责记住要换哪一张 */
  if (act === 'swap') {
    if (isText) return;
    touchEdit();
    state.swapTarget = { pid, iid };
    const sp = $('#swapFile'); if (sp) sp.click();
    return;
  }
  /* 图片边框：开底部那张面板（拍立得 / 纯色 / 细线 / 相框 / 凹陷 + 自定义颜色 + 粗细）。
     面板已经开着且就是这一张 → 再点一次收起来 */
  if (act === 'frame') {
    if (isText) return;
    if (typeof frs !== 'undefined' && frs.open && frs.iid === iid) { closeFrameSheet(); return; }
    touchEdit();
    openFrameSheet(pid, iid);
    return;
  }
  /* 文字贴「字随框缩放」开关：只改这一个对象的模式，存进数据里，整页重绘后状态还在。
     关掉之后拖四角就是老的自由拉伸（字号不动）；桌面临时按住 Alt 拖也是这个效果。 */
  if (act === 'fslink') {
    if (!isText) return;
    const on = im.fsLink === false;        // 原来是关 → 现在开；原来是开 → 现在关
    touchEdit();
    im.fsLink = on;
    save();
    $$('.objbar .ob[data-ob="fslink"]').forEach(b => {
      b.classList.toggle('on', on);
      b.title = on ? '字随框缩放：开 · 点一下改成只改框' : '字随框缩放：关 · 点一下让字跟着框变大变小';
    });
    toast(on ? '字随框缩放 · 拖四角字会跟着变大变小' : '只改框 · 字号不变');
    return;
  }
  if (act === 'del') {
    const k = arr.indexOf(im); if (k >= 0) arr.splice(k, 1);
    editedObjs.delete(iid);
    disarmOut();
    save();
    if (isText) {
      /* 面板开着先收掉，再整页重绘 —— 少了 renderReader 的话节点还挂在页面上，看着像没删掉 */
      hideTextBar();
      renderReader();
      toast('已删除文字');
    }
    else { renderReader(); toast('已删除图片'); }
    return;
  }
  /* 编辑：文字开编辑面板；图片在「铺满整页 / 还原原比例」之间切 */
  touchEdit();
  if (isText) { openTextSheet(pid, iid); return; }
  if (im.fill) {
    imgRatio(im.src).then(r => {
      im.fill = false; im.locked = false;
      im.w = .42;
      im.h = clamp(im.w * r * paperAspect(), .04, IMG_MAX);
      im.x = .22; im.y = .2;
      save(); renderReader();
      const nw = $(`#slotL .pimg-wrap[data-id="${iid}"], #slotR .pimg-wrap[data-id="${iid}"]`);
      if (nw) { nw.classList.add('sel'); syncBar(nw, im); fitObjBar(nw); }
      toast('已还原原比例');
    });
  } else {
    /* 铺满整页 = 整张图完整落进纸里（不裁切、不拉伸，等比撑到最大再居中，见 fillGeom）；
       顺手固定：不然整张纸都是图片，左右一划就成了拖图，翻不了页 */
    im.fill = true; im.locked = true;
    /* 要先解码图片才量得到比例，所以是异步的：先按原盒子 + contain 画一帧（已经不裁了），
       量完再按新几何重绘一次 */
    applyFillGeom(im).then(() => {
      save(); renderReader();
      toast('已铺满整页 · 完整显示不裁切 · 已固定，长按可解锁');
    });
  }
}

/* ==================== 纸面右键 / 对象级剪贴板 ====================
   复制的是「一整块文字贴或图片」，不是系统剪贴板里的一段字：工具条「复制」、
   右键「复制 / 剪切」、Ctrl+C / Ctrl+X 都往 paperClip 存一份深拷贝；
   「粘贴」把它落在右键那一刻的那一页、以光标为中心，能跨页贴。
   内部剪贴板空着时，粘贴会去读系统剪贴板：纯文本落成文字贴、图片落成图片对象。
   ⚠️ 剪贴板只活在内存里 —— 图片是 dataURL，写进存档会白白多一份大字符串。 */
let paperClip = null;               // { kind:'text'|'image', data:{...} }
let paperMenuCtx = null;            // 这次右键：{ pid, x, y, ref }
let paperLastPt = null;             // 最近一次右键落点（键盘粘贴没有坐标时用）

function clipReaderOn() {
  const r = $('#reader'); return !!(r && r.classList.contains('show'));
}
/* 正在打字 / 框选了一段文字时，Ctrl+C 这些交给浏览器，别抢 */
function clipTyping() {
  const a = document.activeElement;
  if (a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.isContentEditable)) return true;
  const s = window.getSelection && window.getSelection();
  return !!(s && !s.isCollapsed && String(s).trim());
}
function clipRefFromWrap(w) {
  if (!w || !w.isConnected) return null;
  const pid = +w.dataset.page, iid = w.dataset.id;
  const isText = w.classList.contains('ptext-wrap');
  const pg = cur() && cur().pages[pid];
  if (!pg || !Number.isFinite(pid)) return null;
  const arr = isText ? pageTexts(pg) : (pg.images || []);
  const o = arr.find(x => x.id === iid);
  return o ? { pid, iid, isText, o, w } : null;
}
function clipWrapOf(pid, iid, isText) {
  const cls = isText ? 'ptext-wrap' : 'pimg-wrap';
  return $(`#slotL .${cls}[data-id="${iid}"], #slotR .${cls}[data-id="${iid}"]`);
}
/* 当前选中的对象：图片看 .sel，文字看 .adjust / .boxmode；面板刚收掉时退回 selText */
function clipSelectedRef() {
  let ref = clipRefFromWrap($('.pimg-wrap.sel, .ptext-wrap.adjust, .ptext-wrap.boxmode'));
  if (!ref && typeof selText !== 'undefined' && selText)
    ref = clipRefFromWrap(clipWrapOf(selText.pid, selText.iid, true));
  return ref;
}
function clipWriteSystemText(o) {
  const s = ((o && o.text) || '').trim();
  if (!s || !navigator.clipboard || !navigator.clipboard.writeText) return;
  try { const p = navigator.clipboard.writeText(s); if (p && p.catch) p.catch(() => {}); } catch (_) {}
}
function clipSet(kind, o) {
  if (!o) return;
  paperClip = { kind, data: JSON.parse(JSON.stringify(o)) };
  if (kind === 'text') clipWriteSystemText(o);
}
function clipCopy(ref) {
  if (!ref) return false;
  const now = clipRefFromWrap(clipWrapOf(ref.pid, ref.iid, ref.isText)) || ref;
  clipSet(now.isText ? 'text' : 'image', now.o);
  toast(now.isText ? '已复制文字 · 粘贴后才会生成一份' : '已复制图片 · 粘贴后才会生成一份');
  return true;
}
function clipCut(ref) {
  if (!ref) return false;
  clipCopy(ref);
  objAction('del', clipWrapOf(ref.pid, ref.iid, ref.isText) || ref.w, ref.pid, ref.iid, ref.isText);
  toast(ref.isText ? '已剪切文字 · 可粘贴到别处' : '已剪切图片 · 可粘贴到别处');
  return true;
}
/* 落点以右键为中心；贴出来的一份保持解锁 + 选中，抬手就能直接拖走 */
function clipPasteAt(pid, x, y) {
  const j = cur(); const pg = j && j.pages[pid];
  if (!pg || !paperClip) return false;
  const { kind, data } = paperClip;
  const o = JSON.parse(JSON.stringify(data));
  o.id = uid();
  o.z = nextZ(pg);
  o.locked = false;
  const w = clamp(o.w || .3, .02, IMG_MAX);
  const h = clamp(o.h || w / .68, .02, IMG_MAX);
  o.x = clamp((x ?? .5) - w / 2, OBJ_MIN, OBJ_MAX);
  o.y = clamp((y ?? .5) - h / 2, OBJ_MIN, OBJ_MAX);
  if (kind === 'text') pageTexts(pg).push(o);
  else (pg.images || (pg.images = [])).push(o);
  save(); renderReader();
  const nw = clipWrapOf(pid, o.id, kind === 'text');
  if (nw) {
    if (kind === 'text') {
      showTextBar(nw, pid, o.id);        // 内部会重设 selText / 工具条 / 避让
      nw.classList.add('boxmode');
      if (selText) selText.box = true;
    } else { nw.classList.add('sel'); syncBar(nw, o); fitObjBar(nw); }
  }
  toast((kind === 'text' ? '已粘贴文字' : '已粘贴图片') + ' · 第 ' + (pid + 1) + ' 页');
  return true;
}
/* 外部复制来的东西：图片走文件读取（跟「添加图片」同一套比例算法），文字落成文字贴 */
async function clipPasteExternal(pid, x, y, file, text) {
  const j = cur(); const pg = j && j.pages[pid]; if (!pg) return false;
  if (file && /^image\//.test(file.type || '')) {
    const src = await readFileDataURL(file);
    if (!src) { toast('这张图读不出来'); return false; }
    const w = .42;
    const h = clamp(w * (await imgRatio(src)) * paperAspect(), .04, IMG_MAX);
    (pg.images || (pg.images = [])).push({
      id: uid(), src,
      x: clamp((x ?? .5) - w / 2, OBJ_MIN, OBJ_MAX), y: clamp((y ?? .5) - h / 2, OBJ_MIN, OBJ_MAX),
      w, h, z: nextZ(pg), locked: false
    });
    save(); renderReader();
    toast('已粘贴图片 · 第 ' + (pid + 1) + ' 页');
    return true;
  }
  const s = String(text || '').trim();
  if (!s) return false;
  const t = newText(clamp((x ?? .5) - .15, .02, .8), clamp((y ?? .5) - .03, .02, .9), s);
  t.z = nextZ(pg); t.locked = false;
  pageTexts(pg).push(t);
  save(); renderReader();
  const nw = clipWrapOf(pid, t.id, true);
  if (nw) {
    showTextBar(nw, pid, t.id);
    nw.classList.add('boxmode');
    if (selText) selText.box = true;
  }
  toast('已粘贴文字 · 第 ' + (pid + 1) + ' 页');
  return true;
}
function clipPasteTarget() {
  const j = cur(); if (!j || !j.pages.length) return null;
  /* 键盘粘贴没有坐标：最近一次右键那一页还摊在眼前就贴回那一页，
     不然「在右页剪切 → Ctrl+V」会莫名跑到左页去 */
  const vis = currentIndices();
  if (paperLastPt && vis.indexOf(paperLastPt.pid) >= 0 && j.pages[paperLastPt.pid])
    return { pid: paperLastPt.pid, x: paperLastPt.x, y: paperLastPt.y };
  const pid = currentAddPage();
  if (!j.pages[pid]) return null;
  return { pid, x: .5, y: .5 };
}
/* 右键菜单：复制 / 剪切只在指着某个对象时可用；粘贴永远可点（系统剪贴板也可能有东西） */
function closePaperMenu() {
  const m = $('#paperMenu'); if (m) m.classList.remove('show');
  paperMenuCtx = null;
}
function openPaperMenu(e) {
  const m = $('#paperMenu'); if (!m) return;
  const paper = e.target.closest('.paper');
  if (!paper || paper.classList.contains('coverpage')
      || paper.classList.contains('cover-inside') || paper.classList.contains('endpaper')) return;
  const slot = e.target.closest('#slotL, #slotR');
  if (!slot) return;                       // 翻页叶片上的临时纸不算
  const pid = slotPageIndex(slot);
  if (pid < 0 || !cur() || !cur().pages[pid]) return;
  e.preventDefault();
  const pr = paper.getBoundingClientRect();
  /* 指着某个对象就针对它；点在空白纸上则退回到「当前选中的对象」，
     这样先选中再在别处右键也能复制 / 剪切，不必非点在对象上 */
  const ref = clipRefFromWrap(e.target.closest('.pimg-wrap, .ptext-wrap')) || clipSelectedRef();
  paperMenuCtx = {
    pid, ref,
    x: pr.width ? clamp((e.clientX - pr.left) / pr.width, 0, 1) : .5,
    y: pr.height ? clamp((e.clientY - pr.top) / pr.height, 0, 1) : .5
  };
  paperLastPt = { pid, x: paperMenuCtx.x, y: paperMenuCtx.y };
  const q = k => m.querySelector(`[data-clip="${k}"]`);
  q('copy').disabled = !ref;
  q('cut').disabled = !ref;
  q('paste').disabled = false;
  const hint = $('#pmHint');
  if (hint) hint.textContent = paperClip ? (paperClip.kind === 'text' ? '· 一段文字' : '· 一张图片') : '';
  m.classList.add('show');
  const r = m.getBoundingClientRect();
  m.style.left = clamp(e.clientX, 8, Math.max(8, window.innerWidth - r.width - 8)) + 'px';
  m.style.top = clamp(e.clientY, 8, Math.max(8, window.innerHeight - r.height - 8)) + 'px';
}
function clipPasteMenu(c) {
  if (!c) return;
  if (paperClip) { clipPasteAt(c.pid, c.x, c.y); return; }
  /* 内部剪贴板空：向系统剪贴板要（图片优先，其次纯文本）。
     这一步必须由右键菜单里的点击触发，浏览器才认作用户手势。 */
  (async () => {
    let file = null, text = '';
    try {
      if (navigator.clipboard && navigator.clipboard.read) {
        for (const it of await navigator.clipboard.read()) {
          const ty = (it.types || []).find(t => t.indexOf('image/') === 0);
          if (ty && !file) {
            const blob = await it.getType(ty);
            file = new File([blob], 'pasted.' + (ty.split('/')[1] || 'png'), { type: ty });
          }
        }
      }
    } catch (_) {}
    if (!file && navigator.clipboard && navigator.clipboard.readText) {
      try { text = await navigator.clipboard.readText(); } catch (_) {}
    }
    if (!file && !text.trim()) { toast('剪贴板里没有可粘贴的内容'); return; }
    clipPasteExternal(c.pid, c.x, c.y, file, text);
  })();
}

function bindPage() {
  /* 拖动 / 拉伸 / 旋转统一走这里。pointermove 在 120Hz 屏上一秒能来 120+ 次，
     来一次就改一次样式会把主线程挤爆（拖动就会一顿一顿的）。
     这里把事件攒起来、一帧只跑一次 move，收尾时把最后那一下补上，位置一点不丢。 */
  const track = (startX, startY, move, done) => {
    let raf = 0, last = null;
    const run = () => { raf = 0; if (last) move(last, startX, startY); };
    const mv = ev => { last = ev; if (!raf) raf = requestAnimationFrame(run); };
    const up = () => {
      if (raf) { cancelAnimationFrame(raf); raf = 0; }
      if (last) move(last, startX, startY);        // 攒着没画的那一帧别丢，否则松手位置会差一点
      window.removeEventListener('pointermove', mv);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      done && done();
    };
    window.addEventListener('pointermove', mv);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    return up;                           // 交出去，好在别处提前收手（旋转手柄双击摆正要用）
  };

  $$('#slotL .pimg-wrap, #slotR .pimg-wrap, #slotL .ptext-wrap, #slotR .ptext-wrap').forEach(w => {
    let pid = +w.dataset.page;         // 可能被跨页拖到另一页，所以不能是 const
    const iid = w.dataset.id;
    const isText = w.classList.contains('ptext-wrap');
    /* 图片和文字共用一套拖拽 / 缩放 / 删除逻辑；
       纸（.paper）也可能换（跨页拖迁会连节点一起搬），所以一律现取 */
    const elPaper = () => w.closest('.paper');
    const getIm = () => {
      const pg = cur().pages[pid]; if (!pg) return null;
      return isText ? pageTexts(pg).find(x => x.id === iid) : (pg.images || []).find(x => x.id === iid);
    };
    /* 触屏工具条：动过这个对象（长按解锁 / 拖动 / 拉伸 / 打字 / 改框…）才把
       「剪切」放出来；刚添加还没碰过的内容先收着。整页重绘由 editedObjs 重建 class。 */
    const markEdited = () => { markObjEdited(iid); w.classList.add('obj-edited'); };
    /* 文字贴第一次画到纸上就把框收紧到内容：老本子 / 新建文字贴都还带着
       newText 的 .56 × .12 大方框。fitV 是贴合算法版本，一个对象只贴一次，
       之后翻页来回重绘不会反复改数据（算法在 text-sticker.js 的 fitTextBox）。 */
    if (isText) {
      const t0 = getIm();
      if (t0 && t0.fitV !== TEXT_FIT_V) {
        const el0 = w.querySelector('.ptxt');
        if (el0 && fitTextBox(w, el0, false, t0)) save();
      }
    }
    const disarmOut = () => {
      if (w.__outDown) { document.removeEventListener('pointerdown', w.__outDown, true); w.__outDown = null; }
    };
    const realign = () => { const im = getIm(); syncBar(w, im); fitObjBar(w); };

    /* ==================== 跨页拖迁：把对象从左页拖到右页（或反过来） ====================
       只在双页摊开、两页都是真内页时可用。做过三件事：
         ① 数据：对象从本页的数组里摘下来，挂进另一页的数组，顺手重排 z（压在那页最上面）
         ② DOM：Wrapper 节点跟着搬进另一页的 .pcontent，data-page 改成新页号
         ③ 坐标：按「屏幕位置不动」反算新页里的百分比 —— 手势不断，手上那点位移也不断掉
       给目标纸描一道高光（.drop-in），拖过去看得见落点；松手时（各个 drag 的 done 里）撤掉。
       ⚠️ 不能用 getBoundingClientRect 来算新坐标：那是「转过之后」的外接框，
          转了角度的文字 / 图片会歪掉；一律按 left + x × width 自己算（跟 fitObjBar 一个规矩） */
    let crossLit = null;                                  // 正在高亮的那一张纸
    const unCross = () => { if (crossLit) { crossLit.classList.remove('drop-in'); crossLit = null; } };
    /* 过去了返回 true（调用方据此就地重设拖动的基准）；没过去返回 false */
    const tryCrossPage = ev => {
      /* 只有双页摊开才是「左右两页」；停在封面（整页视图）时不算 */
      if (state.mode !== 'spread' || isCoverView()) { unCross(); return false; }
      const j = cur(); if (!j) { unCross(); return false; }
      const [a, b] = currentIndices();
      const to = pid === a ? b : (pid === b ? a : -1);
      if (to < 0 || !j.pages[to]) { unCross(); return false; }
      const target = $(to === a ? '#slotL .paper' : '#slotR .paper');
      const dst = target && target.querySelector('.pcontent');
      if (!dst || target.classList.contains('endpaper') || target.classList.contains('coverpage')) { unCross(); return false; }
      const im = getIm(); if (!im) { unCross(); return false; }
      const tr = target.getBoundingClientRect();
      if (tr.width < 8 || tr.height < 8) return false;
      /* 再往里 12px 才算真的过去：不然停在中缝上会来回跳 */
      const IN = 12;
      const over = to < pid ? ev.clientX < tr.right - IN : ev.clientX > tr.left + IN;
      if (!over) return false;                              // 没过去就原样：高光由「落在哪一页」决定，不清
      const srcArr = isText ? pageTexts(j.pages[pid]) : (j.pages[pid].images || []);
      const k = srcArr.findIndex(x => x.id === iid);
      if (k < 0) return false;
      const from = w.closest('.paper');
      const fr = from ? from.getBoundingClientRect() : tr;
      const obj = srcArr.splice(k, 1)[0];                 // ① 数据搬家（同一个对象实例，引用不变）
      const dstArr = isText ? pageTexts(j.pages[to]) : (j.pages[to].images || (j.pages[to].images = []));
      obj.z = nextZ(j.pages[to]);
      dstArr.push(obj);
      /* ③ 屏幕位置不动 → 换算成新页里的百分比。
         落点可能探到新页外面（原本贴在左页右边的图，换算到右页就是左边界外），
         这里按 OBJ_MIN / OBJ_MAX 收一把：越过这个小范围的对象会被拉回来一点，
         总好过整个挂在页外看不见（纸是有 overflow:hidden 的） */
      const sx0 = fr.left + im.x * fr.width, sy0 = fr.top + im.y * fr.height;
      im.x = clamp((sx0 - tr.left) / tr.width, OBJ_MIN, OBJ_MAX);
      im.y = clamp((sy0 - tr.top) / tr.height, OBJ_MIN, OBJ_MAX);
      dst.appendChild(w);                                 // ② 节点搬家
      pid = to; w.dataset.page = to;
      w.style.left = (im.x * 100).toFixed(2) + '%';
      w.style.top = (im.y * 100).toFixed(2) + '%';
      /* 选中态跟着挪：数据换了页，那些「记住是第几页」的地方要指向新页 */
      try {
        if (typeof selText !== 'undefined' && selText && selText.iid === iid) selText.pid = to;
        if (typeof sh !== 'undefined' && sh && sh.open && sh.iid === iid) sh.pid = to;
      } catch (_) {}
      unCross();
      crossLit = target; target.classList.add('drop-in');
      return true;
    };

    /* 文字贴：解锁 → 选中（虚线框 + 工具条）；点框外自动重新固定 */
    const lockText = () => {
      const im = getIm(); if (!im) return;
      im.locked = true; save();
      w.classList.add('locked');
      w.classList.remove('adjust', 'sel', 'boxmode');
      disarmOut();
      hideTextBar();                    // 面板也一起收（内部重绘）
    };
    /* box=true 是长按进来的「版式态」：额外放出四角 / 旋转手柄，能拖能缩；
       box=false 是双击 / 面板的「内容态」：只留工具条，手柄一律收起。
       selText.box 给重绘后恢复用（renderReader 会按它把 boxmode 加回来）。 */
    const selectText = (box) => {
      const im = getIm(); if (!im) return;
      if (im.locked) { im.locked = false; save(); }
      w.classList.remove('locked');
      w.classList.add('adjust');
      w.classList.toggle('boxmode', !!box);
      showTextBar(w, pid, iid);        // 内部会重设 selText
      if (box && typeof selText !== 'undefined' && selText) selText.box = true;
      realign();
      disarmOut();
      w.__outDown = ev => {
        if (ev.button > 0) return;        // 右键：交给纸面菜单，别顺手把对象锁回去
        if (w.contains(ev.target)) return;
        if (w.classList.contains('editing')) return;    // 正在行内打字：收尾交给编辑流程，别抢在它前面清掉选中
        if (ev.target.closest && ev.target.closest('#tsheet, #eflowTop, #addMenu, #cpMask, #confirmMask, .cp-mask')) return;
        disarmOut();
        lockText();
      };
      document.addEventListener('pointerdown', w.__outDown, true);
    };

    /* 文字贴：按住拖动挪位置（没挪动就只当点了一下 → 选中） */
    const startTextDrag = e => {
      state.imgDragging = true;
      const im = getIm(); if (!im) { state.imgDragging = false; return; }
      let rect = elPaper().getBoundingClientRect();
      let sx = e.clientX, sy = e.clientY, ox = im.x, oy = im.y;   // 跨页时这几个基准就地重设
      let moved = false;
      let fit = {};                                    // 手势期间纸和界面都不动，量一次就够
      track(e.clientX, e.clientY, ev => {
        const dx = (ev.clientX - sx) / rect.width, dy = (ev.clientY - sy) / rect.height;
        if (Math.abs(dx) > .002 || Math.abs(dy) > .002) moved = true;
        im.x = clamp(ox + dx, OBJ_MIN, OBJ_MAX);
        im.y = clamp(oy + dy, OBJ_MIN, OBJ_MAX);
        /* 先按这一帧的位移落好，再问「是不是过了中缝」——
           反过来的话换算到新页时会用上一帧的位置，落点整整差一帧的手指位移 */
        if (tryCrossPage(ev)) {
          rect = elPaper().getBoundingClientRect();
          sx = ev.clientX; sy = ev.clientY; ox = im.x; oy = im.y; fit = {}; moved = true;
        }
        w.style.left = (im.x * 100).toFixed(2) + '%';
        w.style.top = (im.y * 100).toFixed(2) + '%';
        if (moved) { syncBar(w, im); fitObjBar(w, fit); }   // 工具条一路跟着躲
      }, () => {
        unCross();
        state.imgDragging = false;
        if (moved) { save(); realign(); }
      });
    };

    /* 文字贴长按 = 版式态：解除固定 → 选中（虚线框 + 工具条 + 四角 / 旋转手柄）
       → 手指不用抬就能接着拖着挪位置，抬手后拖四角还能改大小。
       固定态的文字单击是「完全没反应」的（手势归翻页），双击只改文字，
       所以要动位置 / 改大小都得走这条跟图片一样的长按。
       没按够 420ms 就松手、或中途划开了，都算单击，手势照旧交回翻页 */
    const armTextHold = e => {
      const sx = e.clientX, sy = e.clientY;
      let timer = setTimeout(() => {
        timer = null;
        if (w.__tTap) w.__tTap = 0;                 // 长按不算「第一下点」，别跟后面那下凑成双击
        const t = getIm(); if (!t) return;
        markEdited();
        if (t.locked) { t.locked = false; save(); }
        w.classList.remove('locked');
        selectText(true);                           // 版式态：虚线框 + 工具条 + 手柄；点框外自动重新固定
        if (navigator.vibrate) { try { navigator.vibrate(12); } catch (_) {} }
        toast('已解除固定 · 拖动挪位置，拖四角改大小');
        startTextDrag({ clientX: sx, clientY: sy, preventDefault() {} });
      }, 420);
      const cancel = ev => {
        if (!timer) return;
        if (Math.abs(ev.clientX - sx) > 10 || Math.abs(ev.clientY - sy) > 10) { clearTimeout(timer); timer = null; }
      };
      const up = () => {
        if (timer) { clearTimeout(timer); timer = null; }
        window.removeEventListener('pointermove', cancel);
        window.removeEventListener('pointerup', up);
        window.removeEventListener('pointercancel', up);
      };
      window.addEventListener('pointermove', cancel);
      window.addEventListener('pointerup', up);
      window.addEventListener('pointercancel', up);
    };

    /* 记一次「纯点击」，只有它才能凑成双击：中途划开了就作废 ——
       不然「点一下文字再划一下翻页」会被当成双击，莫名其妙进编辑 */
    const armTap = e => {
      w.__tTap = performance.now(); w.__xTap = e.clientX; w.__yTap = e.clientY;
      const off = () => {
        window.removeEventListener('pointermove', mv);
        window.removeEventListener('pointerup', off);
        window.removeEventListener('pointercancel', off);
      };
      const mv = ev => {
        if (Math.abs(ev.clientX - e.clientX) + Math.abs(ev.clientY - e.clientY) > 10) { w.__tTap = 0; off(); }
      };
      window.addEventListener('pointermove', mv);
      window.addEventListener('pointerup', off);
      window.addEventListener('pointercancel', off);
    };
    /* 内容态（双击进来的行内打字）不再挂拖整块的监听：pointerdown 直接放行给
       contentEditable，轻点落光标、拖过一段就是选中文字，位置与大小一律不动。
       要移动 / 缩放请用长按进版式态。 */

    const startDrag = e => {
      state.imgDragging = true;
      $$('.pimg-wrap,.ptext-wrap').forEach(x => x.classList.remove('sel', 'adjust'));
      w.classList.add('sel');
      const im = getIm(); if (!im) { state.imgDragging = false; return; }
      let fit = {};                                    // 手势期间纸和界面都不动，量一次就够
      syncBar(w, im); fitObjBar(w, fit);
      let rect = elPaper().getBoundingClientRect();
      let sx = e.clientX, sy = e.clientY, ox = im.x, oy = im.y;   // 跨页时这几个基准就地重设
      let moved = false;
      track(e.clientX, e.clientY, ev => {
        const dx = (ev.clientX - sx) / rect.width, dy = (ev.clientY - sy) / rect.height;
        if (Math.abs(dx) > .002 || Math.abs(dy) > .002) moved = true;
        im.x = clamp(ox + dx, OBJ_MIN, OBJ_MAX);
        im.y = clamp(oy + dy, OBJ_MIN, OBJ_MAX);
        /* 同样先落位移再判跨页，顺序不能倒（理由见 startTextDrag 里那句） */
        if (tryCrossPage(ev)) {
          rect = elPaper().getBoundingClientRect();
          sx = ev.clientX; sy = ev.clientY; ox = im.x; oy = im.y;
          fit = {}; fitObjBar(w, fit); moved = true;
        }
        w.style.left = (im.x * 100).toFixed(2) + '%';
        w.style.top = (im.y * 100).toFixed(2) + '%';
        fitObjBar(w, fit);                             // 工具条一路跟着躲
        /* 不再拖动时挪到最上层：上下层只由加入顺序决定（选中态本来就自带 z-index） */
      }, () => {
        unCross();
        state.imgDragging = false;
        if (moved) { save(); realign(); }
      });
    };

    w.addEventListener('pointerdown', e => {
      if (e.button > 0) return;           // 右键只弹纸面菜单，不算拖动 / 长按 / 双击
      if (e.target.closest('.objbar') || e.target.closest('.hdl')) return;   // 工具条和手柄自己处理
      const im = getIm(); if (!im) return;
      if (isText) {
        /* 内容态只改文字：行内打字直接放行给 contentEditable（落光标 / 拖选文字）。 */
        if (w.classList.contains('editing')) return;
        /* 文字面板开着时（刚「添加文字」就是这一态）依旧要能把框拖走：
           以前这里整支 return，新加的文字在打字前后都挪不了，只能关掉面板再长按 420ms。
           面板负责打字、这里负责位置，两者不冲突（面板开着时不进双击 / 长按分支）。 */
        if (typeof sh !== 'undefined' && sh && sh.open && sh.iid === iid) {
          e.preventDefault();
          markEdited();
          startTextDrag(e);
          return;
        }
        const now = performance.now();
        /* 双击 = 进入内容编辑：收掉版式手柄 → 选中（虚线框 + 工具条）→ 落光标。
           这个状态里不能移动文本框、不能改大小、不能旋转 */
        if (w.__tTap && now - w.__tTap < 340 &&
            Math.abs(e.clientX - (w.__xTap || 0)) < 26 && Math.abs(e.clientY - (w.__yTap || 0)) < 26) {
          w.__tTap = 0;
          /* 不 stopPropagation：万一这一下其实是一划，手势还得交回给翻页 */
          e.preventDefault();
          /* 第二下「按下」的这一刻还分不清是双击还是翻页的一划 —— 等松手再看：
             没挪动 = 双击，进编辑；挪开了 = 那是滑动，放行给翻页 */
          const sx = e.clientX, sy = e.clientY;
          const off = () => {
            window.removeEventListener('pointermove', mv);
            window.removeEventListener('pointerup', up);
            window.removeEventListener('pointercancel', off);
          };
          const far = ev => Math.abs(ev.clientX - sx) + Math.abs(ev.clientY - sy) > 10;
          const mv = ev => { if (far(ev)) off(); };
          const up = ev => {
            off();
            if (far(ev)) return;
            markEdited();
            selectText(false);                              // 内容态：解锁只为工具条，手柄收起
            startTextEdit(w, pid, iid, { x: ev.clientX, y: ev.clientY });   // 光标落在点的那个字上
            if (!window.__textHintShown) {
              window.__textHintShown = true;
              toast('正在编辑文字 · 想移动或改大小，请长按文字');
            }
          };
          window.addEventListener('pointermove', mv);
          window.addEventListener('pointerup', up);
          window.addEventListener('pointercancel', off);
          return;
        }
        /* 单击：什么都不做 —— 不选中、不画框，手势照旧归翻页（横划一下照样翻页）；
           按住 420ms 则解除固定并进版式态，接着就能把整段拖到别处 */
        armTap(e);
        e.preventDefault();
        /* 已在版式态、或本来就是解锁的（刚添加 / 刚粘贴 / 面板里改完还没固定）：
           按住就能挪，跟图片一样，不必再等一次 420ms 长按 */
        if (w.classList.contains('boxmode') || im.locked === false) { markEdited(); startTextDrag(e); return; }
        armTextHold(e);
        return;
      }
      if (!im.locked) { markEdited(); startDrag(e); return; }
      // 已固定：需要长按 420ms 才能重新移动
      e.preventDefault();
      const sx = e.clientX, sy = e.clientY;
      let timer = setTimeout(() => {
        timer = null;
        markEdited();
        im.locked = false;
        w.classList.remove('locked');
        save();
        toast('已解除固定 · 可以移动了');
        if (navigator.vibrate) { try { navigator.vibrate(12); } catch (_) {} }
        startDrag({ clientX: sx, clientY: sy, preventDefault() {} });
      }, 420);
      const cancel = ev => {
        if (!timer) return;
        if (Math.abs(ev.clientX - sx) > 10 || Math.abs(ev.clientY - sy) > 10) { clearTimeout(timer); timer = null; }
      };
      const up = () => {
        clearTimeout(timer); timer = null;
        window.removeEventListener('pointermove', cancel);
        window.removeEventListener('pointerup', up);
        window.removeEventListener('pointercancel', up);
      };
      window.addEventListener('pointermove', cancel);
      window.addEventListener('pointerup', up);
      window.addEventListener('pointercancel', up);
    });

    /* 工具条：四个动作（按下就响应，手感跟其它按钮一致） */
    const bar = w.querySelector('.objbar');
    if (bar) bar.addEventListener('pointerdown', e => {
      if (e.button > 0) return;           // 右键：纸面菜单，不是按钮
      const b = e.target.closest('.ob'); if (!b) return;
      e.preventDefault(); e.stopPropagation();
      objAction(b.dataset.ob, w, pid, iid, isText);
    });

    // 四角拉伸 / 旋转：横竖都能自由调节，对角线另一端保持不动
    w.querySelectorAll('.hdl').forEach(h => {
      h.addEventListener('pointerdown', e => {
        if (e.button > 0) return;
        e.preventDefault(); e.stopPropagation();
        const im = getIm(); if (!im || im.locked) return;
        markEdited();
        /* 文字贴的手柄只在长按的版式态里管用。内容态（行内打字 / 文字面板）
           即使 CSS 漏了手柄也不能让它缩放或旋转，这是第二道保险。 */
        if (isText && (!w.classList.contains('boxmode') || w.classList.contains('editing') ||
            (typeof sh !== 'undefined' && sh && sh.open && sh.iid === iid))) return;
        const p = elPaper();
        if (!p) return;
        const rect = p.getBoundingClientRect();
        const c = h.dataset.h;
        /* ---- 旋转手柄：绕对象中心转；按住 Shift 每 15° 吸附，双击摆正 ---- */
        if (c === 'rot') {
          const now = performance.now();
          /* 双击摆正：要么两次按下挨得很近，要么上一按还没松手就又按了一下。
             这两种情况都要先把第一下挂上的拖动监听撤掉 —— 否则它会留在 window 上，
             之后任何一次 pointermove 都会接着转这个对象（转得莫名其妙） */
          if (h.__armed || now - (h.__t || 0) < 340) {
            if (h.__stop) { h.__stop(); h.__stop = null; }
            h.__armed = false; h.__t = 0;
            im.rot = 0; save(); applyRot(w, im); realign();
            toast('已摆正');
            return;
          }
          /* 这一次是「点一下」还是「转一下」，得等松手才知道：只有点一下才给双击留记号，
             转过之后再点一下是要重新转，不是摆正 */
          h.__t = 0;
          h.__armed = true;
          let turned = false;
          const cr = w.getBoundingClientRect();
          const cx = cr.left + cr.width / 2, cy = cr.top + cr.height / 2;
          const a0 = Math.atan2(e.clientY - cy, e.clientX - cx) * 180 / Math.PI;
          const r0 = im.rot || 0;
          h.classList.add('turning');
          w.classList.add('resizing');                    // 转的时候工具条先让开
          state.imgResizing = true;
          h.__stop = track(e.clientX, e.clientY, ev => {
            const a = Math.atan2(ev.clientY - cy, ev.clientX - cx) * 180 / Math.PI;
            let r = r0 + (a - a0);
            if (ev.shiftKey) r = Math.round(r / 15) * 15;
            im.rot = Math.round(r * 10) / 10;
            turned = true;
            applyRot(w, im);
          }, () => {
            h.classList.remove('turning');
            w.classList.remove('resizing');
            state.imgResizing = false;
            h.__stop = null;
            h.__armed = false;
            if (!turned) h.__t = performance.now();     // 纯点了一下：双击摆正从这里算起
            save(); realign();
          });
          return;
        }
        /* ---- 四角拉伸 ----
           图片：自由拉伸（横竖各改各的，按住 Shift 才锁原宽高比）。
           文字贴：默认「字随框缩放」——框宽、框高、字号同乘一个系数、对角钉死不动，
           整块像贴纸一样放大缩小，字相对框的比例不变，换行位置也不变。
           框始终紧贴内容（见 text-sticker.js 的 fitTextBox）：拖之前贴一次当基准，
           拖完再贴一次收掉取整误差。按住 Alt 拖、或工具条上把「字随框缩放」点灭，
           就回到自由拉伸（字号不动，行宽按用户拉出来的算，之后打字也不再自动收窄）。
           模式在手势落下那一刻锁死：拖到一半才按 Alt 不让尺寸突然跳一下。
           ⚠️ 文字贴不能用图片那套 IMG_MIN_W / IMG_MIN_H（都是 .1）当最小尺寸：
           一行字只有约 6% 页高，拿 .1 一夹，手指刚动 4px 就被强行放大到 1.7 倍 ——
           这就是「一拖动就变得很大」的根因。下限改成「一个字宽 / 一行行高」。 */
        const size0 = im.size || TS_SIZE_DEFAULT;
        const scaleFont = isText && !e.altKey && im.fsLink !== false;
        const txtEl = scaleFont ? w.querySelector('.ptxt') : null;
        let minW = IMG_MIN_W, minH = IMG_MIN_H;
        if (isText) {
          const te = w.querySelector('.ptxt');
          const tcs = te ? getComputedStyle(te) : null;
          const fs = tcs ? (parseFloat(tcs.fontSize) || 18) : 18;
          const lh = tcs ? (parseFloat(tcs.lineHeight) || fs * 1.42) : fs * 1.42;
          minW = Math.max(.012, fs * .8 / rect.width);
          minH = Math.max(.008, lh / rect.height);
          if (scaleFont) im.autoW = true;      // 默认拖角 = 回到自动贴合
          /* 先按内容贴紧当基准：正常情况下 bindPage 已经贴过，这里就是空转。
             直接把 im 传进去，别让 selText（可能指向另一段文字）挑错对象 */
          if (te) fitTextBox(w, te, false, im);
        }
        const ox = im.x, oy = im.y, ow = im.w, oh = im.h || ow / 0.68;
        const oL = ox, oR = ox + ow, oT = oy, oB = oy + oh;
        const ratio = ow / Math.max(oh, 1e-4);
        const moveLeft = c === 'tl' || c === 'bl', moveTop = c === 'tl' || c === 'tr';
        let moved = false;
        /* 行宽上限：等比时跟框一起乘 s；自由拉伸收尾时记成用户手动拉出来的宽度 */
        const ww0 = isText ? (im.ww > 0 ? im.ww : ow) : 0;
        // 拉伸期间让工具条让位：不抢手势、也不挡视线
        w.classList.add('resizing');
        state.imgResizing = true;
        syncTiny(w, im);
        /* 对象转过角度时，手指的位移要换算回「对象自己的方向」再改边，
           不然横竖会串：转了 90° 再拖右边界，会去改上边界 */
        const rad = (im.rot || 0) * Math.PI / 180;
        const cs = Math.cos(rad), sn = Math.sin(rad);
        /* 旋转是绕中心转的：改了尺寸中心就要挪，整块（连同对角那个角）会被甩走一段。
           下面每帧用 rotShift 把这段补回去，手感就跟没旋转时一样：拖哪个角，
           对角那个钉死不动，手上的角严丝合缝跟着指针 */
        const c0x = (oL + oR) / 2 * rect.width, c0y = (oT + oB) / 2 * rect.height;
        track(e.clientX, e.clientY, (ev, sx, sy) => {
          const px = ev.clientX - sx, py = ev.clientY - sy;
          const dxPx = px * cs + py * sn, dyPx = -px * sn + py * cs;
          let L, R, T, B, s = 1;
          if (scaleFont) {
            /* 等比：把手指位移投影到「对角 → 被拖角」这条对角线上，投影占原对角长度
               的比例就是整块的缩放倍数。沿对角拖完全跟手；斜着拖也不会让字和框各走
               一个比例。旋转过的对象用的是已经转回自身坐标系的 dxPx / dyPx。 */
            const vx = (moveLeft ? -1 : 1) * ow * rect.width;
            const vy = (moveTop ? -1 : 1) * oh * rect.height;
            const den = Math.max(vx * vx + vy * vy, 64);
            const raw = 1 + (dxPx * vx + dyPx * vy) / den;
            /* 框宽高本来就跟着字号一起缩放，一个字 / 一行不会缩没，
               所以下界只看字号，绝不能再拿框的最小尺寸去除（那会瞬间把整块撑大）。
               上界再看纸边和字号上限；夹的是同一个数，字相对框的比例才始终不变。 */
            const sLo = TS_SIZE_MIN / size0;
            const roomX = moveLeft ? (oR - IMG_M) : (1 - IMG_M - oL);
            const roomY = moveTop ? (oB - IMG_M) : (1 - IMG_M - oT);
            /* ≥1：框本来就已经贴到（或略微探出）纸边时，room/ow 会小于 1，
               拿到这里直接夹会把「刚按下还没拖」也缩一圈。上限只管往大拖，
               往小拖交给 sLo，别在手势起点偷偷改尺寸。 */
            const sHi = Math.max(1, Math.min(roomX / ow, roomY / oh, TS_SIZE_MAX / size0));
            s = clamp(clamp(raw, .05, 20), sLo, sHi);
            const nw0 = ow * s, nh0 = oh * s;
            L = moveLeft ? oR - nw0 : oL; R = L + nw0;
            T = moveTop ? oB - nh0 : oT; B = T + nh0;
          } else {
            const dx = dxPx / rect.width, dy = dyPx / rect.height;
            // 用四条边来算：被拖的角移动两条边，对角固定
            L = moveLeft ? oL + dx : oL;
            R = moveLeft ? oR : oR + dx;
            T = moveTop ? oT + dy : oT;
            B = moveTop ? oB : oB + dy;
            if (ev.shiftKey) {                        // 按住 Shift 等比缩放
              const nw0 = R - L, nh0 = nw0 / ratio;
              if (moveTop) T = B - nh0; else B = T + nh0;
            }
            // 限制在纸内，四个角的调节手柄始终看得见、点得到
            L = clamp(L, IMG_M, 1 - IMG_M); R = clamp(R, IMG_M, 1 - IMG_M);
            T = clamp(T, IMG_M, 1 - IMG_M); B = clamp(B, IMG_M, 1 - IMG_M);
            if (R - L < minW) { if (moveLeft) L = Math.max(IMG_M, R - minW); else R = Math.min(1 - IMG_M, L + minW); }
            if (B - T < minH) { if (moveTop) T = Math.max(IMG_M, B - minH); else B = Math.min(1 - IMG_M, T + minH); }
          }
          const nw = Math.max(R - L, minW), nh = Math.max(B - T, minH);
          /* 中心挪了多少 → 补多少（见 rotShift）；补完再夹一层，别一甩就出纸找不回来 */
          const sf = rotShift(rect, im.rot, (L + R) / 2 * rect.width - c0x, (T + B) / 2 * rect.height - c0y);
          const nx = clamp(L + sf.x, OBJ_MIN, OBJ_MAX), ny = clamp(T + sf.y, OBJ_MIN, OBJ_MAX);
          if (Math.abs(nw - ow) > .002 || Math.abs(nh - oh) > .002 ||
              Math.abs(nx - ox) > .002 || Math.abs(ny - oy) > .002 ||
              (scaleFont && Math.abs(s - 1) > .00002)) moved = true;
          im.x = nx; im.y = ny; im.w = nw; im.h = nh;
          if (scaleFont) {
            /* 字号当场写进数据 + 画回纸面：拉伸期间不整页重绘（会打断手势），只改这一条样式。
               四位小数足够精确，数据里也不会拖着一长串浮点。 */
            im.size = Math.round(size0 * s * 10000) / 10000;
            im.ww = ww0 * s;                    // 折行宽度同比放大，长段落的换行位置才不变
            if (txtEl) txtEl.style.fontSize = `calc(var(--pw,340px) * ${(im.size / 100).toFixed(6)})`;
            /* 面板正好开着的话，字号滑块 / px 数字 / 快捷档也要跟着走 */
            if (typeof syncTextSizeUI === 'function') syncTextSizeUI(iid);
          }
          applyBox(w, im);
          syncTiny(w, im);
        }, () => {
          w.classList.remove('resizing');
          state.imgResizing = false;
          if (moved) {
            if (isText) {
              /* 自由拉伸：这一下拉出来的是用户自己要的行宽，记下来，之后打字别再收窄 */
              if (!scaleFont) { im.autoW = false; im.ww = im.w; }
              /* 收尾再贴一次：去掉两位的百分比取整误差，框始终紧贴文字不留空白 */
              const te = w.querySelector('.ptxt');
              if (te) fitTextBox(w, te, false, im);
            }
            save(); realign();
          }
        });
      });
    });

  });

}

/* ==================== 右上角「添加」：加页 / 图片 / 文字 ==================== */
/* 新内容加到哪一页。双页模式下左右两页都能加：
   - 默认落在当前跨页的左页
   - 「+」菜单展开时点某一页，就把那一页设为目标（右页也能选）
   - 在某一页上拖图片 / 编辑文字，也会把那一页记为最近操作页 */
let addPageIdx = null;                       // 用户指定的目标页；null = 跟随当前视图
function slotPageIndex(slotEl) {             // 某个页槽当前显示的是第几页（-1 = 封面，-2 = 封面内侧）
  if (state.mode !== 'spread') return state.page;
  const [a, b] = currentIndices();
  return slotEl && slotEl.id === 'slotL' ? a : b;
}
function syncAddFocusFrom(el) {              // 交互发生在哪一页，就把目标页跟到哪一页
  const slot = el && el.closest ? el.closest('#slotL, #slotR') : null;
  if (!slot) return;
  const pid = slotPageIndex(slot);
  if (pid >= 0) addPageIdx = pid;
}
function setAddTarget(pid) {
  const j = cur(); if (!j) return;
  addPageIdx = clamp(pid, 0, Math.max(j.pages.length - 1, 0));
}
/* 新内容加到哪一页：停在某页上操作就加在那页，否则取当前跨页左页 */
function currentAddPage() {
  const j = cur(); if (!j || !j.pages.length) return 0;
  const n = j.pages.length;
  if (state.mode === 'spread') {
    /* 默认目标仍是左页；第一跨页的左边是封面内侧（-2，不是正文页），这时回落到右页 */
    const [a, b] = currentIndices();
    if (addPageIdx === a || addPageIdx === b) return clamp(addPageIdx, 0, n - 1);
    return clamp(a >= 0 ? a : b, 0, n - 1);
  }
  return clamp(state.page, 0, n - 1);
}
/* 菜单上标出目标页码 + 双页时的「左页 / 右页」切换条 */
function updateAddMenuHint() {
  const j = cur(); if (!j) return;
  const p = currentAddPage();
  const ok = !!j.pages[p];
  $$('#addMenu .am-p').forEach(s => {
    const btn = s.closest('button');
    const act = btn && btn.dataset.addact;
    if (act === 'spread') {                                  // 跨页图占两页：标出它将落在哪一跨页
      const at = ok ? spreadInsertIndex(p) : -1;
      s.textContent = at >= 0 ? `· 插到第 ${at + 1}–${at + 2} 页` : '';
      return;
    }
    // 「加一页」说的是插在哪一页后面，其余两项说的是加到哪一页
    s.textContent = ok ? (act === 'page'
      ? '· 在第 ' + (p + 1) + ' 页后' : '· 第 ' + (p + 1) + ' 页') : '';
  });
  const row = $('#amTarget'); if (!row) return;
  const two = state.mode === 'spread' && !isCoverView();
  const [a, b] = currentIndices();
  row.classList.toggle('hide', !two);
  $$('#amTarget .am-side').forEach(btn => {
    const pid = btn.dataset.side === 'L' ? a : b;
    const ok = pid >= 0 && !!j.pages[pid];
    /* 第一跨页的左半边是封面内侧，不是正文页：这一侧不可选 */
    btn.textContent = ok ? (btn.dataset.side === 'L' ? '左页 ' : '右页 ') + (pid + 1)
      : (pid === PAGE_INSIDE_COVER ? '封面内侧' : '—');
    btn.classList.toggle('on', ok && pid === p);
    btn.disabled = !ok;
  });
}
/* 两页描边，目标页更亮 + 顶上挂标签；菜单关掉就全部撤掉 */
function markAddTarget() {
  const book = $('#book'), m = $('#addMenu');
  const open = !!(m && m.classList.contains('show'));
  const two = state.mode === 'spread' && !isCoverView();
  book.classList.toggle('picking', open && two);
  const t = (open && two) ? currentAddPage() : -1;
  const [a, b] = currentIndices();
  $('#slotL').classList.toggle('add-target', two && t >= 0 && t === a);
  $('#slotR').classList.toggle('add-target', two && t >= 0 && t === b);
}
/* 注：「本页底色」已挪到底部弹窗（见 src/page-bg.js 的 openBgSheet），
   这里不再有内联色块行；菜单只负责把目标页交给弹窗 */
function addImageTo(pid) {
  state.pendingPage = pid;
  const fp = $('#filePicker'); if (fp) fp.click();
}
function addTextTo(pid) {
  const j = cur(); if (!j || !j.pages.length) return;
  pid = clamp(pid, 0, j.pages.length - 1);
  const t = newText(.16, .16);           // 默认一个字都没有（占位提示由 CSS 画，不进数据）
  t.z = nextZ(j.pages[pid]);             // 后加的盖在先加的上面
  pageTexts(j.pages[pid]).push(t);
  save(); renderReader();
  /* 记一笔「刚添加」：第一次收面板先别锁，抬手就能把这个框拖到别处 */
  if (typeof markFreshText === 'function') markFreshText(t.id);
  openTextSheet(pid, t.id, true);        // 新建就直接开面板、自动聚焦，接着就能打字
  toast('已添加到第 ' + (pid + 1) + ' 页');
}
function closeAddMenu() {
  const m = $('#addMenu'); if (m) m.classList.remove('show');
  const b = $('#rAdd'); if (b) b.classList.remove('on');
  markAddTarget();                    // 撤掉页面上的目标描边
}
function toggleAddMenu(force) {
  const m = $('#addMenu'); if (!m) return;
  const show = force !== undefined ? force : !m.classList.contains('show');
  m.classList.toggle('show', show);
  const b = $('#rAdd'); if (b) b.classList.toggle('on', show);
  if (show) updateAddMenuHint();      // 菜单里标出「· 第 N 页」
  markAddTarget();
}

/* ==================== 纸面右键 / 快捷键接线 ==================== */
/* 桌面（鼠标）：只在正文内页上接管右键，封面 / 封面内侧 / 环衬不显示菜单；
   正在行内打字时把系统菜单留给文本编辑（选词、粘贴文字进光标处）。
   ⚠️ 触屏长按同样会触发 contextmenu，按落点分两条：
      · 长按内页**空白处** → 弹 #paperMenu（复制 / 剪切 / 粘贴），这是移动端唯一的
        粘贴入口，浮层落在空白纸上不会盖住任何编辑工具条；
      · 长按**文字贴 / 图片等内容** → 不弹浮层，顺手压住系统长按菜单，
        由胶囊工具条上的「复制 / 剪切」接管（粘贴不进工具条）。
   正在行内打字时仍把系统选词菜单放行。桌面右键 / Ctrl+C / X / V 全部照旧。 */
$('#stage').addEventListener('contextmenu', e => {
  if (!clipReaderOn()) return;
  if (e.target.closest('.ptext-wrap.editing')) return;
  const coarse = !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
  /* 双保险：长按这一下（含紧接着抬起的 pointerup）统一标记为「不翻页」。
     contextmenu 在抬手之前就来，scrub.js 的 flipSuppressed() 正好能兜住那一抬手；
     即便某些内核把 pointerType 报空、走不到上面那条触屏判断，也不会翻页。 */
  if (coarse) markFlipSuppressed();
  if (coarse && e.target.closest('.pimg-wrap, .ptext-wrap')) {
    e.preventDefault();
    closePaperMenu();
    return;
  }
  openPaperMenu(e);
});
const paperMenu = $('#paperMenu');
if (paperMenu) paperMenu.addEventListener('click', e => {
  const b = e.target.closest('button[data-clip]');
  if (!b || b.disabled) return;
  e.preventDefault(); e.stopPropagation();
  const c = paperMenuCtx, act = b.dataset.clip;
  closePaperMenu();
  if (act === 'paste') { clipPasteMenu(c); return; }
  const ref = c && c.ref;
  if (!ref) { toast('右键点在一个文字框或图片上才能' + (act === 'copy' ? '复制' : '剪切')); return; }
  if (act === 'copy') clipCopy(ref); else clipCut(ref);
});
document.addEventListener('pointerdown', e => {
  if (!e.target.closest || !e.target.closest('#paperMenu')) closePaperMenu();
}, true);
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  const m = $('#paperMenu');
  if (!m || !m.classList.contains('show')) return;
  /* 只收菜单：window 上还挂着「Esc 关阅读器 / 退出吸管」，别一起触发 */
  e.preventDefault(); e.stopImmediatePropagation();
  closePaperMenu();
});
window.addEventListener('resize', closePaperMenu);
window.addEventListener('blur', closePaperMenu);

/* Ctrl+C / Ctrl+X / Ctrl+V 走浏览器自己的 copy / cut / paste 事件：
   比监听 keydown 稳（菜单触发的复制也能收到），打字时则整支放行给浏览器。 */
document.addEventListener('copy', e => {
  if (!clipReaderOn() || clipTyping()) return;
  const ref = clipSelectedRef(); if (!ref) return;
  e.preventDefault();
  clipSet(ref.isText ? 'text' : 'image', ref.o);
  if (e.clipboardData && ref.isText) {
    try { e.clipboardData.setData('text/plain', ((ref.o.text) || '').trim()); } catch (_) {}
  }
  toast(ref.isText ? '已复制文字 · 粘贴后才会生成一份' : '已复制图片 · 粘贴后才会生成一份');
});
document.addEventListener('cut', e => {
  if (!clipReaderOn() || clipTyping()) return;
  const ref = clipSelectedRef(); if (!ref) return;
  e.preventDefault();
  if (e.clipboardData && ref.isText) {
    try { e.clipboardData.setData('text/plain', ((ref.o.text) || '').trim()); } catch (_) {}
  }
  clipCut(ref);
});
document.addEventListener('paste', e => {
  if (!clipReaderOn() || clipTyping()) return;
  const pt = clipPasteTarget(); if (!pt) return;
  const cd = e.clipboardData;
  /* 内部剪贴板优先：复制的是对象，就还原成一整块文字贴 / 图片 */
  if (paperClip) { e.preventDefault(); clipPasteAt(pt.pid, pt.x, pt.y); return; }
  let file = null;
  if (cd) {
    const fs = cd.files ? [...cd.files] : [];
    file = fs.find(f => /^image\//.test(f.type || '')) || null;
    if (!file && cd.items) {
      for (const it of cd.items) {
        if (it.kind === 'file' && /^image\//.test(it.type || '')) {
          const f = it.getAsFile && it.getAsFile();
          if (f) { file = f; break; }
        }
      }
    }
  }
  const text = cd ? (cd.getData('text/plain') || '') : '';
  if (!file && !text.trim()) return;
  e.preventDefault();
  clipPasteExternal(pt.pid, pt.x, pt.y, file, text);
});
