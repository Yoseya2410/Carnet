# Carnet 商店后端 · 使用说明

这套后端让商店的**商品目录、手账模板、贴纸包、字体文件全部来自云端**。前端只请求后端 API，不再依赖本地 `store/` 清单；后端支持热更新，改文件或上传资源后，已打开的商店页面会自动刷新商品，不需要重启服务、不需要刷新页面。

---

## 1. 目录结构

```
Backend/
├── server.js                  后端主程序（零第三方依赖）
├── config.js                  配置（端口、域名、Token 等）
├── package.json               npm start 入口
├── data/
│   ├── catalog.json           商品目录（唯一“商品清单”来源）
│   ├── Template/              手账模板 .json
│   ├── Sticker/               贴纸包 .lbl（内容是 JSON）
│   └── font/                  字体 .woff2 / .woff + OFL 授权 txt
└── tools/
    └── generate-catalog.js    从项目 store/ 目录重新生成 catalog.json
```

对应前端改动：

- `src/store-config.js`：填后端地址
- `src/store-cloud.js`：改为请求 `/api/products`，并订阅 `/api/events`
- `src/store.js`：收到推送后原地重绘
- `store.html`：加载 `store-config.js`，不再加载旧的云服务 SDK

---

## 2. 本机启动（5 分钟跑通）

要求：**Node.js 18 或更高版本**（无需 `npm install`，没有第三方依赖）。

```bash
cd Backend
npm start
# 或：node server.js
```

看到类似输出即成功：

```
[Carnet Store] 已启动：http://127.0.0.1:8787
[Carnet Store] 商品接口：http://127.0.0.1:8787/api/products
```

验证接口：

```bash
curl http://127.0.0.1:8787/api/health
curl http://127.0.0.1:8787/api/products
```

健康检查应返回 `{"ok":true,"products":10,...}`；商品接口应返回 10 条商品。

---

## 3. 让前端连到这个后端

打开 `src/store-config.js`：

```js
window.CARNET_STORE_CONFIG = {
  apiBase: 'https://store.你的域名.com',   // 后端对外地址，末尾不要斜杠
  allowLocalFallback: false,               // 默认只认云端
  refreshOnUpdate: true                    // 开启热更新
};
```

三种部署方式：

| 部署方式 | `apiBase` 怎么写 |
|---|---|
| 前后端同一个域名（推荐） | 留空 `''`，例如都用 `https://carnet.你的域名.com` |
| 后端独立域名/子域名 | 填完整地址 `https://store.你的域名.com` |
| 本机开发（含 VS Code Live Server 5500） | `apiBase` 留空即可：`localhost` / `127.0.0.1` 页面会自动请求 `http://127.0.0.1:8787` |
| 本机临时覆盖 | 不改文件，访问 `store.html?storeApi=http://127.0.0.1:8787` |

改完后重新部署前端静态文件。如果开着 PWA，`sw.js` 的缓存版本已递增，用户下次打开会自动拿到新脚本；调试时也可以强刷一次。

> 重要：后端如果在反向代理 / HTTPS 后面，务必设置 `PUBLIC_BASE_URL`，否则返回的字体地址会是内网 `http://127.0.0.1:8787/...`，浏览器拿不到字体。

---

## 4. 服务器上长期运行

### 4.1 环境变量

```bash
export PORT=8787
export HOST=0.0.0.0
export PUBLIC_BASE_URL=https://store.你的域名.com
export CORS_ORIGIN=https://carnet.你的域名.com     # 前端域名；同源部署可留 '*'
export ADMIN_TOKEN=换成一个随机长字符串
cd /opt/carnet/Backend && npm start
```

`config.js` 里所有项都能用环境变量覆盖。

### 4.2 systemd 服务（推荐）

新建 `/etc/systemd/system/carnet-store.service`：

```ini
[Unit]
Description=Carnet Store Backend
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/carnet/Backend
ExecStart=/usr/bin/node server.js
Restart=always
Environment=PORT=8787
Environment=PUBLIC_BASE_URL=https://store.你的域名.com
Environment=CORS_ORIGIN=https://carnet.你的域名.com
Environment=ADMIN_TOKEN=你的随机Token

[Install]
WantedBy=multi-user.target
```

然后：

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now carnet-store
sudo systemctl status carnet-store
```

### 4.3 nginx 反向代理示例

```nginx
server {
    listen 443 ssl;
    server_name store.你的域名.com;

    ssl_certificate     /path/fullchain.pem;
    ssl_certificate_key /path/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:8787;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # SSE 热更新必须关缓冲，否则前端收不到推送
    location /api/events {
        proxy_pass http://127.0.0.1:8787;
        proxy_buffering off;
        proxy_cache off;
        proxy_set_header Connection '';
        chunked_transfer_encoding off;
    }
}
```

---

## 5. 热更新资源（三种方式，任选）

后端每 2 秒扫描 `catalog.json` 和三个资源目录，发现变化就通过 SSE 通知所有已打开的商店页面；页面收到后自动重新拉商品并重绘。

### 方式 A：直接改服务器文件（最简单）

1. 替换 `Backend/data/Sticker/daily-doodles.lbl` 等文件；
2. 如果是新增商品，还要在 `Backend/data/catalog.json` 里加一条记录；
3. 最多 2 秒后，所有打开商店的用户自动看到更新。

### 方式 B：远程上传资源文件

需要 `x-admin-token` 头，`type` 只能是 `Template`、`Sticker`、`font`；字体 OFL 授权 txt 也用 `font`，和 woff2 放一起：

```bash
# 更新贴纸
curl -X POST --data-binary @daily-doodles.lbl \
  -H "x-admin-token: 你的Token" \
  "https://store.你的域名.com/api/upload?type=Sticker&name=daily-doodles.lbl"

