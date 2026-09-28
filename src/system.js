/* =====================================================================
 * Carnet · 系统 · 自适应与提示输出   （脚本 22 / 23）
 * ---------------------------------------------------------------------
 * ① 窗口尺寸变化的重排（输入法弹起不重排，避免收走输入法）
 * ② toast()：所有提示统一输出到控制台，界面不再弹浮层
 *
 * 依赖模块：core
 *
 * 说明：模块间共用全局作用域，按下面的顺序加载，顺序即依赖顺序。
 * ===================================================================== */
/* ==================== 自适应 ==================== */
let rzTimer = null, lastVW = window.innerWidth;
window.addEventListener('resize', () => {
  clearTimeout(rzTimer);
  rzTimer = setTimeout(() => {
    if (state.prefs.view === 'shelf') renderShelf(); else layoutCarousel(false);
    const vw = window.innerWidth;
    const widthChanged = vw !== lastVW;
    lastVW = vw;
    /* 只有宽度真变了（转屏 / 窗口缩放）才重排阅读器。
       输入法弹起只改高度，这时候重绘会把正在编辑的文本框重建掉，输入法就被收走了。 */
    if (!widthChanged || pageBusy()) return;
    if ($('#reader').classList.contains('show')) {
      const wasSpread = state.mode === 'spread';
      const nowSpread = isSpread();
      if (wasSpread && !nowSpread) state.page = Math.max(state.spread * 2, -1);   // 停在封面时转单页仍然是封面
      else if (!wasSpread && nowSpread) state.spread = Math.floor(state.page / 2);
      renderReader();
    }
  }, 160);
});

/* ==================== 提示信息（一律进控制台，界面不再弹浮层） ==================== */
/* 失败类的用 warn 输出，控制台里按级别就能筛出来；第二个参数（显示时长）留着不用，
   这样以前所有 toast(...) 的调用都能原样保留，不用挨个改 */
const TOAST_TAG = '[Carnet]';
function toast(msg, ms) {
  const text = String(msg == null ? '' : msg);
  if (/失败|错误|出错|没能|无法|不支持/.test(text)) console.warn(TOAST_TAG, text);
  else console.log(TOAST_TAG, text);
}

