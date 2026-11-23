// renderer.js — Don't Blink. Wires the SmartSpectra renderer SDK (pattern
// from Presage's electron-quickstart) to the game engine and the scene.

'use strict';

const {
    SmartSpectraSDK, ProcessingStatus, ValidationCode,
    breathingMetrics, cardioMetrics, faceMetrics,
} = require('@smartspectra/node-sdk/renderer');
const { decodeMetrics } = require('@smartspectra/node-sdk/messages');
const { Game } = require('./engine');
const { SignalReader } = require('./signals');
const { Sound, Scene } = require('./view');

const $ = (id) => document.getElementById(id);

// --- API key: from the main process (env / .env) via the query string, else typed in.
const params = new URLSearchParams(location.search);
let apiKey = params.get('k') || '';
const DEBUG = params.get('d') === '1';
const dbg = { packets: 0, pulse: 0, pulseVals: [], breath: 0, blinks: 0, codes: {}, last: 0 };
if (params.has('k')) history.replaceState(null, '', location.pathname); // don't keep it in the URL
if (!apiKey) $('key-row').hidden = false;

// Camera hints in the game's voice. Chest framing only affects the breathing
// trace (the candle sway), so it is never worth interrupting play for.
const HINTS = {
    [ValidationCode.kChestNotVisible]: 'Sit back a little so your shoulders show.',
    [ValidationCode.kNoFaceFound]: "It can't see your face.",
    [ValidationCode.kMultipleFacesFound]: 'Only one of you can play.',
    [ValidationCode.kFaceNotCentered]: 'Sit in the middle of the camera.',
    [ValidationCode.kFaceTooClose]: 'Lean back a little.',
    [ValidationCode.kFaceTooFar]: 'Come closer to the camera.',
    [ValidationCode.kFaceTooHigh]: 'Lower your camera or sit up less.',
    [ValidationCode.kFaceTooLow]: 'Raise your camera a little.',
    [ValidationCode.kFaceNotForward]: 'Look straight at the screen.',
    [ValidationCode.kTooDark]: 'Too dark: light your face from the front.',
    [ValidationCode.kTooBright]: 'Too bright behind or on you.',
    [ValidationCode.kExcessiveMotion]: 'Hold still.',
    [ValidationCode.kFrameRateTooLow]: 'The camera is running slowly.',
};
let gotMetrics = false;

const scene = new Scene($('stage'));
const sound = new Sound();
let game = new Game();
let sdk = null;
let mode = null;          // 'live' | 'practice'
let running = false;
let last = performance.now();
const strip = { pulse: [], breath: [] };
let smileNow = 0;
let roundId = 0;          // bumps on every new round or quit, so stale timers do nothing
let stepTimer = null;     // a late footstep, still on its way
let lastStepMissing = false;

// ---------- signal handlers shared by live and practice ----------
const reader = new SignalReader({
    pulse: (bpm) => { game.onPulse(bpm); $('ro-pulse').textContent = Math.round(bpm); },
    blink: () => {
        const was = game.phase;
        if (game.onBlink(game.elapsedMs)) $('ro-blinks').textContent = game.blinks;
        if (was === 'calibrate') scene.candle = Math.min(2, game.calBlinks);
    },
    talking: (t) => game.onTalking(t),
    expression: ({ happy }) => { smileNow = happy; game.onSmile(happy, game.elapsedMs); },
    beat: () => { if (scene.capT != null) return; scene.beatFlash = 1; sound.thump(1 - game.distance / 100); },
    trace: (v) => push(strip.pulse, v),
    breath: (b) => { scene.breath = b; push(strip.breath, b); },
    breathRate: (r) => { $('ro-breath').textContent = Math.round(r); },
});

function push(arr, v) { arr.push(v); if (arr.length > 240) arr.shift(); }

