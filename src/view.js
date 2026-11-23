// view.js — draws the hallway, the candle and the thing at the end of it,
// and makes every sound in code (Web Audio). No image or audio files.

'use strict';

function rand(seed) { // small deterministic PRNG so each pose is stable per blink
    let s = seed >>> 0;
    return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const lerp = (a, b, t) => a + (b - a) * t;

// ---------------------------------------------------------------- sound
class Sound {
    constructor() { this.ctx = null; }

    start() {
        if (this.ctx) { this.ctx.resume?.(); return; }
        const ctx = this.ctx = new (window.AudioContext || window.webkitAudioContext)();
        this.master = ctx.createGain(); this.master.gain.value = 0.9;
        const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 4;
        this.master.connect(comp).connect(ctx.destination);

        // A long, dark hall: reverb from a generated impulse.
        const len = Math.floor(ctx.sampleRate * 3.2);
        const ir = ctx.createBuffer(2, len, ctx.sampleRate);
        for (let c = 0; c < 2; c++) {
            const d = ir.getChannelData(c);
            for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2);
        }
        this.verb = ctx.createConvolver(); this.verb.buffer = ir;
        this.wet = ctx.createGain(); this.wet.gain.value = 0.55;
        this.verb.connect(this.wet).connect(this.master);

        // Room tone: brown noise, low-passed.
        const nb = ctx.createBuffer(1, ctx.sampleRate * 4, ctx.sampleRate), nd = nb.getChannelData(0);
        let last = 0;
        for (let i = 0; i < nd.length; i++) { last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02; nd[i] = last * 3.5; }
        this.noiseBuf = nb;
        const room = ctx.createBufferSource(); room.buffer = nb; room.loop = true;
        const rf = ctx.createBiquadFilter(); rf.type = 'lowpass'; rf.frequency.value = 180;
        this.roomGain = ctx.createGain(); this.roomGain.gain.value = 0.3;
        room.connect(rf).connect(this.roomGain).connect(this.master); room.start();
        this.roomFilter = rf;

        // Tension: two detuned low saws that open up as it nears.
        this.tension = ctx.createGain(); this.tension.gain.value = 0;
        const tf = ctx.createBiquadFilter(); tf.type = 'lowpass'; tf.frequency.value = 200; tf.Q.value = 4;
        for (const f of [55, 55.7, 82.4]) {
            const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f;
            o.connect(tf); o.start();
        }
        tf.connect(this.tension).connect(this.master); tf.connect(this.verb);
        this.tensionFilter = tf;

        // Whisper: band-passed noise with a slow, uneven tremolo; only when close.
        const ws = ctx.createBufferSource(); ws.buffer = nb; ws.loop = true; ws.playbackRate.value = 3.1;
        const wf = ctx.createBiquadFilter(); wf.type = 'bandpass'; wf.frequency.value = 2400; wf.Q.value = 3;
        this.whisper = ctx.createGain(); this.whisper.gain.value = 0;
        const trem = ctx.createOscillator(); trem.frequency.value = 5.3;
        const tg = ctx.createGain(); tg.gain.value = 0.5;
        const wobble = ctx.createGain(); wobble.gain.value = 0.5;
        trem.connect(tg).connect(wobble.gain); trem.start();
        ws.connect(wf).connect(wobble).connect(this.whisper); this.whisper.connect(this.verb); this.whisper.connect(this.master);
        ws.start();
    }

    stopAll() { if (this.ctx) this.setDread(0, true); }

    setDread(x, fast = false) { // 0 calm .. 1 it is right here
        if (!this.ctx) return;
        const t = this.ctx.currentTime, k = fast ? 0.05 : 0.6;
        this.roomGain.gain.setTargetAtTime(0.22 + 0.25 * x, t, k);
        this.roomFilter.frequency.setTargetAtTime(150 + 350 * x, t, k);
        this.tension.gain.setTargetAtTime(0.02 + 0.13 * x * x, t, k);
        this.tensionFilter.frequency.setTargetAtTime(140 + 900 * x * x, t, k);
        this.whisper.gain.setTargetAtTime(x > 0.55 ? (x - 0.55) * 0.35 : 0, t, k);
    }

    thump(intensity = 0.5) { // "lub-dub"
        if (!this.ctx) return;
        const ctx = this.ctx, t = ctx.currentTime;
        const hit = (at, f, v) => {
            const o = ctx.createOscillator(), g = ctx.createGain();
            o.type = 'sine'; o.frequency.setValueAtTime(f, at); o.frequency.exponentialRampToValueAtTime(f * 0.55, at + 0.12);
            g.gain.setValueAtTime(0.0001, at); g.gain.exponentialRampToValueAtTime(v, at + 0.012);
            g.gain.exponentialRampToValueAtTime(0.0001, at + 0.22);
            o.connect(g).connect(this.master); o.start(at); o.stop(at + 0.3);
        };
        const v = 0.18 + 0.8 * intensity;
        hit(t, 64, v); hit(t + 0.15, 54, v * 0.65);
    }

    noise(dur, freq, vol, q = 1, wet = 0.5, rate = 1) {
        if (!this.ctx) return;
        const ctx = this.ctx, t = ctx.currentTime;
        const s = ctx.createBufferSource(); s.buffer = this.noiseBuf; s.playbackRate.value = rate;
        const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = q;
        const g = ctx.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        s.connect(f).connect(g); g.connect(this.master);
        const wg = ctx.createGain(); wg.gain.value = wet; g.connect(wg).connect(this.verb);
        s.start(t, Math.random() * 3); s.stop(t + dur + 0.05);
    }

    // A dragged step on old boards: a thud plus a creak, louder and drier when close.
    step(closeness) {
        if (!this.ctx) return;
        this.noise(0.25, 140 + 120 * closeness, 0.9 + 1.4 * closeness, 1.2, 0.9 - 0.5 * closeness, 6);
        const ctx = this.ctx, t = ctx.currentTime;
        const o = ctx.createOscillator(), g = ctx.createGain(), f = ctx.createBiquadFilter();
        o.type = 'sawtooth'; const f0 = 300 + Math.random() * 250;
        o.frequency.setValueAtTime(f0, t + 0.05); o.frequency.linearRampToValueAtTime(f0 * 0.7, t + 0.5);
        f.type = 'bandpass'; f.frequency.value = 900; f.Q.value = 6;
        g.gain.setValueAtTime(0.0001, t + 0.05); g.gain.exponentialRampToValueAtTime(0.05 + 0.12 * closeness, t + 0.12);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.55);
        o.connect(f).connect(g); g.connect(this.master); g.connect(this.verb); o.start(t + 0.05); o.stop(t + 0.6);
    }
    hiss() { this.noise(0.9, 3200, 0.9, 0.8, 0.6, 1.5); }
    chime() {
        if (!this.ctx) return;
        const ctx = this.ctx, t = ctx.currentTime;
        [660, 990].forEach((f, i) => {
            const o = ctx.createOscillator(), g = ctx.createGain();
            o.frequency.value = f; g.gain.setValueAtTime(0.0001, t + i * 0.09);
            g.gain.exponentialRampToValueAtTime(0.09, t + i * 0.09 + 0.02);
            g.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.09 + 1.6);
            o.connect(g); g.connect(this.master); g.connect(this.verb); o.start(t + i * 0.09); o.stop(t + 2);
        });
    }
    dawn() {
        if (!this.ctx) return;
        this.setDread(0, true);
        const ctx = this.ctx, t = ctx.currentTime;
        [261.6, 329.6, 392, 523.3].forEach((f, i) => {
            const o = ctx.createOscillator(), g = ctx.createGain(); o.type = 'triangle'; o.frequency.value = f;
            g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.05, t + 1.2 + i * 0.2);
            g.gain.exponentialRampToValueAtTime(0.0001, t + 5);
            o.connect(g); g.connect(this.master); g.connect(this.verb); o.start(t); o.stop(t + 5.2);
        });
    }
    scream() {
        if (!this.ctx) return;
        const ctx = this.ctx, t = ctx.currentTime;
        for (const f of [392, 415, 587, 880]) {
            const o = ctx.createOscillator(), g = ctx.createGain();
            o.type = 'sawtooth'; o.frequency.setValueAtTime(f, t); o.frequency.linearRampToValueAtTime(f * 1.5, t + 0.8);
            g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.2, t + 0.02);
            g.gain.exponentialRampToValueAtTime(0.0001, t + 1.3);
            o.connect(g); g.connect(this.master); g.connect(this.verb); o.start(t); o.stop(t + 1.4);
        }
        this.noise(1.3, 1600, 2.2, 0.4, 0.8, 1);
        this.setDread(0, true);
    }
}

