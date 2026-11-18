/* =====================================================================
 * Carnet · Liquid Glass（移动端模式切换的 WebGL 折射层）
 * ---------------------------------------------------------------------
 * 纯 CSS 只能拿 border-radius / drop-shadow 去「假装」折射；这里用一段
 * fragment shader 真算一遍：
 *   · superellipse SDF（n≈4.2）= 参考图那种四边平直、四角连续圆角的玻璃块
 *   · 解析法线 + 只在边缘生效的位移 = 球面透镜折射
 *   · R/G/B 三次不同折射率采样 = 真实色散（不是画一圈彩虹）
 *   · fresnel + 极细 rim = 高透明度玻璃，白边只在最外沿一丝
 *
 * ⚠️ 浏览器不允许 WebGL 直接采样 DOM 像素，所以把三颗图标（从 DOM svg
 *    clone 出来，保持同源）离屏画成一张透明纹理，只折射这层内容；
 *    canvas 本身透明，页面背景照常透过它显示。
 * ⚠️ 这是个「按需绘制」的层：只有长按激活 / 手指移动才 draw 一帧，
 *    静止与松手后 0 帧、canvas display:none（和 gl-lab.js 同一条红线）。
 * ⚠️ 由 m-home.js 动态加载，不写进 index.html 的脚本顺序 —— 那个文件
 *    会被本地编辑器还原，写进去就可能丢。WebGL 不可用时静默退回 CSS 版。
 * ===================================================================== */
