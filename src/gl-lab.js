/* =====================================================================
 * Carnet · WebGL 实验层（POC，可整块摘除）   （脚本 29 / 29）
 * ---------------------------------------------------------------------
 * ① shelfGL（11-17 第九轮：书架四件套**全部由 GPU 画**）：
 *    · #glLabShelfBack（z-index 0，书后）：每本手账本的椭圆落地软影 + 台面外扩软影
 *    · #glLabShelf（z-index 4，书前）：玻璃挡板 / 白色台面 / 两颗铆钉
 *    ⚠️ 第十轮：两块都挂在 #shelfWrap **内部**，尺寸 = 整个可滚动内容、按内容坐标画一次，
 *       随 DOM 书一起被合成线程滚动 —— 全程 GPU、滚动零重绘，天然相对静止。
 *       别再改回挂在 #home 上靠 scroll 重绘，也别用「滚动时交回 DOM」的折中。
 *    ⚠️ 玻璃 alpha 必须严格复刻 background.css 浅底那套「近乎全透」分段渐变
 *       （板身 .018 灰 + 上沿 .24 雾 + 下沿 .45 渐白 + 上下各 1px 亮线）；
 *       旧版板身常数 .075 + 下沿 .46 从 72% 就起，整条白雾把书封横切一刀。
 *    ⚠️ 铆钉采样 assets/shelf-rivet.js 内嵌的**同一张 PNG**（dataURL，file:// 也能用），
 *       不做程序化金属圆 —— 否则和普通渲染对不上。封面图案/纹理/彩带仍由 DOM 合成
 *       （与编辑、PDF/SVG 导出同源），GPU 负责它的光影。
 * ② readerGL（11-17 重做，阅读器继续用 WebGL 渲染）：canvas 挂在 #stage 里、
 *    `.book` **之前**，靠书本身盖住中心，只在外围画椭圆落地软影 + 翻页时随
 *    角度偏移的环境光晕；翻页每帧重画。⚠️ `.book` 的 filter **属性必须保留**
 *    （这里只把它的不透明度压淡），它参与浏览器 3D 分组，摘掉会导致左侧多出
 *    白页 / 翻页叶片半透明 / 矩形灰影。光晕绝不叠在页面内容上。
 * ③ 轮播 / 单层书架：三块 canvas 都 display:none 且 0 帧绘制 —— 只要一块
 *    全屏透明合成层还留在树里，左右滑动就会从 60fps 掉到 ~24fps。
 *
 * 对外接口：window.GLLab = { enable, disable, set, toggle, on, status }
 *
 * 依赖模块：无（自包含；只用原生 WebGL1，不引任何库、不读项目内部变量）
 *
 * 说明：⚠️ 这是**实验层**，默认关闭。用户入口是「设置 → 实验性功能 →
 *       使用 WebGL 渲染」（widgets.js 调 GLLab.set()）；另有 URL ?gl=1 / ?gl=0
 *       与控制台 GLLab.set() / toggle() 作调试用。状态存 localStorage
 *       carnet_gl_lab_v1，不进 state.prefs、不跟着导出文件走。
 *       关闭时移除全部 canvas、注入样式与 html.gl-lab-on，界面逐像素回到原样。
 *       摘除方式：删掉 index.html 里这一行 script + assets/shelf-rivet.js +
 *       本文件 + 设置页里那一块 .set-sec（含 #glEnabled / #glNote）即可，无残留。
 *       ⚠️ 依赖模块：无（自包含；只用原生 WebGL1，不引任何库、不读项目内部变量）。
 * ===================================================================== */
