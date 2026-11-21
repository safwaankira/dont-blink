# Don't Blink

**A horror game that only moves when you blink.** Your camera watches your eyes, your pulse and your face through the [Presage SmartSpectra SDK](https://github.com/Presage-Security/SmartSpectra), on your own computer. Every blink, the thing at the end of the hall comes closer. If your heart races, it comes faster. A real smile pushes it back. Survive 60 seconds to see dawn.

Entry for the [DEV Presage SmartSpectra SDK Challenge](https://dev.to/challenges/presage-2026-11-04).

## How it responds to you

| Your signal (SmartSpectra metric) | What it does in the game |
| --- | --- |
| Blink (`face.blinking`, rising edge) | The screen cuts to black, and the creature is closer and in a new pose when your eyes open. |
| Pulse rate (`cardio.pulseRate`) | Your resting pulse is measured while you light the candle. Above it, each blink moves the creature up to 2x farther. |
| Pulse wave (`cardio.arterialPressureTrace`) | Each detected heartbeat plays a "lub-dub" and pulses red at the edges, louder as it nears. |
| Smile (`face.expression`, HAPPY confidence) | Hold a real smile for about a second and it flinches back 9 m (6 s cooldown). |
| Talking (`face.talking`) | It hears you and creeps forward while you talk. |
| Breathing (`breathing.upperTrace`, `breathing.rate`) | The candle flame sways with your chest. |

Calibration doubles as the tutorial: you light the candle by blinking twice, which proves the blink signal works for you before the hunt starts.

## Run it

Needs Node.js 20+ (24 LTS recommended), a webcam, and a free SmartSpectra API key from [physiology.presagetech.com](https://physiology.presagetech.com/). Runs on macOS Apple Silicon, Windows x64 and Linux x64/arm64 (the SDK's supported platforms).

```bash
git clone https://github.com/safwaankira/dont-blink && cd dont-blink
npm install
cp .env.example .env    # then put your key in .env
npm start
```

No key yet? Leave `.env` empty and either paste a key on the start screen, or press **Practice with keys** to play with simulated signals (Space = blink, hold S = smile, arrow keys = pulse). Practice mode is clearly labelled on screen and on the end card; it never pretends to be live.

Tips for a good reading: sit 40–70 cm from the camera, face it, and light your face from the front. If the SDK reports a framing or lighting problem, the hint shows top-left.

If `npm start` exits silently from a VS Code terminal, unset `ELECTRON_RUN_AS_NODE` first.

## Consent and data handling

- **Consent first.** The camera does not turn on until you press *Allow camera and play* on a screen that says what is read and kept. *Esc* stops the round and releases the camera at any time; so does *Turn camera off*.
- **Nothing is stored.** No video, frame or vital sign is written to disk or sent anywhere by this app. Signals live in memory for one round. The end card holds numbers only (blinks, resting and peak pulse, smiles) and is saved only if you press *Save this card*.
- **Network.** The SDK runs its models on this computer. It contacts Presage to validate the API key. Presage's SDK telemetry (session summaries with device, performance and quality counts; no raw frames or measured vitals, per [Presage's Telemetry & Privacy doc](https://github.com/Presage-Security/SmartSpectra/blob/main/docs/telemetry-and-privacy.md)) is **off by default** here (`enableTelemetry: false`) and only on if you tick the box. Presage's own retention for any telemetry is set by [their privacy policy](https://api.physiology.presagetech.com/privacypolicy).
- **No AI services.** No LLM or cloud AI is called.
- **Key handling.** The key is read from `PRESAGE_API_KEY` or a gitignored `.env`, passed only to the bundled local page, and removed from its URL on load.
- **Not medical.** It's a game. The numbers are not a health reading, and nothing here diagnoses or treats anything. Gentle mode removes the jump scare.

## How it's built

- Started from Presage's official [`electron-quickstart`](https://github.com/Presage-Security/SmartSpectra/tree/main/nodejs/samples/electron-quickstart) (`main.js` and the build setup are adapted from it; Presage's copyright notice is kept). Everything game-related is new.
- `src/signals.js` turns each windowed `metrics` packet into game inputs: blink rising edges across packets, heartbeat peaks from the pressure trace, HAPPY confidence from expression scores.
- `src/engine.js` holds the rules as pure logic, so the same code runs on live signals, practice keys and tests.
- `src/view.js` draws the hallway, candle and creature on a canvas and makes every sound with Web Audio. No image or audio files.
- `npm test` runs 18 tests on the rules and the signal parsing (CI runs them on every push).

## License

Game code © 2026 Safwaan Uddin, MIT (see `LICENSE`). The SmartSpectra SDK and the parts adapted from Presage's quickstart remain under Presage's terms.