// ---------------------------------------------------------------- scene
const FAR = 12; // depth of the end wall, in hall units

class Scene {
    constructor(canvas) {
        this.c = canvas; this.g = canvas.getContext('2d');
        this.breath = 0;          // -1..1 from the chest trace
        this.beatFlash = 0;       // decays after each heartbeat
        this.lid = 0;             // eyelid shutter, ms left
        this.pose = 1;            // changes every time it moves
        this.recoil = 0;          // flinch after a smile
        this.shownDistance = 100;
        this.candle = 0;          // 0..2 lit during calibration
        this.scare = 0; this.dawn = 0; this.shake = 0;
        this.settled = false; this.gentle = false;
        this.grain = this.makeGrain();
        this.resize();
        window.addEventListener('resize', () => this.resize());
    }

    resize() {
        const r = 1; // big canvases at 2x cost more than they show
        this.w = this.c.clientWidth; this.h = this.c.clientHeight;
        this.c.width = Math.round(this.w * r); this.c.height = Math.round(this.h * r);
        this.g.setTransform(r, 0, 0, r, 0, 0);
        this.r = r;
        this.cx = this.w / 2; this.cy = this.h * 0.44;
        this.hall = this.buildHall(); this.vign = null; this.grainPat = null;
    }

    // Screen rectangle of the hall's cross-section at depth d (0 = you).
    frame(d) {
        const s = 1 / (1 + d), sF = 1 / (1 + FAR);
        const k = (1 - s) / (1 - sF) * 0.93;
        const { w, h, cx, cy } = this;
        return { k, s, l: lerp(-w * 0.05, cx - w * 0.06, k), r: lerp(w * 1.05, cx + w * 0.06, k), t: lerp(-h * 0.05, cy - h * 0.1, k), b: lerp(h * 1.02, cy + h * 0.1, k) };
    }

