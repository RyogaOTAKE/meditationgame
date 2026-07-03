/* 無心 - Mushin: 瞑想のためのちいさなゲーム */
(() => {
  'use strict';

  const canvas = document.getElementById('c');
  const ctx = canvas.getContext('2d');
  let W = 0, H = 0, DPR = 1;

  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth;
    H = window.innerHeight;
    canvas.width = Math.round(W * DPR);
    canvas.height = Math.round(H * DPR);
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    if (modes.sand) modes.sand.onResize();
  }

  const rand = (a, b) => a + Math.random() * (b - a);
  const pick = (arr) => arr[(Math.random() * arr.length) | 0];

  /* ---------------- Audio ---------------- */
  const Audio = {
    ctx: null,
    master: null,
    wet: null,
    noiseGain: null,
    muted: localStorage.getItem('mushin-muted') === '1',

    init() {
      if (this.ctx) return;
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.55;
      this.master.connect(this.ctx.destination);

      // ゆるやかな残響(フィードバックディレイ)
      this.wet = this.ctx.createGain();
      this.wet.gain.value = 0.55;
      const delay = this.ctx.createDelay(1.0);
      delay.delayTime.value = 0.31;
      const fb = this.ctx.createGain();
      fb.gain.value = 0.42;
      const lp = this.ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 1600;
      this.wet.connect(delay);
      delay.connect(lp);
      lp.connect(fb);
      fb.connect(delay);
      lp.connect(this.master);

      // 砂モード用のノイズ(ループ)
      const len = this.ctx.sampleRate * 2;
      const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      const bp = this.ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 900;
      bp.Q.value = 0.6;
      this.noiseGain = this.ctx.createGain();
      this.noiseGain.gain.value = 0;
      src.connect(bp);
      bp.connect(this.noiseGain);
      this.noiseGain.connect(this.master);
      src.start();
    },

    resume() {
      if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
    },

    setMuted(m) {
      this.muted = m;
      localStorage.setItem('mushin-muted', m ? '1' : '0');
      if (this.master) {
        this.master.gain.setTargetAtTime(m ? 0 : 0.55, this.ctx.currentTime, 0.1);
      }
    },

    // やわらかい鐘の音
    chime(freq, vol = 0.5) {
      if (!this.ctx) return;
      const t = this.ctx.currentTime;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(vol, t + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 2.2);
      const o1 = this.ctx.createOscillator();
      o1.type = 'triangle';
      o1.frequency.value = freq;
      const o2 = this.ctx.createOscillator();
      o2.type = 'sine';
      o2.frequency.value = freq * 2.001;
      const g2 = this.ctx.createGain();
      g2.gain.value = 0.28;
      o1.connect(g);
      o2.connect(g2);
      g2.connect(g);
      g.connect(this.master);
      g.connect(this.wet);
      o1.start(t);
      o2.start(t);
      o1.stop(t + 2.3);
      o2.stop(t + 2.3);
    },

    // 水滴の音(ピッチが落ちる)
    plip(freq, vol = 0.35) {
      if (!this.ctx) return;
      const t = this.ctx.currentTime;
      const o = this.ctx.createOscillator();
      o.type = 'sine';
      o.frequency.setValueAtTime(freq * 1.6, t);
      o.frequency.exponentialRampToValueAtTime(freq, t + 0.16);
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(vol, t + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.9);
      o.connect(g);
      g.connect(this.master);
      g.connect(this.wet);
      o.start(t);
      o.stop(t + 1.0);
    },

    // 砂を撫でる音の強さ(0-1)
    sandLevel(v) {
      if (!this.ctx || !this.noiseGain) return;
      this.noiseGain.gain.setTargetAtTime(v * 0.12, this.ctx.currentTime, 0.08);
    },
  };

  // ペンタトニック(D メジャー・ペンタ基調、静かな響き)
  const SCALE = [0, 2, 4, 7, 9, 12, 14, 16];
  const noteFreq = (base, idx) => base * Math.pow(2, SCALE[idx % SCALE.length] / 12);

  /* ---------------- 泡モード ---------------- */
  const bubbles = {
    orbs: [],
    pops: [],
    hue: 210,

    enter() {
      this.orbs = [];
      for (let i = 0; i < 13; i++) this.orbs.push(this.spawn(true));
    },
    exit() {},

    spawn(anywhere) {
      const r = rand(18, 46);
      return {
        x: rand(r, W - r),
        y: anywhere ? rand(0, H) : H + r + rand(0, H * 0.4),
        r,
        vy: rand(9, 22),
        sway: rand(0.4, 1.1),
        phase: rand(0, Math.PI * 2),
        hue: 190 + rand(0, 80),
        alive: true,
      };
    },

    pointerDown(x, y) {
      let best = null, bestD = Infinity;
      for (const o of this.orbs) {
        if (!o.alive) continue;
        const d = Math.hypot(o.x - x, o.y - y);
        if (d < o.r + 16 && d < bestD) { best = o; bestD = d; }
      }
      if (best) this.pop(best);
    },
    pointerMove() {},
    pointerUp() {},

    pop(o) {
      o.alive = false;
      const noteIdx = Math.round((1 - (o.r - 18) / 28) * 5);
      Audio.chime(noteFreq(220, Math.max(0, noteIdx)), 0.4);
      const parts = [];
      const n = 10 + (o.r / 5) | 0;
      for (let i = 0; i < n; i++) {
        const a = rand(0, Math.PI * 2);
        const sp = rand(20, 90);
        parts.push({ x: o.x, y: o.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 1, r: rand(1.5, 3.5) });
      }
      this.pops.push({ x: o.x, y: o.y, r: o.r, ringR: o.r, hue: o.hue, life: 1, parts });
      addCount();
      setTimeout(() => {
        const i = this.orbs.indexOf(o);
        if (i >= 0) this.orbs[i] = this.spawn(false);
      }, rand(600, 2200));
    },

    update(dt, t) {
      for (const o of this.orbs) {
        if (!o.alive) continue;
        o.y -= o.vy * dt;
        o.x += Math.sin(t * o.sway + o.phase) * 10 * dt;
        if (o.y < -o.r - 10) {
          Object.assign(o, this.spawn(false));
        }
      }
      for (const p of this.pops) {
        p.life -= dt * 0.9;
        p.ringR += 80 * dt;
        for (const q of p.parts) {
          q.x += q.vx * dt;
          q.y += q.vy * dt;
          q.vy += 15 * dt;
          q.life -= dt * 1.1;
        }
      }
      this.pops = this.pops.filter((p) => p.life > 0);
    },

    draw(t) {
      // 夜のグラデーション(ゆっくり色相が揺れる)
      const h1 = 222 + Math.sin(t * 0.02) * 14;
      const g = ctx.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, `hsl(${h1}, 46%, 8%)`);
      g.addColorStop(1, `hsl(${h1 + 22}, 42%, 16%)`);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);

      for (const o of this.orbs) {
        if (!o.alive) continue;
        const rg = ctx.createRadialGradient(o.x - o.r * 0.25, o.y - o.r * 0.3, o.r * 0.1, o.x, o.y, o.r);
        rg.addColorStop(0, `hsla(${o.hue}, 80%, 88%, 0.85)`);
        rg.addColorStop(0.55, `hsla(${o.hue}, 70%, 68%, 0.30)`);
        rg.addColorStop(1, `hsla(${o.hue}, 70%, 60%, 0.06)`);
        ctx.fillStyle = rg;
        ctx.beginPath();
        ctx.arc(o.x, o.y, o.r, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = `hsla(${o.hue}, 80%, 82%, 0.35)`;
        ctx.lineWidth = 1;
        ctx.stroke();
      }

      for (const p of this.pops) {
        const a = Math.max(0, p.life);
        ctx.strokeStyle = `hsla(${p.hue}, 85%, 80%, ${a * 0.6})`;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.ringR, 0, Math.PI * 2);
        ctx.stroke();
        for (const q of p.parts) {
          if (q.life <= 0) continue;
          ctx.fillStyle = `hsla(${p.hue}, 85%, 85%, ${q.life * 0.8})`;
          ctx.beginPath();
          ctx.arc(q.x, q.y, q.r * q.life, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    },
  };

  /* ---------------- 波紋モード ---------------- */
  const ripples = {
    rings: [],
    specks: [],
    lastDrag: null,

    enter() {
      this.rings = [];
      this.specks = [];
      for (let i = 0; i < 26; i++) {
        this.specks.push({
          x: rand(0, W), y: rand(0, H),
          vx: rand(-4, 4), vy: rand(-4, 4),
          r: rand(0.6, 1.8), tw: rand(0, Math.PI * 2),
        });
      }
    },
    exit() { this.lastDrag = null; },

    addRipple(x, y, big) {
      for (let i = 0; i < (big ? 3 : 1); i++) {
        this.rings.push({ x, y, r: 2, v: 60 + i * 14, life: 1, delay: i * 0.14, w: big ? 2 : 1.2 });
      }
      if (big) {
        Audio.plip(noteFreq(146.83, (Math.random() * 5) | 0), 0.32);
        addCount();
      }
    },

    pointerDown(x, y) {
      this.addRipple(x, y, true);
      this.lastDrag = { x, y };
    },
    pointerMove(x, y) {
      if (!this.lastDrag) { this.lastDrag = { x, y }; return; }
      const d = Math.hypot(x - this.lastDrag.x, y - this.lastDrag.y);
      if (d > 34) {
        this.addRipple(x, y, false);
        if (Math.random() < 0.22) Audio.plip(noteFreq(293.66, (Math.random() * 5) | 0), 0.1);
        this.lastDrag = { x, y };
      }
    },
    pointerUp() { this.lastDrag = null; },

    update(dt) {
      for (const r of this.rings) {
        if (r.delay > 0) { r.delay -= dt; continue; }
        r.r += r.v * dt;
        r.life -= dt * 0.5;
      }
      this.rings = this.rings.filter((r) => r.life > 0);
      for (const s of this.specks) {
        s.x += s.vx * dt;
        s.y += s.vy * dt;
        s.tw += dt * 2;
        if (s.x < -5) s.x = W + 5;
        if (s.x > W + 5) s.x = -5;
        if (s.y < -5) s.y = H + 5;
        if (s.y > H + 5) s.y = -5;
      }
    },

    draw(t) {
      const g = ctx.createLinearGradient(0, 0, 0, H);
      const h = 195 + Math.sin(t * 0.017) * 10;
      g.addColorStop(0, `hsl(${h}, 55%, 6%)`);
      g.addColorStop(1, `hsl(${h - 15}, 50%, 12%)`);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);

      // 月あかり
      const mg = ctx.createRadialGradient(W * 0.72, H * 0.2, 10, W * 0.72, H * 0.2, H * 0.55);
      mg.addColorStop(0, 'rgba(220, 235, 245, 0.10)');
      mg.addColorStop(1, 'rgba(220, 235, 245, 0)');
      ctx.fillStyle = mg;
      ctx.fillRect(0, 0, W, H);

      for (const s of this.specks) {
        const a = 0.25 + Math.sin(s.tw) * 0.2;
        ctx.fillStyle = `rgba(200, 230, 240, ${a})`;
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
        ctx.fill();
      }

      for (const r of this.rings) {
        if (r.delay > 0) continue;
        const a = Math.max(0, r.life) * 0.55;
        ctx.strokeStyle = `rgba(190, 225, 240, ${a})`;
        ctx.lineWidth = r.w;
        ctx.beginPath();
        ctx.ellipse(r.x, r.y, r.r, r.r * 0.62, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
    },
  };

  /* ---------------- 砂紋モード ---------------- */
  const sand = {
    base: null,      // 砂の下地(粒)
    grooves: null,   // 描いた砂紋
    gctx: null,
    lastDrag: new Map(),
    speed: 0,

    onResize() {
      this.base = document.createElement('canvas');
      this.base.width = canvas.width;
      this.base.height = canvas.height;
      const bctx = this.base.getContext('2d');
      bctx.fillStyle = '#c9bda3';
      bctx.fillRect(0, 0, this.base.width, this.base.height);
      // 砂の粒
      const img = bctx.getImageData(0, 0, this.base.width, this.base.height);
      const d = img.data;
      for (let i = 0; i < d.length; i += 4) {
        const n = (Math.random() - 0.5) * 22;
        d[i] += n; d[i + 1] += n; d[i + 2] += n;
      }
      bctx.putImageData(img, 0, 0);

      const old = this.grooves;
      this.grooves = document.createElement('canvas');
      this.grooves.width = canvas.width;
      this.grooves.height = canvas.height;
      this.gctx = this.grooves.getContext('2d');
      this.gctx.setTransform(DPR, 0, 0, DPR, 0, 0);
      this.gctx.lineCap = 'round';
      if (old) this.gctx.drawImage(old, 0, 0, old.width / DPR, old.height / DPR);
    },

    enter() {
      if (!this.base) this.onResize();
    },
    exit() {
      this.lastDrag.clear();
      Audio.sandLevel(0);
    },

    pointerDown(x, y, id) {
      this.lastDrag.set(id, { x, y });
    },

    pointerMove(x, y, id) {
      const last = this.lastDrag.get(id);
      if (!last) { this.lastDrag.set(id, { x, y }); return; }
      const dx = x - last.x, dy = y - last.y;
      const d = Math.hypot(dx, dy);
      if (d < 3) return;
      this.speed = Math.min(1, this.speed + d / 260);
      const nx = -dy / d, ny = dx / d; // 進行方向に垂直
      // 前のセグメントの法線と端点をつないで、カーブでも溝が途切れないように
      const pnx = last.nx !== undefined ? last.nx : nx;
      const pny = last.ny !== undefined ? last.ny : ny;
      const g = this.gctx;
      // 熊手:5本の溝
      for (const off of [-18, -9, 0, 9, 18]) {
        // 影(溝のへこみ)— 不透明色で重なりの継ぎ目を出さない
        g.strokeStyle = '#a6926f';
        g.lineWidth = 3.4;
        g.beginPath();
        g.moveTo(last.x + pnx * off, last.y + pny * off);
        g.lineTo(x + nx * off, y + ny * off);
        g.stroke();
        // ハイライト(盛り上がり)
        g.strokeStyle = '#ece0c2';
        g.lineWidth = 1.6;
        g.beginPath();
        g.moveTo(last.x + pnx * (off + 2.4), last.y + pny * (off + 2.4));
        g.lineTo(x + nx * (off + 2.4), y + ny * (off + 2.4));
        g.stroke();
      }
      this.lastDrag.set(id, { x, y, nx, ny });
    },

    pointerUp(x, y, id) {
      this.lastDrag.delete(id);
    },

    update(dt) {
      // 砂紋はゆっくり消えていく
      this.gctx.save();
      this.gctx.setTransform(1, 0, 0, 1, 0, 0);
      this.gctx.globalCompositeOperation = 'destination-out';
      this.gctx.fillStyle = 'rgba(0, 0, 0, 0.006)';
      this.gctx.fillRect(0, 0, this.grooves.width, this.grooves.height);
      this.gctx.restore();

      this.speed = Math.max(0, this.speed - dt * 2.2);
      Audio.sandLevel(this.lastDrag.size > 0 ? Math.max(0.15, this.speed) : this.speed * 0.4);
    },

    draw(t) {
      ctx.drawImage(this.base, 0, 0, W, H);
      ctx.drawImage(this.grooves, 0, 0, W, H);
      // 夕方のようなやわらかい光
      const vg = ctx.createRadialGradient(W / 2, H * 0.4, 10, W / 2, H * 0.5, Math.max(W, H) * 0.85);
      vg.addColorStop(0, 'rgba(255, 244, 214, 0.05)');
      vg.addColorStop(1, 'rgba(60, 45, 30, 0.28)');
      ctx.fillStyle = vg;
      ctx.fillRect(0, 0, W, H);

      // 石
      for (const [sx, sy, sr] of [[0.22, 0.3, 26], [0.74, 0.62, 34], [0.62, 0.18, 18]]) {
        const x = sx * W, y = sy * H;
        ctx.fillStyle = 'rgba(50, 48, 52, 0.35)';
        ctx.beginPath();
        ctx.ellipse(x + 4, y + 5, sr * 1.05, sr * 0.8, 0.3, 0, Math.PI * 2);
        ctx.fill();
        const sg = ctx.createRadialGradient(x - sr * 0.3, y - sr * 0.35, sr * 0.1, x, y, sr);
        sg.addColorStop(0, '#8d8a90');
        sg.addColorStop(1, '#55525a');
        ctx.fillStyle = sg;
        ctx.beginPath();
        ctx.ellipse(x, y, sr, sr * 0.78, 0.3, 0, Math.PI * 2);
        ctx.fill();
      }
    },
  };

  /* ---------------- 共通 ---------------- */
  const modes = { bubbles, ripples, sand };
  let current = 'bubbles';

  // そっと数を数える(押しつけない)
  let count = parseInt(localStorage.getItem('mushin-count') || '0', 10);
  function addCount() {
    count++;
    localStorage.setItem('mushin-count', String(count));
  }

  function setMode(name) {
    if (!modes[name] || name === current) return;
    modes[current].exit();
    current = name;
    modes[current].enter();
    document.querySelectorAll('.mode-btn').forEach((b) => {
      b.classList.toggle('active', b.dataset.mode === name);
    });
  }

  /* ---- 入力 ---- */
  const ui = document.getElementById('ui');
  const soundBtn = document.getElementById('sound');
  const intro = document.getElementById('intro');
  let idleTimer = null;
  let started = false;

  function wakeUI() {
    ui.classList.remove('idle');
    soundBtn.classList.remove('idle');
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      ui.classList.add('idle');
      soundBtn.classList.add('idle');
    }, 4000);
  }

  function start() {
    if (started) return;
    started = true;
    Audio.init();
    Audio.resume();
    intro.classList.add('hide');
    Audio.chime(noteFreq(220, 2), 0.3);
    wakeUI();
  }

  intro.addEventListener('pointerdown', start);

  canvas.addEventListener('pointerdown', (e) => {
    start();
    Audio.resume();
    wakeUI();
    modes[current].pointerDown(e.clientX, e.clientY, e.pointerId);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (e.buttons === 0 && e.pointerType !== 'touch') return;
    modes[current].pointerMove(e.clientX, e.clientY, e.pointerId);
  });
  const up = (e) => modes[current].pointerUp(e.clientX, e.clientY, e.pointerId);
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', up);

  document.querySelectorAll('.mode-btn').forEach((b) => {
    b.addEventListener('click', () => {
      start();
      setMode(b.dataset.mode);
      wakeUI();
    });
  });

  soundBtn.classList.toggle('muted', Audio.muted);
  soundBtn.addEventListener('click', () => {
    start();
    Audio.setMuted(!Audio.muted);
    soundBtn.classList.toggle('muted', Audio.muted);
    wakeUI();
  });

  // スクロール・ズームの抑止
  document.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });
  document.addEventListener('gesturestart', (e) => e.preventDefault());
  document.addEventListener('dblclick', (e) => e.preventDefault());

  window.addEventListener('resize', resize);
  window.addEventListener('orientationchange', () => setTimeout(resize, 300));
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) Audio.sandLevel(0);
  });

  /* ---- メインループ ---- */
  let lastT = performance.now();
  function frame(now) {
    const dt = Math.min(0.05, (now - lastT) / 1000);
    lastT = now;
    const t = now / 1000;
    modes[current].update(dt, t);
    modes[current].draw(t);

    // そっと表示する累計
    if (count > 0) {
      ctx.fillStyle = current === 'sand' ? 'rgba(80, 66, 46, 0.28)' : 'rgba(255, 255, 255, 0.14)';
      ctx.font = '11px "Hiragino Mincho ProN", serif';
      ctx.textAlign = 'left';
      ctx.fillText(String(count), 16, H - 16);
    }
    requestAnimationFrame(frame);
  }

  resize();
  modes[current].enter();
  requestAnimationFrame(frame);
})();
