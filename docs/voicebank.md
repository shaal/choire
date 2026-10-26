# Singing engine and voicebank

Choire implements the DiffSinger ONNX inference pipeline in Python: English text → phonemes → learned duration → learned pitch → breathiness/voicing/tension → acoustic mel spectrogram → pitch-conditioned HiFi-GAN waveform. Connected notes share phrase context. Onset consonants anticipate later notes, so their vowels can land on the beat. No speech stretching or WORLD processing is used in this path.

The supported bank is **Nishiren Diffsinger v2.1 by Gardanana**, downloaded separately as the complete, unmodified release. Standard, Soft, Sweet, and Power are styles of that same voice, not four independent singer identities. Each ensemble member gets a separate neural performance, small pitch/timbre differences, timing, and pan. The voicebank's published range is G3–D5; lower bass notes remain playable, but can sound less natural. Choire flags out-of-range parts without changing the composition.

## Setup and use

Run `npm run setup:singing`, then select **Neural singing · DiffSinger**. This downloads a 624 MB archive and verifies SHA-256 `138baf89820fc9084fc8b2313cb80b3f6ab0974009e2b3638646d7036f73a5c7`. Extracted files are checked against the archive CRCs. Models and all included assets stay in the ignored `.models/diffsinger/` folder. `CHOIRE_SINGING_BANK` can point to another installation of this same bank.

New projects use neural singing with two performances per part. Older saved projects without an engine field retain the original Kokoro/WORLD engine. Switching engines preserves notes, timing, lyrics, and singer counts, and assigns compatible voice colors. Undo restores the previous engine and voices.

English dictionary words and `ah`, `oh`, `oo`, `ooh`, `la`, `mm` are supported. Unknown words produce an actionable error; they are never silently omitted. Arbitrary phoneme editing, automatic multi-note syllable alignment, and other languages are not implemented. Prefer one word per note. The pitch-expression slider controls the trained model's expressiveness; it is not a synthetic vibrato amount.

Phrases split at gaps over 300 ms or a 16-second boundary. Individual notes cannot exceed 16 seconds. Cancellation takes effect between native model stages, so a running ONNX call must finish first. Each successful phrase performance is cached; changing mix/pan/room reuses those vocals. The seed identifies variation and cached performances. Deleting the cache can produce a different neural realization even with the same seed, because ONNX sampling also has internal random state.

Outputs are native 44.1 kHz, stereo PCM-24. The stems ZIP includes `VOICE-CREDITS.txt`. Model inference is entirely local on CPU; no generated audio is sent to a service.

## Voicebank terms

[Nishiren's terms](https://github.com/Gardanana/Nishiren-AI-Diffsinger/blob/main/terms-of-service.md) are separate from the software libraries' licenses. Non-commercial use is allowed without approval. Publishing requires the voicebank's name; commercial use requires Gardanana's permission. The terms also restrict political/religious content, certain other uses, and training on source or generated audio. Read the full terms for your intended work. The local integration uses the original bank files in a compatible synthesizer and does not convert or alter them. Models are not committed or redistributed in this repository.

## Sources

- [Nishiren v2.1 release](https://github.com/Gardanana/Nishiren-AI-Diffsinger/releases/tag/v2.1), [voicebank overview](https://github.com/Gardanana/Nishiren-AI-Diffsinger), [usage guide](https://github.com/Gardanana/Nishiren-AI-Diffsinger/blob/main/usage-guide.md).
- [OpenVPI DiffSinger](https://github.com/openvpi/DiffSinger): ONNX model format and singing architecture, Apache-2.0 code license.
- [OpenUtau DiffSinger integration](https://github.com/stakira/OpenUtau/tree/master/OpenUtau.Core/DiffSinger): tensor contracts, pitch units, language IDs, note/rest conditioning, and compatible inference order. MIT notice is retained in `THIRD_PARTY_NOTICES.md`.
- [CMUdict](https://github.com/cmusphinx/cmudict): English pronunciations, combined with the bank's own pronunciation overrides. Packaged through `cmudict` with upstream licenses retained in the Python installation.

These are public interoperability sources. No Dreamtonics binary, model, or recorded voice was extracted or used.
