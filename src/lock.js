/* =====================================================================
 * Carnet · 手帐本加密 · 密钥 / 密文信封 / 解锁与密钥管理   （脚本 4 / 28）
 * ---------------------------------------------------------------------
 * ① 纯 JS MD5（UTF-8）：保密问题的答案 → 32 位小写 hex，作为密钥材料
 * ② WebCrypto：PBKDF2-SHA256（12 万次，随机 salt）把密钥材料派生成 AES-GCM 256 密钥
 * ③ 「信封」：整本手帐的内容（文字 / 图片 / 封面图 / 模板图 / DIY 草稿…）一次加密，
 *    外壳只留书名、封面配色图案、装帧、页数这些**书架要用来认书**的明文元数据
 * ④ 本机钥匙缓存 carnet_lock_keys_v1：解锁一次后这台设备自动解密，磁盘与导出文件始终是密文；
 *    「立即上锁」把它忘掉，重新变回需要输密钥
 * ⑤ 解锁 / 设置 / 换密钥 / 取消加密 / 上锁的弹窗与守卫
 *
 * 对外接口：journalHasLock, lockIsSealed, lockNeedsKey, lockKeyMaterial, loadLockKeys,
 *           rememberKey, forgetKey, dropLockKeys, persistJournals, exportJournalBody,
 *           guardUnlocked, autoUnlockQuiet, openUnlockPanel, openLockPanel,
 *           closeLockPanel, sealJournal
 *
 * 依赖模块：core, visuals, storage（前置）；io-export / io-import / state / home-view /
 *           home-events / editor / reader-flow / system 只在运行时函数体里用
 *
 * 说明：模块间共用全局作用域，加载顺序即依赖顺序（见 index.html 与 README）。
 *       ⚠️ 顶层不许引用后面文件里的 const（state / EXPORT_TAG 等会触发 TDZ），
 *          所有跨模块调用一律写在函数体里。
 * ===================================================================== */
/* ==================== 常量 ==================== */
const LOCK_KEYS_KEY = 'carnet_lock_keys_v1';
const LOCK_V = 1;
const LOCK_CHECK_TEXT = 'carnet-lock-check-v1';   // 用密钥加密这一句，解开＝密钥正确
const LOCK_PBKDF2_ITER = 120000;
const LOCK_MODES = {
  question: { n: '保密问题', tip: '答案会先取 MD5，再派生出加密密钥' },
  password: { n: '直接输密码', tip: '密码本身作为密钥材料，再派生出加密密钥' }
};

/* ==================== MD5（纯 JS，UTF-8）====================
   WebCrypto 不提供 MD5，而需求明确「保密问题答案的 MD5 码作为密钥」。
   这里只做一件事：把字符串按 UTF-8 编码后算出标准 RFC 1321 的 32 位小写 hex。
   中文答案也按字节算，跟任何语言里的 md5(utf8(s)) 完全一致。 */
function md5Hex(str) {
  const msg = new TextEncoder().encode(String(str));
  const len = msg.length;
  const buf = new Uint8Array((((len + 8) >> 6) + 1) * 64);
  buf.set(msg);
  buf[len] = 0x80;
  const dv = new DataView(buf.buffer);
  const bits = len * 8;
  dv.setUint32(buf.length - 8, bits >>> 0, true);
  dv.setUint32(buf.length - 4, Math.floor(bits / 0x100000000), true);
  const S = [7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
             5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
             4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
             6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21];
  const K = new Uint32Array(64);
  for (let i = 0; i < 64; i++) K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296) >>> 0;
  const rotl = (x, s) => ((x << s) | (x >>> (32 - s))) >>> 0;
  let a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476;
  const M = new Uint32Array(16);
  for (let off = 0; off < buf.length; off += 64) {
    for (let i = 0; i < 16; i++) M[i] = dv.getUint32(off + i * 4, true);
    let A = a0, B = b0, C = c0, D = d0;
    for (let i = 0; i < 64; i++) {
      let F, g;
      if (i < 16) { F = (B & C) | (~B & D); g = i; }
      else if (i < 32) { F = (D & B) | (~D & C); g = (5 * i + 1) % 16; }
      else if (i < 48) { F = B ^ C ^ D; g = (3 * i + 5) % 16; }
      else { F = C ^ (B | ~D); g = (7 * i) % 16; }
      F = (F + A + K[i] + M[g]) >>> 0;
      A = D; D = C; C = B; B = (B + rotl(F, S[i])) >>> 0;
    }
    a0 = (a0 + A) >>> 0; b0 = (b0 + B) >>> 0; c0 = (c0 + C) >>> 0; d0 = (d0 + D) >>> 0;
  }
  const out = new Uint8Array(16), ov = new DataView(out.buffer);
  ov.setUint32(0, a0, true); ov.setUint32(4, b0, true);
  ov.setUint32(8, c0, true); ov.setUint32(12, d0, true);
  return [...out].map(b => b.toString(16).padStart(2, '0')).join('');
}

