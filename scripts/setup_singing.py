"""Download and verify the complete, unmodified Nishiren v2.1 voicebank."""

import hashlib
import shutil
import stat
import urllib.request
import zipfile
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BASE = ROOT / ".models/diffsinger"
ARCHIVE = BASE / "nishiren-v2.1.zip"
DEST = BASE / "nishiren-v2.1"
URL = "https://github.com/Gardanana/Nishiren-AI-Diffsinger/releases/download/v2.1/Nishiren.Diffsinger.v2.1.zip"
SHA256 = "138baf89820fc9084fc8b2313cb80b3f6ab0974009e2b3638646d7036f73a5c7"
TERMS = (
    "https://github.com/Gardanana/Nishiren-AI-Diffsinger/blob/main/terms-of-service.md"
)


def digest(path):
    if not path.is_file():
        return None
    with path.open("rb") as f:
        return hashlib.file_digest(f, "sha256").hexdigest()


def file_crc(path):
    crc = 0
    with path.open("rb") as f:
        while block := f.read(1024 * 1024):
            crc = zlib.crc32(block, crc)
    return crc


def main():
    print("Nishiren Diffsinger v2.1 by Gardanana. Non-commercial evaluation.")
    print("Publishing requires credit; commercial use requires author approval.")
    print(f"Voicebank terms, including content restrictions: {TERMS}")
    BASE.mkdir(parents=True, exist_ok=True)
    if digest(ARCHIVE) != SHA256:
        temporary = ARCHIVE.with_suffix(".download")
        print("Downloading the complete voicebank (624 MB)...", flush=True)
        with (
            urllib.request.urlopen(URL, timeout=60) as response,
            temporary.open("wb") as target,
        ):
            shutil.copyfileobj(response, target)
        if digest(temporary) != SHA256:
            temporary.unlink(missing_ok=True)
            raise SystemExit("Voicebank checksum mismatch; nothing installed.")
        temporary.replace(ARCHIVE)
    with zipfile.ZipFile(ARCHIVE) as archive:
        for member in archive.infolist():
            target = DEST / member.filename
            if not target.resolve().is_relative_to(DEST.resolve()) or stat.S_ISLNK(
                member.external_attr >> 16
            ):
                raise SystemExit("Unsafe archive entry; nothing extracted.")
        # Do not edit the bank; extract every asset and preserve the author's files.
        for member in archive.infolist():
            target = DEST / member.filename
            if member.is_dir():
                target.mkdir(parents=True, exist_ok=True)
            elif (
                not target.is_file()
                or target.stat().st_size != member.file_size
                or file_crc(target) != member.CRC
            ):
                target.parent.mkdir(parents=True, exist_ok=True)
                with archive.open(member) as source, target.open("wb") as output:
                    shutil.copyfileobj(source, output)
    print("Verified complete voicebank. Select Neural singing in Choire.")


if __name__ == "__main__":
    main()
