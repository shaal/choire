"""Real model checks: pitch follows notes, old projects migrate, cache is stable."""

import json
import threading
from pathlib import Path

import numpy as np
import pytest
import pyworld as pw
import soundfile as sf
from pydantic import ValidationError

from backend.schema import Score
from backend.singing import SingingEngine, allocate_frames, SR


def singing_score():
    data = json.loads(Path("public/demo.choire.json").read_text())
    data.update(
        engine="diffsinger", bpm=120, room=0, timing=0, dispersion=0, vibrato=0.85
    )
    data["tracks"] = data["tracks"][:1]
    data["tracks"][0].update(
        voice="nishiren-standard",
        singers=1,
        pan=0,
        gain=1,
        notes=[
            dict(id="one", pitch=60, start=0, duration=2, lyric="light", velocity=0.8),
            dict(id="two", pitch=67, start=3, duration=2, lyric="shine", velocity=0.8),
        ],
    )
    return Score.model_validate(data)


def test_legacy_projects_and_engine_voice_validation():
    old = Score.model_validate_json(Path("public/demo.choire.json").read_text())
    assert old.engine == "kokoro-world"
    bad = old.model_dump()
    bad["engine"] = "diffsinger"
    with pytest.raises(ValidationError, match="match"):
        Score.model_validate(bad)
    bad = singing_score().model_dump()
    bad["bpm"] = 40
    bad["tracks"][0]["notes"] = [
        dict(id="long", pitch=60, start=0, duration=16, lyric="ah")
    ]
    with pytest.raises(ValidationError, match="16 seconds"):
        Score.model_validate(bad)


def test_duration_budget_and_short_notes():
    for total in [4, 7, 123, 1000]:
        durations = allocate_frames([0.01, 2, 0.3, 0.02], total)
        assert sum(durations) == total and min(durations) >= 1
    with pytest.raises(ValueError, match="short note"):
        allocate_frames([1, 1, 1], 2)


def test_real_singing_and_repeatable_cached_performance(tmp_path):
    engine = SingingEngine()
    if not engine.available:
        pytest.skip("Run npm run setup:singing for real neural audio tests.")
    score = singing_score()
    result = engine.render(
        score, tmp_path / "first", lambda *_: None, threading.Event()
    )
    y, sr = sf.read(tmp_path / "first/choire-mix.wav")
    assert sr == SR and result["sampleRate"] == 44100
    assert y.shape == (round(4.5 * SR), 2)
    assert 0.01 < result["peak"] <= 0.941
    assert sf.info(tmp_path / "first/choire-mix.wav").subtype == "PCM_24"
    for start, end, midi in [(0.2, 0.8, 60), (1.7, 2.3, 67)]:
        mono = np.ascontiguousarray(y[round(start * SR) : round(end * SR)].mean(axis=1))
        f, t = pw.dio(mono, SR, f0_floor=65, f0_ceil=900)
        f = pw.stonemask(mono, f, t, SR)
        voiced = f[f > 0]
        assert len(voiced) > 20
        assert abs(69 + 12 * np.log2(np.median(voiced) / 440) - midi) < 1
    engine.render(score, tmp_path / "repeat", lambda *_: None, threading.Event())
    repeated, _ = sf.read(tmp_path / "repeat/choire-mix.wav")
    assert np.array_equal(y, repeated)
    assert "Nishiren" in (tmp_path / "first/VOICE-CREDITS.txt").read_text()
    with pytest.raises(ValueError, match="pronunciation"):
        engine.pronounce("zqxqzzq")
