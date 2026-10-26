"""Independent experimental singing engine: Kokoro speech source + WORLD resynthesis.

This is score-driven speech-to-singing, not a trained neural singing/choir model.
No Dreamtonics models, recordings, or application code are used.
"""

from __future__ import annotations
import hashlib
import os
import threading
from functools import lru_cache
from pathlib import Path
from typing import Callable
import numpy as np
import pyworld as pw
import soundfile as sf
from scipy.ndimage import gaussian_filter1d
from scipy.signal import fftconvolve
from .schema import Score

ROOT = Path(__file__).resolve().parent.parent
MODEL_DIR = Path(os.environ.get("CHOIRE_MODEL_DIR", ROOT / ".models"))
SR = 24000
FRAME_MS = 5.0


class RenderCancelled(Exception):
    pass


class ChoirEngine:
    def __init__(self):
        self._model = None
        self._lock = threading.Lock()

    @property
    def available(self):
        return all(
            (MODEL_DIR / f).is_file() for f in ("kokoro-v1.0.onnx", "voices-v1.0.bin")
        )

    def load(self):
        if self._model is None:
            if not self.available:
                raise RuntimeError("Voice model missing. Run npm run setup first.")
            from kokoro_onnx import Kokoro
            import onnxruntime as ort

            options = ort.SessionOptions()
            options.intra_op_num_threads = min(4, os.cpu_count() or 2)
            options.inter_op_num_threads = 1
            session = ort.InferenceSession(
                str(MODEL_DIR / "kokoro-v1.0.onnx"),
                sess_options=options,
                providers=["CPUExecutionProvider"],
            )
            self._model = Kokoro.from_session(
                session, str(MODEL_DIR / "voices-v1.0.bin")
            )

    @lru_cache(maxsize=128)
    def analyze(self, lyric: str, voice: str):
        self.load()
        key = hashlib.sha256(f"v2|{voice}|{lyric}".encode()).hexdigest()
        cache = ROOT / ".cache" / "syllables"
        cache.mkdir(parents=True, exist_ok=True)
        path = cache / f"{key}.npz"
        if path.exists():
            with np.load(path, allow_pickle=False) as d:
                return d["f0"], d["sp"], d["ap"]
        audio, sr = self._model.create(
            lyric,
            voice=voice,
            speed=0.85,
            lang="en-gb" if voice.startswith("b") else "en-us",
        )
        if sr != SR:
            raise RuntimeError(f"Unexpected source sample rate: {sr}")
        audio = np.ascontiguousarray(audio, dtype=np.float64)
        if len(audio) < SR // 20 or not np.any(np.abs(audio) > 0.0001):
            raise ValueError(
                f"No usable voice generated for {lyric!r}. Try a spelled-out syllable."
            )
        raw, times = pw.dio(audio, sr, f0_floor=65, f0_ceil=900, frame_period=FRAME_MS)
        f0 = pw.stonemask(audio, raw, times, sr)
        if np.count_nonzero(f0) < 3:
            f0, times = pw.harvest(
                audio, sr, f0_floor=65, f0_ceil=900, frame_period=FRAME_MS
            )
        if np.count_nonzero(f0) < 3:
            raise ValueError(
                f"No sustained vowel found in {lyric!r}. Use a syllable with a vowel."
            )
        sp = pw.cheaptrick(audio, f0, times, sr)
        ap = pw.d4c(audio, f0, times, sr)
        np.savez_compressed(path, f0=f0, sp=sp, ap=ap)
        return f0, sp, ap

    @staticmethod
    def stretch(f0, sp, ap, duration):
        """Preserve the attack/release and lengthen the voiced nucleus, not consonants."""
        frames = max(12, round(duration * 1000 / FRAME_MS))
        voiced = np.flatnonzero(f0 > 0)
        first, last = int(voiced[0]), int(voiced[-1])
        # Preserve the entire onset/coda, subject to a short-note duration budget.
        pre = min(first, max(1, frames // 4))
        post = min(len(f0) - last - 1, max(1, frames // 4))
        idx = np.concatenate(
            (
                np.linspace(0, first, pre, endpoint=False),
                np.linspace(first, last, frames - pre - post),
                np.linspace(last, len(f0) - 1, post),
            )
        )
        low = idx.astype(int)
        high = np.minimum(low + 1, len(f0) - 1)
        weight = (idx - low)[:, None]

        def interpolate(x):
            return np.ascontiguousarray(x[low] * (1 - weight) + x[high] * weight)

        mask = f0[np.rint(idx).astype(int)] > 0
        return mask, interpolate(sp), interpolate(ap)

    @staticmethod
    def sing(mask, sp, ap, pitch, vibrato, dispersion, rng, singer_offset=0.0):
        t = np.arange(len(mask)) * FRAME_MS / 1000
        phase = rng.uniform(0, 2 * np.pi)
        # Human fluctuations are independent per singer, and zero when controls are zero.
        drift = gaussian_filter1d(rng.normal(0, 1, len(mask)), sigma=12)
        cents = singer_offset + drift * dispersion * 55
        cents += (
            vibrato
            * 38
            * np.sin(2 * np.pi * rng.uniform(4.7, 5.5) * t + phase)
            * np.minimum(1, t / 0.25)
        )
        f0 = np.where(mask, 440 * 2 ** ((pitch - 69) / 12 + cents / 1200), 0.0)
        # Slight differences in each singer's vocal tract, independent of note pitch.
        warp = rng.uniform(0.985, 1.015)
        bins = np.arange(sp.shape[1])
        pos = np.minimum(bins * warp, len(bins) - 1)
        low = pos.astype(int)
        high = np.minimum(low + 1, len(bins) - 1)
        w = pos - low
        spectral = np.ascontiguousarray(sp[:, low] * (1 - w) + sp[:, high] * w)
        audio = pw.synthesize(np.ascontiguousarray(f0), spectral, ap, SR, FRAME_MS)
        edge = min(round(0.014 * SR), len(audio) // 4)
        audio[:edge] *= np.linspace(0, 1, edge)
        audio[-edge:] *= np.linspace(1, 0, edge)
        return audio

    def render(
        self, score: Score, folder: Path, progress: Callable, cancelled: threading.Event
    ):
        with self._lock:
            return self._render(score, folder, progress, cancelled)

    def _render(self, score, folder, progress, cancelled):
        tracks = score.audible_tracks()
        if not tracks:
            raise ValueError("Add notes to an unmuted part before rendering.")

        def check():
            if cancelled.is_set():
                raise RenderCancelled()

        check()
        folder.mkdir(parents=True, exist_ok=True)
        progress(0.01, "Loading the local voice model")
        self.load()
        beat = 60 / score.bpm
        duration = (
            max(n.start + n.duration for t in tracks for n in t.notes) * beat + 2.0
        )
        size = int(np.ceil(duration * SR))
        mix = np.zeros((size, 2))
        total = sum(len(t.notes) * t.singers for t in tracks)
        done = 0
        stems = []
        for ti, track in enumerate(tracks):
            stem = np.zeros((size, 2))
            for ni, note in enumerate(sorted(track.notes, key=lambda n: n.start)):
                check()
                progress(
                    0.02 + 0.9 * done / total,
                    f"{track.name} · preparing “{note.lyric}”",
                )
                analysis = self.analyze(note.lyric.strip().lower(), track.voice)
                stretched = self.stretch(*analysis, note.duration * beat)
                for singer in range(track.singers):
                    check()
                    rng = np.random.default_rng(
                        score.seed + ti * 100003 + ni * 997 + singer * 31
                    )
                    singer_rng = np.random.default_rng(
                        score.seed + ti * 100003 + singer * 31
                    )
                    detune = singer_rng.normal(0, 10 * score.dispersion)
                    y = self.sing(
                        *stretched,
                        note.pitch,
                        score.vibrato,
                        score.dispersion,
                        rng,
                        detune,
                    )
                    shift = (
                        rng.normal(0, 0.025 * score.timing) if track.singers > 1 else 0
                    )
                    start = round((note.start * beat + shift) * SR)
                    if start < 0:
                        y = y[-start:]
                        start = 0
                    end = min(size, start + len(y))
                    y = y[: end - start]
                    spread = (
                        ((singer / (track.singers - 1)) * 2 - 1) * 0.4
                        if track.singers > 1
                        else 0
                    )
                    pan = np.clip(track.pan + spread, -1, 1)
                    gains = np.array(
                        [np.cos((pan + 1) * np.pi / 4), np.sin((pan + 1) * np.pi / 4)]
                    )
                    # Keep ensemble loudness comparable while retaining the density change.
                    stem[start:end] += (
                        y[:, None]
                        * gains
                        * (track.gain * note.velocity / np.sqrt(track.singers))
                    )
                    done += 1
                    progress(
                        0.02 + 0.9 * done / total,
                        f"{track.name} · singer {singer + 1}/{track.singers}",
                    )
            if score.room > 0:
                rng = np.random.default_rng(score.seed + ti)
                irt = np.arange(int(SR * 1.6)) / SR
                for channel in range(2):
                    ir = rng.normal(0, 1, len(irt)) * np.exp(-irt / 0.33)
                    ir[: int(0.028 * SR)] = 0
                    ir /= np.sqrt(np.sum(ir**2))
                    stem[:, channel] += (
                        score.room * 0.28 * fftconvolve(stem[:, channel], ir)[:size]
                    )
            mix += stem
            stem_path = folder / f"{ti + 1:02d}-{track.part}.wav"
            stems.append((stem_path, stem))
        check()
        progress(0.95, "Writing the mix and individual stems")
        # One shared gain keeps the sum of exported stems equal to the exported mix.
        peak = max(
            float(np.max(np.abs(mix))), *(float(np.max(np.abs(s))) for _, s in stems)
        )
        gain = min(1.0, 0.94 / max(peak, 1e-9))
        mix *= gain
        sf.write(folder / "choire-mix.wav", mix, SR, subtype="PCM_24")
        for path, stem in stems:
            sf.write(path, stem * gain, SR, subtype="PCM_24")
        (folder / "project.choire.json").write_text(score.model_dump_json(indent=2))
        waveform = [float(np.max(np.abs(chunk))) for chunk in np.array_split(mix, 180)]
        return {
            "duration": size / SR,
            "sampleRate": SR,
            "channels": 2,
            "bitDepth": 24,
            "peak": float(np.max(np.abs(mix))),
            "waveform": waveform,
            "stems": [p.name for p, _ in stems],
            "singers": sum(t.singers for t in tracks),
            "engine": "Kokoro + WORLD · experimental speech-to-singing",
        }
