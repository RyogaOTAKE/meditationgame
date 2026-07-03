/* 無心 - Mushin: 目の前の単純作業だけに没頭するためのゲーム */
(() => {
  'use strict';

  const canvas = document.getElementById('c');
  const ctx = canvas.getContext('2d');
  let W = 0, H = 0, DPR = 1;

  const rand = (a, b) => a + Math.random() * (b - a);
  const dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);

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
      this.wet.gain.value = 0.5;
      const delay = this.ctx.createDelay(1.0);
      delay.delayTime.value = 0.29;
      const fb = this.ctx.createGain();
      fb.gain.value = 0.4;
      const lp = this.ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 1600;
      this.wet.connect(delay);
      delay.connect(lp);
      lp.connect(fb);
      fb.connect(delay);
      lp.connect(this.master);

      // なぞり用のノイズ(ループ)
      const len = this.ctx.sampleRate * 2;
      const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      const bp = this.ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 1100;
      bp.Q.value = 0.7;
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
    chime(freq, vol = 0.4, at = 0) {
      if (!this.ctx) return;
      const t = this.ctx.currentTime + at;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(vol, t + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 2.0);
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
      o1.stop(t + 2.1);
      o2.stop(t + 2.1);
    },

    // タスク完了のアルペジオ
    arpeggio(base = 220, deep = false) {
      const idx = [0, 2, 4];
      idx.forEach((n, i) => this.chime(noteFreq(base, n), deep ? 0.4 : 0.32, i * 0.09));
      if (deep) this.chime(base / 2, 0.3, 0.27);
    },

    // 小さな確認音(なぞりの途中など)
    plip(freq, vol = 0.2) {
      if (!this.ctx) return;
      const t = this.ctx.currentTime;
      const o = this.ctx.createOscillator();
      o.type = 'sine';
      o.frequency.setValueAtTime(freq * 1.5, t);
      o.frequency.exponentialRampToValueAtTime(freq, t + 0.12);
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(vol, t + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
      o.connect(g);
      g.connect(this.master);
      g.connect(this.wet);
      o.start(t);
      o.stop(t + 0.7);
    },

    // まちがえたときの、責めないやわらかい音
    thud() {
      if (!this.ctx) return;
      const t = this.ctx.currentTime;
      const o = this.ctx.createOscillator();
      o.type = 'sine';
      o.frequency.setValueAtTime(140, t);
      o.frequency.exponentialRampToValueAtTime(90, t + 0.18);
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.13, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
      o.connect(g);
      g.connect(this.master);
      o.start(t);
      o.stop(t + 0.35);
    },

    // なぞる音の強さ(0-1)
    scratch(v) {
      if (!this.ctx || !this.noiseGain) return;
      this.noiseGain.gain.setTargetAtTime(v * 0.08, this.ctx.currentTime, 0.06);
    },
  };

  // ペンタトニック(静かな響き)
  const SCALE = [0, 2, 4, 7, 9, 12, 14, 16];
  const noteFreq = (base, idx) => base * Math.pow(2, SCALE[Math.max(0, idx) % SCALE.length] / 12);

  /* ---------------- 色 ---------------- */
  const COLORS = [
    { name: 'あお', hue: 210 },
    { name: 'みどり', hue: 145 },
    { name: 'もも', hue: 335 },
    { name: 'こがね', hue: 46 },
    { name: 'むらさき', hue: 275 },
  ];
  const colorCss = (hue, l = 75) => `hsl(${hue}, 80%, ${l}%)`;

  function shuffled(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = (Math.random() * (i + 1)) | 0;
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  /* ---------------- 描画ヘルパ ---------------- */
  function drawOrb(x, y, r, hue, alpha = 1) {
    const rg = ctx.createRadialGradient(x - r * 0.25, y - r * 0.3, r * 0.1, x, y, r);
    rg.addColorStop(0, `hsla(${hue}, 80%, 88%, ${0.9 * alpha})`);
    rg.addColorStop(0.55, `hsla(${hue}, 72%, 66%, ${0.4 * alpha})`);
    rg.addColorStop(1, `hsla(${hue}, 72%, 58%, ${0.08 * alpha})`);
    ctx.fillStyle = rg;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = `hsla(${hue}, 80%, 82%, ${0.4 * alpha})`;
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  // 遊び領域(指示テキストと下端を避ける)
  const area = () => ({ top: H * 0.2, bottom: H * 0.88, left: 14, right: W - 14 });

  // 重ならないように配置
  function placeOrbs(n, rMin, rMax) {
    const a = area();
    const orbs = [];
    for (let i = 0; i < n; i++) {
      const r = rand(rMin, rMax);
      let x = 0, y = 0, ok = false;
      for (let tries = 0; tries < 80 && !ok; tries++) {
        x = rand(a.left + r, a.right - r);
        y = rand(a.top + r, a.bottom - r);
        ok = orbs.every((o) => dist(x, y, o.x, o.y) > r + o.r + 12);
      }
      orbs.push({ x, y, r, wob: 0, phase: rand(0, Math.PI * 2) });
    }
    return orbs;
  }

  const wobX = (o) => Math.sin(o.wob * 26) * 7 * o.wob;

  function hitOrb(orbs, x, y, pad = 14) {
    let best = null, bestD = Infinity;
    for (const o of orbs) {
      if (o.alive === false || o.placed) continue;
      const d = dist(o.x, o.y, x, y);
      if (d < o.r + pad && d < bestD) { best = o; bestD = d; }
    }
    return best;
  }

  /* ---------------- エフェクト ---------------- */
  const effects = [];
  function popFx(x, y, r, hue) {
    const parts = [];
    const n = 10 + ((r / 4) | 0);
    for (let i = 0; i < n; i++) {
      const a = rand(0, Math.PI * 2);
      const sp = rand(25, 100);
      parts.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 1, r: rand(1.5, 3.5) });
    }
    effects.push({ x, y, ringR: r, hue, life: 1, parts });
  }
  function updateEffects(dt) {
    for (const p of effects) {
      p.life -= dt * 0.9;
      p.ringR += 90 * dt;
      for (const q of p.parts) {
        q.x += q.vx * dt;
        q.y += q.vy * dt;
        q.vy += 20 * dt;
        q.life -= dt * 1.1;
      }
    }
    for (let i = effects.length - 1; i >= 0; i--) {
      if (effects[i].life <= 0) effects.splice(i, 1);
    }
  }
  function drawEffects() {
    for (const p of effects) {
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
  }

  /* ================ タスク ================ */

  /* --- ふれる(指定色 / すべて) --- */
  function makeCollect(all) {
    const chosen = shuffled(COLORS).slice(0, all ? 5 : 3);
    const target = chosen[0];
    const counts = all ? [3, 3, 2, 2, 2] : [4, 3, 3];
    const orbs = placeOrbs(counts.reduce((s, c) => s + c, 0), 24, 34);
    let k = 0;
    chosen.forEach((c, ci) => {
      for (let i = 0; i < counts[ci]; i++) {
        const o = orbs[k++];
        o.hue = c.hue;
        o.isTarget = all || ci === 0;
        o.alive = true;
        o.vx = rand(-7, 7);
        o.vy = rand(-7, 7);
      }
    });
    let remaining = orbs.filter((o) => o.isTarget).length;

    return {
      type: all ? 'tapall' : 'collect',
      label: all
        ? 'すべての ひかりに ふれる'
        : `<span style="color:${colorCss(target.hue)}">${target.name}</span>の ひかりに ふれる`,
      done: false,
      down(x, y) {
        const o = hitOrb(orbs, x, y);
        if (!o) return;
        if (o.isTarget) {
          o.alive = false;
          remaining--;
          popFx(o.x, o.y, o.r, o.hue);
          Audio.chime(noteFreq(220, 5 - Math.min(5, remaining)), 0.35);
          if (remaining <= 0) this.done = true;
        } else {
          o.wob = 1;
          Audio.thud();
        }
      },
      move() {},
      up() {},
      update(dt, t) {
        const a = area();
        for (const o of orbs) {
          if (!o.alive) continue;
          o.x += o.vx * dt;
          o.y += o.vy * dt;
          if (o.x < a.left + o.r || o.x > a.right - o.r) o.vx *= -1;
          if (o.y < a.top + o.r || o.y > a.bottom - o.r) o.vy *= -1;
          o.wob = Math.max(0, o.wob - dt * 3);
        }
      },
      draw(t) {
        for (const o of orbs) {
          if (!o.alive) continue;
          const pulse = 1 + Math.sin(t * 2 + o.phase) * 0.04;
          drawOrb(o.x + wobX(o), o.y, o.r * pulse, o.hue);
        }
      },
      debug: () => ({
        targets: orbs.filter((o) => o.alive && o.isTarget).map((o) => ({ x: o.x, y: o.y })),
      }),
    };
  }

  /* --- 1から順にタップ --- */
  function makeOrder() {
    const n = 6;
    const orbs = placeOrbs(n, 27, 33);
    orbs.forEach((o, i) => {
      o.num = i + 1;
      o.hue = 210;
      o.alive = true;
    });
    let next = 1;

    return {
      type: 'order',
      label: '1 から じゅんばんに ふれる',
      done: false,
      down(x, y) {
        const o = hitOrb(orbs, x, y);
        if (!o) return;
        if (o.num === next) {
          o.alive = false;
          popFx(o.x, o.y, o.r, 48);
          Audio.chime(noteFreq(220, o.num - 1), 0.35);
          next++;
          if (next > n) this.done = true;
        } else {
          o.wob = 1;
          Audio.thud();
        }
      },
      move() {},
      up() {},
      update(dt) {
        for (const o of orbs) o.wob = Math.max(0, o.wob - dt * 3);
      },
      draw(t) {
        for (const o of orbs) {
          if (!o.alive) continue;
          const isNext = o.num === next;
          const pulse = isNext ? 1 + Math.sin(t * 3.5) * 0.06 : 1;
          drawOrb(o.x + wobX(o), o.y, o.r * pulse, isNext ? 48 : 218);
          ctx.fillStyle = 'rgba(255, 255, 255, 0.92)';
          ctx.font = `${Math.round(o.r * 0.85)}px "Hiragino Mincho ProN", serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(String(o.num), o.x + wobX(o), o.y + 1);
        }
      },
      debug: () => ({
        next,
        orbs: orbs.filter((o) => o.alive).map((o) => ({ x: o.x, y: o.y, num: o.num })),
      }),
    };
  }

  /* --- ひかりの道をなぞる --- */
  function makeTrace() {
    const a = area();
    const cx = W / 2, cy = (a.top + a.bottom) / 2;
    const pts = [];
    const kind = (Math.random() * 4) | 0;
    const N = 26;
    for (let i = 0; i <= N; i++) {
      const t = i / N;
      let x, y;
      if (kind === 0) { // よこの波
        x = a.left + 26 + t * (W - 80);
        y = cy + Math.sin(t * Math.PI * 2.5) * H * 0.1;
      } else if (kind === 1) { // 山なりの弧
        const ang = Math.PI + t * Math.PI;
        x = cx + Math.cos(ang) * W * 0.36;
        y = cy + 40 + Math.sin(ang) * H * 0.22;
      } else if (kind === 2) { // まる
        const ang = -Math.PI / 2 + t * Math.PI * 2;
        x = cx + Math.cos(ang) * Math.min(W * 0.32, H * 0.2);
        y = cy + Math.sin(ang) * Math.min(W * 0.32, H * 0.2);
      } else { // たてのS
        y = a.top + 30 + t * (a.bottom - a.top - 70);
        x = cx + Math.sin(t * Math.PI * 2) * W * 0.27;
      }
      pts.push({ x, y });
    }
    let idx = 0;
    let lastP = null;

    const advance = (x, y) => {
      // 速い指でも取りこぼさないように補間しながら判定
      const from = lastP || { x, y };
      const d = dist(from.x, from.y, x, y);
      const steps = Math.max(1, Math.ceil(d / 8));
      for (let s = 1; s <= steps && idx < pts.length; s++) {
        const px = from.x + (x - from.x) * (s / steps);
        const py = from.y + (y - from.y) * (s / steps);
        while (idx < pts.length && dist(px, py, pts[idx].x, pts[idx].y) < 38) {
          idx++;
          if (idx % 5 === 0) Audio.plip(noteFreq(440, idx / 5), 0.14);
        }
      }
      lastP = { x, y };
      if (idx >= pts.length) {
        Audio.scratch(0);
        this_done();
      }
    };
    let this_done = () => {};

    const task = {
      type: 'trace',
      label: 'ひかりの みちを なぞる',
      done: false,
      down(x, y) { lastP = { x, y }; advance(x, y); },
      move(x, y) { Audio.scratch(0.7); advance(x, y); },
      up() { Audio.scratch(0); lastP = null; },
      update() {},
      draw(t) {
        // 道しるべの点
        ctx.fillStyle = 'rgba(200, 215, 245, 0.35)';
        for (let i = idx; i < pts.length; i += 2) {
          ctx.beginPath();
          ctx.arc(pts[i].x, pts[i].y, 2.5, 0, Math.PI * 2);
          ctx.fill();
        }
        // なぞり終えた部分
        if (idx > 0) {
          ctx.strokeStyle = 'rgba(190, 215, 255, 0.75)';
          ctx.lineWidth = 5;
          ctx.lineCap = 'round';
          ctx.lineJoin = 'round';
          ctx.shadowColor = 'rgba(160, 200, 255, 0.8)';
          ctx.shadowBlur = 12;
          ctx.beginPath();
          ctx.moveTo(pts[0].x, pts[0].y);
          for (let i = 1; i < idx; i++) ctx.lineTo(pts[i].x, pts[i].y);
          ctx.stroke();
          ctx.shadowBlur = 0;
        }
        // つぎの目標点
        if (idx < pts.length) {
          const p = pts[idx];
          const pulse = 8 + Math.sin(t * 4) * 3;
          ctx.strokeStyle = 'rgba(255, 240, 200, 0.85)';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(p.x, p.y, pulse + 6, 0, Math.PI * 2);
          ctx.stroke();
          ctx.fillStyle = 'rgba(255, 244, 214, 0.9)';
          ctx.beginPath();
          ctx.arc(p.x, p.y, 5, 0, Math.PI * 2);
          ctx.fill();
        }
      },
      debug: () => ({ idx, pts: pts.map((p) => ({ x: p.x, y: p.y })) }),
    };
    this_done = () => { task.done = true; };
    return task;
  }

  /* --- おなじ色に かさねる(ドラッグ) --- */
  function makeMatch() {
    const a = area();
    const chosen = shuffled(COLORS).slice(0, 3);
    const xs = [W * 0.22, W * 0.5, W * 0.78];
    const rings = shuffled(chosen).map((c, i) => ({
      x: xs[i], y: a.top + H * 0.09, r: 42, hue: c.hue, filled: false,
    }));
    const orbs = shuffled(chosen).map((c, i) => ({
      x: xs[i], y: a.bottom - H * 0.08, r: 29, hue: c.hue,
      hx: xs[i], hy: a.bottom - H * 0.08,
      drag: false, placed: false, retT: 0,
    }));
    const grabbed = new Map();
    let placed = 0;

    return {
      type: 'match',
      label: 'おなじ いろに かさねる',
      done: false,
      down(x, y, id) {
        const o = hitOrb(orbs, x, y, 18);
        if (o && !o.placed && !o.drag) {
          o.drag = true;
          o.retT = 0;
          grabbed.set(id, o);
        }
      },
      move(x, y, id) {
        const o = grabbed.get(id);
        if (o) { o.x = x; o.y = y; }
      },
      up(x, y, id) {
        const o = grabbed.get(id);
        if (!o) return;
        grabbed.delete(id);
        o.drag = false;
        let ring = null, bd = Infinity;
        for (const r of rings) {
          const d = dist(o.x, o.y, r.x, r.y);
          if (d < r.r + 16 && d < bd) { ring = r; bd = d; }
        }
        if (ring && !ring.filled && ring.hue === o.hue) {
          o.x = ring.x; o.y = ring.y;
          o.placed = true;
          ring.filled = true;
          placed++;
          popFx(ring.x, ring.y, ring.r, o.hue);
          Audio.chime(noteFreq(220, placed + 1), 0.35);
          if (placed >= orbs.length) this.done = true;
        } else {
          if (ring) Audio.thud();
          o.retT = 1; // ゆっくり元の場所へ
        }
      },
      update(dt) {
        for (const o of orbs) {
          if (o.retT > 0) {
            o.retT = Math.max(0, o.retT - dt * 3);
            o.x += (o.hx - o.x) * Math.min(1, dt * 8);
            o.y += (o.hy - o.y) * Math.min(1, dt * 8);
            if (o.retT === 0) { o.x = o.hx; o.y = o.hy; }
          }
        }
      },
      draw(t) {
        for (const r of rings) {
          const pulse = r.filled ? 1 : 1 + Math.sin(t * 2.5 + r.x) * 0.04;
          ctx.strokeStyle = `hsla(${r.hue}, 75%, 72%, ${r.filled ? 0.35 : 0.8})`;
          ctx.lineWidth = 2.5;
          ctx.setLineDash(r.filled ? [] : [6, 7]);
          ctx.beginPath();
          ctx.arc(r.x, r.y, r.r * pulse, 0, Math.PI * 2);
          ctx.stroke();
          ctx.setLineDash([]);
        }
        for (const o of orbs) {
          drawOrb(o.x, o.y, o.r * (o.drag ? 1.15 : 1), o.hue, o.placed ? 0.9 : 1);
        }
      },
      debug: () => ({
        orbs: orbs.filter((o) => !o.placed).map((o) => ({ x: o.x, y: o.y, hue: o.hue })),
        rings: rings.filter((r) => !r.filled).map((r) => ({ x: r.x, y: r.y, hue: r.hue })),
      }),
    };
  }

  /* ================ エンジン ================ */
  const MAKERS = {
    collect: () => makeCollect(false),
    tapall: () => makeCollect(true),
    order: makeOrder,
    trace: makeTrace,
    match: makeMatch,
  };
  const TYPES = Object.keys(MAKERS);

  let task = null;
  let phase = 'play'; // play | clear
  let clearT = 0;
  let bag = [];
  let total = parseInt(localStorage.getItem('mushin-count') || '0', 10);
  let milestone = false;

  const label = document.getElementById('task');
  function setLabel(html) {
    label.innerHTML = html;
    label.classList.add('show');
  }

  function nextType() {
    if (bag.length === 0) {
      bag = shuffled(TYPES);
      // 直前と同じタスクが続かないように
      if (task && bag[0] === task.type && bag.length > 1) {
        [bag[0], bag[1]] = [bag[1], bag[0]];
      }
    }
    return bag.shift();
  }

  function nextTask() {
    task = MAKERS[nextType()]();
    phase = 'play';
    setLabel(task.label);
  }

  function completeTask() {
    total++;
    localStorage.setItem('mushin-count', String(total));
    milestone = total % 10 === 0;
    Audio.arpeggio(milestone ? 165 : 220, milestone);
    phase = 'clear';
    clearT = 0;
    label.classList.remove('show');
  }

  /* ---------------- 入力 ---------------- */
  const soundBtn = document.getElementById('sound');
  const intro = document.getElementById('intro');
  let idleTimer = null;
  let started = false;

  function wakeUI() {
    soundBtn.classList.remove('idle');
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => soundBtn.classList.add('idle'), 4000);
  }

  function start() {
    if (started) return;
    started = true;
    Audio.init();
    Audio.resume();
    intro.classList.add('hide');
    Audio.chime(noteFreq(220, 2), 0.3);
    setLabel(task.label);
    wakeUI();
  }

  intro.addEventListener('pointerdown', start);

  canvas.addEventListener('pointerdown', (e) => {
    start();
    Audio.resume();
    wakeUI();
    if (phase === 'play' && task) task.down(e.clientX, e.clientY, e.pointerId);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (e.buttons === 0 && e.pointerType !== 'touch') return;
    if (phase === 'play' && task) task.move(e.clientX, e.clientY, e.pointerId);
  });
  const up = (e) => {
    if (task) task.up(e.clientX, e.clientY, e.pointerId);
  };
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', up);

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

  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth;
    H = window.innerHeight;
    canvas.width = Math.round(W * DPR);
    canvas.height = Math.round(H * DPR);
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    // 画面サイズが変わったら同じ種類のタスクを作り直す
    if (task && phase === 'play') {
      task = MAKERS[task.type]();
      if (started) setLabel(task.label);
    }
  }
  window.addEventListener('resize', resize);
  window.addEventListener('orientationchange', () => setTimeout(resize, 300));
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) Audio.scratch(0);
  });

  /* ---------------- メインループ ---------------- */
  let lastT = performance.now();
  function frame(now) {
    const dt = Math.min(0.05, (now - lastT) / 1000);
    lastT = now;
    const t = now / 1000;

    // 背景:ゆっくり色相が揺れる夜
    const h1 = 222 + Math.sin(t * 0.02) * 14;
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, `hsl(${h1}, 46%, 8%)`);
    g.addColorStop(1, `hsl(${h1 + 22}, 42%, 15%)`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    updateEffects(dt);

    if (task) {
      if (phase === 'play') {
        task.update(dt, t);
        task.draw(t);
        if (task.done) completeTask();
      } else {
        // 完了の余韻
        clearT += dt;
        task.draw(t);
        const a = Math.sin(Math.min(1, clearT) * Math.PI);
        const rg = ctx.createRadialGradient(W / 2, H / 2, 10, W / 2, H / 2, Math.max(W, H) * 0.7);
        rg.addColorStop(0, `rgba(235, 240, 255, ${a * 0.1})`);
        rg.addColorStop(1, 'rgba(235, 240, 255, 0)');
        ctx.fillStyle = rg;
        ctx.fillRect(0, 0, W, H);
        if (milestone) {
          ctx.fillStyle = `rgba(255, 244, 214, ${a * 0.85})`;
          ctx.font = '42px "Hiragino Mincho ProN", serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(String(total), W / 2, H * 0.45);
          ctx.font = '13px "Hiragino Mincho ProN", serif';
          ctx.fillText('こなした', W / 2, H * 0.45 + 40);
        }
        if (clearT >= (milestone ? 1.6 : 0.9)) nextTask();
      }
    }

    drawEffects();

    // そっと表示する累計
    if (total > 0) {
      ctx.fillStyle = 'rgba(255, 255, 255, 0.15)';
      ctx.font = '11px "Hiragino Mincho ProN", serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
      ctx.fillText(String(total), 16, H - 16);
    }
    requestAnimationFrame(frame);
  }

  // テスト・デバッグ用の覗き窓
  window.__mushin = {
    get state() {
      return {
        phase,
        total,
        type: task ? task.type : null,
        data: task && task.debug ? task.debug() : null,
      };
    },
  };

  resize();
  nextTask();
  label.classList.remove('show'); // イントロ中は隠しておく
  requestAnimationFrame(frame);
})();