/* ==================== 字节小工具 ==================== */
function lkCryptoOK() {
  return !!(window.crypto && crypto.subtle && crypto.subtle.encrypt
    && crypto.subtle.deriveKey && crypto.getRandomValues);
}
function lkRand(n) { const b = new Uint8Array(n); crypto.getRandomValues(b); return b; }
function lkHex(b) { return [...b].map(x => x.toString(16).padStart(2, '0')).join(''); }
function lkFromHex(s) {
  const t = String(s || ''), b = new Uint8Array(Math.floor(t.length / 2));
  for (let i = 0; i < b.length; i++) b[i] = parseInt(t.substr(i * 2, 2), 16) || 0;
  return b;
}
function lkB64(buf) {
  const b = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000));
  return btoa(s);
}
function lkUnB64(s) {
  const bin = atob(String(s || '')), b = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) b[i] = bin.charCodeAt(i);
  return b;
}
/* 密钥材料：保密问题 = MD5(答案)；直接输密码 = 密码原文。
   ⚠️ 答案去掉首尾空格（打字最容易多按一下），但大小写照旧、区分大小写；
      密码一个字符都不动。两者之后都还要过 PBKDF2，MD5 / 密码都不是最终的 AES 密钥。 */
function lockKeyMaterial(mode, spec) {
  const s = spec || {};
  if (mode === 'question') return md5Hex(String(s.answer == null ? '' : s.answer).trim());
  return String(s.password == null ? '' : s.password);
}
/* 表单校验：返回错误文案，空串＝通过 */
function lockSpecError(mode, spec) {
  const s = spec || {};
  if (mode === 'question') {
    if (!String(s.q || '').trim()) return '请填写一个自定义的保密问题';
    if (!String(s.answer || '').trim()) return '请填写答案';
    if (s.answer !== s.answer2) return '两次填写的答案不一致';
  } else {
    if (String(s.password || '').length < 4) return '密码至少 4 个字符';
    if (s.password !== s.password2) return '两次输入的密码不一致';
  }
  return '';
}

/* ==================== WebCrypto 封装 ==================== */
async function lkDerive(km, saltBytes) {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(km), 'PBKDF2', false, ['deriveKey']);
  /* extractable=true：本机「记住密钥」时把派生结果导成 raw AES 密钥存起来，
     这样缓存里没有密码原文，下次自动解锁也不用再跑 12 万次 PBKDF2。 */
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: saltBytes, iterations: LOCK_PBKDF2_ITER, hash: 'SHA-256' },
    base, { name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
}
/* km 有两种形态：用户输入派生出来的「密钥材料」，或缓存里以 rk: 开头的 raw AES 密钥。
   所有加密 / 解密入口都走这里，调用方不必关心手上拿的是哪一种。 */
function lkKeyFor(km, lock) {
  if (String(km).startsWith('rk:'))
    return crypto.subtle.importKey('raw', lkUnB64(km.slice(3)), { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
  return lkDerive(km, lkFromHex(lock.salt));
}
async function lkRawOf(km, lock) {
  const key = await lkKeyFor(km, lock);
  return 'rk:' + lkB64(await crypto.subtle.exportKey('raw', key));
}
async function lkEncrypt(key, str) {
  const iv = lkRand(12);
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(str));
  return { iv: lkB64(iv), data: lkB64(ct) };
}
async function lkDecrypt(key, env) {
  const pt = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: lkUnB64(env.iv) }, key, lkUnB64(env.data));
  return new TextDecoder().decode(pt);
}
/* 只拿 lock 就能验密钥对不对（不用碰内容密文） */
async function verifyLockKey(lock, km) {
  try {
    if (!lock || !lock.salt || !lock.check) return false;
    const key = await lkKeyFor(km, lock);
    return (await lkDecrypt(key, lock.check)) === LOCK_CHECK_TEXT;
  } catch (e) { return false; }
}

/* ==================== 信封：seal / unseal ====================
   明文 j  ↔  信封 { 明文元数据外壳, lock, enc }。
   · enc.data = AES-GCM(JSON.stringify(去掉 lock/enc 的整本手帐))，一次加密覆盖全部内容；
   · 外壳只留书架要用的：书名 / 封面配色图案 / 装帧 / 彩带 / 模板 / 页数空壳。
     照片封面 cover.img、封面草稿 diym、封面内侧图片、tplImg / tplImgs 都不进外壳，
     一并卷进密文里 —— 锁着的书在书架上就是一张纯色 / 图案封面。
   · pages 留一组空对象只为保持页数（书脊厚度、页数角标、normalizeJournal 的结构校验）。 */
