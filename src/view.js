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
        if (this.ctx) { this.ctx.resume?.(); this.unsilence(); return; }
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
    whoosh() { this.noise(0.35, 500, 1.4, 0.6, 0.3, 0.8); }   // a hand passing close
    snuff() { this.noise(0.18, 1800, 0.7, 0.9, 0.2, 2); }     // a flame pinched out
    silence() { // everything stops, even the room
        if (!this.ctx) return;
        const t = this.ctx.currentTime;
        this.master.gain.cancelScheduledValues(t); this.master.gain.setTargetAtTime(0.0001, t, 0.03);
    }
    unsilence() {
        if (!this.ctx) return;
        const t = this.ctx.currentTime;
        this.master.gain.cancelScheduledValues(t); this.master.gain.setValueAtTime(0.9, t);
    }
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

// ---------------------------------------------------------------- the creature
// Every pose is drawn once onto an offscreen canvas; a frame only blits it.
// Nothing on it is symmetric: one shoulder sags, the eyes sit at different
// heights, no two fingers match, the neck is too long and the hem is torn.
const FAR = 12; // depth of the end wall, in hall units
const FIG = 760;            // figure height in sprite pixels, feet to crown
const FIG_CLOSE = 1250;     // close-up poses are drawn bigger so they stay sharp
const SKIN = ['#a08a6d', '#4a4038'];
const FINGERS = [0.05, 0.11, 0.13, 0.09, 0.07];  // thumb .. little finger, in H
const SPREAD = [-0.95, -0.36, -0.08, 0.2, 0.46];
const smooth = (t) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };

function makeBody(seed) {
    const R = rand(seed);
    return {
        seed,
        fingers: [0, 1].map(() => FINGERS.map((l) => l + (R() - 0.5) * 0.04)),
        notches: Array.from({ length: 14 }, () => [R(), 0.02 + 0.05 * R()]),
        part: R() - 0.5, mouth: 0.75 + 0.5 * R(), lean: (R() - 0.5) * 0.05,
        tilts: [-(0.3 + 0.2 * R()), 0.3 + 0.2 * R()], // the head sits wrong, either way
        lag: 60 + 120 * R(),                           // ms the second eye trails the first
        crop: R() > 0.5 ? 'head' : 'hand',             // what the frame cuts off up close
    };
}

// A tapered bone-and-skin segment with round ends.
function seg(g, x0, y0, x1, y1, w0, w1) {
    const a = Math.atan2(y1 - y0, x1 - x0), nx = -Math.sin(a), ny = Math.cos(a);
    g.beginPath();
    g.moveTo(x0 + nx * w0, y0 + ny * w0); g.lineTo(x1 + nx * w1, y1 + ny * w1);
    g.arc(x1, y1, w1, a + Math.PI / 2, a - Math.PI / 2, true);
    g.lineTo(x0 - nx * w0, y0 - ny * w0);
    g.arc(x0, y0, w0, a - Math.PI / 2, a + Math.PI / 2, true);
    g.fill();
}

// A hand, wrist at 0,0, pointing along +y. Bony palm, three-jointed fingers
// of different lengths, dark nails.
function drawHand(g, H, lens, sc = 1, curl = 0.5, fill = SKIN[0]) {
    const u = H * sc;
    g.fillStyle = fill;
    g.beginPath(); g.moveTo(-0.01 * u, 0); g.lineTo(0.01 * u, 0); g.lineTo(0.02 * u, 0.04 * u);
    g.quadraticCurveTo(0, 0.047 * u, -0.02 * u, 0.038 * u); g.closePath(); g.fill();
    for (let i = 0; i < 5; i++) {
        const thumb = i === 0, len = Math.min(lens[i], 0.095) * u;
        let x = thumb ? -0.012 * u : lerp(-0.017, 0.018, (i - 1) / 3) * u, y = thumb ? 0.012 * u : (0.04 + (i === 2 ? 0.004 : 0)) * u;
        let a = SPREAD[i] * (thumb ? 1 : 0.55);
        let wd = (thumb ? 0.0095 : 0.009) * u;
        const parts = thumb ? [0.55, 0.45] : [0.45, 0.32, 0.23];
        for (let k = 0; k < parts.length; k++) {
            const x1 = x + Math.sin(a) * len * parts[k], y1 = y + Math.cos(a) * len * parts[k];
            g.fillStyle = fill; seg(g, x, y, x1, y1, wd, wd * 0.8);
            g.beginPath(); g.arc(x, y, wd * 1.15, 0, Math.PI * 2); g.fill(); // knuckle
            x = x1; y = y1; wd *= 0.8; a += curl * (0.35 + 0.25 * (i % 2)) * (thumb ? -0.8 : 1);
        }
        g.fillStyle = 'rgba(22,14,10,0.6)'; g.beginPath(); g.ellipse(x, y, wd * 0.9, wd * 1.4, -a, 0, Math.PI * 2); g.fill(); // nail
    }
}