    makeGrain() {
        const out = [];
        for (let n = 0; n < 4; n++) {
            const c = document.createElement('canvas'); c.width = c.height = 256;
            const g = c.getContext('2d'), im = g.createImageData(256, 256);
            for (let i = 0; i < im.data.length; i += 4) {
                const v = Math.random() * 255; im.data[i] = im.data[i + 1] = im.data[i + 2] = v; im.data[i + 3] = 255;
            }
            g.putImageData(im, 0, 0); out.push(c);
        }
        return out;
    }

    // The hall is drawn once, fully lit, then darkened per frame.
    buildHall() {
        const c = document.createElement('canvas');
        c.width = Math.round(this.w * this.r); c.height = Math.round(this.h * this.r);
        const g = c.getContext('2d'); g.setTransform(this.r, 0, 0, this.r, 0, 0);
        const R = rand(7);
        const near = this.frame(0), far = this.frame(FAR);
        const poly = (pts, fill, stroke) => {
            g.beginPath(); g.moveTo(pts[0][0], pts[0][1]); for (const p of pts.slice(1)) g.lineTo(p[0], p[1]); g.closePath();
            if (fill) { g.fillStyle = fill; g.fill(); } if (stroke) { g.strokeStyle = stroke; g.stroke(); }
        };
        // floor: worn boards
        poly([[near.l, near.b], [near.r, near.b], [far.r, far.b], [far.l, far.b]], '#3b2a1d');
        g.lineWidth = 1;
        for (let i = 0; i <= 14; i++) {
            const t = i / 14;
            g.strokeStyle = `rgba(15,8,4,${0.5 + 0.3 * R()})`;
            g.beginPath(); g.moveTo(lerp(near.l, near.r, t), near.b); g.lineTo(lerp(far.l, far.r, t), far.b); g.stroke();
        }
        for (let d = 0.6; d < FAR; d *= 1.35) { // board ends, staggered
            const f = this.frame(d);
            for (let i = 0; i < 14; i++) {
                if (R() > 0.35) continue;
                const t0 = i / 14, t1 = (i + 1) / 14;
                g.strokeStyle = 'rgba(15,8,4,0.6)';
                g.beginPath(); g.moveTo(lerp(f.l, f.r, t0), f.b); g.lineTo(lerp(f.l, f.r, t1), f.b); g.stroke();
            }
        }
        // a runner rug down the middle
        const rug = (f, t) => lerp(f.l, f.r, t);
        poly([[rug(near, 0.36), near.b], [rug(near, 0.64), near.b], [rug(far, 0.64), far.b], [rug(far, 0.36), far.b]], 'rgba(70,14,12,0.55)');
        // walls: striped paper above wainscot
        for (const side of [-1, 1]) {
            const ex = side < 0 ? 'l' : 'r';
            poly([[near[ex], near.t], [far[ex], far.t], [far[ex], far.b], [near[ex], near.b]], '#4a3d2e');
            for (let i = 0; i < 60; i++) { // vertical stripes in perspective
                const d = Math.pow(i / 60, 2.2) * FAR, f = this.frame(d), f2 = this.frame(d + 0.05 + d * 0.02);
                g.fillStyle = i % 2 ? 'rgba(25,18,12,0.35)' : 'rgba(110,90,60,0.12)';
                poly([[f[ex], f.t], [f2[ex], f2.t], [f2[ex], lerp(f2.t, f2.b, 0.6)], [f[ex], lerp(f.t, f.b, 0.6)]], g.fillStyle);
            }
            // wainscot panels
            poly([[near[ex], lerp(near.t, near.b, 0.6)], [far[ex], lerp(far.t, far.b, 0.6)], [far[ex], far.b], [near[ex], near.b]], '#2a1c12');
            g.strokeStyle = 'rgba(160,120,70,0.25)'; g.lineWidth = 1.5;
            g.beginPath(); g.moveTo(near[ex], lerp(near.t, near.b, 0.6)); g.lineTo(far[ex], lerp(far.t, far.b, 0.6)); g.stroke();
            // doors, dark and shut, some ajar
            for (const d of [1.2, 3.1, 6.2]) {
                const a = this.frame(d), b = this.frame(d + 0.55 + d * 0.06);
                const top = (f) => lerp(f.t, f.b, 0.18);
                poly([[a[ex], top(a)], [b[ex], top(b)], [b[ex], b.b], [a[ex], a.b]], '#1c120b', 'rgba(150,110,60,0.3)');
                if (R() > 0.4) { // ajar: a black gap
                    const m = 0.75;
                    poly([[lerp(a[ex], b[ex], m), top(lerp2(a, b, m))], [b[ex], top(b)], [b[ex], b.b], [lerp(a[ex], b[ex], m), lerp(a.b, b.b, m)]], '#020101');
                }
                // brass knob
                g.fillStyle = 'rgba(200,160,80,0.6)';
                g.beginPath(); g.arc(lerp(a[ex], b[ex], side < 0 ? 0.8 : 0.2), lerp(top(a), a.b, 0.55), Math.max(1, 3 * a.s), 0, Math.PI * 2); g.fill();
            }
            // picture frames between doors
            for (const d of [2.1, 4.6]) {
                const a = this.frame(d), b = this.frame(d + 0.45 + d * 0.05);
                const y0 = (f) => lerp(f.t, f.b, 0.25), y1 = (f) => lerp(f.t, f.b, 0.47);
                poly([[a[ex], y0(a)], [b[ex], y0(b)], [b[ex], y1(b)], [a[ex], y1(a)]], '#0d0907', 'rgba(170,130,60,0.45)');
            }
        }
        // ceiling with beams
        poly([[near.l, near.t], [near.r, near.t], [far.r, far.t], [far.l, far.t]], '#1a130e');
        for (let d = 0.8; d < FAR; d *= 1.5) {
            const f = this.frame(d), f2 = this.frame(d * 1.08);
            poly([[f.l, f.t], [f.r, f.t], [f2.r, f2.t], [f2.l, f2.t]], 'rgba(5,3,2,0.8)');
        }
        // end wall and a door left open on black
        poly([[far.l, far.t], [far.r, far.t], [far.r, far.b], [far.l, far.b]], '#251a12');
        const dw = (far.r - far.l) * 0.5, dh = (far.b - far.t) * 0.8;
        g.fillStyle = '#000'; g.fillRect(this.cx - dw / 2, far.b - dh, dw, dh);
        g.strokeStyle = 'rgba(150,110,60,0.35)'; g.strokeRect(this.cx - dw / 2, far.b - dh, dw, dh);
        // depth fog toward the far end, baked in (it never changes)
        const fc = (far.t + far.b) / 2;
        const fog = g.createRadialGradient(this.cx, fc, 4, this.cx, fc, this.w * 0.45);
        fog.addColorStop(0, 'rgba(0,0,0,0.92)'); fog.addColorStop(0.45, 'rgba(0,0,0,0.6)'); fog.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = fog; g.fillRect(0, 0, this.w, this.h);
        return c;
        function lerp2(a, b, m) { return { t: lerp(a.t, b.t, m), b: lerp(a.b, b.b, m) }; }
    }

