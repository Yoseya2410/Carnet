/* =====================================================================
 * Carnet · 数据模型 · 运行时状态与构造   （脚本 9 / 24）
 * ---------------------------------------------------------------------
 * ① state / cur() / pageCount()：当前书架与浏览位置
 * ② 手帐本与页面的构造：mkPage / mkPages / newText / newJournal
 * ③ 对象上下层 z：ensureZ / nextZ（图片与文字共用一套 z，越大越上）
 * ④ 老版本预置手帐本的识别 isLegacyDefault（只摘没被动过的）
 *
 * 对外接口：state, cur, pageCount, mkPage, mkPages, newText, newJournal, ensureZ, nextZ
 *
 * 依赖模块：core, visuals
 *
 * 说明：模块间共用全局作用域，加载顺序即依赖顺序（见 index.html 与 README）。
 * ===================================================================== */
/* ==================== 状态 ==================== */
const state = {
  journals: [], sel: 0, mode: 'single', page: 0, spread: 0,
  /* 拖动 / 四角拉伸进行中 —— 图片与文字贴共用这两个标记 */
  imgDragging: false, imgResizing: false,
  prefs: defaultPrefs(),
  picking: false,            // 书架多选中
  pickPurpose: 'export',     // 这次多选是来干啥的：'export' 导出 / 'del' 删除
  picked: new Set(),         // 勾了哪几本（存手帐本 id，重排 / 增删都不会认错人）
  /* 下面两个不是初始状态，是运行时才写进来的，列在这里方便一眼看全：
     pw          当前一页的宽（px），由 layoutBook() 量出来；page-flip.js 靠它算半页位移，
                 所以「先 layoutBook 再翻页」这个顺序不能反
     pendingPage 开书时要跳到的那一页，openReader / 加页时写，renderReader 消费后清空 */
  pw: 0, pendingPage: null
};
const cur = () => state.journals[state.sel];
const pageCount = () => cur() ? cur().pages.length : 0;

/* ==================== 初始数据 ==================== */
function mkPage() { return { images: [], texts: [] }; }
function mkPages(n) { return Array.from({ length: n }, mkPage); }
function pageTexts(pg) { if (!pg.texts) pg.texts = []; return pg.texts; }
function newText(x, y, t) {
        /* font 缺省即手写体：老数据没有这个字段，渲染时按 'hand' 处理，所以一改字体全书一起变 */
        return { id: uid(), text: t || '', x: x ?? .16, y: y ?? .16, w: .56, h: .12,
                size: 5.5, color: '#2b2f3d', align: 'left', bold: false, font: 'hand' };
}
/* ---- 上下层（z）：数字越大越靠上 ----
   后加的东西盖在先加的上面，图片与文字混在一起排，不再「文字一律压在图片之上」。
   老数据没有 z：按「先图片后文字、各自保持原来的数组顺序」补一套（也就是原来的样子） */
function ensureZ(pg) {
  if (!pg) return 0;
  let n = 0;
  (pg.images || []).forEach(im => { if (typeof im.z === 'number') n = Math.max(n, im.z + 1); else im.z = n++; });
  (pg.texts || []).forEach(t => { if (typeof t.z === 'number') n = Math.max(n, t.z + 1); else t.z = n++; });
  return n;
}
/* 新对象该拿到的 z：压在这一页所有东西的上面 */
function nextZ(pg) {
  ensureZ(pg);
  if (!pg) return 0;
  let m = -1;
  (pg.images || []).forEach(im => { if (im.z > m) m = im.z; });
  (pg.texts || []).forEach(t => { if (t.z > m) m = t.z; });
  return m + 1;
}
/* 预置小贴图（星星/爱心/叶子）的特征路径：用于把老数据里自带的装饰图案清理掉 */
function isSeedSticker(src) {
  const s = String(src || '');
  if (!s.startsWith('data:image/svg')) return false;
  let svg = '';
  try { svg = decodeURIComponent(s.split(',')[1] || ''); } catch (_) { return false; }
  return svg.indexOf('M12 2l2.9 6.2 6.8.8-5 4.6 1.3 6.7L12 17.9 6 20.3l1.3-6.7-5-4.6 6.8-.8z') > -1
      || svg.indexOf('M12 21s-8-5.2-8-11a4.7 4.7 0 018-3.3A4.7 4.7 0 0120 10c0 5.8-8 11-8 11z') > -1
      || svg.indexOf('M12 2C7 6 4 11 4 15a8 8 0 0016 0c0-4-3-9-8-13z') > -1;
}
/* 应用不再自带任何预置手帐本：书架一开始是空的，示例手帐本从 example 目录导入（见 importExampleJournals） */
/* 老版本预置过《花之法典》《日志》《冷少!》三本，它们的完整样貌记在这里，
   只用来把「还没被动过」的那几本从老数据里摘掉（改名、改封面、写过内容的都算用户的，一律保留） */
const LEGACY_DEFAULTS = [
  { name: '花之法典', type: 'solid',    value: COLORS[1], pattern: 'heart', ribbon: RIBBONS[1], template: 'grid' },
  { name: '日志',    type: 'gradient', value: GRADS[6],  pattern: 'leaf',  ribbon: '#7a5230',  template: 'grid' },
  { name: '冷少!',   type: 'gradient', value: GRADS[5],  pattern: 'star',  ribbon: '#e0668a',  template: 'dots' }
];
function isLegacyDefault(j) {
  if (!j || typeof j !== 'object') return false;
  if (j.fromExample) return false;              // 从 example 目录导进来的，不是老预置本
  const d = LEGACY_DEFAULTS.find(x => x.name === j.name);
  if (!d) return false;
  const cv = j.cover || {};
  if (cv.img) return false;
  if ((cv.type || 'solid') !== d.type) return false;
  if (cv.value !== d.value) return false;
  if ((cv.pattern || 'none') !== d.pattern) return false;
  if (j.ribbon !== d.ribbon || j.template !== d.template) return false;
  if (normPaperBg(j.pageBg)) return false;                // 改过内页底色：算用户的
  if ((j.pages || []).some(p => p && normPaperBg(p.bg))) return false;
  /* 内页还是空的才算没用过：写过字、贴过图的都留着 */
  return (j.pages || []).every(p => !p || (!(p.images && p.images.length) && !(p.texts && p.texts.length)));
}
function newJournal() {
  return {
    id: uid(), name: '未命名手帐',
    cover: { type: 'gradient', value: GRADS[1], pattern: 'none', img: null },
    ribbon: '#c98a8a', template: 'blank', pageBg: '', pages: mkPages(1), created: Date.now()
  };
}

