/* =====================================================================
 * Carnet · 本地存储 · 书架数据 / 显示偏好 / 背景   （脚本 3 / 24）
 * ---------------------------------------------------------------------
 * ① IndexedDB 键值封装 DB（不可用时降级 localStorage）与防抖保存 save()
 * ② 显示偏好 prefs：展示模式、主页与阅读器共用的背景 setBg / applyBg
 * ③ 项目改名后把旧键数据搬到新键的一次性迁移 migrateLegacyStorage()
 *
 * 对外接口：DB, save, prefs, savePrefs, setBg, applyBg, bgIsLight, migrateLegacyStorage
 *
 * 依赖模块：core
 *
 * 说明：模块间共用全局作用域，加载顺序即依赖顺序（见 index.html 与 README）。
 * ===================================================================== */
/* ==================== 存储 ==================== */
const KEY = 'carnet_v2';
const DB = (() => {
  let p = null;
  let lowered = false;            // 是否已经降级到 localStorage（IndexedDB 不可用）
  function open() {
    if (p) return p;
    p = new Promise((res, rej) => {
      if (!window.indexedDB) return rej('noidb');
      const r = indexedDB.open('carnet_db', 1);
      r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains('kv')) r.result.createObjectStore('kv'); };
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    return p;
  }
  return {
    get lowered() { return lowered; },
    /* 读：IndexedDB 拿不到就退回 localStorage，两边都没有才返回 undefined */
    async get(k) {
      try {
        const db = await open();
        return await new Promise((res, rej) => {
          const q = db.transaction('kv').objectStore('kv').get(k);
          q.onsuccess = () => res(q.result);
          q.onerror = () => rej(q.error);
        });
      } catch (e) {
        const s = localStorage.getItem(k);
        return s ? JSON.parse(s) : undefined;
      }
    },
    /* 写入成功返回 true，两边都失败返回 false（不再静默吞掉：调用方要据此提醒用户） */
    async set(k, v) {
      try {
        const db = await open();
        await new Promise((res, rej) => { const q = db.transaction('kv', 'readwrite').objectStore('kv').put(v, k); q.onsuccess = () => res(); q.onerror = () => rej(q.error); });
        return true;
      } catch (e) {
        try { localStorage.setItem(k, JSON.stringify(v)); lowered = true; return true; }
        catch (e2) { console.error('[storage] 写入失败：', e2, e); return false; }
      }
    }
  };
})();
let saveTimer = null;
let lowWarned = false;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    try {
      const ok = await DB.set(KEY, state.journals);
      if (!ok) toast('保存失败：没能写入本地存储，请先导出备份再继续操作', 4200);
      else if (DB.lowered && !lowWarned) { lowWarned = true; toast('注意：当前只能用 localStorage 存储（IndexedDB 不可用），建议定期导出备份', 4200); }
    } catch (e) { toast('保存失败：' + ((e && e.message) || e), 4200); }
  }, 260);
}

/* 改名前的数据还在旧库 / 旧键里（paper_journal_*），升级后总不能让人手帐本凭空消失。
   搬到新键后才会有「标记」类的键，所以这里要把它们一起搬；搬过的键第二次会被跳过。 */
