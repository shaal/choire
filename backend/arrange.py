"""A deliberately bounded arranger for the guided studio.

All harmony tones belong to G major; authored voicings stay in Nishiren's
published range. Lyrics determine timing, so no word is truncated or dropped.
This supplies musical guardrails, not a guarantee of subjective audio quality.
"""

import re
from math import ceil

from .schema import ArrangeRequest, Note, Score, SimpleSettings, Track
from .singing import VOWELS

PACE = {"slow": 68, "flowing": 84, "bright": 104}
# Bass, tenor, alto, soprano. Open, consonant voicings with a settled cadence.
CHORDS = [
    (55, 62, 67, 71),  # G
    (59, 64, 67, 71),  # Em/B
    (60, 64, 67, 72),  # C
    (57, 62, 66, 69),  # D/A
]
CADENCE = (55, 59, 62, 67)
PROGRESSIONS = [(0, 2, 3, 0), (0, 1, 2, 3, 0), (0, 3, 2, 0)]
CHARACTERS = {
    "intimate": dict(
        singers=1,
        styles=("standard", "soft", "soft", "standard"),
        room=0.10,
        dispersion=0.12,
        timing=0.10,
        vibrato=0.72,
    ),
    "warm": dict(
        singers=2,
        styles=("standard", "soft", "sweet", "standard"),
        room=0.22,
        dispersion=0.20,
        timing=0.16,
        vibrato=0.82,
    ),
    "radiant": dict(
        singers=3,
        styles=("power", "standard", "sweet", "standard"),
        room=0.32,
        dispersion=0.24,
        timing=0.19,
        vibrato=0.88,
    ),
}


def arrange(request: ArrangeRequest, pronounce) -> Score:
    text = request.lyrics.replace("’", "'")
    if re.search(r"[^a-zA-Z\s'.,!?;:\-]", text):
        raise ValueError(
            "Use English words and punctuation. Spell out numbers so the choir can sing them."
        )
    lines = [
        re.findall(r"[a-zA-Z]+(?:'[a-zA-Z]+)?", line) for line in text.splitlines()
    ]
    lines = [line for line in lines if line]
    count = sum(map(len, lines))
    if not 2 <= count <= 24:
        raise ValueError(
            "Use 2–24 words for a short choir piece. Every word will be sung."
        )
    # Explicit line breaks are breathing points; long lines get natural breaks.
    phrases = [line[i : i + 6] for line in lines for i in range(0, len(line), 6)]
    timings = []
    cursor = 0.0
    for phrase in phrases:
        sizes = [
            max(1, sum(p.removeprefix("en/") in VOWELS for p in pronounce(word)))
            for word in phrase
        ]
        durations = [max(1.5, min(6, syllables + 0.5)) for syllables in sizes]
        durations[-1] = max(3, durations[-1])
        durations[-1] += ceil(sum(durations) / 4) * 4 - sum(durations)
        progression = PROGRESSIONS[request.variation % len(PROGRESSIONS)]
        for i, (word, duration) in enumerate(zip(phrase, durations)):
            chord = progression[
                round(i / max(1, len(phrase) - 1) * (len(progression) - 1))
            ]
            voicing = CADENCE if i == len(phrase) - 1 else CHORDS[chord]
            # An alternate first inversion gives variation without random notes.
            if request.variation % 2 and chord == 0 and i != len(phrase) - 1:
                voicing = (59, 62, 67, 74)
            timings.append((word, cursor, duration, voicing, i == len(phrase) - 1))
            cursor += duration
        cursor += 0.5
    if cursor > 128:
        raise ValueError(
            "These words need more room. Use shorter lines or fewer words."
        )
    character = CHARACTERS[request.character]
    tracks = []
    parts = ["soprano", "alto", "tenor", "bass"]
    for index, part in enumerate(parts):
        tracks.append(
            Track(
                id=f"simple-{part}",
                name=part.title(),
                part=part,
                voice=f"nishiren-{character['styles'][index]}",
                singers=character["singers"],
                gain=(0.9, 0.68, 0.64, 0.64)[index],
                pan=(-0.28, -0.10, 0.12, 0.28)[index],
                notes=[
                    Note(
                        id=f"simple-{part}-{i}",
                        pitch=voicing[3 - index],
                        start=start,
                        duration=duration,
                        lyric=word,
                        velocity=0.76 if ending else 0.82,
                    )
                    for i, (word, start, duration, voicing, ending) in enumerate(
                        timings
                    )
                ],
            )
        )
    return Score(
        engine="diffsinger",
        title=request.title,
        bpm=PACE[request.pace],
        tracks=tracks,
        room=character["room"],
        dispersion=character["dispersion"],
        timing=character["timing"],
        vibrato=character["vibrato"],
        seed=42 + request.variation * 31,
        simple=SimpleSettings(**request.model_dump(exclude={"title"})),
    )
