# Carnet · 手帐本

一个**纯前端、零依赖、数据只存本机**的手帐本（Journal）应用。
打开网页就能写字、贴图、做封面、翻页，也能把手帐本导出成文件随身带走或分享给别人。

- **没有服务器、没有账号**：所有内容存在浏览器的 IndexedDB（不可用时自动降级 localStorage）。
- **没有任何外部依赖**：PDF / SVG 导出、图案、取色盘全部自己实现，`npm install` 都不需要。
- **一个 HTML + 一组模块**：`index.html` 按顺序加载 `src/*.js` 与 `style/*.css`（见下方模块表）。

---

## 一、跑起来

因为「首次使用自动导入 `example/` 里的示例手帐本」要用 `fetch` 读目录文件，**必须通过 http 打开**
（直接双击 `index.html` 用 `file://` 打开时，浏览器禁止读取本地文件，这一步会自动跳过，其余功能不受影响）。

在本目录起任意一个静态服务即可：

```bash
# Python
python -m http.server 8080

# Node
npx serve .
```

然后访问 `http://127.0.0.1:8080/index.html`。

> 部署到子目录也能正常工作——`example/` 的位置是按 `document.baseURI` 解析的。

---

## 二、整体结构

```
Carnet/
├─ index.html          # 唯一的页面：结构骨架 + 按顺序引入所有模块
├─ src/                #  JavaScript 模块（28 个，见下一节）
├─ style/              #  CSS 模块（22 个，见下文）
├─ example/            #  示例手帐本文件，首次使用时自动导入
│   ├─ manifest.json   #   文件清单（服务器没开目录列表时的兜底）
│   └─ *.json          #   导出的手帐本
├─ README.md           #  本文件
└─ .workbuddy/         #  工具目录（项目记忆、无头浏览器验证脚本等，不参与运行）
```

数据流一句话概括：

```
index.html
   └─ src/main.js 启动
        ├─ src/storage.js      读数据（含旧键迁移）
        ├─ src/state.js        建立运行时状态
        ├─ src/home-view.js    渲染主页 / 书架
        ├─ src/reader-view.js  渲染阅读器 / 页面
        └─ 其余模块             各自接管一块交互
```

---

## 三、JavaScript 模块（`src/`）

模块之间**共用同一个全局作用域**，靠 `index.html` 里的加载顺序串起来（都是普通 `<script defer>`，
`defer` 既保证 DOM 就绪，也保证按书写顺序执行）。**顺序即依赖顺序，在中间插删文件请先看这一节。**

> 为什么不用 ES Module（`import/export`）：`type="module"` 在 `file://` 下会被 CORS 直接拦死，
> 双击打开就白屏了。现在这套写法在任何协议下都能跑，代价是依赖靠顺序而非靠 `import` 表达，
> 所以每个文件开头都写了「依赖模块」注释，改文件时照它来即可。

`index.html` 里另外还有一个**素材脚本** `assets/frame-gold.js`，排在 `core.js` 前面、不占上表的编号：
它只定义「相框」档图片边框用的 `FRAME_PHOTO_URL`（一张内嵌 base64 的金色雕花相框），
由同目录的 `assets/frame-gold.jpg` 生成。`visuals.js` 的 `frameBoxStyle` 在运行时读它，
所以必须最先加载；导出走 SVG `foreignObject` 独立文档，这张图只能内嵌、不能用相对路径。

