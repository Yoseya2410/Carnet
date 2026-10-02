/* =====================================================================
 * Carnet · 首次使用 · 自动导入 example 目录   （脚本 8 / 24）
 * ---------------------------------------------------------------------
 * ① 列出 example 目录里的手帐本文件（目录列表优先，manifest.json 兜底）
 * ② 首次启动自动导入，写标记只导一次；file:// 打开时自动跳过
 * ③ 帮助与反馈邮件入口 openHelpMail
 *
 * 对外接口：importExampleJournals, openHelpMail, EXAMPLE_FLAG_KEY
 *
 * 依赖模块：core, storage, io-import
 *
 * 说明：模块间共用全局作用域，加载顺序即依赖顺序（见 index.html 与 README）。
 * ===================================================================== */
/* ==================== 首次使用：从 example 目录导入示例手帐本 ==================== */
/* 目录位置相对 index.html 解析，部署到子目录下也不会找错地方 */
const EXAMPLE_BASE = new URL('example/', document.baseURI).href;   // 形如 .../example/
const EXAMPLE_FLAG_KEY = 'carnet_example_v1';               // 记「已经导过一次了」，之后不再重复导
const DROP_DEFAULT_FLAG_KEY = 'carnet_drop_defaults_v1';    // 记「老预置本已清理过」，只清一次
async function fetchText(url) {
  try {
    const r = await fetch(url, { cache: 'no-store' });
    if (!r.ok) return null;
    return await r.text();
  } catch (e) { return null; }                                     // file:// 下拉不到文件，静默跳过
}
/* 文件名里有中文和 ! 之类符号，encodeURIComponent 放不过 !'()*，这儿一并转成 %XX */
function encodeFileName(name) {
  return encodeURIComponent(name).replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase());
}
/* 列出 example 目录里的手帐本文件，返回 [{ name, url }]：
   ① 先试静态服务器的目录列表 —— 直接用它给出的链接，最贴近服务器自己的编码；
      往目录里丢新文件也不用改代码
   ② 拿不到目录列表就退回目录里的 manifest.json 清单 */
async function listExampleFiles() {
  const html = await fetchText(EXAMPLE_BASE);
  if (html) {
    const out = [], seen = new Set();
    const re = /href\s*=\s*["']([^"']+\.json)["']/gi;
    let m;
    while ((m = re.exec(html))) {
      let url, name;
      try { url = new URL(m[1], EXAMPLE_BASE).href; } catch (e) { continue; }
      name = url.split('/').pop().split(/[?#]/)[0];               // 去掉目录列表可能带的排序参数
      try { name = decodeURIComponent(name); } catch (e) { /* 解不出来就用原样 */ }
      if (!name || name.toLowerCase() === 'manifest.json' || seen.has(name)) continue;
      seen.add(name); out.push({ name, url });
    }
    if (out.length) return out;
  }
  const mf = await fetchText(EXAMPLE_BASE + 'manifest.json');
  if (mf) {
    try {
      const parsed = JSON.parse(mf);
      const list = Array.isArray(parsed) ? parsed : (parsed && parsed.files);
      if (Array.isArray(list)) {
        return list.filter(n => typeof n === 'string' && n)
                   .map(n => ({ name: n, url: EXAMPLE_BASE + encodeFileName(n) }));
      }
    } catch (e) { console.warn('[example] manifest.json 解析失败', e); }
  }
  return [];
}
/* 首次启动时调用：目录里有 .json 就逐本读进来，走和「导入手帐本」完全一样的校验与查重 */
async function importExampleJournals() {
  /* file:// 打开时浏览器禁止读取本地文件，检查不了就下次再说（不写标记，换到 http 下还能补上） */
  if (location.protocol === 'file:') {
    console.info('[example] 当前是 file:// 打开，读不到 example 目录；用 http 方式打开会自动导入示例手帐本');
    return;
  }
  if (await DB.get(EXAMPLE_FLAG_KEY)) return;                      // 已经导过，不再打扰
  const files = await listExampleFiles();
  if (!files.length) {
    console.info('[example] example 目录里没有手帐本文件，跳过自动导入');
    return;
  }
  let items = [], bad = 0;
  const had = new Set(state.journals.map(j => j && j.name));
  for (const f of files) {
    const name = f.name;
    const text = await fetchText(f.url);
    if (text == null) { console.warn('[example] 读不到文件：' + name); bad++; continue; }
    try {
      const r = await readJournals(text);
      /* 书架里已经有同名的一本（用户自己建过 / 以前导过）就不再重复塞一本 */
      const fresh = r.items.filter(it => !had.has(it.journal.name));
      /* 打上标记：它们是从 example 来的，别再被「清理老预置本」那条一次性迁移误删 */
      fresh.forEach(it => it.journal.fromExample = true);
      if (fresh.length) { fresh.forEach(it => had.add(it.journal.name)); items.push(...fresh); }
      else if (!r.items.length) bad++;
    } catch (e) { console.warn('[example] 解析失败：' + name, e); bad++; }
  }
  try {
    if (items.length) await importJournals(items, bad);
    else if (bad) toast('example 目录里的文件没能识别，可在菜单里用「导入手帐本」手动选择', 3600);
  } catch (e) { console.error('[example] 导入失败：', e); }
  await DB.set(EXAMPLE_FLAG_KEY, { at: Date.now(), imported: items.length });
}

/* 帮助与反馈：唤起邮件，邮箱同时复制到剪贴板，防止 App 内拉不起邮件客户端 */
function openHelpMail() {
  const sub = encodeURIComponent('Carnet - 帮助与反馈');
  const body = encodeURIComponent('\n\n（请描述遇到的问题或建议）\n\n— 来自「Carnet」');
  copyText(HELP_MAIL);
  window.location.href = `mailto:${HELP_MAIL}?subject=${sub}&body=${body}`;
  toast('已唤起邮件；若没打开可粘贴 ' + HELP_MAIL);
}