// The head, centred at 0,0. Returns its two eyes (centre and radius).
function drawHead(g, H, P, open = 0) {
    const u = H;
    g.fillStyle = '#040303'; // hair: a long black mass falling past the shoulders
    g.beginPath(); g.moveTo(-0.046 * u, -0.02 * u);
    g.bezierCurveTo(-0.05 * u, -0.072 * u, 0.04 * u, -0.08 * u, 0.047 * u, -0.025 * u);
    g.bezierCurveTo(0.06 * u, 0.08 * u, 0.07 * u, 0.2 * u, 0.055 * u, 0.3 * u);
    g.lineTo(0.03 * u, 0.25 * u); g.lineTo(0.012 * u, 0.31 * u); g.lineTo(-0.02 * u, 0.24 * u); g.lineTo(-0.045 * u, 0.33 * u);
    g.bezierCurveTo(-0.07 * u, 0.2 * u, -0.06 * u, 0.06 * u, -0.046 * u, -0.02 * u);
    g.fill();
    const sk = g.createRadialGradient(0, 0.025 * u, 0.004 * u, 0, 0.005 * u, 0.085 * u);
    sk.addColorStop(0, SKIN[0]); sk.addColorStop(0.55, '#6f5f4e'); sk.addColorStop(1, SKIN[1]);
    g.fillStyle = sk; // a long face, the chin too far down
    g.beginPath(); g.moveTo(0, -0.062 * u);
    g.bezierCurveTo(0.028 * u, -0.062 * u, 0.039 * u, -0.035 * u, 0.036 * u, -0.004 * u);
    g.bezierCurveTo(0.034 * u, 0.03 * u, 0.02 * u, 0.058 * u, 0.006 * u, 0.076 * u);
    g.bezierCurveTo(-0.004 * u, 0.082 * u, -0.014 * u, 0.07 * u, -0.024 * u, 0.05 * u);
    g.bezierCurveTo(-0.036 * u, 0.028 * u, -0.04 * u, 0, -0.038 * u, -0.022 * u);
    g.bezierCurveTo(-0.036 * u, -0.05 * u, -0.022 * u, -0.062 * u, 0, -0.062 * u);
    g.fill();
    g.save(); g.clip(); // blotches and a shadow from the hair line, so it reads as skin, not a mask
    const R = rand(P.seed + 9);
    for (let i = 0; i < 36; i++) { const r = (0.001 + 0.0025 * R()) * u; g.fillStyle = `rgba(${R() < 0.7 ? '30,20,14' : '70,40,30'},${(0.03 + 0.05 * R()) * (open > 0 ? 4 : 1)})`; g.beginPath(); g.ellipse((R() - 0.5) * 0.08 * u, (R() - 0.45) * 0.13 * u, r, r * 0.6, R() * 3, 0, Math.PI * 2); g.fill(); }
    const top = g.createLinearGradient(0, -0.065 * u, 0, -0.02 * u); top.addColorStop(0, 'rgba(0,0,0,0.7)'); top.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = top; g.fillRect(-0.05 * u, -0.07 * u, 0.1 * u, 0.06 * u);
    g.restore();
    for (const s of [-1, 1]) { // hollow cheeks, one deeper than the other
        g.fillStyle = `rgba(20,12,8,${s < 0 ? 0.24 : 0.38})`;
        g.beginPath(); g.ellipse(s * 0.024 * u, (s < 0 ? 0.028 : 0.034) * u, 0.008 * u, 0.017 * u, s * 0.2, 0, Math.PI * 2); g.fill();
    }
    const eyes = [{ x: -0.017 * u, y: -0.008 * u, r: 0.0055 * u }, { x: 0.014 * u, y: 0.004 * u, r: 0.0032 * u }];
    const shape = [[2.4, 1.4, 0.35], [1.7, 1.9, -0.2]]; // no two sockets alike
    g.fillStyle = 'rgba(5,3,3,0.95)'; // deep, uneven sockets
    eyes.forEach((e, i) => {
        const [sx, sy, rot] = shape[i];
        g.beginPath(); g.ellipse(e.x, e.y, e.r * sx, e.r * sy, rot, 0, Math.PI * 2); g.fill();
        g.globalAlpha = 0.55; g.beginPath(); g.ellipse(e.x + 0.45 * e.r, e.y + 0.4 * e.r, e.r * 1.3, e.r, -0.3, 0, Math.PI * 2); g.fill(); g.globalAlpha = 1; // the socket sags
    });
    g.strokeStyle = 'rgba(20,12,8,0.45)'; g.lineWidth = Math.max(1, 0.002 * u); g.lineCap = 'round'; // a nose, mostly shadow
    g.beginPath(); g.moveTo(-0.001 * u, 0.004 * u); g.quadraticCurveTo(0.005 * u, 0.016 * u, 0.002 * u, 0.024 * u); g.stroke();
    g.fillStyle = 'rgba(8,4,4,0.8)';
    for (const nx of [-0.0035, 0.0045]) { g.beginPath(); g.ellipse(nx * u, 0.026 * u, 0.0018 * u, 0.0011 * u, 0.3, 0, Math.PI * 2); g.fill(); }
    g.fillStyle = '#070303'; // the mouth hangs open, longer than a mouth should
    g.beginPath(); g.ellipse((0.002 + 0.004 * P.part) * u, 0.044 * u, 0.0045 * u, Math.min(open > 0 ? 0.03 : 0.026, 0.016 * P.mouth * (1 + 2.2 * open)) * u, 0.05 + 0.4 * P.part, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#040303'; // hair over the face, more on one side
    const pl = -0.021 + 0.008 * P.part;
    g.beginPath(); g.moveTo(-0.004 * u, -0.064 * u);
    g.bezierCurveTo(-0.03 * u, -0.06 * u, pl * u, -0.02 * u, (pl - 0.004) * u, 0.03 * u);
    g.bezierCurveTo(pl * u, 0.12 * u, -0.03 * u, 0.22 * u, -0.036 * u, 0.3 * u);
    g.lineTo(-0.06 * u, 0.24 * u);
    g.bezierCurveTo(-0.055 * u, 0.1 * u, -0.05 * u, -0.04 * u, -0.004 * u, -0.064 * u);
    g.fill();
    g.beginPath(); g.moveTo(0.006 * u, -0.063 * u);
    g.bezierCurveTo(0.03 * u, -0.06 * u, 0.033 * u, 0, 0.031 * u, 0.04 * u);
    g.bezierCurveTo(0.03 * u, 0.12 * u, 0.04 * u, 0.2 * u, 0.045 * u, 0.27 * u);
    g.lineTo(0.06 * u, 0.2 * u);
    g.bezierCurveTo(0.055 * u, 0.05 * u, 0.05 * u, -0.05 * u, 0.006 * u, -0.063 * u);
    g.fill();
    const Rh = rand(P.seed + 17); // loose strands across the forehead and cheek break the oval
    g.lineCap = 'round';
    for (let i = 0; i < 9; i++) { // two of them cross the left socket
        g.strokeStyle = `rgba(4,3,3,${0.35 + 0.55 * Rh()})`;
        const x0 = (i < 2 ? -0.022 + 0.008 * i : -0.03 + 0.055 * Rh()) * u, len = (0.06 + 0.05 * Rh()) * u, bend = (Rh() - 0.5) * 0.03 * u;
        g.lineWidth = Math.min((0.004 + 0.004 * Rh()) * u, 7);
        g.beginPath(); g.moveTo(x0, -0.058 * u); g.quadraticCurveTo(x0 + bend, -0.058 * u + len * 0.5, x0 + bend * 0.4, -0.058 * u + len); g.stroke();
    }
    return eyes;
}

// One pose onto its own canvas. arms = [left, right]: 'hang' | 'reach' | 'raised' | null.
function buildPose(P, arms, tilt, fig) {
    const u = fig, wide = arms.includes('reach') ? 1.25 : 0.8;
    const W = Math.ceil(u * wide), Hc = Math.ceil(u * 1.17), oy = Hc - Math.ceil(u * 0.02), ox = W / 2;
    const c = document.createElement('canvas'); c.width = W; c.height = Hc;
    const g = c.getContext('2d'); g.translate(ox, oy);
    const shY = -0.72 * u, shR = -0.685 * u; // the right shoulder sags
    const rg = g.createLinearGradient(0, 0, 0, -u), close = fig === FIG_CLOSE;
    rg.addColorStop(0, close ? '#17100b' : '#24180f'); rg.addColorStop(0.3, close ? '#0d0906' : '#17100b'); rg.addColorStop(1, close ? '#030202' : '#050403');
    const Rj = rand(P.seed + 29), j = () => (Rj() - 0.5) * 0.06 * u; // the silhouette is never a clean triangle
    g.fillStyle = rg; g.beginPath(); // robe
    g.moveTo(-0.02 * u, shY - 0.035 * u);
    g.quadraticCurveTo(-0.08 * u, shY - 0.012 * u, -0.1 * u, shY + 0.01 * u);
    g.bezierCurveTo(-0.14 * u + j(), -0.45 * u, -0.16 * u + j(), -0.2 * u, -0.23 * u, 0);
    for (let i = 1; i < 14; i++) g.lineTo((-0.23 + 0.46 * i / 14) * u, -(i % 2 ? 0.012 : 0) * u);
    g.lineTo(0.23 * u, 0);
    g.bezierCurveTo(0.16 * u + j(), -0.2 * u, 0.14 * u + j(), -0.45 * u, 0.1 * u, shR + 0.01 * u);
    g.quadraticCurveTo(0.08 * u, shR - 0.012 * u, 0.02 * u, shY - 0.035 * u);
    g.closePath(); g.fill();
    g.save(); g.clip(); // your candle lights the hem from below
    const rim = g.createLinearGradient(0, -0.18 * u, 0, 0); rim.addColorStop(0, 'rgba(255,170,90,0)'); rim.addColorStop(1, 'rgba(255,170,90,0.1)');
    g.fillStyle = rim; g.fillRect(-0.3 * u, -0.18 * u, 0.6 * u, 0.19 * u); g.restore();
    for (let i = 0; i < 7; i++) { // folds, none of them even
        const fx = (Rj() - 0.5) * 0.16;
        g.strokeStyle = `rgba(0,0,0,${0.18 + 0.32 * Rj()})`; g.lineWidth = (0.003 + 0.006 * Rj()) * u;
        g.beginPath(); g.moveTo(fx * 0.6 * u, shY + (0.03 + 0.08 * Rj()) * u); g.quadraticCurveTo((fx * 1.6 + (Rj() - 0.5) * 0.04) * u, -0.35 * u, fx * 2.4 * u, -0.02 * u); g.stroke();
    }
    // the hem rots: torn notches, then moth-eaten holes, thicker toward the floor
    const R = rand(P.seed * 7 + 3);
    g.save(); g.globalCompositeOperation = 'destination-out'; g.fillStyle = '#000';
    for (const [p, dep] of P.notches) {
        const x = (-0.22 + 0.44 * p) * u, w = (0.008 + 0.018 * R()) * u;
        g.beginPath(); g.moveTo(x - w, 2); g.lineTo(x + (R() - 0.5) * w, -dep * u); g.lineTo(x + w, 2); g.closePath(); g.fill();
    }
    for (let i = 0; i < 320; i++) {
        const y = -Math.pow(R(), 2.4) * 0.16 * u, x = (R() - 0.5) * 0.48 * u;
        g.globalAlpha = 0.5 + 0.5 * R();
        g.beginPath(); g.arc(x, y, (0.5 + 3 * R()) * (u / 760) * (1 + y / (0.16 * u)), 0, Math.PI * 2); g.fill();
    }
    g.restore();
    // arms: too long (upper 0.28 H, forearm 0.34 H), knobbly at the elbow
    arms.forEach((kind, i) => {
        if (!kind) return;
        const s = i ? 1 : -1, S = [s * 0.095 * u, (s > 0 ? shR : shY) + 0.01 * u];
        const E = kind === 'hang' ? [S[0] + s * 0.07 * u, S[1] + 0.27 * u]
            : kind === 'reach' ? [S[0] + s * 0.2 * u, S[1] + 0.19 * u] : [S[0] + s * 0.2 * u, S[1] + 0.12 * u];
        const Wr = kind === 'hang' ? [E[0] - s * 0.015 * u, E[1] + 0.338 * u]
            : kind === 'reach' ? [E[0] + s * 0.2 * u, E[1] + 0.17 * u] : [E[0] - s * 0.06 * u, E[1] - 0.32 * u];
        const lit = g.createLinearGradient(0, -0.78 * u, 0, -0.05 * u); // dark at the shoulder, candlelit toward the floor
        lit.addColorStop(0, '#2e2620'); lit.addColorStop(1, '#857763');
        for (const [col, k] of [['#0e0b09', 1.3], [lit, 1]]) {
            g.fillStyle = col;
            seg(g, S[0], S[1], E[0], E[1], 0.023 * u * k, 0.014 * u * k);
            seg(g, E[0], E[1], Wr[0], Wr[1], 0.017 * u * k, 0.01 * u * k);
        }
        g.fillStyle = 'rgba(14,11,9,0.95)'; seg(g, S[0], S[1], lerp(S[0], E[0], 0.9), lerp(S[1], E[1], 0.9), 0.038 * u, 0.026 * u); // sleeve
        g.save(); g.translate(Wr[0], Wr[1]); g.rotate(Math.atan2(Wr[1] - E[1], Wr[0] - E[0]) - Math.PI / 2);
        if (s < 0) g.scale(-1, 1);
        drawHand(g, u, P.fingers[i], 1, kind === 'reach' ? 0.75 : 0.35, '#857663');
        g.restore();
    });
    // neck, then the head on it at the wrong angle
    const hx = Math.sin(tilt) * 0.02 * u + P.lean * u, hy = -0.9 * u;
    const nx = hx - Math.sin(tilt) * 0.05 * u, ny = hy + Math.cos(tilt) * 0.05 * u;
    g.strokeStyle = '#6a5d50'; g.lineWidth = 0.022 * u;
    g.beginPath(); g.moveTo(0.004 * u, shY - 0.02 * u); g.quadraticCurveTo(hx * 0.3 - 0.01 * u, (shY + ny) / 2, nx, ny); g.stroke();
    g.save(); g.translate(hx, hy); g.rotate(tilt);
    const local = drawHead(g, fig === FIG_CLOSE ? u * 1.4 : u, P); // up close the head looms larger
    g.restore();
    const cs = Math.cos(tilt), sn = Math.sin(tilt);
    const eyes = local.map((e) => ({ x: hx + e.x * cs - e.y * sn, y: hy + e.x * sn + e.y * cs, r: e.r }));
    return { c, ox, oy, fig: u, eyes };
}

// ---------------------------------------------------------------- scene
// Bodies: 0 arms hang, 1 one arm reaches (peeks round doorframes), 2 one arm
// raised by the face, 3 close-up with the near arm drawn live and bigger.
const ARMS = [['hang', 'hang'], ['raised', 'hang'], ['hang', 'raised'], [null, null]];

class Scene {
    constructor(canvas) {
        this.c = canvas; this.g = canvas.getContext('2d');
        this.breath = 0;          // -1..1 from the chest trace
        this.beatFlash = 0;       // decays after each heartbeat
        this.lid = 0;             // eyelid shutter, ms left
        this.recoil = 0;          // flinch after a smile
        this.shownDistance = 100;
        this.candle = 0;          // 0..2 lit during calibration
        this.dawn = 0;
        this.settled = false; this.gentle = false;
        this.grain = this.makeGrain();
        this.bodies = [11, 23, 37, 53].map(makeBody);
        this.poses = this.bodies.map((P, i) => P.tilts.map((t) => buildPose(P, ARMS[i], t, i === 3 ? FIG_CLOSE : FIG)));
        this.glow = this.sprite(64, [[0, 'rgba(255,246,228,1)'], [0.12, 'rgba(255,207,154,0.95)'], [0.3, 'rgba(255,160,80,0.32)'], [1, 'rgba(255,120,40,0)']]);
        this.shadowSpr = this.sprite(128, [[0, 'rgba(0,0,0,0.62)'], [0.6, 'rgba(0,0,0,0.3)'], [1, 'rgba(0,0,0,0)']]);
        this.reset();
        this.resize();
        window.addEventListener('resize', () => this.resize());
    }

    // Fresh round: the hall, the creature's staging and the candle start over.
    reset() {
        this.capT = null; this.settled = false; this.dawn = 0; this.shownDistance = 100;
        this.lid = 0; this.pendingPose = false; this.hold = false; this.lastKind = null;
        this.shakeAmp = 0; this.shakeT = 0;
        this.gutter = 0; this.recover = 0; this.gutterClock = this.gutterGap(100); this.secondGutter = false;
        const R = Math.random, sd = () => (R() < 0.5 ? -1 : 1);
        this.pz = { body: (R() * 3) | 0, tilt: R() < 0.5 ? 0 : 1, side: sd(), armFirst: false };
        this.mods = { next: (R() * 5) | 0, gap: 0, pic: 0, shift: 0, knob: 1, endW: 0, gapSide: sd(), picSide: sd(), shiftSide: sd(), knobSide: sd() };
        this.eyes = [];
    }

    sprite(n, stops) { // a radial blob drawn once
        const c = document.createElement('canvas'); c.width = c.height = n;
        const g = c.getContext('2d'), gr = g.createRadialGradient(n / 2, n / 2, 0, n / 2, n / 2, n / 2);
        for (const [o, col] of stops) gr.addColorStop(o, col);
        g.fillStyle = gr; g.fillRect(0, 0, n, n);
        return c;
    }

    resize() {
        const r = 1; // big canvases at 2x cost more than they show
        this.w = this.c.clientWidth; this.h = this.c.clientHeight;
        this.c.width = Math.round(this.w * r); this.c.height = Math.round(this.h * r);
        this.g.setTransform(r, 0, 0, r, 0, 0);
        this.r = r;
        this.cx = this.w / 2; this.cy = this.h * 0.44;
        this.hall = this.buildHall(); this.vign = null; this.grainPat = null;
        const pg = this.g.createRadialGradient(0, 0, 0, 0, 0, 1); // unit pool, scaled per use
        pg.addColorStop(0, 'rgba(255,154,60,1)'); pg.addColorStop(0.45, 'rgba(255,140,50,0.45)'); pg.addColorStop(1, 'rgba(255,120,40,0)');
        this.poolGrad = pg;
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

    // The hall is drawn once, then darkened per frame. Warm near you, cold and black far away.
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
            // portraits between doors: a pale face in each, barely there
            for (const d of [2.1, 4.6]) {
                const pts = this.picture(d, ex);
                poly(pts, '#0d0907', 'rgba(170,130,60,0.45)');
                const mx = (pts[0][0] + pts[1][0]) / 2, my = (pts[0][1] + pts[3][1] + pts[1][1] + pts[2][1]) / 4;
                const pw = Math.abs(pts[1][0] - pts[0][0]), ph = pts[3][1] - pts[0][1];
                g.fillStyle = 'rgba(150,128,100,0.3)';
                g.beginPath(); g.ellipse(mx, my - ph * 0.06, pw * 0.16, ph * 0.22, 0, 0, Math.PI * 2); g.fill();
                g.beginPath(); g.ellipse(mx, my + ph * 0.42, pw * 0.34, ph * 0.22, 0, Math.PI, Math.PI * 2); g.fill();
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
        this.endDoor = { x: this.cx - dw / 2, y: far.b - dh, w: dw, h: dh };
        g.fillStyle = '#030303'; g.fillRect(this.cx - dw / 2, far.b - dh, dw, dh);
        g.strokeStyle = 'rgba(150,110,60,0.35)'; g.strokeRect(this.cx - dw / 2, far.b - dh, dw, dh);
        // cold depth: the far end of the hall goes blue-black (baked; it never changes)
        const fog = g.createRadialGradient(this.cx, this.cy, 2, this.cx, this.cy, this.w * 0.5);
        fog.addColorStop(0, 'rgba(4,8,14,0.96)'); fog.addColorStop(0.45, 'rgba(8,14,22,0.55)'); fog.addColorStop(1, 'rgba(8,14,22,0)');
        g.fillStyle = fog; g.fillRect(0, 0, this.w, this.h);
        return c;
        function lerp2(a, b, m) { return { t: lerp(a.t, b.t, m), b: lerp(a.b, b.b, m) }; }
    }

    picture(d, ex) {
        const a = this.frame(d), b = this.frame(d + 0.45 + d * 0.05);
        const y0 = (f) => lerp(f.t, f.b, 0.25), y1 = (f) => lerp(f.t, f.b, 0.47);
        return [[a[ex], y0(a)], [b[ex], y0(b)], [b[ex], y1(b)], [a[ex], y1(a)]];
    }

    // One small thing in the hall is different every time you open your eyes.
    mutateHall() {
        const m = this.mods;
        for (let tries = 0; tries < 5; tries++) {
            const i = m.next++ % 5;
            if (i === 0 && m.gap < 16) { m.gap += 4; return; }
            if (i === 1 && m.pic < 0.7) { m.pic = Math.min(0.7, m.pic + 0.18); return; }
            if (i === 2 && m.shift < 12) { m.shift += 3; return; }
            if (i === 3 && m.knob > 0) { m.knob = 0; return; }
            if (i === 4 && m.endW < 15) { m.endW += 3; return; }
        }
    }

    drawMods() {
        const g = this.g, m = this.mods, X = (s) => (s < 0 ? 'l' : 'r');
        const poly = (pts) => { g.beginPath(); g.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]); g.closePath(); };
        if (m.gap) { // a door further down has opened wider on black
            const ex = X(m.gapSide), b = this.frame(3.1 + 0.55 + 3.1 * 0.06), x0 = b[ex] + m.gapSide * m.gap, top = lerp(b.t, b.b, 0.18);
            g.fillStyle = '#000'; poly([[x0, top], [b[ex], top], [b[ex], b.b], [x0, b.b]]); g.fill();
        }
        if (m.pic) { g.fillStyle = `rgba(0,0,0,${m.pic})`; poly(this.picture(2.1, X(m.picSide))); g.fill(); }
        if (m.shift) { // a portrait has slipped on its nail
            const pts = this.picture(4.6, X(m.shiftSide)).map(([x, y]) => [x, y + m.shift]);
            g.fillStyle = '#0d0907'; g.strokeStyle = 'rgba(170,130,60,0.45)'; g.lineWidth = 1; poly(pts); g.fill(); g.stroke();
        }
        if (!m.knob) { // the nearest door's knob no longer catches the light
            const s = m.knobSide, ex = X(s), a = this.frame(1.2), b = this.frame(1.2 + 0.55 + 1.2 * 0.06), top = lerp(a.t, a.b, 0.18);
            g.fillStyle = '#1c120b'; g.beginPath();
            g.arc(lerp(a[ex], b[ex], s < 0 ? 0.8 : 0.2), lerp(top, a.b, 0.55), Math.max(1, 3 * a.s) + 1.5, 0, Math.PI * 2); g.fill();
        }
        if (m.endW) { const D = this.endDoor; g.fillStyle = '#000'; g.fillRect(D.x - m.endW, D.y, m.endW, D.h); g.fillRect(D.x + D.w, D.y, m.endW, D.h); }
    }

    // A blink happened. Decide now how it will look when the eyes reopen.
    moved(closeness) {
        const to = 100 * (1 - closeness);
        if (to <= 0) { this.shownDistance = 0; this.hold = false; this.pendingPose = false; this.lid = 0; return; } // the capture takes over
        this.lidLen = this.live ? 170 : 260; this.lid = this.lidLen; this.pendingPose = true;
        const r = Math.random();
        let kind = r < 0.42 ? 'advance' : r < 0.62 ? 'lateral' : r < 0.8 ? 'head' : 'arm';
        if (to <= 0 || (kind === 'head' && this.lastKind === 'head')) kind = 'advance';
        this.pendingKind = this.lastKind = kind;
        this.shakeAmp = to < 25 ? (25 - to) / 25 * 10 : 0; this.shakeT = this.shakeAmp ? 180 : 0;
    }

    applyPose(dist) {
        const p = this.pz, kind = this.pendingKind;
        this.mutateHall();
        if (kind === 'head') { p.tilt ^= 1; this.hold = true; return; } // it only turned its head
        this.hold = false; this.shownDistance = dist;
        if (kind === 'lateral') p.side = -p.side;
        p.armFirst = kind === 'arm';
        p.body = (Math.random() * 3) | 0;
        p.tilt = Math.random() < 0.5 ? 0 : 1;
    }

    startCapture() { this.capT = 0; this.eyes = []; }

    gutterGap(dist) {
        const [a, b] = dist > 60 ? [9000, 14000] : dist >= 25 ? [6000, 10000] : dist >= 10 ? [3000, 5500] : [1800, 3200];
        return a + (b - a) * Math.random();
    }

    // The candle gutters: 100-200 ms of near-black, more often the closer it is.
    updateGutter(dt, near) {
        if (this.gutter > 0) {
            this.gutter -= dt;
            if (this.gutter <= 0) this.recover = 80;
            return;
        }
        if (this.recover > 0) this.recover -= dt;
        this.gutterClock -= dt;
        if (this.gutterClock > 0) return;
        if (this.secondGutter) { this.gutter = 80; this.secondGutter = false; this.gutterClock = this.gutterGap(this.shownDistance); return; }
        this.gutter = lerp(100, 200, near);
        if (this.shownDistance < 25 && Math.random() < 0.25) { this.secondGutter = true; this.gutterClock = 120 + this.gutter; } else this.gutterClock = this.gutterGap(this.shownDistance);
    }

    draw(dt, state) {
        const { g, w, h, cx } = this;
        const now = performance.now();
        this.beatFlash = Math.max(0, this.beatFlash - dt / 450);
        this.recoil = Math.max(0, this.recoil - dt / 700);
        this.shakeT = Math.max(0, this.shakeT - dt);
        if (this.capT != null) this.capT += dt;
        if (this.lid > 0) {
            this.lid = Math.max(0, this.lid - dt);
            if (this.pendingPose && this.lid < this.lidLen - (this.live ? 0 : 100)) { this.applyPose(state.distance); this.pendingPose = false; }
        } else if (!this.hold || state.distance > this.shownDistance) {
            if (state.distance > this.shownDistance) this.hold = false;
            this.shownDistance += (state.distance - this.shownDistance) * Math.min(1, dt / 150);
        }
        if (state.phase === 'dawn') this.dawn = Math.min(1, this.dawn + dt / 3000);

        const near = 1 - this.shownDistance / 100;
        if (state.phase === 'hunt' && this.capT == null) this.updateGutter(dt, near);
        else { this.gutter = 0; this.recover = 0; }
        const gut = this.gutter > 0 ? 1 : this.recover > 0 ? this.recover / 80 : 0;
        const cap = this.capT;
        const flame = cap == null ? 1 : clamp(1 - (cap - 220) / 40, 0, 1); // pinched out at 220 ms
        const flick = 0.82 + 0.1 * Math.sin(now / 83) * Math.sin(now / 31) + 0.06 * Math.sin(now / 7) + 0.07 * this.breath;
        const lit = state.phase === 'calibrate' ? [0.15, 0.55, 1][clamp(this.candle | 0, 0, 2)] : 1;
        const light = lit * flick * (1 - 0.45 * gut) * flame;

        g.save();
        if (this.shakeT > 0) { const s = this.shakeAmp * this.shakeT / 180; g.translate((Math.random() - 0.5) * s, (Math.random() - 0.5) * s); }
        g.translate(0, this.breath * 2); // the hall sways a little with your breathing
        g.fillStyle = '#000'; g.fillRect(-20, -20, w + 40, h + 40);
        const amb = clamp(0.62 - 0.22 * light, 0.35, 0.92) + (state.phase === 'calibrate' ? 0.3 * (1 - lit) : 0);
        this.hallAlpha = clamp(1 - amb, 0.03, 1);
        g.globalAlpha = this.hallAlpha; g.drawImage(this.hall, 0, 0, w, h); this.drawMods(); g.globalAlpha = 1;

        this.eyes = [];
        if (state.phase !== 'calibrate' && !this.settled) this.drawCreature(1, near);

        // candle light: everything outside its reach falls into black
        const by = h - 30, reach = Math.max(w, h) * (0.55 + 0.25 * light) * (1 - 0.25 * near);
        const dark = g.createRadialGradient(cx, by - 60, reach * 0.05, cx, by - 140, reach);
        dark.addColorStop(0, 'rgba(0,0,0,0)'); dark.addColorStop(0.35, `rgba(0,0,0,${0.35 - 0.2 * light})`); dark.addColorStop(1, 'rgba(0,0,0,0.98)');
        g.fillStyle = dark; g.fillRect(-20, -20, w + 40, h + 40);
        g.globalCompositeOperation = 'lighter';
        g.fillStyle = this.poolGrad; // the light pools on the floor and reaches up the hall toward it
        for (const [px, py, rx, ry, a] of [[cx, 0.86 * h, 0.46 * w, 0.16 * h, 0.32], [cx, 0.75 * h, 0.16 * w, 0.17 * h, 0.12]]) {
            g.save(); g.translate(px, py); g.scale(rx, ry); g.globalAlpha = a * light; g.fillRect(-1, -1, 2, 2); g.restore();
        }
        g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
        if (gut > 0) { g.fillStyle = `rgba(0,0,0,${0.3 * gut})`; g.fillRect(-20, -20, w + 40, h + 40); }
        this.drawCandle(cx, by, light, (state.phase === 'calibrate' ? this.candle > 0 : true) && flame > 0, (1 - 0.7 * gut) * (0.3 + 0.7 * flame), gut);
        this.drawEyes(now, gut);
        g.restore();

        // heartbeat: red pressure at the edges on every detected beat
        if (this.beatFlash > 0 && cap == null) {
            const bg = g.createRadialGradient(cx, h * 0.45, Math.min(w, h) * 0.25, cx, h * 0.45, Math.max(w, h) * 0.72);
            bg.addColorStop(0, 'rgba(120,0,0,0)'); bg.addColorStop(1, `rgba(150,0,0,${(0.12 + 0.5 * near) * this.beatFlash})`);
            g.fillStyle = bg; g.fillRect(0, 0, w, h);
        }
        if (this.dawn > 0) {
            const dg = g.createLinearGradient(0, 0, 0, h);
            dg.addColorStop(0, `rgba(220,200,170,${0.75 * this.dawn})`); dg.addColorStop(1, `rgba(160,120,90,${0.5 * this.dawn})`);
            g.fillStyle = dg; g.fillRect(0, 0, w, h);
        }
        if (cap != null) this.drawCapture(cap, by);
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

    drawCandle(bx, by, light, lit, flameK = 1, dim = 0) {
        const g = this.g;
        // holder and wax, lit from the flame
        g.fillStyle = '#2a1a0e'; g.beginPath(); g.ellipse(bx, by + 4, 46, 9, 0, 0, Math.PI * 2); g.fill();
        g.fillStyle = '#4a3420'; g.beginPath(); g.ellipse(bx, by, 40, 7, 0, 0, Math.PI * 2); g.fill();
        const wax = g.createLinearGradient(bx - 14, 0, bx + 14, 0);
        wax.addColorStop(0, '#8c7f6a'); wax.addColorStop(0.45, lit ? '#f3e7cc' : '#b8ad98'); wax.addColorStop(1, '#7a6e5c');
        g.fillStyle = wax; g.fillRect(bx - 13, by - 74, 26, 74);
        if (dim > 0) { g.fillStyle = `rgba(0,0,0,${0.55 * dim})`; g.fillRect(bx - 13, by - 74, 26, 74); }
        g.fillStyle = 'rgba(255,240,210,0.6)'; g.beginPath(); g.ellipse(bx, by - 74, 13, 3, 0, 0, Math.PI * 2); g.fill();
        g.strokeStyle = '#1a1009'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(bx, by - 74); g.lineTo(bx + 1, by - 82); g.stroke();
        if (!lit) return;
        const now = performance.now();
        // near the end the flame leans away from it
        const sway = this.breath * 7 + Math.sin(now / 190) * 1.5 - this.pz.side * 8 * Math.max(0, 0.6 - this.shownDistance / 100);
        const fl = (1 + 0.1 * Math.sin(now / 61) + 0.05 * Math.sin(now / 23)) * flameK;
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

    // Blit a pose; returns where its eyes landed on screen.
    blit(sp, x, baseY, H, mirror, alpha) {
        const g = this.g, s = H / sp.fig;
        g.save(); g.globalAlpha = clamp(alpha, 0, 1); g.translate(x, baseY); g.scale(mirror * s, s);
        g.drawImage(sp.c, -sp.ox, -sp.oy); g.restore();
        return sp.eyes.map((e) => ({ x: x + mirror * e.x * s, y: baseY + e.y * s, r: Math.max(0.9, e.r * s) }));
    }

    // Its shadow runs away from your candle, down the hall.
    drawShadow(x, baseY, H, near, alpha) {
        const g = this.g, D = this.endDoor;
        const ang = Math.atan2(D.y + D.h - baseY, this.cx - x);
        const L = H * lerp(0.7, 1.4, near), W = H * 0.28;
        g.save(); g.translate(x, baseY); g.rotate(ang); g.globalAlpha = alpha;
        g.drawImage(this.shadowSpr, -L * 0.1, -W / 2, L, W); g.restore();
    }

    drawCreature(bodyK, near) {
        const g = this.g, dist = this.shownDistance, p = this.pz, rec = 1 - this.recoil * 0.06;
        const body = dist < 25 ? 3 : p.body === 3 ? 0 : p.body;
        const sp = this.poses[body][p.tilt], P = this.bodies[body];
        this.eyeLag = P.lag;
        if (dist > 60) {
            // far: in the black end doorway, only a head and one shoulder lean out
            const D = this.endDoor, t = smooth((100 - dist) / 40);
            const H = D.h * 0.915 * rec, baseY = D.y + D.h;
            const x = D.x + D.w / 2 + p.side * D.w * lerp(0.28, p.armFirst ? 0.24 : 0.14, t);
            g.save(); g.beginPath(); g.rect(D.x, D.y, D.w, D.h); g.clip();
            const eyes = this.blit(sp, x, baseY, H, -p.side, 0.78 * bodyK);
            const sy = baseY - 0.72 * H;
            const down = g.createLinearGradient(0, sy + 0.06 * H, 0, sy + 0.19 * H);
            down.addColorStop(0, 'rgba(3,3,3,0)'); down.addColorStop(1, 'rgba(3,3,3,1)');
            g.fillStyle = down; g.fillRect(D.x, sy, D.w, baseY - sy);
            const sx = x - p.side * 0.03 * H, side = g.createLinearGradient(sx, 0, sx - p.side * 0.08 * H, 0);
            side.addColorStop(0, 'rgba(3,3,3,0)'); side.addColorStop(1, 'rgba(3,3,3,1)');
            g.fillStyle = side; g.fillRect(D.x, sy - 0.04 * H, D.w, baseY - sy);
            g.restore();
            this.eyes = eyes.filter((e) => e.x > D.x && e.x < D.x + D.w);
            return;
        }
        if (dist >= 25) {
            // middle: half behind the frame of a side door, one arm out first
            const doorD = dist > 42 ? 3.1 : 1.2;
            const tt = Math.max(0.35, p.armFirst ? 0 : smooth(dist > 42 ? (60 - dist) / 18 : (42 - dist) / 17));
            const f = this.frame(doorD + 0.3), fd = this.frame(doorD), ex = p.side < 0 ? 'l' : 'r', xj = fd[ex];
            const H = (f.b - f.t) * 0.9 * rec, baseY = f.b, x = xj + p.side * H * lerp(-0.01, -0.09, tt);
            this.drawShadow(x, baseY, H, near, 0.8 * bodyK);
            const eyes = this.blit(sp, x, baseY, H, -p.side, 0.95 * bodyK);
            const nr = this.frame(0); // the wall nearer you than the door covers whatever is behind it
            g.save(); g.beginPath();
            g.moveTo(nr[ex] + p.side * 40, nr.t - 40); g.lineTo(fd[ex], fd.t); g.lineTo(fd[ex], fd.b); g.lineTo(nr[ex] + p.side * 40, nr.b + 40);
            g.closePath(); g.clip();
            g.fillStyle = '#000'; g.fill(); g.globalAlpha = this.hallAlpha; g.drawImage(this.hall, 0, 0, this.w, this.h); this.drawMods(); g.globalAlpha = 1;
            g.restore();
            const jt = lerp(fd.t, fd.b, 0.18), jw = Math.max(3, H * 0.03); // the door jamb it holds on to
            g.fillStyle = '#0a0603'; g.fillRect(p.side < 0 ? xj - jw : xj, jt, jw, fd.b - jt);
            g.strokeStyle = 'rgba(150,110,60,0.28)'; g.lineWidth = 1.5;
            g.beginPath(); g.moveTo(xj, jt); g.lineTo(xj, fd.b); g.stroke();
            this.eyes = eyes.filter((e) => (e.x - xj) * -p.side > 0);
            return;
        }
        // close: too tall for the hall; the crown or the reaching hand leaves the frame
        const t = smooth((25 - dist) / 25), { w, h } = this;
        const baseY = h * 1.03;
        const crown = P.crop === 'head' ? -h * lerp(0.03, 0.12, t) : h * lerp(0.07, 0.01, t);
        const H = (baseY - crown) / 0.962 * rec;
        const x = this.cx + p.side * w * lerp(0.14, 0.05, t);
        this.drawShadow(x, baseY, H, near, 0.7 * bodyK);
        this.eyes = this.blit(sp, x, baseY, H, -p.side, bodyK);
        // the near arm, drawn bigger: it is closer to you than the rest of it
        if (this.capT != null) return;
        const hs = p.side, sx = x + hs * 0.25 * H, sy = h * 0.95; // elbow
        const shx = x + hs * 0.095 * H, shy = baseY - (hs > 0 ? 0.685 : 0.72) * H;
        const wx = x + hs * (P.crop === 'hand' ? 0.3 : 0.22) * H, wy = h * lerp(0.8, 0.66, t);
        const ang = Math.atan2(wy - sy, wx - sx), nx = -Math.sin(ang), ny = Math.cos(ang);
        const w0 = 0.013 * H, w1 = 0.008 * H;
        const arm = g.createLinearGradient(sx, sy, wx, wy); arm.addColorStop(0, '#2e2620'); arm.addColorStop(1, '#6e604f');
        g.save(); g.globalAlpha = bodyK;
        g.fillStyle = '#2e2620'; seg(g, shx, shy, sx, sy, 0.017 * H, 0.013 * H); // upper arm, in shadow
        g.beginPath(); g.arc(sx, sy, 0.016 * H, 0, Math.PI * 2); g.fill(); // elbow
        const ua = Math.atan2(sy - shy, sx - shx), rs = Math.sign((this.cx - shx) * -Math.sin(ua)) || 1; // rim on the side facing the candle
        g.strokeStyle = 'rgba(255,170,90,0.35)'; g.lineWidth = 1.5;
        g.beginPath(); g.moveTo(shx - Math.sin(ua) * 0.017 * H * rs, shy + Math.cos(ua) * 0.017 * H * rs); g.lineTo(sx - Math.sin(ua) * 0.013 * H * rs, sy + Math.cos(ua) * 0.013 * H * rs); g.stroke();
        g.fillStyle = arm; g.beginPath();
        g.moveTo(sx + nx * w0, sy + ny * w0); g.quadraticCurveTo((sx + wx) / 2 + nx * w0 * 0.4, (sy + wy) / 2 + ny * w0 * 0.4, wx + nx * w1, wy + ny * w1);
        g.lineTo(wx - nx * w1, wy - ny * w1); g.quadraticCurveTo((sx + wx) / 2 - nx * w0 * 1.1, (sy + wy) / 2 - ny * w0 * 1.1, sx - nx * w0, sy - ny * w0);
        g.closePath(); g.fill();
        g.translate(wx, wy); g.rotate(ang - Math.PI / 2);
        if (hs < 0) g.scale(-1, 1);
        drawHand(g, H, P.fingers[0], 1.2, 0.3, '#6a5c4b');
        g.restore();
    }

    // Two points of candlelight: they catch only when the flame peaks, one eye a beat behind.
    drawEyes(now, gut) {
        if (!this.eyes.length) return;
        const g = this.g, far = this.shownDistance > 60;
        g.globalCompositeOperation = 'lighter';
        this.eyes.forEach((e, i) => {
            const t = now - (i ? this.eyeLag : 0);
            const peak = smooth((Math.sin(t / 83) * Math.sin(t / 31) - 0.35) / 0.45);
            g.globalAlpha = clamp(Math.max(peak, far ? 0.55 : 0.14, 0.45 * gut), 0, 1);
            const s = e.r * (gut > 0 ? 5 : 10); g.drawImage(this.glow, e.x - s / 2, e.y - s / 2, s, s);
        });
        g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
    }

    // Caught: a hand over the candle, black, silence, then the same face, from below.
    drawCapture(t, by) {
        const g = this.g, { w, h, cx } = this;
        const body = this.shownDistance < 25 ? 3 : this.pz.body, P = this.bodies[body];
        if (t < 260) { // its hand rises out of the dark and closes over the flame
            const k = smooth((t - 50) / 170), ang = Math.atan2(by - 80 - 1.05 * h, cx + 0.12 * w);
            const size = lerp(0.38, 0.58, k) * h, u = size / 0.17;
            g.save(); g.globalCompositeOperation = 'lighter'; g.globalAlpha = 0.5 * (1 - k); // the flame, still burning behind its fingers
            g.drawImage(this.glow, cx - 0.09 * h, by - 80 - 0.09 * h, 0.18 * h, 0.18 * h); g.restore();
            const x = lerp(-0.12 * w, cx, k) - Math.cos(ang) * size * 0.3, y = lerp(1.05 * h, by - 80, k) - Math.sin(ang) * size * 0.3; // the palm lands on the flame
            g.save(); g.translate(x, y); g.rotate(ang - Math.PI / 2);
            const hf = g.createLinearGradient(0, 0, 0, 0.25 * u); hf.addColorStop(0, '#17110c'); hf.addColorStop(1, '#8a755a');
            g.fillStyle = hf; g.beginPath(); // the forearm it arrives on, back out past the bottom edge
            const L = 0.5 * h, w1 = 0.009 * u, w0 = 0.016 * u;
            g.moveTo(-w1, 0.004 * u); g.quadraticCurveTo(-w0 * 0.5, -L / 2, -w0, -L); g.lineTo(w0, -L); g.quadraticCurveTo(w0 * 1.1, -L / 2, w1, 0.004 * u); g.closePath(); g.fill();
            drawHand(g, u, P.fingers[1], 1.7, lerp(0.1, 0.55, k), hf);
            g.restore();
        }
        const black = t < 220 ? 0 : t < 400 ? (t - 220) / 180 : 1;
        if (black > 0) { g.fillStyle = `rgba(0,0,0,${black})`; g.fillRect(0, 0, w, h); }
        if (this.gentle || this.settled || t < 1000 || t >= 1450) return;
        const k = (t - 1000) / 450, e = smooth(k);
        const fh = lerp(0.36, 1.5, e) * h, u = fh / 0.14;
        const x = lerp(0.55 * w, 0.5 * w, e) + (Math.random() - 0.5) * 4 * k, y = lerp(0.7 * h, 0.55 * h, e) + (Math.random() - 0.5) * 4 * k;
        g.save(); g.translate(x, y); g.rotate(P.tilts[this.pz.tilt] * 0.6);
        const eyes = drawHead(g, u, P, k);
        const under = g.createLinearGradient(0, -0.08 * u, 0, 0.08 * u); // lit from below, by nothing
        under.addColorStop(0, 'rgba(0,0,0,0.85)'); under.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = under; g.fillRect(-0.1 * u, -0.09 * u, 0.2 * u, 0.18 * u);
        g.globalCompositeOperation = 'lighter';
        g.globalAlpha = 0.3; // only a pin of light at the back of each socket
        for (const ey of eyes) { const s = Math.max(4, ey.r * 0.6); g.drawImage(this.glow, ey.x + ey.r * 0.4 - s / 2, ey.y - ey.r * 0.3 - s / 2, s, s); }
        g.restore();
    }
}

module.exports = { Sound, Scene };
