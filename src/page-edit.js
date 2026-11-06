/* =====================================================================
 * Carnet · 页面内容编辑 · 图片与文字对象   （脚本 15 / 27）
 * ---------------------------------------------------------------------
 * ① bindPage：页面手势（拖动 / 四角拉伸 / 旋转 / 长按解锁）；首绘时把文字贴框收紧到内容
 *    图片四角 = 自由拉伸；文字贴四角 = 整块等比缩放（框宽、框高、字号同乘一个系数）
 * ② 选中对象后的工具条 objAction：完成 ✓ / 复制 / 换图（仅图片）/ 字随框缩放（仅文字）/ 编辑 / 删除
 * ③ 右上角「添加」菜单：加页 / 加图片 / 加文字 / 本页底色 / 删本页，目标页判定 currentAddPage
 * ④ 文字贴单击零反应、长按解除固定并可拖着挪位置、双击才进编辑态（编辑逻辑在 text-sticker.js）
 *    ⚠️ 文字贴的最小尺寸按「一个字 / 一行」算，绝不能套图片那套 IMG_MIN_*（见四角拉伸分支）
 *
 * 对外接口：bindPage, objAction, addImageTo, addTextTo, currentAddPage, toggleAddMenu
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
  const disarmOut = () => { if (w.__outDown) { document.removeEventListener('pointerdown', w.__outDown, true); w.__outDown = null; } };
  const finish = () => {                             // 完成 = 固定到这一页
    im.locked = true; save();
    w.classList.add('locked');
    w.classList.remove('adjust', 'sel');
    disarmOut();
    if (isText) { hideTextBar(); }                    // 面板一起收掉（内部会重绘）
    else { w.classList.add('justlock'); setTimeout(() => w.classList.remove('justlock'), 460); renderReader(); toast('已固定在第 ' + (pid + 1) + ' 页 · 长按可重新移动'); }
  };
  if (act === 'close') { finish(); return; }
  if (act === 'copy') {
    const cp = JSON.parse(JSON.stringify(im));
    cp.id = uid();
    cp.x = clamp((im.x ?? 0) + .05, OBJ_MIN, OBJ_MAX);
    cp.y = clamp((im.y ?? 0) + .05, OBJ_MIN, OBJ_MAX);
    cp.locked = false;
    cp.z = nextZ(pg);                       // 复制出来的这份盖在原件上面
    arr.splice(arr.indexOf(im) + 1, 0, cp);
    save(); renderReader();
    toast(isText ? '已复制这段文字' : '已复制这张图片');
    return;
  }
  /* 换图：弹出选图框，选完只换掉这张图的图源 —— 位置 / 大小 / 旋转 / 上下层原样保留。
     真正的换图动作在 media.js（#swapFile 的 change），这里只负责记住要换哪一张 */
  if (act === 'swap') {
    if (isText) return;
    state.swapTarget = { pid, iid };
    const sp = $('#swapFile'); if (sp) sp.click();
    return;
  }
  /* 图片边框：开底部那张面板（拍立得 / 纯色 / 细线 / 拟物相框 + 自定义颜色 + 粗细）。
     面板已经开着且就是这一张 → 再点一次收起来 */
  if (act === 'frame') {
    if (isText) return;
    if (typeof frs !== 'undefined' && frs.open && frs.iid === iid) { closeFrameSheet(); return; }
    openFrameSheet(pid, iid);
    return;
  }
  /* 文字贴「字随框缩放」开关：只改这一个对象的模式，存进数据里，整页重绘后状态还在。
     关掉之后拖四角就是老的自由拉伸（字号不动）；桌面临时按住 Alt 拖也是这个效果。 */
  if (act === 'fslink') {
    if (!isText) return;
    const on = im.fsLink === false;        // 原来是关 → 现在开；原来是开 → 现在关
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

    /* 文字贴：解锁 → 选中（四角手柄 + 工具条）；点框外自动重新固定 */
    const lockText = () => {
      const im = getIm(); if (!im) return;
      im.locked = true; save();
      w.classList.add('locked');
      w.classList.remove('adjust', 'sel');
      disarmOut();
      hideTextBar();                    // 面板也一起收（内部重绘）
    };
    const selectText = () => {
      const im = getIm(); if (!im) return;
      if (im.locked) { im.locked = false; save(); }
      w.classList.remove('locked');
      w.classList.add('adjust');
      showTextBar(w, pid, iid);
      realign();
      disarmOut();
      w.__outDown = ev => {
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

    /* 文字贴长按：解除固定 → 选中（虚线框 + 工具条）→ 手指不用抬就能接着拖着挪位置。
       固定态的文字单击是「完全没反应」的（手势归翻页），所以挪位置得先双击进编辑；
       这里补一条跟图片一样的长按，抬手前就能直接拖。
       没按够 420ms 就松手、或中途划开了，都算单击，手势照旧交回翻页 */
    const armTextHold = e => {
      const sx = e.clientX, sy = e.clientY;
      let timer = setTimeout(() => {
        timer = null;
        if (w.__tTap) w.__tTap = 0;                 // 长按不算「第一下点」，别跟后面那下凑成双击
        const t = getIm(); if (!t) return;
        if (t.locked) { t.locked = false; save(); }
        w.classList.remove('locked');
        selectText();                               // 虚线框 + 工具条；点框外自动重新固定
        if (navigator.vibrate) { try { navigator.vibrate(12); } catch (_) {} }
        toast('已解除固定 · 拖动可挪位置');
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
    /* 行内打字时挪位置：轻点仍然交给浏览器去落光标，按住拖过 9px 就改成拖整块。
       两个动作抢同一个 pointerdown，只能靠「有没有真的移动」来分 */
    const watchTextMove = e => {
      const im = getIm(); if (!im) return;
      let rect = elPaper().getBoundingClientRect();
      let sx = e.clientX, sy = e.clientY, ox = im.x, oy = im.y;   // 跨页时这几个基准就地重设
      let dragging = false;
      let fit = {};
      /* 走 bindPage 里那条 track()：pointermove 按帧合一次，松手补跑最后一帧。
         以前这条路径自己绑监听、来一次事件写一次 left/top，是唯一漏掉合帧的拖动 */
      track(e.clientX, e.clientY, ev => {
        if (!dragging) {
          if (Math.abs(ev.clientX - sx) + Math.abs(ev.clientY - sy) < 9) return;
          dragging = true; w.__dragging = true;
          state.imgDragging = true;
          try { window.getSelection().removeAllRanges(); } catch (_) {}   // 把拖出来的选区清掉
        }
        im.x = clamp(ox + (ev.clientX - sx) / rect.width, OBJ_MIN, OBJ_MAX);
        im.y = clamp(oy + (ev.clientY - sy) / rect.height, OBJ_MIN, OBJ_MAX);
        if (tryCrossPage(ev)) {                             // 同上：先更新再判「是不是过了中缝」
          rect = elPaper().getBoundingClientRect();
          sx = ev.clientX; sy = ev.clientY; ox = im.x; oy = im.y; fit = {};
        }
        w.style.left = (im.x * 100).toFixed(2) + '%';
        w.style.top = (im.y * 100).toFixed(2) + '%';
        syncBar(w, im); fitObjBar(w, fit);          // 一边打字一边挪：工具条也跟着躲
      }, () => {
        w.__dragging = false;
        unCross();
        state.imgDragging = false;
        if (dragging) { save(); realign(); }
      });
    };

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

    /* 编辑态里拖整块的时候，别让浏览器顺手框选走一段字 */
    w.addEventListener('selectstart', e => { if (w.__dragging) e.preventDefault(); });

    w.addEventListener('pointerdown', e => {
      if (e.target.closest('.objbar') || e.target.closest('.hdl')) return;   // 工具条和手柄自己处理
      const im = getIm(); if (!im) return;
      if (isText) {
        /* 已经在行内打字：轻点 = 落光标，按住拖 = 挪整块 */
        if (w.classList.contains('editing')) { watchTextMove(e); return; }
        const now = performance.now();
        /* 双击才是「进入编辑」：解除固定 → 选中（虚线框 + 工具条）→ 落光标。
           编辑态里拖动 / 改大小 / 旋转 / 打字全都可用 */
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
            if (im.locked) { im.locked = false; w.classList.remove('locked'); save(); }
            selectText();                                   // 固定态要先解锁，手柄才点得动
            startTextEdit(w, pid, iid, { x: ev.clientX, y: ev.clientY });   // 光标落在点的那个字上
            if (!window.__textHintShown) {
              window.__textHintShown = true;
              toast('拖四角整块缩放（字跟着变大）· 按住 Alt 只改框 · 右边那颗转');
            }
          };
          window.addEventListener('pointermove', mv);
          window.addEventListener('pointerup', up);
          window.addEventListener('pointercancel', off);
          return;
        }
        /* 单击：什么都不做 —— 不选中、不画框，手势照旧归翻页（横划一下照样翻页）；
           按住 420ms 则解除固定并进选中态，接着就能把整段拖到别处 */
        armTap(e);
        e.preventDefault();
        if (w.classList.contains('adjust')) { startTextDrag(e); return; }   // 面板开着时本来就是解锁态，按住照旧能挪
        armTextHold(e);
        return;
      }
      if (!im.locked) { startDrag(e); return; }
      // 已固定：需要长按 420ms 才能重新移动
      e.preventDefault();
      const sx = e.clientX, sy = e.clientY;
      let timer = setTimeout(() => {
        timer = null;
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
      const b = e.target.closest('.ob'); if (!b) return;
      e.preventDefault(); e.stopPropagation();
      objAction(b.dataset.ob, w, pid, iid, isText);
    });

    // 四角拉伸 / 旋转：横竖都能自由调节，对角线另一端保持不动
    w.querySelectorAll('.hdl').forEach(h => {
      h.addEventListener('pointerdown', e => {
        e.preventDefault(); e.stopPropagation();
        const im = getIm(); if (!im || im.locked) return;
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
  const t = newText(.16, .16);
  t.z = nextZ(j.pages[pid]);             // 后加的盖在先加的上面
  pageTexts(j.pages[pid]).push(t);
  save(); renderReader();
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