# 新增手账模板
curl -X POST --data-binary @new-book.json \
  -H "x-admin-token: 你的Token" \
  "https://store.你的域名.com/api/upload?type=Template&name=new-book.json"

# 上传字体
curl -X POST --data-binary @MyFont.woff2 \
  -H "x-admin-token: 你的Token" \
  "https://store.你的域名.com/api/upload?type=font&name=MyFont.woff2"

# 上传字体授权文件（放 font 目录）
curl -X POST --data-binary @MyFont-OFL.txt \
  -H "x-admin-token: 你的Token" \
  "https://store.你的域名.com/api/upload?type=font&name=MyFont-OFL.txt"
```

上传成功后后端立即推送，前端自动刷新，无需等待轮询。

### 方式 C：远程替换整个商品目录

```bash
curl -X POST --data-binary @catalog.json \
  -H "x-admin-token: 你的Token" \
  -H "Content-Type: application/json" \
  "https://store.你的域名.com/api/catalog"
```

也可以先 `curl .../api/catalog > catalog.json` 下载现有目录，改完再传回去。

---

## 6. 新增一个商品

以新增贴纸包为例：

1. 把 `my-pack.lbl` 放进 `Backend/data/Sticker/`；
2. 在 `Backend/data/catalog.json` 的数组里追加：

```json
{
  "id": "my-pack",
  "type": "stickers",
  "name": "我的贴纸",
  "code": "MY PACK",
  "description": "一句话介绍",
  "sort_order": 11,
  "status": "published",
  "resource": "Sticker/my-pack.lbl"
}
```

三种商品的 `type` / `resource` 对应：

| 商品 | `type` | `resource` |
|---|---|---|
| 手账本 | `journal` | `Template/文件名.json` |
| 贴纸 | `stickers` | `Sticker/文件名.lbl` |
| 字体 | `font` | `font/文件名.woff2` |

字体商品还要多写一个 `font` 对象：

```json
"font": {
  "k": "store-myfont",
  "n": "我的字体",
  "en": "My Font",
  "hint": "My Font · 说明",
  "family": "CarnetStoreMyFont",
  "fallback": "'sans-serif'",
  "format": "woff2",
  "weight": "400"
}
```

`status` 写 `published` 才会展示；改成别的等于下架，不用删文件。

如果本地 `store/` 目录已经按同样结构放好了资源，也可以在项目根目录执行 `node Backend/tools/generate-catalog.js` 一键重建目录——注意它会**覆盖** `Backend/data/catalog.json`，线上改过的内容要先备份。

---

## 7. API 一览

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/health` | 健康检查、商品数、目录更新时间 |
| GET | `/api/products` | 公开商品列表，资源已展开成完整商品数据 |
| GET | `/api/catalog` | 原始目录 JSON |
| GET | `/api/events` | SSE 热更新推送 |
| GET | `/store/<类型>/<文件>` | 读取三类资源 |
| POST | `/api/upload?type=&name=` | 上传/替换资源（需 Token） |
| POST | `/api/catalog` | 替换整个目录（需 Token） |
| OPTIONS | 任意 | CORS 预检 |

所有响应都带 `Cache-Control: no-store`，避免浏览器和 PWA 缓存住旧商品。

---

## 8. 常见问题

**前端显示“商店文件没能读取”**
- 先看 `curl https://store.你的域名.com/api/products` 是否返回 JSON；
- 浏览器控制台看具体错误：`backend-http-404` 说明 `apiBase` 路径不对；CORS 报错说明后端 `CORS_ORIGIN` 没包含前端域名。

**字体卡片是空白 / 下载失败**
- 检查 `PUBLIC_BASE_URL` 是否是浏览器能访问的 https 地址；
- 检查 `/api/products` 返回的 `font.url` 是否指向正确域名；
- 直接 `curl` 那个 url，应返回 `200 font/woff2`。

**改了文件但用户端没更新**
- 最多等 2 秒（轮询间隔，可用 `WATCH_INTERVAL` 调小）；
- 检查 nginx 的 `/api/events` 是否关了 `proxy_buffering`；
- 浏览器控制台执行 `new EventSource('后端地址/api/events')` 看能否连上。

**上传返回 401**
- `x-admin-token` 和后端 `ADMIN_TOKEN` 不一致；默认Token是 `change-me`，上线前必须改。

**想临时用本地 `store/` 清单调试**
- 把 `src/store-config.js` 的 `allowLocalFallback` 改成 `true`，后端不可用时会自动回退本地清单；生产保持 `false`。
