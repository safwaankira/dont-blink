// signals.js — turns SmartSpectra `metrics` packets into game inputs.
//
// Each `metrics` event carries the windowed slice since the previous event,
// so every array below holds only new samples. We keep the small amount of
// state needed to find edges (blinks) and peaks (heartbeats) across packets.

'use strict';

const HAPPY = 5; // ExpressionType.HAPPY in SmartSpectra's data types
const FEAR = 4;

function ts(t) {
    if (t == null) return 0;
    if (typeof t === 'number') return t;
    if (typeof t === 'bigint') return Number(t);
    if (typeof t.toNumber === 'function') return t.toNumber();
    return Number(t);
}

class SignalReader {
    constructor(handlers = {}) {
        this.h = handlers;
        this.wasBlinking = false;
        this.lastBlinkTs = 0;
        // heartbeat peak detection on the arterial pressure trace
        this.trace = [];         // recent {t, v}
        this.lastPeakTs = 0;
        this.pulse = null;
        // breathing trace, normalised to -1..1 with a slow running range
        this.bMin = Infinity; this.bMax = -Infinity;
    }

    feed(m) {
        if (!m || typeof m !== 'object') return;
        this.readPulse(m.cardio?.pulseRate);
        this.readBlinks(m.face?.blinking);
        this.readTalking(m.face?.talking);
        this.readExpression(m.face?.expression);
        this.readHeartTrace(m.cardio?.arterialPressureTrace);
        this.readBreath(m.breathing?.upperTrace, m.breathing?.rate);
    }

    readPulse(arr) {
        if (!arr || !arr.length) return;
        const last = arr[arr.length - 1];
        if (last && Number.isFinite(last.value) && last.value > 0) {
            this.pulse = last.value;
            this.h.pulse?.(last.value, last.confidence);
        }
    }

    // Rising edge of `detected` = one blink. Timestamps guard against a
    // packet replaying a sample we already counted.
    readBlinks(arr) {
        if (!arr || !arr.length) return;
        const sorted = [...arr].sort((a, b) => ts(a.timestamp) - ts(b.timestamp));
        for (const s of sorted) {
            const t = ts(s.timestamp);
            if (s.detected && !this.wasBlinking && t > this.lastBlinkTs) {
                this.lastBlinkTs = t;
                this.h.blink?.(t);
            }
            this.wasBlinking = !!s.detected;
        }
    }

    readTalking(arr) {
        if (!arr || !arr.length) return;
        this.h.talking?.(!!arr[arr.length - 1].detected);
    }

    readExpression(arr) {
        if (!arr || !arr.length) return;
        const e = arr[arr.length - 1];
        const score = (type) => (e.scores || []).find((s) => s.type === type)?.confidence ?? 0;
        this.h.expression?.({ happy: score(HAPPY), fear: score(FEAR), stable: !!e.stable });
    }

    // A heartbeat = a local maximum of the pressure trace that stands above
    // the recent mean, at least 60% of one beat period after the last one.
    readHeartTrace(arr) {
        if (!arr || !arr.length) return;
        for (const s of arr) {
            this.trace.push({ t: ts(s.timestamp), v: s.value });
            this.h.trace?.(s.value);
        }
        if (this.trace.length > 120) this.trace.splice(0, this.trace.length - 120);
        const n = this.trace.length;
        if (n < 5) return;
        const mean = this.trace.reduce((a, p) => a + p.v, 0) / n;
        const period = 60e6 / (this.pulse || 75);
        for (let i = Math.max(2, n - arr.length - 1); i < n - 2; i++) {
            const p = this.trace[i];
            if (p.t <= this.lastPeakTs) continue;
            const isPeak = p.v > this.trace[i - 1].v && p.v >= this.trace[i + 1].v &&
                p.v > this.trace[i - 2].v && p.v >= this.trace[i + 2].v && p.v > mean;
            if (isPeak && p.t - this.lastPeakTs > 0.6 * period) {
                this.lastPeakTs = p.t;
                this.h.beat?.(p.t);
            }
        }
    }

    readBreath(trace, rate) {
        if (trace && trace.length) {
            for (const s of trace) {
                const v = s.value;
                this.bMin = Math.min(this.bMin * 0.999 + v * 0.001, v);
                this.bMax = Math.max(this.bMax * 0.999 + v * 0.001, v);
                const span = this.bMax - this.bMin || 1;
                this.h.breath?.(((v - this.bMin) / span) * 2 - 1);
            }
        }
        if (rate && rate.length) {
            const r = rate[rate.length - 1].value;
            if (Number.isFinite(r) && r > 0) this.h.breathRate?.(r);
        }
    }
}

module.exports = { SignalReader, HAPPY, FEAR, ts };