// ---------- live mode ----------
async function startLive() {
    if (!apiKey) apiKey = $('api-key').value.trim();
    if (!apiKey) { $('api-key').focus(); $('api-key').placeholder = 'a Presage API key is needed for live play'; return; }
    mode = 'live';
    gotMetrics = false;
    beginRound();
    sdk = new SmartSpectraSDK({
        apiKey,
        // Breathing metrics need the chest in frame; without them the SDK only
        // needs your face, which is how people sit at a laptop.
        requestedMetrics: [...cardioMetrics, ...faceMetrics],
        enableAccumulatedOutput: false,
        enableTelemetry: $('opt-telemetry').checked,
    });
    sdk.on('metrics', (buf) => {
        gotMetrics = true;
        try {
            const m = decodeMetrics(buf);
            if (DEBUG) {
                dbg.packets++;
                const pr = m.cardio?.pulseRate || [];
                dbg.pulse += pr.length; pr.slice(-2).forEach((p) => dbg.pulseVals.push(`${Number(p.value).toFixed(1)}@${Number(p.confidence ?? -1).toFixed(2)}`));
                dbg.breath += (m.breathing?.rate || []).length; dbg.blinks += (m.face?.blinking || []).length;
                const now = performance.now();
                if (now - dbg.last > 3000) {
                    dbg.last = now;
                    console.log(`[dont-blink] packets=${dbg.packets} pulseSamples=${dbg.pulse} last=${dbg.pulseVals.slice(-4).join(',')} breathSamples=${dbg.breath} blinkSamples=${dbg.blinks} cardioKeys=${Object.keys(m.cardio || {}).join('|')} codes=${JSON.stringify(dbg.codes)}`);
                }
            }
            reader.feed(m);
        } catch (e) { console.error('[dont-blink] decode failed', e); }
    });
    sdk.on('validationStatus', (code, _ts, hint) => {
        $('hint').textContent = HINTS[code] || '';
        if (DEBUG) dbg.codes[code] = (dbg.codes[code] || 0) + 1;
    });
    sdk.on('processingStatus', (s) => { if (s === ProcessingStatus.kError) showError('The SDK stopped. Check the light and your key, then try again.'); });
    sdk.on('error', (code, message) => (DEBUG && console.log(`[dont-blink] sdk error ${code} ${message}`), showError)(`SmartSpectra error ${code}: ${message}`));
    sdk.on('streamAvailable', (stream) => { $('preview').srcObject = stream; $('preview').play().catch(() => {}); });
    try { await sdk.start(); } catch (err) { showError(err.message || String(err)); }
}

async function stopLive() {
    const s = sdk; sdk = null;
    $('preview').srcObject = null;
    if (!s) return;
    try { await s.stop(); } catch { /* already stopped */ }
    try { s.destroy(); } catch { /* already destroyed */ }
}

// ---------- practice mode: simulated signals, clearly labelled ----------
const practice = { pulse: 72, smiling: false, talking: false, t: 0, nextBeat: 0 };
function startPractice() {
    mode = 'practice';
    beginRound();
    practice.pulse = 72; practice.t = 0; practice.nextBeat = 0;
}
function practiceTick(dt) {
    practice.t += dt;
    // a calm, noisy pulse that rises when it is close, like a real one might
    const target = practice.pulse + (1 - game.distance / 100) * 18;
    if (Math.floor(practice.t / 1000) !== Math.floor((practice.t - dt) / 1000)) reader.h.pulse(target + (Math.random() - 0.5) * 2);
    practice.nextBeat -= dt;
    if (practice.nextBeat <= 0) { practice.nextBeat = 60000 / target; reader.h.beat(); }
    const b = Math.sin(practice.t / 700);
    reader.h.breath(b); if (Math.random() < 0.01) reader.h.breathRate(13 + Math.random() * 2);
    push(strip.pulse, Math.max(0, Math.sin((practice.t % (60000 / target)) / (60000 / target) * Math.PI)) ** 3);
    reader.h.expression({ happy: practice.smiling ? 90 : 5 });
    reader.h.talking(practice.talking);
}

window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { quit(); return; }
    if (mode !== 'practice' || !running) return;
    if (e.code === 'Space' && !e.repeat) { e.preventDefault(); reader.h.blink(); }
    if (e.key === 'ArrowUp') practice.pulse = Math.min(150, practice.pulse + 5);
    if (e.key === 'ArrowDown') practice.pulse = Math.max(50, practice.pulse - 5);
    if (e.key === 's' || e.key === 'S') practice.smiling = true;
    if (e.key === 't' || e.key === 'T') practice.talking = true;
});
window.addEventListener('keyup', (e) => {
    if (e.key === 's' || e.key === 'S') practice.smiling = false;
    if (e.key === 't' || e.key === 'T') practice.talking = false;
});