function journalHasLock(j) { return !!(j && j.lock && j.lock.v); }
function lockIsSealed(j) { return !!(j && j.enc && j.enc.data && journalHasLock(j)); }
function lkPayload(j) {
  const p = { ...j };
  delete p.lock; delete p.enc;
  return p;
}
function lkShell(j, lock, enc) {
  const cv = j.cover || {};
  const ins = (cv.inside && typeof cv.inside === 'object')
    ? { mode: cv.inside.mode, color: cv.inside.color, pick: cv.inside.pick } : undefined;
  return {
    id: j.id, name: j.name, created: j.created,
    style: j.style, ribbon: j.ribbon, template: j.template, tplFit: j.tplFit, pageBg: j.pageBg,
    /* ⚠️ 这里只挑外观字段，绝不能写 ...cv —— 会把 cover.img / diym / inside.img 一起带出来 */
    cover: {
      type: cv.type, value: cv.value, pattern: cv.pattern, patColor: cv.patColor,
      texture: cv.texture, radius: cv.radius, groove: cv.groove, inside: ins
    },
    pages: (Array.isArray(j.pages) ? j.pages : []).map(() => ({})),
    lock, enc
  };
}
/* 实时内容摘要（不含 lock / enc）：既是导入查重用的 lock.fp，也是密封缓存的失效判据。
   ⚠️ 不能拿 journalFP 来判缓存 —— 加密本的 journalFP 直接返回 lock.fp，内容改了它也不变。 */
async function lockContentFP(j) {
  return checksum(stableStringify({
    name: j.name, cover: j.cover, ribbon: j.ribbon, template: j.template,
    tplImg: j.tplImg, tplImgs: j.tplImgs, tplFit: j.tplFit, pages: j.pages
  }));
}
/* 生成一份新的 lock 配置（换盐、重算校验串与内容指纹），返回密钥材料供本机记住 */
async function makeLock(j, mode, spec) {
  const salt = lkRand(16);
  const km = lockKeyMaterial(mode, spec);
  const key = await lkDerive(km, salt);
  const lock = {
    v: LOCK_V, mode: (mode === 'question' ? 'question' : 'password'),
    salt: lkHex(salt),
    check: await lkEncrypt(key, LOCK_CHECK_TEXT),
    fp: await lockContentFP(j)
  };
  if (lock.mode === 'question') lock.q = String(spec.q || '').trim().slice(0, 120);
  return { lock, km };
}
async function sealJournal(j, km) {
  if (lockIsSealed(j)) return j;                  // 已经是信封，别把空壳再封一遍
  const key = await lkKeyFor(km, j.lock);
  const enc = await lkEncrypt(key, JSON.stringify(lkPayload(j)));
  return lkShell(j, j.lock, enc);
}
async function unsealJournal(env, km) {
  const key = await lkKeyFor(km, env.lock);
  const plain = JSON.parse(await lkDecrypt(key, env.enc));
  /* 导入时 normalizeJournal 会给信封换个新 id，密文里存的还是导出那台的旧 id。
     不解开封就把 id 跟过来，同一份文件导两次会得到两本 id 一样的手帐。 */
  plain.id = env.id;
  return { ...plain, lock: env.lock };           // 内容回原样，只把锁的配置带回来
}
/* 按 id 拿回 state 里当前那一本（解锁会替换对象，旧引用会失效） */
function lkById(id) {
  return state.journals.find(x => x && x.id === id) || cur();
}

/* ==================== 本机钥匙缓存 ====================
   ⚠️ 单独一个键、绝不与手帐数据混在一起，因此导出文件里永远不带密钥。
      存的是「派生后的 raw AES 密钥」（rk: 前缀），不是密码原文、也不是答案 MD5：
      拿到本机存储复原不出用户设的密码；自动解锁还能跳过 12 万次 PBKDF2。
      老版本缓存里若还留着密钥材料（无 rk: 前缀）也能正常用，lkKeyFor 会自动走派生。
      这台设备解锁过一次就一直认得；清掉＝下次打开要重新输入。 */
let lockKeys = {};
const lkSealCache = new Map();      // id -> { salt, fp, shell }：内容没变就不重复加密整本
async function loadLockKeys() {
  const v = await DB.get(LOCK_KEYS_KEY);
  lockKeys = (v && typeof v === 'object' && !Array.isArray(v)) ? v : {};
  return lockKeys;
}
async function rememberKey(id, km, lock) {
  if (!id) return;
  /* 缓存里只放**派生后的 AES 密钥**（rk: 前缀），不放密码原文 / 答案 MD5：
     拿到本机存储也复原不出用户设的密码，下次自动解锁还省掉 12 万次 PBKDF2。
     lock 允许省略（调用方刚把 j.lock 设好的场景），这时回 state 里按 id 取。 */
  let value = String(km);
  if (!value.startsWith('rk:')) {
    const cfg = lock || ((state.journals || []).find(x => x && x.id === id) || {}).lock;
    if (!cfg || !cfg.salt) throw new Error('找不到这本手帐的加密参数，无法在本机记住密钥');
    value = await lkRawOf(km, cfg);
  }
  lockKeys[id] = value;
  await DB.set(LOCK_KEYS_KEY, lockKeys);
}
async function forgetKey(id) {
  if (!id || !(id in lockKeys)) return;
  delete lockKeys[id];
  await DB.set(LOCK_KEYS_KEY, lockKeys);
}
/* 删本子时顺手把 orphan 钥匙清掉 */
async function dropLockKeys(ids) {
  let dirty = false;
  (ids || []).forEach(id => { if (id in lockKeys) { delete lockKeys[id]; dirty = true; } });
  if (dirty) await DB.set(LOCK_KEYS_KEY, lockKeys);
}
function lockRemembered(j) { return !!(j && j.id && lockKeys[j.id]); }
/* 书架上那枚 🔒 徽章的含义＝「打开这本还需要输密钥」。
   ⚠️ 不是「有加密配置」：本机记住钥匙后（刚设完密钥 / 解锁过 / 刷新后读回缓存）
      解锁是静默的，徽章就该消失；只有外部导入的密文、或点过「立即上锁」才重新显示。 */
