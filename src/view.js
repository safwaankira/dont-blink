// view.js — draws the hallway, the candle and the thing at the end of it,
// and makes every sound in code (Web Audio). No image or audio files.

'use strict';

function rand(seed) { // small deterministic PRNG so each pose is stable per blink
    let s = seed >>> 0;
    return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

class Sound {
    constructor() { this.ctx = null; this.master = null; this.drone = null; }

    start() {
        if (this.ctx) return;
        const ctx = this.ctx = new (window.AudioContext || window.webkitAudioContext)();
        this.master = ctx.createGain();
        this.master.gain.value = 0.9;
        this.master.connect(ctx.destination);
        // Drone: brown-ish noise through a low band-pass, slowly breathing.
        const len = ctx.sampleRate * 4;
        const buf = ctx.createBuffer(1, len, ctx.sampleRate);
        const d = buf.getChannelData(0);
        let last = 0;
        for (let i = 0; i < len; i++) { last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02; d[i] = last * 3.5; }
        const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true;
        const bp = ctx.createBiquadFilter(); bp.type = 'lowpass'; bp.frequency.value = 220;
        const g = ctx.createGain(); g.gain.value = 0.35;
        src.connect(bp).connect(g).connect(this.master); src.start();
        this.drone = { g, bp };
    }

    setDread(x) { // 0 calm .. 1 it is right here
        if (!this.ctx) return;
        const t = this.ctx.currentTime;
        this.drone.g.gain.setTargetAtTime(0.25 + 0.5 * x, t, 0.4);
        this.drone.bp.frequency.setTargetAtTime(160 + 500 * x, t, 0.4);
    }

    thump(intensity = 0.5) { // "lub-dub"
        if (!this.ctx) return;
        const ctx = this.ctx, t = ctx.currentTime;
        const hit = (at, f, v) => {
            const o = ctx.createOscillator(), g = ctx.createGain();
            o.type = 'sine'; o.frequency.setValueAtTime(f, at); o.frequency.exponentialRampToValueAtTime(f * 0.55, at + 0.12);
            g.gain.setValueAtTime(0.0001, at); g.gain.exponentialRampToValueAtTime(v, at + 0.012);
            g.gain.exponentialRampToValueAtTime(0.0001, at + 0.2);
            o.connect(g).connect(this.master); o.start(at); o.stop(at + 0.25);
        };
        const v = 0.25 + 0.75 * intensity;
        hit(t, 70, v); hit(t + 0.16, 58, v * 0.7);
    }

    noiseBurst(dur, freq, vol, q = 1) {
        if (!this.ctx) return;
        const ctx = this.ctx, t = ctx.currentTime;
        const buf = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * dur), ctx.sampleRate);
        const d = buf.getChannelData(0);
        for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
        const s = ctx.createBufferSource(); s.buffer = buf;
        const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = q;
        const g = ctx.createGain(); g.gain.value = vol;
        s.connect(f).connect(g).connect(this.master); s.start(t);
    }

    step(closeness) { this.noiseBurst(0.18, 300 + 400 * closeness, 0.4 + 0.6 * closeness, 2); }
    hiss() { this.noiseBurst(0.7, 2600, 0.5, 0.7); }
    chime() {
        if (!this.ctx) return;
        const ctx = this.ctx, t = ctx.currentTime;
        [880, 1320].forEach((f, i) => {
            const o = ctx.createOscillator(), g = ctx.createGain();
            o.frequency.value = f; g.gain.setValueAtTime(0.0001, t + i * 0.08);
            g.gain.exponentialRampToValueAtTime(0.15, t + i * 0.08 + 0.02);
            g.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.08 + 1.2);
            o.connect(g).connect(this.master); o.start(t + i * 0.08); o.stop(t + 1.5);
        });
    }
    scream() {
        if (!this.ctx) return;
        const ctx = this.ctx, t = ctx.currentTime;
        for (const f of [420, 610, 890]) {
            const o = ctx.createOscillator(), g = ctx.createGain();
            o.type = 'sawtooth'; o.frequency.setValueAtTime(f, t); o.frequency.linearRampToValueAtTime(f * 1.6, t + 0.6);
            g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.22, t + 0.03);
            g.gain.exponentialRampToValueAtTime(0.0001, t + 1.1);
            o.connect(g).connect(this.master); o.start(t); o.stop(t + 1.2);
        }
        this.noiseBurst(1.0, 1800, 0.9, 0.5);
    }
}

