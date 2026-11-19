'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { Game } = require('../src/engine');

function hunting(opts) {
    const g = new Game(opts);
    for (const p of [70, 72, 74]) g.onPulse(p);
    g.tick(500); g.onBlink(g.elapsedMs); g.tick(500); g.onBlink(g.elapsedMs); g.tick(16);
    assert.strictEqual(g.phase, 'hunt');
    return g;
}

test('two blinks plus a pulse end calibration and set the baseline', () => {
    const g = hunting();
    assert.strictEqual(g.baseline, 72);
    assert.strictEqual(g.distance, 100, 'calibration blinks do not move it');
});

test('calibration gives up waiting after 25 s', () => {
    const g = new Game(); g.tick(25001);
    assert.strictEqual(g.phase, 'hunt'); assert.strictEqual(g.baseline, 75);
});

test('a blink moves it one step at a calm pulse', () => {
    const g = hunting(); g.tick(300); g.onBlink(g.elapsedMs);
    assert.strictEqual(g.distance, 94);
});

test('a racing pulse doubles the step', () => {
    const g = hunting(); g.onPulse(72 + 25); g.tick(300); g.onBlink(g.elapsedMs);
    assert.strictEqual(g.distance, 88);
});

test('one physical blink seen in several packets counts once', () => {
    const g = hunting(); g.tick(300);
    g.onBlink(g.elapsedMs); g.tick(50); g.onBlink(g.elapsedMs);
    assert.strictEqual(g.huntBlinks, 1);
});

test('a held smile pushes it back, then cools down', () => {
    const g = hunting();
    for (let i = 0; i < 5; i++) { g.tick(300); g.onBlink(g.elapsedMs); }
    const before = g.distance;
    g.onSmile(80, g.elapsedMs); g.tick(1000); g.onSmile(80, g.elapsedMs);
    assert.strictEqual(g.distance, before + 9);
    g.tick(1000); g.onSmile(80, g.elapsedMs); g.tick(1000); g.onSmile(80, g.elapsedMs);
    assert.strictEqual(g.smiles, 1, 'cooldown blocks a second push');
});

test('a weak smile does nothing', () => {
    const g = hunting(); g.onSmile(30, g.elapsedMs); g.tick(2000); g.onSmile(30, g.elapsedMs);
    assert.strictEqual(g.smiles, 0);
});

test('talking lets it creep', () => {
    const g = hunting(); g.onTalking(true); g.tick(1000);
    assert.ok(g.distance < 100 && g.distance > 98);
});

test('enough blinks and it gets you', () => {
    const g = hunting();
    for (let i = 0; i < 17 && g.phase === 'hunt'; i++) { g.tick(300); g.onBlink(g.elapsedMs); }
    assert.strictEqual(g.phase, 'caught');
    assert.strictEqual(g.summary().outcome, 'caught');
});

test('surviving 60 s is dawn', () => {
    const g = hunting(); for (let i = 0; i < 61; i++) g.tick(1000);
    assert.strictEqual(g.phase, 'dawn');
});

test('junk pulse values are ignored', () => {
    const g = new Game(); g.onPulse(0); g.onPulse(NaN); g.onPulse(400);
    assert.strictEqual(g.pulse, null);
});
