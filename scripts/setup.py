"""Install the exact open voice-model copies tested with Choire."""

import hashlib
import shutil
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MODELS = ROOT / ".models"
BASE = "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/"
CACHE = Path.home() / ".cache/hyperframes/tts"
FILES = {
    "kokoro-v1.0.onnx": (
        CACHE / "models/kokoro-v1.0.onnx",
        325532387,
        "7d5df8ecf7d4b1878015a32686053fd0eebe2bc377234608764cc0ef3636a6c5",
    ),
    "voices-v1.0.bin": (
        CACHE / "voices/voices-v1.0.bin",
        28214398,
        "bca610b8308e8d99f32e6fe4197e7ec01679264efed0cac9140fe9c29f1fbf7d",
    ),
}


def matches(path, size, expected):
    if not path.exists() or path.stat().st_size != size:
        return False
    with path.open("rb") as f:
        return hashlib.file_digest(f, "sha256").hexdigest() == expected


MODELS.mkdir(exist_ok=True)
for name, (cached, size, digest) in FILES.items():
    dest = MODELS / name
    if matches(dest, size, digest):
        print(f"Verified: {name}")
        continue
    tmp = dest.with_suffix(".download")
    if matches(cached, size, digest):
        print(f"Reusing local {name}")
        shutil.copyfile(cached, tmp)
    else:
        print(f"Downloading {name} ({size / 1e6:.0f} MB)")
        with (
            urllib.request.urlopen(BASE + name, timeout=60) as response,
            tmp.open("wb") as target,
        ):
            shutil.copyfileobj(response, target)
    if not matches(tmp, size, digest):
        tmp.unlink(missing_ok=True)
        raise SystemExit(f"Checksum mismatch for {name}; model not installed.")
    tmp.replace(dest)
    print(f"Verified: {name}")
print("Local voice models are ready.")