(function () {
  'use strict';

  const W = 152, H = 56;            // 三格控件尺寸（5+46*3+2*2+5 / 5+46+5）
  const PAD_X = 28, PAD_Y = 24;     // canvas 相对控件外扩，容纳溢出的玻璃与光晕
  const CW = W + PAD_X * 2, CH = H + PAD_Y * 2;
  const N = 3.4;                    // superellipse 指数：越小圆角越大（3.4 ≈ 参考图的圆角玻璃块）

  const VS = `
attribute vec2 aPos;
varying vec2 vUv;
void main(){ vUv = aPos * .5 + .5; gl_Position = vec4(aPos, 0., 1.); }`;

  const FS = `
precision highp float;
varying vec2 vUv;
uniform vec2 uRes, uOrigin, uCenter, uHalf, uTexSize;
uniform float uBend;
uniform sampler2D uTex;
const float N = ${N.toFixed(2)};

void main(){
  /* p = 控件坐标系（px，y 向下） */
  vec2 p = vec2(vUv.x * uRes.x, (1. - vUv.y) * uRes.y) + uOrigin;
  vec2 d = (p - uCenter) / uHalf;
  float ax = abs(d.x), ay = abs(d.y);
  float q = pow(ax, N) + pow(ay, N);
  if (q > 1.42) discard;                       // 玻璃体 + 外圈柔光之外全透明

  /* SDF 的解析梯度 = 指向外侧的法线；只在边缘推图像，中心保持清晰 */
  vec2 g = vec2(pow(ax, N - 1.) * sign(d.x) / uHalf.x,
                pow(ay, N - 1.) * sign(d.y) / uHalf.y);
  g = normalize(g + vec2(1e-6));
  float edge = smoothstep(.40, 1., q);
  vec2 disp = g * edge * uBend;

  /* 三次采样：折射率差 + 沿法线错开 = 真实色散，图标边缘被拉出橙 / 蓝弧 */
  vec2 uv = p / uTexSize;
  float ca = .32;
  float aR = texture2D(uTex, uv + disp * (1. + ca) / uTexSize + g * 1.3 / uTexSize).a;
  float aG = texture2D(uTex, uv + disp / uTexSize).a;
  float aB = texture2D(uTex, uv + disp * (1. - ca) / uTexSize - g * 1.3 / uTexSize).a;
  float ia = max(max(aR, aG), aB) * smoothstep(.30, .88, q) * .9;
  vec3 icon = vec3(1.) - vec3(aR, aG, aB) * vec3(.78, .82, .88);
  vec3 fringe = vec3(abs(aR - aG), 0., abs(aB - aG)) * 2.2;

  /* 高透明度玻璃：中心几乎不存在，只在外沿有几像素的亮边与 fresnel */
  float fres = pow(smoothstep(.30, 1., q), 3.);
  float halo = step(1., q) * (1. - smoothstep(1., 1.34, q));
  float band = smoothstep(.74, .98, q) * (1. - smoothstep(1., 1.12, q));
  /* 白边其实由 R/G/B 三条略微错开的亮线组成 —— 色散就藏在这几条线的
     错位里，而不是画一圈均匀彩虹；加宽一点顺便消掉 1px 走样。 */
  float rR = smoothstep(.800, .985, q) * (1. - smoothstep(.985, 1.075, q));
  float rG = smoothstep(.815, 1.000, q) * (1. - smoothstep(1.000, 1.090, q));
  float rB = smoothstep(.830, 1.015, q) * (1. - smoothstep(1.015, 1.105, q));
  vec3 split = vec3(rR, rG, rB);
  /* ⚠️ 色散按「边缘朝向」钉死在固定位置，别用极角绕圈渐变（会随拖动乱转、
     和参考图对不上）：左暖橙 / 右冷蓝 / 上暖白 / 下淡紫。
     再按图标所在的水平带加权 —— 参考图里最亮的彩边就出现在左右两端
     与图标交界的地方，上下边缘只留淡淡一丝。 */
  vec3 warm   = vec3(1., .70, .30);
  vec3 cool   = vec3(.34, .60, 1.);
  vec3 violet = vec3(.68, .52, 1.);
  vec3 topW   = vec3(1., .93, .70);
  /* ⚠️ smoothstep 必须 edge0 < edge1，反向写法在 GLSL 里是未定义行为
     （色散位置会整个错乱），要取反就写 1. - smoothstep(...)。 */
  float leftW  = 1. - smoothstep(-.88, .10, g.x);
  float rightW = smoothstep(.10, .88, g.x);
  float upW    = 1. - smoothstep(-.88, .10, g.y);
  float downW  = smoothstep(.10, .88, g.y);
  vec3 dirCA = warm * leftW + cool * rightW
             + topW * upW * .75 + violet * downW * .75;
  float iconBand = exp(-pow((p.y - 28.) / 17., 2.));
  float caGain = .38 + .62 * iconBand;
  float topHi = (1. - smoothstep(-.92, -.25, d.y)) * band * .16;
  float botHi = smoothstep(.35, .95, d.y) * band * .07;

  vec3 glass = vec3(1.) * (rG * .10 + fres * .045 + halo * .045);
  glass += split * dirCA * 1.25 * caGain;              // 三条错开亮线 = 棱镜色散
  glass += dirCA * band * .20 * caGain;                // 边缘内侧的淡彩色带
  glass += vec3(1., .96, .86) * topHi + vec3(.82, .90, 1.) * botHi;

  vec3 col = mix(glass, icon + fringe, ia);
  float alpha = clamp(rG * .34 + fres * .045 + halo * .045
                      + band * .05 + ia * .78, 0., .9);
  gl_FragColor = vec4(col, alpha);
}`;

  let sw = null, cv = null, gl = null, prog = null, tex = null, uni = {};
  let dpr = 1, okFlag = false, active = false;
  let cx = 28, halfX = 38, halfY = 32, bend = 13;

  function compile(type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      console.warn('[LiquidGlass] shader:', gl.getShaderInfoLog(s));
      gl.deleteShader(s); return null;
    }
    return s;
  }

  function svgURL(svg, color) {
    const c = svg.cloneNode(true);
    c.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    c.setAttribute('width', '21'); c.setAttribute('height', '21');
    const str = new XMLSerializer().serializeToString(c).replace(/currentColor/g, color);
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(str);
  }

  /* 图标纹理：透明底 + 三颗 21px 图标，位置与真实 DOM 一一对齐 */
  function buildTexture(host) {
    const oc = document.createElement('canvas');
    oc.width = W * 2; oc.height = H * 2;
    const ctx = oc.getContext('2d');
    if (!ctx) return false;
    ctx.scale(2, 2);
    const svgs = [...host.querySelectorAll('button[data-mv] svg')];
    if (svgs.length !== 3) return false;
    Promise.all(svgs.map(svg => new Promise(res => {
      const im = new Image();
      im.onload = () => res(im);
      im.onerror = () => res(null);
      im.src = svgURL(svg, '#596070');
    }))).then(imgs => {
      if (!gl || !tex) return;
      imgs.forEach((im, i) => {
        if (im) ctx.drawImage(im, 17.5 + 48 * i, 17.5, 21, 21);
      });
      gl.bindTexture(gl.TEXTURE_2D, tex);
      /* 不做 UNPACK_FLIP_Y：canvas 第一行就是控件顶部，uv.y=0 正好对应它 */
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, oc);
      if (active) draw();
    });
    return true;
  }

  function attach(host) {
    if (prog || !host) return okFlag;
    sw = host;
    try {
      cv = document.createElement('canvas');
      cv.className = 'ms-gl-canvas';
      cv.setAttribute('aria-hidden', 'true');
      cv.style.width = CW + 'px'; cv.style.height = CH + 'px';
      dpr = Math.min(2, window.devicePixelRatio || 1);
      cv.width = Math.round(CW * dpr); cv.height = Math.round(CH * dpr);
      gl = cv.getContext('webgl', {
        alpha: true, premultipliedAlpha: false, antialias: true, depth: false
      }) || cv.getContext('experimental-webgl', { alpha: true, premultipliedAlpha: false });
      if (!gl) return (okFlag = false);

      const vs = compile(gl.VERTEX_SHADER, VS), fs = compile(gl.FRAGMENT_SHADER, FS);
      if (!vs || !fs) return (okFlag = false);
      prog = gl.createProgram();
      gl.attachShader(prog, vs); gl.attachShader(prog, fs); gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
        console.warn('[LiquidGlass] link:', gl.getProgramInfoLog(prog));
        return (okFlag = false);
      }
      gl.deleteShader(vs); gl.deleteShader(fs);

      const buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
      const loc = gl.getAttribLocation(prog, 'aPos');
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

      ['uRes', 'uOrigin', 'uCenter', 'uHalf', 'uTexSize', 'uBend', 'uTex']
        .forEach(n => { uni[n] = gl.getUniformLocation(prog, n); });

      tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE,
        new Uint8Array([0, 0, 0, 0]));

      gl.disable(gl.DEPTH_TEST);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.useProgram(prog);
      gl.uniform2f(uni.uRes, CW, CH);
      gl.uniform2f(uni.uOrigin, -PAD_X, -PAD_Y);
      gl.uniform2f(uni.uTexSize, W, H);
      gl.uniform1i(uni.uTex, 0);

      sw.appendChild(cv);
      buildTexture(sw);
      okFlag = true;
    } catch (e) {
      console.warn('[LiquidGlass] unavailable:', e && e.message);
      okFlag = false;
    }
    return okFlag;
  }

  function draw() {
    if (!okFlag || !gl || !prog || !active) return;
    gl.viewport(0, 0, cv.width, cv.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(prog);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.uniform2f(uni.uCenter, cx, H / 2);
    gl.uniform2f(uni.uHalf, halfX, halfY);
    gl.uniform1f(uni.uBend, bend);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  /* px = 滑块位移（0 / 48 / 96 或拖动中的连续值）；dragging 决定玻璃被拉长的档位 */
  function frame(px, dragging) {
    if (!okFlag) return;
    cx = 28 + px;
    halfX = 46 * (dragging ? 2.1 : 1.65) / 2;
    halfY = 46 * (dragging ? 1.48 : 1.39) / 2;
    bend = dragging ? 16 : 13;
    draw();
  }

  function setActive(on, px, dragging) {
    if (!okFlag) return false;
    active = !!on;
    if (cv) cv.style.display = active ? 'block' : 'none';
    if (active) frame(px == null ? 0 : px, !!dragging);
    return true;
  }

  window.LiquidGlass = {
    attach,
    frame,
    setActive,
    get ok() { return okFlag; }
  };
})();
