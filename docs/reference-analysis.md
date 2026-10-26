# Reference analysis — 2026-10-26

## Scope and evidence

Target: https://dreamtonics.com/choir-voices/

The user explicitly clarified that the deliverable is a working choir music tool, not a reproduction of the website. The Leanrea skill was installed from https://github.com/aicodeking/leanrea (`leanrea/SKILL.md`). This analysis follows its distinction between observed evidence, inference, and unknowns.

**Seen — published product behavior:** The product page describes note/lyric entry, four vocal sections, adjustable ensemble size, variation in pitch/timing, multilingual singing, expression controls, and integration with Synthesizer V Studio 2 Pro. Its numbered workflow describes choosing voices, language, part, singer count, dispersion, expression/retakes, and room simulation. These are vendor descriptions, not independently observed execution of the proprietary product.

**Seen — product boundary:** The page and FAQ say the voice collections run inside Synthesizer V Studio 2 Pro. The linked trial page offers an installable desktop application: https://dreamtonics.com/download-free-trials/. The website itself is not the singing engine.

**Seen — access limitation:** Text content was available through web retrieval. Direct local HTTP retrieval returned 403, so no website JavaScript inventory was obtained. No desktop binary or commercial voice pack was downloaded, disassembled, or executed.

**Inferred — independent architecture:** A score editor, a voice source, independent pitch/duration control, multiple singer realizations, and a mixer can reproduce a subset of the user-visible workflow. This does not establish how Dreamtonics implements those features.

**Unknown:** Proprietary model architecture/weights, training recordings, exact phoneme/duration alignment, ensemble interaction model, internal file formats, native rendering API, and quality/performance characteristics under matched inputs. We cannot reconstruct these from a marketing page and have not claimed to do so.

## Implemented mapping

| User-visible behavior | Independent implementation | Boundary |
|---|---|---|
| Notes + lyrics | Editable piano roll with per-note English text | One part is monophonic; explicit syllable separation |
| Vocal sections | Soprano, alto, tenor, bass | Shared open TTS model with selectable source voice embeddings |
| Ensemble size | 1–16 singers per part | Independent resynthesized variants, not a trained interacting choir |
| Pitch and timing differences | Per-singer tuning, drift, onset variation | Heuristic DSP |
| Expression | Vibrato, velocity in score, volume, pan | No proprietary expression pad or neural retake model |
| Different performances | Seeded variation | Same source words and score; WORLD synthesis is not promised bit-identical |
| Room simulation | Stereo algorithmic convolution ambience | Synthetic impulse response |
| Production output | Stereo 24-bit WAV + per-part stems + MIDI + JSON | Local browser app; no VST/AU/ARA plugin |
| Language | English | Six-language equivalence is not implemented |

## Audio pipeline

1. Kokoro synthesizes each word/syllable using an open voice embedding.
2. WORLD analyzes pitch, spectral envelope, and aperiodicity. Analyses are cached.
3. The attack and release are preserved within a short-note budget; the voiced middle is stretched to the note length.
4. Pitch is set from MIDI note frequency, with optional drift and vibrato. Each singer gets small spectral, tuning, spatial, and onset differences.
5. Notes are placed on the score timeline, singers are combined into part stems, ambience is applied, and the stems are mixed with a common peak-safe gain.

This is a speech-to-singing prototype. A model trained for phoneme-aligned singing, and ultimately for ensembles, is the major missing component for professional realism. The app intentionally labels the engine experimental.