| # | 文件 | 行数 | 职责 | 依赖 |
|---|---|---|---|---|
| 1 | `core.js` | 128 | 通用工具 `$ / $$ / uid / clamp / enc / esc / shade`、**高频事件逐帧合帧 `frameQueue`**；输入法弹起时锁定应用高度（底栏不被顶起，编辑文字时底栏跟着抬起）、编辑中把页面抬到键盘上方；`window.__kbHeight()` 对外暴露当前键盘高度（编辑面板据此把自己顶上去） | 无 | |
| 2 | `visuals.js` | 517 | 封面与纸面的视觉素材：圆 / 星 / 心 / 叶 SVG 图案（**三角、小花两档 2026-11-08 已删除**，老数据经 `PAT_MAP` 落回「无」）、封面明暗 `coverLum`、图案层 `patternLayers / faceLayers`（有封面图片时不叠图案；**缩略图统一用自动色 `c`、真实封面保留圆橙 / 星金 / 心粉 / 叶绿的预设色**，用户设了 `patColor` 时两边都以它为准）；色板 `COLORS / GRADS / RIBBONS / PAT_COLORS`（彩带含「透明」档 `RIBBON_NONE`，书脊背景走 `ribbonSpine`）与内页模板 `TEMPLATES`；文字贴用的 4 档中文字体 `TEXT_FONTS`（手写/楷/宋/默认；**黑体 2026-10-02 撤掉**，老数据里的 `'hei'` 靠 `FONT_ALIAS` 落到「默认字体」）、8 档英文字体 `EN_FONTS`（前 4 档系统字体 + 后 4 档项目自带 woff2：Courier Prime / Cutive Mono / Pixelify Sans / Special Elite；**一律不带通用族、字体名用单引号且必须成对**——栈末多一个引号会让整条 `font-family` 作废，宋体/黑体就是这么废掉的；英文栈排在中文字体**前面**；自带字体那几档多带 `face`（导出内嵌用）与 `fallback`（内嵌失败时的近似系统字体链））、7 档文字色 `TEXT_COLORS`、6 档高亮色 `TEXT_BGS`；对象工具条图标 `OB_*_SVG`、旋转手柄上的转圈箭头 `ROT_SVG`；**内页底色**：九组「由浅到深」的色阶 `PAPER_RAMPS`、`normPaperBg`；**全项目共用的尺寸与阈值** `PAGE_RATIO`（默认内页 A5 = `210/148`）/ `PAGE_W_DEFAULT / LUM_DARK`（只认 `#rgb / #rrggbb`）、三级取值 `pageBgOf`（单页 > 整本 > 模板）、`pageBgStyle / pageBgDark`、**预览版 `pageBgShown / pageBgDarkShown`**（读到 `window.__bgPv` 就先按面板上正在挑的那一档画，`pg.bg` 不动）、任意色值的亮度 `hexLum` | core |；**装帧样式** `BOOK_STYLES / normBookStyle / bookStyleOf / isRingStyle`（每档自带三个数：`asp` = 封面宽÷高、`pageAsp` = 内页宽÷高、`pageHScale` = 同比例展示时内页相对封面的高度 —— **笔记本 A5 148×210、活页封面 B6 125×176 而内页 95×170（比封面短 6mm）、方形画册 1:1**）、`pageRatioOf` / `coverRatioOf` / `pageHeightScaleOf`；**图片边框** `FRAMES / FRAME_COLORS / FRAME_DEFAULT_COLOR / normFrame / normHex6 / frameWidth / frameColor / frameBoxStyle / frameImgStyle / hasFrame`，「相框」档改用整张金色雕花图片做 9-slice 边框（素材内嵌在 `assets/frame-gold.js` 的 `FRAME_PHOTO_URL`），`framePhotoGeom()` 是 slice 宽度与照片 inset 的唯一来源 |
| 3 | `storage.js` | 166 | IndexedDB 封装 `DB`（降级 localStorage）、防抖保存 `save()`；显示偏好 `prefs` 与背景读写 `setBg / applyBg`（同一份背景铺 `#home / #reader / body`，body 兜住画布露底）；**改名后旧键 → 新键的一次性迁移** `migrateLegacyStorage()` | core | |
| 4 | `lock.js` | 670 | 手帐本加密：纯 JS MD5（UTF-8，保密问题答案 → 32 位 hex）、WebCrypto `PBKDF2-SHA256 (120000) → AES-GCM 256` 派生、随机 salt + 12 字节 iv；**密文信封** `sealJournal / unsealJournal`（整本内容一次加密，外壳只留书名 / 封面配色图案 / 装帧 / 页数空壳）；本机钥匙缓存 `carnet_lock_keys_v1`（**只存派生后的 raw AES 密钥 `rk:`**，不存密码原文）、`persistJournals / exportJournalBody`（落盘与导出一律密文）、`guardUnlocked`（两参，解锁后按入口各自的 `done` 落地）/ `autoUnlockQuiet` 解锁守卫、解锁 / 设置 / 换密钥 / 取消加密 / 立即上锁五套弹窗；书架锁徽章 `LOCK_FLAG_HTML` | core, visuals, storage |
| 5 | `io-export.js` | 187 | 导出地基：稳定序列化 `stableStringify`、摘要 `checksum`、资产计数 `countAssets`；单本导出、「另存为 / 系统分享 / 下载」`deliverBlob`、`downloadBlob` | core, storage | |
| 6 | `io-doc.js` | 282 | PDF / SVG 导出：每页渲染成 XHTML（`pageExportXHTML`，文字串带上英文字族、斜体、下划线 / 删除线、高亮；**图片与文字按 `z` 混排**，跟应用里的上下层一致；**底色走 `pageBgOf`，单页 > 整本 > 模板**，跟屏幕上同一套取舍）、JPEG 转字节流、手写 PDF 对象表 `buildPdf`、竖向拼 `foreignObject` 生成矢量长图；导出前 `probeExportFont` 实测手写体画不画得出来，画不出整段按楷体导；**四款自带英文字体**按这一本实际用到的档位把 woff2 转 base64 写进 SVG 根级 `<style>`（`prepareExportEnFaces`），独立文档也认得这个字族，没用到时一字不增 | core, visuals |；导出时**图片边框**（`<img>` 外再套一层 div，样式由 `frameBoxStyle` 现算）与**便利贴**（文字外框带纸色底 + 内高光 + 落地影 + 右下折角）一起画进去，方形画册按 1:1 出页 |
| 7 | `io-share.js` | 112 | 书架多选后**一本一个文件**批量导出；支持时只问一次目标文件夹（`showDirectoryPicker`），否则逐个下载 | core, io-export, io-doc | |
| 8 | `io-import.js` | 171 | 导入：`normalizeJournal` 补全并保留未知字段、`readJournals` 兼容三种写法且带 checksum 校验、`importJournals` 按内容摘要查重后入库并出核对报告 | core, storage, io-export |、**装帧样式 `style` 的归一**（缺 / 乱填一律落回 `classic`） |
| 9 | `io-example.js` | 125 | 首次使用的自动导入：列出 `example/` 下的手帐本文件（目录列表优先，`manifest.json` 兜底），逐个导入并写标记保证只导一次；帮助与反馈邮件入口 | core, storage, io-import | |
| 10 | `io-photobook.js` | 411 | 一键成书：一次选多张图片 → 按文件名自然序排好 → **一张图一页**做成一本 |
| 11 | `state.js` | 115 | 运行时状态 `state`、当前游标 `cur / pageCount`；页面与手帐本的构造 `mkPage / newText / newJournal`（新建带 `pageBg: ''`）；老预置本的识别 `isLegacyDefault`（**改过内页底色也算用户的**，不再被摘掉）；**文字贴字号范围 `TS_SIZE_MIN / TS_SIZE_MAX / TS_SIZE_DEFAULT`**（占纸宽百分比，`#tsSize` 滑块与四角等比缩放共用同一份）、**贴合算法版本 `TEXT_FIT_V`**（老本子的方框首绘时收紧一次）；**上下层 `ensureZ / nextZ`**（一页里的图片与文字共用一个 `z`，越大越靠上；老数据按「先图后字」补一套） | core, visuals |；**新建本子带 `style: BOOK_STYLE_DEFAULT`** |
| 12 | `home-view.js` | 336 | 主页渲染：封面 `coverHTML`、单本书 `bookItemHTML`、书架 `renderShelf`（**逐本试放换行**：方形画册比常规本宽 `210/148`，按「统一每行 N 本」算会让画册那排戳出搁板；各行的本数写进 `dataset.per`，逗号分隔）、多选模式 `enterPickMode / togglePick`、多选模式 `enterPickMode / togglePick`、**单层书架** `spineItemHTML`（书脊宽随页数 `spineWidthRatio`；高矮与几何装饰由 `spineSeed` 散列 `id`，**绝不掺下标** —— 掺了下标的话排序 / 增删后整排高矮与装饰会重新洗牌）/ `renderSpineShelf` / `renderSpineDetail`（**下方是「预览图」不是常驻详情**：默认显示**选中的那一本**并摆在它书脊的正下方 —— `spineDetailShift()` 量出目标书脊中心、换算成「相对预览框中心的偏移」写进 `--px`（夹在框内，书排横滑时预览贴边不飞出去），横滑 / 换选中时重新对位；鼠标停在别的书脊上时临时切过去、移开回到选中的那本；无悬停能力的设备由 `#spineWrap.no-preview` 整块收掉）/ `syncSpineSelection`、总渲染 `renderHome`、展示模式切换 `syncViewToggle`（在容器上写 `data-vt` 驱动白钮滑块位移） | core, visuals, state, storage, carousel |；`coverHTML` 按 `j.style` 出**三种装帧**：`.s-classic`（笔记本，有彩带只画平色带、透明档整列不画）/ `.s-personal`（活页手帐，封面干干净净：不画环也不留压痕）/ `.s-square`（1:1 方开本）。已下线的 `ring`（11 环）由 `normBookStyle` 折算成 `personal` |
| 13 | `carousel.js` | 237 | 主页「左右滑动」轮播：按屏幕比例算书的大小与间距、跟手滑动、松手后落到最近的一本并居中吸附；对外暴露 `layoutCarousel / selectJournal`。**性能：每本书的中心 / 宽只在 `measure()` 里量一次存进 `mets`，`styleItems()` 只读不写**（原来边写 transform 边读 offsetWidth，n 本书每帧 n 次强制重排）；跟手那一下走 `schedulePaint()` 按帧合帧，松手落位才直接 `paint()` | core, state | |
| 14 | `reader-view.js` | 256 | 阅读器渲染：单页 / 双页判定、书与中缝布局 `layoutBook`（`availH` 扣掉 `window.__sheetCov` 让编辑面板不压住纸面）、封面页与内页 `pageHTML`（`pageObjs` 把图片与文字按 `z` 混排 → `imgWrapHTML / textWrapHTML`，都挂上对象工具条 `objBarHTML`（**图片多「换图 / 边框」，文字贴多「字随框缩放」**）；**自定义内页底色写在模板底色之后**好盖住它，纸色深时给纸加 `.dark` 让页码转浅；**活页在每一页的纸面上补一列打孔** `pageHolesHTML`（孔必须跟着纸走，只挂在中缝的话翻页叶片一盖住中缝，正在翻起的那一页就没有孔）；**环的纵向位置 `ringTops`（上下两组、中间空一段 —— 实物活页夹中段是机构面板本身、没有环）由孔与环共用**；**中缝的环 `gutterRingsHTML` 每根拆成左右两个 D 形半环**（直边贴机构金属条、圆弧朝纸面拱出、弧顶压在孔心；不是一根横跨中缝的铁丝 —— 那看着像把纸串起来）；**活页内页底下垫一层「封面内侧」** `coverUnderStyle` + `.book-under`（内页是坐在封面上的，封面比内页大一圈、四周露一条边；由 `renderReader` 打 `has-under` 开关 —— 只有活页且已翻到内页时才开，封面态不能垫，否则是封面压封面）；**封面 / 内页分开取比例**（`coverRatioOf` / `pageRatioOf`）并乘 `pageHeightScaleOf` | core, visuals, state, carousel |；图片外面套一层 `.pframe` 画**边框**（样式见 `img-frame.js`），`layoutBook` 的纸张比例改按 `pageRatioOf(cur())` 取 |
| 15 | `page-flip.js` | 141 | 翻页动画：贝塞尔缓动、沿书脊翻转的叶片与深度压暗、`flip(dir)` | core, state, reader-view | |
| 16 | `page-edit.js` | 1045 | 页面内容编辑（**所有拖动 / 拉伸 / 旋转都过 `track()`，它把 pointermove 攒到一帧只跑一次，松手时补跑最后那一下，位置不丢**）：拖拽移动、双指缩放（**不再拖到最上层**，上下层只由加入顺序决定）；图片**点一下即选中**并浮出工具条（`objAction`：完成 ✓ / 复制 / **换图** / 编辑 / 删除 —— 第三颗是换图（只有图片有）、第四颗是铺满 ⇄ 还原，删除后必定整页重绘；**换图在这里只负责记住要换哪一张（`state.swapTarget`）并唤出选图框，真正的替换在 media.js 的 `replaceImage`**；**行内打字时点工具条会先把字落盘**）；**旋转**（右侧那颗 `.hdl.rot` 绕中心转，Shift 每 15° 吸附，双击摆正；四角拉伸的位移会先换算回对象自己的方向）；**文字贴四角 = 整块等比缩放**：框宽、框高、字号 `size`、行宽上限 `ww` 同乘一个系数、对角钉死不动，换行位置不变（系数按手指位移在「对角 → 被拖角」上的投影算，受纸边 / `TS_SIZE_*` 夹逼；**文字贴的下限是「一个字宽 / 一行行高」，绝不能套图片的 `IMG_MIN_*=.1`** —— 一行字只有约 6% 页高，套上去手指刚动 4px 就放大 1.7 倍；拉伸期间只改 `.ptxt` 的 `font-size`、不整页重绘，首尾各调一次 `fitTextBox` 贴紧内容）；按住 Alt 拖或把工具条那颗「字随框缩放」点灭 = 回到图片那种自由拉伸（字号不动，Shift 仍锁原宽高比，并把拉出来的行宽记进 `ww`、置 `autoW=false`）；**首绘时按 `fitV` 把老数据的方框收紧一次**；**文字贴单击完全不响应**；长按 420ms 进版式态（解锁 → 选中 → 放出四角 / 旋转手柄 → 抬手前就能拖着挪位置），双击进内容态（只落光标打字，手柄收起、不能移动 / 缩放 / 旋转）—— 双击判定要等松手：第二下按下时还分不清是双击还是翻页的一划，挪开就放行给翻页（`armTap` 同理，划过的那一按不给双击留记号）；右上角「添加」菜单（加页 / 图片 / 文字 / **本页底色** / 删本页）与目标页判定 —— **「本页底色」在这里只负责把目标页交给底部弹窗**（`openBgSheet`，见 `page-bg.js`） | core, state, media, text-sticker |；工具条多一颗**「边框」**钮（`frame` 档 → 开 `#frsheet`）；**纸面右键菜单 + 对象级剪贴板**：复制 / 剪切 / 粘贴整块文字贴或图片，右键落点就是粘贴中心，可跨页；工具条「复制」、右键、Ctrl+C/X/V 共用一份内存剪贴板，内部为空时读系统剪贴板（纯文本落成文字贴、图片落成图片对象）；**文字面板开着时也能直接拖动文字框**，解锁的文字贴不必再长按 420ms |
| 17 | `text-sticker.js` | 947 | 文字贴：① 底部（宽屏是右下角浮块）「编辑文字」面板 `.tsheet` —— 正文输入 + 字体 / 颜色 / 字号 / 格式四个标签页，改动即时画回纸面并记进面板会话内的撤销栈（连续打字 800ms 内合并一步）；② 面板打开即 `eflow` 编辑态（顶栏底栏让位、书整体上移避让；**底色弹窗借用同一套：`updateEflow` 认 `window.__bgSheetOpen`，`sheetLayout` 按「哪块面板开着」量避让高度，撤销 / 重做只在文字面板开时才露出来**）；③ 行内编辑（双击直接打字）保留，输入法收起自动结束；④ **框紧贴内容** `fitTextBox / textFitSize / refitVisibleTexts`（宽高都实量：`t.ww` 行宽上限、`t.w` 实际框宽、`t.autoW` 是否自动贴宽、`t.fitV` 算法版本；字体加载完成后补贴一次 —— 见下面「两个量高度的坑」）；⑤ `syncTextSizeUI` 把纸面上改动的字号同步回面板滑块 / px 数字 / 快捷档；⑥ **空文字框**：DOM 里一个字都不放（淡提示画在 `.ptext-wrap.empty::before` 上，不进 `innerText` / 导出 / 存档），收面板或结束行内输入时仍是空的就把数据整条摘掉（便利贴 `t.note` 除外），刚添加的文字第一次收面板先不锁、留在可拖的版式态 `FRESH_TEXT_IDS` | core, state, visuals |；**面板那套现在是通用的**：`updateEflow` / `sheetLayout` 由编辑文字、本页底色、图片边框、贴纸**四张面板**共用（见 `SHEET_SELS`） |
| 18 | `page-bg.js` | 147 | 「本页底色」底部弹窗：和「编辑文字」共用一套 `.tsheet` 视觉与 `eflow` 编辑态。标题「第 N 页底色」+ 当前色预览 + **九种颜色横排成列、每种竖着六档由浅到深**（上浅下深，组名挂列底；点一下即上色、面板不关可以连着试）+ **完成** / 自定义取色；**没有「跟随整本」这一档**（底色一律按页挑，本页没设就沿用整本 / 模板的纸色）；**点色块只是预览** —— `pickPageBg` 只改 `bgs.pick` 和 `window.__bgPv`，`pg.bg` 一个字节都不动（纸面借 `pageBgShown` 按预览色画）；只有 `commitBgSheet`（底部「完成」或左上角 ✓，挂在 `window.__bgOk` 上）才 `writePageBg` 落盘；关面板走 `closeBgSheet` = 取消，顺手清 `__bgPv` 并按原数据重绘，挑了色没按完成就自动回原样。`syncBgSheet` 刷选中态 / 预览文案（没按完成时显示 `· 待完成`）/ 完成键的点亮 | core, state, visuals, text-sticker, widgets | |
| 19 | `media.js` | 296 | 图片：选图入口、压缩 `shrinkImageFile`（统一缩到长边像素上限；第三个参数 `opt = { q, bg }` 可给 JPEG 质量与打底色，一键成书那一路用）、按真实比例落位 `ensureImageHeights`、**换图 `replaceImage`**（只读文件 `readFileDataURL`）与换图专用的隐藏 input `#swapFile`、封面图片上传；对象外框 `applyBox / applyRot`（`--rot` + `transform` 一起写，旋转与位置尺寸同步落盘） | core |；`applyFillGeom(im, j)` 按这一本取纸比例（方形本也能算对） |
| 20 | `widgets.js` | 431 | 通用控件：自定义取色盘（HSV 面板 + 色相条 + 手输色值）、**吸管取色**（现场取色、不弹窗：只取手账本里的内容，从 `elementsFromPoint` 逐层 alpha 合成取色，图片把屏幕坐标逆映射回原始像素采样，**CSS 渐变 / 图案 / 模板细线用 SVG foreignObject 栅格化后按点取样**）、背景设置面板（预设色 / 自定义色 / 背景图 / 恢复默认） | core, storage | |
| 21 | `img-frame.js` | 221 | 图片边框：选中一张图 → 工具条上的「边框」→ 底部弹窗 `#frsheet`（复用 `.tsheet` 的深色玻璃底与 `eflow` 编辑态） —— 六档框（无 / 拍立得 / 纯色 / 细线 / 相框 / 凹陷）+ 八档预设色 + 自定义取色 + **一根 1~100 的粗细拖动条**（拖动时实时画到纸上）。**挑一档立刻画到纸上并当场存档**（跟「本页底色」那套「预览 + 完成」不一样：边框加在已选中的那张图上，一边挑一边看更直观，不想要了点回「无边框」）；再点一次同一档 = 取消。换框**不整页重绘**：`paintFrame` 只改那张图自己的两层节点，选中态 / 工具条 / 位置全保留 |
| 22 | `stickers.js` | 316 | 贴纸：阅读器「＋ → 贴纸」→ 底部弹窗 `#stsheet`，三档标签。**便利贴 = 带便签纸皮肤的文字贴**（`t.note` 存纸色），落成后照旧打字 / 挪位置 / 旋转，默认歪 −2.5°；**装饰胶带 = 普通图片对象、我的贴纸 = 用户导入的图片**（SVG dataURL，`src` 以 `data:image/svg` 开头 → 渲染自动按贴纸处理）。胶带 SVG 用 `clipPath` 裁撕边、`<pattern>` 铺花纹；手绘那档同一条路径描两遍（第二遍挪开一点并转 1.6°）做出手抖的笔触 |
| 23 | `editor.js` | 224 | 新建 / 编辑手帐本弹窗：**每一项设置都是一块 `.fold-sec` 折叠小节**（含新增的**装帧样式**三张卡）（名称 / 封面底色 / 封面图案（含图案色）/ 封面图片 / 彩带色（含透明档）/ 内页模板 / 页数），点标题收起或展开、收起时标题后跟当前取值 `ED_SEC_HINT`；**没有「整本内页底色」**（底色一律按页挑）；**图案颜色那一栏默认收起，选了封面图案才展开**（`#edPatColorWrap.fold`，用 `max-height` 收，展开不生硬）；**页数只在新建时给填**（编辑已有本子时整块 `.gone` 不显示，保存时也不读它，免得把本子截断）；图案区在上传封面图片时锁死收起 | core, visuals, state, widgets |；新增**装帧样式**折叠小节 `#edSecStyle`：四张卡片，卡里挂的是按各自装订方式渲染出来的真封面；文件尾部是**自定义封面独立页面**（阅读器同款 `cover.diym = {bg,images,texts}` 草稿 + `foreignObject` 合成 `cover.img`），入口是封面图案栏最后一格 |
| 24 | `home-events.js` | 841 | 主页交互：轮播点击、书架长按 / 单击、书架**拖动排序**（FLIP 位移 + 布局坐标命中判定；搬 DOM 节点时按 `dataset.per` 里**每行的本数**分配，各行的本数可能不同）、书架滚动时浮层按钮让开 `floatBarsAway`、菜单与分享菜单、多选选择条、删除二次确认、搜索面板（**书架模式下点搜索结果 = 直接翻开**：先 `shelfPick` 再把它滚进视口才 `openReader`，否则开书动画量到屏幕外坐标、封面从画面外飞进来）；**单层书架**：书脊悬停预览（委托在 `#spineWrap` 上的 `pointerover / pointerout`，只认 mouse / pen，整排重画也不会漏掉）、长按 380ms 拖动排序（单排只按横向区间命中，节点按新顺序 `appendChild` 回同一行 + FLIP 让位，边缘自动横滚；**排序中途绝不重建 DOM**，否则触摸手势连同 `touchmove / touchend` 被浏览器整条丢掉）、长按原地松手 = 开编辑 | core, state, home-view, editor, io-* | |
| 25 | `reader-flow.js` | 358 | 阅读器交互与**开合书动画**：封面飞入放大成书、合书、连翻回封面、缩回主页封面 | core, state, reader-view, page-flip | |
| 26 | `scrub.js` | 213 | 页数轴：长按页码唤出、拖动 / 点选快速跳页；键盘左右键翻页；点纸面收起对象选中（工具条 / 面板上的点击不算，刚关面板 450ms 内也不翻页） | core, state, reader-view | |
| 27 | `system.js` | 44 | 视口自适应（输入法弹起不重排，避免把正在输入的输入法收走）；`toast()` —— **所有提示一律输出到控制台** | core | |
| 28 | `main.js` | 111 | 启动：迁移旧数据 → 读数据 → 一次性数据清理与迁移 → 应用偏好 → 首次使用自动导入 `example/` → 首次渲染 | 全部 | |

### 关于 TDZ 的一个坑（改 `src/` 时务必注意）

脚本共用全局词法环境，但**每个文件里 `const / let` 是在该文件执行时才初始化的**。
因此：文件 A 的**顶层语句**里不能引用文件 B 里声明的 `const`（会抛 `Cannot access 'X' before initialization`）。
函数体里用则没事——函数都是事件回调或启动时才跑，那时候所有文件都已执行完。

（`src/storage.js` 的 `migrateLegacyStorage()` 就是把映射表写在函数内部的，原因就在文件注释里。）

### 对象工具条怎么自己找地方待（改 `fitObjBar` 前先看这里）

工具条 `.objbar` 长在被旋转的那个盒子里，默认挂在正上方 13px 处。它自己会 `rotate(calc(-1 * var(--rot)))`
把角度转回来，所以永远是正的 —— 但**位置是跟着对象转的**：对象转 90°，「上面」就成了右边，工具条也跟着挪到右边。

会被裁掉 / 挡住的两处：纸有 `overflow:hidden`（探出纸面就没了），顶栏 / 底栏 / 编辑面板 / 页数轴 / 输入法
会盖在纸上。`fitObjBar()` 每次定位都重新挑：**上 → 下 → 塞进对象内侧的上边 → 内侧的下边**，
四个候选按「出纸面积 + 被挡面积×权重 + 盖住对象自己的面积×.35」打分取最小的，都不行再夹回纸内、
往最近的出口推开遮挡物。下发的是 `bar-below` 类 + `--ob-gap`（离对象边的距离，负的 = 塞进内侧）+ `--ob-dx / --ob-dy`。

三个容易踩的点：

1. **量位置只能用行内百分比自己算，不能用 `getBoundingClientRect()`** —— 后者量的是转过之后的外接框，
   锚点会跟着歪（`objBox / boxAt / boxUp` 就是干这个的）。
2. **算出来的位移是屏幕坐标，下发前必须乘一次 `R(⁻¹)` 转回对象自己的坐标系**
   （`vx = cos·dx + sin·dy`、`vy = cos·dy − sin·dx`）—— 位移写在被转过的盒子里，盒子带着它一转，
   正好又变回屏幕位移。跟 `media.js` 里 `rotShift` 的 `t = (R − I)·ΔC` 是同一套推导。