function lockNeedsKey(j) { return journalHasLock(j) && !lockRemembered(j); }

/* 把一本「已解锁的明文加密本」封成信封给落盘 / 导出用（不动 state 里的明文对象）。
   同一次内容没变就复用上次那份信封，避免每敲一个字都把几 MB 的 base64 重新 AES 一遍。 */
async function lkEnvelope(j, km) {
  const fp = await lockContentFP(j);
  const hit = lkSealCache.get(j.id);
  if (hit && hit.salt === j.lock.salt && hit.fp === fp) return hit.shell;
  const shell = await sealJournal(j, km);
  lkSealCache.set(j.id, { salt: j.lock.salt, fp, shell });
  return shell;
}
/* save() 的落盘形态：磁盘上永远是密文 */
async function persistJournals(list) {
  const out = [];
  for (const j of list) {
    if (journalHasLock(j) && !lockIsSealed(j)) {
      const km = lockKeys[j.id];
      if (km) out.push(await lkEnvelope(j, km));
      else {
        /* 理论上是不可达状态（上锁时先封好才忘钥匙）。真出现了**绝不落盘明文**：
           直接让这一次 save 失败，磁盘上保留上一份密文，提示解锁后再改。 */
        throw new Error('《' + j.name + '》缺少本机密钥，已暂停保存以免明文落盘，请解锁一次');
      }
    } else out.push(j);
  }
  return out;
}
/* 源文件导出的 journal 字段：普通本原样、已加密本一律是信封（绝不导出明文） */
async function exportJournalBody(j) {
  if (!journalHasLock(j)) return j;
  if (lockIsSealed(j)) return j;
  const km = lockKeys[j.id];
  if (!km) throw new Error('这本手帐已加密但本机没有记住密钥，请先打开输入一次密钥再导出');
  return lkEnvelope(j, km);
}

/* ==================== 解锁守卫 ==================== */
/* 把 state.journals 里的信封换成明文对象；按 id 找，别依赖旧引用 */
function lkReplace(j, plain) {
  const arr = state.journals;
  const i = arr.findIndex(x => x && x.id === j.id);
  if (i >= 0) arr[i] = plain;
  return i;
}
async function tryUnlock(j, km, alreadyVerified) {
  if (!alreadyVerified && !await verifyLockKey(j.lock, km)) return false;
  let plain;
  try { plain = await unsealJournal(j, km); }
  catch (e) { console.warn('[lock] 解密失败：', e); return false; }
  lkReplace(j, plain);
  lkSealCache.delete(j.id);
  if (typeof renderHome === 'function') renderHome();
  return true;
}
/* 打开书 / 编辑 / 导出 PDF 前问一句。
   返回 true = 本来就可用，调用方继续；false = 已弹出解锁框，成功后由 done() 重来一次。
   ⚠️ 解锁后做什么完全由调用方的 done 决定，守卫不改道（第二十五轮定稿）：
     openReader → 打开手帐本；openEditor → 打开「编辑手帐本」弹窗（未解锁输密码时同样进编辑窗）；
     导出 PDF / SVG、管理密钥面板 → 继续原动作。
     两条会弹输入框的分支（没有本机钥匙直接弹框、自动解锁失败后回落弹框）都用同一个 done，
     静默解锁分支也是它 —— 这样「输密码 / 已记住钥匙」两条路的行为永远一致。
   ⚠️ 别在守卫里按「有没有弹过框」改落地动作：用户点的是哪个按钮才是意图，
      点封面就该开书、点编辑按钮就该开编辑窗，与是否需要输密码无关。
   ⚠️ done 里别再用旧的 j 引用（state.journals 已被替换成新对象），一律重新 cur()。 */
