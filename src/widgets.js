/* =====================================================================
 * Carnet · 通用控件 · 取色盘与背景面板   （脚本 17 / 23）
 * ---------------------------------------------------------------------
 * ① 自定义取色盘：HSV 面板 + 色相条 + 手输色值
 * ② 背景设置面板：预设色 / 自定义色 / 背景图片 / 恢复默认
 *
 * 依赖模块：core, storage
 *
 * 说明：模块间共用全局作用域，按下面的顺序加载，顺序即依赖顺序。
 * ===================================================================== */
/* ==================== 自定义取色盘 ====================
   App 内置浏览器常常唤不起原生 input[type=color]，所以这里自己做一套：
   上面是饱和度 / 明度面板，下面是色相条，也可以直接填色值。 */
const cp = { h: 340, s: .68, v: .9, apply: null, dragging: false };
function hsvToHex(h, s, v) {
  const f = n => {
    const k = (n + h / 60) % 6;
    return Math.round(255 * (v - v * s * Math.max(0, Math.min(k, 4 - k, 1))));
  };
  return '#' + [f(5), f(3), f(1)].map(x => x.toString(16).padStart(2, '0')).join('');
}
function hexToHsv(hex) {
  let c = String(hex || '').replace('#', '').trim();
  if (c.length === 3) c = c.split('').map(x => x + x).join('');
  if (!/^[0-9a-fA-F]{6}$/.test(c)) return null;
  const r = parseInt(c.slice(0, 2), 16) / 255, g = parseInt(c.slice(2, 4), 16) / 255, b = parseInt(c.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0;
  if (d) {
    if (max === r) h = 60 * ((g - b) / d + (g < b ? 6 : 0));
    else if (max === g) h = 60 * ((b - r) / d + 2);
    else h = 60 * ((r - g) / d + 4);
  }
  return { h: Math.round(h), s: max ? d / max : 0, v: max };
}
/* keepInput：正在手输色值时不回写输入框，免得把光标和已输入内容打乱 */
function paintCP(keepInput) {
  const hex = hsvToHex(cp.h, cp.s, cp.v);
  $('#cpSV').style.background =
    `linear-gradient(to top,#000,rgba(0,0,0,0)),linear-gradient(to right,#fff,rgba(255,255,255,0)),hsl(${cp.h},100%,50%)`;
  $('#cpDot').style.left = (cp.s * 100).toFixed(2) + '%';
  $('#cpDot').style.top = ((1 - cp.v) * 100).toFixed(2) + '%';
  $('#cpHueDot').style.left = (cp.h / 360 * 100).toFixed(2) + '%';
  $('#cpPrev').style.background = hex;
  if (!keepInput) $('#cpHex').value = hex.toUpperCase();
  return hex;
}
function openColorPicker(title, hex, apply) {
  const hsv = hexToHsv(hex);
  if (hsv) { cp.h = hsv.h; cp.s = hsv.s > .02 ? hsv.s : .68; cp.v = hsv.v > .02 ? hsv.v : .9; }
  cp.apply = apply;
  $('#cpTitle').textContent = title || '自定义颜色';
  paintCP();
  $('#cpMask').classList.add('show');
}
function closeColorPicker() { $('#cpMask').classList.remove('show'); cp.apply = null; cp.dragging = false; }
$('#cpClose').onclick = closeColorPicker;
$('#cpCancel').onclick = closeColorPicker;
$('#cpMask').addEventListener('click', e => { if (e.target === $('#cpMask')) closeColorPicker(); });
$('#cpOk').onclick = () => {
  const apply = cp.apply, hex = hsvToHex(cp.h, cp.s, cp.v);
  closeColorPicker();
  if (apply) apply(hex);
};
$('#cpHex').addEventListener('input', () => {
  const hsv = hexToHsv($('#cpHex').value);
  if (!hsv) return;
  cp.h = hsv.h; cp.s = hsv.s; cp.v = hsv.v;
  paintCP(true);
});
$('#cpHex').addEventListener('focus', () => $('#cpMask').classList.add('kb'));
/* 失焦后面板回位要延后：立刻移位会正好吞掉「确定 / 取消」那一下点击 */
$('#cpHex').addEventListener('blur', () => { paintCP(); setTimeout(() => $('#cpMask').classList.remove('kb'), 240); });
/* 面板与色相条：按下即取色，拖动连续取色（自己接管手势，不依赖系统能力） */
function bindCPDrag(el, onPick) {
  const pick = ev => {
    const r = el.getBoundingClientRect();
    onPick(clamp((ev.clientX - r.left) / r.width, 0, 1), clamp((ev.clientY - r.top) / r.height, 0, 1));
  };
  el.addEventListener('pointerdown', ev => {
    cp.dragging = true;
    try { el.setPointerCapture(ev.pointerId); } catch (_) {}
    pick(ev); ev.preventDefault();
  });
  el.addEventListener('pointermove', ev => { if (cp.dragging) pick(ev); });
  el.addEventListener('pointerup', () => { cp.dragging = false; });
  el.addEventListener('pointercancel', () => { cp.dragging = false; });
}
bindCPDrag($('#cpSV'), (x, y) => { cp.s = x; cp.v = 1 - y; paintCP(); });
bindCPDrag($('#cpHue'), x => { cp.h = Math.round(x * 360); paintCP(); });

/* ==================== 背景设置面板（主页 / 阅读器共用） ==================== */
const BG_PRESETS = ['#5b6182', '#445070', '#3a4358', '#232840', '#6e5a66', '#7a5c49', '#4f6b5d', '#3d5a66', '#8a8fa8', '#b8a98f'];
function bgCur() { return state.prefs.bg || { mode: 'default', value: '', img: null }; }
function syncBgPanel() {
  const b = bgCur();
  const box = $('#bgColors');
  if (!box.dataset.built) {
    box.innerHTML = BG_PRESETS.map(c => `<div class="swatch" data-bgcolor="${c}" style="background:${c}" title="${c}"></div>`).join('')
      + '<div class="swatch custom" id="bgCustom" title="自定义颜色"><span class="cus-ico">＋</span></div><span class="cus-tip" id="bgCustomTip">自定义</span>';
    box.dataset.built = '1';
    $$('#bgColors .swatch[data-bgcolor]').forEach(s => s.onclick = () => { setBg({ mode: 'color', value: s.dataset.bgcolor, img: null }); syncBgPanel(); });
    $('#bgCustom').onclick = () => openColorPicker('自定义背景颜色',
      bgCur().mode === 'color' ? bgCur().value : '',
      hex => { setBg({ mode: 'color', value: hex, img: null }); syncBgPanel(); });
  }
  $$('#bgColors .swatch[data-bgcolor]').forEach(s => s.classList.toggle('on', b.mode === 'color' && b.value === s.dataset.bgcolor));
  const cv = (b.mode === 'color' && /^#[0-9a-fA-F]{6}$/.test(String(b.value || '')) && !BG_PRESETS.includes(String(b.value).toLowerCase())) ? b.value : '';
  const chip = $('#bgCustom');
  chip.classList.toggle('on', !!cv);
  chip.style.background = cv || '';
  $('#bgCustomTip').textContent = cv ? cv.toUpperCase() : '自定义';
  $('#bgClearImg').disabled = b.mode !== 'image';
  $('#bgUpload').textContent = b.mode === 'image' ? '换一张图片' : '选择图片';
}
/* 只有一个面板：主页和阅读器共用同一份背景，不用再切来切去 */
function openBgPanel() {
  syncBgPanel();
  $('#bgMask').classList.add('show');
}
$('#bgClose').onclick = () => $('#bgMask').classList.remove('show');
$('#bgOk').onclick = () => $('#bgMask').classList.remove('show');
$('#bgMask').addEventListener('click', e => { if (e.target === $('#bgMask')) $('#bgMask').classList.remove('show'); });
$('#bgReset').onclick = () => { setBg({ mode: 'default', value: '', img: null }); syncBgPanel(); toast('已恢复默认背景'); };
$('#bgClearImg').onclick = () => { setBg({ mode: 'default', value: '', img: null }); syncBgPanel(); };
$('#bgUpload').onclick = () => $('#bgFile').click();
$('#bgFile').addEventListener('change', async e => {
  const f = e.target.files[0];
  e.target.value = '';
  if (!f) return;
  toast('正在处理图片…');
  const img = await shrinkImageFile(f, 1920);
  if (!img) { toast('图片读取失败'); return; }
  setBg({ mode: 'image', value: '', img });
  syncBgPanel();
  toast('背景已更新');
});

