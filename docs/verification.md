# Verification

Checks performed on an Apple M3 Max Mac, Node 22.22.3 and Python 3.12.

## Results

All 7 backend/audio tests and 4 score/MIDI tests passed. Both real-browser suites passed: desktop/mobile editing and audio export, plus pointer editing, MIDI round-trip, and cancellation. The final production build passed; npm reported zero dependency vulnerabilities. The generated WAV was re-opened and the stems ZIP contents were checked.

## Audio evidence

- The initial single-word experiment targeted A4 / 440 Hz for 1.5 seconds. WORLD measured a median pitch of 440.09 Hz in the resulting audio.
- The default score rendered 16 singers in four parts to a 13.4286-second, 24 kHz stereo PCM-24 WAV and four PCM-24 stems. The initial render completed in 12.64 seconds. These are observed local measurements, not a general performance guarantee.
- Automated audio tests independently estimate rendered pitch at C4 and A4, check duration/channel count/bit depth, non-silence, peak limits, cancellation, and verify that the four stems sum back to the mix.
- The UI test renders through the actual API and confirms that the audio element plays and its time advances, then downloads a WAV and ZIP.

## Quality boundary

A local Whisper small.en transcription check on the intended demo lyric “May our light shine on” returned “May our light shine, shine” for the soprano stem and “Gray, power, white, shine, blind” for the full ensemble. This is evidence that lyric intelligibility is limited; ASR on polyphonic singing also has its own limitations. It does **not** establish natural choir quality. No subjective human listening review has been claimed.

The implementation meets the functional notes/lyrics → audio workflow. It does not establish equivalence to Dreamtonics, and should not be represented as a production-quality choir synthesizer. Long sustains, high registers, multi-syllable words, and large ensembles are particularly challenging for this speech-derived engine.

## Reproducible checks

- `npm run build` — TypeScript checks and production bundle.
- `npm test` — overlap protection, lyric assignment, polyphonic MIDI separation, excessive-voice rejection.
- `npm run test:audio` — real synthesis and API/schema tests.
- `node scripts/verify-ui.mjs` with the production server running — editor, render, playback, downloads, stale-render state, project persistence/import, and mobile layout.
- `node scripts/verify-editing.mjs` — append/delete notes, actual pointer drag/resize, keyboard pitch editing, MIDI round-trip, and render cancellation.

The ignored `artifacts/` directory contains the generated sample audio, transcription output, screenshots, exported files, and machine-readable verification receipts. The `.renders/` directory contains browser-generated renders.
