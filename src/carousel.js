/* =====================================================================
 * Carnet · 主页 · 左右滑动轮播   （脚本 13 / 28）
 * ---------------------------------------------------------------------
 * ① 排布与跟手：按屏幕比例算书的大小与间距 layoutCarousel
 * ② 滑动松手后落到最近的一本、居中吸附
 * ③ selectJournal / consumeClick 对外入口
 *
 * 对外接口：carousel.layoutCarousel, carousel.selectJournal, carousel.consumeClick
 *
 * 依赖模块：core, state
 *
 * 说明：模块间共用全局作用域，加载顺序即依赖顺序（见 index.html 与 README）。
 * ===================================================================== */
const carousel = (() => {
  const wrap = $('#carouselWrap'), track = $('#carousel');
  const EASE = 'transform .46s cubic-bezier(.22,.92,.24,1)';
  /* 惯性滑行中每次换本都要刷 1/N 计数，缓存节点免得逐帧 querySelector */
  let countPillEl = null;
  function countPill() {
    if (!countPillEl || !countPillEl.isConnected) countPillEl = $('#countPill');
    return countPillEl;
  }
  let items = [], off = 0, minOff = 0, maxOff = 0;
  let dragging = false, moved = false, startX = 0, startOff = 0, lastX = 0, lastT = 0, vel = 0;
  let suppressClick = false;
  let holdTimer = 0, pendingEl = null, pendingX = 0, pendingY = 0, sorting = null;
  /* 触控板横滑：是否正处在「连续跟手」中、停手落位定时器、
     本次手势累计的横向位移与起手时选中的本子（用于单格滚轮补一本） */
  let wheelGliding = false, wheelSettleT = 0, wheelTravel = 0, wheelFrom = 0;
  let wheelVel = 0, wheelLastT = 0;       // px / s；到边弹簧要继承真实滚轮速度
  const HOLD_MS = 420;                          // 长按多久进入排序

  /* 每本书的中心点 / 宽度只在 measure() 里量一次，之后一直复用：
     translate / scale 走的是 transform，不参与布局，拖动过程中这两个数不会变。
     原来是边写 el.style.transform 边读 el.offsetWidth —— 写一次就强制重排一次，
     n 本书就是每帧 n 次重排，拖起来发涩全花在这上面。 */
  let mets = [], wrapW = 0, lastK = [], lastF = [];
  /* 拖动 / 惯性期间冻结 filter：saturate+brightness 每改一次都要把整本书
     （封面图案、纹理、box-shadow 全在里面）重新栅格化一次，滑动时会出现
     一闪一闪的深色残影。明暗只差 14% 饱和 / 6% 亮度，跟手过程中保持不变
     肉眼几乎看不出；松手 snap() 解除冻结后由 styleItems() 直接写最终档位。
     ⚠️ 11-19 实测：给 filter 加任何时长的 CSS transition 都会让惯性后半段 +
     吸附段逐帧重栅格化整本封面，帧率从 60 掉到 ~43fps（950ms 里 12 帧 >33ms）。
     1/16 档量化本身已经足够平滑，绝不要再给 filter 接过渡。 */
  let freezeFilter = false;
  /* 手势进行中给 track 加 .gliding：暂时摘掉逐本 filter（见 home.css 的说明）。
     只在「开始 / 结束」切换，绝不每帧碰 classList。 */
  let glidingOn = false;
  function setGliding(on) {
    if (glidingOn === on) return;
    glidingOn = on;
    track.classList.toggle('gliding', on);
  }
  /* 记录上一回 ease() 写进去的档位与节点集合：CSSOM 读回 style.transition 会
     被浏览器规范化（.46s → 0.46s 等），拿字符串直接 diff 会永远判成不等。 */
  let lastEase = -1, easedItems = null;
  /* 只有「节点换了」或「视口变了」才重新量布局。
     拖动松手 / 滚轮换本都会调 snap()，以前每次都把 n 本书的 offsetLeft / offsetWidth
     读一遍 —— CSS transform 刚写完就同步读布局，是一次强制重排，落在松手那一下最明显。
     书没换、视口没动时这些数一个都不会变，直接沿用。 */
  function measure(force) {
    const els = [...track.children];
    const changed = force || els.length !== items.length || els.some((el, i) => el !== items[i]);
    if (!changed) return;
    items = els;
    wrapW = wrap.clientWidth;
    mets = items.map(el => ({ c: el.offsetLeft + el.offsetWidth / 2, w: el.offsetWidth }));
    lastK = items.map(() => NaN);     // 节点重建过，下一帧必须全量写一次
    lastF = items.map(() => NaN);     // filter 档位同理，必须重新写一遍
    minOff = maxOff = 0;
    if (!items.length) return;
    maxOff = wrapW / 2 - mets[0].c;
    minOff = wrapW / 2 - mets[mets.length - 1].c;
    if (minOff > maxOff) { const t = minOff; minOff = maxOff; maxOff = t; }
  }
  function styleItems() {
    const view = wrapW / 2 - off, edge = wrapW / 2;
    for (let i = 0; i < items.length; i++) {
      const m = mets[i], prev = lastK[i];
      const span = Math.max(m.w * 1.25, 1);
      const dist = Math.abs(m.c - view);
      const k = dist >= span ? 0 : 1 - dist / span;
      /* ⚠️ filter 每帧改值会让浏览器重新栅格化整本书（封面图案 / 纹理 /
         阴影全在里面），是拖动时最贵的一笔，也是「左右滑动发涩」的主因。
         把明暗强度量化到 1/16 档：scale 仍然每帧连续跟手，filter 只在跨档时
         写一次 CSSOM，重栅格次数降一个数量级，16 档的阶梯肉眼看不出来；
         拖动 / 惯性期间 freezeFilter 直接不写，松手 snap() 解除后一次写到位，
         ⚠️ 不要在这里给 filter 接 CSS transition（见上面 freezeFilter 的实测说明）。 */
      const fq = Math.round(k * 16) / 16;
      const needF = !freezeFilter && lastF[i] !== fq;
      /* 屏幕外、上次就已经熄灭、滤镜也已是熄灭态：连除法都不必算。
         ⚠️ 必须把 needF 一起判断 —— 冻结期间 lastF 可能还停在亮的那档，
            松手后这一本要靠这次写入补回熄灭态，不能被 continue 跳过。
         中心点 / 宽度是布局值，transform 不影响它们，measure() 后一直有效。 */
      if (dist > edge + span && prev === 0 && !needF) continue;
      /* 只写真正变了的书：拖动时绝大多数书 k 恒为 0，中心附近 1~2 本在变。
         ⚠️ 阈值 .0002 是照着 scale 的 toFixed(4) 精度算的 —— 小于它时
         scale 串不会变，跳过写 DOM 不会有任何像素差异。
         但这个 continue 只管 transform：滤镜要单独判，否则冻结结束后
         「k 没变的那本」会永远停在拖动前的明暗上。 */
      const kChanged = !(Number.isFinite(prev) && Math.abs(k - prev) < .0002);
      const el = items[i];
      if (kChanged) {
        lastK[i] = k;
        el.style.transform = `scale(${(1 + 0.055 * k).toFixed(4)})`;
      }
      if (needF) {
        lastF[i] = fq;
        el.style.filter = `saturate(${(0.86 + 0.14 * fq).toFixed(3)}) brightness(${(0.94 + 0.06 * fq).toFixed(3)})`;
      }
    }
  }
  function paint() {
    track.style.transform = `translate3d(${off.toFixed(2)}px,0,0)`;
    styleItems();
    /* 第十一轮：把位移 / 速度递给 WebGL 光影层（纯数值，不读布局）。
       静止后 GPU 层会自动停帧并把画布 display:none，不会拖慢左右滑动。 */
    if (window.GLLab && GLLab.on) GLLab.carouselFrame(off, vel);
  }
  /* 跟手那一下按帧画：pointermove 一秒能来上百次，每次都立刻写样式会把主线程堵住。
     攒到下一帧统一画一次 —— 看上去一样跟手，掉帧没了。snap() 走的是带缓动的落位，直接 paint。 */
  let paintRaf = 0;
  function schedulePaint() {
    if (paintRaf) return;
    paintRaf = requestAnimationFrame(() => { paintRaf = 0; paint(); });
  }
  function cancelPaint() { if (paintRaf) { cancelAnimationFrame(paintRaf); paintRaf = 0; } }
  function ease(animate) {
    /* 只写值变了的节点：ease(false) 在每次 pointerdown 都会调，
       书没换时整排 transition 本来就是这个值，全量写是白写的 CSSOM 操作。
       measure() 重建过 items（引用变了）时必须重新写一遍。 */
    const k = animate ? 1 : 0;
    if (lastEase !== k || easedItems !== items) {
      lastEase = k; easedItems = items;
      const t = animate ? EASE : 'none';
      track.style.transition = t;
      /* ⚠️ 只过渡 transform。原来这里是 EASE + ',filter .46s ease'：
         filter 每帧插值都要把整本封面（纹理 / 图案 / box-shadow）重新栅格化，
         惯性收尾的吸附段实测掉到 ~43fps。滤镜值由 styleItems() 量化后一次写到位。 */
      for (let i = 0; i < items.length; i++) items[i].style.transition = t;
    }
    /* 吸附是 CSS transition（中间帧没有 JS paint），让 GPU 光影层按同样时长继续画 */
    if (animate && window.GLLab && GLLab.on) GLLab.carouselHold(460);
  }
  /* ===== 松手惯性 =====
     vel 的单位是 px/帧（pointermove 里已按 16.7ms 归一），摩擦按帧衰减。
     以前松手是「算一个投影目标 → CSS 缓动一次跳过去」，快甩也只能跨两本，
     手上没有"东西还在滑"的感觉。现在按初速逐帧滑行，末端仍吸附到最近一本。
     惯性期间 track 的 transition 保持 'none'（pointerdown 的 ease(false) 设的），
     每帧位移立即生效；只有收尾 snap() 才打开缓动补最后一点距离。 */
  let inertRaf = 0, inertVel = 0, inertT = 0, inertV0 = 0, inertStartOff = 0;
  function stopInertia() {
    if (inertRaf) { cancelAnimationFrame(inertRaf); inertRaf = 0; }
    inertVel = 0; inertT = 0; inertV0 = 0;
  }
  function nearestIndex() {
    const view = wrapW / 2 - off;
    let best = 0, bd = Infinity;
    for (let i = 0; i < mets.length; i++) {
      const d = Math.abs(mets[i].c - view);
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  }
  /* 跟手 / 惯性 / 触控板滑行中「选中态跟着走」的统一入口：
     只动进出 active 的两本 + 计数球，绝不碰书名 / 页数 / 整块重绘，
     也不改 off —— 位置由各自的动画自己负责。state.sel 实时同步，
     滑行途中点开的一定是视觉中心那本。 */
  function syncSelection(near) {
    if (near === state.sel) return;
    if (items[state.sel]) items[state.sel].classList.remove('active');
    state.sel = near;
    if (items[near]) items[near].classList.add('active');
    const cp = countPill();
    if (cp) cp.textContent = `${near + 1} / ${items.length}`;
  }
  /* ===== 到两端的弹性回弹 =====
     用保留初速度的欠阻尼弹簧，替代固定振幅 / 固定周期的余弦往返。
     旧曲线会把一次轻微越界人为放大到 28~80px，再以 340ms 周期来回弹，
     起手像被额外推一下、收尾又反复折返，所以弹性虽大却生硬。
     现在 x0 严格等于当前越界量，v0 继承手指 / 惯性 / 滚轮的真实方向：
     先顺势送出，再柔和拉回，只留一次很小的反向过冲。解析解按秒计算，
     高刷 / 掉帧都不会改变弹簧手感，也不在帧内读任何布局。 */
  const BOUNCE_MAX = 80, BOUNCE_OMEGA = 14, BOUNCE_ZETA = .58, BOUNCE_END = 650;
  let bounceRaf = 0, bouncing = false, edgeSettled = false;
  function stopBounce() {
    if (bounceRaf) { cancelAnimationFrame(bounceRaf); bounceRaf = 0; }
    bouncing = false;
    edgeSettled = false;
  }
  function edgeBounce(target, over, done, v0 = 0) {
    stopInertia();
    stopBounce();
    bouncing = true;
    /* 方向取当前位置而不是 target===minOff：只有一本书时 minOff===maxOff，
       两个边界重合，按索引判断会把向右拖出的回弹错画到左侧。 */
    const outward = off < target ? -1 : 1;
    const x0 = clamp(over, 0, BOUNCE_MAX);
    const damping = BOUNCE_OMEGA * BOUNCE_ZETA;
    const omega = BOUNCE_OMEGA * Math.sqrt(1 - BOUNCE_ZETA * BOUNCE_ZETA);
    /* 越限保护只限制异常大的 wheel delta；普通快甩仍保留向外速度，
       反向松手也允许带负速度，不会在切入弹簧时突然改变运动方向。 */
    const speed0 = clamp((v0 || 0) * outward, -360, 360);
    const a = x0, b = (speed0 + damping * x0) / omega;
    const t0 = performance.now();
    const step = now => {
      bounceRaf = 0;
      const t = Math.min((now - t0) / 1000, BOUNCE_END / 1000);
      const decay = Math.exp(-damping * t), angle = omega * t;
      const cos = Math.cos(angle), sin = Math.sin(angle);
      const x = decay * (a * cos + b * sin);
      const speed = decay * ((b * omega - damping * a) * cos - (a * omega + damping * b) * sin);
      off = target + outward * x;
      paint();
      if ((t > .12 && Math.abs(x) < .45 && Math.abs(speed) < 18) || t >= BOUNCE_END / 1000) {
        off = target; paint();
        bouncing = false;
        if (done) done();               // done 里的 snap() 会 stopBounce()，所以锁要放在它之后
        edgeSettled = true;             // 收敛完进入「到头锁定」，同向余波不再重启回弹
        return;
      }
      bounceRaf = requestAnimationFrame(step);
    };
    off = target + outward * x0;
    paint();
    bounceRaf = requestAnimationFrame(step);
  }
  function settle() { stopInertia(); snap(nearestIndex(), true); }
  function startInertia(v0) {
    stopInertia();
    inertVel = clamp(v0, -48, 48);          // px / 帧，供速度光影与收尾阈值使用
    if (Math.abs(inertVel) < 1.2) { settle(); return; }
    inertV0 = inertVel * 60;                // springboard decay 使用 px / 秒
    inertStartOff = off;
    inertT = performance.now();
    const step = now => {
      inertRaf = 0;
      const elapsed = Math.max(0, (now - inertT) / 1000);
      const M = window.CarnetMotion;
      if (M) {
        off = inertStartOff + M.decay(inertV0, elapsed);
        inertVel = M.decayVelocity(inertV0, elapsed) / 60;
      } else {
        /* 库尚未加载的短暂降级：保留旧摩擦模型，下一次手势自动使用 Decay。 */
        const dt = .5 + Math.min(elapsed * 60, 1);
        off += inertVel * dt;
        inertVel *= Math.pow(.94, dt);
      }
      /* 撞到两端：保留 Decay 的即时速度，连续交给弹性回弹。 */
      const edge = off < minOff ? minOff : off > maxOff ? maxOff : null;
      if (edge !== null) {
        const over = Math.min(Math.abs(off - edge), BOUNCE_MAX);
        if (over >= BOUNCE_MAX || Math.abs(inertVel) < 2.5) {
          off = edge + (off < edge ? -1 : 1) * over;
          edgeBounce(edge, over, () => snap(nearestIndex(), false), inertVel * 16.7);
          return;
        }
      }
      paint();
      syncSelection(nearestIndex());
      if (Math.abs(inertVel) < .35 || elapsed > 4) { settle(); return; }
      inertRaf = requestAnimationFrame(step);
    };
    inertRaf = requestAnimationFrame(step);
  }
  function snap(i, animate) {
    stopInertia();                       // 外部换本 / 滚轮 / 重排都要先掐掉惯性
    stopBounce();                        // 弹性回弹途中被外部换本打断也要停
    freezeFilter = false;               // 落位这一帧补回拖动期间冻结的明暗
    setGliding(false);                  // 落位即恢复逐本滤镜，静止画面不变
    measure();
    if (!items.length) { track.style.transform = 'translate3d(0,0,0)'; return; }
    const idx = clamp(i, 0, items.length - 1);
    state.sel = idx;
    items.forEach((el, k) => el.classList.toggle('active', k === idx));
    const j = cur();
    if (j) {
      setHomeName(j.name);
      $('#homePages').innerHTML = `<span>▤</span><span>${j.pages.length} 页</span>`;
    }
    const cp = countPill();
    if (cp) cp.textContent = `${idx + 1} / ${items.length}`;
    off = wrapW / 2 - mets[idx].c;
    ease(animate);
    paint();
  }

  /* ===== 长按拖动排序：把一本「拎起来」跟手走，左右拖到目标位置，松手落位 =====
     被拖的那本 X / Y 都跟着手指（像多层书架的悬浮副本）；其余书仍只按**横向**位置让位，
     所以上下挪动只影响手上这一本的外观，不会把顺序搅乱。 */
  function buzz(ms) { try { navigator.vibrate && navigator.vibrate(ms); } catch (_) {} }
  function beginSort(el, x, y) {
    const els = [...track.children];
    const from = els.indexOf(el);
    if (from < 0 || els.length < 2) return;
    const bases = els.map(e => e.offsetLeft);
    /* 宽度也在起手量一次：排序重绘每帧都要用它算缩放，原来 mets 缺项时
       会在 rAF 里读 e.offsetWidth（写 transform 的同一帧强制同步布局）。 */
    const widths = els.map(e => e.offsetWidth);
    const step = Math.abs(bases[1] - bases[0]) || el.offsetWidth;
    sorting = { el, els, bases, widths, step, from, to: from, lastTo: from,
                startX: x, startY: y, x, y, dx: 0, dy: 0,
                scroll: 0, auto: 0, raf: 0, lastT: 0, dragged: false,
                wrapRect: wrap.getBoundingClientRect() };  // 拖动期间容器不动，边缘判定只量这一次
    dragging = false; vel = 0;                  // 交出横向滚动的控制权
    stopInertia();
    wrap.classList.add('sortmode');
    el.classList.add('picked');
    applySort();
  }
  /* 手指拖不动了（到屏幕边）就用 scroll 接力：其余的书持续往反方向送，
     远处够不着的手帐本会一路被送到手边 */
  function autoTick(now) {
    const s = sorting;
    if (!s || !s.auto) { if (s) s.raf = 0; return; }
    const dt = Math.min(now - s.lastT, 60) / 1000;
    s.lastT = now;
    /* 边界直接算成两个标量：原来 scrollRange() 每帧 new 一个数组再解构，
       自动滚动时一秒 60 个短命数组，纯属白给 GC 添活。 */
    const a = -s.from * s.step - s.dx, b = (s.els.length - 1 - s.from) * s.step - s.dx;
    const lo = Math.min(a, b), hi = Math.max(a, b);
    const speed = s.step * (1.8 + 2.2 * (s.depth || 0));   // 手指越贴边，送得越快
    s.scroll = clamp(s.scroll + s.auto * speed * dt, lo, hi);
    applySortNow();                           // 自动滚动本身就在帧里，立刻画，不排队到下一帧
    s.raf = requestAnimationFrame(autoTick);
  }
  /* 排序的重画统一收口到一帧一次：pointermove 和边缘自动滚动的 rAF 可能在同一帧
     都要求重画，各写一次的话 n 本书会被写两遍。 */
  let sortRaf = 0;
  function scheduleSort() {
    if (sortRaf) return;
    sortRaf = requestAnimationFrame(() => { sortRaf = 0; applySort(); });
  }
  function applySortNow() {
    if (sortRaf) { cancelAnimationFrame(sortRaf); sortRaf = 0; }
    applySort();
  }
  function applySort() {
    const s = sorting; if (!s) return;
    /* 目标格只认横向位移：纵向位移纯粹是「拎起来」的视觉，不参与换位 */
    s.to = clamp(s.from + Math.round((s.dx + s.scroll) / s.step), 0, s.els.length - 1);
    if (s.to !== s.lastTo) { s.lastTo = s.to; buzz(8); }
    s.el.style.transform = `translate(${s.dx.toFixed(1)}px,${s.dy.toFixed(1)}px) scale(1.07) rotate(-1.5deg)`;
    const view = wrapW / 2 - off;
    for (let i = 0; i < s.els.length; i++) {
      const e = s.els[i];
      if (e === s.el) continue;
      let shift = 0;
      if (s.to > s.from) { if (i > s.from && i <= s.to) shift = -s.step; }
      else if (s.to < s.from) { if (i >= s.to && i < s.from) shift = s.step; }
      shift -= s.scroll;
      /* 优先用 measure() 量好的中心 / 宽度，退化时用起手缓存的布局值，
         两条路都不碰 DOM 布局读取；也不再每帧建 fallback 临时对象。 */
      const m = mets[i];
      const c = m ? m.c : s.bases[i] + s.widths[i] / 2;
      const mw = m ? m.w : s.widths[i];
      const d = Math.abs(c + shift - view) / Math.max(mw * 1.25, 1);
      const k = Math.max(0, 1 - d);
      e.style.transform = `translateX(${shift.toFixed(1)}px) scale(${(1 + 0.055 * k).toFixed(4)})`;
    }
  }
  function moveSort(x, y) {
    const s = sorting;
    s.x = x; s.y = y;
    s.dx = x - s.startX; s.dy = y - s.startY;
    if (Math.abs(s.dx) > 6 || Math.abs(s.dy) > 6) s.dragged = true;  // 真的拖动了才吞掉随后的 click
    const r = s.wrapRect, edge = Math.max(56, r.width * 0.18);
    let a = 0, depth = 0;
    if (x > r.right - edge) { a = 1; depth = Math.min(1, (x - (r.right - edge)) / Math.max(edge, 1)); }
    else if (x < r.left + edge) { a = -1; depth = Math.min(1, ((r.left + edge) - x) / Math.max(edge, 1)); }
    s.depth = depth;
    if (a && !s.raf) { s.auto = a; s.lastT = performance.now(); s.raf = requestAnimationFrame(autoTick); }
    else if (!a && s.raf) { s.auto = 0; cancelAnimationFrame(s.raf); s.raf = 0; }
    else s.auto = a;
    scheduleSort();                           // 上百次 pointermove 只画一帧
  }
  function endSort() {
    applySortNow();      // 补上攒着没画的那一帧：s.to 必须是松手那一刻的位置
    const s = sorting; sorting = null;
    if (s.raf) cancelAnimationFrame(s.raf);
    wrap.classList.remove('sortmode');
    s.el.classList.remove('picked');
    s.els.forEach(e => { e.style.transform = ''; });
    if (s.dragged) { suppressClick = true; setTimeout(() => suppressClick = false, 340); }
    const { from, to } = s;
    /* 没挪位置就归位。移动端长按已在 holdTimer 里直接进了多选，
       不会走到这里；桌面端仍是原来「长按原地松手 = 归位」的行为。 */
    if (to === from) { snap(state.sel, true); return; }
    const arr = state.journals;
    arr.splice(to, 0, arr.splice(from, 1)[0]);
    save();
    let ns = state.sel;                          // 选中的那本跟着走
    if (state.sel === from) ns = to;
    else if (from < state.sel && to >= state.sel) ns = state.sel - 1;
    else if (from > state.sel && to <= state.sel) ns = state.sel + 1;
    renderHome();
    snap(clamp(ns, 0, state.journals.length - 1), false);
  }

  wrap.addEventListener('pointerdown', e => {
    if (e.target.closest('.gear')) return;
    /* 触控板尾流还没落位就换成手指：先收掉那次 settle，
       否则 160ms 后的 snap() 会在新手势拖动中途改 off，位置突然跳一下。 */
    clearTimeout(wheelSettleT);
    stopBounce();                          // 手指接管：掐掉还没弹完的回弹
    if (wheelGliding) settleWheel(true);   // 无动画收掉，别让缓动拖住新手势
    setGliding(true);                     // 手指接管：进入手势降级态
    if (inertRaf) {                       // 按下打断惯性：这一下不该顺手把书翻开
      suppressClick = true;
      setTimeout(() => suppressClick = false, 340);
    }
    stopInertia();
    measure();
    dragging = true; moved = false; vel = 0;
    startX = lastX = e.clientX; lastT = performance.now();
    startOff = off;
    ease(false);
    /* 手指按住不动才算长按；一旦开始横向滑就把长按作废，让位给滚动 */
    clearTimeout(holdTimer);
    pendingEl = e.target.closest('.book-item'); pendingX = e.clientX; pendingY = e.clientY;
    holdTimer = setTimeout(() => {
      if (!pendingEl) return;
      /* 左右滑动模式长按 = **直接拖动排序**，绝不跳去多层书架进多选。
         一进多选就会 setView('shelf') 整块重绘，触摸手势锁死的目标节点被换掉，
         同一根手指再也拖不动。桌面端与移动端在这里走同一条 beginSort。 */
      buzz(12);                         // 长按成立即反馈；只有一本时也有震动
      beginSort(pendingEl, pendingX, pendingY);
    }, HOLD_MS);
  });
  window.addEventListener('pointermove', e => {
    if (sorting) { moveSort(e.clientX, e.clientY); return; }
    if (!dragging) return;
    const x = e.clientX, now = performance.now();
    const dx = x - startX;
    if (Math.abs(dx) > 5) { moved = true; freezeFilter = true; clearTimeout(holdTimer); pendingEl = null; }
    const dt = now - lastT;
    if (dt > 6) { vel = vel * 0.7 + ((x - lastX) / dt) * 0.3 * 16.7; lastX = x; lastT = now; }
    let t = startOff + dx;
    /* 连续橡皮筋：springboard rubberBand 按剩余行程渐进增加阻力，
       渐近 BOUNCE_MAX；松手时位置与速度都能连续交给弹簧。 */
    const M = window.CarnetMotion;
    if (t > maxOff) {
      const over = M ? M.rubberBand(t - maxOff, BOUNCE_MAX) : (t - maxOff) * .3;
      t = maxOff + Math.min(BOUNCE_MAX, over);
    } else if (t < minOff) {
      const over = M ? M.rubberBand(t - minOff, BOUNCE_MAX) : (t - minOff) * .3;
      t = minOff + Math.max(-BOUNCE_MAX, over);
    }
    off = t;
    schedulePaint();
  }, { passive: true });
  const endDrag = () => {
    clearTimeout(holdTimer); pendingEl = null;
    if (sorting) { endSort(); return; }
    if (!dragging) return;
    dragging = false;
    cancelPaint();
    if (moved) { suppressClick = true; setTimeout(() => suppressClick = false, 340); }
    /* 手指停在原地超过 120ms 再松手，说明已经不想甩了，别把旧速度带出去 */
    const v0 = performance.now() - lastT < 120 ? vel : 0;
    vel = 0;
    /* 已经拖出边界时，无论快慢都直接把当前位置 / 速度交给弹簧；
       慢拖不再硬走 snap，快甩也不会先多跑一帧惯性再把越界量截断。 */
    const edge = off < minOff ? minOff : off > maxOff ? maxOff : null;
    if (edge !== null) {
      const over = Math.min(Math.abs(off - edge), BOUNCE_MAX);
      off = edge + (off < edge ? -1 : 1) * over;
      edgeBounce(edge, over, () => snap(nearestIndex(), false), v0 * 16.7);
      return;
    }
    if (items.length > 1 && Math.abs(v0) >= 1.5) { startInertia(v0); return; }
    /* 轻手一拨：沿用原来的短投影吸附，最多跨两本 */
    const proj = off + v0 * 5;
    let best = state.sel, bd = Infinity;
    items.forEach((el, i) => {
      const d = Math.abs(mets[i].c + proj - wrapW / 2);
      if (d < bd) { bd = d; best = i; }
    });
    best = clamp(best, state.sel - 2, state.sel + 2);
    snap(best, true);
  };
  window.addEventListener('pointerup', endDrag);
  window.addEventListener('pointercancel', endDrag);
  /* 触摸时纵向拖动会被浏览器当成页面滚动抢走（touch-action 在手势落下那一刻就定死了，
     长按计时到了再加 .sortmode 来不及）。排序中拦掉 touchmove，Y 才能真跟手。 */
  document.addEventListener('touchmove', e => {
    if (sorting && e.cancelable) e.preventDefault();
  }, { passive: false });
  /* ===== 触控板 / 横向滚轮：连续跟手，停手才吸附 =====
     ⚠️ 原来每个 wheel 都 snap(sel±1, true)：230ms 节流却配 460ms 缓动，
        一次连续横滑被切成「每 230ms 跳一本」，动画每次都被下一格打断，
        还要重算书名 / 页数 / 计数球 / 全量 active —— 实测 640ms 里只走 3 本，
        就是用户说的「滚到一本停一下选中，再滚一本再停一下」。
     现在跟 pointer 拖动同一套：deltaX 直接累加到 off，走 frameQueue 每帧只
     paint 一次；最后一次 wheel 安静 160ms 后才 snap() 落位一次（唯一一次
     更新书名 / 开缓动）。触控板自身的动量尾流会自然把 off 送到位。 */
  const wheelQ = frameQueue(() => { paint(); syncSelection(nearestIndex()); });
  function settleWheel(atEdge) {
    wheelSettleT = 0;
    if (!wheelGliding) return;
    wheelGliding = false;
    wheelQ.flush();                    // 补上攒着没画的最后一帧，别留到新手势里
    if (dragging || sorting) return;    // 手指 / 排序已经接管，别抢位置
    const near = nearestIndex();
    /* 单个离散滚轮 / 轻推一下往往不足以跨过半本，直接落位会「滚了一下又弹回原处」。
       没跨本但确实滚过 (>8px) 就按方向补一本；触控板连续横滑已经跨本，直接用 near。 */
    const target = (Math.abs(wheelTravel) > 8 && near === wheelFrom)
      ? clamp(wheelFrom + (wheelTravel > 0 ? 1 : -1), 0, items.length - 1)
      : near;
    /* 到头用无动画立即停住：off 已经 clamp 在 minOff / maxOff（正好是首 / 末本
       的中心），再走 460ms 缓动只会从「看着已经停了」弹一下。 */
    snap(target, atEdge ? false : true);
  }
  wrap.addEventListener('wheel', e => {
    if (Math.abs(e.deltaX) <= Math.abs(e.deltaY) || !e.deltaX) return;
    if (dragging || sorting) return;
    if (!wheelGliding) {
      wheelGliding = true;
      wheelFrom = state.sel; wheelTravel = 0; wheelVel = 0; wheelLastT = 0;
      stopInertia();
      measure();
      ease(false);                      // 位移立即生效，别被 CSS 缓动拖住
      freezeFilter = true;              // 跟手期间不重栅格化滤镜
      setGliding(true);                 // 触控板滑行同样进入手势降级态
    }
    /* deltaMode: 0 = 像素、1 = 行、2 = 页；行 / 页换算成像素才跟手 */
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? wrapW : 1;
    const dx = e.deltaX * unit;
    if (bouncing) return;               // 弹性回弹期间不接收新滚轮，避免叠加成抖动
    /* 弹性刚收敛完：贴着边界的同向余波直接吞掉，直到出现反向滚轮才解锁。
       ⚠️ 只认 off 与 dx 的符号，不依赖 wheelGliding 的中间状态 ——
          否则弹性结束后第一个同向 wheel 会重新起一次回弹，变成「到头一直弹」。 */
    if (edgeSettled) {
      const atMin = off <= minOff + .5, atMax = off >= maxOff - .5;
      if ((atMin && dx > 0) || (atMax && dx < 0)) return;
      edgeSettled = false;
    }
    /* 已经贴边、还继续往界外推：直接忽略（上一轮修掉的「到头还在抖」不能回来） */
    const pastEnd = (dx > 0 && off <= minOff + .5) || (dx < 0 && off >= maxOff - .5);
    if (pastEnd && !wheelGliding) return;
    /* 滚轮事件没有统一的动量尾流，直接用最近事件的 delta / 时间估算 px/s，
       低通抑住滚轮抖动；弹簧因此会顺着这一下继续送，而不是重新造一段振幅。 */
    const now = performance.now();
    const dt = wheelLastT ? clamp(now - wheelLastT, 8, 80) : 16.7;
    wheelLastT = now;
    wheelVel = wheelVel * .55 + (-dx / dt * 1000) * .45;
    wheelTravel += dx;
    const t = off - dx;
    const edge = t < minOff ? minOff : t > maxOff ? maxOff : null;
    if (edge !== null) {
      /* 到头：这一下自然冲出边界，随即交给阻尼弹性拉回（t=0 与当前 off 连续）。
         回弹期间与结束后的同向余波分别由 bouncing / pastEnd 拦掉，位置不会再微动。 */
      wheelQ.cancel();
      clearTimeout(wheelSettleT);
      wheelGliding = false;
      /* 与惯性分支同源封顶：deltaMode=2（整页）一次可能越界几百 px，
         只截 x0 而把 off 留在外面，切弹性第一帧会大幅跳回。 */
      const over = Math.min(Math.abs(t - edge), BOUNCE_MAX);
      off = edge + (t < edge ? -1 : 1) * over;
      edgeBounce(edge, over, () => snap(nearestIndex(), false), wheelVel);
      return;
    }
    off = t;
    wheelQ.push(0);
    clearTimeout(wheelSettleT);
    wheelSettleT = setTimeout(() => settleWheel(false), 160);
  }, { passive: true });

  return {
    layout(animate) { measure(true); snap(state.sel, animate); },  // 外部调用视口可能变了，强制重量
    snap,
    consumeClick() { const s = suppressClick; suppressClick = false; return s; }
  };
})();
function layoutCarousel(animate) { carousel.layout(animate); }
function selectJournal(i, animate = true) {
  if (state.prefs.view === 'spine') {
    state.sel = clamp(i, 0, Math.max(state.journals.length - 1, 0));
    syncSpineSelection(animate);
    return;
  }
  if (state.prefs.view === 'shelf') {          // 书架模式：选中并滚到那本，不经过轮播
    state.sel = clamp(i, 0, Math.max(state.journals.length - 1, 0));
    syncHomeHead();
    $$('#shelfWrap .book-item').forEach(el => el.classList.toggle('active', +el.dataset.i === state.sel));
    const el = $(`#shelfWrap .book-item[data-i="${state.sel}"]`);
    if (el && el.scrollIntoView) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    return;
  }
  carousel.snap(i, animate);
}

