# Verification

Checks performed on an Apple M3 Max Mac, Node 22.22.3 and Python 3.12.

## Results

After the neural singing upgrade, all **10 backend/audio tests** and **4 score/MIDI tests** passed. All three real-browser suites passed: original-engine editing/render/playback/export, pointer editing/MIDI/cancellation, and neural singing with old-project migration, engine switching/undo, audio playback/download, persistence, and mobile layout. TypeScript and the production build passed. Desktop/mobile screenshots were inspected. Generated WAVs and the voice credits in the exported ZIP were independently opened and checked.

The initial checkpoint had 7 backend/audio tests and 2 browser suites. Its npm audit reported zero vulnerabilities; the neural upgrade adds Python model dependencies, not new npm packages.

## Audio evidence

- The initial single-word experiment targeted A4 / 440 Hz for 1.5 seconds. WORLD measured a median pitch of 440.09 Hz in the resulting audio.
- The default score rendered 16 singers in four parts to a 13.4286-second, 24 kHz stereo PCM-24 WAV and four PCM-24 stems. The initial render completed in 12.64 seconds. These are observed local measurements, not a general performance guarantee.
- Automated audio tests independently estimate rendered pitch at C4 and A4, check duration/channel count/bit depth, non-silence, peak limits, cancellation, and verify that the four stems sum back to the mix.
- The UI test renders through the actual API and confirms that the audio element plays and its time advances, then downloads a WAV and ZIP.

## Quality boundary

A historical Whisper small.en check of the original demo lyric “May our light shine on” returned “May our light shine, shine” for the soprano stem and “Gray, power, white, shine, blind” for the full ensemble. That exposed limitations of the speech-derived engine. ASR on polyphonic singing also has its own limitations.

The new model improves the measured pronunciation result below. It does **not** establish natural choir quality or equivalence to Dreamtonics. No subjective human listening review has been claimed. The new bank is one singer with several styles, has a published G3–D5 range, and has separate non-commercial usage terms.

## Neural singing evidence

- A complete first solo phrase rendered in 11.54 seconds locally. A four-part, four-performance quartet rendered in 41.3 seconds to 13.4286 seconds of 44.1 kHz stereo PCM-24 audio. Timing varies with CPU, cache, score length, and singer count.
- The quartet's four exported stems sum to the mix with a maximum sample error of `3.5763e-7`, consistent with 24-bit quantization. Peak was 0.6723 or lower; the WAV is not clipped.
- Real audio tests render C4 and G4 with a rest between them, independently estimate both pitches within one semitone of the score, check duration/format/peak, and verify an identical waveform when reusing the cached performance.
- The neural browser test rendered two soprano performances, observed advancing playback time, and downloaded a valid 44.1 kHz PCM-24 WAV plus a ZIP containing `VOICE-CREDITS.txt`. It reported no JavaScript errors.
- `scripts/render_comparison.py` produces dry solo files with the same notes, lyrics, timing, and singer count. Both are RMS matched over the active phrase, with no room effect. Source voices differ by design: Kokoro/Clara versus DiffSinger/Nishiren.
- A fresh local Whisper `small.en` check of these comparison files returned **“The May, our, the white, shine, gone.”** for the original renderer and **“May our light shine on”** for the neural renderer. The four-part neural quartet also returned **“May our light shine on.”** This is an intelligibility check, not a naturalness score.
- Listen to `artifacts/comparison/before-original.wav`, `artifacts/comparison/after-neural.wav`, and `artifacts/singing-quartet/choire-mix.wav`. The machine transcription receipt is `artifacts/comparison/transcription.json`.

## Reproducible checks

- `npm run build` — TypeScript checks and production bundle.
- `npm test` — overlap protection, lyric assignment, polyphonic MIDI separation, excessive-voice rejection.
- `npm run test:audio` — real synthesis and API/schema tests.
- `node scripts/verify-ui.mjs` with the production server running — editor, render, playback, downloads, stale-render state, project persistence/import, and mobile layout.
- `node scripts/verify-editing.mjs` — append/delete notes, actual pointer drag/resize, keyboard pitch editing, MIDI round-trip, and render cancellation.
- `node scripts/verify-singing.mjs` — real neural ensemble render, old-project migration, engine switching/undo, playback, credits-bearing stem download, persistence, desktop/mobile layout.
- `.venv/bin/python scripts/render_comparison.py` — dry, RMS-matched comparison audio with a metadata receipt.

The ignored `artifacts/` directory contains the generated sample audio, transcription output, screenshots, exported files, and machine-readable verification receipts. The `.renders/` directory contains browser-generated renders.
