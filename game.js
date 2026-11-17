(function () {
  'use strict';

  var canvas = document.getElementById('game');
  var ctx = canvas.getContext('2d');
  var W = canvas.width;
  var H = canvas.height;

  var LANES = 3;
  var LANE_W = W / LANES;
  var PLAYER_W = 56;
  var PLAYER_H = 92;

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

  // ---- Audio (synth placeholder, gerçek müzik sonra gelecek) ----
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

  // ---- Oyun durumu ----
  var state = 'idle'; // idle | playing | gameover
  var playerLane = 1;
  var playerX = laneCenter(playerLane);
  var targetX = playerX;
  var playerY = H - PLAYER_H - 24;

  var speed = 4.2;
  var maxSpeed = 11;
  var distance = 0;
  var score = 0;
  var invincibleUntil = 0;
  var flashUntil = 0;

  var obstacles = [];
  var powerups = [];
  var spawnTimer = 0;
  var powerupTimer = 0;
  var roadOffset = 0;

  function laneCenter(lane) {
    return lane * LANE_W + LANE_W / 2;
  }

  function resetGame() {
    playerLane = 1;
    playerX = laneCenter(playerLane);
    targetX = playerX;
    speed = 4.2;
    distance = 0;
    score = 0;
    invincibleUntil = 0;
    flashUntil = 0;
    obstacles = [];
    powerups = [];
    spawnTimer = 0;
    powerupTimer = 60;
    roadOffset = 0;
  }

  var OBSTACLE_KINDS = ['car_blue', 'car_green', 'police', 'phone'];

  function spawnObstacle() {
    var lane = Math.floor(Math.random() * LANES);
    var kind = OBSTACLE_KINDS[Math.floor(Math.random() * OBSTACLE_KINDS.length)];
    obstacles.push({
      lane: lane,
      x: laneCenter(lane),
      y: -120,
      w: kind === 'phone' ? 40 : 56,
      h: kind === 'phone' ? 40 : 92,
      kind: kind
    });
  }

  function spawnPowerup() {
    var freeLanes = [];
    for (var l = 0; l < LANES; l++) {
      var blocked = obstacles.some(function (o) { return o.lane === l && o.y < 60; });
      if (!blocked) freeLanes.push(l);
    }
    var lane = freeLanes.length > 0
      ? freeLanes[Math.floor(Math.random() * freeLanes.length)]
      : Math.floor(Math.random() * LANES);
    powerups.push({
      lane: lane,
      x: laneCenter(lane),
      y: -60,
      r: 20
    });
  }

  // ---- Girdi ----
  var keys = {};
  window.addEventListener('keydown', function (e) {
    if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') moveLane(-1);
    if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') moveLane(1);
    if (e.key === ' ' || e.key === 'Enter') {
      if (state === 'idle') startGame();
      else if (state === 'gameover') startGame();
    }
  });

  function moveLane(dir) {
    if (state !== 'playing') return;
    playerLane = Math.max(0, Math.min(LANES - 1, playerLane + dir));
    targetX = laneCenter(playerLane);
  }

  var touchStartX = null;
  canvas.addEventListener('touchstart', function (e) {
    touchStartX = e.touches[0].clientX;
  }, { passive: true });
  canvas.addEventListener('touchend', function (e) {
    if (touchStartX === null) return;
    var dx = e.changedTouches[0].clientX - touchStartX;
    if (dx > 30) moveLane(1);
    else if (dx < -30) moveLane(-1);
    touchStartX = null;
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
  function drawRoad() {
    ctx.fillStyle = '#2b2b33';
    ctx.fillRect(0, 0, W, H);

    ctx.strokeStyle = 'rgba(255,255,255,0.15)';
    ctx.lineWidth = 2;
    for (var l = 1; l < LANES; l++) {
      var x = l * LANE_W;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, H);
      ctx.stroke();
    }

    ctx.strokeStyle = 'rgba(255,255,255,0.4)';
    ctx.lineWidth = 4;
    ctx.setLineDash([24, 20]);
    ctx.lineDashOffset = -roadOffset;
    for (var ll = 1; ll < LANES; ll++) {
      var xx = ll * LANE_W;
      ctx.beginPath();
      ctx.moveTo(xx, 0);
      ctx.lineTo(xx, H);
      ctx.stroke();
    }
    ctx.setLineDash([]);
  }

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function drawPlayer() {
    var x = playerX;
    var y = playerY;
    var w = PLAYER_W;
    var h = PLAYER_H;
    var blinking = Date.now() < invincibleUntil && Math.floor(Date.now() / 80) % 2 === 0;
    if (blinking) ctx.globalAlpha = 0.4;

    // gövde (Fluence - gri/gümüş sedan)
    ctx.fillStyle = '#d7d9de';
    roundRect(x - w / 2, y - h / 2, w, h, 14);
    ctx.fill();
    ctx.strokeStyle = '#9ba0ab';
    ctx.lineWidth = 2;
    ctx.stroke();

    // cam / ön
    ctx.fillStyle = '#3a4a5c';
    roundRect(x - w / 2 + 6, y - h / 2 + 10, w - 12, h * 0.4, 8);
    ctx.fill();

    // GS atkısı sürücünün boynunda
    ctx.fillStyle = '#f6c21a';
    ctx.fillRect(x - 14, y - h / 2 + 18, 28, 6);
    ctx.fillStyle = '#b4122a';
    ctx.fillRect(x - 14, y - h / 2 + 24, 28, 4);

    // yüz (gerçek foto)
    var faceR = 16;
    if (faceImg.complete && faceImg.naturalWidth > 0) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(x, y - h / 2 + 14, faceR, 0, Math.PI * 2);
      ctx.closePath();
      ctx.clip();
      ctx.drawImage(faceImg, x - faceR, y - h / 2 + 14 - faceR, faceR * 2, faceR * 2);
      ctx.restore();
    }

    // rasta saçları (sarı-kırmızı-yeşil örgüler)
    var dreadColors = ['#f6c21a', '#b4122a', '#2e8b3a', '#1a1a1a'];
    var cx = x;
    var cy = y - h / 2 + 14;
    for (var i = 0; i < 7; i++) {
      var ang = (Math.PI / 7) * i - Math.PI * 0.1;
      var dx = Math.cos(ang - Math.PI / 2) * faceR;
      var dy = Math.sin(ang - Math.PI / 2) * faceR;
      ctx.strokeStyle = dreadColors[i % dreadColors.length];
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(cx + dx * 0.7, cy + dy * 0.7);
      ctx.lineTo(cx + dx * 1.6, cy + dy * 1.6 - 4);
      ctx.stroke();
    }

    // arka tamponlar / tekerlek izleri
    ctx.fillStyle = '#1a1a1a';
    ctx.fillRect(x - w / 2 - 3, y - h / 2 + 10, 5, 18);
    ctx.fillRect(x + w / 2 - 2, y - h / 2 + 10, 5, 18);
    ctx.fillRect(x - w / 2 - 3, y + h / 2 - 28, 5, 18);
    ctx.fillRect(x + w / 2 - 2, y + h / 2 - 28, 5, 18);

    ctx.globalAlpha = 1;
  }

  function drawObstacle(o) {
    ctx.save();
    ctx.translate(o.x, o.y);
    if (o.kind === 'phone') {
      ctx.fillStyle = '#ffffff';
      roundRect(-o.w / 2, -o.h / 2, o.w, o.h, 8);
      ctx.fill();
      ctx.fillStyle = '#25d366';
      ctx.beginPath();
      ctx.arc(0, -4, 10, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#333';
      ctx.font = 'bold 10px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('EŞİN', 0, 16);
    } else {
      var color = o.kind === 'police' ? '#1c2a4a' : (o.kind === 'car_green' ? '#2e6b3a' : '#2f5f9e');
      ctx.fillStyle = color;
      roundRect(-o.w / 2, -o.h / 2, o.w, o.h, 14);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.25)';
      roundRect(-o.w / 2 + 6, -o.h / 2 + 10, o.w - 12, o.h * 0.4, 8);
      ctx.fill();
      if (o.kind === 'police') {
        var flash = Math.floor(Date.now() / 150) % 2 === 0;
        ctx.fillStyle = flash ? '#ff2b2b' : '#2b6bff';
        ctx.fillRect(-10, -o.h / 2 - 6, 20, 8);
      }
    }
    ctx.restore();
  }

  function drawPowerup(p) {
    ctx.save();
    ctx.translate(p.x, p.y);
    var bob = Math.sin(Date.now() / 150 + p.x) * 3;
    ctx.translate(0, bob);
    ctx.rotate(Math.sin(Date.now() / 300) * 0.15);
    ctx.fillStyle = '#f6c21a';
    ctx.fillRect(-18, -8, 36, 16);
    ctx.fillStyle = '#b4122a';
    ctx.fillRect(-18, -8, 12, 16);
    ctx.fillRect(6, -8, 12, 16);
    ctx.restore();
  }

  function rectsOverlap(ax, ay, aw, ah, bx, by, bw, bh) {
    return Math.abs(ax - bx) < (aw + bw) / 2 - 6 &&
           Math.abs(ay - by) < (ah + bh) / 2 - 6;
  }

  // ---- Güncelleme ----
  function update(dt) {
    if (state !== 'playing') return;

    speed = Math.min(maxSpeed, speed + dt * 0.08);
    distance += speed;
    score += speed * 0.05;
    roadOffset += speed;

    playerX += (targetX - playerX) * Math.min(1, dt * 0.02);

    spawnTimer -= dt;
    if (spawnTimer <= 0) {
      spawnObstacle();
      spawnTimer = Math.max(28, 70 - speed * 3);
    }

    powerupTimer -= dt;
    if (powerupTimer <= 0) {
      spawnPowerup();
      powerupTimer = 180 + Math.random() * 120;
    }

    for (var i = obstacles.length - 1; i >= 0; i--) {
      var o = obstacles[i];
      o.y += speed;
      if (o.y > H + 100) {
        obstacles.splice(i, 1);
        continue;
      }
      if (Date.now() >= invincibleUntil &&
          rectsOverlap(playerX, playerY, PLAYER_W, PLAYER_H, o.x, o.y, o.w, o.h)) {
        endGame();
        return;
      }
    }

    for (var j = powerups.length - 1; j >= 0; j--) {
      var p = powerups[j];
      p.y += speed;
      if (p.y > H + 60) {
        powerups.splice(j, 1);
        continue;
      }
      if (rectsOverlap(playerX, playerY, PLAYER_W, PLAYER_H, p.x, p.y, p.r * 2, p.r * 2)) {
        powerups.splice(j, 1);
        score += 50;
        invincibleUntil = Date.now() + 1500;
        flashUntil = Date.now() + 350;
        playPowerupJingle();
      }
    }
  }

  function draw() {
    drawRoad();
    for (var i = 0; i < obstacles.length; i++) drawObstacle(obstacles[i]);
    for (var j = 0; j < powerups.length; j++) drawPowerup(powerups[j]);
    if (state === 'playing' || state === 'gameover') drawPlayer();

    if (Date.now() < flashUntil) {
      ctx.fillStyle = 'rgba(246, 194, 26, 0.25)';
      ctx.fillRect(0, 0, W, H);
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