function guardUnlocked(j, done) {
  if (!j || !journalHasLock(j) || !lockIsSealed(j)) return true;
  if (!lkCryptoOK()) { toast('当前环境不支持解密，请用 http/https 打开本应用', 4200); return false; }
  const km = lockKeys[j.id];
  if (km) {
    (async () => {
      const ok = await tryUnlock(j, km);
      if (ok) { done && done(); return; }
      await forgetKey(j.id);                    // 换过密钥 / 缓存串了，别再拿旧钥匙反复试
      if (typeof renderHome === 'function') renderHome();   // 钥匙没了，徽章要回来
      openUnlockPanel(state.journals.find(x => x && x.id === j.id) || j, done);
    })();
    return false;
  }
  openUnlockPanel(j, done);
  return false;
}
/* 批量导出时用：只用本机记住的钥匙静默解锁，绝不弹窗打断循环 */
async function autoUnlockQuiet(j) {
  if (!j || !journalHasLock(j) || !lockIsSealed(j)) return true;
  const km = lockKeys[j.id];
  if (!km) return false;
  const ok = await tryUnlock(j, km);
  if (!ok) {
    await forgetKey(j.id);
    if (typeof renderHome === 'function') renderHome();     // 同上：忘掉钥匙后徽章要回来
  }
  return ok;
}

/* ==================== 弹窗：骨架与通用小工具 ==================== */
const LOCK_SVG = '<svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="4.5" y="10.5" width="15" height="10.5" rx="2.4"/><path d="M8 10.5V7.2a4 4 0 018 0v3.3"/><circle cx="12" cy="15.4" r="1.15" fill="currentColor" stroke="none"/></svg>';
/* 书架 / 书脊上的「待解锁」小徽章；home-view.js 按 lockNeedsKey() 拼进封面 HTML */
const LOCK_FLAG_HTML = '<span class="lock-flag" title="已加密，打开需输入密钥">' + LOCK_SVG + '</span>';
let lockPanelCb = null;      // 解锁成功后要重跑的动作
let lkKbTimer = null;        // 触屏软键盘顶起面板的延时器
function lockPanelOpen() { $('#lockMask').classList.add('show'); }
function closeLockPanel() {
  clearTimeout(lkKbTimer); lkKbTimer = null;
  $('#lockMask').classList.remove('show');
  $('#lockMask').classList.remove('kb');
  lockPanelCb = null;
}
function lockPanelShell(title, sub, body, foot) {
  $('#lockTitle').textContent = title;
  $('#lockSub').textContent = sub || '';
  $('#lockBody').innerHTML = body;
  $('#lockFoot').innerHTML = foot;
  lockPanelOpen();
  /* ⚠️ 别在这里给输入框绑 focus → .kb：旧版一打开就自动 focus 第一个输入框，
     focus 又在 180ms 后加 .kb 把面板从居中顶到上半屏，看上去就是「先居中、再往上移」；
     桌面没有软键盘也会跟着白跳一次。现在 .kb 由文件末的 focusin 委托统一管，
     只有触屏真点了输入框、键盘要弹出时才加，且加上后保持到关闭、中途不回落。
     桌面仍保留自动聚焦（不会触发 .kb），面板始终居中。 */
  const inps = $$('#lockBody input');
  const coarse = !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
  if (inps.length && !coarse)
    setTimeout(() => { try { inps[0].focus(); } catch (_) {} }, 80);
}
function lockErr(msg) {
  const e = $('#lkErr');
  if (e) e.textContent = msg || '';
  if (msg) { const i = $('#lockBody input'); if (i) { i.classList.add('bad'); setTimeout(() => i.classList.remove('bad'), 500); } }
}
function lockBusy(btn, on, text) {
  if (!btn) return;
  btn.disabled = !!on;
  if (on) { btn.dataset.txt = btn.textContent; btn.textContent = text || '处理中…'; }
  else if (btn.dataset.txt) { btn.textContent = btn.dataset.txt; delete btn.dataset.txt; }
}
/* 两档密钥的表单（设置 / 换密钥共用） */
function lockSpecHTML(mode) {
  const isQ = mode === 'question';
  return `<div class="lk-tabs" id="lkTabs">
      <button data-lkmode="question" class="${isQ ? 'on' : ''}">保密问题</button>
      <button data-lkmode="password" class="${isQ ? '' : 'on'}">直接输密码</button>
    </div>
    <div class="lk-fields" id="lkFields">${lockSpecFieldsHTML(mode)}</div>`;
}
function lockSpecFieldsHTML(mode) {
  if (mode === 'question') return `
    <label class="lk-lab">自定义保密问题</label>
    <input class="text-input" id="lkQ" maxlength="120" placeholder="例如：我第一只猫叫什么？" autocomplete="off">
    <label class="lk-lab">答案</label>
    <input class="text-input" id="lkA" type="password" placeholder="答案（区分大小写）" autocomplete="new-password">
    <label class="lk-lab">再输一次答案</label>
    <input class="text-input" id="lkA2" type="password" placeholder="确认答案" autocomplete="new-password">
    <p class="lk-note">答案的 MD5 码作为密钥材料，本机不保存答案本身。答错无法找回，请务必记牢。</p>`;
  return `
    <label class="lk-lab">密码</label>
    <input class="text-input" id="lkP" type="password" placeholder="至少 4 个字符" autocomplete="new-password">
    <label class="lk-lab">再输一次密码</label>
    <input class="text-input" id="lkP2" type="password" placeholder="确认密码" autocomplete="new-password">
    <p class="lk-note">密码作为密钥材料，经 PBKDF2 派生后加密内容。忘记密码无法找回，请务必记牢。</p>`;
}
function lockSpecRead(mode) {
  const v = s => ($(s) ? $(s).value : '');
  return mode === 'question'
    ? { q: v('#lkQ'), answer: v('#lkA'), answer2: v('#lkA2') }
    : { password: v('#lkP'), password2: v('#lkP2') };
}
/* 绑一次 tab 切换；重画 fields 后选中态跟着 mode 走 */
function lockBindSpecTabs(modeRef) {
  const tabs = $('#lkTabs');
  if (!tabs) return;
  tabs.onclick = e => {
    const b = e.target.closest('[data-lkmode]'); if (!b) return;
    modeRef.mode = b.dataset.lkmode;
    $$('#lkTabs button').forEach(x => x.classList.toggle('on', x === b));
    $('#lkFields').innerHTML = lockSpecFieldsHTML(modeRef.mode);
    const err = $('#lkErr'); if (err) err.textContent = '';
  };
}