    moved(closeness) { this.lidLen = this.live ? 170 : 260; this.lid = this.lidLen; this.pendingPose = true; this.shake = closeness > 0.6 ? 22 * closeness * closeness : 0; }

    draw(dt, state) {
        const { g, w, h, cx } = this;
        const now = performance.now();
        this.beatFlash = Math.max(0, this.beatFlash - dt / 450);
        this.recoil = Math.max(0, this.recoil - dt / 700);
        this.shake = Math.max(0, this.shake - dt / 20);
        if (this.lid > 0) {
            this.lid = Math.max(0, this.lid - dt);
            if (this.pendingPose && this.lid < this.lidLen - (this.live ? 0 : 100)) { this.pose = (Math.random() * 1e9) | 0; this.pendingPose = false; this.shownDistance = state.distance; }
        } else this.shownDistance += (state.distance - this.shownDistance) * Math.min(1, dt / 150);
        if (state.phase === 'dawn') this.dawn = Math.min(1, this.dawn + dt / 3000);

        const near = 1 - this.shownDistance / 100;
        const flick = 0.82 + 0.1 * Math.sin(now / 83) * Math.sin(now / 31) + 0.06 * Math.sin(now / 7) + 0.07 * this.breath;
        const lit = state.phase === 'calibrate' ? [0.15, 0.55, 1][clamp(this.candle | 0, 0, 2)] : 1;
        const light = lit * flick;

        g.save();
        if (this.shake > 0) g.translate((Math.random() - 0.5) * this.shake, (Math.random() - 0.5) * this.shake);
        // the hall sways a little with your breathing
        g.translate(0, this.breath * 2);
        g.fillStyle = '#000'; g.fillRect(-20, -20, w + 40, h + 40);
        const amb = clamp(0.62 - 0.22 * light, 0.35, 0.92) + (state.phase === 'calibrate' ? 0.3 * (1 - lit) : 0);
        g.globalAlpha = clamp(1 - amb, 0.03, 1); g.drawImage(this.hall, 0, 0, w, h); g.globalAlpha = 1;

        if (state.phase !== 'calibrate' && !this.settled) this.drawCreature(near, light);

        // candle light: everything outside its reach falls into black
        const by = h - 30, reach = Math.max(w, h) * (0.55 + 0.25 * light) * (1 - 0.25 * near);
        const dark = g.createRadialGradient(cx, by - 60, reach * 0.05, cx, by - 140, reach);
        dark.addColorStop(0, 'rgba(0,0,0,0)'); dark.addColorStop(0.35, `rgba(0,0,0,${0.35 - 0.2 * light})`); dark.addColorStop(1, 'rgba(0,0,0,0.98)');
        g.fillStyle = dark; g.fillRect(-20, -20, w + 40, h + 40);
        g.globalCompositeOperation = 'lighter';
        const warm = g.createRadialGradient(cx, by - 80, 0, cx, by - 80, reach * 0.7);
        warm.addColorStop(0, `rgba(120,60,20,${0.35 * light})`); warm.addColorStop(1, 'rgba(255,120,40,0)');
        g.fillStyle = warm; g.fillRect(0, 0, w, h);
        g.globalCompositeOperation = 'source-over';
        this.drawCandle(cx, by, light, state.phase === 'calibrate' ? this.candle > 0 : true);
        g.restore();

        // heartbeat: red pressure at the edges on every detected beat
        if (this.beatFlash > 0) {
            const bg = g.createRadialGradient(cx, h * 0.45, Math.min(w, h) * 0.25, cx, h * 0.45, Math.max(w, h) * 0.72);
            bg.addColorStop(0, 'rgba(120,0,0,0)'); bg.addColorStop(1, `rgba(150,0,0,${(0.12 + 0.5 * near) * this.beatFlash})`);
            g.fillStyle = bg; g.fillRect(0, 0, w, h);
        }
        if (this.dawn > 0) {
            const dg = g.createLinearGradient(0, 0, 0, h);
            dg.addColorStop(0, `rgba(220,200,170,${0.75 * this.dawn})`); dg.addColorStop(1, `rgba(160,120,90,${0.5 * this.dawn})`);
            g.fillStyle = dg; g.fillRect(0, 0, w, h);
        }
        if (this.scare > 0) this.drawScare(cx, h * 0.45);
        this.drawLids();

        // film grain and a hard vignette, always on top
        g.globalAlpha = 0.045;
        if (!this.grainPat) this.grainPat = this.grain.map((c) => g.createPattern(c, 'repeat'));
        g.fillStyle = this.grainPat[(now / 60 | 0) % 4]; g.fillRect(0, 0, w, h);
        g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
        if (!this.vign) {
            const vg = g.createRadialGradient(cx, h / 2, Math.min(w, h) * 0.35, cx, h / 2, Math.max(w, h) * 0.75);
            vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,0.75)'); this.vign = vg;
        }
        g.fillStyle = this.vign; g.fillRect(0, 0, w, h);
    }

    // Eyelids: close fast, hold, open — the pose changes while they're shut.
    drawLids() {
        if (this.lid <= 0) return;
        const g = this.g, { w, h } = this, t = 1 - this.lid / this.lidLen; // 0..1
        // Live: your real eyes were the shutter, so cut straight to black and only
        // animate the reopening. Practice: draw the full close and open.
        const shut = this.live ? (t < 0.35 ? 1 : 1 - (t - 0.35) / 0.65)
            : (t < 0.25 ? t / 0.25 : t < 0.55 ? 1 : 1 - (t - 0.55) / 0.45);
        const e = shut * shut * (3 - 2 * shut);
        const half = h / 2 * e + 2;
        g.fillStyle = '#000';
        g.beginPath(); g.moveTo(0, 0); g.lineTo(w, 0); g.lineTo(w, half * 0.85); g.quadraticCurveTo(w / 2, half * 1.25, 0, half * 0.85); g.closePath(); g.fill();
        g.beginPath(); g.moveTo(0, h); g.lineTo(w, h); g.lineTo(w, h - half * 0.85); g.quadraticCurveTo(w / 2, h - half * 1.25, 0, h - half * 0.85); g.closePath(); g.fill();
    }

    drawCandle(bx, by, light, lit) {
        const g = this.g;
        // holder and wax, lit from the flame
        g.fillStyle = '#2a1a0e'; g.beginPath(); g.ellipse(bx, by + 4, 46, 9, 0, 0, Math.PI * 2); g.fill();
        g.fillStyle = '#4a3420'; g.beginPath(); g.ellipse(bx, by, 40, 7, 0, 0, Math.PI * 2); g.fill();
        const wax = g.createLinearGradient(bx - 14, 0, bx + 14, 0);
        wax.addColorStop(0, '#8c7f6a'); wax.addColorStop(0.45, lit ? '#f3e7cc' : '#b8ad98'); wax.addColorStop(1, '#7a6e5c');
        g.fillStyle = wax; g.fillRect(bx - 13, by - 74, 26, 74);
        g.fillStyle = 'rgba(255,240,210,0.6)'; g.beginPath(); g.ellipse(bx, by - 74, 13, 3, 0, 0, Math.PI * 2); g.fill();
        g.strokeStyle = '#1a1009'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(bx, by - 74); g.lineTo(bx + 1, by - 82); g.stroke();
        if (!lit) return;
        const now = performance.now();
        const sway = this.breath * 7 + Math.sin(now / 190) * 1.5;
        const fl = 1 + 0.1 * Math.sin(now / 61) + 0.05 * Math.sin(now / 23);
        const fy = by - 80;
        const halo = g.createRadialGradient(bx + sway, fy - 14, 1, bx + sway, fy - 14, 70);
        halo.addColorStop(0, `rgba(255,200,110,${0.55 * light})`); halo.addColorStop(1, 'rgba(255,140,40,0)');
        g.fillStyle = halo; g.beginPath(); g.arc(bx + sway, fy - 14, 70, 0, Math.PI * 2); g.fill();
        const flame = (sc, col) => {
            g.beginPath(); g.moveTo(bx - 6 * sc, fy);
            g.bezierCurveTo(bx - 9 * sc, fy - 14 * sc, bx + sway * 0.5, fy - 22 * sc * fl, bx + sway, fy - 34 * sc * fl);
            g.bezierCurveTo(bx + sway * 0.5 + 4 * sc, fy - 20 * sc * fl, bx + 9 * sc, fy - 12 * sc, bx + 6 * sc, fy);
            g.quadraticCurveTo(bx, fy + 4 * sc, bx - 6 * sc, fy); g.fillStyle = col; g.fill();
        };
        flame(1, 'rgba(255,170,60,0.9)'); flame(0.62, '#ffe7a8'); flame(0.28, 'rgba(120,160,255,0.55)');
    }

    drawCreature(near, light) {
        const g = this.g, R = rand(this.pose);
        // depth from game distance: 100 m = end of the hall, 0 m = right in front of you
        const d = lerp(0.35, FAR * 0.88, Math.pow(this.shownDistance / 100, 1.6));
        const f = this.frame(d);
        const H = (f.b - f.t) * 0.86 * (1 - this.recoil * 0.06);
        const x = this.cx + (R() - 0.5) * (f.r - f.l) * 0.35 * (1 - near);
        const baseY = f.b;
        const fogA = clamp(1.15 - d / FAR, 0.25, 1);
        // floor shadow, thrown back by your candle
        g.save();
        g.globalAlpha = 0.55 * fogA;
        const sh = g.createRadialGradient(x, baseY, 1, x, baseY, H * 0.3);
        sh.addColorStop(0, 'rgba(0,0,0,0.9)'); sh.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = sh; g.beginPath(); g.ellipse(x, baseY - H * 0.01, H * 0.28, H * 0.05, 0, 0, Math.PI * 2); g.fill();
        g.restore();

        const tilt = (R() - 0.5) * 0.9, lean = (R() - 0.5) * 0.3;
        const armUp = R() > 0.55, reachSide = R() > 0.5 ? 1 : -1;
        g.save(); g.translate(x, baseY); g.rotate(lean * 0.25);
        g.globalAlpha = clamp(fogA * (0.5 + 0.6 * light), 0, 1);

        const robe = g.createLinearGradient(0, 0, 0, -H);
        robe.addColorStop(0, `rgb(${68 + 50 * near},${44 + 22 * near},30)`); robe.addColorStop(0.5, '#140e0b'); robe.addColorStop(1, '#060404');
        const skin = g.createLinearGradient(0, 0, 0, -H);
        skin.addColorStop(0, `rgb(${200 + 30 * near},${172 + 20 * near},142)`); skin.addColorStop(1, '#4f453c');

        const shoulderY = -H * 0.74;
        g.strokeStyle = skin; g.lineCap = 'round'; g.lineJoin = 'round';
        for (const s of [-1, 1]) {
            const up = armUp && s === reachSide;
            const ex = s * H * (0.15 + 0.06 * R()), ey = shoulderY + H * (up ? -0.08 : 0.21);
            const hx = s * H * (up ? 0.1 + 0.12 * R() : 0.19 + 0.1 * R()), hy = shoulderY + H * (up ? -0.3 : 0.6);
            g.lineWidth = Math.max(1.2, H * 0.026);
            g.beginPath(); g.moveTo(s * H * 0.06, shoulderY + H * 0.02); g.lineTo(ex, ey); g.lineTo(hx, hy); g.stroke();
            g.lineWidth = Math.max(1.6, H * 0.034); // knobbly joints
            g.beginPath(); g.moveTo(ex, ey); g.lineTo(ex + 0.01, ey + 0.01); g.stroke();
            g.lineWidth = Math.max(0.7, H * 0.008);
            for (let k = -2; k <= 2; k++) {
                const dir = up ? -1 : 1;
                g.beginPath(); g.moveTo(hx, hy);
                g.quadraticCurveTo(hx + k * H * 0.013, hy + dir * H * 0.05, hx + s * H * 0.012 + k * H * 0.024, hy + dir * H * 0.1);
                g.stroke();
            }
        }
        g.fillStyle = robe;
        g.beginPath();
        g.moveTo(-H * 0.075, shoulderY);
        g.bezierCurveTo(-H * 0.13, -H * 0.5, -H * 0.12, -H * 0.25, -H * 0.18, -H * 0.02);
        for (let i = 0; i <= 10; i++) g.lineTo(-H * 0.18 + (i / 10) * H * 0.36, (i % 2 ? -H * 0.06 : 0) + (R() - 0.5) * H * 0.035);
        g.bezierCurveTo(H * 0.12, -H * 0.25, H * 0.13, -H * 0.5, H * 0.075, shoulderY);
        g.closePath(); g.fill();
        // rim light from your candle along the robe's lower edge
        g.strokeStyle = `rgba(255,170,90,${0.18 + 0.3 * near})`; g.lineWidth = Math.max(1, H * 0.006);
        g.beginPath(); g.moveTo(-H * 0.16, -H * 0.05); g.bezierCurveTo(-H * 0.12, -H * 0.3, -H * 0.12, -H * 0.5, -H * 0.075, shoulderY); g.stroke();

        g.save(); g.translate(0, shoulderY - H * 0.06); g.rotate(tilt);
        const hs = 1 + near * 0.5; g.scale(hs, hs);
        g.fillStyle = skin; g.beginPath(); g.ellipse(0, 0, H * 0.04, H * 0.058, 0, 0, Math.PI * 2); g.fill();
        const open = 0.35 + 0.45 * near;
        g.fillStyle = '#040303';
        g.beginPath(); g.moveTo(-H * 0.05, -H * 0.03);
        g.quadraticCurveTo(-H * 0.07, -H * 0.085, 0, -H * 0.08);
        g.quadraticCurveTo(H * 0.07, -H * 0.085, H * 0.05, -H * 0.03);
        g.lineTo(H * 0.065, H * 0.26); g.lineTo(H * 0.025 * open, H * 0.13);
        g.lineTo(H * 0.03 * open, -H * 0.02); g.lineTo(-H * 0.03 * open, -H * 0.02);
        g.lineTo(-H * 0.025 * open, H * 0.13); g.lineTo(-H * 0.065, H * 0.26);
        g.closePath(); g.fill();
        // eye sockets, then two points of candlelight
        g.fillStyle = 'rgba(0,0,0,0.75)';
        for (const s of [-1, 1]) { g.beginPath(); g.ellipse(s * H * 0.016, -H * 0.006, H * 0.011, H * 0.008, 0, 0, Math.PI * 2); g.fill(); }
        g.fillStyle = `rgba(255,${215 - 110 * near},${150 - 110 * near},${0.75 + 0.25 * near})`;
        g.shadowColor = 'rgba(255,180,90,0.9)'; g.shadowBlur = 6 + 12 * near;
        for (const s of [-1, 1]) { g.beginPath(); g.arc(s * H * 0.016, -H * 0.006, Math.max(0.9, H * 0.0055), 0, Math.PI * 2); g.fill(); }
        g.shadowBlur = 0;
        if (near > 0.45) {
            g.fillStyle = '#0b0404';
            g.beginPath(); g.ellipse(0, H * 0.03, H * 0.011, H * 0.008 + (near - 0.45) * H * 0.04, 0, 0, Math.PI * 2); g.fill();
        }
        g.restore();
        g.restore();
    }

    drawScare(cx, cy) {
        const g = this.g, k = this.scare;
        g.fillStyle = `rgba(0,0,0,${0.7 * k})`; g.fillRect(0, 0, this.w, this.h);
        if (this.gentle || this.settled) return;
        const H = Math.max(this.w, this.h) * (1.5 + 0.35 * (1 - k));
        const jx = (Math.random() - 0.5) * 18 * k, jy = (Math.random() - 0.5) * 18 * k;
        g.save(); g.translate(cx + jx, cy + H * 0.02 + jy); g.globalAlpha = k;
        const sk = g.createRadialGradient(0, H * 0.08, 10, 0, 0, H * 0.3);
        sk.addColorStop(0, '#e2d2b6'); sk.addColorStop(0.6, '#8a7a66'); sk.addColorStop(1, '#2a221c');
        g.fillStyle = sk; g.beginPath(); g.ellipse(0, 0, H * 0.2, H * 0.29, 0, 0, Math.PI * 2); g.fill();
        g.fillStyle = '#030202';
        for (const s of [-1, 1]) { g.beginPath(); g.moveTo(s * H * 0.24, -H * 0.36); g.quadraticCurveTo(s * H * 0.04, -H * 0.3, s * H * 0.055, H * 0.42); g.lineTo(s * H * 0.42, H * 0.42); g.closePath(); g.fill(); }
        for (const s of [-1, 1]) {
            g.fillStyle = '#080404'; g.beginPath(); g.ellipse(s * H * 0.062, -H * 0.04, H * 0.036, H * 0.024, s * 0.25, 0, Math.PI * 2); g.fill();
            g.fillStyle = '#fff0c0'; g.shadowColor = '#ffb050'; g.shadowBlur = 30;
            g.beginPath(); g.arc(s * H * 0.062, -H * 0.04, H * 0.007, 0, Math.PI * 2); g.fill(); g.shadowBlur = 0;
        }
        g.fillStyle = '#0a0303'; g.beginPath(); g.ellipse(0, H * 0.135, H * 0.05, H * 0.095, 0, 0, Math.PI * 2); g.fill();
        g.restore();
    }
}

module.exports = { Sound, Scene };