/* 从改名前的旧 IndexedDB 里读一个键（读不到 / 没这个库都返回 undefined） */
function legacyIdbGet(k) {
  return new Promise((res, rej) => {
    if (!window.indexedDB) return rej('noidb');
    const r = indexedDB.open('paper_journal_db', 1);
    r.onupgradeneeded = () => r.transaction.abort();          // 不该由我们来建，直接放弃
    r.onerror = () => rej(r.error);
    r.onsuccess = () => {
      const db = r.result;
      if (!db.objectStoreNames.contains('kv')) return res(undefined);
      try {
        const q = db.transaction('kv').objectStore('kv').get(k);
        q.onsuccess = () => res(q.result);
        q.onerror = () => rej(q.error);
      } catch (e) { rej(e); }
    };
  });
}
async function migrateLegacyStorage() {
  /* 注意：这张表写在函数里 —— PREF_KEY 在本文件更靠后处才声明，
     放到模块顶层会在加载时触发 TDZ（Cannot access before initialization） */
  const map = {
    'paper_journal_v2': KEY,
    'paper_journal_prefs': PREF_KEY,
    'paper_journal_example_v1': 'carnet_example_v1',
    'paper_journal_drop_defaults_v1': 'carnet_drop_defaults_v1'
  };
  for (const [oldKey, newKey] of Object.entries(map)) {
    try {
      if ((await DB.get(newKey)) !== undefined) continue;      // 新键已经有东西了，别覆盖
      let v;
      try { v = await legacyIdbGet(oldKey); } catch (e) { v = undefined; }
      if (v === undefined) {
        try { const s = localStorage.getItem(oldKey); v = s ? JSON.parse(s) : undefined; } catch (e) { v = undefined; }
      }
      if (v === undefined) continue;
      await DB.set(newKey, v);
      console.log('[Carnet] 已迁移旧数据：' + oldKey + ' → ' + newKey);
    } catch (e) { console.warn('[Carnet] 旧数据迁移失败（忽略）：' + oldKey, e); }
  }
}

/* ==================== 界面偏好：展示模式 / 自定义背景 ==================== */
/* 和手帐数据分开存，导出备份不受影响；背景图片压缩后放 IndexedDB，不占 localStorage */
const PREF_KEY = 'carnet_prefs';
function defaultPrefs() {
  /* 主页和阅读器共用同一套背景，只有一份设置 */
  return { view: 'carousel', bg: { mode: 'default', value: '', img: null } };
}
async function savePrefs() {
  const ok = await DB.set(PREF_KEY, state.prefs);
  if (!ok) toast('显示设置没能保存，稍后重试或先导出备份', 3600);
}
/* 纯色背景太浅时文字自动换深色：算一次感知亮度 */
function bgIsLight(v) {
  const m = String(v || '').match(/#[0-9a-fA-F]{3,6}/);
  if (!m) return false;
  let hex = m[0].slice(1);
  if (hex.length === 3) hex = hex.split('').map(x => x + x).join('');
  const n = parseInt(hex.slice(0, 6), 16);
  return (0.2126 * (n >> 16 & 255) + 0.7152 * (n >> 8 & 255) + 0.0722 * (n & 255)) / 255 > 0.62;
}
function applyBgTo(el, b) {
  el.classList.remove('bg-light');
  if (!b || b.mode === 'default' || (b.mode === 'color' && !b.value) || (b.mode === 'image' && !b.img)) { el.style.background = ''; return; }
  if (b.mode === 'image') { el.style.background = `url("${b.img}") center / cover no-repeat`; return; }
  el.style.background = b.value;
  if (bgIsLight(b.value)) el.classList.add('bg-light');
}
/* 主页和阅读器永远同一张背景：改一次，两处同时生效。
   body 也要铺同一份：#app 的高度被 JS 锁成 --app-h，而 #home 只盖住 #app——
   底栏是透明的，视口比 #app 高的那一条（地址栏伸缩、iOS 回弹、键盘收起瞬间）
   露出来的是 body 画布，不铺就会露出默认渐变，看起来"底栏处颜色和主页不一致"。
   body 有背景时会自动传播到整个画布；default 档清掉内联、回落到 CSS 里的默认渐变，两边依旧一致。 */
function applyBg() {
  const b = state.prefs.bg || { mode: 'default', value: '', img: null };
  applyBgTo($('#home'), b);
  applyBgTo($('#reader'), b);
  applyBgTo(document.body, b);
}
function setBg(patch) {
  state.prefs.bg = { ...(state.prefs.bg || {}), ...patch };
  applyBg();
  savePrefs();
}