/* ==================== 弹窗：解锁 ====================
   从外部第一次打开加密手帐（导入的文件 / 上锁之后）才出现；
   本机已记住钥匙时 guardUnlocked 会静默解开，根本不弹。 */
function openUnlockPanel(j, done) {
  if (!j || !lockIsSealed(j)) { done && done(); return; }
  lockPanelCb = done || null;
  const lock = j.lock, isQ = lock.mode === 'question';
  const q = isQ ? `<div class="lk-question">${esc(lock.q || '（未填写问题）')}</div>` : '';
  lockPanelShell(
    '这本手帐已加密',
    isQ ? '请回答下面这个保密问题' : '请输入加密时设置的密码',
    `<div class="lk-lockmark">${LOCK_SVG}</div>
     <div class="lk-book">${esc(j.name || '未命名手帐')}</div>
     ${q}
     <label class="lk-lab">${isQ ? '你的答案' : '密码'}</label>
     <input class="text-input" id="lkInput" type="password" placeholder="${isQ ? '输入答案' : '输入密码'}" autocomplete="current-password">
     <p class="lk-err" id="lkErr"></p>
     <p class="lk-note">${isQ
       ? '答案区分大小写，首尾空格会自动忽略；答案先取 MD5 再解密内容。'
       : '密码区分大小写，一个字符都不能差。'}解密成功后这台设备会记住密钥，之后打开不再询问。</p>`,
    `<button class="btn ghost" id="lkCancel">取消</button>
     <button class="btn primary" id="lkOk">解锁</button>`
  );
  $('#lkCancel').onclick = closeLockPanel;
  const submit = async () => {
    const v = $('#lkInput').value;
    if (!v) { lockErr('请先输入' + (isQ ? '答案' : '密码')); return; }
    const km = lockKeyMaterial(lock.mode, isQ ? { answer: v } : { password: v });
    const btn = $('#lkOk'); lockBusy(btn, true, '解密中…'); lockErr('');
    try {
      const ok = await tryUnlock(j, km);
      if (!ok) { lockErr('密钥不正确，请再试一次'); lockBusy(btn, false); return; }
      await rememberKey(j.id, km, j.lock);
      /* ⚠️ tryUnlock 里那次 renderHome 发生在「钥匙还没写进缓存」时，
         当时 lockNeedsKey() 仍为真、封面还挂着 🔒；记住钥匙后必须再重绘一次把徽章摘掉。 */
      if (typeof renderHome === 'function') renderHome();
      const cb = lockPanelCb;
      closeLockPanel();
      toast('已解锁《' + j.name + '》');
      if (cb) cb();
    } catch (e) {
      /* 解开了但没能把钥匙写进本机：把 state 还原成信封，
         否则内存里就是「有锁、无钥匙」的明文，下一次 save 会拒绝写盘。 */
      lkReplace(j, j);
      if (typeof renderHome === 'function') renderHome();
      console.error('[lock] 解锁失败：', e);
      lockErr('解密失败：' + ((e && e.message) || e));
      lockBusy(btn, false);
    }
  };
  $('#lkOk').onclick = submit;
  $('#lkInput').onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); submit(); } e.stopPropagation(); };
}

/* ==================== 弹窗：密钥管理 ==================== */
/* 唯一入口是编辑器「加密与密钥」小节里的「设置 / 管理密钥…」（主页菜单那一栏已移除）。
   面板必须作用于 state 里那一本，所以进面板前先把编辑器改动保存并关掉
   （见 editor.js 的 #edLockManage）。 */
