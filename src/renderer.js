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
if (params.has('k')) history.replaceState(null, '', location.pathname); // don't keep it in the URL
if (!apiKey) $('key-row').hidden = false;

const VALIDATION_NAMES = Object.fromEntries(Object.entries(ValidationCode).map(([k, v]) => [v, k.replace(/^k/, '')]));

const scene = new Scene($('stage'));
const sound = new Sound();
let game = new Game();
let sdk = null;
let mode = null;          // 'live' | 'practice'
let running = false;
let last = performance.now();
const strip = { pulse: [], breath: [] };
let smileNow = 0;

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
    beat: () => { scene.beatFlash = 1; sound.thump(1 - game.distance / 100); },
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
    beginRound();
    sdk = new SmartSpectraSDK({
        apiKey,
        requestedMetrics: [...breathingMetrics, ...cardioMetrics, ...faceMetrics],
        enableAccumulatedOutput: false,
        enableTelemetry: $('opt-telemetry').checked,
    });
    sdk.on('metrics', (buf) => {
        try { reader.feed(decodeMetrics(buf)); } catch (e) { console.error('[dont-blink] decode failed', e); }
    });
    sdk.on('validationStatus', (code, _ts, hint) => {
        $('hint').textContent = code === ValidationCode.kOk ? '' : (hint || VALIDATION_NAMES[code] || '');
    });
    sdk.on('processingStatus', (s) => { if (s === ProcessingStatus.kError) showError('The SDK stopped. Check the light and your key, then try again.'); });
    sdk.on('error', (code, message) => showError(`SmartSpectra error ${code}: ${message}`));
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
    scene.candle = 0; scene.scare = 0; scene.settled = false; scene.dawn = 0; scene.shownDistance = 100; scene.gentle = $('opt-gentle').checked;
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
        if (ev.type === 'candle') { scene.candle = ev.lit; sound.chime(); }
        if (ev.type === 'hunt') { $('calib').hidden = true; toast('Keep your eyes open.'); }
        if (ev.type === 'moved') { scene.moved(); sound.step(1 - ev.to / 100); }
        if (ev.type === 'recoil') { scene.recoil = 1; sound.hiss(); toast('It flinched.'); }
        if (ev.type === 'caught') caught(ev);
        if (ev.type === 'dawn') dawn(ev);
    }
}

function caught(summary) {
    running = false;
    $('hud').hidden = true;
    if (!scene.gentle) sound.scream();
    const t0 = performance.now();
    const anim = () => {
        scene.scare = Math.min(1, (performance.now() - t0) / 250);
        if (performance.now() - t0 < 1400) requestAnimationFrame(anim); else showEnd(summary);
    };
    anim();
}

function dawn(summary) { running = false; toast('Dawn.'); setTimeout(() => showEnd(summary), 2600); }

function showEnd(s) {
    scene.settled = true;
    $('hud').hidden = true; $('end').hidden = false;
    drawCard($('card'), s, mode);
    stopLive();
}

function quit() {
    running = false; stopLive();
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

function drawStrip() {
    const c = $('strip'), g = c.getContext('2d'), w = c.width, h = c.height;
    g.clearRect(0, 0, w, h);
    const line = (arr, color, norm) => {
        if (arr.length < 2) return;
        let lo = Infinity, hi = -Infinity; for (const v of arr) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
        const span = norm ? 2 : (hi - lo || 1), base = norm ? -1 : lo;
        g.beginPath(); g.strokeStyle = color; g.lineWidth = 1.5;
        arr.forEach((v, i) => { const x = (i / 239) * w, y = h - 4 - ((v - base) / span) * (h - 8); i ? g.lineTo(x, y) : g.moveTo(x, y); });
        g.stroke();
    };
    line(strip.breath, 'rgba(224,192,106,0.8)', true);
    line(strip.pulse, 'rgba(230,80,70,0.95)', false);
    g.fillStyle = '#8d8473'; g.font = '10px sans-serif'; g.fillText('pulse wave', 4, 11); g.fillStyle = '#b39a5a'; g.fillText('breath', 70, 11);
}

function frame(now) {
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
        if (game.phase === 'calibrate' && game.pulse != null) $('calib-status').textContent = `Pulse found: ${Math.round(game.pulse)} bpm. Candle ${game.calBlinks}/2.`;
        drawStrip();
    }
    scene.draw(dt, game);
    requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// ---------- end card (numbers only, never the camera image) ----------
function drawCard(c, s, how) {
    const g = c.getContext('2d'), W = c.width, H = c.height;
    const bg = g.createRadialGradient(W / 2, H * 1.1, 50, W / 2, H / 2, W * 0.8);
    bg.addColorStop(0, s.outcome === 'dawn' ? '#5a4a30' : '#3a0d08'); bg.addColorStop(1, '#050404');
    g.fillStyle = bg; g.fillRect(0, 0, W, H);
    g.fillStyle = '#f2e6cf'; g.textAlign = 'center';
    g.font = '400 30px Georgia, serif'; g.fillText("D O N ' T   B L I N K", W / 2, 70);
    g.font = '400 76px Georgia, serif';
    g.fillText(s.outcome === 'dawn' ? 'You saw dawn.' : `It got you at ${fmt(s.survivedSec)}.`, W / 2, 190);
    const stats = [
        [String(s.blinks), 'blinks'],
        [s.baseline != null ? String(s.baseline) : '—', 'resting pulse'],
        [s.peakPulse != null ? String(s.peakPulse) : '—', 'peak pulse'],
        [String(s.smiles), 'smiles that saved you'],
    ];
    stats.forEach(([v, l], i) => {
        const x = W * (0.14 + i * 0.24);
        g.font = '400 64px Georgia, serif'; g.fillStyle = '#f2e6cf'; g.fillText(v, x, 340);
        g.font = '400 22px Georgia, serif'; g.fillStyle = '#a89a80'; g.fillText(l, x, 378);
    });
    g.font = 'italic 24px Georgia, serif'; g.fillStyle = '#d9c9a8';
    const line = s.outcome === 'dawn' ? 'It never reached you.' : `Every blink, it moved. ${s.blinks} times.`;
    g.fillText(line, W / 2, 470);
    g.font = '18px sans-serif'; g.fillStyle = '#7d7466';
    g.fillText(how === 'live' ? 'Live signals: Presage SmartSpectra SDK, on-device' : 'Practice round: simulated signals', W / 2, H - 40);
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
