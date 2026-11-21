/* =====================================================================
 * Carnet · 多语言运行时（脚本 00 / 29）
 * ---------------------------------------------------------------------
 * 词条统一放在 i18n-data.js（原文 + 六种译文），这里只负责：
 *   ① 读取 / 保存语言偏好（carnet_lang）
 *   ② 把界面里的中文文本与属性换成当前语言
 *   ③ 监听后续动态插入的节点（toast、重绘的列表、弹窗……）
 *
 * 用户内容永不翻译：阅读器的书页（#stage）、书名（#homeName / #mcName /
 * #rName / 搜索结果标题）以及输入框 / 内容可编辑区都会跳过。
 * ===================================================================== */
(function () {
  'use strict';

  const DICT = window.CARNET_I18N_DATA || {};
  const STORE_KEY = 'carnet_lang';
  const LANGS = ['zhCN', 'zhTW', 'en', 'ja', 'fr', 'es'];
  const HTML_LANG = { zhCN: 'zh-CN', zhTW: 'zh-Hant', en: 'en', ja: 'ja', fr: 'fr', es: 'es' };
  const LANG_LABELS = {
    zhCN: '简体中文', zhTW: '繁體中文', en: 'English',
    ja: '日本語', fr: 'Français', es: 'Español'
  };
  const ATTRS = ['title', 'aria-label', 'placeholder', 'alt'];
  const $ = sel => document.querySelector(sel);
  const $$ = sel => Array.prototype.slice.call(document.querySelectorAll(sel));

  /* 用户数据 / 代码节点：这些子树里的文本一律不碰 */
  const SKIP_TEXT = 'script,style,noscript,input,textarea,select,option,[contenteditable],[data-i18n-skip],#stage,.stage,#homeName,#mcName,#rName,.sr-item .nm';
  /* 属性可以翻译（开关 / 输入框的 aria-label、placeholder 都要翻），只躲开真正的用户数据区 */
  const SKIP_ATTR = 'script,style,noscript,[data-i18n-skip],#stage,.stage,.sr-item';
  /* 书名藏在 title / aria-label 里：这几类节点只接受「整条命中词条」的翻译 */
  const OWNER_WITH_NAME = '.book-item,.spine-item';

  let lang = readLang();
  let cache = new Map();
  let textRecords = [];
  let attrRecords = [];
  let touchedText = new WeakSet();
  let touchedAttr = new WeakMap();
  let applying = false;
  let scheduled = false;

  function readLang() {
    try {
      const v = localStorage.getItem(STORE_KEY);
      return LANGS.indexOf(v) >= 0 ? v : 'zhCN';
    } catch (_) { return 'zhCN'; }
  }
  function writeLang(v) {
    try { localStorage.setItem(STORE_KEY, v); } catch (_) {}
  }
  const hasHan = s => /[\u3400-\u9fff]/.test(s);

  /* ---- 词条索引：精确 / 带占位符 / 短语兜底 --------------------------- */
  let exact = DICT;
  let patterns = [];
  let phrases = [];

  function escRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
  function buildIndex() {
    patterns = []; phrases = [];
    Object.keys(DICT).forEach(key => {
      if (/\{\d+\}/.test(key)) {
        const re = '^' + escRe(key).replace(/\\\{\d+\\\}/g, () => '([\\s\\S]*?)') + '$';
        patterns.push({ re: new RegExp(re), trans: DICT[key], key });
      } else if (hasHan(key) && key.indexOf('<') < 0) {
        phrases.push({ key, trans: DICT[key] });
      }
    });
    patterns.sort((a, b) => b.key.length - a.key.length);
    phrases.sort((a, b) => b.key.length - a.key.length);
  }
  buildIndex();

  function fill(tpl, groups) {
    /* 占位符里有时还是一句界面词（例如「10 页 · 双页」里的「双页」），整条命中就翻；
       看起来像用户内容的原样保留，绝不做模糊替换 */
    const vals = groups.map(g => {
      const hit = exact[g];
      return hit && hit[lang] ? hit[lang] : g;
    });
    return tpl.replace(/\{(\d+)\}/g, (m, i) => (vals[+i] !== undefined ? vals[+i] : m));
  }

  function rawTranslate(s) {
    if (lang === 'zhCN' || !s || !hasHan(s)) return s;
    const exactHit = exact[s];
    if (exactHit) return exactHit[lang] || s;

    for (let i = 0; i < patterns.length; i++) {
      const m = patterns[i].re.exec(s);
      if (m) return fill(patterns[i].trans[lang] || s, m.slice(1));
    }

    /* 兜底：整段 HTML 模板已经被浏览器拆成文本节点，这里只处理纯文本片段 */
    let out = s;
    for (let i = 0; i < phrases.length; i++) {
      const p = phrases[i];
      if (out.indexOf(p.key) < 0) continue;
      const v = p.trans[lang];
      if (v && v !== p.key) out = out.split(p.key).join(v);
    }
    return out;
  }

  function t(s) {
    if (typeof s !== 'string') return s;
    if (lang === 'zhCN') return s;
    if (cache.has(s)) return cache.get(s);
    const v = rawTranslate(s);
    cache.set(s, v);
    return v;
  }

  /* ---- DOM 应用 ------------------------------------------------------- */
  function skippedText(el) {
    if (!el || typeof el.closest !== 'function') return true;
    return !!el.closest(SKIP_TEXT);
  }
  function skippedAttr(el) {
    if (!el || typeof el.closest !== 'function') return true;
    return !!el.closest(SKIP_ATTR);
  }

  function applyText(node) {
    if (!node || node.nodeType !== 3 || touchedText.has(node)) return false;
    if (!hasHan(node.nodeValue)) return false;
    if (skippedText(node.parentElement)) return false;
    const before = node.nodeValue;
    const after = t(before);
    if (after === before) return false;
    textRecords.push({ node, value: before });
    touchedText.add(node);
    applying = true;
    node.nodeValue = after;
    applying = false;
    return true;
  }

  function applyAttr(el, name) {
    if (!el || el.nodeType !== 1 || ATTRS.indexOf(name) < 0) return false;
    if (skippedAttr(el)) return false;
    let set = touchedAttr.get(el);
    if (set && set.has(name)) return false;
    const before = el.getAttribute(name);
    if (!before || !hasHan(before)) return false;
    /* 书卡上有用户书名：只认整条词条，绝不做短语替换，避免把书名里的字改掉 */
    const strict = !!el.closest(OWNER_WITH_NAME);
    const after = strict ? (exact[before] && exact[before][lang]) || before : t(before);
    if (after === before) return false;
    attrRecords.push({ el, name, value: before });
    if (!set) { set = new Set(); touchedAttr.set(el, set); }
    set.add(name);
    applying = true;
    el.setAttribute(name, after);
    applying = false;
    return true;
  }

  function applyElement(root) {
    if (!root || root.nodeType !== 1) return;
    /* 属性和文本都要覆盖整棵子树：title / aria-label / placeholder 大多挂在后代节点上 */
    ATTRS.forEach(n => applyAttr(root, n));
    const els = [];
    const ew = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, null);
    let e;
    while ((e = ew.nextNode())) els.push(e);
    els.forEach(el => ATTRS.forEach(n => applyAttr(el, n)));
    if (skippedText(root)) return;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
    const nodes = [];
    let n;
    while ((n = walker.nextNode())) nodes.push(n);
    nodes.forEach(applyText);
  }

  function apply(root) {
    const target = root && root.nodeType ? root : document.body;
    if (target.nodeType === 3) applyText(target);
    else applyElement(target);
  }

  function restore() {
    textRecords.forEach(r => { try { r.node.nodeValue = r.value; } catch (_) {} });
    attrRecords.forEach(r => { try { r.el.setAttribute(r.name, r.value); } catch (_) {} });
    textRecords = []; attrRecords = [];
  }

  function set(next) {
    if (LANGS.indexOf(next) < 0) return;
    if (next === lang) { syncControls(); return; }
    restoringOrApplying = true;
    restore();
    touchedText = new WeakSet();
    touchedAttr = new WeakMap();
    lang = next;
    cache = new Map();
    writeLang(lang);
    document.documentElement.setAttribute('lang', HTML_LANG[lang] || 'zh-CN');
    syncControls();
    apply(document.body);
    restoringOrApplying = false;
    try { window.dispatchEvent(new CustomEvent('carnet-lang-change', { detail: { lang } })); } catch (_) {}
  }
  let restoringOrApplying = false;

  function syncControls() {
    const val = $('#mnLangVal');
    if (val) val.textContent = LANG_LABELS[lang] || lang;
    $$('.lp-opt').forEach(b => b.classList.toggle('on', b.dataset.lang === lang));
  }

  /* ---- 语言弹窗：入口行 → Morph 展开卡片 → 选项直接换语言 ---------------- */
  function langPopOpen() {
    const p = $('#langPop');
    return !!p && p.classList.contains('show');
  }
  function closeLangPop() {
    const p = $('#langPop');
    if (!p || !langPopOpen()) return;
    const M = window.CarnetMotion;
    if (M && typeof M.morphClose === 'function') M.morphClose(p);
    p.classList.remove('show');
    const btn = $('#mnLangBtn');
    if (btn) btn.setAttribute('aria-expanded', 'false');
  }
  function placeLangPop(p, x, br) {
    /* 横向对齐真正的点击点（不再固定到按钮左缘）；纵向贴在整行下方，不够再翻上方。 */
    const r = p.getBoundingClientRect();
    const gap = 8, pad = 8;
    const maxLeft = Math.max(pad, window.innerWidth - r.width - pad);
    const maxTop = Math.max(pad, window.innerHeight - r.height - pad);
    let top = br.bottom + gap;
    if (top + r.height > window.innerHeight - pad) top = br.top - r.height - gap;
    p.style.left = Math.max(pad, Math.min(x, maxLeft)) + 'px';
    p.style.top = Math.max(pad, Math.min(top, maxTop)) + 'px';
  }
  function openLangPop(e) {
    const p = $('#langPop'), btn = $('#mnLangBtn');
    if (!p || !btn) return;
    const M = window.CarnetMotion;
    const br = btn.getBoundingClientRect();
    /* 点击点优先；键盘 / 程序触发时退回按钮中心。 */
    const x = e && Number.isFinite(e.clientX) && e.clientX > 0 ? e.clientX : br.left + br.width / 2;
    const y = e && Number.isFinite(e.clientY) && e.clientY > 0 ? e.clientY : br.top + br.height / 2;
    p.classList.add('show');              /* 先显示才量得到最终尺寸 */
    placeLangPop(p, x, br);               /* 落点 = 点击的那一点，不居中也不固定左侧 */
    /* Morph 也从点击的那一点冒出玻璃珠（同 #paperMenu），层级压过 #homeMenu（135）。 */
    if (M && typeof M.morphOpen === 'function') M.morphOpen(p, { x, y, layerZ: 145 });
    btn.setAttribute('aria-expanded', 'true');
    syncControls();
  }
  function bindPicker() {
    const btn = $('#mnLangBtn'), pop = $('#langPop');
    if (!btn || !pop || btn.dataset.i18nBound) return;
    btn.dataset.i18nBound = '1';
    btn.addEventListener('click', e => {
      e.stopPropagation();
      if (langPopOpen()) closeLangPop(); else openLangPop(e);
    });
    $$('#langPop .lp-opt').forEach(b => b.addEventListener('click', e => {
      e.stopPropagation();
      set(b.dataset.lang);
      closeLangPop();
    }));
    /* 点弹窗外 / Esc 收起；捕获阶段先跑，不让主页菜单那套把事件吞掉 */
    document.addEventListener('pointerdown', e => {
      if (!langPopOpen()) return;
      if (e.target.closest('#langPop') || e.target.closest('#mnLangBtn')) return;
      closeLangPop();
    }, true);
    window.addEventListener('keydown', e => {
      if (e.key !== 'Escape' || !langPopOpen()) return;
      closeLangPop();
      e.preventDefault();
      e.stopImmediatePropagation();
    }, true);
    syncControls();
  }

  function observe() {
    if (!window.MutationObserver) return;
    const mo = new MutationObserver(muts => {
      if (restoringOrApplying) return;
      let hit = false;
      muts.forEach(m => {
        if (m.type === 'childList') {
          m.addedNodes.forEach(n => {
            if (n.nodeType === 3) hit = applyText(n) || hit;
            else if (n.nodeType === 1) { applyElement(n); hit = true; }
          });
        } else if (m.type === 'characterData') {
          hit = applyText(m.target) || hit;
        } else if (m.type === 'attributes') {
          hit = applyAttr(m.target, m.attributeName) || hit;
        }
      });
    });
    mo.observe(document.documentElement, {
      subtree: true, childList: true, characterData: true, attributeFilter: ATTRS
    });
  }

  function init() {
    document.documentElement.setAttribute('lang', HTML_LANG[lang] || 'zh-CN');
    bindPicker();
    apply(document.body);
    observe();
    /* 菜单页后来被补建 / 入口被换掉时再绑一次 */
    document.addEventListener('carnet-menu-ready', bindPicker);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  window.CarnetI18n = {
    t, set, apply,
    get lang() { return lang; },
    get langs() { return LANGS.slice(); },
    get labels() { return Object.assign({}, LANG_LABELS); }
  };
})();
