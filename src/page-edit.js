/* =====================================================================
 * Carnet · 页面内容编辑 · 图片拖拽缩放   （脚本 14 / 23）
 * ---------------------------------------------------------------------
 * ① bindPage：页面手势（拖动 / 双指缩放 / 锁定 / 删除 / 铺满）
 * ② 右上角「添加」菜单：加页 / 加图片 / 加文字 / 删本页
 * ③ 目标页判定（双页模式下决定内容加到左页还是右页）
 *
 * 依赖模块：core, state, media, text-sticker
 *
 * 说明：模块间共用全局作用域，按下面的顺序加载，顺序即依赖顺序。
 * ===================================================================== */
/* ==================== 页面交互（图片拖拽 / 缩放 / 删除 / 添加） ==================== */
function bindPage() {
  const track = (startX, startY, move, done) => {
    const mv = ev => move(ev, startX, startY);
    const up = () => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up); done && done(); };
    window.addEventListener('pointermove', mv);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  };

  $$('#slotL .pimg-wrap, #slotR .pimg-wrap, #slotL .ptext-wrap, #slotR .ptext-wrap').forEach(w => {
    const pid = +w.dataset.page, iid = w.dataset.id;
    const pageEl = w.closest('.paper');
    const isText = w.classList.contains('ptext-wrap');
    /* 图片和文字共用一套拖拽 / 缩放 / 删除逻辑 */
    const getIm = () => {
      const pg = cur().pages[pid]; if (!pg) return null;
      return isText ? pageTexts(pg).find(x => x.id === iid) : (pg.images || []).find(x => x.id === iid);
    };

    /* 文字贴：解锁后（adjust 模式）拖动可移动，没挪动就当作轻点 → 进入编辑 */
    const startTextDrag = e => {
      e.preventDefault();
      state.imgDragging = true;
      const im = getIm(); if (!im) { state.imgDragging = false; return; }
      const rect = pageEl.getBoundingClientRect();
      const ox = im.x, oy = im.y;
      let moved = false;
      track(e.clientX, e.clientY, (ev, sx, sy) => {
        const dx = (ev.clientX - sx) / rect.width, dy = (ev.clientY - sy) / rect.height;
        if (Math.abs(dx) > .002 || Math.abs(dy) > .002) moved = true;
        im.x = clamp(ox + dx, -.15, .95);
        im.y = clamp(oy + dy, -.15, .95);
        w.style.left = (im.x * 100).toFixed(2) + '%';
        w.style.top = (im.y * 100).toFixed(2) + '%';
      }, () => {
        state.imgDragging = false;
        if (moved) save();
      });
    };
    /* 文字贴解锁 → 进入调整模式；点框外自动重新固定 */
    const lockText = () => {
      const im = getIm(); if (!im) return;
      im.locked = true; save();
      w.classList.add('locked');
      w.classList.remove('adjust', 'sel');
      if (w.__outDown) { document.removeEventListener('pointerdown', w.__outDown, true); w.__outDown = null; }
      hideTextBar();
    };
    const unlockText = () => {
      const im = getIm(); if (!im) return;
      im.locked = false; save();
      w.classList.remove('locked');
      w.classList.add('adjust');
      if (navigator.vibrate) { try { navigator.vibrate(12); } catch (_) {} }
      toast('已解锁 · 拖四角调大小');
      if (w.__outDown) document.removeEventListener('pointerdown', w.__outDown, true);
      w.__outDown = ev => {
        if (w.contains(ev.target)) return;
        if (ev.target.closest && ev.target.closest('.rbot, #tstyle, #addMenu')) return;
        document.removeEventListener('pointerdown', w.__outDown, true);
        w.__outDown = null;
        lockText();
      };
      document.addEventListener('pointerdown', w.__outDown, true);
    };

    const startDrag = e => {
      e.preventDefault();
      state.imgDragging = true;
      $$('.pimg-wrap,.ptext-wrap').forEach(x => x.classList.remove('sel', 'adjust'));
      w.classList.add('sel');
      const im = getIm(); if (!im) { state.imgDragging = false; return; }
      if (isText) { w.classList.remove('sel'); w.classList.add('adjust'); }
      const rect = pageEl.getBoundingClientRect();
      const ox = im.x, oy = im.y;
      let moved = false, brought = false;
      track(e.clientX, e.clientY, (ev, sx, sy) => {
        const dx = (ev.clientX - sx) / rect.width, dy = (ev.clientY - sy) / rect.height;
        if (Math.abs(dx) > .002 || Math.abs(dy) > .002) moved = true;
        im.x = clamp(ox + dx, -.15, .95);
        im.y = clamp(oy + dy, -.15, .95);
        w.style.left = (im.x * 100).toFixed(2) + '%';
        w.style.top = (im.y * 100).toFixed(2) + '%';
        // 只有真的动起来才把元素挪到最上层 —— 否则会打断双击判定
        if (moved && !brought) { brought = true; pageEl.querySelector('.pcontent').appendChild(w); }
      }, () => { state.imgDragging = false; if (moved) save(); });
    };

    w.addEventListener('pointerdown', e => {
      if (e.target.closest('.img-del') || e.target.closest('.hdl') || e.target.closest('.img-lock') || e.target.closest('.txt-edit')) return;
      const im = getIm(); if (!im) return;
      if (isText) {
        if (w.classList.contains('editing')) return;      // 正在打字：让光标正常工作
        /* 只有双击才进入输入：单击不做任何事，避免误触 */
        const now = performance.now();
        if (now - (w.__tTap || 0) < 340 &&
            Math.abs(e.clientX - (w.__xTap || 0)) < 26 && Math.abs(e.clientY - (w.__yTap || 0)) < 26) {
          w.__tTap = 0;
          e.preventDefault(); e.stopPropagation();
          startTextEdit(w, pid, iid);
          return;
        }
        w.__tTap = now; w.__xTap = e.clientX; w.__yTap = e.clientY;
        if (w.classList.contains('adjust')) { startTextDrag(e); return; }   // 已解锁：按住可拖动挪位置
        /* 已固定：单击无反应；长按 400ms = 解锁并调整大小 */
        e.preventDefault();
        const sx0 = e.clientX, sy0 = e.clientY;
        let far = false;
        const timer = setTimeout(() => unlockText(), 400);
        const mv = ev => {
          if (far) return;
          if (Math.abs(ev.clientX - sx0) > 8 || Math.abs(ev.clientY - sy0) > 8) { far = true; clearTimeout(timer); }
        };
        const up = () => {
          clearTimeout(timer);
          window.removeEventListener('pointermove', mv);
          window.removeEventListener('pointerup', up);
          window.removeEventListener('pointercancel', up);
        };
        window.addEventListener('pointermove', mv);
        window.addEventListener('pointerup', up);
        window.addEventListener('pointercancel', up);
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
      const up = () => { clearTimeout(timer); timer = null; window.removeEventListener('pointermove', cancel); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up); };
      window.addEventListener('pointermove', cancel);
      window.addEventListener('pointerup', up);
      window.addEventListener('pointercancel', up);
    });

    // 四角拉伸：横竖都能自由调节，对角线另一端保持不动
    w.querySelectorAll('.hdl').forEach(h => {
      h.addEventListener('pointerdown', e => {
        e.preventDefault(); e.stopPropagation();
        const im = getIm(); if (!im || im.locked) return;
        const rect = pageEl.getBoundingClientRect();
        const c = h.dataset.h;
        const ox = im.x, oy = im.y, ow = im.w, oh = im.h || ow / 0.68;
        const oL = ox, oR = ox + ow, oT = oy, oB = oy + oh;
        const ratio = ow / Math.max(oh, 1e-4);
        const moveLeft = c === 'tl' || c === 'bl', moveTop = c === 'tl' || c === 'tr';
        let moved = false;
        // 拉伸期间让按钮让位：不抢手势、也不挡住角上的视线
        w.classList.add('resizing');
        state.imgResizing = true;
        syncTiny(w, im);
        track(e.clientX, e.clientY, (ev, sx, sy) => {
          const dx = (ev.clientX - sx) / rect.width, dy = (ev.clientY - sy) / rect.height;
          // 用四条边来算：被拖的角移动两条边，对角固定
          let L = moveLeft ? oL + dx : oL;
          let R = moveLeft ? oR : oR + dx;
          let T = moveTop ? oT + dy : oT;
          let B = moveTop ? oB : oB + dy;
          if (ev.shiftKey) {                        // 按住 Shift 等比缩放
            const nw0 = R - L, nh0 = nw0 / ratio;
            if (moveTop) T = B - nh0; else B = T + nh0;
          }
          // 限制在纸内，四个角的调节手柄始终看得见、点得到
          L = clamp(L, IMG_M, 1 - IMG_M); R = clamp(R, IMG_M, 1 - IMG_M);
          T = clamp(T, IMG_M, 1 - IMG_M); B = clamp(B, IMG_M, 1 - IMG_M);
          if (R - L < IMG_MIN_W) { if (moveLeft) L = Math.max(IMG_M, R - IMG_MIN_W); else R = Math.min(1 - IMG_M, L + IMG_MIN_W); }
          if (B - T < IMG_MIN_H) { if (moveTop) T = Math.max(IMG_M, B - IMG_MIN_H); else B = Math.min(1 - IMG_M, T + IMG_MIN_H); }
          const nw = Math.max(R - L, IMG_MIN_W), nh = Math.max(B - T, IMG_MIN_H);
          if (Math.abs(nw - ow) > .002 || Math.abs(nh - oh) > .002 || Math.abs(L - ox) > .002 || Math.abs(T - oy) > .002) moved = true;
          im.x = L; im.y = T; im.w = nw; im.h = nh;
          applyBox(w, im);
          syncTiny(w, im);
          pageEl.querySelector('.pcontent').appendChild(w);
        }, () => {
          w.classList.remove('resizing');
          state.imgResizing = false;
          if (moved) {
            save();
            if (isText) { lockText(); toast('已固定'); }   // 文字调完大小默认自动固定
          }
        });
      });
    });
    const delBtn = w.querySelector('.img-del');
    if (delBtn) delBtn.addEventListener('pointerdown', e => {
      e.preventDefault(); e.stopPropagation();
      if (isText) {
        const arr = pageTexts(cur().pages[pid]);
        const k = arr.indexOf(getIm());
        if (k >= 0) arr.splice(k, 1);
        if (w.__outDown) { document.removeEventListener('pointerdown', w.__outDown, true); w.__outDown = null; }
        hideTextBar();
        toast('已删除文字');
      }
      else cur().pages[pid].images = cur().pages[pid].images.filter(x => x.id !== iid);
      save(); renderReader();
    });
    // 文字贴没有铺满按钮
    if (!w.querySelector('.img-lock:not(.img-fill)')) return;
    w.querySelector('.img-lock:not(.img-fill)').addEventListener('pointerdown', e => {
      e.preventDefault(); e.stopPropagation();
      const im = getIm(); if (!im) return;
      im.locked = true;
      w.classList.add('locked', 'justlock');
      w.classList.remove('sel');
      setTimeout(() => w.classList.remove('justlock'), 460);
      save();
      toast('已固定在第 ' + (pid + 1) + ' 页 · 长按可重新移动');
    });
    /* 铺满整页：撑满整张纸（object-fit:cover 裁切，不拉伸），并自动固定
       —— 不固定的话整页都是图片，左右滑动就变成拖图、没法翻页了 */
    const fillBtn = w.querySelector('.img-fill');
    if (fillBtn && !isText) fillBtn.addEventListener('pointerdown', async e => {
      e.preventDefault(); e.stopPropagation();
      const im = getIm(); if (!im) return;
      if (im.fill) {
        const r = await imgRatio(im.src);
        im.fill = false; im.locked = false;
        im.w = .42;
        im.h = clamp(im.w * r * paperAspect(), .04, IMG_MAX);
        im.x = .22; im.y = .2;
        save(); renderReader();
        toast('已还原原比例');
      } else {
        im.fill = true; im.x = 0; im.y = 0; im.w = 1; im.h = 1;
        im.locked = true;
        save(); renderReader();
        toast('已铺满整页 · 已固定，长按可解锁');
      }
    });
  });

}