3. **对象好好待在纸中间时第一个候选就是零损失**，一个字都不用写 —— 那条路径上的行为不许变。

拖动 / 拉伸的每一帧都会重算；手势期间纸和界面都不动，那几个矩形量一次就一直复用（`fitObjBar(w, ctx)`）。

### 文字贴：框紧贴内容 + 四角整块缩放（改 `text-sticker.js` / `page-edit.js` 前先看这里）

文字贴的框是 `x/y/w/h`（占页比例），字是 `size`（`calc(var(--pw) * size/100)`）。
早年只把**框高**对齐内容（旧函数 `fitTextHeight`，已随整理删除），宽度一直沿用 `newText` 的 `.56` 页宽 —— 短句右边空一大截；
四角拉伸又拿图片那套 `IMG_MIN_W / IMG_MIN_H`（都是 `.1`）去夹，一行字只有约 6% 页高，
`IMG_MIN_H / oh` 一除就是 1.7 以上，**手指刚动 4px 整块就被强行放大到 1.7 倍**（「一拖就变得很大」）。
现在两处都改掉了：

**① 框紧贴内容**（`fitTextBox`，宽高都实量）。几个量分开记，缺一不可：

| 字段 | 含义 |
| --- | --- |
| `t.ww` | 行宽上限（占纸宽）：文字到这儿才折行。拖四角改的是它；老数据首绘时由原 `t.w` 继承 |
| `t.w` | 实际框宽：短句收到文字本身宽度，长段落停在 `t.ww`。**只收不放过上限** |
| `t.autoW` | 是否自动贴宽；按住 Alt 自由拉伸过就置 `false`，保留用户手动拉出来的行宽 |
| `t.fitV` | 贴合算法版本；`bindPage` 首绘时按它对老数据收紧一次，之后重绘不再反复改数据 |

量法：复制一份 `.ptxt` 挂回同一个 `.ptext-wrap`（继承 `--pw` / 字体 / 行高），先
`width:max-content; max-width:行宽上限` 量文字本来要占多宽（长文在此折行），再固定到贴合宽度
量准行数高度。安全边是**字号的 0.14 倍 / 行高的 0.10 倍**（不是固定 px）——等比缩放时字、框、
边一起乘 `s`，换行位置才会一模一样。便利贴的 `padding` 因为全局 `box-sizing:border-box`
已经算进 clone 的 `offset*` 里。字体是懒加载的，`document.fonts` 的 `loadingdone` 后再
`refitVisibleTexts()` 补一次，否则换字体那一刻按回退字体量出来的框会裁掉新字形。

**② 四角整块缩放**。手指沿对角线拖出的倍数 `s` 同时乘到 `w`、`h`、`size`、`ww` 上，
比例恒定 → 每个字符相对框的宽度不变 → **换行位置一点不变**；行高同比变大、框高同比变大 →
不会被 `.ptxt` 的 `overflow:hidden` 裁掉。`s` 把手指位移投影到「对角 → 被拖角」这条向量上：
`s = 1 + (Δ·v) / |v|²`。**下界只看字号 `TS_SIZE_MIN / size0`**（框跟着字号一起缩，一个字 / 一行
不会缩没；拿框的最小尺寸去除就是上面那个 1.7 倍 bug），上界看纸边 `IMG_M` 与 `TS_SIZE_MAX`。
**夹的是同一个 `s`**，分别夹三个量会让字和框脱钩。上界还要 `Math.max(1, …)`：
框本来就已贴到纸边时 `room/ow < 1`，直接拿来夹会让「刚按下还没拖」也先缩一圈。
自由拉伸分支的最小尺寸改成 `一个字宽 / 一行行高`（按 `fontSize` / `lineHeight` 现算），
图片仍用 `IMG_MIN_*`，互不影响。

对角固定的位置补偿沿用 `rotShift()`。拉伸期间不整页重绘，只写 `.ptxt` 的 `font-size` +
`applyBox()`；手势首尾各调一次 `fitTextBox`（先定基准、后收掉百分比取整误差）。导出按
`t.size / 100 * W` 算字号、按 `t.w / t.h` 画框（见 `io-doc.js`），纸面什么样导出就什么样，链路不用动。

想只改框、不动字号：桌面临时按住 **Alt** 拖，或点灭工具条上的「字随框缩放」（状态存在 `fsLink` 里，
跟着本子存盘）。这一路收尾会把拉出来的宽度记成手动行宽（`ww` + `autoW=false`），之后打字不再收窄；
想回到自动贴合，再用默认模式拖一次四角即可。模式在手势落下那一刻锁死，拖到一半按 Alt 不跳尺寸。

### 行内样式里写 url() 的两条规矩（改 `frameBoxStyle` / `FRAME_PHOTO_URL` 前先看这里）

边框样式全是**行内 style** 下发的（PDF / SVG / DIY 合成也用同一串），`url()` 写错一点整条声明就作废：

1. **只能用单引号**：`url('data:…')`。这串值还要塞进 `style="…"` 属性，双引号会把属性提前截断
   （症状：背景图整个失效，只剩一个底色）。
2. **未加引号的 `url()` 里不能有括号 / 空白 / 引号**：CSS 直接判为非法。相框用的是 base64 JPEG，
   天然没有这些字符；若以后换回 SVG data URL，先整段 `encodeURIComponent`（`'` 不会自动转，
   要再补 `%27`），里面的 `(` `)` 要写成 `%28 / %29`。

`FRAME_PHOTO_URL` 定义在 `assets/frame-gold.js`（由 `assets/frame-gold.jpg` 转出）。
**别改成相对路径或 fetch**：导出的 SVG `foreignObject` 是独立文档，外部资源一律加载不到，框会整个消失。

### 浅色背景下的白玻璃（改 `.bg-light` 那套前先看这里）

默认界面背景是浅色的（见 `base.css` 的 body），所以**所有浮层 / 面板 / 列表在浅底上一律走「白玻璃」**：
半透明白 + 模糊 + 一道白边，面板里的字换深色。深色 tint（`rgba(30,34,54,.6)` 那种）压在浅底上
就是一块灰黑板，底下那点背景全被糊住 —— 看着是「面板变黑了」，不是玻璃。

三条容易踩的：

1. **优先改变量，不要逐个改 background**：`--frost / --frost-bd / --frost-fx` 三个变量一变，
   下拉菜单、确认框、取色盘这些用 `var(--frost)` 的面板一次全跟着变；以后加新面板自动继承。
   写死底色的那几个（`.search-panel / .modal / .tsheet`）才需要单独写。
2. **遮罩必须一起改浅**：`.modal-mask / .confirm-mask` 原来是 `rgba(20,22,38,.55)` 深遮罩，
   它把后面全压暗了，白玻璃叠在上头**没有东西可「透」**，看着依旧是一块白板。
   浅底上改成一层很淡的白雾 + 模糊。
3. **文字必须逐个换深色**：面板里的字大多写死了 `#fff`，在白玻璃上会直接消失。
   靠 `opacity` 压淡的那些（`.fr-hint / .fr-wval` 之类）在浅底上也要把 opacity 提回来，
   深色底上刚好的那一档，到了浅底上就淡到看不见。

取色盘（`.cp-panel`）是唯一例外：它自身没有底色、全靠 `.cp-mask` 那层深遮罩衬着，
所以那套保持深色遮罩 + 白字，不跟着变。

### 装帧样式：一本手帐本长什么样（改 `BOOK_STYLES` 前先看这里）

`j.style` 决定封面与内页的**开本与装订**，共三档（缺字段 / 非法值一律按 `classic` 笔记本）。
已下线的 `ring`（11 环线圈）由 `normBookStyle` 折算成 `personal`，老本子外观最接近、不会退成笔记本：

| 档位 | 名称 | 封面（宽×高） | 内页（宽×高） | 装订表现 |
|---|---|---|---|---|
| `classic` | 笔记本 | A5 148×210 | A5 148×210 | 左侧彩带（**只有这一档有彩带**）；有彩带时不叠压槽；彩带设「透明」时**封面左侧整列不画**（彩带隐藏，也不补压槽，2026-11-13 定稿） |
| `personal` | 活页手帐 | B6 125×176 | 95×170（比封面短 6mm） | 封面**干干净净**（不画环、也不留装订压痕）；环画在翻开的内页中缝，且两页之间留一道缝 |
| `square` | 方形画册 | 1 : 1 | 1 : 1 | 方开本硬壳 + 左侧压槽（没有彩带） |

⚠️ 三档高度仍要摆得齐：封面宽度基准都是 `--cover-w`，高度由 `aspect-ratio` 撑
（方形画册反过来把**宽**写成 `--cover-w × 210/148`）。B6 比 A5 矮 0.8%（约 2px），肉眼齐平。

**彩带只给笔记本**：`BOOK_STYLES` 每档带一个 `ribbon` 字段，只有 `classic` 是 `true`。
封面渲染（`coverHTML`）与导出都按它画；编辑器里那一整节「封面彩带颜色」在非笔记本档直接 `gone`
（见 `syncEditor`）—— 挑了也不会有反应，藏着比显示出来好。

**封面左侧：有彩带不叠压槽，透明档整列不画，本来没彩带的装帧才画压槽**（⚠️ 别搞反）：

- 有彩带（笔记本且 `ribbon` 不是 `none`）→ 左侧一条平色彩带，右侧落两层柔和接触影
  （`.spine:not(.ghost)` 的 `box-shadow`，00:05 用户要求「彩带加上阴影」），不生成任何凹槽断面；
  ⚠️ 只加外投影，上下折边暗边 / 槽沿 1px 浅白线仍是不要的；
- **笔记本「透明」档 `ribbon === 'none'`（2026-11-13 恢复）→ 整列不输出**：
  由 `visuals.js coverNoSpine()` 判定，彩带隐藏、**也不补压槽**（更早那版透明会退成
  `.spine.ghost` 压痕，用户明确不要那道槽）。屏幕封面 / 图案缩略图 /
  DIY 画布（`.no-spine`）/ 导出封面四处同源；色板首格就是这一档；
  启动迁移与导入兜底都不再把 `'none'` 改写掉；
- 没彩带的装帧（方形画册 / 精装书）→ **画压槽**（`.spine.ghost`），保留带暗槽底＋亮槽沿的
  立体断面（23:02 用户复评「之前的更逼真」）；
  仍然去掉三样：上下两端折边暗边、四周黑色投影、槽沿那条 1px 浅白线；
  23:15 方向改为「左亮右暗」，23:32 又把**亮槽沿加宽、暗槽底收窄**：
  屏幕 / 导出色标写成 `.30白 22%~38% 平台 + .34黑 50% / .26黑 56% / .08黑 62%`，
  缩略图写成 `.28白 20%~40% + .32黑 50% / .07黑 60%`，
  都按**视觉位置**从左到右写 `90deg`（不再做 270deg 镜像换算）；
- 活页 → 整列不输出。

**封面暗角（`.cover::after`）**：一组带模糊的 `inset` 明暗（上缘亮、下缘暗、右缘暗、靠书脊那道
`inset 14px 0 20px -16px rgba(0,0,0,.42)`）+ 一条 1px 内描边。2026-11-13 用户确认：
**方形画册 / 精装书不要这层渐变暗角**，`.cover.s-square::after` / `.cover.s-hardcover::after`
只留 1px 内描边；笔记本（彩带在 `z-index:1` 之上本来就不吃暗角）与活页保持原样。
⚠️ 左侧 `.spine.ghost` 那道立体书槽断面是装帧本身，别跟着一起删。

`home.css` 的 `.spine` / `color-picker.css` 的 `.pspine` / `io-doc.js` 导出封面三处同源。
**活页的环只画在内页中缝**：真活页本的环在里侧，封面是一张干净硬壳 —— 所以 `coverHTML` 与导出
（`io-doc.js`）都不画环、也不留装订压痕。翻开后一双页面是穿在同一组环上的，所以 `renderReader` 给 `#book` 加 `ringed`，
中缝那一列画出 `gutterRingsHTML()`（环数 = `BOOK_STYLES.rings`）。少了它，翻开的内页跟封面不像同一本。

**一颗环 = 左右两个镂空洞 + 一道浅弧形钢丝**。`.hole` 是纸上被打穿的洞，压在金属下面；
`i` 里的 SVG 路径从左孔心连到右孔心，中段轻轻拱起并横过那道缝。路径端点与两个 `.hole`
共用 `top:90%` 锚点，因此缩放后两端仍精确落在孔心。**孔心不再画圆形金属端头**，
避免出现两颗白点、看着像铆钉而不是穿页环。
⚠️ **金属必须在洞上面**：反过来（洞压着金属）金属会被洞的暗部吃掉一截，看着像环躲到纸后面去了。
⚠️ 孔沿**不许有金属边**：孔就是一个洞，另一头在纸的背面，不是一圈环箍在孔外。
⚠️ 孔的边缘要**收得住**：整块压暗、由 `border-radius` 切出清楚的边，柔和污渍式渐变不像纸被打穿。
⚠️ 钢丝用 `vector-effect="non-scaling-stroke"` 配合页高计算粗细，横向拉开时不会跟着变形。
金属环由四层同路径描边组成：接触投影、深色轮廓、银灰圆柱渐变和顶缘细高光；中缝脊背另有拉丝纹理与中央装配接缝。

**活页的两页之间有一道缝**：环是从缝里穿过去的，纸不是贴着折的。`layoutBook()` 按页宽算出缝宽
（`clamp(pw*0.05, 10, 26)`）写进 `--ggap`，右页 / 翻页叶片的 `left` 与 `page-flip` 的「半页横移」都读它；
`.gutter::after` 铺出缝底（活页夹的脊背），否则缝里透出来的是背景色，看着像纸中间破了个洞。
封面单独成页 / 单页模式下 `--ggap` 恒为 0，行为跟以前完全一致。

两个硬约束：

1. **有环的两档必须放开 `.cover` 的 `overflow`** —— 环要探出封面左边一点才像真的绕在装订边上。
   放开的代价是里面每一层得自己按封面圆角裁，所以 `.pattern / .gloss`
   一律带 `border-radius:inherit`，否则角上会露出直角。
2. **方形画册的内页也跟着变方**：`layoutBook` 的纸张比例走 `pageRatioOf(cur())`，
   导出（`io-doc.js`）与「铺满整页」的几何（`applyFillGeom(im, j)`）都按同一本取。
   只改封面不改内页 → 铺满整页的封面图和纸对不上；只改内页不改封面 → 主页缩略图跟阅读器不是一个比例。

### 图片边框（改 `frameBoxStyle` / `frameImgStyle` 前先看这里）

边框**画在 `<img>` 外面套的那层 `.pframe` 上**，不动画源：

