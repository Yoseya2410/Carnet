/* =====================================================================
 * Carnet · PWA 实验开关   （脚本 30 / 31）
 * ---------------------------------------------------------------------
 * 对外接口：window.CarnetPWA.{status(), set(on), enable(), disable(), toggle(), on}
 *
 * ① 开：挂 <link rel=manifest> + 注册 sw.js（离线缓存 / 可安装）
 * ② 关：摘 manifest + unregister + 通知现存 worker 停止拦截 + 删缓存
 * ③ 默认关闭；状态只存 localStorage 的 carnet_pwa_v1，不进 state.prefs、不跟导出走
 *
 * ⚠️ file:// / 非安全上下文没有 Service Worker：开关呈「不支持」并禁用，
 *    不会假装成功；部署到 https 或 localhost 后刷新自动恢复。
 * ===================================================================== */
(function () {
  'use strict';

  const LS = 'carnet_pwa_v1';
  const MANIFEST_ID = 'pwaManifest';
  const MANIFEST_HREF = 'manifest.webmanifest';
  const SW_URL = 'sw.js';
  const CACHE_PREFIX = 'carnet-pwa-';

  let wanted = false;
  try { wanted = localStorage.getItem(LS) === 'on'; } catch (_) {}

  const supported = !!(navigator.serviceWorker && window.isSecureContext
    && location.protocol !== 'file:');
  const unsupportedReason = supported ? ''
    : '当前环境无法注册 PWA：请用 https 或 localhost 打开，直接双击 index.html 不行';
  let failure = '';
  let registration = null;
  let opToken = 0;                  // 快速来回拨开关时，丢弃过期的异步结果

  function changed() {
    try { window.dispatchEvent(new Event('carnet-pwa-change')); } catch (_) {}
  }
  function manifestLink() {
    return document.getElementById(MANIFEST_ID)
      || document.querySelector('link[rel="manifest"]');
  }
  function syncManifest() {
    let link = manifestLink();
    if (wanted) {
      if (!link) {
        link = document.createElement('link');
        link.id = MANIFEST_ID;
        link.rel = 'manifest';
        document.head.appendChild(link);
      }
      link.rel = 'manifest';
      link.href = MANIFEST_HREF;
    } else if (link) {
      link.remove();
    }
  }
  function workerOf(reg) {
    return reg && (reg.active || reg.waiting || reg.installing) || null;
  }
  function post(reg, type) {
    const worker = workerOf(reg);
    if (worker) { try { worker.postMessage({ type: type }); } catch (_) {} }
  }
  async function register(token) {
    if (!supported || !wanted) return false;
    try {
      const reg = await navigator.serviceWorker.register(SW_URL, { scope: './' });
      if (token !== opToken) return false;
      registration = reg;
      /* 重新开启时，上一个 worker 可能还控制着页面：把它从 disabled 状态唤醒 */
      post(reg, 'CARNET_PWA_ON');
      failure = '';
      changed();
      return true;
    } catch (e) {
      if (token !== opToken) return false;
      failure = 'PWA 注册失败：' + ((e && e.message) || e);
      changed();
      return false;
    }
  }
  async function unregister(token) {
    if (!supported) return;
    try {
      const regs = await navigator.serviceWorker.getRegistrations();
      if (token !== opToken) return;
      const ownScope = new URL('./', location.href).href;
      const mine = regs.filter(reg => {
        const worker = workerOf(reg);
        const script = worker ? String(worker.scriptURL || '') : '';
        return reg.scope === ownScope || /\/sw\.js(?:\?|$)/.test(script);
      });
      await Promise.all(mine.map(async reg => {
        /* 先通知再注销：unregister 不会立刻掐掉已在控制页面的 worker，
           不置 disabled 的话关闭后仍会有一段「明明关了还能离线打开」的窗口。 */
        post(reg, 'CARNET_PWA_OFF');
        try { await reg.unregister(); } catch (_) {}
      }));
    } catch (_) {}
    if (token !== opToken) return;
    try {
      const names = await caches.keys();
      await Promise.all(names
        .filter(name => name.indexOf(CACHE_PREFIX) === 0)
        .map(name => caches.delete(name)));
    } catch (_) {}
    if (token !== opToken) return;
    registration = null;
    changed();
  }
  function set(v) {
    wanted = !!v;
    const token = ++opToken;
    try { localStorage.setItem(LS, wanted ? 'on' : 'off'); } catch (_) {}
    syncManifest();
    changed();
    if (!wanted) { unregister(token); return true; }
    /* 不支持的环境也记住用户选择并让开关有反馈；只是不注册 SW，
       等换到 https / localhost 打开时 boot() 会自动按这个状态启用。 */
    if (!supported) return true;
    register(token);
    return true;
  }

  const api = {
    status: function () {
      return {
        on: wanted,
        active: !!(registration && workerOf(registration)),
        supported: supported,
        controlled: !!(navigator.serviceWorker && navigator.serviceWorker.controller),
        failed: failure || unsupportedReason
      };
    },
    set: set,
    enable: function () { return set(true); },
    disable: function () { return set(false); },
    toggle: function () { set(!wanted); return wanted; },
    get on() { return wanted; }
  };
  window.CarnetPWA = api;

  function boot() {
    syncManifest();
    if (!wanted) unregister(opToken);
    else if (supported) register(opToken);
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
