/* =====================================================================
 * Carnet · PWA Service Worker
 * ---------------------------------------------------------------------
 * 只缓存同源静态资源；用户数据（IndexedDB）从不经过这里。
 * 关闭 PWA 时页面会 unregister 本 SW 并 postMessage 让仍在控制页面的
 * worker 立即停止拦截（disabled=true），所以关掉后不需要刷新就恢复在线直连。
 * ===================================================================== */
const CACHE = 'carnet-pwa-v21';

const SHELL = [
  './', './index.html', './manifest.webmanifest',
  './assets/pwa-icon-192.png', './assets/pwa-icon-512.png',
  './assets/frame-gold.js', './assets/shelf-rivet.js',
  './assets/frame-gold.jpg', './assets/shelf-rivet.png',
  './assets/font/carnet-hand.woff2', './assets/font/carnet-hand.woff',
  './assets/font/en/CourierPrime-Regular.woff2',
  './assets/font/en/CrimsonPro-Regular.woff2',
  './assets/font/en/CutiveMono-Regular.woff2',
  './assets/font/en/Domine-Regular.woff2',
  './assets/font/en/Gaegu-Regular.woff2',
  './assets/font/en/GochiHand-Regular.woff2',
  './assets/font/en/Inter_18pt-Regular.woff2',
  './assets/font/en/KronaOne-Regular.woff2',
  './assets/font/en/MartianMono_Condensed-Regular.woff2',
  './assets/font/en/MatrixMonoPrint-Regular.woff2',
  './assets/font/en/MatrixMonoRaster-Regular.woff2',
  './assets/font/en/MatrixMonoScreen-Regular.woff2',
  './assets/font/en/Outfit-Regular.woff2',
  './assets/font/en/PixelifySans-Regular.woff2',
  './assets/font/en/Playfair_9pt_SemiCondensed-Regular.woff2',
  './assets/font/en/Schoolbell-Regular.woff2',
  './assets/font/en/SpecialElite-Regular.woff2',
  './assets/vendor/pdf.min.js', './assets/vendor/pdf.worker.min.js',
  './assets/vendor/springboard.js',
  './style/base.css', './style/controls.css', './style/home.css',
  './style/book-style.css', './style/reader.css', './style/image-tools.css',
  './style/text.css', './style/page-bg.css', './style/scrub.css',
  './style/modal.css', './style/color-picker.css', './style/search.css',
  './style/confirm.css', './style/book-anim.css', './style/view-toggle.css',
  './style/shelf.css', './style/spine-shelf.css', './style/menus.css',
  './style/decor.css', './style/background.css', './style/diy-cover.css',
  './style/lock.css', './style/m-home.css',
  './src/menu-genie.js', './src/core.js', './src/visuals.js', './src/storage.js', './src/lock.js',
  './src/io-export.js', './src/io-doc.js', './src/io-share.js',
  './src/io-import.js', './src/io-example.js', './src/io-photobook.js',
  './src/state.js', './src/home-view.js', './src/carousel.js',
  './src/reader-view.js', './src/page-flip.js', './src/page-edit.js',
  './src/text-sticker.js', './src/page-bg.js', './src/media.js',
  './src/widgets.js', './src/img-frame.js', './src/stickers.js',
  './src/editor.js', './src/home-events.js', './src/spine-openfx.js', './src/reader-flow.js',
  './src/scrub.js', './src/system.js', './src/main.js',
  './src/swipe-back.js', './src/gl-lab.js', './src/pwa.js', './src/m-home.js',
  './example/manifest.json', './example/UCAS.json',
  './example/花之法典.json', './example/冷少!.json', './example/日志.json'
];

let disabled = false;

self.addEventListener('message', event => {
  const type = event.data && event.data.type;
  if (type === 'CARNET_PWA_OFF') disabled = true;
  else if (type === 'CARNET_PWA_ON') disabled = false;
  else if (type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    /* 单个文件缺失（例如用户没带 example 目录）不能让整个 SW 安装失败 */
    await Promise.all(SHELL.map(path =>
      cache.add(new URL(path, self.location.href)).catch(() => {})));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names
      .filter(name => name.startsWith('carnet-pwa-') && name !== CACHE)
      .map(name => caches.delete(name)));
    await self.clients.claim();
  })());
});

const indexURL = () => new URL('./index.html', self.location.href);

self.addEventListener('fetch', event => {
  const req = event.request;
  if (disabled || req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  /* 导航：优先拿最新版 HTML，断网时回退缓存的首页。
     ⚠️ 只更新 index.html 这一份，缓存里的脚本 / 样式仍按版本名整体升级。 */
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const res = await fetch(req);
        if (res && res.ok) {
          const cache = await caches.open(CACHE);
          cache.put(indexURL(), res.clone());
        }
        return res;
      } catch (e) {
        return (await caches.match(req))
          || (await caches.match(indexURL()))
          || new Response('离线且没有缓存的首页', { status: 503 });
      }
    })());
    return;
  }

  /* 静态资源：命中缓存直接回，未命中边取边存，断网且没缓存才失败 */
  event.respondWith((async () => {
    const cached = await caches.match(req);
    if (cached) return cached;
    try {
      const res = await fetch(req);
      if (res && res.ok && url.protocol !== 'chrome-extension:') {
        const cache = await caches.open(CACHE);
        cache.put(req, res.clone());
      }
      return res;
    } catch (e) {
      return new Response('', { status: 504 });
    }
  })());
});
