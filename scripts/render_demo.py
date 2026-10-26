import json, threading, time
from pathlib import Path
from backend.schema import Score
from backend.engine import ChoirEngine

s = Score.model_validate_json(Path("public/demo.choire.json").read_text())
last = [-1]


def progress(p, m):
    step = int(p * 10)
    if step != last[0]:
        print(f"{p:.0%} {m}", flush=True)
        last[0] = step


start = time.time()
r = ChoirEngine().render(s, Path("artifacts/demo"), progress, threading.Event())
r["elapsed"] = time.time() - start
Path("artifacts/demo/verification.json").write_text(json.dumps(r, indent=2))
print(json.dumps({k: v for k, v in r.items() if k != "waveform"}, indent=2), flush=True)