```html
<div class="pimg-wrap"><div class="pframe" style="padding:3.4% 3.4% 10.54%;background:#fff;box-shadow:…"><img class="pimg"></div></div>
```

- **拍立得**：白边「上窄下厚」—— 底下那条宽的能写字，是拍立得的招牌。**相纸是光滑的，不要铺噪点**
  （铺了像蒙了层脏东西）。
- **纯色**：一圈纸框，颜色可自定义（预设八档 + 取色盘）。
- **细线**：沿图片边缘描一圈。**⚠️ 必须用 `border`，不能用 `inset` 阴影** —— inset 阴影画在
  「背景之上、内容之下」，而 `.pframe` 里整块内容就是那张 `<img>`，线会被图片整个盖住
  （症状：选了细线一条都看不见）。`.pframe` 是 `border-box`、图片 `100%×100%`，缩的是等比内容区，不变形。
- **相框**：直接用一整张金色雕花相框图片（`assets/frame-gold.jpg`）做 `border-image` 9-slice 边框，
  雕花 / 木纹 / 斜面都是素材自带的，不再叠任何渐变或颗粒。⚠️ 三条硬约束：
  ① `border-width:0` + `border-style:solid`，厚度全交给 `border-image-width` 的百分比 —— 给 border
  留占位会把内容盒挤进去一圈，照片和框之间露白边；
  ② `border-image-slice` 落在内窗边界（量原图 1078×1447 得左右 8.8%、上下 6.7%），中间那块白窗
  CSS 默认不绘制，照片由 `frameImgStyle()` 绝对定位到窗里（`left` 按盒宽、`top` 按盒高，正好和
  `border-image-width` 同一套基准）；`width/height` 必须写百分比，`auto` 会退回素材原始像素把框撑爆；
  ③ slice 宽度、框条宽度、照片 inset 全走 `framePhotoGeom()` 一个函数，拖粗细时三者一起缩放。
  这一档不吃边框色（颜色行会淡下去），但粗细拖动条照常可用。小样也铺同一张素材（`buildFrSheet`）。
- **凹陷**（2026-11-13 按参考图重做）：整块**纯白卡**被压进纸里，只有左上一条柔和灰带，
  下 / 右是干净的硬边。三件事必须一起做，缺一就不像：
  ① `.pframe` 的坑壁用 `background:#fff`，padding 区与白照片连成一整块，不再透纸色露一圈异色边；
  ② 盒上只画**左上外侧**的一条柔和外投影 `-3px -3px 6px -2px rgba(0,0,0,.26)`。
     ⚠️ 绝不加下 / 右白高光，也别给框壁加 `inset` 阴影 —— 那会变成一圈凸起的灰框；
  ③ 白卡左上内侧的两条柔影由 `frameInsetHTML()` 插的独立 `<i class="pinset-shade">` 负责：
     两条 `linear-gradient`（`to bottom` / `to right`）、`background-size:100% 11px,11px 100%`，
     alpha 按参考图逐像素标定 `.10 → .082 → .055 → .031 → .012 → 0`（最暗 230/255）。
     ⚠️ 别换回 `inset box-shadow`：一模糊就会把灰渗到下 / 右（实测右边缘被压到 234），右下不再干净。
  粗细拖动条同时控制坑壁厚度、外投影与柔影长度 / 深浅；`decor.css` 的六档小样必须与之同源。

⚠️ **边框尺寸一律用百分比（相对盒子宽 / 高）**：封面、书架、缩略图、导出四处的像素尺寸都不一样，
   写死 px 会「小图上边框占满、大图上细得看不见」。只有阴影 / 细线那几个 px 需要按导出缩放（`sc` 参数）。
   相框是 `border-image`，在 SVG `foreignObject` 里栅格化也和屏幕四边一致（已实测像素对齐）。

**粗细是一根 1~100 的拖动条**（`im.frw`，默认 50），拖动时实时画到纸上 —— 边框粗细这种东西，
手指拖着看变化比在「细 / 中 / 粗」里挑一档准得多。老数据里的 `1/2/3` 三档由 `frameWidth()` 折算成
`20/50/80`（`<=5` 一定是旧值），看起来跟原来差不多。

### 贴纸（改 `STICKERS` / `TAPES` 前先看这里）

三档素材，落点是**当前页正中偏上**，同一页贴多张会依次错开，不会一张压一张看不见：

1. **便利贴** = **带便签纸皮肤的文字贴**（`t.note` 存纸色）—— 落成后照样能打字 / 挪位置 / 旋转，
   默认歪 −2.5°（便签随手贴上去总是歪的）。落下去直接开编辑面板，接着就能写字。
2. **装饰胶带** = 普通图片对象，SVG 用 `clipPath` 裁出撕边、`<pattern>` 铺花纹，
   带一点默认角度，压在照片角上做固定正好。
3. **我的贴纸** = 用户自己导入的图片，存在**贴纸库** `state.prefs.stickers`（IndexedDB，
   跟展示偏好同一份记录，不进手帐数据、不进导出）。面板底部那颗「导入图片为贴纸」压到长边 400 / PNG 存
   （保留透明通道），点一下就贴到当前页；每张右下角有个 × 可以从库里删掉。上限 60 张。
   旧的「手绘图案」那一档已下线 —— 打开时落在「我的贴纸」。

胶带的 `src` 以 `data:image/svg` 开头，渲染时自动按贴纸处理（不吃白底、不画边框）。

### 手帐本加密（改 `src/lock.js` 前先看这里）

两档密钥：**保密问题**（答案去首尾空格 → `MD5(UTF-8)` 的 32 位 hex 作密钥材料）
和**直接输密码**（密码原文一个字符都不改）。两者都不是最终 AES 密钥，还要过
`PBKDF2-SHA256 / 120000 次 / 随机 16B salt` 派生出 `AES-GCM 256`；密文每次用新的 12B iv。
WebCrypto 不提供 MD5，所以 `md5Hex()` 是手写的标准 RFC 1321（中文按 UTF-8 字节算，
与 `crypto.createHash('md5').update(s,'utf8')` 一致，已用 7 组样例校验）。

**几条不能破的不变量**：

1. **磁盘与导出文件只有密文**。`save()` 落盘前走 `persistJournals()`，`.json` 导出走 `exportJournalBody()`
   （`io-export.js` 单本、`io-share.js` 批量两处同源）。**万一出现「有 lock 配置却没本机钥匙」这一不可达状态，
   `persistJournals` 宁可抛错让整次保存失败、磁盘保留上一份密文，也绝不把明文写出去**；
   同样地，设置 / 换密钥都先 `rememberKey` 再挂 `lock`，解锁中记住钥匙失败会还原成信封，不留半截中间态。`lkEnvelope()` 按 `id + salt + 内容摘要` 缓存信封，
   内容没变不重复 AES 几 MB 的 base64；⚠️ 判失效要用 `lockContentFP()` 而不是 `journalFP()` ——
   后者对加密本恒返回 `lock.fp`，内容改了也不变。
2. **密钥绝不进导出文件**。本机钥匙单独存 `carnet_lock_keys_v1`，与 `carnet_v2` 分开；
   缓存里只放**派生后的 raw AES 密钥**（`rk:` + base64），不放密码原文 / 答案 MD5，
   顺带让自动解锁跳过 12 万次 PBKDF2。`lkKeyFor()` 两种形态都认，
   老版本缓存里留着密钥材料的也能照常用，不用写迁移。
3. **记住的是设备、不是会话**。本机自己加密的，设完密钥即记住；从外部导入的加密文件第一次打开**必须输密钥**。
   解锁一次后这台设备静默解密（`guardUnlocked` 里 `tryUnlock` 成功直接 `done()`，不弹框）；
   「立即上锁」先 `sealJournal` 封好再 `forgetKey`，下次打开重新变回要输密钥。
   ⚠️ **解锁后的落地动作按入口分流，与是否需要输密码无关**（第二十五轮定稿）：
   `guardUnlocked(j, done)` 只有两个参数，三条分支（静默解锁 / 无本机钥匙直接弹框 /
   自动解锁失败后回落弹框）都跑同一个 `done`。点封面 → `openReader()` 的 `done` 打开手帐本；
   点编辑按钮（封面齿轮 / 单层书架长按）→ `openEditor()` 的 `done` 打开「编辑手帐本」弹窗，
   **未解锁的书输完密码就进编辑窗**；导出 PDF / SVG、管理密钥面板解锁后继续原动作。
   ⚠️ 别再按「有没有弹过解锁框」改落地动作（第二十四轮那版 `promptDone` 已移除）：
   用户点哪个按钮才是意图，输密码只是过程。
4. **守卫覆盖所有入口**：`openReader` / `openEditor` / 搜索结果点开 / 单本与批量 `.json` 导出 /
   PDF / SVG 导出。`PDF / SVG` 本身就是明文，未解锁时挡住并提示先解锁（解锁后允许导，
   面板里写明这会生成一份未加密副本）；批量导出用 `autoUnlockQuiet()` 静默解锁，**绝不弹窗打断循环**。
5. **换密钥 / 取消加密要先验旧密钥**（能进管理面板 ≠ 有权限改锁）；换密钥 = 换 salt + 新密钥
   把整本内容重新加密一遍。取消加密则把内容留成明文、锁配置与本机钥匙一起清掉。
6. **`lock.js` 顶层不许引用后置模块的 `const`**（`state` / `EXPORT_TAG` … 会 TDZ），
   跨模块调用一律写在函数体里；它是**脚本 4**，排在 `storage.js` 之后、`io-export.js` 之前。
7. ⚠️ **解锁会替换 `state.journals` 里的对象**，守卫的 `done` 回调里别用旧的 `j` 引用，一律重新 `cur()`；
   `tryUnlock` 也按 `id` 定位（`lkReplace`），别依赖引用相等。
8. `crypto.subtle` 需要安全上下文；`lkCryptoOK()` 为假时禁用设置与解锁并提示用 `http/https` 打开。
9. **锁徽章 ≠ 有加密配置**。书架 / 书脊那枚 🔒 只表示「打开这本还要输密钥」，
   判定统一走 `lockNeedsKey(j) = journalHasLock(j) && !lockRemembered(j)`：
   刚设完密钥 / 解锁过 / 刷新后读回本机钥匙都**不显示**（静默解锁，不再有锁的观感）；
   只有外部导入的密文、或点过「立即上锁」忘掉钥匙才会出现。`tryUnlock / lockRelock / renderHome` 都会刷新。
10. **弹窗不许「先居中再上移」**。`.kb` 只由 `#lockBody` 上的一次性 `focusin` 委托在
    **触屏真的聚焦输入框**时加，延后 180ms（等 `pointerup/click` 派发完，否则 mouseup 落到遮罩上会被
    「点外面关闭」误判）；加上后保持到 `closeLockPanel()`，blur 不摘，免得打字中途反复跳。
    桌面（`pointer: coarse` 为假）只自动聚焦、不加 `.kb`，面板始终居中 ——
    ⚠️ 别在 `lockPanelShell()` 里给 input 逐个绑 `focus → .kb`，那就是打开即跳的元凶。

没有找回通道：密钥不上传、不写进导出文件、也没有密保邮箱。忘了就是忘了，面板里已明确告知。

---

## 四、样式模块（`style/`）

同样按加载顺序排列；**顺序即层叠顺序**，同权重规则以后面的为准，所以不要随意调换。