class Scene {
    constructor(canvas) {
        this.c = canvas; this.g = canvas.getContext('2d');
        this.breath = 0;          // -1..1 from the chest trace
        this.beatFlash = 0;       // decays after each heartbeat
        this.blackout = 0;        // ms left of the "eyes closed" cut
        this.pose = 1;            // changes every time it moves
        this.recoil = 0;          // flinch after a smile
        this.shownDistance = 100; // eased toward the real distance
        this.candle = 0;          // 0..2 lit during calibration
        this.scare = 0;           // >0 while the end scare plays
        this.dawn = 0;
        this.resize();
        window.addEventListener('resize', () => this.resize());
    }

    resize() {
        const r = window.devicePixelRatio || 1;
        this.w = this.c.clientWidth; this.h = this.c.clientHeight;
        this.c.width = Math.round(this.w * r); this.c.height = Math.round(this.h * r);
        this.g.setTransform(r, 0, 0, r, 0, 0);
    }

    moved() { this.blackout = 150; this.pose = (Math.random() * 1e9) | 0; }

    draw(dt, state) {
        const { g, w, h } = this;
        this.beatFlash = Math.max(0, this.beatFlash - dt / 450);
        this.recoil = Math.max(0, this.recoil - dt / 600);
        this.blackout = Math.max(0, this.blackout - dt);
        this.shownDistance += (state.distance - this.shownDistance) * (this.blackout > 0 ? 1 : Math.min(1, dt / 120));
        if (state.phase === 'dawn') this.dawn = Math.min(1, this.dawn + dt / 2500);

        const cx = w / 2, cy = h * 0.46;
        const near = 1 - this.shownDistance / 100; // 0 far .. 1 here
        const flick = 0.85 + 0.15 * Math.sin(performance.now() / 90) * Math.sin(performance.now() / 37) + 0.08 * this.breath;
        const light = (state.phase === 'calibrate' ? 0.25 + 0.35 * this.candle : 1) * flick;

        // Hallway: floor, ceiling, walls converging on one vanishing point.
        g.fillStyle = '#030303'; g.fillRect(0, 0, w, h);
        const vw = w * 0.07, vh = h * 0.1;
        const quad = (pts, fill) => { g.beginPath(); g.moveTo(...pts[0]); for (const p of pts.slice(1)) g.lineTo(...p); g.closePath(); g.fillStyle = fill; g.fill(); };
        const grad = (x0, y0, x1, y1, a, b) => { const gr = g.createLinearGradient(x0, y0, x1, y1); gr.addColorStop(0, a); gr.addColorStop(1, b); return gr; };
        const amb = Math.round(28 * light);
        quad([[0, h], [w, h], [cx + vw, cy + vh], [cx - vw, cy + vh]], grad(0, h, 0, cy, `rgb(${amb + 8},${amb},${amb - 6 < 0 ? 0 : amb - 6})`, '#050404'));
        quad([[0, 0], [w, 0], [cx + vw, cy - vh], [cx - vw, cy - vh]], grad(0, 0, 0, cy, '#060505', '#020202'));
        quad([[0, 0], [cx - vw, cy - vh], [cx - vw, cy + vh], [0, h]], grad(0, 0, cx, 0, `rgb(${amb + 4},${amb},${amb - 4 < 0 ? 0 : amb - 4})`, '#040303'));
        quad([[w, 0], [cx + vw, cy - vh], [cx + vw, cy + vh], [w, h]], grad(w, 0, cx, 0, `rgb(${amb + 4},${amb},${amb - 4 < 0 ? 0 : amb - 4})`, '#040303'));
        // Door frames receding on both walls.
        g.strokeStyle = `rgba(90,70,50,${0.25 * light})`; g.lineWidth = 1;
        for (let i = 1; i <= 5; i++) {
            const k = Math.pow(i / 6, 1.6);
            for (const side of [-1, 1]) {
                const x = cx + side * (w / 2 - (w / 2 - vw) * k);
                const top = (cy - vh) * k + 0 * (1 - k) + h * 0.12 * (1 - k);
                const bot = h - (h - cy - vh) * k;
                g.beginPath(); g.moveTo(x, bot); g.lineTo(x, top); g.stroke();
            }
        }

        if (state.phase !== 'calibrate') this.drawCreature(cx, cy, near, light);

        // Candle at the bottom centre; the flame sways with your breathing.
        this.drawCandle(cx, h, light);

        // Darkness that closes in as it gets nearer.
        const r = Math.max(w, h) * (0.75 - 0.35 * near) * (0.8 + 0.2 * light);
        const vg = g.createRadialGradient(cx, h * 0.8, r * 0.15, cx, h * 0.6, r);
        vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,0.96)');
        g.fillStyle = vg; g.fillRect(0, 0, w, h);

