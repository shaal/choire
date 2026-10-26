import json
from pathlib import Path

parts = [
    ("soprano", "Soprano", "af_heart", -0.35, [69, 70, 72, 67, 69]),
    ("alto", "Alto", "af_sarah", -0.1, [65, 65, 65, 64, 65]),
    ("tenor", "Tenor", "am_fenrir", 0.15, [62, 62, 60, 60, 62]),
    ("bass", "Bass", "am_michael", 0.4, [50, 46, 53, 48, 50]),
]
score = {
    "version": 1,
    "title": "A little light",
    "bpm": 84,
    "dispersion": 0.35,
    "timing": 0.3,
    "vibrato": 0.35,
    "room": 0.3,
    "seed": 42,
    "tracks": [],
}
for part, name, voice, pan, pitches in parts:
    notes = [
        dict(id=f"{part}-{i}", pitch=p, start=s, duration=d, lyric=w, velocity=0.8)
        for i, (p, s, d, w) in enumerate(
            zip(
                pitches,
                [0, 2, 4, 8, 12],
                [2, 2, 4, 4, 4],
                ["May", "our", "light", "shine", "on"],
            )
        )
    ]
    score["tracks"].append(
        dict(
            id=part,
            name=name,
            part=part,
            voice=voice,
            singers=4,
            gain=0.8,
            pan=pan,
            mute=False,
            solo=False,
            notes=notes,
        )
    )
Path("public/demo.choire.json").write_text(json.dumps(score, indent=2))