(function () {
  'use strict';

  /* ---------------- 开关状态 ---------------- */
  const LS_KEY = 'carnet_gl_lab_v1';
  const qs = (function () { try { return new URLSearchParams(location.search); } catch (_) { return null; } })();
  function readStored() { try { return localStorage.getItem(LS_KEY) === '1'; } catch (_) { return false; } }
  function writeStored(v) { try { localStorage.setItem(LS_KEY, v ? '1' : '0'); } catch (_) {} }
  /* 用户在设置页拨过开关后，把 URL 上的 ?gl=1 / ?gl=0 摘掉：否则下次刷新
     URL 又会把实验层强制拽回开启，「关不掉」。file:// 下 replaceState 可能
     抛 SecurityError，静默忽略即可（那条路径本来就不会带 query）。 */
  function dropUrlFlag() {
    try {
      const u = new URL(location.href);
      if (!u.searchParams.has('gl')) return;
      u.searchParams.delete('gl');
      history.replaceState(history.state, '', u.href);
    } catch (_) {}
  }

  let enabled = false;
  let forced = qs && qs.has('gl') ? qs.get('gl') !== '0' : null;
  let booted = false;
  let failed = '';

  /* ---------------- 注入样式（只在开启时存在） ---------------- */
  /* ⚠️ `.book` 的 filter **属性绝对不能摘**：它参与浏览器对 preserve-3d 子树的
     3D 分组，上一轮设成 none 后静止态多出左侧一整块白页、翻页叶片半透明灰块、
     书周围矩形灰影。这次只把它的阴影不透明度压淡，主投影交给 WebGL 画。
     ⚠️ 阅读器的 canvas 必须挂在 `.book` **之前**（DOM 顺序），靠书本身盖住中心，
        只在外围露出柔影；绝不叠在页面内容上（否则又会出现「翻页中缝黑影」）。
     封面皮面（阴影 / 圆角 / 高光 / 纹理）仍全部交回 CSS 原生渲染。 */
  const CSS_TEXT = [
    /* 阅读器那块铺满 #stage（视口大小）。 */
    '#glLabReader{position:absolute;inset:0;width:100%;height:100%;pointer-events:none}',
    /* ⚠️ 11-17 第十轮定稿：书架两块 canvas **挂在 #shelfWrap 内**，
       尺寸由 fit() 按可滚动内容宽高写成内联 px —— 它们是滚动内容的一部分，
       浏览器合成线程滚动时与 DOM 书一起移动，全程 GPU、绝不依赖主线程重绘。 */
    '#glLabShelfBack,#glLabShelf{position:absolute;top:0;left:0;pointer-events:none}',
    '#glLabShelfBack{z-index:0}',
    '#glLabShelf{z-index:4}',
    /* canvas 的 containing block 必须是滚动容器本身，否则不跟着内容滚 */
    'html.gl-lab-on #shelfWrap{position:relative}',
    /* ⚠️ 装饰层交给 GPU 后 DOM 副本必须隐藏，但**只隐藏可见性、不能 display:none**：
       书脚的负 margin 依赖玻璃高度，布局一拆整排书会掉下来。
       visibility 可被子元素覆盖，所以铆钉再显式写一遍。 */
    'html.gl-lab-on .shelf-board,html.gl-lab-on .shelf-plinth{visibility:hidden}',
    'html.gl-lab-on .shelf-board .screw{visibility:hidden}',
    'html.gl-lab-on .shelf-board{backdrop-filter:none!important;-webkit-backdrop-filter:none!important}',
    'html.gl-lab-on .gear,html.gl-lab-on .cover-badge{backdrop-filter:none!important;-webkit-backdrop-filter:none!important}',
    'html.gl-lab-on .book{filter:drop-shadow(0 22px 38px rgba(40,42,60,.045))!important}'
  ].join('\n');

  /* ---------------- Shader ----------------
     一个 program、每元素一次 draw call。fragment 按 uKind 分支：
       5 台面外扩软影 / 9 书本椭圆软影 / 10 翻页环境光晕 —— 当前只用这三个。
       0 玻璃挡板 / 1 白色台面 / 2 金属铆钉 / 3/4/6/8 是早期版本的旧分支，
       JS 已不再调用（书架装饰层交回 DOM），保留只为以后加效果时不用重写整段 shader。
     输出一律 premultiplied，配合 blendFunc(ONE, ONE_MINUS_SRC_ALPHA)。 */
  const VS = [
    'attribute vec2 aPos;',
    'uniform vec4 uRect;',
    'uniform vec2 uRes;',
    'varying vec2 vUv;',
    'void main(){',
    '  vUv = aPos;',
    '  vec2 px = uRect.xy + aPos * uRect.zw;',
    '  vec2 ndc = vec2(px.x / uRes.x * 2.0 - 1.0, 1.0 - px.y / uRes.y * 2.0);',
    '  gl_Position = vec4(ndc, 0.0, 1.0);',
    '}'
  ].join('\n');

  const FS = [
    'precision mediump float;',
    'varying vec2 vUv;',
    'uniform float uKind;',
    'uniform vec4 uRectN;',
    'uniform vec4 uColor;',
    'uniform vec4 uParam;',
    'uniform vec2 uPointer;',
    'uniform vec2 uQuadPx;',
    'uniform float uFalloff;',
    'uniform sampler2D uTex;',
    'uniform float uHasTex;',
    /* 无 sin 的 hash：mediump / fp16 下大参数 sin 会退化成条带或白点 */
    'float hash(vec2 p){',
    '  vec2 q = fract(p * vec2(0.1031, 0.1030));',
    '  q += dot(q, q.yx + 33.33);',
    '  return fract((q.x + q.y) * q.x);',
    '}',
    'float sdRound(vec2 uv, float r){',
    '  vec2 q = abs(uv - 0.5) - (0.5 - r);',
    '  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;',
    '}',
    'void main(){',
    '  vec4 c = vec4(0.0);',
    '  if (uKind < 0.5) {',
    /* 玻璃：圆角必须按**像素**算。用 uv 单位时 1000×50 的挡板会把 26px 圆角
       压成 450px×22px 的扁椭圆，上沿两个大圆角几乎看不见。 */
    '    vec2 pPx = vUv * uQuadPx;',
    '    float r = mix(uParam.x, uParam.y, vUv.y);',
    '    vec2 q = abs(pPx - uQuadPx * 0.5) - (uQuadPx * 0.5 - vec2(r));',
    '    float d = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;',
    '    float mask = 1.0 - smoothstep(-0.5, 0.6, d);',
    /* 极淡灰轮廓：白底上白+白勾不出圆角，3.5% 灰正好；压在彩色封面上几乎看不见 */
    '    float outline = (1.0 - smoothstep(0.0, 1.6, abs(d))) * mask;',
    /* ⚠️ 严格对齐 background.css #home.bg-light .shelf-board 的六段渐变：
       上沿 .24 雾 → 9% .07 → 板身不到 2% 灰 → 下沿 .45 渐白；上下各一条 1px 亮线。
       板身常数只能 .018，别回到 .075 —— 那会把书脚洗成一条白横带（第七轮的 bug）。 */
    '    float body = 0.018;',
    '    float topFog = uParam.z * exp(-vUv.y * 14.0);',
    '    float bottom = uParam.w * smoothstep(0.80, 1.0, vUv.y);',
    '    float topLine = (1.0 - smoothstep(0.0, 0.024, vUv.y)) * 0.40;',
    '    float botLine = smoothstep(0.976, 1.0, vUv.y) * 0.80;',
    '    float a = (body + topFog + bottom + topLine + botLine + outline * 0.035) * mask;',
    '    vec3 col = mix(uColor.rgb, vec3(0.35, 0.37, 0.43), outline * 0.9);',
    '    c = vec4(col, clamp(a, 0.0, 0.92));',
    '  } else if (uKind < 1.5) {',
    /* 台面：三段白渐变，跟 background.css #home.bg-light .shelf-plinth 同源 */
    '    float d = sdRound(vUv, 0.025);',
    '    float mask = 1.0 - smoothstep(0.0, 0.010, d);',
    '    vec3 c0 = uColor.rgb * 0.992;',
    '    vec3 c2 = mix(uColor.rgb, vec3(0.957, 0.961, 0.973), 0.6);',
    '    vec3 col = vUv.y < 0.38 ? mix(c0, uColor.rgb, vUv.y / 0.38)',
    '              : mix(uColor.rgb, c2, (vUv.y - 0.38) / 0.62);',
    '    float topLine = (1.0 - smoothstep(0.0, 0.08, vUv.y)) * 0.10;',
    '    c = vec4(col, clamp((0.92 + topLine) * uColor.a * mask, 0.0, 1.0));',
    '  } else if (uKind < 2.5) {',
    /* 铆钉：优先采样和普通渲染同一张 PNG（assets/shelf-rivet.js 内嵌 dataURL），
       逐像素一致；贴图没就绪 / 上传失败才退回下面这段程序化金属圆。 */
    '    if (uHasTex > 0.5) {',
    '      vec4 t = texture2D(uTex, vUv);',
    '      float rr = length((vUv - 0.5) * 2.0);',
    '      float rim = smoothstep(0.84, 0.94, rr) * (1.0 - smoothstep(0.94, 1.0, rr));',
    '      c = vec4(t.rgb + rim * 0.14, t.a);',
    '    } else {',
    '      vec2 p = (vUv - 0.5) * 2.0;',
    '      float r = length(p);',
    '      float disk = 1.0 - smoothstep(0.88, 1.0, r);',
    '      float lit = clamp(1.0 - length(p - vec2(-0.34, -0.34)) * 0.9, 0.0, 1.0);',
    '      float sh = clamp(1.0 - length(p - vec2(0.42, 0.44)) * 0.95, 0.0, 1.0);',
    '      float brushed = 0.96 + 0.04 * sin(atan(p.y, p.x) * 26.0);',
    '      vec3 col = mix(vec3(0.60, 0.63, 0.70), vec3(1.0), lit * 0.8);',
    '      col *= 1.0 - sh * 0.30;',
    '      col *= brushed;',
    '      float rim2 = (1.0 - smoothstep(0.80, 0.96, r)) * smoothstep(0.70, 0.82, r);',
    '      col += rim2 * 0.30;',
    '      c = vec4(col, disk);',
    '    }',
    '  } else if (uKind < 3.5) {',
    /* 封面：跟随指针的镜面光斑 + 斜向固定高光 + 纸/布材质微光 */
    '    vec2 lp = (uPointer - uRectN.xy) / max(uRectN.zw, vec2(0.001));',
    '    float d = length((vUv - lp) * vec2(1.0, 1.3));',
    '    float spec = pow(max(0.0, 1.0 - d * 1.55), 3.0) * 0.50;',
    '    float band = exp(-pow((vUv.x * 0.75 + vUv.y * 0.62 - 0.40) * 4.2, 2.0)) * 0.13;',
    '    float matKind = uParam.x;',
    '    float grain = 0.0;',
    '    if (matKind > 0.5 && matKind < 1.5) grain = hash(floor(vUv * vec2(300.0, 300.0))) * 0.030;',
    '    else if (matKind > 1.5) grain = (0.5 + 0.5 * sin(vUv.x * 230.0) * sin(vUv.y * 230.0)) * 0.024;',
    '    float rim = (1.0 - smoothstep(0.0, 0.014, vUv.y)) * 0.07;',
    '    c = vec4(vec3(1.0), clamp(spec + band + grain + rim, 0.0, 0.72));',
    '  } else if (uKind < 4.5) {',
    /* 暗角：四周一圈 + 书脊侧更重，替代 .cover 的 inset box-shadow */
    '    float e = min(min(vUv.x, 1.0 - vUv.x), min(vUv.y, 1.0 - vUv.y));',
    '    float vig = (1.0 - smoothstep(0.0, 0.11, e)) * 0.15;',
    '    float spine = (1.0 - smoothstep(0.0, 0.055, vUv.x)) * 0.13;',
    '    c = vec4(vec3(0.02, 0.02, 0.05), clamp(vig + spine, 0.0, 0.5));',
    '  } else if (uKind < 5.5) {',
    /* 外扩软影：按「离内框边界多少像素」衰减，不能按 uv —— 否则宽而扁的 quad
       会把整块外扩区涂成一条均匀灰带（书本投影尤其明显）。 */
    '    vec2 q = (vUv - vec2(uParam.x, uParam.y)) / max(vec2(uParam.z, uParam.w), vec2(0.001));',
    '    vec2 e = max(abs(q - 0.5) - vec2(0.5), vec2(0.0));',
    '    float dPx = length(e * vec2(uParam.z * uQuadPx.x, uParam.w * uQuadPx.y));',
    '    float bias = (q.y < 0.0 ? 2.2 : 1.0) + (q.x < 0.0 || q.x > 1.0 ? 1.2 : 0.0);',
    '    float outside = smoothstep(0.0, 0.002, e.x + e.y);',
    '    float a = (1.0 - smoothstep(0.0, uFalloff, dPx * bias)) * uColor.a * outside;',
    '    c = vec4(uColor.rgb, clamp(a, 0.0, 0.35));',
    '  } else if (uKind < 6.5) {',
    /* 翻页压暗：翻起一侧随角度变暗，中缝一道折痕 */
    '    float ang = uParam.x;',
    '    float t = abs(ang);',
    '    float s = ang < 0.0 ? -1.0 : 1.0;',
    '    float k = (vUv.x - 0.5) * s;',
    '    float shade = smoothstep(0.0, 0.48, k) * 0.13 * t;',
    '    float gutter = exp(-pow((vUv.x - 0.5) * 20.0, 2.0)) * 0.10;',
    '    c = vec4(vec3(0.04, 0.03, 0.08), clamp(shade + gutter, 0.0, 0.45));',
    '  } else if (uKind < 8.5) {',
    /* 翻页高光带（旧分支，保留） */
    '    float ang = uParam.x;',
    '    float t = abs(ang);',
    '    float s = ang < 0.0 ? -1.0 : 1.0;',
    '    float bp = 0.5 + s * (0.10 + 0.30 * t);',
    '    c = vec4(vec3(1.0), exp(-pow((vUv.x - bp) * 7.0, 2.0)) * 0.09 * t);',
    '  } else if (uKind < 9.5) {',
    /* 书本椭圆软影：canvas 挂在 .book **之前**，书本身会盖住中心，
       只有椭圆外围这圈柔影露出来，比外扩矩形 SDF 更像真实落地影。 */
    /* 居中椭圆、不依赖书的 rect：翻页展开成双页时书宽会变，按「合着的封面」
       尺寸缓存的 quad 会错位成左侧一大块灰白（实测踩过）。 */
    '    vec2 q = (vUv - vec2(0.50, 0.56)) / vec2(0.46, 0.42);',
    '    float a = (1.0 - smoothstep(0.32, 1.0, length(q))) * uColor.a;',
    '    c = vec4(uColor.rgb, clamp(a, 0.0, 0.30));',
    '  } else if (uKind < 10.5) {',
    /* 翻页环境光晕（第十一轮强化）：随角度左右偏 + 随叶片抬升变亮的暖白柔光。
       canvas 挂在 .book **之前**，书会盖住中心，只有外围露出来 —— 绝不压在页面内容上
       （上一轮「翻页中缝黑影」就是半透明层压到内容上来的）。 */
    '    float ang = uParam.x;',
    '    float lift = uParam.y;',
    '    float s = ang < 0.0 ? -1.0 : 1.0;',
    '    vec2 q = (vUv - vec2(0.5 + s * 0.10 * abs(ang), 0.52)) / vec2(0.62, 0.55);',
    '    float a = (1.0 - smoothstep(0.20, 1.0, length(q)))',
    '            * (0.03 + 0.11 * abs(ang) + 0.04 * lift);',
    '    c = vec4(vec3(1.0, 0.97, 0.90), a);',
    '  } else if (uKind < 11.5) {',
    /* 开书 / 合书：飞行封面的环境光晕。uParam.x 由 JS 按两段进度算好强度直接传进来
       （抬起段弱、放大段强、首尾收干净），shader 不再自己按总进度取 sin。 */
    '    float pulse = clamp(uParam.x, 0.0, 1.0);',
    '    vec2 q = (vUv - vec2(0.5, 0.52)) / vec2(0.56, 0.50);',
    '    float halo = 1.0 - smoothstep(0.30, 1.0, length(q));',
    '    c = vec4(vec3(1.0, 0.96, 0.88), halo * pulse * 0.20);',
    '  } else {',
    /* 左右滑动：随位移移动的暖白流光，速度越快越亮；只落在书带内，很淡 */
    '    float phase = uParam.x;',
    '    float spd = clamp(uParam.y, 0.0, 1.0);',
    '    float band = exp(-pow((vUv.x - fract(phase)) * 3.4, 2.0));',
    '    float vfade = 1.0 - smoothstep(0.35, 1.0, abs(vUv.y - 0.5) * 2.0);',
    '    c = vec4(vec3(1.0, 0.98, 0.92), band * vfade * (0.02 + 0.10 * spd));',
    '  }',
    '  gl_FragColor = vec4(c.rgb * c.a, c.a);',
    '}'
  ].join('\n');

  /* ---------------- WebGL 基础设施 ---------------- */
  function compile(gl, type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      const msg = gl.getShaderInfoLog(s);
      gl.deleteShader(s);
      throw new Error('shader: ' + msg);
    }
    return s;
  }

  function makeStage(host, id, first) {
    const cv = document.createElement('canvas');
    cv.id = id;
    /* 阅读器那块必须排在 .book **之前**：两者都是定位元素，靠 DOM 顺序
       让书盖住 canvas 中心，只在外围露出柔影。 */
    if (first && host.firstChild) host.insertBefore(cv, host.firstChild);
    else host.appendChild(cv);
    try {
      const opts = { alpha: true, premultipliedAlpha: true, antialias: true, depth: false, stencil: false };
      const gl = cv.getContext('webgl', opts) || cv.getContext('experimental-webgl', opts);
      if (!gl) throw new Error('浏览器没有可用的 WebGL 上下文');
      const prog = gl.createProgram();
      gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VS));
      gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FS));
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
        throw new Error('program: ' + gl.getProgramInfoLog(prog));
      }
      gl.useProgram(prog);
      const buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
        0, 0, 1, 0, 0, 1,
        0, 1, 1, 0, 1, 1
      ]), gl.STATIC_DRAW);
      const aPos = gl.getAttribLocation(prog, 'aPos');
      gl.enableVertexAttribArray(aPos);
      gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
      const U = {};
    ['uRect', 'uRes', 'uKind', 'uRectN', 'uColor', 'uParam', 'uPointer', 'uQuadPx', 'uFalloff', 'uTex', 'uHasTex']
      .forEach(k => { U[k] = gl.getUniformLocation(prog, k); });
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.clearColor(0, 0, 0, 0);
      /* 每个 stage 一张 1×1 占位纹理：书架那张稍后换成内嵌的铆钉 PNG，
         阅读器 / 书后层不用贴图但 shader 里 sampler 必须绑个合法对象。 */
      const tex = gl.createTexture();
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE,
        new Uint8Array([200, 202, 214, 255]));
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.uniform1i(U.uTex, 0);
      cv.addEventListener('webglcontextlost', e => {
        e.preventDefault();
        failed = 'WebGL 上下文丢失，已自动回退到 DOM 渲染';
        disable();
      });
      return { cv: cv, gl: gl, U: U, host: host, w: 1, h: 1, ox: 0, oy: 0, tex: tex, hasTex: 0 };
    } catch (e) {
      /* 失败时别把一个没有样式的 300×150 裸 canvas 留在页面上挡点击 */
      cv.remove();
      throw e;
    }
  }

  let shelf = null, shelfBack = null, readerGL = null, styleEl = null, observer = null;
  /* 阅读器里 #book 的 rect 只在进入视图 / resize 时量一次。
     ⚠️ 翻页期间 page-flip.js 每帧写 transform，这时再去读 getBoundingClientRect
        会强制同步重排 —— 轮播那个卡顿就是这么来的，不能在阅读器重犯。 */
  let readerGeom = null;
  let raf = 0, dirty = true;
  const pointer = { x: 0.5, y: 0.35 };

  function fit(st) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let w, h, scale;
    if (st.contentSized) {
      /* 书架两层：画布就是 #shelfWrap 的可滚动内容，尺寸 = 整个内容宽高。
         ⚠️ 先把自己的高度归零再量 scrollHeight，否则画布会把内容越撑越高。 */
      st.cv.style.height = '0px';
      w = Math.max(1, st.host.scrollWidth || st.host.clientWidth || window.innerWidth);
      h = Math.max(1, st.host.scrollHeight || st.host.clientHeight || window.innerHeight);
      st.cv.style.width = w + 'px';
      st.cv.style.height = h + 'px';
      /* 装饰层全是低 alpha 软影 / 半透玻璃，1x 足够；内容可能几千 px 高，
         按 dpr 放大会白吃几十 MB 显存。 */
      scale = 1;
    } else if (st.selfSized) {
      /* 动画画布：尺寸由自己在 cssText 里写死（飞入铺满 #app、轮播只占中间书带），
         按画布自身 client 尺寸来，不读整个屏幕 */
      w = st.cv.clientWidth || st.host.clientWidth || window.innerWidth;
      h = st.cv.clientHeight || st.host.clientHeight || window.innerHeight;
      scale = 1;
    } else {
      w = st.host.clientWidth || window.innerWidth;
      h = st.host.clientHeight || window.innerHeight;
      scale = dpr;
    }
    const pw = Math.max(1, Math.round(w * scale)), ph = Math.max(1, Math.round(h * scale));
    if (st.cv.width !== pw || st.cv.height !== ph) { st.cv.width = pw; st.cv.height = ph; }
    st.w = w; st.h = h;
    const o = st.host.getBoundingClientRect();
    /* 内容左上角在视口里的位置；quad() 用「视口 rect - 这个基准」得到内容坐标。
       滚动时 rect 与 o.top 同步变、scrollTop 抵消，画布本身也随内容滚 —— 全程相对静止。 */
    st.ox = o.left - (st.contentSized ? (st.host.scrollLeft || 0) : 0);
    st.oy = o.top - (st.contentSized ? (st.host.scrollTop || 0) : 0);
    st.gl.viewport(0, 0, pw, ph);
    st.gl.uniform2f(st.U.uRes, w, h);
    st.gl.clear(st.gl.COLOR_BUFFER_BIT);
  }

  function quad(st, r, kind, color, param, falloff) {
    if (!st || r.w <= 0 || r.h <= 0) return;
    const gl = st.gl, U = st.U;
    const x = r.x - st.ox, y = r.y - st.oy;
    gl.uniform4f(U.uRect, x, y, r.w, r.h);
    gl.uniform4f(U.uRectN, x / st.w, y / st.h, r.w / st.w, r.h / st.h);
    gl.uniform1f(U.uKind, kind);
    gl.uniform4f(U.uColor, color[0], color[1], color[2], color[3]);
    gl.uniform4f(U.uParam, param[0], param[1], param[2], param[3]);
    gl.uniform2f(U.uPointer, pointer.x, pointer.y);
    gl.uniform2f(U.uQuadPx, r.w, r.h);
    gl.uniform1f(U.uFalloff, falloff || 26);
    gl.uniform1f(U.uHasTex, st.hasTex ? 1 : 0);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, st.tex);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  /* 铆钉贴图：assets/shelf-rivet.js 里内嵌的同一张 PNG（dataURL，file:// 也能上传）。
     ⚠️ 不要设 UNPACK_FLIP_Y_WEBGL：本 shader 的 vUv.y=0 就是 quad 顶部，
        纹理 t=0 恰好对应图片第一行；翻了会让「左上迎光」变成「左下迎光」。 */
  function loadRivetTex(st) {
    if (!st || !window.SHELF_RIVET_URL || st.hasTex) return;
    const img = new Image();
    img.onload = () => {
      if (!st.cv.isConnected || !st.gl) return;
      try {
        const gl = st.gl;
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, st.tex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
        st.hasTex = 1;
        invalidate();                 // 贴图到了，重画一帧让铆钉换成正版
      } catch (e) { /* 上传失败就保持程序化圆，不整层崩掉 */ }
    };
    img.src = window.SHELF_RIVET_URL;
  }

  function rectOf(el) {
    const r = el.getBoundingClientRect();
    return { x: r.left, y: r.top, w: r.width, h: r.height };
  }

  /* ---------------- 书架：两层 canvas，四件套全由 GPU 画 ----------------
     back（z-index 0，书后）：每本手账本的椭圆落地影 + 台面外扩软影
     front（z-index 4，书前）：玻璃挡板 → 白色台面 → 两颗铆钉
     ⚠️ 书后层绝不能画任何带白雾的东西，书会盖住中心，只在外围露出柔影。 */
  function drawShelf() {
    /* ⚠️ renderHome() 会重建 #shelfWrap 的子节点，挂在里面的画布也被一起清掉。
       视图没变时 tick() 不会调 ensureStage()，所以每次画之前先确认画布还在树里，
       掉了就按当前内容重建（贴纸纹理会随之重新上传）。 */
    if (!shelf || !shelf.cv.isConnected || !shelfBack || !shelfBack.cv.isConnected) ensureStage('shelf');
    if (!shelf || !shelfBack) return;
    fit(shelf); fit(shelfBack);
    shelf.gl.clear(shelf.gl.COLOR_BUFFER_BIT);
    shelfBack.gl.clear(shelfBack.gl.COLOR_BUFFER_BIT);
    const home = document.getElementById('home');
    const wrap = document.getElementById('shelfWrap');
    const reader = document.getElementById('reader');
    if (!home || !wrap || wrap.hidden || (reader && reader.classList.contains('show'))) return;
    const st = window.state;
    if (st && st.prefs && st.prefs.view !== 'shelf') return;

    /* bg-light 由 storage.js applyBgTo 挂到 #home / #reader / body，判一处不够 */
    const light = home.classList.contains('bg-light') ||
      document.body.classList.contains('bg-light') ||
      document.documentElement.classList.contains('bg-light');
    const rows = wrap.querySelectorAll('.shelf-row');
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const board = row.querySelector('.shelf-board');
      const plinth = row.querySelector('.shelf-plinth');
      if (!board || !plinth) continue;
      const br = rectOf(board), pr = rectOf(plinth);
      /* ⚠️ 画布覆盖的是**整个可滚动内容**，不是视口：所有排都要画一次。
         按视口裁剪会让滚到下面几排时没有玻璃 / 台面；画完一次后滚动完全由合成线程负责，
         不再需要任何 scroll 重绘。 */

      /* ① 手账本：每本一圈椭圆落地影（GPU 画，DOM 书盖住中心只露外围） */
      row.querySelectorAll('.book-item').forEach(bk => {
        const r = rectOf(bk);
        const sr = { x: r.x - r.w * .12, y: r.y + r.h * .52, w: r.w * 1.24, h: r.h * .62 };
        quad(shelfBack, sr, 9, light ? [0.20, 0.21, 0.28, 0.10] : [0.08, 0.09, 0.16, 0.22],
          [0, 0, 0, 0]);
      });

      /* ② 台面外扩落地影 */
      const px = Math.max(14, pr.w * 0.035), pt = 2, pb = 22;
      const sr = { x: pr.x - px, y: pr.y - pt, w: pr.w + 2 * px, h: pr.h + pt + pb };
      quad(shelf, sr, 5, [0.35, 0.36, 0.42, 0.06],
        [px / sr.w, pt / sr.h, pr.w / sr.w, pr.h / sr.h], 18);

      /* ③ 玻璃挡板：圆角半径直接读 CSS，跟 --glass-r 永远同源 */
      const cs = getComputedStyle(board);
      const rTop = parseFloat(cs.borderTopLeftRadius) || 26;
      const rBot = parseFloat(cs.borderBottomLeftRadius) || 4;
      quad(shelf, br, 0, light ? [1, 1, 1, 1] : [0.92, 0.95, 1, 1],
        [rTop, rBot, light ? 0.24 : 0.20, light ? 0.45 : 0.26]);
      /* ④ 白色台面 ⑤ 两颗铆钉（采样同一张 PNG） */
      quad(shelf, pr, 1, light ? [1, 1, 1, 1] : [0.98, 0.98, 1, 0.86], [0, 0, 0, 0]);
      const screws = board.querySelectorAll('.screw');
      for (let k = 0; k < screws.length; k++) {
        quad(shelf, rectOf(screws[k]), 2, [0, 0, 0, 1], [0, 0, 0, 0]);
      }
    }
  }

  /* ---------------- 阅读器：书后椭圆软影 + 翻页环境光 ----------------
     ⚠️ 每帧只读 #leaf.style.transform 这个内联字符串（纯属性读取，不触发布局）。
        书的位置用进入视图时缓存的 readerGeom；绝不在翻页中读 getBoundingClientRect
        或 clientWidth —— page-flip.js 每帧在写 transform，会撞成强制同步重排。 */
  function leafAngle() {
    const leaf = document.getElementById('leaf');
    if (!leaf || !leaf.classList.contains('show')) return null;
    const m = /rotateY\(\s*([-+]?[0-9.]+)deg/.exec(leaf.style.transform || '');
    return m ? Math.max(-1, Math.min(1, parseFloat(m[1]) / 180)) : null;
  }
  /* 叶片抬升 translateZ(0~30px) 也是纯内联字符串，归一化后拿去调光晕亮度 */
  function leafLift() {
    const leaf = document.getElementById('leaf');
    const m = /translateZ\(\s*([-+]?[0-9.]+)px/.exec(leaf && leaf.style.transform || '');
    return m ? clamp(parseFloat(m[1]) / 30, 0, 1) : 0;
  }
  function measureReader() {
    /* 只记 stage 尺寸；软影用居中椭圆，不再量 #book 的 rect */
    readerGeom = readerGL
      ? { stage: { x: readerGL.ox, y: readerGL.oy, w: readerGL.w, h: readerGL.h } }
      : null;
  }
  function drawReader() {
    if (!readerGL || !readerGeom) return false;
    readerGL.gl.clear(readerGL.gl.COLOR_BUFFER_BIT);
    const ang = leafAngle();
    if (ang === null) {
      /* 静止：一层很淡的居中落地软影 */
      quad(readerGL, readerGeom.stage, 9, [0.20, 0.21, 0.28, 0.12], [0, 0, 0, 0]);
      return false;
    }
    /* 翻页：书后一层随角度左右偏的环境光晕 + 一条随角度扫过的竖向高光带。
       ⚠️ 两块都画在整个 stage 上，但 canvas 排在 .book 之前，书会盖住中心，
          只在外围露出柔光 —— 绝不把半透明像素压到页面内容上。 */
    quad(readerGL, readerGeom.stage, 10, [1, 1, 1, 1], [ang, leafLift(), 0, 0]);
    quad(readerGL, readerGeom.stage, 8, [1, 1, 1, 1], [ang, 0, 0, 0]);
    return true;
  }

  /* ==================== 第十一轮：三类动画的 GPU 光影层 ====================
     独立的一套按需画布 / rAF，不并入 tick() 的视图状态机：
       · #glLabFly      开书 / 合书的飞入飞出（落地影 + 环境光晕）
       · #glLabCarousel 左右滑动（流光带 + 随速度偏移的运动影）
       · 翻页沿用 #glLabReader（上面 drawReader 的 kind 10 + kind 8）
     两块都挂在 #app（position:fixed，天然是 containing block），样式写内联，
     不依赖 html.gl-lab-on —— 轮播视图下那个 class 会被 tick() 摘掉。
     ⚠️ 静止时两块画布都 display:none 且 0 帧，绝不留在合成树里拖慢左右滑动。
     ⚠️ 飞入进度用「开始时间 + 时长 + 近似 easing」自己算，全程不读布局；
        翻页只读 #leaf.style.transform 字符串；轮播由 carousel.js 直接把 off/vel 传进来。 */
  let flyStage = null, carStage = null, animRaf = 0, animDraws = 0;
  let flyAnim = null;
  const carAnim = { off: 0, vel: 0, last: 0, holdUntil: 0, active: false };

  function ensureAnimStage(which) {
    const old = which === 'fly' ? flyStage : carStage;
    if (old && old.cv.isConnected) return old;
    const app = document.getElementById('app') || document.body;
    const made = makeStage(app, which === 'fly' ? 'glLabFly' : 'glLabCarousel');
    made.selfSized = true;
    made.cv.style.cssText = which === 'fly'
      ? 'position:absolute;inset:0;width:100%;height:100%;z-index:55;pointer-events:none'
      /* 只覆盖中间书带：全屏透明合成层会让左右滑动掉帧（实测 ~24fps） */
      : 'position:absolute;left:0;top:12%;width:100%;height:76%;z-index:56;pointer-events:none';
    if (which === 'fly') flyStage = made; else carStage = made;
    return made;
  }
  function startAnim() {
    if (enabled && !animRaf) animRaf = requestAnimationFrame(animTick);
  }
  function flyEase(p) { return 1 - Math.pow(1 - p, 3); }   // 放大段：近似 cubic-bezier(.22,1,.28,1)
  function flyLiftEase(p) { return p < .5 ? 2 * p * p : 1 - 2 * (1 - p) * (1 - p); } // 抬起段 ease-in-out
  function lerp(a, b, e) { return a + (b - a) * e; }
  function lerpRect(a, b, e) {
    return {
      left: lerp(a.left, b.left, e), top: lerp(a.top, b.top, e),
      width: lerp(a.width, b.width, e), height: lerp(a.height, b.height, e)
    };
  }
  function snapRect(r) {
    return { left: r.left, top: r.top, width: r.width, height: r.height };
  }

  function drawFly(now) {
    const st = ensureAnimStage('fly');
    const p = clamp((now - flyAnim.t0) / Math.max(flyAnim.ms, 1), 0, 1);
    /* 第十二轮：和 flyCover 同样的两段式（38% 抬起 / 62% 放大）。
       抬起时书离台面 → 影子留在地面并变淡；放大时书回到阅读器 → 影子重新加深、光晕最亮。 */
    const split = .38;
    let r, shadowA, glow;
    if (p < split) {
      const q = flyLiftEase(p / split);
      r = lerpRect(flyAnim.a, flyAnim.m, q);
      shadowA = .13 - .07 * q;
      glow = .30 * Math.sin((p / split) * Math.PI);
    } else {
      const q = flyEase((p - split) / (1 - split));
      r = lerpRect(flyAnim.m, flyAnim.b, q);
      shadowA = .06 + .11 * q;
      glow = .30 + .70 * Math.sin(q * Math.PI);
    }
    fit(st);
    st.gl.clear(st.gl.COLOR_BUFFER_BIT);
    /* 落地影钉在书架那一端的地面高度，不跟着书一起飞走，才像真的离开台面 */
    const ground = flyAnim.reverse ? flyAnim.b : flyAnim.a;
    const gy = ground.top + ground.height * .58;
    quad(st, { x: r.left - r.width * .18, y: gy, w: r.width * 1.36, h: r.height * .72 },
      9, [0.20, 0.21, 0.28, shadowA], [0, 0, 0, 0]);
    quad(st, { x: r.left - r.width * .35, y: r.top - r.height * .35, w: r.width * 1.7, h: r.height * 1.7 },
      11, [1, 1, 1, 1], [glow, flyAnim.reverse ? 1 : 0, 0, 0]);
    if (p >= 1) flyAnim = null;
  }
  function drawCarousel() {
    const st = ensureAnimStage('carousel');
    fit(st);
    st.gl.clear(st.gl.COLOR_BUFFER_BIT);
    const w = st.w, h = st.h;
    const phase = ((carAnim.off * 0.0012) % 1 + 1) % 1;
    const spd = clamp(Math.abs(carAnim.vel) / 36, 0, 1);
    quad(st, { x: 0, y: 0, w: w, h: h }, 12, [1, 1, 1, 1], [phase, spd, 0, 0]);
    quad(st, { x: w * .5 - w * .30 + carAnim.vel * .8, y: h * .62, w: w * .60, h: h * .30 },
      9, [0.20, 0.21, 0.28, 0.09 + 0.06 * spd], [0, 0, 0, 0]);
  }
  function animTick(now) {
    animRaf = 0;
    if (!enabled) return;
    const needFly = !!flyAnim;
    const needCar = carAnim.active && (now < carAnim.holdUntil || now - carAnim.last < 100);
    if (!needFly && !needCar) {
      carAnim.active = false;
      setStageVisible(flyStage, false);
      setStageVisible(carStage, false);
      return;
    }
    try {
      if (needFly) { setStageVisible(flyStage, true); drawFly(now); }
      else setStageVisible(flyStage, false);
      if (needCar) { setStageVisible(carStage, true); drawCarousel(); }
      else setStageVisible(carStage, false);
    } catch (e) {
      console.warn('[Carnet][GL-Lab] 动画层绘制异常', e);
      setStageVisible(flyStage, false); setStageVisible(carStage, false);
      flyAnim = null; carAnim.active = false;
      return;
    }
    /* ⚠️ 最后一帧（动画刚好结束）也必须把两块画布摘出合成树：
       以前只在「下一帧发现没动画」时清理，但收尾那帧直接不排 rAF 了，
       画布会一直 display:block 留在合成树里，白白拖慢后续交互。 */
    if (!flyAnim) setStageVisible(flyStage, false);
    if (!needCar) setStageVisible(carStage, false);
    animDraws++;
    if (flyAnim || needCar) animRaf = requestAnimationFrame(animTick);
    else carAnim.active = false;
  }
  /* 对外给 reader-flow.js / carousel.js 调用（关掉 WebGL 时全部空转） */
  function glFly(a, m, b, ms, reverse) {
    if (!enabled) return;
    flyAnim = {
      a: snapRect(a), m: snapRect(m), b: snapRect(b),
      ms: ms, reverse: !!reverse, t0: performance.now()
    };
    startAnim();
  }
  function glCarouselFrame(off, vel) {
    if (!enabled) return;
    carAnim.off = off; carAnim.vel = vel || 0;
    carAnim.last = performance.now(); carAnim.active = true;
    startAnim();
  }
  function glCarouselHold(ms) {
    if (!enabled) return;
    carAnim.holdUntil = performance.now() + ms;
    carAnim.last = performance.now(); carAnim.active = true;
    startAnim();
  }

  /* ---------------- 合帧调度 ---------------- */
  let lastView = '', draws = 0;
  function viewsActive() {
    const reader = document.getElementById('reader');
    if (reader && reader.classList.contains('show')) return 'reader';
    const wrap = document.getElementById('shelfWrap');
    if (wrap && !wrap.hidden) return 'shelf';
    return '';
  }
  function setStageVisible(st, on) {
    if (!st) return;
    /* ⚠️ 非活跃视图必须 display:none：一块覆盖全屏的透明 WebGL canvas
       只要还留在合成树里，轮播每帧合成就要多算一层，实测掉到 ~24fps。 */
    st.cv.style.display = on ? '' : 'none';
  }
  function clearStage(st) {
    if (st) st.gl.clear(st.gl.COLOR_BUFFER_BIT);
  }
  function enterView(view) {
    if (view === 'shelf') { fit(shelf); fit(shelfBack); }
    else if (readerGL) { fit(readerGL); measureReader(); }
  }
  function sorting() {
    return !!document.querySelector(
      '.shelf-wrap.sorting,.shelf-wrap.sortmode,.carousel-wrap.sortmode');
  }
  function invalidate() {
    dirty = true;
    if (enabled && !raf) raf = requestAnimationFrame(tick);
  }

  /* ---------------- 第十轮：滚动不再需要任何重绘 ----------------
     canvas 挂在 #shelfWrap 里、按内容坐标画一次，之后和书一起被合成线程滚动。
     ⚠️ 别再加 scroll / touchmove / wheel 的 invalidate：既没必要（内容坐标不变），
        又会在持续拖动时把整张内容画布反复重画，反而拖慢滚动。
        只有 resize、书本增删（MutationObserver）、开关 WebGL 才需要重画。 */
  function tick() {
    raf = 0;
    if (!enabled) return;
    const view = viewsActive();
    /* 轮播 / 单层书架：三块画布都摘出合成树，之后完全不碰 DOM 与 GL */
    if (!view) {
      setStageVisible(shelf, false);
      setStageVisible(shelfBack, false);
      setStageVisible(readerGL, false);
      if (lastView) {
        document.documentElement.classList.remove('gl-lab-on');
        clearStage(shelf); clearStage(shelfBack); clearStage(readerGL);
        lastView = '';
      }
      dirty = false;
      return;
    }
    let anim = false;
    try {
      if (view !== lastView) {
        document.documentElement.classList.add('gl-lab-on');
        ensureStage(view);
        setStageVisible(shelf, view === 'shelf');
        setStageVisible(shelfBack, view === 'shelf');
        setStageVisible(readerGL, view === 'reader');
        clearStage(shelf); clearStage(shelfBack); clearStage(readerGL);
        enterView(view);
        lastView = view;
      }
      if (view === 'shelf') drawShelf();
      else anim = drawReader();
    } catch (e) {
      failed = 'WebGL 绘制异常：' + (e && e.message ? e.message : e);
      console.warn('[Carnet][GL-Lab]', failed, e);
      disable();
      return;
    }
    draws++;
    dirty = false;
    if (anim || sorting()) raf = requestAnimationFrame(tick);
  }

  /* ---------------- 生命周期 ---------------- */
  function makeStyle() {
    styleEl = document.createElement('style');
    styleEl.id = 'glLabCss';
    styleEl.textContent = CSS_TEXT;
    document.head.appendChild(styleEl);
  }

  /* ⚠️ 延迟初始化：WebGL context + shader 编译只在**真正要绘制的视图**里做。
     之前 enable() 就在页面加载时建两块 canvas 并编译 program，冷启动这一下
     正好压在用户第一次左右滑动上，实测从 60fps 掉到 ~24fps。轮播 / 单层
     书架永远不会调到这个函数。 */
  function ensureStage(view) {
    if (view === 'shelf') {
      /* ⚠️ 挂在**滚动容器**里而不是 #home：canvas 就是可滚动内容的一部分，
         和书一起被合成线程滚，全程 GPU、不依赖 scroll 重绘。 */
      const wrap = document.getElementById('shelfWrap');
      if (shelf && !document.getElementById('glLabShelf')) shelf = null;
      if (shelfBack && !document.getElementById('glLabShelfBack')) shelfBack = null;
      if (!shelf && wrap) { shelf = makeStage(wrap, 'glLabShelf'); shelf.contentSized = true; }
      if (!shelfBack && wrap) { shelfBack = makeStage(wrap, 'glLabShelfBack'); shelfBack.contentSized = true; }
      /* 铆钉 PNG 只给书前层用；异步上传完成后 invalidate() 重画一帧 */
      loadRivetTex(shelf);
      return shelf;
    }
    if (view === 'reader') {
      if (readerGL && !document.getElementById('glLabReader')) readerGL = null;
      if (!readerGL) {
        const stage = document.getElementById('stage');
        /* first=true：排在 .book 之前，让书盖住柔影中心 */
        if (stage) readerGL = makeStage(stage, 'glLabReader', true);
      }
      return readerGL;
    }
    return null;
  }

  function watch() {
    if (observer) return;
    observer = new MutationObserver(() => {
      if (!enabled) return;
      invalidate();
    });
    /* #leaf 的 style 每帧被 page-flip.js 改写，正好用来驱动翻页光晕逐帧重画；
       invalidate() 有 rAF 合帧，不会重复排帧。 */
    const optA = { attributes: true, attributeFilter: ['class', 'style', 'hidden'] };
    [document.getElementById('home'), document.getElementById('reader'),
      document.getElementById('leaf')]
      .forEach(el => { if (el) observer.observe(el, optA); });
    const wrap = document.getElementById('shelfWrap');
    if (wrap) observer.observe(wrap, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'hidden'] });
  }

  function enable() {
    if (enabled) return true;
    if (failed) return false;
    try {
      /* 只挂 CSS（选择器此时不匹配）与观察器：canvas / context / shader 等真正
         要画时再建，gl-lab-on 这个 class 也等进入书架 / 阅读器视图才加 ——
         否则刚在设置页拨开开关就触发一次全页样式重算，紧接着左右滑动会顿一下。 */
      makeStyle();
      enabled = true;
      watch();
      invalidate();
    } catch (e) {
      failed = 'WebGL 初始化失败：' + (e && e.message ? e.message : e);
      console.warn('[Carnet][GL-Lab]', failed, e);
      disable();
      return false;
    }
    return true;
  }

  function disable() {
    enabled = false;
    if (raf) { cancelAnimationFrame(raf); raf = 0; }
    document.documentElement.classList.remove('gl-lab-on');
    if (styleEl) { styleEl.remove(); styleEl = null; }
    if (animRaf) { cancelAnimationFrame(animRaf); animRaf = 0; }
    if (flyStage) { flyStage.cv.remove(); flyStage = null; }
    if (carStage) { carStage.cv.remove(); carStage = null; }
    flyAnim = null; carAnim.active = false;
    if (shelf) { shelf.cv.remove(); shelf = null; }
    if (shelfBack) { shelfBack.cv.remove(); shelfBack = null; }
    if (readerGL) { readerGL.cv.remove(); readerGL = null; }
    readerGeom = null;
    lastView = '';
  }

  /* 设置页开关统一走 set()：这是「设定值」语义，不是 toggle 的「翻转」语义，
     并且负责把用户的显式选择落盘。⚠️ enable()/disable() 都不写存储，只给内部 /
     控制台调试用；URL 的 ?gl=1/?gl=0 只在首次启动时强制一次，用户在设置页
     拨过开关后清掉 forced 并摘掉 URL 参数，之后一律以 localStorage 为准，
     避免刷新时被 URL 又拽回去（「关不掉」）。 */
  function set(v) {
    forced = null;
    dropUrlFlag();
    const on = !!v;
    if (on) { if (!enable()) return false; }
    else disable();
    writeStored(on);
    return true;
  }
  function toggle() { set(!enabled); return enabled; }

  /* 第十轮起不再挂任何 pointer / scroll / wheel / touch 监听：
     书架画布是一次性画在内容坐标里的，滚动期间主线程完全不需要介入。
     pointer 只作为 shader 的 uPointer 默认值（书架没用到镜面光斑分支）。 */

  function boot() {
    if (booted) return;
    booted = true;
    /* ⚠️ 只保留 resize：书架画布是「内容坐标一次画好、随内容滚」，
       滚动 / 触摸 / 滚轮一律不需要重绘；书本增删由 watch() 的 MutationObserver 触发。
       pointermove 也别挂 —— 它会让鼠标每动一下就把整张内容画布重画一遍。 */
    window.addEventListener('resize', invalidate, { passive: true });
    const want = forced === null ? readStored() : forced;
    if (want) enable();
  }

  window.GLLab = {
    enable: enable,
    disable: disable,
    set: set,
    toggle: toggle,
    /* 第十一轮：三类动画由各自模块把状态递给 GPU 层（关闭时全部空转） */
    fly: glFly,
    carouselFrame: glCarouselFrame,
    carouselHold: glCarouselHold,
    status: function () {
      return {
        on: enabled,
        shelf: !!shelf,
        shelfBack: !!shelfBack,
        rivetTex: !!(shelf && shelf.hasTex),
        reader: !!readerGL,
        failed: failed,
        /* 调试用：'' = 轮播 / 单层（0 帧绘制），'shelf' / 'reader' = 在画 */
        view: lastView,
        draws: draws,
        /* 动画光影层：飞入 / 轮播按需画布，静止时应为 0 且 display:none */
        animDraws: animDraws,
        fly: !!flyAnim,
        carousel: carAnim.active
      };
    },
    get on() { return enabled; }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
