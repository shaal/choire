"""Validated musical score shared by rendering and project import."""

from typing import Literal
from pydantic import BaseModel, ConfigDict, Field, model_validator

VOICES = {
    "af_heart": "Clara · clear soprano",
    "af_bella": "Elise · warm soprano",
    "af_nicole": "Nora · soft alto",
    "af_sarah": "Mara · full alto",
    "am_fenrir": "Felix · clear tenor",
    "am_michael": "Miles · warm baritone",
    "am_adam": "Adam · deep bass",
    "bm_george": "George · round bass",
}
SINGING_VOICES = {
    "nishiren-standard": "Nishiren · Standard",
    "nishiren-soft": "Nishiren · Soft",
    "nishiren-sweet": "Nishiren · Sweet",
    "nishiren-power": "Nishiren · Power",
}


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)


class Note(StrictModel):
    id: str = Field(min_length=1, max_length=80)
    pitch: int = Field(ge=36, le=84)
    start: float = Field(ge=0, le=128)
    duration: float = Field(ge=0.25, le=16)
    lyric: str = Field(default="ah", min_length=1, max_length=40)
    velocity: float = Field(default=0.8, ge=0.1, le=1)

    @model_validator(mode="after")
    def check_end(self):
        if self.start + self.duration > 128:
            raise ValueError("A score is limited to 128 beats.")
        if not any(c.isalpha() for c in self.lyric):
            raise ValueError("Each note needs a word or syllable, such as ah.")
        return self


class Track(StrictModel):
    id: str = Field(min_length=1, max_length=80)
    name: str = Field(min_length=1, max_length=80)
    part: Literal["soprano", "alto", "tenor", "bass"]
    voice: str
    singers: int = Field(default=4, ge=1, le=16)
    gain: float = Field(default=0.8, ge=0, le=1.5)
    pan: float = Field(default=0, ge=-1, le=1)
    mute: bool = False
    solo: bool = False
    notes: list[Note] = Field(default_factory=list, max_length=128)

    @model_validator(mode="after")
    def check_notes(self):
        if self.voice not in VOICES and self.voice not in SINGING_VOICES:
            raise ValueError("Unknown voice.")
        if len({n.id for n in self.notes}) != len(self.notes):
            raise ValueError("Note IDs must be unique within a part.")
        ordered = sorted(self.notes, key=lambda n: n.start)
        for a, b in zip(ordered, ordered[1:]):
            if a.start + a.duration > b.start + 0.001:
                raise ValueError(
                    f"{self.name} has overlapping notes. Each vocal part is monophonic."
                )
        return self


class Score(StrictModel):
    version: Literal[1] = 1
    engine: Literal["kokoro-world", "diffsinger"] = "kokoro-world"
    title: str = Field(default="Untitled choir", max_length=100)
    bpm: int = Field(default=84, ge=40, le=200)
    tracks: list[Track] = Field(min_length=1, max_length=4)
    dispersion: float = Field(default=0.35, ge=0, le=1)
    timing: float = Field(default=0.25, ge=0, le=1)
    vibrato: float = Field(default=0.35, ge=0, le=1)
    room: float = Field(default=0.3, ge=0, le=1)
    seed: int = Field(default=42, ge=0, le=2**31 - 1)

    @model_validator(mode="after")
    def check_score(self):
        voices = SINGING_VOICES if self.engine == "diffsinger" else VOICES
        if any(t.voice not in voices for t in self.tracks):
            raise ValueError(
                "The selected voices must match the score's singing engine."
            )
        if self.engine == "diffsinger" and any(
            n.duration * 60 / self.bpm > 16 for t in self.tracks for n in t.notes
        ):
            raise ValueError(
                "Singing notes are limited to 16 seconds. Shorten the note or increase the tempo."
            )
        if len({t.id for t in self.tracks}) != len(self.tracks):
            raise ValueError("Track IDs must be unique.")
        # Bound expensive native synthesis work, including silent/muted tracks.
        if sum(len(t.notes) * t.singers for t in self.tracks) > 2048:
            raise ValueError(
                "Reduce note count or singers: maximum 2,048 singer-notes per render."
            )
        if (
            sum(n.duration * t.singers for t in self.tracks for n in t.notes)
            * 60
            / self.bpm
            > 2400
        ):
            raise ValueError(
                "Reduce the score length or singers: maximum 40 singer-minutes."
            )
        return self

    def audible_tracks(self):
        soloed = any(t.solo for t in self.tracks)
        return [
            t
            for t in self.tracks
            if not t.mute and t.gain > 0 and (not soloed or t.solo) and t.notes
        ]
