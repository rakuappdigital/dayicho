(function () {
  'use strict';

  var canvas = document.getElementById('game');
  var ctx = canvas.getContext('2d');
  var W = canvas.width;
  var H = canvas.height;

  var HORIZON_Y = H * 0.5;
  var DASH_TOP_Y = H * 0.82;
  var CAM_DEPTH = 0.86; // ~100° görüş açısı
  var CAM_HEIGHT = 0.45;
  var ROAD_EDGE = 1.35;
  var LANE_POS = [-0.55, 0, 0.55];
  var Z_FAR = 22;
  var Z_NEAR = 0.6;
  var Z_HIT = 0.75;
  var Z_REMOVE = 0.15;
  var HIT_RADIUS = 0.26;

  var startScreen = document.getElementById('startScreen');
  var gameOverScreen = document.getElementById('gameOverScreen');
  var scoreEl = document.getElementById('score');
  var bestEl = document.getElementById('best');
  var finalScoreEl = document.getElementById('finalScore');
  var newBestEl = document.getElementById('newBest');
  var startBtn = document.getElementById('startBtn');
  var retryBtn = document.getElementById('retryBtn');

  var faceImg = new Image();
  faceImg.src = 'assets/dayico_face.png';

  var theme = new Audio('assets/dayico_theme.mp3');
  theme.loop = true;
  theme.volume = 0.6;
  function playTheme() {
    theme.currentTime = 0;
    theme.play().catch(function () { /* kullanıcı etkileşimi beklenebilir */ });
  }
  function stopTheme() {
    theme.pause();
  }

  var BEST_KEY = 'dayico_runner_best';
  var best = parseInt(localStorage.getItem(BEST_KEY) || '0', 10) || 0;
  bestEl.textContent = 'EN İYİ: ' + best;

  // ---- Ses (sentez, yerleşik düdük/çarpma efektleri) ----
  var audioCtx = null;
  function getAudioCtx() {
    if (!audioCtx) {
      var AC = window.AudioContext || window.webkitAudioContext;
      audioCtx = new AC();
    }
    return audioCtx;
  }

  function beep(freq, startDelay, duration, type, vol) {
    try {
      var ac = getAudioCtx();
      var osc = ac.createOscillator();
      var gain = ac.createGain();
      osc.type = type || 'square';
      osc.frequency.value = freq;
      var t0 = ac.currentTime + startDelay;
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.exponentialRampToValueAtTime(vol || 0.15, t0 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
      osc.connect(gain);
      gain.connect(ac.destination);
      osc.start(t0);
      osc.stop(t0 + duration + 0.02);
    } catch (e) { /* ses yoksa oyun devam etsin */ }
  }

  function playPowerupJingle() {
    beep(660, 0, 0.1, 'square');
    beep(880, 0.08, 0.1, 'square');
    beep(1320, 0.16, 0.18, 'square');
  }

  function playCrashSound() {
    beep(180, 0, 0.25, 'sawtooth', 0.2);
    beep(90, 0.05, 0.35, 'sawtooth', 0.2);
  }

  // ---- Perspektif yardımcıları (gerçek kamera projeksiyonu: sabit kamera
  // yüksekliği + görüş derinliği, ufuk ekranın tam ortasında - Outrun/Traffic
  // Rider tarzı pseudo-3D yol motorlarındaki standart yöntem) ----
  function scaleAtZ(z) {
    return CAM_DEPTH / z;
  }

  function screenYAtZ(z) {
    return HORIZON_Y + scaleAtZ(z) * CAM_HEIGHT * HORIZON_Y;
  }

  function screenXAtZ(worldX, z) {
    return W / 2 + scaleAtZ(z) * (worldX - playerPos) * (W / 2);
  }

  // ---- Oyun durumu ----
  var state = 'idle'; // idle | playing | gameover
  var playerPos = 0; // -1..1, yoldaki yatay konum
  var playerVel = 0;
  var steerInput = 0; // -1, 0, 1
  var wheelAngle = 0;

  var speed = 0.095;
  var maxSpeed = 0.22;
  var score = 0;
  var invincibleUntil = 0;
  var flashUntil = 0;

  var obstacles = [];
  var powerups = [];
  var poles = [];
  var spawnTimer = 0;
  var powerupTimer = 0;
  var poleTimer = 0;
  var dashOffset = 0;

  function resetGame() {
    playerPos = 0;
    playerVel = 0;
    wheelAngle = 0;
    speed = 0.095;
    score = 0;
    invincibleUntil = 0;
    flashUntil = 0;
    obstacles = [];
    powerups = [];
    poles = [];
    spawnTimer = 0;
    powerupTimer = 150;
    poleTimer = 0;
    dashOffset = 0;
  }

  var OBSTACLE_KINDS = ['car_blue', 'car_green', 'police', 'phone'];

  function spawnObstacle() {
    var lane = LANE_POS[Math.floor(Math.random() * LANE_POS.length)];
    var kind = OBSTACLE_KINDS[Math.floor(Math.random() * OBSTACLE_KINDS.length)];
    obstacles.push({ worldX: lane, z: Z_FAR, kind: kind, hit: false });
  }

  function spawnPowerup() {
    var freeLanes = LANE_POS.filter(function (lx) {
      return !obstacles.some(function (o) { return o.worldX === lx && o.z > Z_FAR * 0.7; });
    });
    var pool = freeLanes.length > 0 ? freeLanes : LANE_POS;
    var lane = pool[Math.floor(Math.random() * pool.length)];
    powerups.push({ worldX: lane, z: Z_FAR, taken: false });
  }

  function spawnPole(side) {
    poles.push({ worldX: side, z: Z_FAR });
  }

  // ---- Girdi ----
  window.addEventListener('keydown', function (e) {
    if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') steerInput = -1;
    if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') steerInput = 1;
    if (e.key === ' ' || e.key === 'Enter') {
      if (state === 'idle') startGame();
      else if (state === 'gameover') startGame();
    }
  });
  window.addEventListener('keyup', function (e) {
    if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') { if (steerInput < 0) steerInput = 0; }
    if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') { if (steerInput > 0) steerInput = 0; }
  });

  function setTouchSteer(clientX, rect) {
    var relX = (clientX - rect.left) / rect.width;
    steerInput = relX < 0.5 ? -1 : 1;
  }

  canvas.addEventListener('touchstart', function (e) {
    setTouchSteer(e.touches[0].clientX, canvas.getBoundingClientRect());
  }, { passive: true });
  canvas.addEventListener('touchmove', function (e) {
    setTouchSteer(e.touches[0].clientX, canvas.getBoundingClientRect());
  }, { passive: true });
  canvas.addEventListener('touchend', function () {
    steerInput = 0;
  }, { passive: true });

  startBtn.addEventListener('click', startGame);
  retryBtn.addEventListener('click', startGame);

  function startGame() {
    resetGame();
    state = 'playing';
    startScreen.classList.add('hidden');
    gameOverScreen.classList.add('hidden');
    playTheme();
  }

  function endGame() {
    state = 'gameover';
    stopTheme();
    playCrashSound();
    var roundedScore = Math.floor(score);
    finalScoreEl.textContent = 'PUAN: ' + roundedScore;
    if (roundedScore > best) {
      best = roundedScore;
      localStorage.setItem(BEST_KEY, String(best));
      bestEl.textContent = 'EN İYİ: ' + best;
      newBestEl.classList.remove('hidden');
    } else {
      newBestEl.classList.add('hidden');
    }
    gameOverScreen.classList.remove('hidden');
  }

  // ---- Çizim yardımcıları ----
  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function drawSky() {
    var grad = ctx.createLinearGradient(0, 0, 0, HORIZON_Y);
    grad.addColorStop(0, '#2a3a63');
    grad.addColorStop(1, '#8fa7c9');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, HORIZON_Y);

    // güneş
    ctx.fillStyle = 'rgba(246, 194, 26, 0.85)';
    ctx.beginPath();
    ctx.arc(W / 2 - playerPos * 40, HORIZON_Y - 46, 30, 0, Math.PI * 2);
    ctx.fill();

    // İstanbul silueti (paralaks)
    ctx.fillStyle = '#1d2740';
    var shift = -playerPos * 24;
    var baseY = HORIZON_Y;

    for (var i = -1; i <= 7; i++) {
      var bx = i * 62 + shift * 1.5;
      var bh = 20 + ((i * 37) % 36);
      ctx.fillRect(bx, baseY - bh, 30, bh);
    }

    drawMosque(W * 0.28 + shift * 1.1, baseY);
    drawBridge(W * 0.78 + shift * 1.3, baseY, 0.85);
  }

  function drawMinaret(x, baseY, h) {
    ctx.fillRect(x - 2.5, baseY - h, 5, h);
    ctx.beginPath();
    ctx.moveTo(x - 4, baseY - h);
    ctx.lineTo(x, baseY - h - 11);
    ctx.lineTo(x + 4, baseY - h);
    ctx.closePath();
    ctx.fill();
  }

  function drawMosque(cx, baseY) {
    ctx.beginPath();
    ctx.arc(cx, baseY - 16, 15, Math.PI, 0);
    ctx.fill();
    ctx.fillRect(cx - 20, baseY - 16, 40, 16);
    ctx.fillRect(cx - 1, baseY - 32, 2, 7);
    drawMinaret(cx - 32, baseY, 46);
    drawMinaret(cx + 32, baseY, 46);
  }

  function drawBridge(cx, baseY, scale) {
    var towerH = 70 * scale;
    var gap = 100 * scale;
    ctx.save();
    ctx.translate(cx, baseY);
    ctx.fillRect(-gap / 2 - 4 * scale, -towerH, 8 * scale, towerH);
    ctx.fillRect(gap / 2 - 4 * scale, -towerH, 8 * scale, towerH);
    ctx.fillRect(-gap / 2 - 40 * scale, -10 * scale, gap + 80 * scale, 5 * scale);
    ctx.strokeStyle = ctx.fillStyle;
    ctx.lineWidth = 1.2 * scale;
    for (var k = 0; k <= 4; k++) {
      var dx = (-gap / 2 - 40 * scale) + (k / 4) * (gap + 80 * scale);
      ctx.beginPath();
      ctx.moveTo(-gap / 2, -towerH + 8 * scale);
      ctx.lineTo(dx, -8 * scale);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(gap / 2, -towerH + 8 * scale);
      ctx.lineTo(dx, -8 * scale);
      ctx.stroke();
    }
    ctx.restore();
  }

  function zAtStep(i, steps) {
    var t = i / steps;
    return Z_FAR * Math.pow(Z_NEAR / Z_FAR, t);
  }

  function drawRoad() {
    var steps = 32;
    var left = [];
    var right = [];
    var i, z, y, x0, x1;
    for (i = 0; i <= steps; i++) {
      z = zAtStep(i, steps);
      y = screenYAtZ(z);
      x0 = screenXAtZ(-ROAD_EDGE, z);
      x1 = screenXAtZ(ROAD_EDGE, z);
      left.push([x0, y]);
      right.push([x1, y]);
    }

    // kenar banketleri (yeşil/toprak)
    ctx.fillStyle = '#3f6b3f';
    ctx.fillRect(0, HORIZON_Y, W, DASH_TOP_Y - HORIZON_Y);

    // yol zemini (ufuktan sonuna kadar tek düz asfalt, aşırı perspektif yok)
    ctx.fillStyle = '#3a3d46';
    ctx.beginPath();
    ctx.moveTo(left[0][0], left[0][1]);
    for (i = 1; i <= steps; i++) ctx.lineTo(left[i][0], left[i][1]);
    for (i = steps; i >= 0; i--) ctx.lineTo(right[i][0], right[i][1]);
    ctx.closePath();
    ctx.fill();

    // şerit çizgileri (noktalı, kayan)
    ctx.strokeStyle = 'rgba(255,255,255,0.75)';
    ctx.lineWidth = 2;
    [-0.33, 0.33].forEach(function (laneLine) {
      ctx.setLineDash([10, 14]);
      ctx.lineDashOffset = -dashOffset;
      ctx.beginPath();
      for (i = 0; i <= steps; i++) {
        z = zAtStep(i, steps);
        var x = screenXAtZ(laneLine, z);
        var yy = screenYAtZ(z);
        if (i === 0) ctx.moveTo(x, yy);
        else ctx.lineTo(x, yy);
      }
      ctx.stroke();
    });
    ctx.setLineDash([]);
  }

  function drawPole(p) {
    var y = screenYAtZ(p.z);
    var s = scaleAtZ(p.z);
    var x = screenXAtZ(p.worldX, p.z);
    ctx.fillStyle = '#c94b3f';
    ctx.fillRect(x - 3 * s, y - 40 * s, 6 * s, 40 * s);
    ctx.fillStyle = '#f6c21a';
    ctx.fillRect(x - 3 * s, y - 40 * s, 6 * s, 8 * s);
  }

  function drawCarSprite(x, y, s, bodyColor, flasher) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(s, s);
    roundRect(-24, -40, 48, 80, 12);
    ctx.fillStyle = bodyColor;
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.3)';
    roundRect(-18, -34, 36, 26, 6);
    ctx.fill();
    if (flasher) {
      var on = Math.floor(Date.now() / 150) % 2 === 0;
      ctx.fillStyle = on ? '#ff2b2b' : '#2b6bff';
      ctx.fillRect(-9, -46, 18, 7);
    }
    ctx.restore();
  }

  function drawPhoneSprite(x, y, s) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(s, s);
    ctx.fillStyle = '#ffffff';
    roundRect(-18, -24, 36, 48, 8);
    ctx.fill();
    ctx.fillStyle = '#25d366';
    ctx.beginPath();
    ctx.arc(0, -4, 10, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#333';
    ctx.font = 'bold 10px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('EŞİN', 0, 16);
    ctx.restore();
  }

  function drawObstacle(o) {
    var y = screenYAtZ(o.z);
    var s = scaleAtZ(o.z);
    var x = screenXAtZ(o.worldX, o.z);
    if (o.kind === 'phone') {
      drawPhoneSprite(x, y, s);
    } else {
      var color = o.kind === 'police' ? '#1c2a4a' : (o.kind === 'car_green' ? '#2e6b3a' : '#2f5f9e');
      drawCarSprite(x, y, s, color, o.kind === 'police');
    }
  }

  function drawPowerup(p) {
    var y = screenYAtZ(p.z);
    var s = scaleAtZ(p.z);
    var x = screenXAtZ(p.worldX, p.z);
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(s, s);
    var bob = Math.sin(Date.now() / 150 + p.worldX * 10) * 2;
    ctx.translate(0, bob);
    ctx.rotate(Math.sin(Date.now() / 300) * 0.12);
    ctx.fillStyle = '#f6c21a';
    ctx.fillRect(-18, -8, 36, 16);
    ctx.fillStyle = '#b4122a';
    ctx.fillRect(-18, -8, 12, 16);
    ctx.fillRect(6, -8, 12, 16);
    ctx.restore();
  }

  function drawCockpit() {
    // kaporta kenarları (A sütunları) - vinyet
    var grad = ctx.createLinearGradient(0, 0, W, 0);
    grad.addColorStop(0, 'rgba(10,10,12,0.9)');
    grad.addColorStop(0.12, 'rgba(10,10,12,0)');
    grad.addColorStop(0.88, 'rgba(10,10,12,0)');
    grad.addColorStop(1, 'rgba(10,10,12,0.9)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, DASH_TOP_Y);

    // dikiz aynası
    var mirrorW = 96;
    var mirrorH = 34;
    var mx = W / 2 - mirrorW / 2;
    var my = 14;
    ctx.fillStyle = '#15151a';
    roundRect(mx - 6, my - 6, mirrorW + 12, mirrorH + 16, 10);
    ctx.fill();
    ctx.fillStyle = '#5b6b86';
    roundRect(mx, my, mirrorW, mirrorH, 6);
    ctx.fill();

    ctx.save();
    ctx.beginPath();
    roundRect(mx, my, mirrorW, mirrorH, 6);
    ctx.clip();
    // ayna içinde arkadaki yol/trafik hissi (basit gri degrade)
    ctx.fillStyle = '#434a55';
    ctx.fillRect(mx, my, mirrorW, mirrorH);

    var faceR = 14;
    var fcx = mx + mirrorW / 2;
    var fcy = my + mirrorH / 2 + 4;
    if (faceImg.complete && faceImg.naturalWidth > 0) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(fcx, fcy, faceR, 0, Math.PI * 2);
      ctx.closePath();
      ctx.clip();
      ctx.drawImage(faceImg, fcx - faceR, fcy - faceR, faceR * 2, faceR * 2);
      ctx.restore();
    }
    var dreadColors = ['#f6c21a', '#b4122a', '#2e8b3a', '#1a1a1a'];
    for (var i = 0; i < 6; i++) {
      var ang = (Math.PI / 6) * i - Math.PI * 0.15;
      var dx = Math.cos(ang - Math.PI / 2) * faceR;
      var dy = Math.sin(ang - Math.PI / 2) * faceR;
      ctx.strokeStyle = dreadColors[i % dreadColors.length];
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.moveTo(fcx + dx * 0.7, fcy + dy * 0.7);
      ctx.lineTo(fcx + dx * 1.5, fcy + dy * 1.5 - 3);
      ctx.stroke();
    }
    ctx.restore();

    // aynadan sallanan GS atkısı
    var swing = Math.sin(Date.now() / 500) * 0.3 + wheelAngle * 0.4;
    ctx.save();
    ctx.translate(W / 2, my + mirrorH + 6);
    ctx.rotate(swing);
    ctx.strokeStyle = '#999';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(0, 22);
    ctx.stroke();
    ctx.fillStyle = '#f6c21a';
    ctx.fillRect(-9, 22, 18, 20);
    ctx.fillStyle = '#b4122a';
    ctx.fillRect(-9, 22, 6, 20);
    ctx.fillRect(3, 22, 6, 20);
    ctx.restore();

    // gösterge paneli / kaporta (Fluence tarzı gri-siyah plastik)
    var dashGrad = ctx.createLinearGradient(0, DASH_TOP_Y, 0, H);
    dashGrad.addColorStop(0, '#2b2e35');
    dashGrad.addColorStop(1, '#0c0d10');
    ctx.fillStyle = dashGrad;
    roundRect(-4, DASH_TOP_Y, W + 8, H - DASH_TOP_Y + 20, 18);
    ctx.fill();

    // gümüş krom şerit (Fluence iç dekor çizgisi)
    ctx.fillStyle = 'rgba(200,205,215,0.55)';
    ctx.fillRect(0, DASH_TOP_Y + 4, W, 4);

    var wheelCx = W * 0.32;
    var wheelCy = H + 2;
    var wheelR = 50;

    // gösterge küpesi (direksiyonun arkasında, hız ibresi)
    var gaugeCx = wheelCx;
    var gaugeCy = wheelCy - wheelR * 0.98;
    var gaugeR = 32;
    ctx.save();
    ctx.fillStyle = '#0a0b0d';
    ctx.beginPath();
    ctx.arc(gaugeCx, gaugeCy, gaugeR, Math.PI, Math.PI * 2);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(200,205,215,0.5)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(gaugeCx, gaugeCy, gaugeR, Math.PI, Math.PI * 2);
    ctx.stroke();
    var kmh = Math.floor((speed / maxSpeed) * 140);
    for (var tickI = 0; tickI <= 8; tickI++) {
      var tickAng = Math.PI + (Math.PI / 8) * tickI;
      ctx.strokeStyle = tickI % 2 === 0 ? '#f6c21a' : 'rgba(255,255,255,0.5)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(gaugeCx + Math.cos(tickAng) * (gaugeR - 7), gaugeCy + Math.sin(tickAng) * (gaugeR - 7));
      ctx.lineTo(gaugeCx + Math.cos(tickAng) * (gaugeR - 2), gaugeCy + Math.sin(tickAng) * (gaugeR - 2));
      ctx.stroke();
    }
    var needleAng = Math.PI + Math.min(1, kmh / 140) * Math.PI;
    ctx.strokeStyle = '#e8432f';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(gaugeCx, gaugeCy);
    ctx.lineTo(gaugeCx + Math.cos(needleAng) * (gaugeR - 9), gaugeCy + Math.sin(needleAng) * (gaugeR - 9));
    ctx.stroke();
    ctx.fillStyle = '#f6c21a';
    ctx.font = 'bold 10px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(kmh, gaugeCx, gaugeCy - 10);
    ctx.restore();

    // havalandırma kanalları (sol sütun + sağ üst)
    function drawVent(vx, vy, vr) {
      ctx.save();
      ctx.fillStyle = '#1a1b1f';
      ctx.beginPath();
      ctx.ellipse(vx, vy, vr, vr * 0.7, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(200,205,215,0.6)';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.strokeStyle = '#444';
      ctx.lineWidth = 1.5;
      for (var vi = -2; vi <= 2; vi++) {
        ctx.beginPath();
        ctx.moveTo(vx - vr * 0.8, vy + vi * vr * 0.22);
        ctx.lineTo(vx + vr * 0.8, vy + vi * vr * 0.22);
        ctx.stroke();
      }
      ctx.restore();
    }
    drawVent(W * 0.86, DASH_TOP_Y + 16, 16);
    drawVent(W * 0.08, DASH_TOP_Y + 20, 12);

    // direksiyon (3 kollu, soldaki sürücü pozisyonu)
    ctx.save();
    ctx.translate(wheelCx, wheelCy);
    ctx.rotate(wheelAngle);
    ctx.strokeStyle = '#1c1d20';
    ctx.lineWidth = 13;
    ctx.beginPath();
    ctx.arc(0, 0, wheelR, Math.PI, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(210,214,222,0.4)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, 0, wheelR + 6, Math.PI, Math.PI * 2);
    ctx.stroke();
    // üç kol
    ctx.strokeStyle = '#1c1d20';
    ctx.lineWidth = 8;
    [Math.PI * 1.15, Math.PI * 1.5, Math.PI * 1.85].forEach(function (a) {
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(Math.cos(a) * wheelR, Math.sin(a) * wheelR);
      ctx.stroke();
    });
    // orta göbek + logo
    ctx.fillStyle = '#15161a';
    ctx.beginPath();
    ctx.arc(0, 0, 16, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(210,214,222,0.8)';
    ctx.lineWidth = 1.5;
    ctx.save();
    ctx.rotate(Math.PI / 4);
    ctx.strokeRect(-6, -6, 12, 12);
    ctx.restore();
    ctx.restore();

    // direksiyonu tutan el + kol (GS forma kolu)
    var handAngleBase = Math.PI * 1.22;
    var hlx = Math.cos(handAngleBase) * wheelR * 0.92;
    var hly = Math.sin(handAngleBase) * wheelR * 0.92;
    var handX = wheelCx + (hlx * Math.cos(wheelAngle) - hly * Math.sin(wheelAngle));
    var handY = wheelCy + (hlx * Math.sin(wheelAngle) + hly * Math.cos(wheelAngle));

    ctx.save();
    ctx.strokeStyle = '#e9ecef';
    ctx.lineWidth = 22;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(W * 0.05, H + 30);
    ctx.quadraticCurveTo(W * 0.1, DASH_TOP_Y + 40, handX, handY);
    ctx.stroke();
    ctx.strokeStyle = '#b4122a';
    ctx.lineWidth = 8;
    ctx.beginPath();
    ctx.moveTo(W * 0.05, H + 30);
    ctx.quadraticCurveTo(W * 0.1, DASH_TOP_Y + 55, handX - 2, handY + 6);
    ctx.stroke();
    ctx.lineCap = 'butt';

    ctx.fillStyle = '#d99a6c';
    ctx.beginPath();
    ctx.ellipse(handX, handY, 13, 10, wheelAngle + handAngleBase - Math.PI / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#b97b4e';
    ctx.lineWidth = 1.5;
    for (var fi = -1; fi <= 1; fi++) {
      ctx.beginPath();
      ctx.moveTo(handX + fi * 4, handY - 6);
      ctx.lineTo(handX + fi * 4, handY - 11);
      ctx.stroke();
    }
    ctx.restore();
  }

  function rectHit(o) {
    return Math.abs(o.worldX - playerPos) < HIT_RADIUS;
  }

  // ---- Güncelleme ----
  function update(dt) {
    if (state !== 'playing') return;

    speed = Math.min(maxSpeed, speed + dt * 0.0010);
    score += speed * 6;
    dashOffset += speed * 4;

    playerVel += steerInput * dt * 0.09;
    playerVel *= 0.9;
    playerVel = Math.max(-0.045, Math.min(0.045, playerVel));
    playerPos += playerVel * dt;
    playerPos = Math.max(-0.92, Math.min(0.92, playerPos));
    wheelAngle += ((steerInput * 0.5) - wheelAngle) * Math.min(1, dt * 0.2);

    spawnTimer -= dt;
    if (spawnTimer <= 0) {
      spawnObstacle();
      spawnTimer = Math.max(26, 60 - speed * 140);
    }

    powerupTimer -= dt;
    if (powerupTimer <= 0) {
      spawnPowerup();
      powerupTimer = 160 + Math.random() * 110;
    }

    poleTimer -= dt;
    if (poleTimer <= 0) {
      spawnPole(-1.5);
      spawnPole(1.5);
      poleTimer = 22;
    }

    var i, o, p;
    for (i = obstacles.length - 1; i >= 0; i--) {
      o = obstacles[i];
      o.z -= speed * dt;
      if (o.z < Z_REMOVE) {
        obstacles.splice(i, 1);
        continue;
      }
      if (!o.hit && o.z <= Z_HIT && Date.now() >= invincibleUntil && rectHit(o)) {
        endGame();
        return;
      }
    }

    for (i = powerups.length - 1; i >= 0; i--) {
      p = powerups[i];
      p.z -= speed * dt;
      if (p.z < Z_REMOVE) {
        powerups.splice(i, 1);
        continue;
      }
      if (!p.taken && p.z <= Z_HIT + 0.1 && rectHit(p)) {
        p.taken = true;
        powerups.splice(i, 1);
        score += 50;
        invincibleUntil = Date.now() + 1500;
        flashUntil = Date.now() + 350;
        playPowerupJingle();
      }
    }

    for (i = poles.length - 1; i >= 0; i--) {
      poles[i].z -= speed * dt;
      if (poles[i].z < Z_REMOVE) poles.splice(i, 1);
    }
  }

  function byDepthDesc(a, b) { return b.z - a.z; }

  function draw() {
    drawSky();
    drawRoad();

    var scene = [];
    poles.forEach(function (x) { scene.push({ z: x.z, draw: function () { drawPole(x); } }); });
    obstacles.forEach(function (x) { scene.push({ z: x.z, draw: function () { drawObstacle(x); } }); });
    powerups.forEach(function (x) { scene.push({ z: x.z, draw: function () { drawPowerup(x); } }); });
    scene.sort(byDepthDesc);
    scene.forEach(function (it) { it.draw(); });

    drawCockpit();

    if (Date.now() < flashUntil) {
      ctx.fillStyle = 'rgba(246, 194, 26, 0.22)';
      ctx.fillRect(0, 0, W, H);
    }
    if (Date.now() < invincibleUntil && Math.floor(Date.now() / 90) % 2 === 0) {
      ctx.strokeStyle = 'rgba(246, 194, 26, 0.6)';
      ctx.lineWidth = 8;
      ctx.strokeRect(4, 4, W - 8, H - 8);
    }

    scoreEl.textContent = 'PUAN: ' + Math.floor(score);
  }

  var lastTime = null;
  function loop(ts) {
    if (lastTime === null) lastTime = ts;
    var dt = Math.min(2.5, (ts - lastTime) / 16.6667);
    lastTime = ts;
    update(dt);
    draw();
    requestAnimationFrame(loop);
  }

  requestAnimationFrame(loop);
})();
