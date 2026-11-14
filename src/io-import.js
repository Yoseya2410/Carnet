/* =====================================================================
 * Carnet · 导入 · 校验与查重   （脚本 8 / 28）
 * ---------------------------------------------------------------------
 * ① normalizeJournal：补全缺省字段，保留未知字段，导出→导入不丢东西
 * ② readJournals：兼容单本 / 裸对象 / 多本数组三种写法，带 checksum 校验
 * ③ importJournals：按内容摘要查重后收进书架，并出核对报告 importReport
 *
 * 对外接口：normalizeJournal, readJournals, importJournals, pickImportFile
 *
 * 依赖模块：core, storage, io-export
 *
 * 说明：模块间共用全局作用域，加载顺序即依赖顺序（见 index.html 与 README）。
 * ===================================================================== */
function normalizeJournal(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const j = (raw.journal && typeof raw.journal === 'object') ? raw.journal : raw;
  if (!j || typeof j !== 'object' || !Array.isArray(j.pages)) return null;
  const cv = (j.cover && typeof j.cover === 'object') ? j.cover : {};
  const val = typeof cv.value === 'string' && cv.value ? cv.value : GRADS[1];
  /* 以原对象为底逐项兜底，而不是重建一个新对象：
     凡是现在用不到、将来会新增的字段（含封面上、页面上的额外字段）都会原样留下，
     导出→导入不再把它们悄悄丢掉 */
  const out = {
    ...j,
    id: uid(),                                  // 换新 id，避免和已有的手帐本撞车
    name: String(j.name || '导入的手帐'),
    cover: {
      ...cv,
      type: (cv.type === 'solid' || cv.type === 'gradient') ? cv.type : (/gradient/i.test(val) ? 'gradient' : 'solid'),
      value: val,
      pattern: normPat(cv.pattern),
      /* 封面纹理：非法 / 老文件没这个字段都落到「无纹理」，外观跟旧版一致 */
      texture: normTexture(cv.texture),
      img: (typeof cv.img === 'string' && cv.img) ? cv.img : null,
      /* 自定义封面草稿：新版是阅读器同款 images / texts，老文件可能是 items。
         结构合法才留（打开页面时 normDiyCover 还会再逐字段洗一遍、并把 items 换算过来）。
         成品封面图走上面的 img，跟普通上传封面完全同一条渲染 / 导出路径 */
      diym: (cv.diym && typeof cv.diym === 'object'
        && (Array.isArray(cv.diym.images) || Array.isArray(cv.diym.texts) || Array.isArray(cv.diym.items)))
        ? cv.diym : null
    },
    /* 彩带：'none' = 透明档（隐藏彩带且不画书槽），原样保留；
       其它空值 / 非法色值才回落到默认色，避免导入进来的封面左侧空一块 */
    ribbon: (ribbonIsNone(j.ribbon) ? RIBBON_NONE
      : (/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(String(j.ribbon || ''))
        ? j.ribbon : RIBBON_FALLBACK)),
    /* 装帧样式（精装 / 活页 / Personal 活页 / 方形画册）：乱填的一律按精装 */
    style: normBookStyle(j.style),
    /* 已下线的「日历」模板映射到现在的空白牛皮纸，导入老文件时页面不丢 */
    template: j.template === 'calendar' ? 'kraftplain'
      : (TEMPLATES.some(t => t.k === j.template) ? j.template : 'blank'),
    /* 自定义内页模板：图片只认 base64 位图 dataURL，铺法只认三档之一。
       图跟封面图片一样随手帐本走，导进另一台设备也能照原样铺出来。
       tplImgs 是「素材库」（可存多张，tplImgsOf 会逐张校验 / 去重 / 限数量，
       并把只有 tplImg 的老数据那张兜底并进来）；当前模板仍是唯一张 tplImg。 */
    tplImg: tplImgOf(j),
    tplImgs: tplImgsOf(j),
    tplFit: normTplFit(j.tplFit),
    pages: j.pages.map(pg => {
      const p = (pg && typeof pg === 'object') ? pg : {};
      return {
        ...p,
        images: Array.isArray(p.images)
          ? p.images.filter(im => im && typeof im.src === 'string' && im.src).map(im => ({ ...im, id: im.id || uid() }))
          : [],
        texts: Array.isArray(p.texts)
          ? p.texts.filter(t => t && typeof t === 'object').map(t => ({ ...t, id: t.id || uid() }))
          : []
      };
    }),
    created: Number(j.created) || Date.now()
  };
  /* 封面翻口圆角：只认合法数字，越界夹回范围；老文件没这个字段就删掉，
     让它按装帧走默认档（coverRadiusOf）。乱填的字符串 / null 都不留进数据。 */
  if (cv.radius !== undefined && cv.radius !== null && cv.radius !== '' && Number.isFinite(Number(cv.radius)))
    out.cover.radius = clamp(Number(cv.radius), COVER_R_MIN, COVER_R_MAX);
  else delete out.cover.radius;
  /* 活页封面内侧：只认合法模式 / hex 色 / base64 位图；老文件没这个字段就删掉（走 auto 主色）。
     ⚠️ 别把 insideDominant 之类的派生缓存写进来，主色一律在运行时按封面现算。 */
  if (cv.inside && typeof cv.inside === 'object') {
    const o = { mode: normInsideMode(cv.inside.mode) };
    const c = normHex6(cv.inside.color); if (c) o.color = c;
    if (isImgData(cv.inside.img)) o.img = cv.inside.img;
    /* 候选主色的选择序号：只认 0~4 的整数，乱填就当没选（回落到占比最多的那一个） */
    const pk = Number(cv.inside.pick);
    if (Number.isFinite(pk)) o.pick = clamp(Math.round(pk), 0, INSIDE_PALETTE_MAX - 1);
    out.cover.inside = o;
  } else delete out.cover.inside;
  /* 书槽开关：只有显式 false 才存（缺省就是开启，别把 true 写进老数据） */
  if (cv.groove === false) out.cover.groove = false;
  else delete out.cover.groove;
  /* 标了 custom 却没带图（手工改过的文件 / 老版本）：落回空白纸，别留一张看不见图的空模板 */
  if (out.template === 'custom' && !out.tplImg) out.template = 'blank';
  /* ---- 加密信封 ----
     lock 与 enc 必须成对且字段齐全，否则这本永远解不开，宁可当普通本子收进来。
     ⚠️ 这里只校验结构、**不解密**：导入进来保持密文，第一次打开才需要输入密钥。
        注意 id 已被换成新 id（密文里存的还是导出那台的旧 id，解封时由 unsealJournal 跟过来）。 */
  const lk = out.lock, en = out.enc;
  if (lk && en && typeof en.iv === 'string' && typeof en.data === 'string'
      && typeof lk.salt === 'string' && lk.check && typeof lk.fp === 'string') {
    out.lock = {
      v: LOCK_V, mode: lk.mode === 'question' ? 'question' : 'password',
      salt: lk.salt,
      check: { iv: String(lk.check.iv || ''), data: String(lk.check.data || '') },
      fp: lk.fp, q: String(lk.q || '').slice(0, 120)
    };
  } else { delete out.lock; delete out.enc; }
  return out;
}
/* 兼容三种写法：本应用导出的单本、裸手帐本对象、多本数组。
   返回 { items:[{ journal, sum, declared, ok, src }] }：
   ok = true 校验通过 / false 校验不符（文件被动过或传输出错）/ null 该文件没写校验值 */