| # | 文件 | 行数 | 职责 |
|---|---|---|---|
| 1 | `base.css` | 109 | CSS 变量（色板、毛玻璃、圆角、阴影、**默认界面背景 `--app-bg`**、**文字贴字族 `--font-hand` / `--font-kai`**、**滚动条 `--sb-*`**）与全屏骨架；`#app` 高度由 JS 锁定。**`--app-bg` 是主页 / 阅读器 / body 三处共用的那一份默认背景**（阅读器不再自己写深色渐变，否则默认档下主页是暖白、阅读器是深蓝，两个画面）。顶部 `@font-face` 加载项目自带的 `assets/font/carnet-hand.woff2`（2.55MB，GB2312 全覆盖子集；另备一份 `.woff` 兜底）与 `assets/font/en/` 下四款英文字体（各自不到 62KB，懒加载）。**文件名必须是纯 ASCII**：非 ASCII 名在部分静态托管上会被回落成 index.html，字体请求看着 200、内容是 HTML，字族静默失效（症状：字母仍是手写体——退到了系统自带字体，中文变成楷体 / 雅黑）。排查直接看控制台自检，或手动跑 `window.carnetFontOK()`。字族名 `CarnetHand`，排在 `--font-hand` 回退链最前；旧的 `851tegakizatsu.ttf`（28MB）已弃用、不再被引用。**滚动条全项目只此一份**：用 `*` 兜住所有滚动容器，改浓淡只动 `--sb-size / --sb-track / --sb-thumb(-hi/-act)` 四个变量；别再往各样式文件里单独写 `::-webkit-scrollbar`（那边选择器更具体会盖掉这里），书架 `.shelf-wrap` 是唯一例外——它故意藏起来 | |
| 2 | `controls.css` | 22 | 通用控件：输入框、按钮、标签 | |
| 3 | `home.css` | 124 | 主页容器（**没有顶栏底栏**：两条栏都是 `position:absolute` 浮层，不占布局高度，栏本身 `pointer-events:none` 只有按钮收点击；滑动时 `#home.bars-away` 整块淡出让开）、封面（左侧彩带 / 压槽、图案层、高光、页数徽章；**有彩带不叠压槽**，笔记本透明档整列不输出，本来没彩带的装帧才用 `.spine.ghost` 画原来那套立体断面压槽（上下折边暗边 / 四周黑影 / 槽沿浅白线不画，断面本身保留），活页整列不输出；**尺寸 `clamp(158px,min(44vw,40vh),246px)`：窄屏按宽度走占满屏、矮屏按高度让一让**）、底栏毛玻璃圆钮；浮层高度记在 `--topbar-h / --botbar-h` 供正文避让 | |
| 4 | `book-style.css` | 110 | 装帧样式与封面拟物：光泽与明暗 `.gloss`、暗角与内描边 `::after`；**封面圆角是不对称的小圆角**（`3px 9px 9px 3px`，画册 `4px 8px 8px 4px`：书脊侧近乎直角、翻口侧一小点圆弧；开太大就成圆角卡片而不是一本书）；硬壳左侧的彩带 `.spine`（笔记本透明档整列不画，见 `home.css`）；活页封面**不画环**（`rings` 只决定内页中缝的环数，环在 reader.css 的 `.grings`）；弹力绑带 `.band`；方形画册 1:1 开本 `.s-square`；编辑器里的样式选择卡 `.sty-*`；**左右滑动模式的落地影 `.carousel .book-item .cover`**（五层由实到虚：接触影 → 近 / 中 / 远 → 环境影，x 偏移逐层加大模拟左上光源的半影外扩，色偏冷灰蓝而非纯黑；`.active` 那本再压深一档做远近关系）。改阴影注意：这条选择器比 `.cover` 那条更具体，两边都要看 |
| 5 | `reader.css` | 162 | 书籍骨架、左右页、翻页叶片、中缝折痕与纸光、**活页：两页之间的缝 `--ggap` + 机构金属条 `.gutter::after`（上下两端各一颗铆钉；`z-index:28` 压在环之上，环脚被条盖住才像从机构里长出来的）+ 中缝金属环 `.grings`（一根环 = 左右两个 D 形半环）+ 每页纸面上的打孔 `.page-hole`**（孔画在纸里而不是中缝：翻页叶片会盖住中缝，孔挂在那儿的话翻到一半那页就没孔了。孔位 / 孔径 / 打孔列宽由 `.book` 上的 `--hole-x / --hole-d / --hole-col` 统一给，环径 `--ring-d`；半环宽就是 `--hole-x`（拱出多远由孔的位置决定）、高是 `--ring-d / .6`（SVG 里那个 D 只占 60% 的高度），`.l` / `.r` 各贴金属条的一侧，弧顶才压在孔心；**打孔那一列 `.bind-left / .bind-right` 给 `.tplbg` 加遮罩，网格 / 点阵 / 横线都不铺进这一列**（遮的是 `--hole-col - --pmx`，两处留白各算各的）；**活页那圈封面露边 `--bleed`（左右）/ `--bu-t` `--bu-b`（上下，下沿比上沿宽一档）**；**单页态没有缝，机构条改占 `--bleed` 那条边（宽度统一走 `--mech-w`），那一页也有环**—— `.book` 这个盒子本身就是封面外框，页槽 / 叶片 / 中缝整体往里缩，非活页两者恒为 0 所以行为不变）、纸张底色与内页模板（网格 / 点阵 / 横线 / 牛皮纸）；编辑态下舞台按 `--stage-shift` 上移避让面板；**`#reader` 背景走 `var(--app-bg)` 跟主页同一份**（自定义背景由 `applyBg` 写内联样式覆盖） | |
| 6 | `image-tools.css` | 103 | 四角拉伸手柄（热区只向外扩，避免抢按钮；`locked` 时隐藏、`.tiny` 时缩小）、**旋转手柄 `.hdl.rot`（挂在右边外侧正中，上方是工具条的位置、四角是拉伸手柄，只有这里空着；里面放一个转圈箭头图标 + 一根细线连回对象。图标用绝对定位居中，不能给 `.hdl.rot` 设 `display:flex` —— 会压过「选中才显示」那条规则，手柄就一直露在外面了）**、**内页四周的空白页边 `--pmx / --pmy`**（模板层 `.tplbg` 内缩这一圈，露出来的就是干净纸边；导出那份是内联样式拼的、认不到 CSS 变量，所以 `io-doc.js` 里按同一套比例自己内缩了一次）、纸张底色与内页模板纹理、选中 / 固定 / 铺满三态的描边（**按钮本身已收进 `.objbar`，见 `text.css`**）；`lockPulse` 关键帧里必须带 `rotate(var(--rot))`，否则固定那一瞬间会先把角度抹掉 | |
| 7 | `text.css` | 264 | ① 文字贴本体与选中态（**长按版式态 `.boxmode` 才显示四角 / 旋转手柄；双击的内容态 `.editing` 把手柄全收起、只留工具条**，两种手势各管一件事）；② `.objbar` 对象工具条（毛玻璃胶囊，长在对象内部、`--ob-x` 横向纠偏、`bar-below` 翻到下方、**图片六颗钮 / 文字贴五颗，`.pimg-wrap.tiny` 时缩一号免得占满小图**、**末尾再 `rotate(calc(-1 * var(--rot)))` 把角度转回来，对象怎么转工具条都是正的**）；③ `.tsheet` 编辑面板（窄屏贴底全宽 / `≥620px` 变右下角浮块）与左上角完成 / 撤销 / 重做 `.eflow-top`（**撤销 / 重做只在文字面板开时才露出来，底色弹窗借用编辑态但没有撤销栈**）；④ 右上角「添加」菜单、双页选页那一行（**「本页底色」那排内联小色块 `.am-bg` 已随弹窗撤掉**）；⑤ 深色纸时页码转浅 `.paper.dark .pnum` | |
| 8 | `page-bg.css` | 40 | 「本页底色」弹窗 `#bgsheet`：复用 `.tsheet` 的深色玻璃底与升起动画（`max-height:78%`），里面是顶部当前色预览 + **九种颜色横排**（`.bs-col` 一列一种颜色、列内六档竖排由浅到深，组名 `.bs-cn` 挂列底）+ **完成 / 自定义** 两个按钮（`.bs-btn.done` 是主按钮，挑了新色才 `on` 点亮） | |
| 9 | `scrub.css` | 84 | 页数轴（玻璃滑块 + 粉色焦点线）与浮在轴上方的页码；封面页铺满时各图案贴片按 `--pw` 折算尺寸 | |
| 10 | `modal.css` | 107 | 通用弹窗：毛玻璃滚动条、吸底操作栏、色块网格、模板网格、上传区；编辑器折叠小节 `.fold-sec / .fold-head / .fold-body / .fold-caret / .fold-hint`（收起时正文整块隐藏、标题后跟取值）；「跟随 / 自动」档色块 `.paper-auto .pat-auto`、小节里的补充说明 `.ed-note`；「一键成书」的进度胶囊 `.mkbusy`（居中玻璃胶囊 + 转圈，压在确认框之上） | |
| 11 | `color-picker.css` | 149 | 自定义取色盘：饱和度 / 明度面板、色相条、吸管入口；**吸管现场取色**：整层不吃指针事件的放大镜 + 底部细操作条、浮层让位用的 `.ep-duck`、取色期间临时放开装饰层命中测试的 `.ep-picking`；手输色值时键盘弹起把面板顶上去 | |
| 12 | `search.css` | 49 | 搜索条与结果列表（含 `scrollbar-gutter` 防抖动）以及结果里的封面缩略图 | |
| 13 | `confirm.css` | 29 | 破坏性操作前的二次确认框 | |
| 14 | `book-anim.css` | 75 | 开合书动画：封面飞入放大成书、`.cover-ghost` **窗口 + `.cover-ghost-fit` 内容层**（窗口用 width/height 展开、内容只做等比 scale，所以封面全程不变形）、合书退场、封面单独成页态。⚠️ `ghostOut` 关键帧里**不能再动画 `border-radius`**：CSS 动画层级高于内联样式，会把 JS 给细长书脊设的 1.5px 小圆角顶掉 | |
| 15 | `view-toggle.css` | 43 | 展示模式切换按钮（三格：多层书架 = 一摞书 `books` / 单层书架 = 一排书脊 `rows` / 左右滑动 = 一本合着的书 `book-2`，图标写在 `index.html` 里，Tabler 描边风格）：浅色毛玻璃胶囊 + **白色圆钮滑块**（容器 `data-vt` 驱动 `translateX`，每格 32px、加一格就多一档位移），选中那格的图标吃深色 `#20222c` | |
| 16 | `shelf.css` | 137 | 书架模式：成排的书 + 亚克力搁板（含金属螺丝）、拖动排序时的淡坑与悬浮副本；书架吃满整屏高度，上下内边距用 `--topbar-h / --botbar-h` 让每排都能滑出浮层按钮的遮挡区 | |
| 17 | `menus.css` | 109 | 向上弹出的分享 / 导出菜单、书架多选时的底部选择条、封面上的勾选圈、纸面右键菜单 `.addmenu.pmenu`（fixed 跟随鼠标，挂在 `#reader` 直属子节点上，避开 `.book` 那层 filter）。**选择条按钮配色**：导出 = 黑色半透明玻璃（浅底 `rgba(17,19,24,.08)` + 深字 / 深底 `rgba(255,255,255,.1)` + 白字）、删除 = 淡红透明 + 红字，两者都 `box-shadow:none`；`purpose-del` 下删除只是红更浓一档，别恢复深色实心 + `0 8px 18px -8px` 大黑影。⚠️ 末尾别再给 `.primary` 单独设白字 | |
| 18 | `decor.css` | 152 | 图片边框 `.pframe`（边框画在它的 padding 上）与**图片边框**面板 `#frsheet`（`.fr-*` 六档小样 / 颜色 / 粗细）；**贴纸**面板 `#stsheet`（`.st-grid` 便利贴 / 胶带 / 手绘三档格子）；便利贴皮肤 `.ptext-wrap.note .ptxt`（纸色底 + 内高光 + 落地影 + 右下折角） |
| 19 | `background.css` | 235 | 背景设置面板，以及**浅色背景时整套界面换「白玻璃」**那一套（`bg-light`）：面板底色走 `--frost / --frost-bd / --frost-fx` 三个变量（下拉菜单 / 确认框 / 取色盘一次全变），遮罩、弹窗、搜索栏、底部面板那些写死底色的逐个换；面板内文字一律换深色。⚠️ **选择器挂 `#home` 还是 `#reader` 要看元素真长在哪**：`.rbot`（底栏）和 `.scrub`（页数轴）是阅读器里的，写 `#home.bg-light .rbot …` 永远命中不了 | |
| 20 | `spine-shelf.css` | 194 | 单层书架模式：底边对齐、只留一条细缝（`gap:clamp(1px,.16vw,3px)`）的一排书脊，窄屏横向滑动；**书脊宽度按页数走**：`width = --spine-min-w + (--spine-max-w - --spine-min-w) × --spine-p`，`--spine-p` 由 `spineWidthRatio()` 按 `log2(1+页数)/log2(65)` 算（越厚越宽、64 页封顶，再薄也有 `--spine-min-w` 保底）；高低错落由 `id` 散列（`spineSeed`，不掺下标）出 `--spine-h` 与 `deco-N`；排序中 `#spineWrap.sorting` 把整排压回**基础档**（`transform:none` + 基础 `filter` / 投影、`.active::after` 白边收掉），否则手指经过 / 选中的那本会抬起、变亮；下方预览框 `#spineDetail`（默认跟着 `state.sel` 走并**横移对到那根书脊底下**：封面 `position:absolute` + `transform:translateX(calc(var(--px) - 50%))`，`--px` 由 `spineDetailShift()` 量；悬停别的书脊时临时切过去，`.empty` 时不吃点击）；长按拖动排序的淡坑 `.spine-item.lifted` 与悬浮副本 `.spine-ghost`（**必须 `transition:none`**，否则克隆来的副本会带着书脊那套 hover 过渡从屏幕左上角飘到手指下）；点书脊翻开时的**抽出动画** `.spine-item.pulling / .gone`（起飞点量的是抬起**之后**的实时 rect，见 reader-flow.js 的 `coverRect`）；`#spineWrap.no-preview`（无悬停能力的设备）把预览框整块收掉；**矮屏 / 横屏各有一档放大**（`max-height:620px` 与 `orientation:landscape and max-height:560px`），横屏下书脊又短又细，要把高度和 `--spine-min-w / --spine-max-w` 一起提上来 | | **手机竖屏（`@media (max-width:520px) and (orientation:portrait)`）单独调比例与居中**：屏幕又窄又高时书脊按 vh 给长度会拉成 ~1:26 的细长条，这一档把宽度提到 `9.5vw / 14vw`、长度收到 `50vh`，比例落在 ~1:7（接近真实书脊）；整排书作为**一块**垂直居中（`.spine-scroll` 变 flex + `align-items:center`、row 收成 `height:auto`），row 内部仍 `align-items:flex-end` 让书站同一条底线；横向用 `justify-content:safe center` —— 书少时居中、书多要横滑时自动退回 `flex-start`，否则普通 `center` 溢出后左边几本滚不到
| 21 | `diy-cover.css` | 320 | 自定义封面（DIY）独立全屏页：`#diyPage` 两层壳（横屏 `display:contents`）、纸面 / 画布 / 对象工具条 / 文字框三态、铺满档的 `object-fit:fill`。⚠️ 编辑器专用的压槽 `.diy-paper::before` 别烘进 `diyExportHTML()` |
| 22 | `lock.css` | 139 | 手帐本加密弹窗：`#lockMask` 白玻璃面板（浅色背景 `.bg-light` 同款）、锁徽章 `.lock-flag`（封面**右下角** / 书脊右上角；⚠️ 封面右上已被编辑齿轮 `.gear` 占了，放那里会叠成两个错位的圆）、两档密钥 tab 与表单、状态卡 `已加密 / 未加密`；`.kb` 只在触屏聚焦输入框时把面板顶到上半屏（桌面永不生效，见第六节不变量 10）；深色玻璃下给黑色强调控件补浅描边。**最后一个引入**，别往前挪 |
---

## 五、数据是怎么存的

| 存储位置 | 键 | 内容 |
|---|---|---|
| IndexedDB `carnet_db` → store `kv` | `carnet_v2` | 全部手帐本（数组） |
| 同上 | `carnet_prefs` | 显示偏好：展示模式 `view`、共用背景 `bg` |
| 同上 | `carnet_example_v1` | 「已自动导入过 example」的标记 |
| 同上 | `carnet_drop_defaults_v1` | 「已清理过老预置手帐本」的标记 |
| 同上 | `carnet_lock_keys_v1` | **本机钥匙缓存**：解锁过一次的加密手帐，按 `id` 存派生后的 raw AES 密钥（`rk:` + base64）。**绝不与 `carnet_v2` 混在一起**，所以导出文件里永远不带密钥 |
| localStorage | 同名键 | IndexedDB 不可用时的降级备份 |

- 背景图片压缩后直接存 IndexedDB，不占 localStorage 配额，**也不会跟随导出文件走**。
- **加密手帐的磁盘形态**：`save()` 落盘前走 `persistJournals()`，把「已解锁的明文加密本」当场重新封成密文信封；
  所以本机数据库里自始至终只有密文，运行时的明文只活在内存里。删本子时 `dropLockKeys()` 顺手清掉孤儿钥匙。
- **项目改名做了数据迁移**：首次启动会把旧库 `paper_journal_db` 里的 `paper_journal_v2 / _prefs / _example_v1 / _drop_defaults_v1` 搬到上表的新键（见 `src/storage.js` 的 `migrateLegacyStorage()`），老用户的手帐本不会因为改名消失。

## 六、手帐本的数据结构