/* ==================== 右上角「添加」：加页 / 图片 / 文字 ==================== */
/* 新内容加到哪一页。双页模式下左右两页都能加：
   - 默认落在当前跨页的左页
   - 「+」菜单展开时点某一页，就把那一页设为目标（右页也能选）
   - 在某一页上拖图片 / 编辑文字，也会把那一页记为最近操作页 */
let addPageIdx = null;                       // 用户指定的目标页；null = 跟随当前视图
function slotPageIndex(slotEl) {             // 某个页槽当前显示的是第几页（-1 = 封面 / 衬页）
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
    const a = state.spread * 2, b = a + 1;
    if (addPageIdx === a || addPageIdx === b) return clamp(addPageIdx, 0, n - 1);
    return clamp(a, 0, n - 1);
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
    // 「加一页」说的是插在哪一页后面，其余两项说的是加到哪一页
    s.textContent = ok ? (btn && btn.dataset.addact === 'page'
      ? '· 在第 ' + (p + 1) + ' 页后' : '· 第 ' + (p + 1) + ' 页') : '';
  });
  const row = $('#amTarget'); if (!row) return;
  const two = state.mode === 'spread' && !isCoverView();
  const [a, b] = currentIndices();
  row.classList.toggle('hide', !two);
  $$('#amTarget .am-side').forEach(btn => {
    const pid = btn.dataset.side === 'L' ? a : b;
    const ok = pid >= 0 && !!j.pages[pid];
    btn.textContent = (btn.dataset.side === 'L' ? '左页 ' : '右页 ') + (pid + 1);
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
function addImageTo(pid) {
  state.pendingPage = pid;
  const fp = $('#filePicker'); if (fp) fp.click();
}
function addTextTo(pid) {
  const j = cur(); if (!j || !j.pages.length) return;
  pid = clamp(pid, 0, j.pages.length - 1);
  const t = newText(.16, .16);
  pageTexts(j.pages[pid]).push(t);
  save(); renderReader();
  const w = $(`#slotL .ptext-wrap[data-id="${t.id}"], #slotR .ptext-wrap[data-id="${t.id}"]`);
  if (w) startTextEdit(w, pid, t.id);
  else showTextBar(null, pid, t.id);
  toast('已添加到第 ' + (pid + 1) + ' 页 · 双击可再编辑');
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