// ---------- round flow ----------
function beginRound() {
    sound.start();
    game = new Game();
    roundId++; clearTimeout(stepTimer); lastStepMissing = false;
    scene.reset();
    scene.candle = 0; scene.gentle = $('opt-gentle').checked; scene.live = mode === 'live'; scene.lidLen = 260;
    $('consent').hidden = true; $('end').hidden = true; $('error').hidden = true;
    $('hud').hidden = false; $('calib').hidden = false;
    $('ro-blinks').textContent = '0'; $('ro-dist').textContent = '100';
    const badge = $('mode-badge');
    badge.textContent = mode === 'live' ? 'LIVE · SmartSpectra' : 'PRACTICE · simulated signals · Space = blink, S = smile, ↑↓ = pulse';
    badge.className = 'badge ' + (mode === 'live' ? 'live' : 'practice');
    $('cam-box').hidden = mode !== 'live';
    $('calib-status').textContent = mode === 'live' ? 'Reading your pulse…' : 'Press Space twice to blink.';
    running = true;
}

function handleEvents() {
    for (const ev of game.drain()) {
        if (ev.type === 'candle') { scene.candle = Math.min(2, ev.lit); if (ev.lit <= 2) sound.chime(); }
        if (ev.type === 'hunt') { $('calib').hidden = true; toast('Keep your eyes open.'); }
        if (ev.type === 'moved') { scene.moved(1 - ev.to / 100); footstep(1 - ev.to / 100, ev.to); }
        if (ev.type === 'recoil') { scene.recoil = 1; sound.hiss(); toast('It flinched.'); }
        if (ev.type === 'caught') caught(ev);
        if (ev.type === 'dawn') dawn(ev);
    }
}

// Footsteps don't always land when it moves: some come late, some never come.
function footstep(closeness, to) {
    clearTimeout(stepTimer);
    if (to <= 0) return; // the last one is the hand on the candle
    const r = Math.random();
    if (r < 0.15 && !lastStepMissing) { lastStepMissing = true; return; }
    lastStepMissing = false;
    if (r < 0.75) { sound.step(closeness); return; }
    const round = roundId;
    stepTimer = setTimeout(() => { if (round === roundId && running) sound.step(closeness); }, scene.lidLen + 250 + Math.random() * 200);
}

// Caught. A hand over the candle (0-220 ms), black and silence (400-1000), then
// the same face lunges from below (1000-1450), hard cut, the end card at 1750.
// Gentle mode keeps the snuffed candle and the black, and skips the face and scream.
function caught(summary) {
    running = false;
    $('hud').hidden = true;
    clearTimeout(stepTimer);
    const round = roundId, gentle = scene.gentle;
    const at = (ms, fn) => setTimeout(() => { if (round === roundId) fn(); }, ms);
    scene.startCapture();
    sound.setDread(0, true); sound.whoosh();
    at(190, () => sound.snuff());
    at(300, () => sound.silence());
    if (!gentle) at(1020, () => { sound.unsilence(); sound.scream(); });
    at(gentle ? 1250 : 1750, () => showEnd(summary));
}

function dawn(summary) { clearTimeout(stepTimer); running = false; $('hud').hidden = true; sound.dawn(); toast('Dawn.'); setTimeout(() => showEnd(summary), 3200); }

function showEnd(s) {
    scene.settled = true;
    $('hud').hidden = true; $('end').hidden = false;
    drawCard($('card'), s, mode);
    stopLive();
}

function quit() {
    running = false; stopLive(); roundId++; clearTimeout(stepTimer); sound.unsilence();
    $('hud').hidden = true; $('calib').hidden = true; $('end').hidden = true; $('error').hidden = true;
    $('consent').hidden = false;
}

function showError(msg) {
    running = false; stopLive();
    $('hud').hidden = true; $('calib').hidden = true;
    $('error-msg').textContent = msg; $('error').hidden = false;
}

let toastTimer = null;
function toast(text) {
    const t = $('toast'); t.textContent = text; t.classList.add('on');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('on'), 1600);
}

function calibText() {
    if (mode === 'live' && !gotMetrics) return 'Waking the camera…';
    const pulse = game.pulse != null ? `Pulse ${Math.round(game.pulse)} bpm. ` : (mode === 'live' ? 'Sit still: reading your pulse (about 12 s). ' : '');
    const nudge = game.calBlinks < 2 && game.elapsedMs > 9000 ? ' Blink slowly and fully.' : '';
    const press = mode === 'practice' && game.calBlinks < 2 ? ' Press Space to blink.' : '';
    return `${pulse}Blinks ${Math.min(2, game.calBlinks)} of 2.${press}${nudge}`;
}