        // Heartbeat: a red pressure at the edges on every detected beat.
        if (this.beatFlash > 0) {
            const bg = g.createRadialGradient(cx, cy, Math.min(w, h) * 0.3, cx, cy, Math.max(w, h) * 0.75);
            bg.addColorStop(0, 'rgba(120,0,0,0)'); bg.addColorStop(1, `rgba(140,0,0,${0.18 + 0.45 * near * this.beatFlash})`);
            g.fillStyle = bg; g.fillRect(0, 0, w, h);
        }
        if (this.dawn > 0) { g.fillStyle = `rgba(190,170,140,${0.55 * this.dawn})`; g.fillRect(0, 0, w, h); }
        if (this.scare > 0) this.drawScare(cx, cy);
        if (this.blackout > 0) { g.fillStyle = '#000'; g.fillRect(0, 0, w, h); }
    }

    drawCandle(cx, h, light) {
        const g = this.g, bx = cx, by = h - 24, lit = this.candle > 0 || light > 0.5;
        g.fillStyle = '#d8cfbd'; g.fillRect(bx - 14, by - 70, 28, 70);
        g.fillStyle = '#3a2a1a'; g.fillRect(bx - 34, by - 4, 68, 10);
        if (!lit) return;
        const sway = this.breath * 9;
        const fl = 1 + 0.12 * Math.sin(performance.now() / 70);
        const glow = g.createRadialGradient(bx + sway, by - 92, 2, bx + sway, by - 92, 160 * light);
        glow.addColorStop(0, 'rgba(255,190,90,0.5)'); glow.addColorStop(1, 'rgba(255,140,40,0)');
        g.fillStyle = glow; g.fillRect(bx - 200, by - 280, 400, 300);
        g.beginPath();
        g.moveTo(bx - 7, by - 72);
        g.quadraticCurveTo(bx - 9 + sway * 0.4, by - 92, bx + sway, by - 72 - 34 * fl);
        g.quadraticCurveTo(bx + 9 + sway * 0.4, by - 92, bx + 7, by - 72);
        g.fillStyle = '#ffd27a'; g.fill();
    }

    drawCreature(cx, cy, near, light) {
        const g = this.g, R = rand(this.pose);
        const scale = 0.12 + Math.pow(near, 1.7) * 2.4 - this.recoil * 0.06;
        const H = this.h * 0.62 * scale;
        // Feet on the floor; once it is tall enough, its head stays at your
        // eye line and its legs drop out of frame.
        const floorY = (cy + this.h * 0.1) + (this.h * 1.02 - (cy + this.h * 0.1)) * Math.pow(near, 1.3);
        const baseY = Math.max(floorY, this.h * 0.22 + H * 0.82);
        const x = cx + (R() - 0.5) * this.w * 0.06 * (1 - near) + this.recoil * 18 * (R() - 0.5);
        const tilt = (R() - 0.5) * 0.8;          // head angle changes every blink
        const lean = (R() - 0.5) * 0.25;         // so does the body lean
        const armUp = R() > 0.55, reachSide = R() > 0.5 ? 1 : -1;
        const alpha = Math.min(1, 0.4 + 0.6 * light + near * 0.4);
        g.save(); g.translate(x, baseY); g.rotate(lean * 0.3); g.globalAlpha = alpha;

        // Lit from below by your candle: warm at the hem, black at the top.
        const robe = g.createLinearGradient(0, 0, 0, -H);
        robe.addColorStop(0, `rgba(${70 + 40 * near},${48 + 20 * near},${34},1)`);
        robe.addColorStop(0.55, '#16110e'); robe.addColorStop(1, '#070505');
        const skin = g.createLinearGradient(0, 0, 0, -H);
        skin.addColorStop(0, `rgb(${196 + 30 * near},${170 + 20 * near},${140})`); skin.addColorStop(1, '#5d5248');

        // Arms first (behind the robe): too long, joints in the wrong places.
        const shoulderY = -H * 0.74;
        g.strokeStyle = skin; g.lineCap = 'round'; g.lineJoin = 'round';
        for (const s of [-1, 1]) {
            const up = armUp && s === reachSide;
            const ex = s * H * (0.16 + 0.06 * R()), ey = shoulderY + H * (up ? -0.08 : 0.2);
            const hx = s * H * (up ? 0.1 + 0.12 * R() : 0.2 + 0.1 * R()), hy = shoulderY + H * (up ? -0.3 : 0.6);
            g.lineWidth = Math.max(1.5, H * 0.03);
            g.beginPath(); g.moveTo(s * H * 0.07, shoulderY + H * 0.02); g.lineTo(ex, ey); g.lineTo(hx, hy); g.stroke();
            g.lineWidth = Math.max(0.8, H * 0.009);
            for (let f = -2; f <= 2; f++) {
                const dir = up ? -1 : 1;
                g.beginPath(); g.moveTo(hx, hy);
                g.quadraticCurveTo(hx + f * H * 0.012, hy + dir * H * 0.05, hx + s * H * 0.01 + f * H * 0.022, hy + dir * H * 0.095);
                g.stroke();
            }
        }

        // Robe: narrow shoulders, long ragged hem.
        g.fillStyle = robe;
        g.beginPath();
        g.moveTo(-H * 0.08, shoulderY);
        g.quadraticCurveTo(-H * 0.12, -H * 0.4, -H * 0.17, -H * 0.02);
        for (let i = 0; i <= 8; i++) { // ragged hem
            const t = i / 8, hx = -H * 0.17 + t * H * 0.34;
            g.lineTo(hx, (i % 2 ? -H * 0.05 : 0) + (R() - 0.5) * H * 0.03);
        }
        g.quadraticCurveTo(H * 0.12, -H * 0.4, H * 0.08, shoulderY);
        g.closePath(); g.fill();

        // Head: small, cocked, wrapped in long black hair; the face shows more as it nears.
        g.save(); g.translate(0, shoulderY - H * 0.06); g.rotate(tilt); g.scale(1 + near * 0.7, 1 + near * 0.7);
        g.fillStyle = skin; g.beginPath(); g.ellipse(0, 0, H * 0.042, H * 0.06, 0, 0, Math.PI * 2); g.fill();
        const hairOpen = 0.35 + 0.45 * near; // hair parts to show the face
        g.fillStyle = '#050404';
        g.beginPath(); g.moveTo(-H * 0.05, -H * 0.03);
        g.quadraticCurveTo(-H * 0.07, -H * 0.085, 0, -H * 0.08);
        g.quadraticCurveTo(H * 0.07, -H * 0.085, H * 0.05, -H * 0.03);
        g.lineTo(H * 0.06, H * 0.22); g.lineTo(H * 0.025 * hairOpen, H * 0.12);
        g.lineTo(H * 0.03 * hairOpen, -H * 0.02); g.lineTo(-H * 0.03 * hairOpen, -H * 0.02);
        g.lineTo(-H * 0.025 * hairOpen, H * 0.12); g.lineTo(-H * 0.06, H * 0.22);
        g.closePath(); g.fill();
        // eyes: two points of candlelight, wider apart than they should be
        g.fillStyle = `rgba(255,${210 - 120 * near},${140 - 110 * near},${0.7 + 0.3 * near})`;
        for (const s of [-1, 1]) { g.beginPath(); g.arc(s * H * 0.015, -H * 0.006, Math.max(0.9, H * 0.0075), 0, Math.PI * 2); g.fill(); }
        if (near > 0.5) { // a mouth, only when it is close
            g.fillStyle = '#0d0505';
            g.beginPath(); g.ellipse(0, H * 0.03, H * 0.012, H * 0.01 + near * H * 0.016, 0, 0, Math.PI * 2); g.fill();
        }
        g.restore();
        g.restore();
    }

    drawScare(cx, cy) {
        const g = this.g, k = this.scare;
        g.fillStyle = `rgba(0,0,0,${0.6 * k})`; g.fillRect(0, 0, this.w, this.h);
        if (this.gentle || this.settled) return;
        // The face, filling the screen: one frame of it is enough.
        const H = Math.max(this.w, this.h) * (1.6 + 0.3 * (1 - k));
        g.save(); g.translate(cx, cy + H * 0.02); g.globalAlpha = k;
        const sk = g.createRadialGradient(0, H * 0.05, 10, 0, 0, H * 0.3);
        sk.addColorStop(0, '#d9c8ae'); sk.addColorStop(1, '#3d342c');
        g.fillStyle = sk; g.beginPath(); g.ellipse(0, 0, H * 0.21, H * 0.3, 0, 0, Math.PI * 2); g.fill();
        g.fillStyle = '#040303';
        for (const s of [-1, 1]) { g.beginPath(); g.moveTo(s * H * 0.24, -H * 0.35); g.quadraticCurveTo(s * H * 0.05, -H * 0.3, s * H * 0.06, H * 0.4); g.lineTo(s * H * 0.4, H * 0.4); g.closePath(); g.fill(); }
        for (const s of [-1, 1]) {
            g.fillStyle = '#0a0606'; g.beginPath(); g.ellipse(s * H * 0.065, -H * 0.04, H * 0.035, H * 0.022, s * 0.2, 0, Math.PI * 2); g.fill();
            g.fillStyle = '#ffe9b0'; g.beginPath(); g.arc(s * H * 0.065, -H * 0.04, H * 0.008, 0, Math.PI * 2); g.fill();
        }
        g.fillStyle = '#0d0505'; g.beginPath(); g.ellipse(0, H * 0.13, H * 0.05, H * 0.085, 0, 0, Math.PI * 2); g.fill();
        g.restore();
    }
}

module.exports = { Sound, Scene };
