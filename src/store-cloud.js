/* Carnet · 商店云端接口：对接 Backend/server.js，商品与三类资源全部来自云端。 */
(function () {
  'use strict';
  const cfg = Object.assign({
    apiBase: '', allowLocalFallback: false, refreshOnUpdate: true
  }, window.CARNET_STORE_CONFIG || {});
  const base = String(cfg.apiBase || '').replace(/\/+$/, '');
  const listeners = new Set();
  let eventSource = null;

  function api(path) { return base + path; }
  async function loadProducts() {
    const res = await fetch(api('/api/products'), { cache: 'no-store' });
    if (!res.ok) throw new Error('backend-http-' + res.status);
    const data = await res.json();
    const list = Array.isArray(data) ? data : (data && data.products);
    if (!Array.isArray(list)) throw new Error('backend-payload');
    return list;
  }
  function connectEvents() {
    if (!cfg.refreshOnUpdate || eventSource || typeof EventSource === 'undefined') return;
    try {
      eventSource = new EventSource(api('/api/events'));
      eventSource.addEventListener('products', () => {
        listeners.forEach(fn => {
          try { fn(); }
          catch (e) { console.warn('[store] 热更新回调失败：', e); }
        });
      });
      /* EventSource 自带重连，这里不主动关闭。 */
      eventSource.onerror = () => {};
    } catch (e) {
      console.warn('[store] 无法订阅云端热更新：', e);
    }
  }
  window.CarnetStoreCloud = {
    /* 关掉本地清单兜底：云端不可用时直接报错，不显示旧商品。 */
    strictRemote: !cfg.allowLocalFallback,
    loadProducts,
    subscribe(fn) {
      if (typeof fn !== 'function') return () => {};
      listeners.add(fn);
      connectEvents();
      return () => listeners.delete(fn);
    },
    get apiBase() { return base; }
  };
})();