function drawStrip() {
    const c = $('strip'), g = c.getContext('2d'), w = c.width, h = c.height;
    g.clearRect(0, 0, w, h);
    const line = (arr, color, norm) => {
        if (arr.length < 2) return;
        let lo = Infinity, hi = -Infinity; for (const v of arr) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
        const span = norm ? 2 : (hi - lo || 1), base = norm ? -1 : lo;
        g.beginPath(); g.strokeStyle = color; g.lineWidth = 1.5;
        arr.forEach((v, i) => { const x = (i / 239) * w, y = h - 4 - ((v - base) / span) * (h - 26); i ? g.lineTo(x, y) : g.moveTo(x, y); });
        g.stroke();
    };
    line(strip.breath, 'rgba(224,192,106,0.8)', true);
    line(strip.pulse, 'rgba(230,80,70,0.95)', false);
    g.font = '10px sans-serif'; g.fillStyle = '#e5574a'; g.fillText('pulse wave', 8, 13); g.fillStyle = '#c9a25e'; g.fillText('breath', 72, 13);
}

function frame(now) {
    requestAnimationFrame(frame); // schedule first: one bad frame must never stop the game
    const dt = Math.min(100, now - last); last = now;
    if (running) {
        if (mode === 'practice') practiceTick(dt);
        game.tick(dt);
        handleEvents();
        const left = Math.max(0, game.cfg.roundSeconds - game.huntMs / 1000);
        $('dawn-time').textContent = `${Math.floor(left / 60)}:${String(Math.floor(left % 60)).padStart(2, '0')}`;
        $('ro-dist').textContent = Math.round(game.distance);
        sound.setDread(1 - game.distance / 100);
        const cd = game.smileCooldownLeft();
        $('smile-fill').style.width = cd > 0 ? `${100 * (1 - cd / game.cfg.smileCooldownMs)}%` : `${Math.min(100, smileNow)}%`;
        if (game.phase === 'calibrate') $('calib-status').textContent = calibText();
        drawStrip();
    }
    try { scene.draw(dt, game); } catch (e) { console.error('[dont-blink] draw', e); }
}
requestAnimationFrame(frame);

