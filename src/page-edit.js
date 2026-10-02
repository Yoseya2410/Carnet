/* =====================================================================
 * Carnet · 页面内容编辑 · 图片与文字对象   （脚本 14 / 24）
 * ---------------------------------------------------------------------
 * ① bindPage：页面手势（拖动 / 四角拉伸 / 旋转 / 长按解锁）
 * ② 选中对象后的工具条 objAction：完成 ✓ / 复制 / 编辑 / 删除
 * ③ 右上角「添加」菜单：加页 / 加图片 / 加文字 / 本页底色 / 删本页，目标页判定 currentAddPage
 * ④ 文字贴单击零反应、双击才进编辑态（编辑逻辑在 text-sticker.js）
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
    /* 铺满整页要顺手固定：不然整张纸都是图片，左右一划就成了拖图，翻不了页 */
    im.fill = true; im.x = 0; im.y = 0; im.w = 1; im.h = 1;
    im.locked = true;
    save(); renderReader();
    toast('已铺满整页 · 已固定，长按可解锁');
  }
}

function bindPage() {
  const track = (startX, startY, move, done) => {
    const mv = ev => move(ev, startX, startY);
    const up = () => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up); done && done(); };
    window.addEventListener('pointermove', mv);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    return up;                           // 交出去，好在别处提前收手（旋转手柄双击摆正要用）
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
    const disarmOut = () => {
      if (w.__outDown) { document.removeEventListener('pointerdown', w.__outDown, true); w.__outDown = null; }
    };
    const realign = () => { const im = getIm(); syncBar(w, im); fitObjBar(w); };

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
      const rect = pageEl.getBoundingClientRect();
      const ox = im.x, oy = im.y;
      let moved = false;
      track(e.clientX, e.clientY, (ev, sx, sy) => {
        const dx = (ev.clientX - sx) / rect.width, dy = (ev.clientY - sy) / rect.height;
        if (Math.abs(dx) > .002 || Math.abs(dy) > .002) moved = true;
        im.x = clamp(ox + dx, OBJ_MIN, OBJ_MAX);
        im.y = clamp(oy + dy, OBJ_MIN, OBJ_MAX);
        w.style.left = (im.x * 100).toFixed(2) + '%';
        w.style.top = (im.y * 100).toFixed(2) + '%';
        if (moved) syncBar(w, im);
      }, () => {
        state.imgDragging = false;
        if (moved) { save(); realign(); }
      });
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
      const rect = pageEl.getBoundingClientRect();
      const sx = e.clientX, sy = e.clientY, ox = im.x, oy = im.y;
      let dragging = false;
      const mv = ev => {
        if (!dragging) {
          if (Math.abs(ev.clientX - sx) + Math.abs(ev.clientY - sy) < 9) return;
          dragging = true; w.__dragging = true;
          state.imgDragging = true;
          try { window.getSelection().removeAllRanges(); } catch (_) {}   // 把拖出来的选区清掉
        }
        im.x = clamp(ox + (ev.clientX - sx) / rect.width, OBJ_MIN, OBJ_MAX);
        im.y = clamp(oy + (ev.clientY - sy) / rect.height, OBJ_MIN, OBJ_MAX);
        w.style.left = (im.x * 100).toFixed(2) + '%';
        w.style.top = (im.y * 100).toFixed(2) + '%';
      };
      const up = () => {
        window.removeEventListener('pointermove', mv);
        window.removeEventListener('pointerup', up);
        window.removeEventListener('pointercancel', up);
        w.__dragging = false;
        state.imgDragging = false;
        if (dragging) { save(); realign(); }
      };
      window.addEventListener('pointermove', mv);
      window.addEventListener('pointerup', up);
      window.addEventListener('pointercancel', up);
    };

    const startDrag = e => {
      state.imgDragging = true;
      $$('.pimg-wrap,.ptext-wrap').forEach(x => x.classList.remove('sel', 'adjust'));
      w.classList.add('sel');
      const im = getIm(); if (!im) { state.imgDragging = false; return; }
      syncBar(w, im); fitObjBar(w);
      const rect = pageEl.getBoundingClientRect();
      const ox = im.x, oy = im.y;
      let moved = false;
      track(e.clientX, e.clientY, (ev, sx, sy) => {
        const dx = (ev.clientX - sx) / rect.width, dy = (ev.clientY - sy) / rect.height;
        if (Math.abs(dx) > .002 || Math.abs(dy) > .002) moved = true;
        im.x = clamp(ox + dx, OBJ_MIN, OBJ_MAX);
        im.y = clamp(oy + dy, OBJ_MIN, OBJ_MAX);
        w.style.left = (im.x * 100).toFixed(2) + '%';
        w.style.top = (im.y * 100).toFixed(2) + '%';
        /* 不再拖动时挪到最上层：上下层只由加入顺序决定（选中态本来就自带 z-index） */
      }, () => {
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
              toast('拖动挪位置 · 拖四角改大小 · 右边那颗转');
            }
          };
          window.addEventListener('pointermove', mv);
          window.addEventListener('pointerup', up);
          window.addEventListener('pointercancel', off);
          return;
        }
        /* 单击：什么都不做 —— 不选中、不画框、不能拖，手势照旧归翻页 */
        armTap(e);
        e.preventDefault();
        if (w.classList.contains('adjust')) startTextDrag(e);   // 面板开着时本来就是解锁态，按住照旧能挪
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
        const rect = pageEl.getBoundingClientRect();
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
        /* ---- 四角拉伸 ---- */
        const ox = im.x, oy = im.y, ow = im.w, oh = im.h || ow / 0.68;
        const oL = ox, oR = ox + ow, oT = oy, oB = oy + oh;
        const ratio = ow / Math.max(oh, 1e-4);
        const moveLeft = c === 'tl' || c === 'bl', moveTop = c === 'tl' || c === 'tr';
        let moved = false;
        // 拉伸期间让工具条让位：不抢手势、也不挡视线
        w.classList.add('resizing');
        state.imgResizing = true;
        syncTiny(w, im);
        /* 对象转过角度时，手指的位移要换算回「对象自己的方向」再改边，
           不然横竖会串：转了 90° 再拖右边界，会去改上边界 */
        const rad = (im.rot || 0) * Math.PI / 180;
        const cs = Math.cos(rad), sn = Math.sin(rad);
        track(e.clientX, e.clientY, (ev, sx, sy) => {
          const px = ev.clientX - sx, py = ev.clientY - sy;
          const dx = (px * cs + py * sn) / rect.width;
          const dy = (-px * sn + py * cs) / rect.height;
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
        }, () => {
          w.classList.remove('resizing');
          state.imgResizing = false;
          if (moved) { save(); realign(); }
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
