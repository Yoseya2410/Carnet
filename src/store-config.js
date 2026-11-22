/* Carnet 商店云端配置。部署后端后，把 apiBase 改成后端对外地址即可。
 * apiBase 留空 = 与页面同源（前后端同域名部署时用）。
 * 本机开发（localhost / 127.0.0.1，含 VS Code Live Server 5500）自动指向 8787 后端。
 * 也可用 URL 参数 ?storeApi=https://你的后端域名 覆盖，不必改文件。 */
(function () {
  const override = new URLSearchParams(location.search).get('storeApi');
  const isLocal = /^(localhost|127\.0\.0\.1|\[::1\])$/i.test(location.hostname);
  window.CARNET_STORE_CONFIG = {
    apiBase: override || (isLocal ? `http://${location.hostname}:8787` : ''),
    allowLocalFallback: false,
    refreshOnUpdate: true
  };
})();
