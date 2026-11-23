// engine.js — the rules of Don't Blink. Pure logic, no DOM, no SDK, so it
// runs the same with live SmartSpectra signals, practice keys, or tests.
//
// Inputs (all optional per tick): blink edges, pulse rate (BPM), a smile
// score (0..100), talking flag. Output: the creature's distance and events
// the view turns into sound and pictures.

'use strict';

const DEFAULTS = Object.freeze({
    roundSeconds: 60,       // survive this long and dawn breaks
    startDistance: 100,     // 100 = end of the hall, 0 = it has you
    blinkStep: 6,           // metres the creature covers per blink at calm pulse
    maxPulseBoost: 1.0,     // +100% step when pulse is far above your baseline
    pulseSpan: 20,          // BPM above baseline that reaches the full boost
    pulseDeadZone: 3,       // ignore small wobble around your resting pulse
    smileHoldMs: 900,       // hold a real smile this long...
    smileThreshold: 55,     // ...above this HAPPY confidence (0..100)
    smilePush: 9,           // ...and it is pushed back this far
    smileCooldownMs: 6000,
    talkCreepPerSec: 1.2,   // it hears you: slow creep while you talk
    minBlinkGapMs: 220,     // one blink, not three frames of one blink
    defaultBaseline: 75,
});

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

function median(xs) {
    if (!xs.length) return null;
    const s = [...xs].sort((a, b) => a - b);
    const m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

class Game {
    constructor(opts = {}) {
        this.cfg = { ...DEFAULTS, ...opts };
        this.reset();
    }

    reset() {
        this.phase = 'calibrate'; // calibrate -> hunt -> (caught | dawn)
        this.distance = this.cfg.startDistance;
        this.elapsedMs = 0;
        this.huntMs = 0;
        this.blinks = 0;
        this.huntBlinks = 0;
        this.calBlinks = 0;
        this.smiles = 0;
        this.pulseSamples = [];
        this.timeline = [];      // {t, bpm} during the hunt, for the end card
        this.secondBlinkAt = null;
        this.calPulse = [];
        this.baseline = null;
        this.pulse = null;
        this.peakPulse = null;
        this.smileSince = null;
        this.lastSmileAt = -Infinity;
        this.lastBlinkAt = -Infinity;
        this.talking = false;
        this.events = [];
        this.moves = []; // {at, from, to, pulse} for the end card
    }

    // Arousal multiplier from pulse over baseline. Calm = 1, racing = 1 + maxPulseBoost.
    boost() {
        if (this.pulse == null) return 1;
        const base = this.baseline ?? this.cfg.defaultBaseline;
        const over = (this.pulse - base - this.cfg.pulseDeadZone) / this.cfg.pulseSpan;
        return 1 + clamp(over, 0, 1) * this.cfg.maxPulseBoost;
    }

    emit(type, data = {}) { this.events.push({ type, t: this.elapsedMs, ...data }); }

    // Calibration ends when the player has blinked twice (proves the blink
    // signal works for them) and we have a few pulse samples, or after 25 s.
    startHunt() {
        this.phase = 'hunt';
        this.baseline = median(this.calPulse) ?? this.pulse ?? this.cfg.defaultBaseline;
        this.emit('hunt', { baseline: this.baseline });
    }

    onPulse(bpm) {
        if (!Number.isFinite(bpm) || bpm < 35 || bpm > 200) return; // ignore junk
        this.pulse = bpm;
        if (this.phase === 'calibrate') this.calPulse.push(bpm);
        if (this.phase === 'hunt') {
            this.pulseSamples.push(bpm);
            this.timeline.push({ t: this.huntMs, bpm });
            this.peakPulse = this.peakPulse == null ? bpm : Math.max(this.peakPulse, bpm);
        }
    }

    onBlink(nowMs = this.elapsedMs) {
        if (nowMs - this.lastBlinkAt < this.cfg.minBlinkGapMs) return false;
        this.lastBlinkAt = nowMs;
        this.blinks++;
        if (this.phase === 'calibrate') {
            this.calBlinks++;
            if (this.calBlinks === 2) this.secondBlinkAt = this.elapsedMs;
            this.emit('candle', { lit: this.calBlinks });
            return true;
        }
        if (this.phase !== 'hunt') return true;
        this.huntBlinks++;
        const step = this.cfg.blinkStep * this.boost();
        const from = this.distance;
        this.distance = Math.max(0, this.distance - step);
        this.moves.push({ at: this.huntMs, from, to: this.distance, pulse: this.pulse });
        this.emit('moved', { from, to: this.distance, step, boost: this.boost() });
        if (this.distance <= 0) this.end('caught');
        return true;
    }

    onSmile(score, nowMs = this.elapsedMs) {
        if (this.phase !== 'hunt') return;
        if (!(score >= this.cfg.smileThreshold)) { this.smileSince = null; return; }
        if (this.smileSince == null) this.smileSince = nowMs;
        const held = nowMs - this.smileSince;
        const ready = nowMs - this.lastSmileAt >= this.cfg.smileCooldownMs;
        if (held >= this.cfg.smileHoldMs && ready) {
            this.lastSmileAt = nowMs;
            this.smileSince = null;
            this.smiles++;
            const from = this.distance;
            this.distance = Math.min(this.cfg.startDistance, this.distance + this.cfg.smilePush);
            this.emit('recoil', { from, to: this.distance });
        }
    }

    onTalking(flag) { this.talking = !!flag; }

    smileCooldownLeft() {
        return Math.max(0, this.cfg.smileCooldownMs - (this.elapsedMs - this.lastSmileAt));
    }

    tick(dtMs) {
        this.elapsedMs += dtMs;
        if (this.phase === 'calibrate') {
            // Start as soon as both candles are lit and we have any pulse; if the
            // pulse is slow to arrive (SmartSpectra needs a ~12 s window), wait up to
            // 14 s more, then use a default.
            const lit = this.calBlinks >= 2;
            const waited = lit && this.elapsedMs - this.secondBlinkAt > 14000;
            if ((lit && (this.calPulse.length >= 1 || waited)) || this.elapsedMs > 30000) this.startHunt();
            return;
        }
        if (this.phase !== 'hunt') return;
        this.huntMs += dtMs;
        if (this.talking) {
            const from = this.distance;
            this.distance = Math.max(0, this.distance - this.cfg.talkCreepPerSec * dtMs / 1000);
            if (from > 0 && this.distance <= 0) this.end('caught');
        }
        if (this.phase === 'hunt' && this.huntMs >= this.cfg.roundSeconds * 1000) this.end('dawn');
    }

    end(how) {
        if (this.phase === 'caught' || this.phase === 'dawn') return;
        this.phase = how;
        this.emit(how, this.summary());
    }

    summary() {
        const avg = this.pulseSamples.length
            ? this.pulseSamples.reduce((a, b) => a + b, 0) / this.pulseSamples.length : null;
        return {
            outcome: this.phase,
            survivedSec: Math.round(this.huntMs / 100) / 10,
            blinks: this.huntBlinks,
            smiles: this.smiles,
            baseline: this.baseline != null ? Math.round(this.baseline) : null,
            avgPulse: avg != null ? Math.round(avg) : null,
            peakPulse: this.peakPulse != null ? Math.round(this.peakPulse) : null,
            closest: Math.round(this.distance),
            timeline: this.timeline.slice(),
            moves: this.moves.map((m) => m.at),
            durationMs: this.huntMs,
        };
    }

    drain() { const e = this.events; this.events = []; return e; }
}

module.exports = { Game, DEFAULTS, median, clamp };
