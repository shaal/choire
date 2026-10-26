# Choire

A local, working notes-and-lyrics choir studio. Compose soprano, alto, tenor, and bass parts in a piano roll, assign English lyrics, render 1–16 singers per part, and export a stereo WAV or individual stems.

**This is an independent experimental implementation, not a clone of Dreamtonics’ synthesis engine.** The new DiffSinger renderer generates connected sung phrases with learned pronunciation, pitch, and breath controls, using Nishiren Diffsinger v2.1 by Gardanana. The original Kokoro/WORLD speech-to-singing renderer remains available for comparison. This is still an experimental ensemble of one singing voicebank, not a professional multi-singer choir model. See [voicebank setup and usage terms](docs/voicebank.md), [reference analysis](docs/reference-analysis.md), and [verification](docs/verification.md).

## Run

Requirements: Node.js 22.12+ (22.x), Python 3.12, and [uv](https://docs.astral.sh/uv/). Tested on macOS / Apple Silicon.

```sh
npm install
npm run setup
npm run setup:singing
npm run build
npm start
```

Open **http://127.0.0.1:8765**. The API and UI share the same local server. No API key or paid service is required. The original engine downloads approximately 354 MB of models; singing setup downloads the complete 624 MB Nishiren archive. Subsequent rendering runs locally without network access. Fonts are bundled locally too. Nishiren permits non-commercial use and requires attribution when publishing; commercial use needs the author's approval. Its full [terms](https://github.com/Gardanana/Nishiren-AI-Diffsinger/blob/main/terms-of-service.md) also contain content restrictions.

For development:

```sh
npm run dev
```

This starts the Python API on port 8765 and Vite on **http://127.0.0.1:5173**. Stop either mode with Ctrl+C. `CHOIRE_PORT` can change the production port; development uses the fixed API proxy on 8765.

## Compose

1. Start with **A little light**, the included four-part score. New projects use two neural performances per part. Press **Render choir**, then play. Each new performance takes computation; later mix changes reuse cached vocals. The **Singing engine** selector also provides the faster original renderer. Saved projects retain their engine.
2. Select a vocal part on the left. Click an empty grid position to add a note; **+ Note** appends one after the part’s last note. Drag notes to change pitch/time and drag their right edge to resize. Each part is monophonic; use other parts for harmony.
3. Select a note to edit its pitch, start, length, and lyric numerically. Arrow keys move a focused note; Shift+Up/Down changes octaves; Delete removes it. Snap supports one, half, or quarter beats.
4. Enter one English word per note in **Lyrics**, then apply. Neural singing accepts dictionary words and common vowels such as `ah`, `oh`, `oo`, `la`. Unknown words produce an error. The original engine also supports freely spelled syllables split with hyphens. Extra words are ignored with a message; unmatched notes keep their existing lyrics.
5. Set voice color, singer count, part volume/pan, pitch/timing variation, pitch expression (or original-engine vibrato), and room ambience. Mute/solo affects rendering. **New performance** changes the variation seed, preserving the score. Nishiren's colors are styles of one voice; the published G3–D5 range is flagged when exceeded.
6. Re-render after edits. Playback/export is marked stale until the new score has been rendered. Undoing to the exact rendered score makes that audio available again.
7. Export **24-bit stereo WAV** at 44.1 kHz for neural singing or 24 kHz for the original engine. The **Stems** ZIP includes the mix, individual WAVs, score JSON, and neural voice credits. Stems share the mix's master gain, so they sum back to it.

The piano roll shows a pitch window; use its up/down controls to reach other octaves. Notes are supported from C2–C6, with a maximum score length of 128 beats. Large scores and high singer counts take longer. The API bounds work to 2,048 singer-notes / 40 singer-minutes and one render at a time.

## Projects and MIDI

- Browser storage saves the current composition locally. **Save project** creates a portable `.choire.json` file. The UI is single-session; separate browser tabs maintain separate in-memory editor state and share the saved browser slot.
- **Open project / MIDI** loads a saved score or Standard MIDI file. Import is validated before replacing the score; undo returns to the previous composition.
- MIDI import splits polyphony into at most four monophonic parts, snaps to quarter beats, and uses the first tempo. It imports pitches/timing, not lyrics, instruments, tempo changes, or automation; lyrics start as `ah`.
- The music-file button in the transport exports MIDI pitches and timing. JSON preserves all choir settings and lyrics.
- Source syllables are cached in `.cache/`. Rendered audio lives in `.renders/`. Models live in `.models/`. These directories are local and ignored by Git. They persist until you remove them; no automatic deletion of finished renders occurs.

## Verification

```sh
uv pip install --python .venv/bin/python -r requirements-dev.txt
npm test
npm run test:audio
# With npm start running, and Google Chrome installed:
node scripts/verify-ui.mjs
node scripts/verify-editing.mjs
node scripts/verify-singing.mjs
# Generate a dry, level-matched before/after audio comparison:
.venv/bin/python scripts/render_comparison.py
```

The browser check uses headless Chrome at its standard macOS path. Set `CHROME_PATH` for a different executable. It drives the real engine (no mocked audio), checks playback time advances, downloads the mix/stems, exercises note edits and persistence, and captures desktop/mobile layouts in `artifacts/qa/`.

Reproduce the standalone demo:

```sh
PYTHONPATH=. .venv/bin/python scripts/render_demo.py
```

## Code

- `src/App.tsx`: project state, undo/redo, render jobs, transport, mixer, import/export.
- `src/PianoRoll.tsx`: grid, dragging, resizing, snap, keyboard note editing.
- `src/score.ts`: score types, overlap rules, lyric assignment, MIDI conversion.
- `backend/schema.py`: validated scores and synthesis resource limits.
- `backend/engine.py`: vocal analysis, duration/pitch control, singer variation, stereo mix/reverb.
- `backend/app.py`: local API, one render worker, cancellation, WAV/ZIP downloads.

## Attribution

Choire’s implementation is original. The reference workflow is [Dreamtonics Choir Voices](https://dreamtonics.com/choir-voices/); no Dreamtonics software, models, artwork, or recordings are included.

- [Kokoro-82M](https://huggingface.co/hexgrad/Kokoro-82M): open voice model, Apache-2.0 per upstream. The model is a **text-to-speech** model.
- [kokoro-onnx](https://github.com/thewh1teagle/kokoro-onnx): MIT; model/voice downloads from its published release.
- [WORLD / PyWORLD](https://github.com/JeremyCCHsu/Python-Wrapper-for-World-Vocoder): vocoder and Python wrapper; consult the upstream bundled licenses.
- Display names such as Clara and Felix are UI aliases for the listed Kokoro voice IDs, not newly trained voice identities.

Leanrea was installed separately at the user skill level and used to guide evidence collection. No external messages, purchases, or deployment were performed.