function openLockPanel(j) {
  if (!j) { toast('还没有手帐本'); return; }
  lockPanelCb = null;
  /* 未解锁：先走解锁流程，回来再管密钥（换密钥 / 取消加密都要用旧密钥重新加密内容） */
  if (!guardUnlocked(j, () => openLockPanel(cur()))) return;
  if (!lkCryptoOK()) { toast('当前环境不支持加密（需要 https 或 localhost）', 4200); return; }
  const has = journalHasLock(j);
  const mode = has ? j.lock.mode : 'question';
  const modeName = has ? LOCK_MODES[mode].n : '';
  const qLine = has && mode === 'question' ? `<div class="lk-qsmall">保密问题：${esc(j.lock.q || '（未填写）')}</div>` : '';
  const stateHTML = has
    ? `<div class="lk-state on"><span class="lk-state-ico">${LOCK_SVG}</span>
         <div><b>已加密 · ${modeName}</b>${qLine}
         <small>${lockRemembered(j) ? '这台设备已记住密钥，打开时自动解密' : '这台设备未记住密钥，打开时需要输入'}</small></div></div>`
    : `<div class="lk-state"><span class="lk-state-ico">${LOCK_SVG}</span>
         <div><b>未加密</b><small>内容与导出的源文件都是明文</small></div></div>`;
  const ops = has
    ? `<button class="btn ghost" id="lkChange">更换密钥</button>
       <button class="btn ghost" id="lkRemove">取消加密</button>
       <button class="btn ghost" id="lkRelock" ${lockRemembered(j) ? '' : 'disabled'}>立即上锁</button>`
    : `<button class="btn primary" id="lkSetup">设置密钥并加密</button>`;
  lockPanelShell(
    '手帐本加密',
    '《' + j.name + '》',
    stateHTML + `<p class="lk-note lk-warn">加密后：本机与导出的 .json 里只存密文；正文文字、图片、照片封面、模板图全部由密钥保护。密钥不会写进导出文件，也没有找回通道。解锁后可导出 PDF / SVG，但那两种是未加密的明文副本，请自行保管。</p>`,
    `<button class="btn ghost" id="lkCancel">关闭</button>${ops}`
  );
  $('#lkCancel').onclick = closeLockPanel;
  if (!has) $('#lkSetup').onclick = () => lockSetupView(j);
  else {
    /* 换密钥与取消加密都要先验证当前密钥：能进管理面板不代表可以随手改掉锁 */
    $('#lkChange').onclick = () => lockVerifyView(j, 'change');
    $('#lkRemove').onclick = () => lockVerifyView(j, 'remove');
    const rl = $('#lkRelock');
    if (rl) rl.onclick = () => lockRelock(j);
  }
}
/* 启用加密 */
function lockSetupView(j) {
  const ref = { mode: 'question' };
  lockPanelShell('设置密钥', '《' + j.name + '》· 选一种密钥形式',
    lockSpecHTML(ref.mode) + `<p class="lk-err" id="lkErr"></p>`,
    `<button class="btn ghost" id="lkBack">返回</button><button class="btn primary" id="lkApply">启用加密</button>`);
  lockBindSpecTabs(ref);
  $('#lkBack').onclick = () => openLockPanel(j);
  $('#lkApply').onclick = async () => {
    const spec = lockSpecRead(ref.mode);
    const err = lockSpecError(ref.mode, spec);
    if (err) { lockErr(err); return; }
    const btn = $('#lkApply'); lockBusy(btn, true, '加密中…'); lockErr('');
    try {
      const made = await makeLock(j, ref.mode, spec);
      /* 先把钥匙记住再挂锁：rememberKey 万一失败，j 仍是原来的明文普通本，
         不会出现「有 lock 配置却没钥匙」这种会让 persistJournals 拒绝保存的中间态。 */
      await rememberKey(j.id, made.km, made.lock);
      j.lock = made.lock; delete j.enc;
      lkSealCache.delete(j.id);
      save(); renderHome();
      toast('《' + j.name + '》已加密；导出的源文件也会是密文');
      closeLockPanel();
    } catch (e) { console.error('[lock] 启用加密失败：', e); lockErr('加密失败：' + ((e && e.message) || e)); lockBusy(btn, false); }
  };
}
/* 验证旧密钥（换密钥 / 取消加密共用的第一屏） */
function lockVerifyView(j, next) {
  const lock = j.lock, isQ = lock.mode === 'question';
  lockPanelShell('验证当前密钥', '《' + j.name + '》',
    (isQ ? `<div class="lk-question">${esc(lock.q || '（未填写问题）')}</div>` : '')
    + `<label class="lk-lab">${isQ ? '当前答案' : '当前密码'}</label>
       <input class="text-input" id="lkInput" type="password" placeholder="${isQ ? '输入答案' : '输入密码'}" autocomplete="current-password">
       <p class="lk-err" id="lkErr"></p>`,
    `<button class="btn ghost" id="lkBack">返回</button><button class="btn primary" id="lkVerify">验证</button>`);
  $('#lkBack').onclick = () => openLockPanel(j);
  const go = async () => {
    const v = $('#lkInput').value;
    if (!v) { lockErr('请先输入' + (isQ ? '答案' : '密码')); return; }
    const km = lockKeyMaterial(lock.mode, isQ ? { answer: v } : { password: v });
    const btn = $('#lkVerify'); lockBusy(btn, true, '验证中…'); lockErr('');
    const ok = await verifyLockKey(lock, km);
    lockBusy(btn, false);
    if (!ok) { lockErr('密钥不正确，请再试一次'); return; }
    if (next === 'remove') lockRemove(j);
    else lockChangeView(j);
  };
  $('#lkVerify').onclick = go;
  $('#lkInput').onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); go(); } e.stopPropagation(); };
}
/* 更换密钥（已验证旧密钥后进来）：用新密钥重新加密整本内容 */
function lockChangeView(j) {
  const ref = { mode: j.lock.mode === 'question' ? 'question' : 'password' };
  lockPanelShell('更换密钥', '《' + j.name + '》· 内容会用新密钥重新加密',
    lockSpecHTML(ref.mode) + `<p class="lk-err" id="lkErr"></p>`,
    `<button class="btn ghost" id="lkBack">返回</button><button class="btn primary" id="lkApply">更换密钥</button>`);
  lockBindSpecTabs(ref);
  $('#lkBack').onclick = () => openLockPanel(j);
  $('#lkApply').onclick = async () => {
    const spec = lockSpecRead(ref.mode);
    const err = lockSpecError(ref.mode, spec);
    if (err) { lockErr(err); return; }
    const btn = $('#lkApply'); lockBusy(btn, true, '重新加密中…'); lockErr('');
    try {
      const made = await makeLock(j, ref.mode, spec);
      /* 同上：先记住新钥匙再换锁，失败就仍是旧锁 + 旧钥匙，不会留下半截状态。
         两行赋值之间不夹 await，定时器驱动的 save() 插不进来。 */
      await rememberKey(j.id, made.km, made.lock);
      j.lock = made.lock; delete j.enc;
      lkSealCache.delete(j.id);
      save(); renderHome();
      toast('《' + j.name + '》的密钥已更换');
      closeLockPanel();
    } catch (e) { console.error('[lock] 换密钥失败：', e); lockErr('更换失败：' + ((e && e.message) || e)); lockBusy(btn, false); }
  };
}
/* 取消加密：内容留成明文，锁的配置与本机钥匙一起清掉 */
async function lockRemove(j) {
  delete j.lock; delete j.enc;
  lkSealCache.delete(j.id);
  await forgetKey(j.id);
  save(); renderHome();
  toast('《' + j.name + '》已取消加密');
  closeLockPanel();
}
/* 立即上锁：先用现有钥匙封好，再忘掉钥匙 —— 下次打开必须重新输入 */
async function lockRelock(j) {
  const km = lockKeys[j.id];
  if (!km) { toast('这台设备没有记住密钥'); return; }
  const btn = $('#lkRelock'); lockBusy(btn, true, '上锁中…');
  try {
    const env = await sealJournal(j, km);
    lkReplace(j, env);
    lkSealCache.delete(j.id);
    await forgetKey(j.id);
    save(); renderHome();
    toast('《' + j.name + '》已上锁，下次打开需要输入密钥');
    closeLockPanel();
  } catch (e) {
    console.error('[lock] 上锁失败：', e);
    toast('上锁失败：' + ((e && e.message) || e), 3600);
    lockBusy(btn, false);
  }
}

/* 触屏软键盘：只在真的聚焦到输入框时才把面板顶到上半屏。
   ⚠️ 延后 180ms 加 .kb，等 pointerup / click 派发完 —— 若同步加，面板瞬移后
      mouseup 会落在遮罩上，被「点外面关闭」误判关掉（取色盘 .kb 踩过同一个坑）。
   ⚠️ 用 focusin 委托而不是逐个 input 绑：换密钥 tab 会重画 #lkFields，
      新生成的 input 没有监听器也会漏掉。blur 时不摘 .kb，避免打字中途反复跳。 */
$('#lockBody').addEventListener('focusin', e => {
  if (!e.target.matches || !e.target.matches('input, textarea')) return;
  if (!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches)) return;
  clearTimeout(lkKbTimer);
  lkKbTimer = setTimeout(() => $('#lockMask').classList.add('kb'), 180);
});

/* 遮罩点外面关闭；Esc 也关（解锁框取消＝不打开书） */
$('#lockMask').addEventListener('click', e => { if (e.target === $('#lockMask')) closeLockPanel(); });
$('#lockClose').onclick = closeLockPanel;
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && $('#lockMask').classList.contains('show')) { e.stopPropagation(); closeLockPanel(); }
});