async function readJournals(text) {
  let d;
  try { d = JSON.parse(text); } catch (e) { return { items: [] }; }
  if (!d || typeof d !== 'object') return { items: [] };
  const raws = Array.isArray(d) ? d : (Array.isArray(d.journals) ? d.journals : [d]);
  const items = [];
  for (const r of raws) {
    const p = normalizeJournal(r);
    if (!p) continue;
    const body = (r && typeof r === 'object' && r.journal && typeof r.journal === 'object') ? r.journal : r;
    const own = (r && typeof r === 'object' && typeof r.checksum === 'string') ? r.checksum : null;
    const pkg = (!Array.isArray(d) && typeof d.checksum === 'string') ? d.checksum : null;
    const want = own || (raws.length === 1 ? pkg : null);
    const sum = await checksum(stableStringify(body));
    items.push({ journal: p, sum, declared: want, ok: want ? want === sum : null, src: countAssets(body) });
  }
  return { items };
}
/* 导入后的核对报告：告诉用户实际收了多少页 / 图 / 文字，有没有东西没进去 */
function importReport(items, dupCount, badFiles) {
  let pages = 0, img = 0, txt = 0, damaged = 0, lost = 0;
  const detail = [];
  items.forEach(it => {
    const c = countAssets(it.journal);
    pages += c.pages; img += c.img; txt += c.txt;
    if (it.ok === false) damaged++;
    const s = it.src;
    if (s.pages !== c.pages || s.img !== c.img || s.txt !== c.txt) {
      lost += Math.max(0, s.img - c.img) + Math.max(0, s.txt - c.txt);
      detail.push(`《${it.journal.name}》 文件里 ${s.pages}页/${s.img}图/${s.txt}段 → 实际存入 ${c.pages}页/${c.img}图/${c.txt}段`);
    }
  });
  let msg = items.length > 1
    ? `已导入 ${items.length} 本 · ${pages} 页 · ${img} 图 · ${txt} 段文字`
    : `已导入《${items[0].journal.name}》· ${pages} 页 · ${img} 图 · ${txt} 段文字`;
  /* 加密本在文件里是密文：0 图 0 文字是「还没解锁」，不是内容丢了，跟用户说清楚 */
  const encN = items.filter(it => lockIsSealed(it.journal)).length;
  if (encN) msg += `（含 ${encN} 本加密手帐，首次打开需输入密钥）`;
  const warn = [];
  if (damaged) warn.push(`${damaged} 本校验未通过，文件可能已损坏`);
  if (lost) warn.push(`有 ${lost} 项内容无法识别，已跳过`);
  if (dupCount) warn.push(`跳过 ${dupCount} 本内容重复的`);
  if (badFiles) warn.push(`有 ${badFiles} 个文件没能识别`);
  if (warn.length) {
    if (detail.length) console.warn('[import] 对账明细：\n' + detail.join('\n'));
    toast(msg + '（' + warn.join('；') + '）', 4200);
  } else {
    const verified = items.filter(it => it.ok === true).length;
    toast(msg + (verified === items.length ? ' · 校验通过' : ''), 3000);
  }
}
/* 导入：按内容摘要查重 → 收进书架 → 出核对报告 */
async function importJournals(items, badFiles) {
  if (!items || !items.length) {
    toast(badFiles ? '没能识别这个文件，请选择本应用导出的 .json 手帐本' : '文件是空的', 2800);
    return;
  }
  const fps = new Set();
  for (const j of state.journals) fps.add(await journalFP(j));
  const accept = [], dup = [];
  for (const it of items) {
    const fp = await journalFP(it.journal);
    if (fps.has(fp)) { dup.push(it); continue; }
    fps.add(fp); accept.push(it);
  }
  const commit = list => {
    const at = state.journals.length;
    list.forEach(it => state.journals.push(it.journal));
    state.sel = at;
    save(); renderHome();
    /* 源文件里自带的自定义内页模板也收进全局模板库：
       换设备导入之后，下次新建 / 编辑别的手帐本也能接着用这些图 */
    const srcs = [];
    list.forEach(it => {
      const j = it.journal;
      if (!j) return;
      if (Array.isArray(j.tplImgs)) srcs.push(...j.tplImgs);
      if (j.tplImg) srcs.push(j.tplImg);
    });
    mergeTplLib(srcs.filter(Boolean));
    importReport(list, dup.length, badFiles || 0);
  };
  /* 全是重复：问一句要不要仍旧存一份（默认＝跳过） */
  if (dup.length && !accept.length) {
    const nm = dup.slice(0, 2).map(d => `《${d.journal.name}》`).join('、');
    askConfirm(`${nm}${dup.length > 2 ? ` 等 ${dup.length} 本` : ''}的内容和书架里已有的一本完全相同，确定还要再存一份吗？`, {
      title: '重复的手帐本', ok: '仍然导入', onOk: () => commit(items)
    });
    return;
  }
  commit(accept);
}
/* 读文本：老浏览器没有 Blob.text() 时退回 FileReader。
   也收已经读好的字符串（移动端先把 File 读成文本再移除 input，见下）。 */
