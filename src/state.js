/* =====================================================================
 * Carnet · 数据模型 · 运行时状态   （脚本 9 / 23）
 * ---------------------------------------------------------------------
 * ① state / cur / pageCount：当前书架与浏览位置
 * ② 手帐本与页面的构造：mkPage / newText / newJournal
 * ③ 老版本预置手帐本的识别 isLegacyDefault（只摘没被动过的）
 *
 * 依赖模块：core, visuals
 *
 * 说明：模块间共用全局作用域，按下面的顺序加载，顺序即依赖顺序。
 * ===================================================================== */
/* ==================== 状态 ==================== */
const state = {
  journals: [], sel: 0, mode: 'single', page: 0, spread: 0, flipping: false,
  imgDragging: false, imgResizing: false, prefs: defaultPrefs(),
  picking: false,            // 书架多选中
  pickPurpose: 'export',     // 这次多选是来干啥的：'export' 导出 / 'del' 删除
  picked: new Set()          // 勾了哪几本（存手帐本 id，重排 / 增删都不会认错人）
};
const cur = () => state.journals[state.sel];
const pageCount = () => cur() ? cur().pages.length : 0;

/* ==================== 初始数据 ==================== */
function mkPage() { return { images: [], texts: [] }; }
function mkPages(n) { return Array.from({ length: n }, mkPage); }
function pageTexts(pg) { if (!pg.texts) pg.texts = []; return pg.texts; }
function newText(x, y, t) {
        return { id: uid(), text: t || '', x: x ?? .16, y: y ?? .16, w: .56, h: .12,
                size: 5.5, color: '#2b2f3d', align: 'left', bold: false };
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
  /* 内页还是空的才算没用过：写过字、贴过图的都留着 */
  return (j.pages || []).every(p => !p || (!(p.images && p.images.length) && !(p.texts && p.texts.length)));
}
function newJournal() {
  return {
    id: uid(), name: '未命名手帐',
    cover: { type: 'gradient', value: GRADS[1], pattern: 'none', img: null },
    ribbon: '#c98a8a', template: 'blank', pages: mkPages(1), created: Date.now()
  };
}

