/* Carnet 商店后端配置：所有项都可以用环境变量覆盖，方便直接部署到服务器。 */
const path = require('path');

module.exports = {
  host: process.env.HOST || '0.0.0.0',
  port: Number(process.env.PORT || 8787),
  dataDir: path.resolve(process.env.DATA_DIR || path.join(__dirname, 'data')),
  /* 对外可访问的根地址，留空时按请求的 Host 自动推断。前面的域名部署务必填 https://你的域名 */
  publicBaseUrl: (process.env.PUBLIC_BASE_URL || '').replace(/\/+$/, ''),
  /* 允许访问 API 的前端来源，'*' 表示任意来源；也可以写 'https://carnet.example.com' */
  corsOrigin: process.env.CORS_ORIGIN || '*',
  /* 调用 /api/upload 和 /api/catalog 写接口时 header x-admin-token 的值 */
  adminToken: process.env.ADMIN_TOKEN || 'change-me',
  maxUploadBytes: Number(process.env.MAX_UPLOAD_BYTES || 12 * 1024 * 1024),
  /* 轮询 catalog.json 与三个资源目录的间隔（毫秒），变更最多这么久后推送给前端 */
  watchInterval: Number(process.env.WATCH_INTERVAL || 2000)
};