```js
{
  id: 'x1a2b3c…',              // 内部唯一 id
  name: '旅行手记',
  cover: { type: 'solid|gradient', value: '#f4a9b8', pattern: 'heart', patColor: '#e0668a',
           img: null, diym: null },  // diym = {bg,images,texts} 封面草稿（阅读器同款对象）；img = 合成后的成品封面图
  ribbon: '#c98a8a',           // 封面彩带（书脊）颜色；'none' = 透明，隐藏彩带且左侧不画书槽
  style: 'classic',            // 装帧样式：classic 精装 / ring 活页 / personal Personal 活页 / square 方形画册
  template: 'grid',            // 内页模板：blank / lined / grid / dots / kraftplain / kraft / custom
  tplImg: '',                  // template==='custom' 时的图片（base64 位图 dataURL），随手帐本一起导出
  tplFit: 'cover',             // 自定义图的铺法：cover 铺满 / stretch 拉伸 / tile 平铺
  pageBg: '#f7f1e3',           // 整本的内页底色（旧字段：没有设置入口了，但老数据 / 导入数据仍生效）
  created: 1730000000000,
  pages: [                     // 第 0 页起，每页是一张纸
    {
      bg: '#fae1e6',           // 这一页单独的底色，盖过整本的 pageBg；'' / 不写 = 沿用整本 / 模板的纸色
    images: [ { id, src, x, y, w, h, ratio, locked, cover, fill, z, rot,
                fr, frc, frw } ],  // fr 边框档 / frc 边框色 / frw 粗细 1~3；坐标与尺寸都是「占页比例」0~1
      texts:  [ { id, text, x, y, w, h, size, color, align, bold,
                  font, fontEn, italic, underline, strike, bg, z, rot,
                  note } ]        // note 存纸色 = 便利贴皮肤；后 9 项缺省即「不用」
    }
  ]
}
```

**加密字段 `lock` / `enc`（信封形态）**：设过密钥的本子，**磁盘与导出文件里不是上面这份明文**，
而是一个外壳 + 一段密文（运行时解开后才还原成上面的结构）：

```js
{
  id, name, created, style, ribbon, template, tplFit, pageBg,
  cover: { type, value, pattern, patColor, radius, groove, inside: { mode, color, pick } },
  pages: [{}, {}, …],                    // 只留页数空壳，供书脊厚度 / 页数角标 / 结构校验用
  lock: { v: 1, mode: 'question|password', q, salt, check: { iv, data }, fp },
  enc:  { iv, data }                    // AES-GCM(JSON.stringify(整本明文，去掉 lock/enc))
}
```

- `lock.mode='question'` 时 `q` 是自定义问题明文（要显示给用户看）；答案**不落盘**，只取 `MD5(答案.trim())`
  当密钥材料。`mode='password'` 时密钥材料就是密码本身。两者都要过 `PBKDF2-SHA256 (120000 次, salt)` 派生。
- `lock.check` 是用同一把密钥加密的一句固定文本，用来**不碰内容就能验密钥对不对**；`salt` 每次设密钥 / 换密钥都重取随机值。
- `lock.fp` 是加密时的内容摘要（`lockContentFP`），**导入查重 `journalFP` 对加密本直接返回它** —— 密文的 iv 每次都随机，
  拿信封算摘要会把同一本判成两本。
- `cover.img` / `cover.diym` / `cover.inside.img` / `tplImg` / `tplImgs` / `pages` 里的文字与图片**全部卷进 `enc`**，
  外壳一字节内容都不留；所以还没输过密钥的书在书架上是一张纯色 / 图案封面 + 一枚 🔒 徽章
  （本机已记住密钥后徽章消失，见第六节不变量 9）。
- ⚠️ `lkShell()` 里挑外观字段要**逐项写**，绝不能 `...cv` —— 会把照片封面一起带到外壳上。
- ⚠️ 导入时 `normalizeJournal` 会给信封换个新 id，但密文里存的还是导出那台的旧 id；
  `unsealJournal` 必须 `plain.id = env.id`，否则同一份文件导两次会得到两本 id 一样的手帐。

坐标用比例而不是像素，是为了导出 PDF / SVG 时能按比例放大到任意尺寸都不错位。

**装帧样式 `style`**：见第三节「装帧样式」。`ring` / `personal` 有活页环，`personal` / `square` 有弹力绑带。
非法值由 `normBookStyle()` 归一回 `classic`，导入老文件（没有这个字段）零变化。

**图片边框 `fr / frc / frw`**：`fr` 是档位（`none` / `polaroid` / `color` / `line` / `photo` / `soft`），
`frc` 是颜色（`#rrggbb`），`frw` 是粗细 1~3。缺省即「无边框」。边框画在 DOM 里 `<img>` 外面套的 `.pframe` 上，
**不占图片自己的位置**（细线那档用 `inset` 阴影，图片一点不缩）；导出时同样由 `frameBoxStyle` 现算。

**便利贴 `note`**：文字贴的 `note` 存纸色（`#rrggbb`），有值就套便签纸皮肤（见 `decor.css`）。
它本质上还是一条文字贴，所以打字 / 挪动 / 旋转 / 面板改字号全都照旧能用。
**装饰胶带 / 我的贴纸**不占新字段 —— 它们就是普通 `images` 条目（导入的贴纸是 PNG dataURL，胶带靠 `src` 以 `data:image/svg` 开头来区分）。

**上下层 `z`**：图片和文字共用一套 `z`，数字越大越靠上。新加的对象拿「本页最大 `z` + 1」，
所以**先加的在下、后加的盖在上面**（后贴的图会压住先前写的字，不再是「文字一律在最上层」）。
拖动与缩放**不会**把对象挪到最上层；老数据没有 `z`，由 `ensureZ()` 按「先图后字、各自保持原顺序」补上，样子不变。

**旋转 `rot`**：图片与文字都能转，单位是度，绕自己的中心。旋转写在对象的 `transform` 上，
工具条会按同样的角度**反着转回来**，所以不管转成什么样，工具条始终是正的。

**内页底色**：只在阅读器里**按页**挑（`＋ → 本页底色` 弹窗），**新建 / 编辑手帐本弹窗里没有这一项**。
弹窗里**没有「跟随整本」这一档** —— 换色一律是给这一页写一个具体颜色。
**点色块只是预览**：纸面立刻变色、面板不关，但数据不动（顶部会写「· 待完成」，底部「完成」键点亮）；
**按了「完成」（或左上角那颗 ✓）才真正写进这一页**。没按完成就把面板关掉（点纸面、点外面）＝ 取消，
纸面自己回到原来的颜色。预览走 `window.__bgPv`（`pageBgShown` 读它），所以导出、存档期间一直是原色。
取值仍是三级：`pageBgOf(pg, j)` = **单页 `pg.bg` > 整本 `j.pageBg` > 模板自己的纸色** ——
整本那一级没有设置入口了，但**老数据、导入数据里带着的 `j.pageBg` 照旧生效**（所以别删这段逻辑）。
（牛皮纸那两档模板的底色是渐变，自定义色会整块盖住它）。颜色一律走 `normPaperBg()` 归一化，
只认 `#rgb / #rrggbb`，其它值当「没设」。纸色偏深时（`hexLum < LUM_DARK`，见 `visuals.js`）给纸加 `.dark`，页码转浅色。

色阶 `PAPER_RAMPS` 九种颜色、每种六档：弹窗里**九种横着排成一列列**，每种颜色**竖着由浅到深**
（上浅下深，组名挂在列底）。前八种的前三档是能写字的纸，**明度压在牛皮纸那一档
（牛皮纸模板本身约 .84）** —— 再浅就跟没设一样、屏幕上也看不出换了色；末尾「灰 / 墨」两组的深色档给深色手帐用。
改色阶时注意：写字用的那些档 `hexLum` 要留在 `LUM_DARK`（.55）以上，低于它 `pageBgDarkShown` 会把页码转浅。
（编辑器的整本设置早已撤掉，从色阶派生的 `PAPER_COLORS` 已随 2026-10-02 的整理删除，色阶 `PAPER_RAMPS` 是唯一数据源。）

**自定义封面（DIY 独立页面）**：编辑器「封面图案」栏最后一格跳到与 `#home / #reader` 平级的
全屏页面 `#diyPage`（见 `editor.js` 尾部 / `style/diy-cover.css`），进入时编辑器弹窗让位、完成/返回后交还。
`cover.diym = { bg, images:[…], texts:[…] }` 是**可继续编辑的草稿**，结构与阅读器一页的
`pg.images / pg.texts` 完全相同：坐标 `x/y/w/h` 占纸比例、`z` 上下层、`rot` 角度、
文字 `size` 是占纸宽百分比；底色 `bg` 可以是 hex 纯色或 GRADS 渐变。
纸面直接调 `imgWrapHTML / textWrapHTML / objBarHTML / rotHandleHTML`，新建文字用 `newText()`、
上下层用 `nextZ()`、盒子下发用 `applyBox() / applyRot()`，图片边框复用 `FRAMES / frameBoxStyle`，
贴纸复用 `stickers.js` 的便利贴 / 胶带 / 我的贴纸库，文字面板复用 `TEXT_*` 色板与字体档 ——
**添加图片、文字、贴纸的逻辑与阅读器一致**（拖动、四角缩放、旋转手柄、工具条、双击改字都在）。
「完成」把纸面塞进 SVG `foreignObject` 栅格化成一张图写进 `cover.img` —— 主页 / 阅读器 /
PDF / 长图 / 源文件导出本来就有「有封面图就铺图」这一条路，所以这些渲染点一个字节都不用改。
⚠️ 合成用的 `diyExportHTML()` 必须全内联（foreignObject 读不到本页 CSS），`<img>` 要自闭合 `/>`。
草稿与成品图都随手帐数据走，导入时 `normalizeJournal` 只做结构校验，打开页面时 `normDiyCover`
再逐字段洗（含把上一版 `items` 老草稿换算成 images/texts）。
从 DIY 切回内置图案会撤掉 `cover.img` 但**保留草稿**，随时能回页面接着改。

**自定义内页模板**：编辑器「内页模板」多一格「自定义」，选一张图存进 `j.tplImg`（`packTemplateImage()`
缩到长边 1200 的 PNG，保留透明通道），`j.template = 'custom'`，`j.tplFit` 决定铺法。
样式源仍是 `tplStyle(k, j)` —— 编辑器缩略图、阅读器 `.tplbg`、PDF / 长图导出三处共用，
所以导出不会跟屏幕上差一圈留白：自定义这一档 `.paper.t-custom .tplbg` 把 `inset` 归零（满版），
`io-doc.js` 同步把版心留白设成 0。图片在手帐数据里，跟封面图片一样随源文件 / PDF / 长图一起走，
导入时 `normalizeJournal()` 只收 base64 位图 dataURL，标了 `custom` 却没图的一律落回 `blank`。

## 七、导入导出

- **导出 `.json`**：单本一个文件，结构为
  `{ app: 'carnet', version: 1, exportedAt, checksum: 'sha256:…', journal: {…} }`。
  `checksum` 是对内容做的稳定摘要，导入时可以验证文件有没有被改动或传输出错。
- **导出 PDF**：纯前端手写 PDF（每页一张 JPEG + 自造对象表），不引第三方库。
- **导出 SVG**：每页一个 `<foreignObject>` 竖向拼成矢量长图，放大不糊。
- **多选批量导出**：勾选多本后一次输出多个文件（每本一个，文件名各自用书名）。
- **导入**：兼容「单本导出文件 / 裸手帐本对象 / 多本数组」三种写法；按内容摘要查重，
  重复的会问一句要不要再存一份；导入后给出「收了多少页 / 图 / 文字」的核对报告。
- **示例文件**：`example/` 里的 `.json` 会在首次使用时自动导入；往里丢新文件即可（若服务器没开目录列表，
  需要把文件名补进 `example/manifest.json`）。
- **加密本导出 `.json`**：`journal` 字段是密文信封（见第六节），外层多一个 `encrypted: true` 方便识别；
  `checksum` 改按信封算。**密钥一个字节都不出文件**，所以拿到文件的人在别的设备上打开会弹解锁框，
  输对密钥才能看内容；输错就一直留在那里，不会偷偷落明文。
- **加密本导入**：信封原样入库（不动密文），`journalFP` 用 `lock.fp` 查重；
  第一次打开 / 编辑 / 导出 PDF 都会先弹解锁框，解开后这台设备就记住了。
  点封面输密钥 → **直接打开手帐本**；点编辑按钮输密钥 → **打开「编辑手帐本」弹窗**（见第六节不变量 3）。
  导入核对报告不会去数信封里的页数/图片之外的明文内容，因为外壳只有页数空壳。
- **加密本导出 PDF / SVG**：这两种格式本身就是明文，未解锁时挡住并提示先解锁；
  解锁后允许导（面板里写明会生成一份未加密副本）。

## 八、一键成书（图片 → 手帐本）

右上角「菜单」→「一键成书」→ 一次选多张图片（多选文件框），选完直接生成一本新手帐本：

- **一图一页**：第 1 张是第 1 页，第 2 张是第 2 页……顺序按**文件名的自然序**排
  （`IMG_2` 排在 `IMG_10` 前面；文件框给回来的顺序各家浏览器不一致，所以统一排一遍）。
- **每张图默认铺满整页**：`fill: true` + `x/y = 0` + `w/h = 1`，并 `locked: true` ——
  和工具条上那颗「铺满整页」完全是同一套设置。固定是必须的：整张纸都是图片时，
  不固定左右一划就变成拖图、翻不了页（要改就长按纸面解锁，再点工具条中间那颗还原）。
- **封面用第一张图**，内页模板一律 `blank`（照片自己就是底，不再压网格 / 横线）。
- 书名默认「图片手帐 M.D」，重名自动往后加序号；一次最多 200 页（超出的不收）。
- 小图（原文件 ≤ 220KB）直接用原图，不重编码、不丢透明通道；大图压到长边 1600 / JPEG .86 再存，
  透明 PNG 转 JPEG 会发黑，压之前先铺一层纸白。
- 成书要读好几张图，期间屏幕中间显示进度胶囊 `#mkBusy`（`toast` 只进控制台，
  这种几秒的活儿得有个看得见的进度）；成完自动翻开这本。

## 九、交互速查

