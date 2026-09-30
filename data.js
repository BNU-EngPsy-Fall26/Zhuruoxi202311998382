/* =========================================================
 * 数据查看（第三阶段）
 * - 本机 localStorage 记录每局游戏数据（被试姓名 + 混淆矩阵 + SDT 指标）
 * - 我的表现记录 / 全体排行榜（按准确率）/ 两张散点图（悬停查看详情）
 * - 示例数据一键载入（课堂演示用）、导出 JSON
 * 纯前端实现，依赖 index.html 中的结构；app.js 通过 window.SDTStore 写入数据。
 * 指标约定与 app.js 一致：对数线性校正比例，d' = z(H)−z(FA)，c = −[z(H)+z(FA)]/2，
 * A′ 为面积敏感度（Pollack & Norman, 1964）。
 * ========================================================= */
(function () {
  'use strict';

  var KEY = 'sdt_web_records_v1';
  var ROLE_NAME = { A: '隔离区哨岗', B: '老宅巡夜' };
  var ROLE_COLOR = { A: '#c04a4a', B: '#9a7fd0' };   // A=暗红（哨岗） / B=柔紫（老宅）——深底适配
  var ME_COLOR = '#b99745';                           // 当前用户：哑光暗金描边

  var NS = 'http://www.w3.org/2000/svg';
  function $(id) { return document.getElementById(id); }
  function el(parent, tag, attrs) {
    var e = document.createElementNS(NS, tag);
    for (var k in attrs) e.setAttribute(k, attrs[k]);
    parent.appendChild(e);
    return e;
  }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  }
  function fmtTime(ts) {
    var dt = new Date(ts);
    function p2(v) { return (v < 10 ? '0' : '') + v; }
    return p2(dt.getMonth() + 1) + '-' + p2(dt.getDate()) + ' ' + p2(dt.getHours()) + ':' + p2(dt.getMinutes());
  }
  function fmtC(v) { return (v >= 0 ? '+' : '') + v.toFixed(2); }
  function roleDot(role) {
    return '<span style="display:inline-block;width:9px;height:9px;border-radius:2px;background:' +
      (ROLE_COLOR[role] || '#888') + ';margin-right:5px;vertical-align:baseline"></span>';
  }

  /* ---------------- 数学工具（与 app.js / lab.js 同一套约定） ---------------- */
  function erf(x) {
    var sign = x < 0 ? -1 : 1;
    x = Math.abs(x);
    var a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741,
        a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
    var t = 1 / (1 + p * x);
    var y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
    return sign * y;
  }
  function phi(x) { return 0.5 * (1 + erf(x / Math.SQRT2)); }

  // Acklam 逆正态近似（与 app.js 的 zInv 同用途；示例数据生成用）
  function zInv(p) {
    var a = [-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02,
             1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00],
        b = [-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02,
             6.680131188771972e+01, -1.328068155288572e+01],
        c = [-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00,
             -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00],
        d = [7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00,
             3.754408661907416e+00];
    var q, r;
    if (p < 0.02425) {
      q = Math.sqrt(-2 * Math.log(p));
      return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
             ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
    }
    if (p <= 0.97575) {
      q = p - 0.5; r = q * q;
      return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q /
             (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
    }
    q = Math.sqrt(-2 * Math.log(1 - p));
    return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
            ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  function aPrime(pH, pFA) {
    if (pH >= pFA) return 0.5 + (pH - pFA) * (1 + pH - pFA) / (4 * pH * (1 - pFA));
    return 0.5 - (pFA - pH) * (1 + pFA - pH) / (4 * pFA * (1 - pH));
  }

  /* ---------------- 存储层 ---------------- */
  function load() {
    try { return JSON.parse(localStorage.getItem(KEY)) || []; } catch (e) { return []; }
  }
  function saveAll(arr) { localStorage.setItem(KEY, JSON.stringify(arr)); }
  function save(rec) { var a = load(); a.push(rec); saveAll(a); }
  var currentUser = '';
  function setCurrent(name) { currentUser = name || ''; }

  /* ---------------- 屏幕切换 ---------------- */
  function show(id) {
    var screens = document.querySelectorAll('.screen');
    for (var i = 0; i < screens.length; i++) screens[i].classList.remove('active');
    $(id).classList.add('active');
    window.scrollTo(0, 0);
  }

  function openData() {
    $('data-user').textContent = currentUser ? currentUser : '（未登录）';
    show('screen-data');   // 先显示再渲染：fitScroll 需要真实行高（display:none 时测不到）
    renderMine();
    renderBoard();
    drawCharts();
    fitActive();
  }

  /* 只对当前可见页签里的表格计算滑动高度（隐藏面板测不到行高） */
  function fitActive() {
    var active = document.querySelector('.dpanel.active');
    if (!active) return;
    if (active.id === 'dpanel-mine') fitScroll($('mine-box'), 10);
    if (active.id === 'dpanel-board') fitScroll($('board-box'), 10);
  }

  /* ---------------- 页签切换（与概念实验室同款交互；独立类 .dtab 避免与 lab.js 冲突） ---------------- */
  var dtabs = document.querySelectorAll('.dtab');
  for (var di = 0; di < dtabs.length; di++) {
    dtabs[di].addEventListener('click', function () {
      for (var i = 0; i < dtabs.length; i++) dtabs[i].classList.remove('active');
      this.classList.add('active');
      var panels = document.querySelectorAll('.dpanel');
      for (var j = 0; j < panels.length; j++) panels[j].classList.remove('active');
      $('dpanel-' + this.dataset.dt).classList.add('active');
      if (this.dataset.dt === 'viz') drawCharts();   // 切到可视化时重绘（自适应宽度）
      fitActive();                                    // 切到表格页签时重算滑动高度
    });
  }

  /* ---------------- 表格滑动（显示前 10 行，其余滚动查看；不足 10 行不出滚动条） ---------------- */
  function fitScroll(box, maxRows) {
    box.style.maxHeight = '';
    var table = box.querySelector('table');
    if (!table || !table.tBodies.length || !table.tBodies[0].rows.length) return;
    var body = table.tBodies[0];
    if (body.rows.length <= maxRows) return;
    var head = table.tHead ? table.tHead.offsetHeight : 0;
    box.style.maxHeight = Math.ceil(head + body.rows[0].offsetHeight * maxRows) + 2 + 'px';
  }
  var resizeTimer = 0;
  window.addEventListener('resize', function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () {
      if ($('screen-data').classList.contains('active')) fitActive();
    }, 150);
  });

  /* ---------------- 我的表现记录 ---------------- */
  function renderMine() {
    var box = $('mine-box');
    if (!currentUser) {
      box.innerHTML = '<p class="empty-note">未登录——返回主页登录后，这里会显示你的全部游戏记录。</p>';
      return;
    }
    var recs = load().filter(function (r) { return r.name === currentUser; })
                     .sort(function (a, b) { return b.ts - a.ts; });
    if (!recs.length) {
      box.innerHTML = '<p class="empty-note">还没有记录——先去玩一局吧！每完成一局游戏，数据会自动出现在这里。</p>';
      return;
    }
    var rows = '';
    for (var i = 0; i < recs.length; i++) {
      var r = recs[i];
      rows += '<tr><td>' + fmtTime(r.ts) + '</td><td>' + roleDot(r.role) + ROLE_NAME[r.role] + '</td><td>' + r.n +
        '</td><td>' + r.H + '</td><td>' + r.M + '</td><td>' + r.FA + '</td><td>' + r.CR +
        '</td><td><b>' + Math.round(r.acc * 100) + '%</b></td><td>' + r.pH.toFixed(2) + '</td><td>' + r.pFA.toFixed(2) +
        '</td><td>' + r.d.toFixed(2) + '</td><td>' + fmtC(r.cc) + '</td></tr>';
    }
    box.innerHTML = '<table class="board-table"><thead><tr>' +
      '<th>时间</th><th>游戏</th><th>试次</th><th>击中 H</th><th>漏报 M</th><th>误报 FA</th><th>正确拒斥 CR</th>' +
      '<th>准确率</th><th>P(H)</th><th>P(FA)</th><th>d′</th><th>c</th>' +
      '</tr></thead><tbody>' + rows + '</tbody></table>';
    fitScroll(box, 10);
  }

  /* ---------------- 全体排行榜（按准确率） ---------------- */
  // 每位被试 × 每个游戏取最佳准确率的一局；同时统计完成局数
  function bestRows() {
    var recs = load(), map = {};
    for (var i = 0; i < recs.length; i++) {
      var r = recs[i], k = r.name + '|' + r.role;
      if (!map[k]) map[k] = { best: r, count: 0 };
      map[k].count++;
      if (r.acc > map[k].best.acc) map[k].best = r;
    }
    var rows = [];
    for (var k2 in map) {
      if (!map.hasOwnProperty(k2)) continue;
      rows.push({ name: map[k2].best.name, role: map[k2].best.role, best: map[k2].best, count: map[k2].count });
    }
    rows.sort(function (a, b) {
      if (b.best.acc !== a.best.acc) return b.best.acc - a.best.acc;   // 主排序：准确率
      if (b.best.d !== a.best.d) return b.best.d - a.best.d;           // 次排序：d'
      return a.name < b.name ? -1 : 1;
    });
    return rows;
  }
  function renderBoard() {
    var box = $('board-box');
    var rows = bestRows();
    if (!rows.length) {
      box.innerHTML = '<p class="empty-note">本机还没有任何数据——玩一局游戏，或点击下方"载入示例数据"先看看效果。</p>';
      return;
    }
    var html = '<table class="board-table"><thead><tr>' +
      '<th>排名</th><th>姓名</th><th>游戏</th><th>准确率</th><th>d′</th><th>c</th><th>P(H)</th><th>P(FA)</th><th>A′</th><th>局数</th>' +
      '</tr></thead><tbody>';
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i].best, rk = i + 1;
      html += '<tr' + (r.name === currentUser ? ' class="me-row"' : '') + '>' +
        '<td><span class="rank rk' + (rk <= 3 ? rk : 'n') + '">' + rk + '</span></td>' +
        '<td>' + esc(r.name) + '</td>' +
        '<td>' + roleDot(r.role) + ROLE_NAME[r.role] + '</td>' +
        '<td><b>' + Math.round(r.acc * 100) + '%</b></td>' +
        '<td>' + r.d.toFixed(2) + '</td><td>' + fmtC(r.cc) + '</td>' +
        '<td>' + r.pH.toFixed(2) + '</td><td>' + r.pFA.toFixed(2) + '</td>' +
        '<td>' + (typeof r.ap === 'number' ? r.ap.toFixed(3) : '—') + '</td>' +
        '<td>' + rows[i].count + '</td></tr>';
    }
    box.innerHTML = html + '</tbody></table>';
    fitScroll(box, 10);
  }

  /* ---------------- 散点图（SVG 手绘 + 悬停提示） ---------------- */
  var VW = 380, VH = 320, PL = 46, PR = 14, PT = 16, PB = 40;
  var tip = null, hotCircle = null;

  function sx(v, xdom) { return PL + (v - xdom[0]) / (xdom[1] - xdom[0]) * (VW - PL - PR); }
  function sy(v, ydom) { return VH - PB - (v - ydom[0]) / (ydom[1] - ydom[0]) * (VH - PT - PB); }

  function drawCharts() {
    var recs = load();
    tip = $('data-tip');
    drawScatter($('scatter-dc'), {
      xdom: [-2.2, 2.2], ydom: [0, 4.2], diag: false,
      xlab: '判断标准 c', ylab: '辨别力 d′',
      xTicks: [-2, -1, 0, 1, 2], yTicks: [0, 1, 2, 3, 4],
      get: function (r) { return { x: r.cc, y: r.d }; }
    }, recs);
    drawScatter($('scatter-roc'), {
      xdom: [0, 1], ydom: [0, 1], diag: true,
      xlab: '误报率 P(FA)', ylab: '击中率 P(H)',
      xTicks: [0, 0.25, 0.5, 0.75, 1], yTicks: [0, 0.25, 0.5, 0.75, 1],
      get: function (r) { return { x: r.pFA, y: r.pH }; }
    }, recs);
  }

  function drawScatter(svg, cfg, recs) {
    svg.innerHTML = '';
    // 坐标轴
    el(svg, 'line', { x1: PL, y1: VH - PB, x2: VW - PR, y2: VH - PB, stroke: '#6a716b', 'stroke-width': 1.2 });
    el(svg, 'line', { x1: PL, y1: PT, x2: PL, y2: VH - PB, stroke: '#6a716b', 'stroke-width': 1.2 });
    for (var i = 0; i < cfg.xTicks.length; i++) {
      var tv = cfg.xTicks[i];
      el(svg, 'line', { x1: sx(tv, cfg.xdom), y1: VH - PB, x2: sx(tv, cfg.xdom), y2: VH - PB + 5, stroke: '#6a716b' });
      var tx = el(svg, 'text', { x: sx(tv, cfg.xdom), y: VH - PB + 17, 'font-size': 10.5, fill: '#8f948c', 'text-anchor': 'middle' });
      tx.textContent = tv;
    }
    for (var j = 0; j < cfg.yTicks.length; j++) {
      var yv = cfg.yTicks[j];
      el(svg, 'line', { x1: PL - 4, y1: sy(yv, cfg.ydom), x2: PL, y2: sy(yv, cfg.ydom), stroke: '#6a716b' });
      var ty = el(svg, 'text', { x: PL - 7, y: sy(yv, cfg.ydom) + 3.5, 'font-size': 10.5, fill: '#8f948c', 'text-anchor': 'end' });
      ty.textContent = yv;
    }
    var xl = el(svg, 'text', { x: (PL + VW - PR) / 2, y: VH - 6, 'font-size': 11.5, fill: '#b9bdb2', 'text-anchor': 'middle' });
    xl.textContent = cfg.xlab;
    var yl = el(svg, 'text', { x: 13, y: (PT + VH - PB) / 2, 'font-size': 11.5, fill: '#b9bdb2', 'text-anchor': 'middle' });
    yl.textContent = cfg.ylab;
    yl.setAttribute('transform', 'rotate(-90 13 ' + ((PT + VH - PB) / 2) + ')');
    // 偶然线（对角虚线）
    if (cfg.diag) {
      el(svg, 'line', { x1: sx(0, cfg.xdom), y1: sy(0, cfg.ydom), x2: sx(1, cfg.xdom), y2: sy(1, cfg.ydom), stroke: '#4a4f4b', 'stroke-width': 1.2, 'stroke-dasharray': '5 4' });
    }
    // 数据点（超界 clamp 到图内边缘）
    var pts = [];
    for (var p = 0; p < recs.length; p++) {
      var r = recs[p], v = cfg.get(r);
      var px = Math.max(PL + 5, Math.min(VW - PR - 5, sx(v.x, cfg.xdom)));
      var py = Math.max(PT + 5, Math.min(VH - PB - 5, sy(v.y, cfg.ydom)));
      var isMe = r.name === currentUser;
      var circ = el(svg, 'circle', {
        cx: px, cy: py, r: isMe ? 6 : 4.5,
        fill: ROLE_COLOR[r.role] || '#8892a6', 'fill-opacity': 0.8,
        stroke: isMe ? ME_COLOR : '#d8d4c8', 'stroke-width': isMe ? 2.4 : 1
      });
      pts.push({ x: px, y: py, rec: r, circle: circ });
    }
    // 图例（左上）
    el(svg, 'rect', { x: PL + 8, y: PT + 2, width: 126, height: 66, rx: 8, fill: '#101211', opacity: 0.85, stroke: '#33373a' });
    el(svg, 'rect', { x: PL + 18, y: PT + 11, width: 11, height: 11, rx: 2, fill: ROLE_COLOR.A, 'fill-opacity': 0.85 });
    var l1 = el(svg, 'text', { x: PL + 35, y: PT + 20.5, 'font-size': 11, fill: '#b9bdb2' });
    l1.textContent = ROLE_NAME.A;
    el(svg, 'rect', { x: PL + 18, y: PT + 29, width: 11, height: 11, rx: 2, fill: ROLE_COLOR.B, 'fill-opacity': 0.85 });
    var l2 = el(svg, 'text', { x: PL + 35, y: PT + 38.5, 'font-size': 11, fill: '#b9bdb2' });
    l2.textContent = ROLE_NAME.B;
    el(svg, 'circle', { cx: PL + 23.5, cy: PT + 52.5, r: 4.5, fill: '#9aa3b2', stroke: ME_COLOR, 'stroke-width': 2 });
    var l3 = el(svg, 'text', { x: PL + 35, y: PT + 56.5, 'font-size': 11, fill: '#b9bdb2' });
    l3.textContent = '金色描边 = 你';
    attachHover(svg, pts);
  }

  // 悬停：找最近点（16 SVG 单位内），放大该点并在鼠标旁显示详情。
  // 用 on* 赋值式绑定——重复 drawCharts 时自动覆盖，不会叠加监听
  function attachHover(svg, pts) {
    svg.onmousemove = function (e) {
      var rect = svg.getBoundingClientRect();
      var mx = (e.clientX - rect.left) / rect.width * VW;
      var my = (e.clientY - rect.top) / rect.height * VH;
      var best = null, bd = 16 * 16;
      for (var i = 0; i < pts.length; i++) {
        var ddx = pts[i].x - mx, ddy = pts[i].y - my, dd = ddx * ddx + ddy * ddy;
        if (dd < bd) { bd = dd; best = pts[i]; }
      }
      if (hotCircle) { hotCircle.setAttribute('r', hotCircle._r0); hotCircle = null; }
      if (best) {
        if (!best.circle._r0) best.circle._r0 = parseFloat(best.circle.getAttribute('r'));
        best.circle.setAttribute('r', best.circle._r0 + 2);
        hotCircle = best.circle;
        var r = best.rec;
        tip.innerHTML = '<b>' + esc(r.name) + '</b> · ' + ROLE_NAME[r.role] + '<br>' +
          '准确率 <b>' + Math.round(r.acc * 100) + '%</b> · d′=' + r.d.toFixed(2) + ' · c=' + fmtC(r.cc) + '<br>' +
          'P(H)=' + r.pH.toFixed(2) + ' · P(FA)=' + r.pFA.toFixed(2) + ' · A′=' +
          (typeof r.ap === 'number' ? r.ap.toFixed(3) : '—');
        tip.style.display = 'block';
        tip.style.left = (e.clientX + 14) + 'px';
        tip.style.top = (e.clientY + 12) + 'px';
      } else {
        tip.style.display = 'none';
      }
    };
    svg.onmouseleave = function () {
      if (hotCircle) { hotCircle.setAttribute('r', hotCircle._r0); hotCircle = null; }
      tip.style.display = 'none';
    };
  }

  /* ---------------- 示例数据（课堂演示）：按理论概率二项抽样，字段与真实记录完全同构 ---------------- */
  function genDemo() {
    var names = ['示例·小明', '示例·小红', '示例·阿强', '示例·小林',
                 '示例·阿慧', '示例·大力', '示例·小婉', '示例·老陈'];
    var roles = ['A', 'B'];
    var now = Date.now(), out = [];
    for (var i = 0; i < names.length; i++) {
      for (var j = 0; j < roles.length; j++) {
        var d = 0.8 + Math.random() * 2.6;        // d' ∈ [0.8, 3.4]
        var cc = -1.3 + Math.random() * 2.6;      // c ∈ [-1.3, 1.3]
        var cRaw = cc + d / 2;
        var pHt = 1 - phi(cRaw - d), pFAt = 1 - phi(cRaw);
        var H = 0, FA = 0, s, t;
        for (s = 0; s < 10; s++) if (Math.random() < pHt) H++;
        for (t = 0; t < 10; t++) if (Math.random() < pFAt) FA++;
        var pH = (H + 0.5) / 11, pFA = (FA + 0.5) / 11;   // 与 app.js 同款对数线性校正
        out.push({
          name: names[i], role: roles[j], n: 20,
          H: H, M: 10 - H, FA: FA, CR: 10 - FA,
          pH: pH, pFA: pFA,
          d: zInv(pH) - zInv(pFA),
          cc: -(zInv(pH) + zInv(pFA)) / 2,
          acc: (H + (10 - FA)) / 20,
          ap: aPrime(pH, pFA),
          ts: now - Math.floor(Math.random() * 3 * 86400000)   // 近三天内随机
        });
      }
    }
    return out;
  }

  /* ---------------- 工具栏与入口绑定 ---------------- */
  $('btn-demo').addEventListener('click', function () {
    if (!confirm('载入 16 条示例记录（8 名示例被试 × 2 个游戏），用于课堂演示？')) return;
    saveAll(load().concat(genDemo()));
    renderMine(); renderBoard(); drawCharts();
  });
  $('btn-export').addEventListener('click', function () {
    var blob = new Blob([JSON.stringify(load(), null, 2)], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'SDT游戏数据_' + new Date().toISOString().slice(0, 10) + '.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 500);
  });
  $('btn-clear').addEventListener('click', function () {
    if (!confirm('确定清空本机全部游戏数据？此操作不可恢复！')) return;
    saveAll([]);
    renderMine(); renderBoard(); drawCharts();
  });

  $('btn-data-entry').addEventListener('click', openData);
  $('btn-data-from-result').addEventListener('click', openData);
  $('data-back').addEventListener('click', function () { show('screen-home'); });

  // 供 app.js 调用：登录时同步当前用户名；每局结算时写入记录
  window.SDTStore = { save: save, setCurrent: setCurrent };
})();
