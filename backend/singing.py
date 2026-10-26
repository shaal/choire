"""Phrase-based DiffSinger inference with the unmodified Nishiren v2.1 voicebank.

The voicebank is downloaded separately and has its own usage terms. Tensor
contracts follow OpenVPI's ONNX exports and OpenUtau's public interoperability
code. See docs/voicebank.md and THIRD_PARTY_NOTICES.md.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import threading
from pathlib import Path

import cmudict
import numpy as np
import onnxruntime as ort
import soundfile as sf
import yaml
from scipy.ndimage import gaussian_filter1d
from scipy.signal import fftconvolve

from .engine import ROOT, RenderCancelled

SR = 44100
HOP = 512
PAD = 20
BANK = Path(
    os.environ.get(
        "CHOIRE_SINGING_BANK",
        ROOT / ".models/diffsinger/nishiren-v2.1/Nishiren Diffsinger v2.1",
    )
)
STYLES = {
    "nishiren-standard": "Standard",
    "nishiren-soft": "Soft",
    "nishiren-sweet": "Sweet",
    "nishiren-power": "Power",
}
VOWELS = set("aa ae ah ao aw ax ay eh er ey ih iy ow oy uh uw".split())


def allocate_frames(weights, total):
    """Positive phone lengths with an exact group budget (no accumulated drift)."""
    weights = np.maximum(np.asarray(weights, dtype=np.float64), 0)
    if total < len(weights):
        raise ValueError(
            "Too many phonemes for this short note. Lengthen it or use one syllable."
        )
    if not np.isfinite(weights).all():
        raise ValueError("The duration model produced invalid phoneme lengths.")
    scaled = weights / max(float(weights.sum()), 1e-9) * (total - len(weights))
    if weights.sum() == 0:
        scaled[:] = (total - len(weights)) / len(weights)
    result = np.floor(scaled).astype(np.int64) + 1
    remainder = total - int(result.sum())
    result[np.argsort(-(scaled - np.floor(scaled)))[:remainder]] += 1
    return result


class SingingEngine:
    def __init__(self, bank=BANK):
        self.bank = Path(bank)
        self._sessions = {}
        self._maps = {}
        self._embeds = {}
        self._dictionary = None
        self._lock = threading.Lock()

    @property
    def available(self):
        return all(
            (self.bank / p).is_file()
            for p in (
                "dsdur/linguistic.onnx",
                "dsdur/dur.onnx",
                "dspitch/linguistic.onnx",
                "dspitch/pitch.onnx",
                "dsvariance/linguistic.onnx",
                "dsvariance/variance.onnx",
                "dsmain/acoustic.onnx",
                "dsvocoder/gda_pc-hifigan.onnx",
            )
        )

    def session(self, component, model):
        key = (component, model)
        if key not in self._sessions:
            options = ort.SessionOptions()
            options.intra_op_num_threads = min(4, os.cpu_count() or 2)
            options.inter_op_num_threads = 1
            self._sessions[key] = ort.InferenceSession(
                str(self.bank / component / f"{model}.onnx"),
                sess_options=options,
                providers=["CPUExecutionProvider"],
            )
        return self._sessions[key]

    def run(self, component, model, inputs, check):
        check()
        result = self.session(component, model).run(None, inputs)
        check()
        if any(not np.isfinite(a).all() for a in result):
            raise ValueError(f"Invalid audio model output at {component}/{model}.")
        return result

    def tokens(self, component, phones):
        if component not in self._maps:
            self._maps[component] = json.loads(
                (self.bank / component / "phonemes.json").read_text()
            )
        mapping = self._maps[component]
        return {
            "tokens": np.array([[mapping[p] for p in phones]], dtype=np.int64),
            "languages": np.array(
                [[3 if p.startswith("en/") else 0 for p in phones]], dtype=np.int64
            ),
        }

    def embedding(self, component, style, length):
        key = component, style
        if key not in self._embeds:
            self._embeds[key] = np.fromfile(
                self.bank / component / "embeds" / f"{style}.emb", dtype="<f4"
            )
        return np.broadcast_to(
            self._embeds[key], (1, length, len(self._embeds[key]))
        ).copy()

    def pronounce(self, lyric):
        if self._dictionary is None:
            dictionary = {
                word: ["en/" + re.sub(r"\d", "", p).lower() for p in variants[0]]
                for word, variants in cmudict.dict().items()
            }
            with (self.bank / "dsdur/dsdict-en.yaml").open() as f:
                overrides = yaml.load(f, Loader=yaml.CSafeLoader)
            dictionary.update(
                {e["grapheme"].lower(): e["phonemes"] for e in overrides["entries"]}
            )
            dictionary.update(
                {
                    "ah": ["en/aa"],
                    "oh": ["en/ow"],
                    "oo": ["en/uw"],
                    "ooh": ["en/uw"],
                    "la": ["en/l", "en/aa"],
                    "mm": ["en/m", "en/ax", "en/m"],
                }
            )
            # Publish a complete dictionary atomically; arranging and rendering
            # may ask for pronunciations on different API worker threads.
            self._dictionary = dictionary
        words = re.findall(r"[a-z]+(?:'[a-z]+)?", lyric.lower())
        phones = []
        for word in words:
            if word not in self._dictionary:
                raise ValueError(
                    f"No English pronunciation for ‘{word}’. Try a dictionary word or ah, oh, oo, la."
                )
            phones.extend(self._dictionary[word])
        if not phones or not any(p.removeprefix("en/") in VOWELS for p in phones):
            raise ValueError(f"‘{lyric}’ needs an English word or a sung vowel.")
        return phones

    def phrase(self, notes, bpm, style, expression, dispersion, seed, check, report):
        """Render connected notes; each stage sees the entire phrase."""
        beat_frames = 60 / bpm * SR / HOP
        origin = notes[0].start
        groups = [["SP"]]
        lengths = [PAD]
        pitches = [notes[0].pitch]
        rests = [True]
        velocities = [0.0]
        cursor = 0
        for note in notes:
            start = round((note.start - origin) * beat_frames)
            end = round((note.start + note.duration - origin) * beat_frames)
            if start > cursor:
                groups.append(["SP"])
                lengths.append(start - cursor)
                pitches.append(note.pitch)
                rests.append(True)
                velocities.append(0.0)
            phones = self.pronounce(note.lyric)
            # Anticipate consonants so the vowel, rather than the consonant, lands
            # on the beat. Keep the first attack inside the exported timeline.
            onset = next(
                i for i, p in enumerate(phones) if p.removeprefix("en/") in VOWELS
            )
            if len(groups) > 1 and onset and lengths[-1] > len(groups[-1]) + onset:
                groups[-1].extend(phones[:onset])
                phones = phones[onset:]
            groups.append(phones)
            lengths.append(end - start)
            pitches.append(note.pitch)
            rests.append(False)
            velocities.append(note.velocity)
            cursor = end
        groups.append(["SP"])
        lengths.append(PAD * 2)
        pitches.append(pitches[-1])
        rests.append(True)
        velocities.append(0.0)
        phones = [p for group in groups for p in group]
        div = np.array([[len(g) for g in groups]], dtype=np.int64)
        word_dur = np.array([lengths], dtype=np.int64)
        frames = sum(lengths)
        zeros = np.zeros((1, frames), dtype=np.float32)
        ones = np.ones_like(zeros)
        steps = np.array(20, dtype=np.int64)
        report("Predicting pronunciation and timing")
        enc, masks = self.run(
            "dsdur",
            "linguistic",
            {**self.tokens("dsdur", phones), "word_div": div, "word_dur": word_dur},
            check,
        )
        raw_dur = self.run(
            "dsdur",
            "dur",
            {
                "encoder_out": enc,
                "x_masks": masks,
                "ph_midi": np.repeat(
                    np.array([pitches], dtype=np.int64), div[0], axis=1
                ),
                "word_div": div,
                "word_dur": word_dur,
                "spk_embed": self.embedding("dsdur", style, len(phones)),
            },
            check,
        )[0][0]
        durations = []
        offset = 0
        for group, length in zip(groups, lengths):
            durations.extend(
                allocate_frames(raw_dur[offset : offset + len(group)], length)
            )
            offset += len(group)
        ph_dur = np.array([durations], dtype=np.int64)
        report("Shaping the sung pitch")
        enc = self.run(
            "dspitch",
            "linguistic",
            {**self.tokens("dspitch", phones), "ph_dur": ph_dur},
            check,
        )[0]
        pitch = self.run(
            "dspitch",
            "pitch",
            {
                "encoder_out": enc,
                "ph_dur": ph_dur,
                "note_midi": np.array([pitches], dtype=np.float32),
                "note_rest": np.array([rests], dtype=bool),
                "note_dur": word_dur,
                "pitch": ones * 60,
                "expr": ones * expression,
                "retake": np.ones((1, frames), dtype=bool),
                "spk_embed": self.embedding("dspitch", style, frames),
                "steps": steps,
            },
            check,
        )[0]
        rng = np.random.default_rng(seed)
        drift = gaussian_filter1d(rng.normal(size=frames), 18)
        pitch += (rng.normal(0, 0.08) + drift * 0.15) * dispersion
        report("Predicting breath and vocal expression")
        enc = self.run(
            "dsvariance",
            "linguistic",
            {**self.tokens("dsvariance", phones), "ph_dur": ph_dur},
            check,
        )[0]
        variance = self.run(
            "dsvariance",
            "variance",
            {
                "encoder_out": enc,
                "ph_dur": ph_dur,
                "pitch": pitch,
                "breathiness": zeros,
                "voicing": zeros,
                "tension": zeros,
                "retake": np.ones((1, frames, 3), dtype=bool),
                "spk_embed": self.embedding("dsvariance", style, frames),
                "steps": steps,
            },
            check,
        )
        f0 = (440 * 2 ** ((pitch - 69) / 12)).astype(np.float32)
        report("Singing the connected phrase")
        mel = self.run(
            "dsmain",
            "acoustic",
            {
                **self.tokens("dsmain", phones),
                "durations": ph_dur,
                "f0": f0,
                **dict(zip(("breathiness", "voicing", "tension"), variance)),
                "gender": ones * rng.normal(0, 0.2) * dispersion,
                "velocity": ones,
                "spk_embed": self.embedding("dsmain", style, frames),
                "steps": steps,
            },
            check,
        )[0]
        report("Generating the vocal waveform")
        y = self.run("dsvocoder", "gda_pc-hifigan", {"mel": mel, "f0": f0}, check)[
            0
        ].reshape(-1)
        # Smooth note dynamics; preserve natural release, but silence model padding.
        env = np.repeat(velocities, lengths).astype(np.float32)
        env[:PAD] = velocities[1]
        env[-PAD * 2 :] = velocities[-2]
        env = gaussian_filter1d(env, 2)
        y *= np.interp(np.arange(len(y)) / HOP, np.arange(frames), env)
        y = y[PAD * HOP :]
        edge = min(round(0.008 * SR), len(y) // 4)
        y[:edge] *= np.linspace(0, 1, edge)
        y[-edge:] *= np.linspace(1, 0, edge)
        return y, {
            "phonemes": phones,
            "durations": [int(d) for d in durations],
            "pitchMin": float(pitch.min()),
            "pitchMax": float(pitch.max()),
        }

    def render(self, score, folder, progress, cancelled):
        with self._lock:
            return self._render(score, folder, progress, cancelled)

    def _render(self, score, folder, progress, cancelled):
        def check():
            if cancelled.is_set():
                raise RenderCancelled()

        check()
        if not self.available:
            raise RuntimeError("Singing voicebank missing. Run npm run setup:singing.")
        tracks = score.audible_tracks()
        if not tracks:
            raise ValueError("Add notes to an unmuted part before rendering.")
        # Resolve all lyrics before expensive synthesis; never silently drop words.
        for track in tracks:
            for note in track.notes:
                self.pronounce(note.lyric)
        folder.mkdir(parents=True, exist_ok=True)
        cache = ROOT / ".cache" / "singing-v1"
        cache.mkdir(parents=True, exist_ok=True)
        beat = 60 / score.bpm
        size = int(
            np.ceil(
                (max(n.start + n.duration for t in tracks for n in t.notes) * beat + 2)
                * SR
            )
        )
        mix = np.zeros((size, 2), dtype=np.float64)
        stems = []
        tasks = []
        for ti, track in enumerate(tracks):
            phrases = []
            for note in sorted(track.notes, key=lambda n: n.start):
                if (
                    not phrases
                    or (note.start + note.duration - phrases[-1][0].start) * beat > 16
                    or (note.start - phrases[-1][-1].start - phrases[-1][-1].duration)
                    * beat
                    > 0.3
                ):
                    phrases.append([])
                phrases[-1].append(note)
            for phrase in phrases:
                for singer in range(track.singers):
                    tasks.append((ti, track, phrase, singer))
            stems.append(
                (folder / f"{ti + 1:02d}-{track.part}.wav", np.zeros_like(mix))
            )
        for done, (ti, track, notes, singer) in enumerate(tasks):
            check()
            seed = (
                score.seed
                + int(hashlib.sha256(track.id.encode()).hexdigest()[:8], 16)
                + singer * 997
            ) % (2**31)
            key = hashlib.sha256(
                json.dumps(
                    {
                        "bank": "nishiren-v2.1",
                        "notes": [n.model_dump() for n in notes],
                        "bpm": score.bpm,
                        "style": track.voice,
                        "expression": score.vibrato,
                        "dispersion": score.dispersion,
                        "seed": seed,
                    },
                    sort_keys=True,
                ).encode()
            ).hexdigest()
            path = cache / f"{key}.npy"

            def report(message):
                progress(
                    0.02 + 0.88 * done / len(tasks),
                    f"{track.name} · singer {singer + 1}/{track.singers} · {message}",
                )

            if path.is_file():
                report("Using the saved vocal performance")
                y = np.load(path, allow_pickle=False)
            else:
                y, _ = self.phrase(
                    notes,
                    score.bpm,
                    STYLES[track.voice],
                    score.vibrato,
                    score.dispersion,
                    seed,
                    check,
                    report,
                )
                temporary = path.with_suffix(".tmp")
                with temporary.open("wb") as f:
                    np.save(f, y, allow_pickle=False)
                temporary.replace(path)
            check()
            rng = np.random.default_rng(seed)
            shift = rng.normal(0, 0.02 * score.timing) if track.singers > 1 else 0
            # Never cut off the first consonant for an early ensemble entrance.
            start = max(0, round((notes[0].start * beat + shift) * SR))
            end = min(size, start + len(y))
            spread = (
                (singer / (track.singers - 1) * 2 - 1) * 0.4 if track.singers > 1 else 0
            )
            pan = np.clip(track.pan + spread, -1, 1)
            gains = np.array(
                [np.cos((pan + 1) * np.pi / 4), np.sin((pan + 1) * np.pi / 4)]
            )
            stems[ti][1][start:end] += (
                y[: end - start, None] * gains * track.gain / np.sqrt(track.singers)
            )
        for ti, (_, stem) in enumerate(stems):
            check()
            if score.room > 0:
                rng = np.random.default_rng(score.seed + ti)
                t = np.arange(int(SR * 1.6)) / SR
                for channel in range(2):
                    ir = rng.normal(size=len(t)) * np.exp(-t / 0.33)
                    ir[: round(0.028 * SR)] = 0
                    ir /= np.sqrt(np.sum(ir**2))
                    stem[:, channel] += (
                        score.room * 0.28 * fftconvolve(stem[:, channel], ir)[:size]
                    )
            mix += stem
        check()
        progress(0.96, "Writing the singing mix, stems, and voice credits")
        peak = max(
            float(np.max(np.abs(mix))), *(float(np.max(np.abs(y))) for _, y in stems)
        )
        gain = min(1.0, 0.94 / max(peak, 1e-9))
        mix *= gain
        sf.write(folder / "choire-mix.wav", mix, SR, subtype="PCM_24")
        for path, stem in stems:
            sf.write(path, stem * gain, SR, subtype="PCM_24")
        (folder / "project.choire.json").write_text(score.model_dump_json(indent=2))
        (folder / "VOICE-CREDITS.txt").write_text(
            "Singing voice: Nishiren Diffsinger v2.1 by Gardanana.\n"
            "Attribute Nishiren when publishing these vocals. Commercial use requires author approval.\n"
            "Voicebank terms (including content restrictions):\n"
            "https://github.com/Gardanana/Nishiren-AI-Diffsinger/blob/main/terms-of-service.md\n"
            "Multiple performances of one voicebank; vocal modes are styles, not different singers.\n"
        )
        outside = sum(n.pitch < 55 or n.pitch > 74 for t in tracks for n in t.notes)
        return {
            "duration": size / SR,
            "sampleRate": SR,
            "channels": 2,
            "bitDepth": 24,
            "peak": float(np.max(np.abs(mix))),
            "waveform": [float(np.max(np.abs(c))) for c in np.array_split(mix, 180)],
            "stems": [p.name for p, _ in stems],
            "singers": sum(t.singers for t in tracks),
            "engine": "DiffSinger · Nishiren v2.1",
            "voiceCredit": "Nishiren Diffsinger by Gardanana",
            "warnings": [
                f"{outside} notes lie outside this voicebank's published G3–D5 range; quality may vary."
            ]
            if outside
            else [],
        }
