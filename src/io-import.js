/* =====================================================================
 * Carnet · 导入 · 校验与查重   （脚本 7 / 23）
 * ---------------------------------------------------------------------
 * ① normalizeJournal：补全缺省字段，保留未知字段，导出→导入不丢东西
 * ② readJournals：兼容单本/裸对象/多本数组三种写法，带 checksum 校验
 * ③ importJournals：按内容摘要查重后收进书架，并出核对报告
 *
 * 依赖模块：core, storage, io-export
 *
 * 说明：模块间共用全局作用域，按下面的顺序加载，顺序即依赖顺序。
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
      img: (typeof cv.img === 'string' && cv.img) ? cv.img : null
    },
    ribbon: /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(String(j.ribbon || '')) ? j.ribbon : '#c98a8a',
    /* 已下线的「日历」模板映射到现在的空白牛皮纸，导入老文件时页面不丢 */
    template: j.template === 'calendar' ? 'kraftplain'
      : (TEMPLATES.some(t => t.k === j.template) ? j.template : 'blank'),
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
/* 读文本：老浏览器没有 Blob.text() 时退回 FileReader */
function readFileText(f) {
  if (f && f.text) return f.text();
  return new Promise(res => {
    const r = new FileReader();
    r.onload = () => res(String(r.result || ''));
    r.onerror = () => res('');
    r.readAsText(f);
  });
}
/* 选文件：支持一次选多个 .json */
function pickImportFile() {
  const inp = document.createElement('input');
  inp.type = 'file'; inp.accept = '.json,application/json,text/plain'; inp.multiple = true;
  inp.style.display = 'none';
  document.body.appendChild(inp);
  inp.onchange = async () => {
    const files = [...(inp.files || [])];
    inp.remove();
    if (!files.length) return;
    let items = [], bad = 0;
    for (const f of files) {
      try {
        const r = await readJournals(await readFileText(f));
        if (r.items.length) items.push(...r.items); else bad++;
      } catch (e) { console.warn('[import] 读取失败：' + f.name, e); bad++; }
    }
    try { await importJournals(items, bad); }
    catch (e) { console.error('[import] 失败：', e); toast('导入失败：' + ((e && e.message) || e), 4200); }
  };
  inp.click();
}