| 位置 | 操作 | 结果 |
|---|---|---|
| 主页（轮播） | 左右滑 / 点封面 | 切换、翻开手帐本 |
| 主页右上「菜单」 | 点击 | 导入手帐本 / 一键成书 / 导入 PDF / 背景设置 / 帮助与反馈（前四 + 背景原在底栏「更多」，现在一并收在这里：它们都不依赖「当前选中的那一本」）。**没有「加密 / 密钥」这一栏** |
| 书架封面 / 书脊 | 🔒 徽章 | 只在**还需要输密钥**时出现：外部导入的密文、或点过「立即上锁」。设完密钥 / 解锁过 / 刷新后读回本机钥匙都不显示（`lockNeedsKey()`） |
| 编辑器 | 「加密与密钥」折叠小节 | **唯一入口**。显示当前状态（已加密 · 哪一档 · 本机是否记住密钥 / 未加密）+「设置 / 管理密钥…」按钮；点它会先把编辑器改动保存并关掉，再管 `state` 里那一本（避免改到 `ed.temp` 的副本）。未加密 → 设保密问题或密码并启用；已加密 → 更换密钥 / 取消加密 / 立即上锁 |
| 从外部导入的加密本 / 上锁后 | 点封面第一次打开 | 弹解锁框：保密问题档显示自定义问题、只输答案；密码档只输密码。输错留在原地，**输对后直接打开这本手帐本**（不弹编辑窗），这台设备也记住密钥，之后再打开不再询问 |
| 从外部导入的加密本 / 上锁后 | 点编辑按钮（封面齿轮 / 单层书架长按） | 同样弹解锁框，**输对后打开「编辑手帐本」弹窗**，可直接改书名 / 封面 / 装帧 / 内页模板；这台设备也记住密钥 |
| 主页右下 `＋` | 点击 | 新建手帐本 |
| 右上角「菜单」 | 一键成书 | 一次选多张图片 → 按文件名自然序排好 → 一图一页做成一本，每张图默认铺满整页（封面用第一张图），成书后直接翻开 |
| 右上角「菜单」 | 背景设置 | 升起背景面板（预设色 / 自定义色 / 背景图 / 恢复默认），主页和阅读器共用同一份 |
| 封面齿轮 | 点击 | 编辑这本（名称、封面、模板；**页数只有新建时能填**） |
| 多层书架 | 鼠标停在封面上 | **即选中这一本**并抬起（`translateY(-8px) scale(1.035)`，跟 `.active` 同一组数值）；**鼠标离开这本书就取消选中**（书架上不必非得留着一本被抬起的书）。选中状态的渲染只跟鼠标走 —— `renderShelf` 默认不画 `.active`（`SHELF_NO_SEL`），`state.sel` 仍跟着鼠标更新，因为翻开 / 搜索 / 导出都要一个目标。用 `shelfPick` 而不是 `selectJournal` —— 后者会 `scrollIntoView` 把那排滚到屏幕中间，鼠标路过就整页滑动会很晕 |
| 多层书架 | 单击封面 | 翻开（悬浮时已选中，所以一下就开） |
| 书架 | 长按封面 — 拖动 | 拖动排序；原地松手 = 只唤出编辑按钮 |
| 单层书架 | 鼠标停在某根书脊上 | **即选中这一根**：抬起一截 + 描一圈白边（`.spine-item.active`），下方预览框显示它的封面（书名就印在书脊上、页数点开就有，这里不再重复，也不挂编辑按钮）；**鼠标离开书脊就取消选中** —— 书脊落回架上、预览收起。默认**一根都不选中**（渲染时不写 `.active`，跟多层书架一个规矩），`state.sel` 仍跟着悬停走，抽出来翻开的动画要它当目标 |
| 单层书架 | 点书脊 | 鼠标悬停那一刻它已经是选中的了，所以**点一下就是翻开**：把书脊从架上抽出来（`.pulling`），再由封面 ghost 从它抬起后的位置飞成书，真身随即隐去（`.gone`），关书回来再放回架上。没有鼠标的场景（键盘 Tab / 手机）仍是两段式：第一次点选中，第二次才翻开 |
| 单层书架 | 长按书脊 — 拖动 | 左右拖动排序；原地松手 = 打开编辑（只有一本时同样开编辑） |
| 手机 / 平板上的单层书架 | 点书脊 | **没有预览框**（无悬停能力 → `no-preview`，省下的高度全给书脊），点一下直接抽出翻开 |
| 底栏「删除 / 分享」 | 书架模式下 | 进入多选，可批量导出或删除 |
| 阅读器 `‹ 返回` | 点击 | **合上书 → 封面飞回主页**：① 合书只演一次（当前这一跨直接合，不再先哗哗翻回封面）；② 方向**统一从左往右**——`.book.spread` 抬起左半边沿书脊翻到右边盖上（叶片 `-180° → 0°`，跟封面合回封面态那一翻同向），起飞面是当前左页、落地朝外的是封面；③ 封面缩回主页那张 ghost 的起飞点必须量得到——合完要把它交给 **`#slotR`**（`.cover-only` 会把左槽 `display:none`，放左槽里量出来是 0×0，ghost 会从屏幕左上角一个「无」里长出来） |
| 阅读器 | 左右滑 | 翻页 |
| 阅读器 `＋` | 点击 | 加页 / 加图片 / 加文字 / **贴纸** / **本页底色** / 删本页 |
| 贴纸 | `＋` 菜单 →「贴纸」 | 升起底部弹窗，三档标签：**便利贴**（带纸色皮肤的文字贴，落成后可继续打字 / 挪动 / 旋转，默认歪 −2.5°）、**装饰胶带**（撕边 + 花纹，带一点默认角度，压在照片角上正好）、**我的贴纸**（自己导入的图片，存进贴纸库下次继续用 —— 面板底部那颗「导入图片为贴纸」压到长边 400 / PNG 存，角上 × 可删）。落点是当前页正中偏上，同一页贴多张会依次错开 |
| 本页底色 | `＋` 菜单 →「本页底色」 | 升起底部弹窗：**九种颜色横着排成一列列**，每种竖着六档由浅到深（上浅下深），点一下这一页立刻换色（**只是预览，数据不动**）、面板不关可以连着试；**「完成」= 这才写进这一页**（左上角那颗 ✓ 同效），「自定义…」开取色盘；点纸面收面板 = 取消，纸面回到原来的颜色。
  取色盘里那颗**吸管**是**现场取色**：点下去所有浮层（取色盘 / 通用弹窗 / 底部弹窗 / 添加菜单）
  一律让位藏起，手账本页面照常看得见、点得到，直接在页面上点一下就取到色，全程不弹窗。
  只取手账本里的内容 —— 不走系统吸管也不走截屏（那些会吸到手账本以外的东西），
  也不从素材原图取（贴图在页面上常被裁剪 / 缩放 / 旋转，还叠着纸面纹理，原图 ≠ 看到的）。
  取样走活的 DOM：`elementsFromPoint` 拿元素栈、从底往上做 alpha 合成；
  图片插一个隐形探针量出盒子三角的屏幕位置，反解仿射变换把坐标映射回原始像素（旋转 / 缩放都对得上）；
  **CSS 背景不能只读 `backgroundColor`** —— 渐变封面、封面图案、内页网格 / 横线模板全画在
  `background-image` 上，所以把该层的 `background-*` 原样塞进 SVG `foreignObject` 栅格化成离屏画布
  再按点 `getImageData`（按元素缓存）；⚠️ 图案 / 光泽 / 书脊 / `.tplbg` 平时是
  `pointer-events:none`，取色期间靠 `body.ep-picking` 临时放开命中测试，否则这些层会被漏掉。
  文字用 Range 行盒判断是否压在字上，字间空隙不会被误判成字色。
  放大镜 90px 装 15×15 个取样点、相邻点只隔 0.5 CSS px（半像素精度，1px 网格线也分得出）；
  Esc 或「取消」退出。吸完只是把颜色填进面板，还能用 HSV 再微调，不会一下定死 |
| 阅读器 | 点上任意图片 / 文字贴 | 图片：选中并浮出工具条（完成 ✓ / 复制 / **换图** / 铺满 / 删除），接着就能拉角旋转；**文字贴长按调版式（挪位置 / 改大小）、双击只改文字**，单击不动它 |
| 上下层 | 不用管 | 先加的在下、后加的盖在上面（图片与文字混在一起排）；拖动 / 缩放不会改变层次 |
| 旋转 | 拖对象右边外侧那颗带转圈箭头的手柄 | 绕中心转；按住 Shift 每 15° 吸附；双击手柄摆正 |
| 文字框大小 | 不用管 | **框始终紧贴文字**：短句框就那么宽、一行字框就那么高，打字变长跟着长、删字跟着收回去；长段落到行宽上限才折行。拖四角时框宽高与字号同比缩放，换行位置不变，既不留空白也不裁字 |
| 图片 | 拖拽移动、双指缩放、四角拉伸 | 调整位置与大小 |
| 图片 | 工具条第 3 颗「换图」 | 选另一张图把现在这张换掉：**位置 / 宽 / 旋转 / 上下层原样保留**，只按新图的真实比例重算高度（不铺满时；`.pimg` 是 `object-fit:fill`，盒子比例不对就会把人拉扁）；铺满整页那档换完仍是铺满，`x/y/w/h` 一律不动。跟「添加图片」一样存原图、不重编码，透明通道也留着。换完仍保持选中，可以接着调 |
| 图片工具条 | 点第 5 颗「边框」 | 升起「图片边框」面板：六档框（无 / 拍立得 / 纯色 / 细线 / 相框 / 凹陷）+ 八档预设色 + 自定义取色 + **一根粗细拖动条**。**挑一档立刻画到纸上并存档**（不整页重绘，选中态与位置全保留），再点同一档 = 取消；不想要就点回「无边框」 |
| 图片工具条 | 点第 4 颗 | 铺满整页 ⇄ 还原（铺满时自动固定，长按纸面可解锁） |
| 文字贴 | **单击** | **完全没反应**：不选中、不画虚线框 —— 手势照旧归翻页（横划一下照样翻页） |
| 文字贴 | **长按 420ms** | **版式态**：解除固定 → 选中（虚线框 + 工具条 + **四角 / 旋转手柄**），手指不用抬就能**直接拖着挪位置**（跟图片长按同一个手势、同一档时长）；抬手后**拖四角改大小、拖右边那颗转**；同样支持跨页拖到另一页。没按够就松手或中途划开 = 单击，手势交回翻页 |
| 文字贴 | **双击** | **内容态**：只改文字 —— 落光标打字、拖选一段字、改字体颜色字号都行；**不能移动文本框、不能改大小、不能旋转**，四角 / 旋转手柄全部收起，只留上方工具条（完成 ✓ / 复制 / **字随框缩放** / 编辑 / 删除）；点纸面空白处收尾并固定。想动位置或大小请改用长按 |
| 文字贴 | **拖四角**（先长按进版式态） | **框宽、框高、字号同比变化**，对角钉死不动，整块像贴纸一样放大缩小，换行位置不变，**拖多小就变多小（不会一碰就撑大）**；按住 **Alt** 拖（桌面）或点灭工具条那颗开关 = 只改框、字号不动，拉出来的宽度记成手动行宽，之后打字不再自动收窄（图片的四角一直是这种自由拉伸）。倍数受纸边、字号 2.2~22 夹逼，字不会先撞到上限把比例拉歪 |
| 文字贴工具条 | 点「字随框缩放」那颗（默认点亮） | 在「字随框缩放 ⇄ 只改框」之间切；状态跟着这张文字贴存盘，触屏没有 Alt 也能用。切回「开」再拖一次四角即恢复自动贴合 |
| 文字贴编辑态 | 工具条「编辑」 | 打开「编辑文字」面板（会先把行内打的字落盘；面板期间同样不显示手柄、不能移动 / 缩放文本框） |
| 编辑文字面板 | 字体 / 颜色 / 字号 / 格式 四页 | 中文 4 档（手写 / 楷 / 宋 / 默认）+ 英文 8 档（跟随中文 / 衬线 / 等宽 / 手写 4 档系统字体，打字机 / 复古等宽 / 像素 / 旧打字机 4 档项目自带 woff2）；文字色与高亮色；字号滑块 + 4 个快捷档（范围 2.2~22，占纸宽百分比；这一页是**单独调字号**，框会按新字号重新贴紧文字，拖四角才是整块缩放）；粗 / 斜 / 下划线 / 删除线 + 对齐 |
| 编辑态左上角 | ✓ / 撤销 / 重做 | 完成并固定；撤销 / 重做只在这一次面板会话内有效（连续打字 800ms 合并成一步） |
| 编辑态 | 点纸面空白处 | 收起面板并固定对象（刚关面板 450ms 内不会误翻页） |
| 底栏页码 | 长按 | 唤出页数轴，拖动快速跳页 |
| 键盘 | ← / → | 翻页 |

> **编辑态（`eflow`）**：面板打开时阅读器的顶栏 / 底栏淡出让位，让面板不压住纸面。
> 让位的方式按屏幕方向分两套，判定条件写在 `src/text-sticker.js` 的 `SIDE_SHEET_MQ`
> 与 `style/text.css` 末尾那段媒体查询里 —— **两处字符串必须一字不差**：
> - **竖屏**：面板贴底全宽（窄屏）/ 右下角浮块（`≥620px`）。量出面板压住纸面的高度记进
>   `--sheet-h`，书按 `--stage-shift` 整体上移一半、`layoutBook()` 只在剩下那段里排。
> - **横屏**（`landscape` 且 `≥620px`）：面板改成**右侧一竖条**（顶到底）。横屏卡的恰恰是高度，
>   贴底会把纸压成一条；宽度反而富余，所以量的是面板从右边占掉多宽（记进 `--sheet-side`），
>   `.stage` 按它收窄、书在自己那一半里居中 —— **只左移、不缩小**。输入法弹起时不下压整块，
>   只把竖条下沿抬到键盘上沿（`--sheet-kb`）。

## 十、开发约定

**文件命名**：一律小写 `kebab-case`，按「属于哪一块」加前缀分组 —— `io-*`（导入导出）、`home-*`（主页）、
`reader-*`（阅读器）、`page-*`（页面内容与底色）。CSS 与它管的那一块同名（`style/page-bg.css` 管「本页底色」
弹窗，`src/page-bg.js` 是它的逻辑），两边对得上号。

**文件头注释**是每块的说明书，六项固定：编号（`脚本 N / 28`，要与 `index.html` 里的顺序一致 ——
插在中间就得把后面所有编号 +1）/ 职责分条 / **对外接口**（别的模块会调的函数与常量，照着它找入口最快）/
依赖模块（后置依赖会标注「只在运行时回调里用」）/ 共用全局作用域的说明。

1. **新增模块**：在 `src/` 建文件 → 按依赖顺序插进 `index.html` 的 `<script defer>` 列表 →
   在本文第三节的表格里补一行（含依赖）→ 按上面的格式写文件头 → **把后面各文件的编号 +1**。
2. **新增样式**：同理，插进 `<link>` 列表并在第四节补一行；注意**层叠顺序**。
3. **提示信息**：一律 `toast('…')`，它只会打到控制台（`[Carnet] …`，失败类自动 `console.warn`），
   界面上不再有浮层——别再往页面上加提示条了。
4. **全局命名**：模块内的小工具如果不希望被别的模块误用，就用口语化的名字并在注释里写清用途；
   跨模块复用的东西统一放在 `core.js` / `visuals.js` / `storage.js`。
5. **破坏性操作**（删除）必须走 `askConfirm()` 二次确认。
6. **共用常量不要散着写**：页面比例 `PAGE_RATIO`、基准页宽 `PAGE_W_DEFAULT`、「算深色」的阈值 `LUM_DARK`
   都在 `visuals.js` 顶部；对象能探出纸面的边界 `OBJ_MIN / OBJ_MAX` 在 `page-edit.js` 顶部。
   同一个数字出现三次以上就给它个名字，否则改的时候必漏一处（导出与屏幕排版会悄悄对不上）。
