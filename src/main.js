/* =====================================================================
 * Carnet · 启动入口   （脚本 23 / 23）
 * ---------------------------------------------------------------------
 * ① 读数据 → 一次性迁移 → 清理老预置本 → 应用偏好
 * ② 首次使用自动导入 example 目录
 * ③ 首次渲染并交给各模块接管
 *
 * 依赖模块：以上全部
 *
 * 说明：模块间共用全局作用域，按下面的顺序加载，顺序即依赖顺序。
 * ===================================================================== */
/* ==================== 启动 ==================== */
(async function init() {
  /* 改名 Carnet 之前的数据还在旧库 / 旧键里，先搬过来，再往下走 */
  try { await migrateLegacyStorage(); }
  catch (e) { console.error('[Carnet] 旧数据迁移出错：', e); }
  let data = await DB.get(KEY);
  if (!data || !Array.isArray(data)) data = [];                    // 不再预置任何默认手帐本，新用户从空书架开始
  /* 一次性清理：把老版本预置的三本（没被改过的那些）从书架里拿掉，
     它们现在作为示例文件放在 example 目录，首次使用时由 importExampleJournals 导回来。
     ⚠️ 只跑一次并写标记：否则以后用户手动导入的同名手帐本会被反复删掉 */
  if (!await DB.get(DROP_DEFAULT_FLAG_KEY)) {
    const kept = data.filter(j => !isLegacyDefault(j));
    if (kept.length !== data.length) { data = kept; await DB.set(KEY, data); }
    await DB.set(DROP_DEFAULT_FLAG_KEY, Date.now());
  }
  /* 一次性迁移：「日历」模板已下线，老数据自动换成现在的空白牛皮纸 */
  let migrated = false;
  /* 已下线的「日历」模板迁移到空白牛皮纸 */
  data.forEach(j => { if (j && j.template === 'calendar') { j.template = 'kraftplain'; migrated = true; } });
  /* 一次性迁移：封面图案「曼陀罗」换成「圆形」、「齿轮」换成「三角形」，老封面自动跟着改 */
  data.forEach(j => {
    if (j && j.cover && PAT_MAP[j.cover.pattern]) { j.cover.pattern = PAT_MAP[j.cover.pattern]; migrated = true; }
  });
  if (migrated) await DB.set(KEY, data);
  /* 一次性换装：预置手帐《花之法典》换成淡粉底 + 爱心图案 + 第二条彩带色。
     只认「还是老样子」的那一本，用户自己改过的封面不会被覆盖 */
  let restyled = false;
  data.forEach(j => {
    if (j && j.name === '花之法典' && j.cover && !j.cover.img
        && j.cover.value === GRADS[0] && j.cover.pattern === 'circle') {
      j.cover.type = 'solid'; j.cover.value = COLORS[1]; j.cover.pattern = 'heart';
      j.ribbon = RIBBONS[1];
      restyled = true;
    }
  });
  if (restyled) await DB.set(KEY, data);
  /* 一次性清理：把老数据里预置的星星/爱心/叶子小贴图整批去掉，内页不再自带装饰图案 */
  let cleaned = false;
  data.forEach(j => (j && j.pages ? j.pages : []).forEach(pg => {
    if (pg && Array.isArray(pg.images) && pg.images.some(im => isSeedSticker(im && im.src))) {
      pg.images = pg.images.filter(im => !isSeedSticker(im && im.src));
      cleaned = true;
    }
  }));
  if (cleaned) await DB.set(KEY, data);
  /* 显示偏好（展示模式 / 背景）单独存，不混进导出文件里 */
  state.prefs = Object.assign(defaultPrefs(), (await DB.get(PREF_KEY)) || {});
  if (state.prefs.view !== 'shelf') state.prefs.view = 'carousel';
  /* 一次性合并：主页背景和阅读器背景合成一份。
     用过效果的那一面为准（主页优先），旧键 homeBg / readerBg / home / reader 全部删掉 */
  let fixedBg = false;
  const pickBg = v => (v && (v.mode === 'color' || v.mode === 'image') && (v.value || v.img)) ? v : null;
  if (pickBg(state.prefs.bg)) { state.prefs.bg = pickBg(state.prefs.bg); }
  else {
    const old = pickBg(state.prefs.homeBg) || pickBg(state.prefs.readerBg)
             || pickBg(state.prefs.home) || pickBg(state.prefs.reader);
    if (old) { state.prefs.bg = old; fixedBg = true; }
  }
  ['homeBg', 'readerBg', 'home', 'reader'].forEach(k => { if (k in state.prefs) { delete state.prefs[k]; fixedBg = true; } });
  if (fixedBg) savePrefs();
  applyBg(); syncViewToggle();
  state.journals = data;
  state.sel = 0;
  renderHome();
  /* 首次使用：example 目录里有手帐本文件就自动导进来（有标记就只跑一次） */
  try { await importExampleJournals(); }
  catch (e) { console.error('[example] 自动导入出错：', e); }
  window.addEventListener('load', () => layoutCarousel(false));
  setTimeout(() => layoutCarousel(true), 60);
})();
