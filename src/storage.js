/* =====================================================================
 * Carnet · 本地存储 · 书架数据 / 显示偏好 / 背景   （脚本 3 / 28）
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
    /* 读：IndexedDB 优先，但**IndexedDB 里没这个键也要再看一眼 localStorage**。
       ⚠️ 以前只在 open/事务抛错时才降级读：某次写入因配额 / 私密模式失败而落进
          localStorage 后，下次启动 IndexedDB 又能打开了，get() 就只读到旧数据 ——
          表现是「明明天保存过，刷新后却没变」。大图（模板 / 封面）最容易触发。 */
    async get(k) {
      try {
        const db = await open();
        const v = await new Promise((res, rej) => {
          const q = db.transaction('kv').objectStore('kv').get(k);
          q.onsuccess = () => res(q.result);
          q.onerror = () => rej(q.error);
        });
        if (v !== undefined) return v;
      } catch (e) { /* 落到 localStorage */ }
      try {
        const s = localStorage.getItem(k);
        return s ? JSON.parse(s) : undefined;
      } catch (_) { return undefined; }
    },
    /* 写入成功返回 true，两边都失败返回 false（不再静默吞掉：调用方要据此提醒用户） */
    async set(k, v) {
      try {
        const db = await open();
        await new Promise((res, rej) => { const q = db.transaction('kv', 'readwrite').objectStore('kv').put(v, k); q.onsuccess = () => res(); q.onerror = () => rej(q.error); });
        /* 新数据已进 IndexedDB：清掉降级时留下的旧副本，免得哪天回读把它复活 */
        try { localStorage.removeItem(k); } catch (_) {}
        return true;
      } catch (e) {
        try { localStorage.setItem(k, JSON.stringify(v)); lowered = true; return true; }
        catch (e2) { console.error('[storage] 写入失败：', e2, e); return false; }
      }
    }
  };
})();
let saveTimer = null;
let saveSeq = 0;
let lowWarned = false;
function save() {
  /* 加密后持久化多了一步异步 AES：上一次已经进了 await、下一次又排上队时，
     两次写入有可能乱序（慢的那份反而后落盘）。给每次保存编个号，只让最后一次写。 */
  const seq = ++saveSeq;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    try {
      /* ⚠️ 加密本子在内存里是明文（解锁后才能读写），但**落盘一律是密文信封**：
         persistJournals 给每本加密本子现封一份，不改 state 里的明文对象。 */
      const payload = await persistJournals(state.journals);
      if (seq !== saveSeq) return;              // 有更新的保存排队了，这份旧的作废
      const ok = await DB.set(KEY, payload);
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
/* ⚠️ default 档现在也加 bg-light：默认界面背景本身就是浅色了（见 base.css 的 body 背景），
   不加的话标题 / 页数 / 书架空提示这些白字直接压在浅底上，一个字都看不见。
   毛玻璃控件不受影响 —— 它们自己的底色是深的（--frost），白字在上头照样读得清。 */
function applyBgTo(el, b) {
  el.classList.remove('bg-light');
  if (!b || b.mode === 'default' || (b.mode === 'color' && !b.value) || (b.mode === 'image' && !b.img)) {
    el.style.background = '';
    el.classList.add('bg-light');
    return;
  }
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

/* ==================== 自定义内页模板素材库（全局） ====================
   模板图以前只写进「当前这一本」的 j.tplImgs，而且必须点编辑器「完成」才落盘：
   新建一本 / 刷新前后 / 切到别的本子就找不到了。这里单独存一份全局素材库，
   · 添加时**立刻**写盘，不等编辑器完成；
   · 任何一本手帐的模板栏都能看到并选用，下次打开继续用；
   · 本子里的 j.tplImgs 仍保留 —— 它随手帐源文件一起导出 / 导入，换设备也带着。
   ⚠️ 单独一个键，不混进 prefs：改背景 / 存贴纸时不会反复重写这一大串 base64。 */
const TPL_LIB_KEY = 'carnet_tpl_lib';
/* 跟 visuals.js 的 TPL_IMGS_MAX 对齐：库里存太多而模板栏只显示前 12 张，
   会出现「明明加过却找不到」的怪事 */
const TPL_LIB_MAX = 12;
let tplLib = [];
function tplLibImgs() { return tplLib.slice(); }
async function loadTplLib() {
  const v = await DB.get(TPL_LIB_KEY);
  tplLib = Array.isArray(v)
    ? v.filter(s => typeof s === 'string' && isImgData(s)).slice(0, TPL_LIB_MAX)
    : [];
  return tplLib;
}
async function saveTplLib() {
  const ok = await DB.set(TPL_LIB_KEY, tplLib);
  if (!ok) toast('模板没能保存到本机，建议先导出备份再重试', 3600);
  return ok;
}
/* 并进新图（去重、限数量），立刻落盘；返回真正新增的张数 */
async function mergeTplLib(srcs) {
  const list = Array.isArray(srcs) ? srcs : [srcs];
  let added = 0;
  for (const s of list) {
    if (!isImgData(s) || tplLib.includes(s)) continue;
    tplLib.unshift(s); added++;
  }
  if (tplLib.length > TPL_LIB_MAX) tplLib.length = TPL_LIB_MAX;
  if (added) await saveTplLib();
  return added;
}
async function dropTplLib(src) {
  const n = tplLib.length;
  tplLib = tplLib.filter(s => s !== src);
  if (tplLib.length !== n) await saveTplLib();
}

