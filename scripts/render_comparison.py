"""Render the same dry solo score through both engines, with matched RMS levels."""

import json
import sys
import threading
from pathlib import Path

import numpy as np
import soundfile as sf
from scipy.signal import resample_poly

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from backend.engine import ChoirEngine
from backend.schema import Score
from backend.singing import SingingEngine

data = json.loads((ROOT / "public/demo.choire.json").read_text())
data.update(room=0, dispersion=0, timing=0)
data["tracks"] = data["tracks"][:1]
data["tracks"][0].update(singers=1, gain=1, pan=0)
dest = ROOT / "artifacts/comparison"
audio = []
for name, engine, voice, expression in [
    ("before", ChoirEngine(), "af_heart", 0.35),
    ("after", SingingEngine(), "nishiren-standard", 0.85),
]:
    data.update(
        engine="diffsinger" if name == "after" else "kokoro-world", vibrato=expression
    )
    data["tracks"][0]["voice"] = voice
    engine.render(
        Score.model_validate(data),
        dest / name,
        lambda _, m: print(m, flush=True),
        threading.Event(),
    )
    y, sr = sf.read(dest / name / "choire-mix.wav")
    if sr != 44100:
        y = resample_poly(y, 147, 80, axis=0)
    audio.append(y)

# Match active-phrase RMS, with one lower common target if either would clip.
active = round(16 * 60 / data["bpm"] * 44100)
rms = [float(np.sqrt(np.mean(y[:active] ** 2))) for y in audio]
target = min(0.12, *(r * 0.94 / float(np.max(np.abs(y))) for r, y in zip(rms, audio)))
for name, y, r in zip(["before-original", "after-neural"], audio, rms):
    sf.write(dest / f"{name}.wav", y * target / r, 44100, subtype="PCM_24")
(dest / "comparison.json").write_text(
    json.dumps(
        {
            "phrase": "May our light shine on",
            "bpm": data["bpm"],
            "dry": True,
            "activeRms": target,
            "before": "Kokoro + WORLD, Clara",
            "after": "DiffSinger, Nishiren by Gardanana",
            "note": "Same notes, lyrics, timing, singer count; different voice sources. RMS matched, no reverb. Naturalness needs listening.",
        },
        indent=2,
    )
)
print(f"Comparison written to {dest}")
