import re

import pytest
from fastapi.testclient import TestClient

from backend.app import app
from backend.arrange import arrange, PACE, CHARACTERS
from backend.schema import ArrangeRequest, Score
from backend.singing import SingingEngine


@pytest.fixture(scope="module")
def pronounce():
    engine = SingingEngine()
    if not engine.available:
        pytest.skip("Run npm run setup:singing for the voicebank dictionary.")
    return engine.pronounce


def test_every_preset_keeps_words_harmony_and_range(pronounce):
    lyrics = "Let the morning find us here\nWe are home beneath the stars"
    expected = re.findall(r"[a-zA-Z]+", lyrics)
    for pace in PACE:
        for character in CHARACTERS:
            for variation in range(6):
                score = arrange(
                    ArrangeRequest(
                        lyrics=lyrics,
                        pace=pace,
                        character=character,
                        variation=variation,
                    ),
                    pronounce,
                )
                Score.model_validate(score.model_dump())
                assert score.bpm == PACE[pace]
                assert score.engine == "diffsinger"
                for track in score.tracks:
                    assert [n.lyric for n in track.notes] == expected
                    assert all(55 <= n.pitch <= 74 for n in track.notes)
                    assert all(n.duration * 60 / score.bpm <= 16 for n in track.notes)
                    assert (
                        track.notes[6].start
                        > track.notes[5].start + track.notes[5].duration
                    )
                    assert track.singers == CHARACTERS[character]["singers"]
                for chord in zip(*(t.notes for t in score.tracks)):
                    pitch_classes = {n.pitch % 12 for n in chord}
                    assert pitch_classes in [
                        {7, 11, 2},
                        {4, 7, 11},
                        {0, 4, 7},
                        {2, 6, 9},
                    ]
                assert score.tracks[0].notes[-1].pitch == 67


def test_pace_and_variation_preserve_words_and_score_determinism(pronounce):
    request = ArrangeRequest(lyrics="May our light shine on")
    first = arrange(request, pronounce)
    assert first == arrange(request, pronounce)
    slow = arrange(request.model_copy(update={"pace": "slow"}), pronounce)
    assert slow.tracks == first.tracks and slow.bpm < first.bpm
    other = arrange(request.model_copy(update={"variation": 1}), pronounce)
    assert [n.pitch for n in other.tracks[0].notes] != [
        n.pitch for n in first.tracks[0].notes
    ]
    assert [n.lyric for n in other.tracks[0].notes] == [
        n.lyric for n in first.tracks[0].notes
    ]


@pytest.mark.parametrize(
    "lyrics", ["", "hello", "word " * 25, "hello 123", "bonjour 世界", "hello zqxqzzq"]
)
def test_invalid_lyrics_rejected_before_render(lyrics, pronounce):
    client = TestClient(app)
    result = client.post("/api/arrange", json={"lyrics": lyrics})
    assert result.status_code == 422


def test_score_export_preserves_simple_settings(pronounce):
    score = arrange(
        ArrangeRequest(
            lyrics="Hold this moment in your heart", pace="bright", character="intimate"
        ),
        pronounce,
    )
    client = TestClient(app)
    result = client.post("/api/validate", json=score.model_dump())
    assert result.status_code == 200
    assert result.json()["simple"] == score.simple.model_dump()
    assert len(result.json()["tracks"][0]["notes"]) == 6