// ---------- end card (numbers only, never the camera image) ----------
function drawCard(c, s, how) {
    const g = c.getContext('2d'), W = c.width, H = c.height;
    const dawnWin = s.outcome === 'dawn';
    const bg = g.createRadialGradient(W / 2, H * 1.15, 40, W / 2, H * 0.4, W * 0.85);
    bg.addColorStop(0, dawnWin ? '#6a5534' : '#4a0f09'); bg.addColorStop(1, '#060404');
    g.fillStyle = bg; g.fillRect(0, 0, W, H);
    g.textAlign = 'left'; g.fillStyle = '#a89a80';
    g.font = '400 20px Georgia, serif'; g.fillText("D O N ' T   B L I N K", 60, 64);
    g.fillStyle = '#f2e6cf'; g.font = '400 62px Georgia, serif';
    g.fillText(dawnWin ? 'You saw dawn.' : `You lasted ${fmt(s.survivedSec)}.`, 60, 140);
    g.fillStyle = '#d9c9a8'; g.font = 'italic 24px Georgia, serif';
    g.fillText(dawnWin ? `It moved ${s.blinks} times and never reached you.` : `It reached you on blink ${s.blinks}.`, 60, 182);

    const stats = [
        [String(s.blinks), 'blinks'],
        [s.baseline != null ? String(s.baseline) : '—', 'resting bpm'],
        [s.peakPulse != null ? String(s.peakPulse) : '—', 'peak bpm'],
        [String(s.smiles), s.smiles === 1 ? 'smile saved you' : 'smiles saved you'],
    ];
    stats.forEach(([v, l], i) => {
        const x = 60 + i * 150;
        g.fillStyle = '#f2e6cf'; g.font = '400 44px Georgia, serif'; g.fillText(v, x, 260);
        g.fillStyle = '#a89a80'; g.font = '400 16px Georgia, serif'; g.fillText(l, x, 286);
    });

    // Your pulse across the round, with a tick for every blink.
    const X0 = 60, X1 = W - 60, Y0 = 340, Y1 = H - 90;
    const dur = Math.max(1000, s.durationMs || 1);
    const pts = s.timeline || [];
    const vals = pts.map((p) => p.bpm).concat(s.baseline != null ? [s.baseline] : []);
    const lo = Math.floor((Math.min(...vals, 70) - 5) / 5) * 5, hi = Math.ceil((Math.max(...vals, 90) + 5) / 5) * 5;
    const xOf = (t) => X0 + (t / dur) * (X1 - X0), yOf = (b) => Y1 - ((b - lo) / (hi - lo)) * (Y1 - Y0);
    g.strokeStyle = 'rgba(168,154,128,0.25)'; g.lineWidth = 1;
    g.fillStyle = '#7d7466'; g.font = '14px sans-serif'; g.textAlign = 'right';
    for (const b of [lo, Math.round((lo + hi) / 2), hi]) { g.beginPath(); g.moveTo(X0, yOf(b)); g.lineTo(X1, yOf(b)); g.stroke(); g.fillText(String(b), X0 - 8, yOf(b) + 5); }
    g.textAlign = 'left';
    if (s.baseline != null) {
        g.setLineDash([4, 6]); g.strokeStyle = 'rgba(217,201,168,0.5)';
        g.beginPath(); g.moveTo(X0, yOf(s.baseline)); g.lineTo(X1, yOf(s.baseline)); g.stroke(); g.setLineDash([]);
        g.fillStyle = '#a89a80'; g.fillText('your resting pulse', X0 + 6, yOf(s.baseline) - 6);
    }
    g.strokeStyle = 'rgba(232,215,180,0.35)';
    for (const t of s.moves || []) { g.beginPath(); g.moveTo(xOf(t), Y1); g.lineTo(xOf(t), Y1 - 12); g.stroke(); }
    if (pts.length > 1) {
        g.strokeStyle = '#e5574a'; g.lineWidth = 3; g.lineJoin = 'round'; g.beginPath();
        pts.forEach((p, i) => (i ? g.lineTo(xOf(p.t), yOf(p.bpm)) : g.moveTo(xOf(p.t), yOf(p.bpm)))); g.stroke();
        const peak = pts.reduce((a, b) => (b.bpm > a.bpm ? b : a));
        g.fillStyle = '#e5574a'; g.beginPath(); g.arc(xOf(peak.t), yOf(peak.bpm), 6, 0, Math.PI * 2); g.fill();
        g.fillStyle = '#f2e6cf'; g.font = '15px sans-serif';
        const lx = Math.min(xOf(peak.t) + 10, X1 - 90);
        g.fillText(`peak ${Math.round(peak.bpm)}`, lx, Math.max(Y0 + 4, yOf(peak.bpm) - 10));
    }
    if (pts.length < 2) {
        g.fillStyle = '#a89a80'; g.font = 'italic 20px Georgia, serif'; g.textAlign = 'center';
        g.fillText('No pulse reading this round. Light your face from the front and try again.', (X0 + X1) / 2, (Y0 + Y1) / 2);
        g.textAlign = 'left';
    }
    g.fillStyle = '#7d7466'; g.font = '14px sans-serif';
    g.fillText('pulse during the round  ·  ticks = blinks', X0, Y1 + 26);
    g.textAlign = 'right';
    g.fillText(how === 'live' ? 'live signals · Presage SmartSpectra SDK, on-device' : 'practice round · simulated signals', X1, Y1 + 26);
    g.textAlign = 'left';
}
function fmt(sec) { return `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`; }

// ---------- buttons ----------
$('btn-live').addEventListener('click', startLive);
$('btn-practice').addEventListener('click', startPractice);
$('btn-again').addEventListener('click', () => (mode === 'live' ? startLive() : startPractice()));
$('btn-quit').addEventListener('click', quit);
$('btn-error-practice').addEventListener('click', startPractice);
$('btn-error-back').addEventListener('click', quit);
$('btn-save').addEventListener('click', () => {
    const a = document.createElement('a');
    a.href = $('card').toDataURL('image/png'); a.download = 'dont-blink.png'; a.click();
});
window.addEventListener('beforeunload', () => { if (sdk) { try { sdk.destroy(); } catch { /* gone */ } } });
