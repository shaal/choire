# Choire

A local, working notes-and-lyrics choir studio. Compose soprano, alto, tenor, and bass parts in a piano roll, assign English lyrics, render 1–16 singers per part, and export a stereo WAV or individual stems.

**This is an independent experimental implementation, not a clone of Dreamtonics’ synthesis engine.** It uses Kokoro to generate spoken vocal material and WORLD to resynthesize it at the requested pitches and durations. It produces real score-controlled vocal audio, but it is not a trained singing model. Articulation, sustained vowels, and ensemble realism are substantially below a professional choir product. See [the reference analysis](docs/reference-analysis.md) and [verification](docs/verification.md).

## Run

Requirements: Node.js 22.12+ (22.x), Python 3.12, and [uv](https://docs.astral.sh/uv/). Tested on macOS / Apple Silicon.

```sh
npm install
npm run setup
npm run build
npm start
```

Open **http://127.0.0.1:8765**. The API and UI share the same local server. No API key or paid service is required. The first setup installs Python dependencies and downloads approximately 354 MB of open voice models (or reuses a matching local cache). Subsequent rendering runs locally without network access. Fonts are bundled locally too.

For development:

```sh
npm run dev
```

This starts the Python API on port 8765 and Vite on **http://127.0.0.1:5173**. Stop either mode with Ctrl+C. `CHOIRE_PORT` can change the production port; development uses the fixed API proxy on 8765.

## Compose

1. Start with **A little light**, the included four-part, 16-singer score. Press **Render choir**, then play. The first render loads the model and prepares the words; later renders reuse analyzed syllables.
2. Select a vocal part on the left. Click an empty grid position to add a note; **+ Note** appends one after the part’s last note. Drag notes to change pitch/time and drag their right edge to resize. Each part is monophonic; use other parts for harmony.
3. Select a note to edit its pitch, start, length, and lyric numerically. Arrow keys move a focused note; Shift+Up/Down changes octaves; Delete removes it. Snap supports one, half, or quarter beats.
4. Enter one word or syllable per note in **Lyrics**, then apply. Use hyphens for syllables, e.g. `to-geth-er`. Extra syllables are ignored with a message; unmatched notes keep their existing lyrics. English is the supported language.
5. Set voice color, singer count, part volume/pan, pitch/timing variation, vibrato, and room ambience. Mute/solo affects rendering. **New performance** changes the ensemble variation seed, preserving the score.
6. Re-render after edits. Playback/export is marked stale until the new score has been rendered. Undoing to the exact rendered score makes that audio available again.
7. Export **24-bit / 24 kHz stereo WAV**, or download the **Stems** ZIP (mix, individual WAVs, and score JSON). Exported stems use the same master gain as the mix, so they sum back to it.

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
