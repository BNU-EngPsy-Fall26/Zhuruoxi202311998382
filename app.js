/* =========================================================
 * 信号检测论 · 交互式实验室 —— 第一阶段（修订版）
 * 功能：登录 → 主界面(难度/试次/角色) → 双游戏 → SDT 结果
 * 场景 A《隔离区哨岗》：夜视人影中找僵尸（有信号=有僵尸）
 * 场景 B《老宅巡夜》：镜中人脸里找鬼（有信号=离开）
 * 纯前端实现，双击 index.html 即可运行。
 * ========================================================= */
(function () {
  'use strict';

  /* ---------------- 工具：标准正态逆累积分布（Acklam 近似） ---------------- */
  function zInv(p) {
    // 将概率 p∈(0,1) 映射为 z 分数，用于 d' / c 的计算
    var a = [-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02,
              1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00];
    var b = [-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02,
              6.680131188771972e+01, -1.328068155288572e+01];
    var c = [-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00,
             -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00];
    var d = [7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00,
             3.754408661907416e+00];
    var plow = 0.02425, phigh = 1 - plow, q, r;
    if (p < plow) {
      q = Math.sqrt(-2 * Math.log(p));
      return (((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5]) /
             ((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1);
    } else if (p > phigh) {
      q = Math.sqrt(-2 * Math.log(1 - p));
      return -(((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5]) /
              ((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1);
    }
    q = p - 0.5; r = q * q;
    return (((((a[0]*r+a[1])*r+a[2])*r+a[3])*r+a[4])*r+a[5])*q /
           (((((b[0]*r+b[1])*r+b[2])*r+b[3])*r+b[4])*r+1);
  }
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function rand(lo, hi) { return lo + Math.random() * (hi - lo); }
  function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
  function shuffle(arr) {
    for (var i = arr.length - 1; i > 0; i--) {
      var r = Math.floor(Math.random() * (i + 1));
      var t = arr[i]; arr[i] = arr[r]; arr[r] = t;
    }
    return arr;
  }
  function $(id) { return document.getElementById(id); }

  /* ---------------- 全局状态 ---------------- */
  var state = {
    user: { name: '', sid: '' },
    dSet: 1.8,          // 主界面设定的信号强度 d'
    nTrials: 20,        // 试次数（20 或 100）
    role: null,         // 'A' | 'B'
    trials: [],         // 每轮是否有信号（true=有），长度 nTrials，P(S)=0.5
    round: 0,           // 当前轮（1 起）
    counts: { H: 0, M: 0, FA: 0, CR: 0 },
    log: [],            // 逐轮原始记录（第三阶段做数据统计用）
    judgeShownAt: 0,    // 判断界面出现时刻（算反应时）
    answered: false,
    raf: null           // 动画句柄
  };

  /* ---------------- 角色（场景）配置 ---------------- */
  var ROLES = {
    A: {
      title: '隔离区哨岗',
      subtitle: '封锁线深夜 · 在人影中寻找僵尸',
      epoch: '20XX · 封锁线',
      rule: '观察夜视画面里走近的人影。如果其中混着僵尸——走路拖拉、双臂前伸、头颈耷拉——请选择【有僵尸！开枪警戒/有信号】；如果都是幸存者，请选择【无僵尸，放行通过/无信号】。画面显示时间很短，消失后再下判断。',
      yesLabel: '有僵尸！开枪警戒/有信号',
      noLabel: '无僵尸，放行通过/无信号',
      judgeSub: '刚才的人影里有没有混入僵尸？',
      // 四种结果的实际含义（游戏说明页展示）
      outcomes: [
        ['击中 H', '人影里确实有僵尸，你开枪命中——守住了闸门'],
        ['漏报 M', '人影里混着僵尸，你却放行——僵尸冲进了隔离区'],
        ['误报 FA', '其实都是幸存者，你却开枪——错伤了活人'],
        ['正确拒斥 CR', '确实都是幸存者，你放行——他们安全通过']
      ],
      duration: 2500    // 刺激呈现时长 ms
    },
    B: {
      title: '老宅巡夜',
      subtitle: '凌晨 03:00 · 镜中浮现的脸',
      epoch: '旧宅走廊',
      rule: '观察镜子里浮现的几张脸。如果其中混着鬼——脸色发灰、眼白发暗、五官歪斜——请选择【有鬼！跑为上策/有信号】；如果都是房客，请选择【无鬼，留宿此地/无信号】。画面显示时间很短，消失后再下判断。',
      yesLabel: '有鬼！跑为上策/有信号',
      noLabel: '无鬼，留宿此地/无信号',
      judgeSub: '刚才的镜子里有没有鬼？',
      outcomes: [
        ['击中 H', '镜子里确实有鬼，你选择离开——逃过一劫'],
        ['漏报 M', '镜子里混着鬼，你却留宿——夜里凶多吉少'],
        ['误报 FA', '其实都是房客，你却仓皇逃离——错怪了好人'],
        ['正确拒斥 CR', '确实都是房客，你安心留宿——睡了个好觉']
      ],
      duration: 2200
    }
  };

  /* ================= 屏幕切换 ================= */
  function show(id) {
    var screens = document.querySelectorAll('.screen');
    for (var i = 0; i < screens.length; i++) screens[i].classList.remove('active');
    $(id).classList.add('active');
    window.scrollTo(0, 0);
  }

  /* ================= 登录 ================= */
  $('btn-login').addEventListener('click', function () {
    var name = $('inp-name').value.trim();
    var sid = $('inp-id').value.trim();
    if (!name) { $('login-err').textContent = '请填写姓名'; return; }
    if (!sid) { $('login-err').textContent = '请填写学号'; return; }
    state.user = { name: name, sid: sid };
    $('user-info').textContent = name + '（' + sid + '）';
    if (window.SDTStore) window.SDTStore.setCurrent(name);
    show('screen-home');
  });
  $('inp-id').addEventListener('keydown', function (e) { if (e.key === 'Enter') $('btn-login').click(); });
  $('btn-logout').addEventListener('click', function () {
    stopAnim();
    $('inp-name').value = ''; $('inp-id').value = ''; $('login-err').textContent = '';
    if (window.SDTStore) window.SDTStore.setCurrent('');
    show('screen-login');
  });

  /* ================= 主界面：参数 ================= */
  $('slider-d').addEventListener('input', function () {
    state.dSet = parseFloat(this.value);
    $('slider-d-val').textContent = state.dSet.toFixed(1);
  });
  var trialRadios = document.querySelectorAll('input[name=trials]');
  for (var i = 0; i < trialRadios.length; i++) {
    trialRadios[i].addEventListener('change', function () {
      state.nTrials = parseInt(this.value, 10);
    });
  }
  var roleBtns = document.querySelectorAll('.role-start');
  for (var j = 0; j < roleBtns.length; j++) {
    roleBtns[j].addEventListener('click', function () { startGame(this.dataset.role); });
  }

  /* ================= 游戏流程 ================= */
  function startGame(role) {
    var R = ROLES[role];
    state.role = role;
    state.round = 0;
    state.counts = { H: 0, M: 0, FA: 0, CR: 0 };
    state.log = [];

    // 生成试次序列：恰好一半有信号（P(S)=0.5），随机打乱
    var n = state.nTrials, arr = [];
    for (var k = 0; k < n; k++) arr.push(k < n / 2);
    shuffle(arr);
    state.trials = arr;

    // 规则常驻顶部一行；第一轮先显示"游戏说明"（仅规则），点击开始后才进入第一轮
    $('game-title').textContent = R.title;
    $('game-subtitle').textContent = R.subtitle;
    $('rule-strip').innerHTML = '<b>规则</b>：' + R.rule;
    // 游戏说明：规则 + 先验概率 P(S) + 四种结果的实际含义（对应作业评分点"场景与参数定义"）
    var sigName = role === 'A' ? '僵尸' : '鬼';
    var ocRows = '';
    for (var oc = 0; oc < R.outcomes.length; oc++) {
      ocRows += '<tr><td><b>' + R.outcomes[oc][0] + '</b></td><td>' + R.outcomes[oc][1] + '</td></tr>';
    }
    $('intro-text').innerHTML = '<p>' + R.rule + '</p>' +
      '<p class="intro-prior">信号出现规律：每轮有 <b>50%</b> 的概率混着' + sigName +
      '（先验概率 P(S) = 0.5），有信号与无信号的试次各占一半、顺序随机。</p>' +
      '<table class="intro-oc"><tr><th>结果</th><th>本场景中的实际含义</th></tr>' + ocRows + '</table>';
    $('btn-yes').textContent = R.yesLabel;
    $('btn-no').textContent = R.noLabel;
    $('judge-sub').textContent = R.judgeSub;
    $('feedback').textContent = ''; $('feedback').className = 'feedback';
    $('judge-btns').classList.add('hidden');
    $('judge-mask').classList.add('hidden');
    $('stage').classList.add('hidden');
    $('intro-panel').classList.remove('hidden');
    updateStatus();
    show('screen-game');
  }

  $('btn-start-game').addEventListener('click', function () {
    $('intro-panel').classList.add('hidden');
    nextRound();
  });

  function updateStatus() {
    $('round-info').textContent = '第 ' + Math.max(1, state.round) + ' / ' + state.nTrials + ' 次';
    $('record-info').innerHTML = '已记录：击中 <b class="hl">' + state.counts.H +
      '</b> · 误报 <b class="fa">' + state.counts.FA + '</b>';
  }

  function nextRound() {
    state.round++;
    if (state.round > state.nTrials) { showResults(); return; }
    updateStatus();
    $('feedback').textContent = ''; $('feedback').className = 'feedback';
    $('judge-btns').classList.add('hidden');
    $('judge-mask').classList.add('hidden');
    $('stage').classList.remove('hidden');
    state.answered = false;

    var hasSignal = state.trials[state.round - 1];
    // 每轮实际难度在设定值附近小幅随机波动（±0.6，限幅）
    var dRound = clamp(state.dSet + (Math.random() * 2 - 1) * 0.6, 0.3, 4.0);
    // d' → 信号可辨识度 k∈[0.08,1]：d' 越小线索越微弱
    var k = clamp((dRound - 0.5) / 3.0, 0.08, 1);
    state.log.push({ round: state.round, signal: hasSignal, dRound: +dRound.toFixed(2) });

    renderScene(state.role, hasSignal, k);

    // 刺激呈现时长到 → 画面消失，进入判断
    var dur = ROLES[state.role].duration;
    setTimeout(function () {
      if (state.answered) return;
      stopAnim();
      $('judge-mask').classList.remove('hidden');
      $('judge-btns').classList.remove('hidden');
      state.judgeShownAt = performance.now();
    }, dur);
  }

  function judge(saidYes) {
    if (state.answered) return;
    state.answered = true;
    stopAnim();
    var rec = state.log[state.log.length - 1];
    var signal = rec.signal, out, msg, cls, isMiss = false;
    if (state.role === 'A') {
      if (signal && saidYes)       { out = 'H';  msg = '✓ 击中！确实有僵尸混在其中'; cls = 'ok'; }
      else if (signal && !saidYes) { out = 'M';  msg = '✗ 漏报！其实混着僵尸——僵尸冲了进来！'; cls = 'bad'; isMiss = true; }
      else if (!signal && saidYes) { out = 'FA'; msg = '⚠ 误报！其实都是幸存者'; cls = 'bad'; }
      else                         { out = 'CR'; msg = '✓ 正确拒斥——都是幸存者'; cls = 'ok'; }
    } else {
      if (signal && saidYes)       { out = 'H';  msg = '✓ 击中！镜子里确实有鬼'; cls = 'ok'; }
      else if (signal && !saidYes) { out = 'M';  msg = '✗ 漏报！其实混着鬼——不该留下的……'; cls = 'bad'; isMiss = true; }
      else if (!signal && saidYes) { out = 'FA'; msg = '⚠ 误报！其实都是房客'; cls = 'bad'; }
      else                         { out = 'CR'; msg = '✓ 正确拒斥——都是房客，安心住'; cls = 'ok'; }
    }
    state.counts[out]++;
    rec.response = saidYes; rec.outcome = out;
    rec.rt = Math.round(performance.now() - state.judgeShownAt);
    updateStatus();
    var fb = $('feedback');
    fb.textContent = msg; fb.className = 'feedback ' + cls;
    $('judge-btns').classList.add('hidden');
    // 只有漏报触发全屏视频反馈；视频完整播完（~4s）后自动进入下一轮，统计照常
    if (isMiss) {
      showMissAnim();
      setTimeout(nextRound, 4400);
    } else {
      setTimeout(nextRound, 1400);
    }
  }

  /* 漏报全屏视频反馈：直接播放用户提供的 mp4（A=隔离区僵尸扑屏，B=老宅鬼影扑屏） */
  var MISS_VIDEOS = {
    A: 'assets/miss_A.mp4',
    B: 'assets/miss_B.mp4'
  };
  function showMissAnim() {
    var ov = $('miss-overlay');
    var vid = $('miss-video');
    $('miss-title').textContent = state.role === 'A' ? '漏报！僵尸突破哨岗！' : '漏报！鬼影扑来了！';
    ov.className = 'miss-overlay hidden ' + state.role;
    vid.src = MISS_VIDEOS[state.role];
    vid.currentTime = 0;
    vid.loop = false;
    void ov.offsetWidth;
    ov.classList.remove('hidden');
    // 用 onended 确保视频真正播完再隐藏，避免 setTimeout 与视频不同步导致卡住
    vid.onended = function () {
      ov.classList.add('hidden');
      vid.onended = null;
    };
    vid.play();
  }
  $('btn-yes').addEventListener('click', function () { judge(true); });
  $('btn-no').addEventListener('click', function () { judge(false); });

  function stopAnim() {
    if (state.raf) { cancelAnimationFrame(state.raf); state.raf = null; }
  }

  /* ================= 场景渲染（SVG 动画） ================= */
  var NS = 'http://www.w3.org/2000/svg';
  function el(parent, tag, attrs) {
    var e = document.createElementNS(NS, tag);
    for (var k in attrs) e.setAttribute(k, attrs[k]);
    parent.appendChild(e);
    return e;
  }
  function renderScene(role, hasSignal, k) {
    stopAnim();
    var svg = $('scene');
    svg.innerHTML = '';
    if (role === 'A') sceneQuarantine(svg, hasSignal, k);
    else sceneMansion(svg, hasSignal, k);
  }

  /* ---- 场景 A：隔离区哨岗（夜视人影） ----
   * 背景：隔离区夜景氛围图（assets/game1.jpg）+ 随机闪烁/漂浮光点
   * 姿态系统：普通人 3 套姿态 × 僵尸 3 套畸变姿态，按线索强度插值，8 帧相位量化动画。
   * 僵尸类型化（防止"看手认僵尸"）：arm 只举手头正常 / head 只垂头手正常 /
   *   slow 姿态正常但明显慢速（别人会超过它）/ classic 组合型。
   * 手前伸角度随难度 k 缩放：d' 大（简单）角度大，d' 小（难）只比正常摆臂多一点。 ---- */
  var POSES_NORMAL = [
    { legSwing: 26, armSwing: 20, lean: 3,  bob: 3.2, rate: 1.25, drag: false, hunch: 0,  twist: 0,  jitter: 0 },
    { legSwing: 13, armSwing: 9,  lean: 0,  bob: 1.6, rate: 0.85, drag: false, hunch: 0,  twist: 0,  jitter: 0 },
    { legSwing: 19, armSwing: 11, lean: 5,  bob: 2.2, rate: 1.0,  drag: false, hunch: 0,  twist: 0,  jitter: 0 }
  ];
  var POSES_ZOMBIE = [
    { legSwing: 12, armSwing: 8,  lean: 9,  bob: 2.0, rate: 0.8,  drag: true,  hunch: 8,  twist: 0,  jitter: 1.2 },  // 跛行拖拽腿
    { legSwing: 10, armSwing: 6,  lean: 16, bob: 2.4, rate: 0.75, drag: false, hunch: 16, twist: 0,  jitter: 1.0 },  // 佝偻弯腰
    { legSwing: 15, armSwing: 14, lean: 7,  bob: 2.2, rate: 0.85, drag: false, hunch: 6,  twist: 10, jitter: 2.2 }   // 肢体扭曲晃动
  ];
  var N_FRAMES = 8;   // 帧切换动画的循环帧数

  function sceneQuarantine(svg, hasSignal, k) {
    svg.style.background = '#04070c';
    // 场景氛围图（隔离区夜景：栅栏、哨塔、月亮）
    el(svg, 'image', { href: 'assets/game1.jpg', x: 0, y: 0, width: 460, height: 220,
                       preserveAspectRatio: 'xMidYMid slice', opacity: 0.95 });
    el(svg, 'rect', { x: 0, y: 0, width: 460, height: 220, fill: '#000', opacity: 0.18 });
    el(svg, 'text', { x: 14, y: 20, 'font-size': 11, fill: '#5DCAA5', 'font-family': 'monospace' })
      .textContent = 'CAM 0' + (1 + Math.floor(Math.random() * 9)) + ' · LOW-LIGHT · GATE ' +
                     String.fromCharCode(65 + Math.floor(Math.random() * 4));

    // 随机闪烁光点（3~6 个，纯干扰）
    var flick = [];
    for (var f = 0; f < 3 + Math.floor(Math.random() * 4); f++) {
      flick.push({
        c: el(svg, 'circle', { r: rand(1.1, 1.8), fill: '#EAF6EF', opacity: 0.2 }),
        x: rand(30, 440), y: rand(30, 165)
      });
    }

    // 缓慢漂浮的移动光点（1~2 个，像飞虫 / 远处车灯）
    var movers = [];
    for (var m = 0; m < 1 + Math.floor(Math.random() * 2); m++) {
      movers.push({
        c: el(svg, 'circle', { r: rand(1.2, 1.8), fill: '#BFD9FF', opacity: 0.4 }),
        x: rand(0, 460), y: rand(35, 150), vx: (Math.random() < 0.5 ? -1 : 1) * rand(8, 20)
      });
    }

    // 人影：2~4 个，高矮随机（小个子步频快、步幅小，是干扰也是线索）
    var names = ['head','sh','hip','kL','fL','kR','fR','eL','hL','eR','hR'];
    function mkDots(s) {
      var d = {};
      names.forEach(function (n) {
        d[n] = el(svg, 'circle', {
          r: Math.max(2, n === 'head' ? 4 * s : 3 * s),
          fill: '#EAF6EF', opacity: 0.92
        });
      });
      return d;
    }
    var nWalk = 2 + Math.floor(Math.random() * 3);
    var xs = shuffle([90, 200, 310, 420]);
    var walkers = [];
    for (var w = 0; w < nWalk; w++) {
      var s = rand(0.45, 1.0);
      walkers.push({
        d: mkDots(s), x: xs[w] + rand(-15, 15), s: s,
        phi: rand(0, Math.PI * 2),
        rate: 3.6 + (1.0 - s) * 2.8,       // 个子越小步频越快
        poseN: pick(POSES_NORMAL),          // 本套姿态：普通池随机一套
        poseZ: pick(POSES_ZOMBIE),          // 僵尸池随机一套（有信号时按线索强度插值生效）
        seed: rand(0, Math.PI * 2),
        q: Math.random() * 0.30,           // 幸存者自带的随机小瑕疵
        zType: null,                        // 僵尸类型（有信号时赋值）
        k: 0,                               // 本局难度系数（线索缩放用）
        speedMul: 1                         // 速度倍率（slow 型 < 1）
      });
    }
    // 有信号时随机挑一个变成僵尸。四种类型，防止"看手认僵尸"的单一策略：
    //   arm     只前伸手臂（角度随难度 k 缩放），头颈几乎正常
    //   head    头颈耷拉比常人明显加重，但手臂正常摆动
    //   slow    姿态几乎正常，但步速/步频明显更慢（别人会超过它）
    //   classic 经典组合型（手前伸 + 头耷拉 + 佝偻）
    if (hasSignal) {
      var zi = Math.floor(Math.random() * walkers.length);
      var zw = walkers[zi];
      zw.zType = pick(['arm', 'head', 'slow', 'classic']);
      zw.k = k;
      zw.q = 0.25 + 0.75 * k;                 // classic 用的总线索强度
      if (zw.zType === 'slow') {
        zw.q = rand(0, 0.12);                 // 姿态几乎正常
        zw.speedMul = 0.40 + 0.12 * Math.random();
        zw.rate = 2.1;                        // 步频明显更慢
      }
    }

    function J(w, n, x, y, jit) {
      w.d[n].setAttribute('cx', x + (Math.random() - 0.5) * jit);
      w.d[n].setAttribute('cy', y + (Math.random() - 0.5) * jit);
    }
    // 帧切换动画：相位量化到 N_FRAMES 帧，帧间直接跳变；
    // 有效姿态参数 = 普通姿态 + q ×（僵尸姿态 − 普通姿态）
    function drawWalker(w, fIdx) {
      var s = w.s, D = Math.PI / 180;
      var th8 = 2 * Math.PI * fIdx / N_FRAMES;          // 当前帧相位角
      var sn = Math.sin(th8), sn2 = Math.sin(2 * th8);
      var pn = w.poseN, pz = w.poseZ;
      // 僵尸类型化：把线索强度拆成 手臂 qArm / 头颈 qHead / 体态 qPose 三个独立分量，
      // 防止被试只靠"看手"识别僵尸
      var qArm, qHead, qPose;
      var zt = w.zType, kk = w.k || 0;
      if (!zt || zt === 'classic') { qArm = qHead = qPose = w.q; }
      else if (zt === 'arm') {          // 只举手：头几乎正常
        qArm = 0.35 + 0.65 * kk;
        qHead = qArm * 0.15;
        qPose = 0.15 + 0.45 * kk;
      } else if (zt === 'head') {       // 只垂头：手臂完全正常
        qArm = 0;
        qHead = 0.40 + 0.60 * kk;
        qPose = 0.15 + 0.40 * kk;
      } else {                          // slow：姿态近乎正常，速度/步频才是线索
        qArm = 0; qHead = 0; qPose = w.q;
      }
      function L(a, b) { return a + (b - a) * qPose; }      // 体态参数按 qPose 插值
      var legSw = L(pn.legSwing, pz.legSwing);
      var armSw = L(pn.armSwing, pz.armSwing);
      var lean  = L(pn.lean, pz.lean) + pz.hunch * qPose;   // 前倾 + 佝偻
      var bobA  = L(pn.bob, pz.bob);
      var twist = pz.twist * qPose;                     // 肩部扭曲（仅僵尸姿态）
      var jz    = pz.jitter * qPose;                    // 随机肢体抖动（仅僵尸）
      var jit   = 1.6 + 1.2 * s + jz;
      var rateEff = L(pn.rate, pz.rate);
      w.spEff = (16 + 14 * s) * rateEff * (w.speedMul || 1);  // slow 型 ×0.4 左右 → 会被别人超过

      var bob = bobA * s * sn2;                         // 身体上下颠簸（双步频）
      var hipY = 189 - 62 * s + 0.6 * bob;
      var shY = hipY - 38 * s + 0.5 * bob;
      var shX = w.x - lean * s * 0.9 + twist * s * 0.4 * Math.sin(th8 * 0.5);  // 肩横向扭曲
      // 头部：前伸 + 耷拉 + 不规则晃动（幅度随 qHead——举手型头部几乎正常）
      var wob = (1 + 5 * qHead) * s * Math.sin(fIdx * 2.7 + w.seed);
      var headX = shX - (2 + 3 * qHead) * s + wob;
      var headY = shY - 20 * s + 4 * qHead * s + 0.3 * bob + wob * 0.5 * qHead;
      var L1 = 30 * s, L2 = 32 * s, A1 = 22 * s, A2 = 20 * s;
      // 腿：跛行姿态下右腿拖拽（体态线索随 qPose）
      var dragOn = pz.drag && qPose > 0.45;
      [['L', 0, false], ['R', Math.PI, dragOn]].forEach(function (pr) {
        var tag = pr[0], ph = th8 + pr[1], drag = pr[2];
        var A = legSw * D;
        if (drag) A *= (1 - 0.62 * qPose);              // 拖腿摆幅骤减
        var th = A * Math.sin(ph);
        var bendBase = 20 + 30 * Math.max(0, Math.sin(ph + 1.1));
        var bend = ((drag ? (1 - 0.7 * qPose) : 1) * bendBase + 6 * qPose) * D;
        var kx = w.x - L1 * Math.sin(th), ky = hipY + L1 * Math.cos(th);
        var fx2 = kx - L2 * Math.sin(th - bend), fy2 = ky + L2 * Math.cos(th - bend);
        J(w, 'k' + tag, kx, ky, jit);
        J(w, 'f' + tag, fx2, Math.min(fy2, 189 + (drag ? 1.5 * qPose : 0)), jit);
      });
      // 手臂：正常摆臂 ↔ 前伸僵直，按 qArm 混合（垂头/慢行型 qArm=0，手臂完全正常）；
      // 前伸角度随难度 k 缩放——d' 大（简单）角度大，d' 小（难）只比正常摆臂多一点
      [['L', Math.PI], ['R', 0]].forEach(function (pr) {
        var tag = pr[0], ph = th8 + pr[1] + (pz.twist > 0 ? qPose * Math.PI * 0.5 : 0);
        var swing = armSw * D * Math.sin(ph);                       // 正常摆臂
        var hold = (16 + 44 * kk) * D + 3 * D * Math.sin(2 * ph);   // 前伸角：约 19°(难)~60°(易)
        var ang = swing * (1 - qArm) + hold * qArm;
        var ex = shX - A1 * Math.sin(ang), ey = shY + A1 * Math.cos(ang);
        var bendN = -25 * D * (Math.sin(ph) > 0 ? 1 : 0.4);
        var hb = ang + bendN * (1 - qArm) - 8 * D * qArm;
        var hx2 = ex - A2 * Math.sin(hb), hy2 = ey + A2 * Math.cos(hb);
        J(w, 'e' + tag, ex, ey, jit);
        J(w, 'h' + tag, hx2, hy2, jit);
      });
      J(w, 'head', headX, headY, jit);
      J(w, 'sh', shX, shY, jit);
      J(w, 'hip', w.x, hipY, jit);
    }

    var t = 0, last = 0;
    function frame(ts) {
      var dt = Math.min(0.05, (ts - last) / 1000 || 0.016); last = ts; t += dt;
      walkers.forEach(function (w) {
        w.phi += dt * w.rate;
        w.x -= (w.spEff || 20) * dt;
        if (w.x < -70) w.x = 520 + Math.random() * 30;
        var fIdx = Math.floor((w.phi / (2 * Math.PI)) * N_FRAMES) % N_FRAMES;
        drawWalker(w, fIdx);
      });
      flick.forEach(function (fEl) {                   // 远处光点闪烁
        fEl.c.setAttribute('cx', fEl.x + (Math.random() - 0.5) * 4);
        fEl.c.setAttribute('cy', fEl.y + (Math.random() - 0.5) * 4);
        fEl.c.setAttribute('opacity', 0.08 + 0.28 * Math.random());
      });
      movers.forEach(function (mv) {                   // 漂浮光点缓慢移动
        mv.x += mv.vx * dt;
        if (mv.x < -10) mv.x = 470; if (mv.x > 470) mv.x = -10;
        mv.c.setAttribute('cx', mv.x);
        mv.c.setAttribute('cy', mv.y + 6 * Math.sin(t * 1.3 + mv.x * 0.05));
        mv.c.setAttribute('opacity', 0.2 + 0.3 * Math.abs(Math.sin(t * 2 + mv.x)));
      });
      state.raf = requestAnimationFrame(frame);
    }
    state.raf = requestAnimationFrame(frame);
  }

  /* ---- 场景 B：老宅巡夜（镜中人脸） ----
   * 背景：老宅走廊氛围图（assets/game2.jpg）
   * 肤色：昏暗暗调肤色；鬼/人肤色差异刻意很小（鬼仅轻微灰化）。
   * 鬼脸类型池（每局随机，防背脸）：expr 表情阴翳（肤色五官正常）/
   *   skin 仅肤色微差（神情表情与常人无异）/ tilt 五官倾斜（肤色表情正常）/
   *   combo 表情+肤色双通道。k 大（d' 大）时鬼脸可能罩一层薄暗影增加视觉难度。
   * 布局：每张脸只绘制一次——鬼脸独立占位，绝不与人脸重叠、无叠影露边；
   *       椭圆间隔系数 1.18；允许少量遮挡（<1/2）。脸全部静止，不眨眼不闪动。 ---- */
  var HUMAN_EXPRS = ['calm', 'nervous', 'scared', 'confused'];
  var GHOST_EXPRS = ['eerieSmile', 'hollowEyes', 'sharpGlare', 'tornMouth'];

  function sceneMansion(svg, hasSignal, k) {
    svg.style.background = '#08090b';
    el(svg, 'image', { href: 'assets/game2.jpg', x: 0, y: 0, width: 460, height: 220,
                       preserveAspectRatio: 'xMidYMid slice', opacity: 0.95 });
    el(svg, 'rect', { x: 0, y: 0, width: 460, height: 220, fill: '#0a0614', opacity: 0.28 });
    el(svg, 'text', { x: 14, y: 20, 'font-size': 11, fill: '#AFA9EC', 'font-family': 'monospace' })
      .textContent = 'MIRROR · HALLWAY ' + String.fromCharCode(65 + Math.floor(Math.random() * 4)) +
                     ' · 0' + (2 + Math.floor(Math.random() * 4)) + ':' +
                     ('0' + Math.floor(Math.random() * 60)).slice(-2) + ' AM';

    // 极弱光晕（仅保证昏暗中的可见度，不再把脸打白）
    var defs = el(svg, 'defs', {});
    [['glowWarm', '#d8c9a8'], ['glowCold', '#9fb8ab']].forEach(function (gd) {
      var gr = el(defs, 'radialGradient', { id: gd[0], cx: '50%', cy: '50%', r: '50%' });
      el(gr, 'stop', { offset: '0%', 'stop-color': gd[1], 'stop-opacity': 0.10 });
      el(gr, 'stop', { offset: '100%', 'stop-color': gd[1], 'stop-opacity': 0 });
    });

    function lerpColor(c1, c2, t) {
      function h2r(c) { return [parseInt(c.substr(1,2),16), parseInt(c.substr(3,2),16), parseInt(c.substr(5,2),16)]; }
      var a = h2r(c1), b = h2r(c2);
      return 'rgb(' + Math.round(a[0]+(b[0]-a[0])*t) + ',' + Math.round(a[1]+(b[1]-a[1])*t) + ',' + Math.round(a[2]+(b[2]-a[2])*t) + ')';
    }

    var SKINS = ['#93887a', '#8d8274', '#9a8d7c', '#877d70', '#8f8478'];  // 昏暗暖灰肤色
    var HAIRS = ['#3B322C', '#2C2C2E', '#5A4632', '#6B5636'];

    /* ---- 表情绘制：所有脸共用同一套矢量原语，保持画风/色彩/清晰度统一 ---- */
    function drawBrow(g, x1, y1, cx, cy, x2, y2, color, w) {
      el(g, 'path', { d: 'M' + x1 + ' ' + y1 + ' Q ' + cx + ' ' + cy + ' ' + x2 + ' ' + y2,
                      stroke: color, 'stroke-width': w, fill: 'none', 'stroke-linecap': 'round' });
    }
    function drawMouth(g, d, color, w) {
      el(g, 'path', { d: d, stroke: color, 'stroke-width': w, fill: 'none', 'stroke-linecap': 'round' });
    }

    /* 单张脸。
     * o.q：鬼特征强度（0=常人）；o.expr：表情名；
     * o.ghost：是否为鬼；o.skinGhost：肤色通道是否带鬼特征；
     * o.exprGhost：表情通道是否带鬼特征（歪斜/歪嘴/阴影随 q）；
     * o.tiltGhost：五官倾斜通道（肤色表情正常，整脸明显偏转 + 双眼一高一低）；
     * o.skinFaint：肤色微差型（差异压到最小）。
     * 各通道独立随机组合，且参数每局随机，避免被试记住固定的一张鬼脸。 */
    function makeFace(x, y, s, o) {
      var q = o.q, expr = o.expr, ghost = o.ghost, skinGhost = o.skinGhost, exprGhost = o.exprGhost;
      var g = el(svg, 'g', {});
      var tilt = rand(-4, 4)
        + (exprGhost ? rand(1.5, 4) * (Math.random() < 0.5 ? -1 : 1) * q : 0)
        + (o.tiltGhost ? pick([-1, 1]) * rand(7, 13) : 0);   // tilt 型：整脸明显倾斜（常人仅 ±4°）
      g.setAttribute('transform', 'rotate(' + tilt.toFixed(1) + ' ' + x + ' ' + y + ')');

      var hair = pick(HAIRS);
      var style = pick(['none', 'tuft', 'bun', 'side', 'none']);
      // 肤色通道：鬼仅轻微灰绿化；skin 微差型压到 0.10~0.20（除了肤色有一点微弱差异，其他与常人无异）
      var skin = skinGhost ? lerpColor(pick(SKINS), '#7e8a80', (o.skinFaint ? rand(0.10, 0.20) : rand(0.22, 0.40)) * q) : pick(SKINS);
      // 个体差异：脸型、眼距、嘴位都有抖动，不再千篇一律
      var rxF = 52 * s * rand(0.92, 1.08);
      var ryF = 70 * s * rand(0.94, 1.06);
      var eyeDX = 19 * s * rand(0.9, 1.1);
      var eyeY = -16 * s + rand(-1.5, 1.5) * s;
      var mouthY = 27 * s + rand(-2, 2) * s;
      var asym = (Math.random() - 0.5) * 2.5 + (exprGhost ? 4.5 * q * s : 0)
               + (o.tiltGhost ? pick([-1, 1]) * rand(3.5, 6.5) * s : 0);   // tilt 型：双眼一高一低
      var isGhost = skinGhost;
      var ink = '#3f3a34', lip = '#463f38';

      // 光晕（弱）
      el(g, 'ellipse', { cx: x, cy: y, rx: 74 * s, ry: 90 * s, fill: 'url(#' + (isGhost ? 'glowCold' : 'glowWarm') + ')' });

      // 耳后小缕（后层）
      if (style === 'side') {
        el(g, 'ellipse', { cx: x - rxF - 2*s, cy: y + 16*s, rx: 5*s, ry: 15*s, fill: hair });
        el(g, 'ellipse', { cx: x + rxF + 2*s, cy: y + 16*s, rx: 5*s, ry: 15*s, fill: hair });
      }
      // 脸
      el(g, 'ellipse', { cx: x, cy: y, rx: rxF, ry: ryF, fill: skin });
      // （不再添加轮廓污渍——鬼脸要求颜色均匀）

      // ---- 眼（随表情变化） ----
      var eyeRY = 6 * s, pupilR = 3.2 * s, whiteOp = 0.9;
      if (expr === 'scared') { eyeRY = 8.6 * s; }
      if (expr === 'sharpGlare') { eyeRY = (6 - 1.8 * q) * s; }
      if (expr === 'hollowEyes') { pupilR = (3.2 - 1.5 * q) * s; whiteOp = 0.9 - 0.22 * q; }
      if (expr === 'nervous') { eyeRY = 6.6 * s; }
      el(g, 'ellipse', { cx: x - eyeDX, cy: y + eyeY, rx: 10 * s, ry: eyeRY, fill: '#d8d3c4', opacity: whiteOp });
      el(g, 'ellipse', { cx: x + eyeDX, cy: y + eyeY + asym, rx: 10 * s, ry: eyeRY, fill: '#d8d3c4', opacity: whiteOp });
      el(g, 'circle', { cx: x - eyeDX, cy: y + eyeY, r: pupilR, fill: '#22251F' });
      el(g, 'circle', { cx: x + eyeDX, cy: y + eyeY + asym, r: pupilR, fill: '#22251F' });
      // 空洞眼神：仅靠瞳孔缩小 + 眼白暗淡表达（不加眼下阴影，保持鬼脸颜色均匀）

      // ---- 眉（随表情变化） ----
      var bw = 2 * s, byU = y - 26 * s;
      if (expr === 'calm' || expr === 'eerieSmile') {
        if (Math.random() < 0.7) {
          drawBrow(g, x - eyeDX - 9*s, byU, x - eyeDX, byU - 1.5*s, x - eyeDX + 9*s, byU, ink, bw);
          drawBrow(g, x + eyeDX - 9*s, byU + asym*0.4, x + eyeDX, byU - 1.5*s + asym*0.4, x + eyeDX + 9*s, byU + asym*0.4, ink, bw);
        }
      } else if (expr === 'nervous') {           // 内端上挑（紧张）
        drawBrow(g, x - eyeDX - 9*s, byU + 1*s, x - eyeDX, byU - 4*s, x - eyeDX + 9*s, byU - 2*s, ink, bw);
        drawBrow(g, x + eyeDX - 9*s, byU - 2*s + asym*0.4, x + eyeDX, byU - 4*s, x + eyeDX + 9*s, byU + 1*s + asym*0.4, ink, bw);
      } else if (expr === 'scared') {            // 双眉高高挑起
        drawBrow(g, x - eyeDX - 9*s, byU - 1*s, x - eyeDX, byU - 6*s, x - eyeDX + 9*s, byU - 3*s, ink, bw);
        drawBrow(g, x + eyeDX - 9*s, byU - 3*s, x + eyeDX, byU - 6*s, x + eyeDX + 9*s, byU - 1*s + asym*0.4, ink, bw);
      } else if (expr === 'confused') {          // 一眉平一眉挑（疑惑）
        drawBrow(g, x - eyeDX - 9*s, byU, x - eyeDX, byU, x - eyeDX + 9*s, byU, ink, bw);
        drawBrow(g, x + eyeDX - 9*s, byU - 1*s, x + eyeDX, byU - 5*s, x + eyeDX + 9*s, byU - 2*s, ink, bw);
      } else if (expr === 'sharpGlare') {        // 眉尖向内下压（尖锐压迫），随 q
        var a = 6 * q * s;
        drawBrow(g, x - eyeDX - 9*s, byU - 2*s - a, x - eyeDX, byU + a, x - eyeDX + 9*s, byU + 2*s + a, ink, bw);
        drawBrow(g, x + eyeDX - 9*s, byU + 2*s + a, x + eyeDX, byU + a, x + eyeDX + 9*s, byU - 2*s - a + asym*0.4, ink, bw);
      }

      // ---- 嘴（随表情变化） ----
      if (expr === 'calm') {
        drawMouth(g, 'M' + (x - 14*s) + ' ' + (y + mouthY) + ' Q ' + x + ' ' + (y + mouthY - 3*s) + ' ' + (x + 14*s) + ' ' + (y + mouthY), lip, 2 * s);
      } else if (expr === 'nervous') {
        drawMouth(g, 'M' + (x - 8*s) + ' ' + (y + mouthY) + ' L ' + (x + 8*s) + ' ' + (y + mouthY + 0.5*s), lip, 2 * s);
      } else if (expr === 'scared') {            // 小圆口
        el(g, 'ellipse', { cx: x, cy: y + mouthY, rx: 4 * s, ry: 4.6 * s, fill: 'none', stroke: lip, 'stroke-width': 2 * s });
      } else if (expr === 'confused') {          // 微歪的小弧
        drawMouth(g, 'M' + (x - 10*s) + ' ' + (y + mouthY) + ' Q ' + (x + 2*s) + ' ' + (y + mouthY - 3*s) + ' ' + (x + 11*s) + ' ' + (y + mouthY + 1.5*s), lip, 2 * s);
      } else if (expr === 'eerieSmile') {        // 又宽又薄的长笑，随 q 加宽
        var hw = (13 + 9 * q) * s, cv = (2 + 4 * q) * s;
        drawMouth(g, 'M' + (x - hw) + ' ' + (y + mouthY - 1*s) + ' Q ' + (x + 2*q*s) + ' ' + (y + mouthY + cv) + ' ' + (x + hw + 2*q*s) + ' ' + (y + mouthY - 2*s), lip, 1.8 * s);
      } else if (expr === 'sharpGlare') {
        drawMouth(g, 'M' + (x - 12*s) + ' ' + (y + mouthY) + ' L ' + (x + 12*s) + ' ' + (y + mouthY + 1*s), lip, 2.2 * s);
      } else if (expr === 'tornMouth') {         // 轻微裂口嘴：嘴角下拉+细小裂痕，随 q
        drawMouth(g, 'M' + (x - 13*s) + ' ' + (y + mouthY - 1*s) + ' Q ' + (x + 3*s) + ' ' + (y + mouthY + (3 + 3*q)*s) + ' ' + (x + 15*s) + ' ' + (y + mouthY - (1 + 2*q)*s), lip, 2 * s);
        el(g, 'path', { d: 'M' + (x + 15*s) + ' ' + (y + mouthY - (1 + 2*q)*s) + ' L ' + (x + (15 + 5*q)*s) + ' ' + (y + mouthY - (3 + 3*q)*s),
                        stroke: lip, 'stroke-width': 1.4 * s, fill: 'none' });
      }

      // 头顶小装饰发型（不遮眉眼）
      if (style === 'tuft') {
        el(g, 'path', { d: 'M' + (x - 12*s) + ' ' + (y - ryF + 4*s) + ' Q ' + (x - 8*s) + ' ' + (y - ryF - 8*s) + ' ' + (x - 2*s) + ' ' + (y - ryF + 2*s), stroke: hair, 'stroke-width': 3, fill: 'none' });
        el(g, 'path', { d: 'M' + (x + 2*s) + ' ' + (y - ryF + 2*s) + ' Q ' + (x + 8*s) + ' ' + (y - ryF - 10*s) + ' ' + (x + 13*s) + ' ' + (y - ryF + 3*s), stroke: hair, 'stroke-width': 3, fill: 'none' });
      } else if (style === 'bun') {
        el(g, 'circle', { cx: x, cy: y - ryF - 4 * s, r: 8 * s, fill: hair });
      }

      // 鬼脸颜色必须均匀：不加任何专属暗影/污渍（此前"高难度暗影"反而成了鬼的标记）。
      // 遮挡机制人鬼共享：少量遮挡（只遮一个角落，遮挡面积严格 < 1/2）
      if (Math.random() < 0.35) {
        var occ = pick(['sideShadow', 'hairStrand', 'branch']);
        var corner = pick([-1, 1]);   // 左/右
        if (occ === 'sideShadow') {   // 侧向暗影：盖住一侧约 1/3
          el(g, 'ellipse', { cx: x + corner * rxF * 0.72, cy: y, rx: rxF * 0.42, ry: ryF * 0.92, fill: '#14110e', opacity: 0.75 });
        } else if (occ === 'hairStrand') {  // 额角发绺：盖住上角约 1/4
          el(g, 'path', { d: 'M' + (x + corner * rxF * 0.95) + ' ' + (y - ryF * 0.95) +
            ' Q ' + (x + corner * rxF * 0.4) + ' ' + (y - ryF * 1.02) + ' ' + (x + corner * rxF * 0.18) + ' ' + (y - ryF * 0.45) +
            ' L ' + (x + corner * rxF * 0.55) + ' ' + (y - ryF * 0.30) +
            ' Q ' + (x + corner * rxF * 0.85) + ' ' + (y - ryF * 0.45) + ' ' + (x + corner * rxF * 0.95) + ' ' + (y - ryF * 0.95) + ' Z',
            fill: hair, opacity: 0.95 });
        } else {                    // 枯枝：从额角探入，遮挡极小
          var bx = x + corner * rxF * 0.9, byy = y - ryF * 0.8;
          el(g, 'path', { d: 'M' + bx + ' ' + byy + ' Q ' + (bx + corner * 14*s) + ' ' + (byy + 8*s) + ' ' + (bx + corner * 22*s) + ' ' + (byy + 20*s), stroke: '#241f19', 'stroke-width': 2.5 * s, fill: 'none' });
          el(g, 'ellipse', { cx: bx + corner * 12 * s, cy: byy + 10 * s, rx: 4.5 * s, ry: 2.2 * s, fill: '#241f19', transform: 'rotate(' + (corner * 30) + ' ' + (bx + corner * 12 * s) + ' ' + (byy + 10 * s) + ')' });
        }
      }

      // 全部脸静止：不眨眼、不闪动（此前"闪一下消失又出现"是眨眼把整脸 opacity 归零所致）
      return { g: g };
    }

    /* 布局：2~4 张脸。槽位网格（间距 ≥114px）+ 小幅抖动 + 椭圆间隔验证（系数 1.22），
     * 验证不过就逐级收缩抖动（1 → 0.5 → 0）退回槽位中心——
     * 槽位中心距 ≥114px 恒大于两脸半宽和上限（≈108px），数学上保证任何两张脸零重叠。
     * （此前"随机尝试 80 次 + 失败落兜底槽位"的兜底不做冲突检测，是残余重叠的来源。）
     * 行交错（y=104/141）让 4 张脸错落有致；槽位顺序每局洗牌，构图不重复。 */
    var nFace = 2 + Math.floor(Math.random() * 3);
    var ghostIdx = hasSignal ? Math.floor(Math.random() * nFace) : -1;
    var SLOTS = [
      [[145, 122], [315, 122]],                                        // 2 张
      [[110, 104], [230, 140], [350, 104]],                            // 3 张（中间低、两侧高）
      [[58, 104], [172, 141], [286, 104], [400, 141]]                  // 4 张（两排交错）
    ][nFace - 2];
    var order = shuffle([0, 1, 2, 3].slice(0, nFace));
    var placed = [];
    var faces = [];
    for (var fi = 0; fi < nFace; fi++) {
      var slot = SLOTS[order[fi]];
      var s = rand(0.62, 0.85);
      var x = slot[0], y = slot[1], ok = false;
      for (var tryk = 0; tryk < 3 && !ok; tryk++) {
        var mul = [1, 0.5, 0][tryk];
        x = slot[0] + rand(-8, 8) * mul;
        y = slot[1] + rand(-8, 8) * mul;
        ok = true;
        for (var pi = 0; pi < placed.length; pi++) {
          var p = placed[pi];
          var dx = (x - p.x) / ((52 * s + 52 * p.s) * 1.22);
          var dy = (y - p.y) / ((70 * s + 70 * p.s) * 1.22);
          if (dx * dx + dy * dy < 1) { ok = false; break; }
        }
      }
      placed.push({ x: x, y: y, s: s });
      if (fi === ghostIdx) {
        // 鬼脸线索类型池（每局随机抽一种，防背脸）：
        //  expr  表情阴翳（鬼表情 + 常人肤色 + 常人五官）
        //  skin  仅肤色微弱差异（神情表情与常人无异——最难）
        //  tilt  五官倾斜（肤色表情都正常，整脸偏转 + 双眼一高一低）
        //  combo 表情 + 肤色双通道（经典）
        var pattern = pick(['expr', 'skin', 'tilt', 'combo', 'combo']);
        var gExpr = pick(GHOST_EXPRS);
        var hExpr = pick(HUMAN_EXPRS);
        var go = { q: 0.25 + 0.75 * k, ghost: true };
        if (pattern === 'expr') {
          go.expr = gExpr; go.exprGhost = true; go.skinGhost = false;
        } else if (pattern === 'skin') {
          go.expr = hExpr; go.exprGhost = false; go.skinGhost = true; go.skinFaint = true;
        } else if (pattern === 'tilt') {
          go.expr = hExpr; go.exprGhost = false; go.skinGhost = false; go.tiltGhost = true;
        } else {
          go.expr = gExpr; go.exprGhost = true; go.skinGhost = true;
        }
        faces.push(makeFace(x, y, s, go));
      } else {
        faces.push(makeFace(x, y, s, { q: Math.random() * 0.12, expr: pick(HUMAN_EXPRS), ghost: false, skinGhost: false, exprGhost: false }));
      }
    }

    // 脸部完全静止：无眨眼、无闪动、无逐帧重绘（也不再启动动画循环）
  }

  /* ================= 结果计算与展示 ================= */
  function showResults() {
    stopAnim();
    var c = state.counts, N = state.nTrials;
    // 对数线性校正，避免 0 或 1 的比例导致 z 分数发散
    var pH = (c.H + 0.5) / (c.H + c.M + 1);
    var pFA = (c.FA + 0.5) / (c.FA + c.CR + 1);
    var dprime = zInv(pH) - zInv(pFA);
    var crit = -(zInv(pH) + zInv(pFA)) / 2;
    var acc = (c.H + c.CR) / N;

    var R = ROLES[state.role];
    $('result-subtitle').textContent = R.title + ' · ' + N + ' 次判断 · 设定难度 d\'≈' + state.dSet.toFixed(1);

    $('cm-h').textContent = '击中 H = ' + c.H;
    $('cm-m').textContent = '漏报 M = ' + c.M;
    $('cm-fa').textContent = '误报 FA = ' + c.FA;
    $('cm-cr').textContent = '正确拒斥 CR = ' + c.CR;

    $('m-ph').textContent = pH.toFixed(2);
    $('m-pfa').textContent = pFA.toFixed(2);
    $('m-d').textContent = dprime.toFixed(2);
    $('m-c').textContent = (crit >= 0 ? '+' : '') + crit.toFixed(2);
    $('m-acc').textContent = Math.round(acc * 100) + '%';

    // 思考区：把"你"的一行填上
    $('think-lead').textContent = '假设你的准确率是 ' + Math.round(acc * 100) +
      '%。现在看看另外两位同学——他们准确率都是 75%，但策略完全不同：';
    var cells = $('think-you').getElementsByTagName('td');
    cells[1].textContent = pH.toFixed(2);
    cells[2].textContent = pFA.toFixed(2);
    cells[3].textContent = dprime.toFixed(2);
    cells[4].textContent = (crit >= 0 ? '+' : '') + crit.toFixed(2);
    cells[5].textContent = Math.round(acc * 100) + '%';

    // 第三阶段：本局数据写入本机存储（数据查看页的排行与可视化使用）
    if (window.SDTStore) {
      window.SDTStore.save({
        name: state.user.name, role: state.role, n: N,
        H: c.H, M: c.M, FA: c.FA, CR: c.CR,
        pH: pH, pFA: pFA, d: dprime, cc: crit, acc: acc,
        ap: (pH >= pFA) ? 0.5 + (pH - pFA) * (1 + pH - pFA) / (4 * pH * (1 - pFA))
                        : 0.5 - (pFA - pH) * (1 + pFA - pH) / (4 * pFA * (1 - pH)),
        ts: Date.now()
      });
    }

    // 结果页背景：延续本局场景的淡化模糊图（恐怖主题数据面板）
    $('result-bg').style.backgroundImage = "url('assets/" + (state.role === 'A' ? 'game1' : 'game2') + ".jpg')";

    show('screen-result');
  }

  $('btn-change-role').addEventListener('click', function () { show('screen-home'); });
  $('btn-replay').addEventListener('click', function () { startGame(state.role); });

  // 概念实验室为第二阶段内容：此处仅占位，保持按钮禁用
})();
