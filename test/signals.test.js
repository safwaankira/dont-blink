'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { SignalReader, HAPPY } = require('../src/signals');

test('rising edges of blinking become blinks, across packets', () => {
    const got = [];
    const r = new SignalReader({ blink: (t) => got.push(t) });
    r.feed({ face: { blinking: [{ detected: false, timestamp: 1 }, { detected: true, timestamp: 2 }] } });
    r.feed({ face: { blinking: [{ detected: true, timestamp: 3 }, { detected: false, timestamp: 4 }] } });
    r.feed({ face: { blinking: [{ detected: true, timestamp: 5 }] } });
    assert.deepStrictEqual(got, [2, 5]);
});

test('protobuf Long timestamps are handled', () => {
    const got = [];
    const r = new SignalReader({ blink: (t) => got.push(t) });
    r.feed({ face: { blinking: [{ detected: true, timestamp: { toNumber: () => 42 } }] } });
    assert.deepStrictEqual(got, [42]);
});

test('HAPPY confidence is read from the expression scores', () => {
    let e;
    const r = new SignalReader({ expression: (x) => { e = x; } });
    r.feed({ face: { expression: [{ stable: true, scores: [{ type: HAPPY, confidence: 77 }, { type: 6, confidence: 20 }] }] } });
    assert.strictEqual(e.happy, 77);
});

test('a 72 bpm pressure wave gives about one beat per period', () => {
    const beats = [];
    const r = new SignalReader({ beat: (t) => beats.push(t) });
    r.feed({ cardio: { pulseRate: [{ value: 72 }] } });
    const fs = 30, sec = 10;
    for (let k = 0; k < sec; k++) {
        const chunk = [];
        for (let i = 0; i < fs; i++) {
            const n = k * fs + i, t = Math.round(n * 1e6 / fs);
            chunk.push({ timestamp: t, value: Math.sin(2 * Math.PI * 1.2 * n / fs) + 0.05 * Math.sin(n) });
        }
        r.feed({ cardio: { arterialPressureTrace: chunk } });
    }
    assert.ok(beats.length >= 10 && beats.length <= 13, `beats=${beats.length}`);
});

test('pulse rate is passed through', () => {
    let p; const r = new SignalReader({ pulse: (v) => { p = v; } });
    r.feed({ cardio: { pulseRate: [{ value: 64 }, { value: 66 }] } });
    assert.strictEqual(p, 66);
});
