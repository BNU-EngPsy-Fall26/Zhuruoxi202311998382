/* =========================================================
 * 概念实验室（第二阶段）
 * 模块一：两个分布与判定标准（d'/c 可拖动，悬停查看漏报/误报概率，
 *         下方混淆矩阵与 SDT 指标；场景预设：自由探索/两个游戏/医疗诊断）
 * 模块二：ROC 曲线（d'/c 滑块联动，红点=当前 c；z 变换 ROC 随 SN 方差变化）
 * 模块三：标准与奖惩（先验概率/c 滑块 + 支付矩阵可编辑，最优 β* 与 c* 实时更新）
 * 纯前端实现，依赖 index.html 中的结构。
 * ========================================================= */
(function () {
  'use strict';

  var NS = 'http://www.w3.org/2000/svg';
  function $(id) { return document.getElementById(id); }
  function el(parent, tag, attrs) {
    var e = document.createElementNS(NS, tag);
    for (var k in attrs) e.setAttribute(k, attrs[k]);
    parent.appendChild(e);
    return e;
  }

  /* ---------------- 数学工具 ---------------- */
  // 标准正态分布函数 Φ(x)（erf 近似，Abramowitz-Stegun 7.1.26）
  function erf(x) {
    var sign = x < 0 ? -1 : 1;
    x = Math.abs(x);
    var a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741,
        a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
    var t = 1 / (1 + p * x);
    var y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
    return sign * y;
  }
  function phi(x) { return 0.5 * (1 + erf(x / Math.SQRT2)); }          // 标准正态 CDF
  function npdf(x, mu, sig) {                                          // 正态密度
    var z = (x - mu) / sig;
    return Math.exp(-0.5 * z * z) / (sig * Math.sqrt(2 * Math.PI));
  }
  function zOf(p) {                                                    // Φ 的逆（限制 p∈[1e-4,1-1e-4]）
    p = Math.max(1e-4, Math.min(1 - 1e-4, p));
    // 简单二分求逆（精度足够绘图用）
    var lo = -8, hi = 8, mid;
    for (var i = 0; i < 60; i++) {
      mid = (lo + hi) / 2;
      if (phi(mid) < p) lo = mid; else hi = mid;
    }
    return (lo + hi) / 2;
  }

  /* ---------------- 屏幕与页签 ---------------- */
  function show(id) {
    var screens = document.querySelectorAll('.screen');
    for (var i = 0; i < screens.length; i++) screens[i].classList.remove('active');
    $(id).classList.add('active');
    window.scrollTo(0, 0);
  }

  var inited = false;
  function openLab() {
    // 从 app.js 的登录状态取用户名（顶栏 chip）
    var ui = $('user-info');
    if (ui && ui.textContent) $('lab-user').textContent = ui.textContent;
    show('screen-lab');
    if (!inited) { initDist(); initROC(); initPayoff(); inited = true; }
  }
  $('btn-lab-entry').addEventListener('click', openLab);
  $('btn-to-lab').addEventListener('click', openLab);
  $('lab-back').addEventListener('click', function () { show('screen-home'); });

  var tabs = document.querySelectorAll('.tab');
  for (var t = 0; t < tabs.length; t++) {
    tabs[t].addEventListener('click', function () {
      for (var i = 0; i < tabs.length; i++) tabs[i].classList.remove('active');
      this.classList.add('active');
      var panels = document.querySelectorAll('.tab-panel');
      for (var j = 0; j < panels.length; j++) panels[j].classList.remove('active');
      $('tab-' + this.dataset.tab).classList.add('active');
    });
  }

  /* =========================================================
   * 模块一：两个分布与判定标准
   * ========================================================= */
  var SCENARIOS = {
    free: { xlabel: '刺激强度', nLabel: '噪音 N', sLabel: '信号 SN', d: 1.8, c: 0.5, prior: 0.5,
            desc: '自由探索：x 轴为抽象的刺激强度，随意拖动滑块，感受 d\' 与 c 各自的作用。' },
    A:    { xlabel: '人影可疑度', nLabel: '幸存者（噪音）', sLabel: '僵尸（信号）', d: 1.8, c: 0.5, prior: 0.5,
            desc: '隔离区哨岗：噪音 = 幸存者，信号 = 僵尸；x 轴为人影的可疑程度。' },
    B:    { xlabel: '镜面异常度', nLabel: '房客（噪音）', sLabel: '鬼（信号）', d: 1.5, c: 0.3, prior: 0.5,
            desc: '老宅巡夜：噪音 = 房客，信号 = 鬼；x 轴为镜中脸的异常程度。' },
    med:  { xlabel: '检查指标异常度', nLabel: '健康人（噪音）', sLabel: '患者（信号）', d: 1.2, c: 1.0, prior: 0.1,
            desc: '医疗诊断：噪音 = 健康人，信号 = 患者；患病先验概率仅 0.1，漏诊代价极高。' }
  };
  var curSc = 'free';

  var distW = 640, distH = 300, distL = 48, distR = 14, distT = 18, distB = 42;
  function dx(x) { return distL + (x + 5) / 11 * (distW - distL - distR); }
  function dy(y) { return distH - distB - y / 0.45 * (distH - distT - distB); }

  function curvePath(mu, sig, x0, x1) {
    var d = '';
    for (var x = x0; x <= x1 + 1e-9; x += 0.05) {
      d += (d === '' ? 'M' : 'L') + dx(x).toFixed(2) + ' ' + dy(npdf(x, mu, sig)).toFixed(2) + ' ';
    }
    return d;
  }
  function areaPath(mu, sig, x0, x1) {
    var d = curvePath(mu, sig, x0, x1);
    d += 'L' + dx(x1).toFixed(2) + ' ' + dy(0) + ' L' + dx(x0).toFixed(2) + ' ' + dy(0) + ' Z';
    return d;
  }
  // 两曲线重叠区域：min(fN, fS)——等方差时交点在 d/2，左侧取 SN、右侧取 N
  function overlapPath(d, xsec) {
    var p = '';
    for (var x = -5; x <= xsec + 1e-9; x += 0.05) p += (p === '' ? 'M' : 'L') + dx(x).toFixed(2) + ' ' + dy(npdf(x, d, 1)).toFixed(2) + ' ';
    for (var x2 = xsec; x2 <= 6 + 1e-9; x2 += 0.05) p += 'L' + dx(x2).toFixed(2) + ' ' + dy(npdf(x2, 0, 1)).toFixed(2) + ' ';
    return p + 'L' + dx(6).toFixed(2) + ' ' + dy(0) + ' L' + dx(-5).toFixed(2) + ' ' + dy(0) + ' Z';
  }

  function drawDist() {
    var d = parseFloat($('dist-d').value);
    var c = parseFloat($('dist-c').value);   // 判断标准 c（Macmillan 定义：0 位于两分布交界处）
    var cRaw = c + d / 2;                    // 标准在刺激轴上的实际切割位置
    var sc = SCENARIOS[curSc];
    $('dist-d-val').textContent = d.toFixed(2);
    $('dist-c-val').textContent = c.toFixed(2);

    var svg = $('dist-plot');
    svg.innerHTML = '';

    // ---- 填充层（半透明，不遮曲线）----
    // N 曲线下的蓝色区域
    el(svg, 'path', { d: areaPath(0, 1, -5, 6), fill: '#3b6fd4', 'fill-opacity': 0.15 });
    // SN 曲线下的绿色区域
    el(svg, 'path', { d: areaPath(d, 1, -5, 6), fill: '#2e9e5b', 'fill-opacity': 0.15 });
    // 两曲线重叠部分：橙色
    el(svg, 'path', { d: overlapPath(d, d / 2), fill: '#f5a623', 'fill-opacity': 0.30 });
    // 误报区：c 右侧的 N 曲线部分，橙色（更深）
    el(svg, 'path', { d: areaPath(0, 1, Math.max(-5, cRaw), 6), fill: '#f5a623', 'fill-opacity': 0.50 });
    // 漏报区：c 左侧的 SN 曲线部分，红色
    el(svg, 'path', { d: areaPath(d, 1, -5, Math.min(6, cRaw)), fill: '#d64536', 'fill-opacity': 0.45 });

    // ---- 坐标轴（画在填充之上）----
    el(svg, 'line', { x1: distL, y1: dy(0), x2: distW - distR, y2: dy(0), stroke: '#8a93a5', 'stroke-width': 1.2 });
    el(svg, 'line', { x1: distL, y1: dy(0.45), x2: distL, y2: dy(0), stroke: '#8a93a5', 'stroke-width': 1.2 });
    for (var tx = -5; tx <= 6; tx++) {
      el(svg, 'line', { x1: dx(tx), y1: dy(0), x2: dx(tx), y2: dy(0) + 5, stroke: '#8a93a5' });
      el(svg, 'text', { x: dx(tx), y: dy(0) + 18, 'font-size': 11, fill: '#6b7280', 'text-anchor': 'middle' }).textContent = tx;
    }
    // 纵轴刻度：概率密度值
    for (var ti = 0; ti <= 4; ti++) {
      var yv = ti / 10;
      el(svg, 'line', { x1: distL - 4, y1: dy(yv), x2: distL, y2: dy(yv), stroke: '#8a93a5' });
      el(svg, 'text', { x: distL - 8, y: dy(yv) + 4, 'font-size': 11, fill: '#6b7280', 'text-anchor': 'end' }).textContent = yv.toFixed(1);
    }
    el(svg, 'text', { x: (distW - distR + distL) / 2, y: distH - 6, 'font-size': 12, fill: '#33415e', 'text-anchor': 'middle' }).textContent = sc.xlabel;

    // ---- 曲线描边：N 蓝色 / SN 绿色 ----
    el(svg, 'path', { d: curvePath(0, 1, -5, 6), fill: 'none', stroke: '#2b6fd4', 'stroke-width': 2.4 });
    el(svg, 'path', { d: curvePath(d, 1, -5, 6), fill: 'none', stroke: '#2e9e5b', 'stroke-width': 2.4 });
    // 曲线标签（颜色与曲线一致）
    el(svg, 'text', { x: dx(0) - 6, y: dy(npdf(0, 0, 1)) - 8, 'font-size': 12, fill: '#2b6fd4', 'text-anchor': 'end', 'font-weight': 'bold' }).textContent = sc.nLabel;
    el(svg, 'text', { x: dx(d) + 8, y: dy(npdf(d, d, 1)) - 8, 'font-size': 12, fill: '#2e9e5b', 'text-anchor': 'start', 'font-weight': 'bold' }).textContent = sc.sLabel;

    // ---- 图例（右上角）----
    var lgX = distL + 14, lgY = distT + 4;   // 图例放左上，避免遮住大 d' 时右侧的 SN 峰
    el(svg, 'rect', { x: lgX - 10, y: lgY - 4, width: 138, height: 78, rx: 8, fill: '#ffffff', opacity: 0.85, stroke: '#dfe4ec' });
    var legend = [
      ['#2b6fd4', sc.nLabel],
      ['#2e9e5b', sc.sLabel],
      ['#f5a623', '重叠 / 误报区'],
      ['#d64536', '漏报区']
    ];
    for (var li = 0; li < legend.length; li++) {
      var ly = lgY + 6 + li * 18;
      el(svg, 'rect', { x: lgX, y: ly, width: 12, height: 12, rx: 2, fill: legend[li][0], 'fill-opacity': 0.75 });
      el(svg, 'text', { x: lgX + 18, y: ly + 10.5, 'font-size': 11.5, fill: '#33415e' }).textContent = legend[li][1];
    }

    // ---- 判定标准 c（画在实际切割位置 cRaw 上，标注 Macmillan c 值）----
    el(svg, 'line', { x1: dx(cRaw), y1: dy(0.44), x2: dx(cRaw), y2: dy(0), stroke: '#c0392b', 'stroke-width': 2.4 });
    el(svg, 'text', { x: dx(cRaw), y: dy(0.44) - 4, 'font-size': 13, fill: '#c0392b', 'text-anchor': 'middle', 'font-weight': 'bold' }).textContent = 'c=' + (c >= 0 ? '+' : '') + c.toFixed(2);
    // 判为噪音 / 判为信号 区域标注
    el(svg, 'text', { x: (distL + dx(cRaw)) / 2, y: dy(0) - 6, 'font-size': 11, fill: '#5f6a80', 'text-anchor': 'middle' }).textContent = '← 判为噪音';
    el(svg, 'text', { x: (dx(cRaw) + distW - distR) / 2, y: dy(0) - 6, 'font-size': 11, fill: '#5f6a80', 'text-anchor': 'middle' }).textContent = '判为信号 →';

    // ---- 混淆矩阵与 SDT 指标 ----
    var H = 1 - phi(cRaw - d), M = 1 - H, FA = 1 - phi(cRaw), CR = 1 - FA;
    $('dcm-h').textContent = '击中 H = ' + H.toFixed(3);
    $('dcm-m').textContent = '漏报 M = ' + M.toFixed(3);
    $('dcm-fa').textContent = '误报 FA = ' + FA.toFixed(3);
    $('dcm-cr').textContent = '正确拒斥 CR = ' + CR.toFixed(3);
    $('dmt-ph').textContent = H.toFixed(3);
    $('dmt-fa').textContent = FA.toFixed(3);
    $('dmt-d').textContent = d.toFixed(2);
    $('dmt-c').textContent = (c >= 0 ? '+' : '') + c.toFixed(2);
    $('dmt-beta').textContent = (d > 0.01) ? Math.exp(d * c).toFixed(2) : '—';
    // A'（面积敏感度，Pollack & Norman 1964）：ROC 曲线下面积的参数估计
    var Ap;
    if (H >= FA) { Ap = 0.5 + (H - FA) * (1 + H - FA) / (4 * H * (1 - FA)); }
    else { Ap = 0.5 - (FA - H) * (1 + FA - H) / (4 * FA * (1 - H)); }
    $('dmt-ap').textContent = Ap.toFixed(3);
  }

  // 悬停：显示该位置的 N/SN 密度与漏报/误报概率（带颜色图例小块）
  function distHover(e) {
    var svg = $('dist-plot'), tip = $('dist-tip');
    var rect = svg.getBoundingClientRect();
    var px = (e.clientX - rect.left) / rect.width * distW;
    if (px < distL || px > distW - distR) { tip.style.display = 'none'; return; }
    var x = (px - distL) / (distW - distL - distR) * 11 - 5;
    var d = parseFloat($('dist-d').value);
    var c = parseFloat($('dist-c').value);
    var cRaw = c + d / 2;                          // 标准实际切割位置
    var nD = npdf(x, 0, 1), sD = npdf(x, d, 1);
    var html = '<b>位置 x = ' + x.toFixed(2) + '</b><br>' +
      '<span class="chip" style="background:#2b6fd4"></span>N（噪音）密度：<b>' + nD.toFixed(3) + '</b><br>' +
      '<span class="chip" style="background:#2e9e5b"></span>SN（信号）密度：<b>' + sD.toFixed(3) + '</b><br>';
    if (x < cRaw) {
      // 左侧判为噪音：该段只有漏报概率，误报为 0
      var miss = phi(cRaw - d) - phi(x - d);
      html += '<span class="chip" style="background:#d64536"></span>此段判为噪音：<b>漏报概率 = ' +
              Math.max(0, miss).toFixed(3) + '</b>，误报概率 = 0';
    } else {
      // 右侧判为信号：该段只有误报概率，漏报为 0
      var fa = phi(x) - phi(cRaw);
      html += '<span class="chip" style="background:#f5a623"></span>此段判为信号：<b>误报概率 = ' +
              Math.max(0, fa).toFixed(3) + '</b>，漏报概率 = 0';
    }
    tip.innerHTML = html;
    tip.style.display = 'block';
    var wrapRect = svg.parentElement.getBoundingClientRect();
    var tx = e.clientX - wrapRect.left + 14, ty = e.clientY - wrapRect.top + 14;
    if (tx > wrapRect.width - 230) tx = e.clientX - wrapRect.left - 230;
    tip.style.left = tx + 'px';
    tip.style.top = ty + 'px';
  }

  function initDist() {
    $('dist-d').addEventListener('input', drawDist);
    $('dist-c').addEventListener('input', drawDist);
    // 场景预设：独立按钮板块
    var scBtns = document.querySelectorAll('.scenario-btn');
    for (var i = 0; i < scBtns.length; i++) {
      scBtns[i].addEventListener('click', function () { setScenario(this.dataset.sc); });
    }
    var svg = $('dist-plot');
    svg.addEventListener('mousemove', distHover);
    svg.addEventListener('mouseleave', function () { $('dist-tip').style.display = 'none'; });
    setScenario(curSc);
  }

  function setScenario(sc) {
    curSc = sc;
    var btns = document.querySelectorAll('.scenario-btn');
    for (var i = 0; i < btns.length; i++) {
      btns[i].classList.toggle('active', btns[i].dataset.sc === sc);
    }
    var sc0 = SCENARIOS[sc];
    $('dist-d').value = sc0.d;
    $('dist-c').value = sc0.c;
    $('sc-desc').textContent = sc0.desc;
    drawDist();
  }

  /* =========================================================
   * 模块二：ROC 曲线 + z 变换 ROC
   * ========================================================= */
  var rW = 340, rH = 340, rL = 44, rR = 12, rT = 14, rB = 36;
  function rx1(v) { return rL + v * (rW - rL - rR); }
  function ry1(v) { return rH - rB - v * (rH - rT - rB); }

  function plotFrame(svg, x0, x1, y0, y1, xstep, xlabel, ylabel, sx, sy) {
    el(svg, 'line', { x1: sx(x0), y1: sy(y0), x2: sx(x1), y2: sy(y0), stroke: '#8a93a5', 'stroke-width': 1.2 });
    el(svg, 'line', { x1: sx(x0), y1: sy(y0), x2: sx(x0), y2: sy(y1), stroke: '#8a93a5', 'stroke-width': 1.2 });
    for (var v = x0; v <= x1 + 1e-9; v += xstep) {
      el(svg, 'line', { x1: sx(v), y1: sy(y0), x2: sx(v), y2: sy(y0) + 5, stroke: '#8a93a5' });
      el(svg, 'text', { x: sx(v), y: sy(y0) + 17, 'font-size': 10.5, fill: '#6b7280', 'text-anchor': 'middle' })
        .textContent = (Math.abs(v) < 1e-9 ? 0 : v.toFixed(1));
    }
    for (var w = y0; w <= y1 + 1e-9; w += xstep) {
      el(svg, 'line', { x1: sx(x0) - 5, y1: sy(w), x2: sx(x0), y2: sy(w), stroke: '#8a93a5' });
      el(svg, 'text', { x: sx(x0) - 8, y: sy(w) + 3.5, 'font-size': 10.5, fill: '#6b7280', 'text-anchor': 'end' })
        .textContent = (Math.abs(w) < 1e-9 ? 0 : w.toFixed(1));
    }
    el(svg, 'text', { x: (sx(x0) + sx(x1)) / 2, y: rH - 4, 'font-size': 11.5, fill: '#33415e', 'text-anchor': 'middle' }).textContent = xlabel;
    var yt = el(svg, 'text', { x: 12, y: (sy(y0) + sy(y1)) / 2, 'font-size': 11.5, fill: '#33415e', 'text-anchor': 'middle' });
    yt.textContent = ylabel;
    yt.setAttribute('transform', 'rotate(-90 12 ' + ((sy(y0) + sy(y1)) / 2) + ')');
  }

  function drawROC() {
    var d = parseFloat($('roc-d').value);
    var c = parseFloat($('roc-c').value);       // 判断标准 c（0=两分布交界）
    var sig = parseFloat($('roc-sigma').value);
    var cRaw = c + d / 2;                      // 实际切割位置
    $('roc-d-val').textContent = d.toFixed(2);
    $('roc-c-val').textContent = c.toFixed(2);
    $('roc-sigma-val').textContent = sig.toFixed(2);

    /* ---- ROC 曲线 ---- */
    var svg = $('roc-plot');
    svg.innerHTML = '';
    plotFrame(svg, 0, 1, 0, 1, 0.25, 'P(误报)', 'P(击中)', rx1, ry1);
    // 偶然线
    el(svg, 'line', { x1: rx1(0), y1: ry1(0), x2: rx1(1), y2: ry1(1), stroke: '#b6bfd0', 'stroke-width': 1.2, 'stroke-dasharray': '5 4' });
    // ROC 曲线：遍历实际标准 c'，P(FA) = 1−Φ(c')，P(H) = 1−Φ((c'−d')/σ)
    var path = '';
    for (var cp = -4; cp <= 4 + 1e-9; cp += 0.05) {
      var fa = 1 - phi(cp);
      var h = 1 - phi((cp - d) / sig);
      path += (path === '' ? 'M' : 'L') + rx1(fa).toFixed(2) + ' ' + ry1(h).toFixed(2) + ' ';
    }
    el(svg, 'path', { d: path, fill: 'none', stroke: '#1e4a8a', 'stroke-width': 2.4 });
    // 红点 = 当前标准 c（对应实际位置 cRaw）
    var faC = 1 - phi(cRaw);
    var hC = 1 - phi((cRaw - d) / sig);
    el(svg, 'circle', { cx: rx1(faC), cy: ry1(hC), r: 6, fill: '#c0392b', stroke: '#fff', 'stroke-width': 2 });
    el(svg, 'text', { x: rx1(faC) + 9, y: ry1(hC) - 8, 'font-size': 11, fill: '#c0392b', 'font-weight': 'bold' }).textContent = 'c=' + (c >= 0 ? '+' : '') + c.toFixed(2);

    /* ---- z 变换 ROC ---- */
    var zr0 = -3, zr1 = 3, zsvg = $('zroc-plot');
    zsvg.innerHTML = '';
    var zx = function (v) { return rL + (v - zr0) / (zr1 - zr0) * (rW - rL - rR); };
    var zy = function (v) { return rH - rB - (v - zr0) / (zr1 - zr0) * (rH - rT - rB); };
    plotFrame(zsvg, zr0, zr1, zr0, zr1, 1, 'z(P(误报))', 'z(P(击中))', zx, zy);
    // 等方差参考线：主对角线（d'=0 偶然线）
    el(zsvg, 'line', { x1: zx(zr0), y1: zy(zr0), x2: zx(zr1), y2: zy(zr1), stroke: '#b6bfd0', 'stroke-width': 1.2, 'stroke-dasharray': '5 4' });
    // zROC 直线：z(H) = z(FA)/σ + d'/σ（斜率 1/σ，随 SN 方差变化）
    var zpath = '', pen = false;
    for (var c2 = -2.9; c2 <= 2.9 + 1e-9; c2 += 0.05) {
      var zfa = -c2, zh = (d - c2) / sig;
      if (zfa < zr0 - 0.05 || zfa > zr1 + 0.05 || zh < zr0 - 0.05 || zh > zr1 + 0.05) { pen = false; continue; }
      zpath += (pen ? 'L' : 'M') + zx(zfa).toFixed(2) + ' ' + zy(zh).toFixed(2) + ' ';
      pen = true;
    }
    el(zsvg, 'path', { d: zpath, fill: 'none', stroke: '#1e4a8a', 'stroke-width': 2.4 });
    // 当前点（若在范围内）
    var czfa = zOf(faC), czh = zOf(hC);
    if (czfa >= zr0 && czfa <= zr1 && czh >= zr0 && czh <= zr1) {
      el(zsvg, 'circle', { cx: zx(czfa), cy: zy(czh), r: 6, fill: '#c0392b', stroke: '#fff', 'stroke-width': 2 });
    }

    $('rm-ph').textContent = hC.toFixed(3);
    $('rm-pfa').textContent = faC.toFixed(3);
    $('rm-dz').textContent = (d / sig).toFixed(2) + '（=d\'/σ）';

    // AUC：ROC 曲线下面积。数值积分 AUC = ∫ H(c')·φ(c') dc'（随 d'、σ 变化；c 只移动红点，不改变 AUC）
    var auc = 0;
    for (var ac = -6; ac <= 6 - 1e-9; ac += 0.02) {
      var acMid = ac + 0.01;
      auc += (1 - phi((acMid - d) / sig)) * npdf(acMid, 0, 1) * 0.02;
    }
    auc = Math.min(1, Math.max(0.5, auc));
    $('rm-auc').textContent = auc.toFixed(3);
    $('rm-auc-inline').textContent = auc.toFixed(3);
  }

  function initROC() {
    $('roc-d').addEventListener('input', drawROC);
    $('roc-c').addEventListener('input', drawROC);
    $('roc-sigma').addEventListener('input', drawROC);
    drawROC();
  }

  /* =========================================================
   * 模块三：标准与奖惩
   * ========================================================= */
  var PAY_D = 1.8;   // 本模块固定信号强度

  // 期望收益（cRaw = 标准实际位置）：FA = 噪音超过标准
  function evAt(cRaw, prior, vh, cm, cfa, vcr) {
    var H = 1 - phi(cRaw - PAY_D), FA = 1 - phi(cRaw);
    return prior * (H * vh + (1 - H) * cm) + (1 - prior) * (FA * cfa + (1 - FA) * vcr);
  }

  function drawPayoff() {
    var prior = parseFloat($('pay-prior').value);
    var c = parseFloat($('pay-c').value);      // 当前标准 c（0=两分布交界）
    var cRaw = c + PAY_D / 2;                  // 实际切割位置
    var vh = parseInt($('pay-vh').value, 10);
    var cm = parseInt($('pay-cm').value, 10);
    var cfa = parseInt($('pay-cfa').value, 10);
    var vcr = parseInt($('pay-vcr').value, 10);
    $('pay-prior-val').textContent = prior.toFixed(2);
    $('pay-c-val').textContent = c.toFixed(2);

    var H = 1 - phi(cRaw - PAY_D), FA = 1 - phi(cRaw);
    var beta = Math.exp(PAY_D * c);            // β = e^(d'·c)，c=0 时 β=1
    var ev = evAt(cRaw, prior, vh, cm, cfa, vcr);

    // 最优标准：β* = [P(n)/P(s)]·[(V(CR)−C(FA))/(V(H)−C(M))]，c* = ln(β*)/d'
    var gainH = vh - cm, gainCR = vcr - cfa;
    var betaOpt = null, cOpt = null, cOptRaw = null;
    if (prior > 0.01 && prior < 0.99 && gainH > 0 && gainCR > 0) {
      betaOpt = ((1 - prior) / prior) * (gainCR / gainH);
      cOpt = Math.max(-3, Math.min(3, Math.log(betaOpt) / PAY_D));
      cOptRaw = Math.max(-3.8, Math.min(3.8, cOpt + PAY_D / 2));
    }
    var evOpt = (cOptRaw !== null) ? evAt(cOptRaw, prior, vh, cm, cfa, vcr) : null;

    $('pm-beta').textContent = beta.toFixed(2);
    $('pm-ev').textContent = ev.toFixed(2);
    if (betaOpt !== null) {
      $('pm-beta-opt').textContent = betaOpt.toFixed(2);
      $('pm-c-opt').textContent = (cOpt >= 0 ? '+' : '') + cOpt.toFixed(2);
      $('pm-ev-opt').textContent = evOpt.toFixed(2);
    } else {
      $('pm-beta-opt').textContent = '—';
      $('pm-c-opt').textContent = '∞';
      $('pm-ev-opt').textContent = '—';
    }

    // 小分布图：当前 c（红实线，画在 cRaw）与最优 c*（金虚线，画在 cOptRaw）
    var W = 640, Hp = 240, L = 48, R = 14, T = 16, B = 36;
    var px = function (x) { return L + (x + 4) / 8 * (W - L - R); };
    var py = function (y) { return Hp - B - y / 0.45 * (Hp - T - B); };
    var svg = $('pay-plot');
    svg.innerHTML = '';
    el(svg, 'line', { x1: L, y1: py(0), x2: W - R, y2: py(0), stroke: '#8a93a5', 'stroke-width': 1.2 });
    for (var tx = -4; tx <= 4; tx++) {
      el(svg, 'text', { x: px(tx), y: py(0) + 16, 'font-size': 10.5, fill: '#6b7280', 'text-anchor': 'middle' }).textContent = tx;
    }
    el(svg, 'text', { x: (W - R + L) / 2, y: Hp - 4, 'font-size': 11.5, fill: '#33415e', 'text-anchor': 'middle' }).textContent = '刺激强度';
    function curve(mu) {
      var dd = '';
      for (var x = -4; x <= 4 + 1e-9; x += 0.05) dd += (dd === '' ? 'M' : 'L') + px(x).toFixed(2) + ' ' + py(npdf(x, mu, 1)).toFixed(2) + ' ';
      return dd;
    }
    el(svg, 'path', { d: curve(0), fill: 'none', stroke: '#3b6fd4', 'stroke-width': 2 });
    el(svg, 'path', { d: curve(PAY_D), fill: 'none', stroke: '#c98a10', 'stroke-width': 2 });
    el(svg, 'text', { x: px(0) - 6, y: py(npdf(0, 0, 1)) - 6, 'font-size': 11, fill: '#3b6fd4', 'text-anchor': 'end' }).textContent = '噪音 N';
    el(svg, 'text', { x: px(PAY_D) + 8, y: py(npdf(PAY_D, PAY_D, 1)) - 6, 'font-size': 11, fill: '#c98a10' }).textContent = '信号 SN';
    el(svg, 'line', { x1: px(cRaw), y1: py(0.43), x2: px(cRaw), y2: py(0), stroke: '#c0392b', 'stroke-width': 2.4 });
    el(svg, 'text', { x: px(cRaw), y: py(0.43) - 3, 'font-size': 12, fill: '#c0392b', 'text-anchor': 'middle', 'font-weight': 'bold' }).textContent = 'c=' + (c >= 0 ? '+' : '') + c.toFixed(2);
    if (cOptRaw !== null) {
      el(svg, 'line', { x1: px(cOptRaw), y1: py(0.43), x2: px(cOptRaw), y2: py(0), stroke: '#b8933d', 'stroke-width': 2.2, 'stroke-dasharray': '6 4' });
      el(svg, 'text', { x: px(cOptRaw), y: py(0.43) + 12, 'font-size': 12, fill: '#9a7a2c', 'text-anchor': 'middle', 'font-weight': 'bold' }).textContent = 'c*=' + (cOpt >= 0 ? '+' : '') + cOpt.toFixed(2);
    }
  }

  function initPayoff() {
    $('pay-prior').addEventListener('input', drawPayoff);
    $('pay-c').addEventListener('input', drawPayoff);
    var ids = ['pay-vh', 'pay-cm', 'pay-cfa', 'pay-vcr'];
    for (var i = 0; i < ids.length; i++) {
      $(ids[i]).addEventListener('input', drawPayoff);
    }
    drawPayoff();
  }
})();