function readFileText(f) {
  if (typeof f === 'string') return Promise.resolve(f);
  if (f && f.text) return f.text();
  return new Promise(res => {
    const r = new FileReader();
    r.onload = () => res(String(r.result || ''));
    r.onerror = () => res('');
    r.readAsText(f);
  });
}
/* 选文件：支持一次选多个 .json。
   ⚠️ 临时 input 别用 display:none（移动端拒绝程序化 click），且必须先把文件内容
      全部读进内存再 remove()：iOS / 安卓 WebView 移除 input 后 File 会失效。 */
function pickImportFile() {
  const inp = document.createElement('input');
  inp.type = 'file'; inp.accept = '.json,application/json,text/plain'; inp.multiple = true;
  inp.className = 'file-input';
  document.body.appendChild(inp);
  inp.onchange = async () => {
    const files = [...(inp.files || [])];
    const texts = await Promise.all(files.map(readFileText));
    inp.remove();
    if (!texts.length) return;
    let items = [], bad = 0;
    for (let i = 0; i < texts.length; i++) {
      try {
        const r = await readJournals(texts[i]);
        if (r.items.length) items.push(...r.items); else bad++;
      } catch (e) { console.warn('[import] 读取失败：' + (files[i] && files[i].name), e); bad++; }
    }
    try { await importJournals(items, bad); }
    catch (e) { console.error('[import] 失败：', e); toast('导入失败：' + ((e && e.message) || e), 4200); }
  };
  inp.click();
}