7. **关面板后抑制翻页**：任何面板 / 菜单关闭时调一次 `markFlipSuppressed()`，翻页判定处统一问
   `flipSuppressed(ms)`（两个都在 `core.js`）。别再自己记时间戳 —— 底色面板漏过这一步，
   结果关掉面板后紧接着点纸面会误翻页。
8. **字族串的四个坑**（改 `visuals.js` 的 `TEXT_FONTS / EN_FONTS` 时务必注意）：
   - 字体名一律用**单引号** —— 这些串会被塞进 `style="…"` 属性里，双引号会把属性截断；
   - **引号必须成对、栈末不能多一个**。`"'SimSun','宋体',serif'"` 这种写法 CSS 解析器会当成
     一个没闭合的字符串，**整条 `font-family` 声明直接作废**，浏览器默默回落到默认字体 ——
     界面上「点了宋体却没变化」就是这么来的（2026-10-02 修过这条）；
   - 英文那几档**绝对不能带通用族**（`serif / monospace / cursive`），否则会连汉字一起截胡，
     中文字体整条失效。英文栈要排在中文字体**前面**。
   - 项目自带的那四档，字族名必须和 `style/base.css` 的 `@font-face` **一字不差**：
     `EN_FONTS.face.family` 就是导出时往独立文档里注册的名字，写错了导出会静默退回
     `fallback`，页面上却看着完全正常（最难查的一种）。加一档要同时动 CSS、`EN_FONTS`
     和下面「字体」那节的表三处。
   - 自查：`getComputedStyle(el).fontFamily` 应当**原样**吐出你写的那条栈；吐出来是继承值或者
     只剩默认栈，就说明这条声明被丢了。
9. **量文字贴合尺寸的四个坑**（改 `text-sticker.js` 的 `textFitSize / fitTextBox` 时务必注意）：
   - **别读 `scrollHeight`** —— 它是 `max(框高, 内容高)`，内容没顶满时量到的就是框高；
     再配上「内容高 + 余量」就成了正反馈，每输入一次长高几 px，永远停不下来（旋转过的框踩过）。
   - **别用 `Range.getBoundingClientRect()`** —— 它量的是字体的外框而不是行盒，
     一行只有 `line-height` 的七成，多行差得更多，框会一直比内容矮、最后一行被裁掉；
     转过角度时它量的是旋转后的外接框，又虚高一大截。
   - 正确做法：**复制一份 `.ptxt` 挂回原父节点**，`height:auto` 后读 `offset*`（布局尺寸，
     不受 `transform` 影响），量完立刻删。宽度先 `max-content` + `max-width:行宽上限`，
     再固定到贴合宽度量高度 —— 两次读的都是同一个 clone，不会跟自己反馈。
   - **`offsetHeight` 只拿来数「有几行」，别直接当高度用** —— 它返回整数，单行文框才 30 来 px，
     1px 取整就是 3% 误差，等比放大时框高会和字号脱钩。改用 `行数 × 分数行高 + 安全边`。
   - **安全边要按字号 / 行高的倍数给，别写死 px**：等比拖四角时字、框、边必须一起乘 `s`，
     写死 px 会让 `框宽 / 字号` 的比例变掉，长段落的换行位置就跟着变。
   - **拉伸的最小尺寸别套图片的 `IMG_MIN_*`**：文字贴的下限按「一个字宽 / 一行行高」现算，
     而且等比模式的 `s` 下界只能看字号（理由见上面那一节）。
10. **验证**：仓库里有可直接跑的无头浏览器脚本，见 `.workbuddy/_tmp_verify/`（`_mod.js` 冒烟、
   `_example.js` 首次导入、`_bg2.js` 背景、`_rename.js` 改名迁移、
   `_sheet.js` / `_sheet2.js` 编辑面板与对象工具条、`_click2.js` 文字贴双击编辑、
   `_rot.js` / `_hdl.js` 旋转与手柄、`_z.js` 删除与层级、`_hfit.js` 框高自动贴合、
   `_layout.js` 轮播多尺寸布局、`_font2.js` 字体档位、`_bgdone.js` 底色的预览与完成、
   `_bgsheet2.js` 底色弹窗、`_edit4.js` 编辑器、`_pb.js` 一键成书（真实菜单 + 排序 / 铺满 / 空选）、
   `_pb2.js` 成书截图、`_refcheck.js` 整理后的综合核对、
   `_decor.js` 四种装帧 / 图片边框 / 便利贴 / 胶带贴纸四项新功能、
   `_enfonts.js` 四款自带英文字体档位 / 面板 / 导出内嵌 / 栅格化像素、
   `_fslink.js` 文字贴四角「字随框缩放」：等比 / 对角固定 / 换行不变 / Alt / 开关 / 图片不受影响 / 上下限 / 面板与导出 / 真实鼠标、
   `_tbfit.js` 文字框紧贴内容：微拖不跳变 / 短句长段落贴合 / 增删字跟着变 / 老数据首绘贴合 / 手动行宽 / 导出一致 / 截图）、
   `_lock.js` 加密主链路 23 项（MD5 标准值 / 启用加密 / 落盘密文 / 刷新免密 / 上锁 / 输错输对 /
   导出密文 / 新设备导入首次需密钥 / 解密后文字图片封面模板图一致 / 换密钥 / 表单校验 / PDF 守卫 / 取消加密）、
   `_lock2.js` 加密支线（编辑器入口 / 换密钥 UI / 批量导出 / 书架与书脊徽章 / 搜索 / PDF 守卫 / 取消加密）、
   `_lock3.js` 三项改动专项（菜单项已移除 / 编辑器唯一入口 / 解锁后徽章消失 / 桌面与触屏弹窗打开不位移 / 触屏真聚焦才顶起且不误关）、
   `_lock4.js` 解锁落地（按入口分流：编辑按钮输密钥 → 编辑弹窗 / 封面输密钥 → 直接开书 / 静默解锁仍可编辑 / 管理面板仍回原处 / 守卫两参且三条分支同 `done`）。
   脚本连 `http://127.0.0.1:8777`，
   先在本目录起 `python -m http.server 8777`，再 `node .workbuddy/_tmp_verify/_mod.js`
   （`playwright-core` 就装在同目录的 `node_modules` 里，不用额外设 `NODE_PATH`），
   结果写到同目录的 `_xxx_out.txt`。
`_enfonts.js`（8787）、`_fslink.js`（8788）、`_tbfit.js`（8792）、`_lock.js`（8795）、
`_lock2.js`（8796）、`_lock3.js`（8803）、`_lock4.js`（8806）自带静态服务，不用先起 8777，
直接 `node _enfonts.js` / `node _fslink.js` / `node _tbfit.js` / `node _lock.js` / `node _lock2.js` /
`node _lock3.js` / `node _lock4.js` 即可；`_enfonts.js` 带 `font/woff2` MIME，四个加密脚本都跑在
`http://127.0.0.1`（安全上下文，`crypto.subtle` 可用），且用系统 Chrome 而非 Playwright 自带内核。

11. **高频事件一律走 `frameQueue()`**（在 `core.js`）：`pointermove / scroll / input / 滑块` 只 `push()`
    最新值，重活一帧跑一次；手势收尾必须 `flush()` 补最后一帧（拖动落位、取色盘最终色值都靠它），
    中途作废用 `cancel()`。别再各写一份 `let raf = 0` 的合帧器。
    同理，四张底部面板的「点外面关闭」与「升起时量两次布局」共用 `text-sticker.js` 的
    `armSheetOutside / disarmSheetOutside / scheduleSheetLayout`，新增面板照着接即可。
    拖动期间容器 / 纸面的 `getBoundingClientRect()` 要在手势开始时量一次缓存下来，
    滚动改的是 `scrollTop / scrollLeft`，盒子本身不动。

12. **加密改动是「多处同源」**：`.json` 单本导出在 `io-export.js`、批量导出在 `io-share.js`、
    落盘在 `storage.js`、PDF / SVG 守卫在 `io-doc.js` 与 `io-share.js`、
    开书守卫在 `reader-flow.js`、导入识别在 `io-import.js`、书架徽章在 `home-view.js`、
    删本清钥匙在 `home-events.js`、编辑器小节在 `editor.js` ——
    改加密行为时**先在 `lock.js` 改一处、再顺着上面这张单子核对调用点**，别在调用方各写一份判定。
    判「有没有锁」一律 `journalHasLock(j)`、判「是不是信封」一律 `lockIsSealed(j)`、
    判「书架要不要挂徽章」一律 `lockNeedsKey(j)`，别自己摸 `j.enc` 或 `lockKeys`。
    新增入口要接守卫时想清楚「解锁后去哪」：`done` 就是原动作重跑一次，
    开书入口传 `() => openReader()`、编辑入口传 `() => openEditor(cur())`；
    ⚠️ 别在 `done` 里换成别的动作，也别再加「弹框输密钥就改道」的第三参数（第二十四轮已废弃）。
    改完跑 `node .workbuddy/_tmp_verify/_lock.js` / `_lock2.js` / `_lock3.js` / `_lock4.js`。

## 十一、已知事项

- `file://` 直接打开时，浏览器禁止 `fetch` 本地文件 → `example/` 的自动导入会跳过（其余功能正常，
  可用菜单里的「导入手帐本」手动选择）。
- 部分浏览器在 `file://` 下不提供 `crypto.subtle`，此时加密的设置 / 解锁会被挡住并提示改用
  `http://localhost` 或 `https` 打开（`lkCryptoOK()`）；用 `python -m http.server` 起个本地服务即可。
- `index.html` 里有一行 `/page/page_comm/inject.js`，是外部页面编辑器的注入脚本，本地不存在，
  控制台会有一条 404，与应用本身无关。
- `example/manifest.json` 只在服务器没开目录列表时才需要。开了列表的情况下，直接往 `example/`
  丢新 `.json` 就能被自动发现。

## 十二、字体

`--font-hand` 链首是项目自带的 `CarnetHand`，定义见 `style/base.css` 顶部的 `@font-face`。

| 文件 | 大小 | 说明 |
| --- | --- | --- |
| `assets/font/carnet-hand.woff2` | 2.55 MB | GB2312 全覆盖（6763 汉字 + 全角标点），用 fontTools 从 `851tegakizatsu.ttf` 裁出来的子集 |
| `assets/font/carnet-hand.woff` | 3.51 MB | 同内容的 woff 版，给不认 woff2 的老浏览器兜底 |
| `assets/font/851tegakizatsu.ttf` | 27 MB | 母字体，全 URO 20902 字。留着是为了能随时重裁，**运行时不加载**（没有任何地方引用它） |

### 四款自带英文字体（文字贴「英文字体」后四档）

| 文件 | 大小 | 面板档位 | 字族名 |
| --- | --- | --- | --- |
| `assets/font/en/CourierPrime-Regular.woff2` | 26 KB | 打字机 | `CarnetCourierPrime` |
| `assets/font/en/CutiveMono-Regular.woff2` | 30 KB | 复古等宽 | `CarnetCutiveMono` |
| `assets/font/en/PixelifySans-Regular.woff2` | 15 KB | 像素 | `CarnetPixelifySans` |
| `assets/font/en/SpecialElite-Regular.woff2` | 60 KB | 旧打字机 | `CarnetSpecialElite` |

四支都是随项目自带的开源拉丁字体（字族定义见 `style/base.css` 顶部，档位表见 `visuals.js`
的 `EN_FONTS`）。它们只含拉丁字形，汉字靠 CSS 的逐字符回退落到后面的中文字体，所以英文栈
必须排在中文字体前面、且**不能带通用族**（见开发约定第 8 条）。`@font-face` 是懒加载的，
首屏一个请求都不多；打开「编辑文字 → 字体」面板时，八个按钮各自用自己那套字族显示，
那一刻才会把用到的字体拉下来。文件名同样必须是纯 ASCII，理由同上手写体。

**导出为什么也能用真字体**：导出的 XHTML 要塞进 SVG 图片里栅格化，是个独立文档，吃不到本页的
`@font-face` —— 手写体 2.55MB 太大，只能探测后退化成楷体；这四支合计不到 140KB，
`io-doc.js` 的 `prepareExportEnFaces()` 会按这一本**实际用到的档位**把 woff2 转成 base64，
写进 SVG 根级 `<style>`（PDF 每页一份、SVG 长图全书一份）。已用无头浏览器对照实验坐实：
SVG-as-image 的「安全静态模式」允许 `data:` 的 `@font-face`，有内嵌时栅格化像素跟回退字体
明显不同，且根级一处定义所有 `foreignObject` 共用。`font-display:block` 不能省 —— 导出是
「Image 一 load 就画」，`swap` 会先把回退字体画进画布。没用到的档位一律不内嵌，老本子的
导出结果一个字节都不变；`file://` 下 `fetch` 被拦掉时静默降级到 `EN_FONTS.fallback` 的
近似系统字体链。

**文件名必须是纯 ASCII。** 它曾经叫 `手写体.woff2`，部署后中文变楷体 / 雅黑、英文却还是手写体。
根因不是缺字形，而是部分静态托管**解析不了非 ASCII 路径就回落成 index.html** —— 字体请求拿到的是
`200 + text/html` 而不是 404，Network 面板看着一切正常，浏览器把一段 HTML 当字体解析失败，
**整个字族静默作废**；此时拉丁字母退到 Windows 自带的 Lucida Handwriting / Comic Sans（所以看着还像
手写体，极具迷惑性），中文退到楷体 / 微软雅黑。已用 CDP 对照实验坐实：正常 `200 font/woff2` →
`FontFace.status === 'loaded'`；404 与「200 但内容是 HTML」两种情况都是 `'error'`。

排查直接看控制台：`main.js` 开机自检 `handFontStatus()` 会报，也可以手动 `await carnetFontOK()`，
返回 `'ok'` 才算数。**别用「量字形宽度」判断** —— canvas `measureText` 和 DOM `offsetWidth` 都不吃
未激活的 web 字体，且手写体和 serif 都是全角汉字、宽度会撞车（`手帐本Aa0`@64px 两边都恰好 288.00px）。

要重裁（比如想换更大的字符集 / 更小的体积）：

```bash
pip install fonttools brotli
python -c "from fontTools.ttLib import TTFont; from fontTools.subset import Subsetter, Options; ..."
```

核心就是 `Subsetter().populate(unicodes=...)` 挑目标码位，`f.flavor='woff2'` 再 `f.save()`；
目标码位除了 GB2312 全集，还要并上基本拉丁、`U+3000-303F` 与全角形式 `U+FF01-FF60`，否则会漏标点。
