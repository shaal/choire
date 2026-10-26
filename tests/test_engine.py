from pathlib import Path
import threading
import numpy as np
import pyworld as pw
import soundfile as sf
import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError
from backend.schema import Score
from backend.engine import ChoirEngine, SR, RenderCancelled
from backend.app import app


@pytest.fixture
def score():
    return Score.model_validate_json(Path("public/demo.choire.json").read_text())


def test_score_rejects_overlaps_and_nonfinite_values(score):
    bad = score.model_dump()
    bad["tracks"][0]["notes"][1]["start"] = 1
    with pytest.raises(ValidationError, match="overlapping"):
        Score.model_validate(bad)
    bad = score.model_dump()
    bad["room"] = float("nan")
    with pytest.raises(ValidationError):
        Score.model_validate(bad)


def test_audio_is_real_pitched_singing(score, tmp_path):
    data = score.model_dump()
    data["tracks"] = data["tracks"][:1]
    t = data["tracks"][0]
    t.update(singers=1, pan=0, gain=1)
    t["notes"] = [
        dict(id="one", pitch=69, start=0, duration=2, lyric="light", velocity=0.8)
    ]
    data.update(bpm=120, dispersion=0, timing=0, vibrato=0, room=0)
    engine = ChoirEngine()
    result = engine.render(
        Score.model_validate(data), tmp_path, lambda *_: None, threading.Event()
    )
    audio, sr = sf.read(tmp_path / "choire-mix.wav")
    assert sr == SR and audio.shape == (3 * SR, 2)
    assert result["peak"] > 0.02 and result["peak"] <= 0.941
    assert sf.info(tmp_path / "choire-mix.wav").subtype == "PCM_24"
    mono = np.ascontiguousarray(audio[:SR].mean(axis=1))
    f, times = pw.dio(mono, sr, f0_floor=60, f0_ceil=900)
    f = pw.stonemask(mono, f, times, sr)
    voiced = f[f > 0]
    assert len(voiced) > 30
    assert abs(1200 * np.log2(np.median(voiced) / 440)) < 10
    assert np.allclose(audio[:, 0], audio[:, 1], atol=1e-6)


def test_changing_note_changes_measured_pitch():
    engine = ChoirEngine()
    analysis = engine.analyze("ah", "af_heart")
    features = engine.stretch(*analysis, 1)
    for note, expected in [(60, 261.625565), (69, 440)]:
        y = engine.sing(*features, note, 0, 0, np.random.default_rng(42))
        f, t = pw.dio(np.ascontiguousarray(y), SR, f0_floor=60, f0_ceil=900)
        f = pw.stonemask(y, f, t, SR)
        f = f[f > 0]
        assert abs(1200 * np.log2(np.median(f) / expected)) < 15


def test_cancellation_stops_before_render(score, tmp_path):
    cancelled = threading.Event()
    cancelled.set()
    with pytest.raises(RenderCancelled):
        ChoirEngine().render(score, tmp_path, lambda *_: None, cancelled)


def test_stems_sum_to_mix():
    folder = Path("artifacts/demo")
    if not folder.exists():
        pytest.skip("Run render_demo.py for integration fixture.")
    mix, sr = sf.read(folder / "choire-mix.wav")
    stems = [sf.read(path)[0] for path in folder.glob("0*.wav")]
    assert len(stems) == 4
    assert max(np.abs(np.sum(stems, axis=0) - mix).flat) < 1e-6
    assert mix.shape[1] == 2 and sr == SR
    assert np.sqrt(np.mean(mix**2)) > 0.01
    assert not np.allclose(mix[:, 0], mix[:, 1])


def test_mute_solo_and_empty_render(score):
    score.tracks[0].solo = True
    assert [t.part for t in score.audible_tracks()] == ["soprano"]
    score.tracks[0].mute = True
    assert not score.audible_tracks()
    client = TestClient(app)
    assert client.post("/api/render", json=score.model_dump()).status_code == 422


def test_validation_and_file_paths(score):
    client = TestClient(app)
    assert client.post("/api/validate", json=score.model_dump()).status_code == 200
    bad = score.model_dump()
    bad["tracks"][0]["voice"] = "unknown"
    assert client.post("/api/validate", json=bad).status_code == 422
    assert client.get("/api/stems/not-a-render").status_code == 404
    assert client.get("/api/jobs/unknown").status_code == 404
    assert client.get("/api/audio/" + 32 * "a" + "/requirements.txt").status_code == 404
