"""Local API, bounded render worker, and production UI server."""

from __future__ import annotations
import io
import threading
import time
import uuid
import zipfile
from concurrent.futures import ThreadPoolExecutor
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from .engine import ChoirEngine, RenderCancelled, ROOT
from .schema import Score, VOICES, SINGING_VOICES, ArrangeRequest
from .arrange import arrange
from .singing import SingingEngine

app = FastAPI(title="Choire", version="0.1.0")
engine = ChoirEngine()
singing_engine = SingingEngine()
executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="choire-render")
jobs: dict[str, dict] = {}
job_lock = threading.Lock()
render_root = ROOT / ".renders"


@app.middleware("http")
async def local_request_limits(request: Request, call_next):
    try:
        if int(request.headers.get("content-length", 0)) > 1_000_000:
            return JSONResponse(
                {"detail": "Project is too large (maximum 1 MB)."}, status_code=413
            )
    except ValueError:
        return JSONResponse({"detail": "Invalid content length."}, status_code=400)
    return await call_next(request)


@app.get("/api/health")
def health():
    neural_ready = singing_engine.available
    ready = engine.available or neural_ready
    return {
        "status": "ready" if ready else "setup-required",
        "modelReady": ready,
        "defaultEngine": "diffsinger" if neural_ready else "kokoro-world",
        "engine": "DiffSinger · Nishiren" if neural_ready else "Kokoro + WORLD",
        "mode": "phrase-based neural singing"
        if neural_ready
        else "experimental speech-to-singing",
        "language": "English",
        "sampleRate": 44100 if neural_ready else 24000,
        "voices": SINGING_VOICES if neural_ready else VOICES,
        "engines": {
            "kokoro-world": {
                "ready": engine.available,
                "sampleRate": 24000,
                "voices": VOICES,
            },
            "diffsinger": {
                "ready": singing_engine.available,
                "sampleRate": 44100,
                "voices": SINGING_VOICES,
            },
        },
    }


@app.post("/api/validate")
def validate(score: Score):
    return score


@app.post("/api/arrange")
def arrange_score(settings: ArrangeRequest):
    if not singing_engine.available:
        raise HTTPException(
            503,
            "Simple studio needs the singing voice. Run npm run setup:singing, then reload.",
        )
    try:
        return arrange(settings, singing_engine.pronounce)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc


@app.post("/api/render", status_code=202)
def render(score: Score):
    selected_engine = singing_engine if score.engine == "diffsinger" else engine
    if not selected_engine.available:
        command = (
            "npm run setup:singing" if score.engine == "diffsinger" else "npm run setup"
        )
        raise HTTPException(503, f"Voice model missing. Run {command}.")
    if not score.audible_tracks():
        raise HTTPException(422, "Add notes to an unmuted part before rendering.")
    with job_lock:
        if any(j["status"] in ("queued", "rendering") for j in jobs.values()):
            raise HTTPException(
                409, "A render is already running. Wait for it or cancel it first."
            )
        job_id = uuid.uuid4().hex
        job = {
            "id": job_id,
            "status": "queued",
            "progress": 0,
            "message": "Waiting for the voice engine",
            "createdAt": time.time(),
            "cancel": threading.Event(),
        }
        jobs[job_id] = job
        # Only trim in-memory metadata; finished WAVs remain explicitly user-owned exports.
        finished = [
            k for k, v in jobs.items() if v["status"] not in ("queued", "rendering")
        ]
        for key in finished[:-20]:
            del jobs[key]

    def work():
        job["status"] = "rendering"

        def progress(value, message):
            job.update(progress=round(value, 3), message=message)

        try:
            result = selected_engine.render(
                score, render_root / job_id, progress, job["cancel"]
            )
            if job["cancel"].is_set():
                raise RenderCancelled()
            job.update(
                status="complete",
                progress=1,
                message="Your choir is ready",
                result=result,
            )
            result.update(
                audioUrl=f"/api/audio/{job_id}/choire-mix.wav",
                stemsUrl=f"/api/stems/{job_id}",
                elapsed=round(time.time() - job["createdAt"], 2),
            )
        except RenderCancelled:
            job.update(status="cancelled", message="Render cancelled")
        except Exception as exc:
            job.update(status="error", message=str(exc))

    executor.submit(work)
    return {"id": job_id}


@app.get("/api/jobs/{job_id}")
def get_job(job_id: str):
    job = jobs.get(job_id)
    if not job:
        raise HTTPException(404, "Render not found. The server may have restarted.")
    return {k: v for k, v in job.items() if k != "cancel"}


@app.delete("/api/jobs/{job_id}")
def cancel_job(job_id: str):
    job = jobs.get(job_id)
    if not job:
        raise HTTPException(404, "Render not found.")
    job["cancel"].set()
    return {
        "status": "cancelling"
        if job["status"] in ("queued", "rendering")
        else job["status"]
    }


def completed_folder(job_id: str):
    if len(job_id) != 32 or any(c not in "0123456789abcdef" for c in job_id):
        raise HTTPException(404, "Render not found.")
    folder = render_root / job_id
    if not (folder / "choire-mix.wav").is_file():
        raise HTTPException(404, "Audio is not ready.")
    return folder


@app.get("/api/audio/{job_id}/{filename}")
def audio(job_id: str, filename: str):
    folder = completed_folder(job_id)
    allowed = {
        "choire-mix.wav",
        "01-soprano.wav",
        "02-alto.wav",
        "03-tenor.wav",
        "04-bass.wav",
    }
    # Render order can change when parts are muted/soloed; derive all allowed numeric names.
    allowed |= {
        f"{i:02d}-{part}.wav"
        for i in range(1, 5)
        for part in ("soprano", "alto", "tenor", "bass")
    }
    if filename not in allowed or not (folder / filename).is_file():
        raise HTTPException(404, "Stem not found.")
    return FileResponse(folder / filename, media_type="audio/wav", filename=filename)


@app.get("/api/stems/{job_id}")
def stems(job_id: str):
    folder = completed_folder(job_id)
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as z:
        for path in sorted(folder.iterdir()):
            if path.suffix in (".wav", ".json", ".txt"):
                z.write(path, path.name)
    return Response(
        buffer.getvalue(),
        media_type="application/zip",
        headers={"Content-Disposition": 'attachment; filename="choire-stems.zip"'},
    )


# Same-origin UI in production; Vite proxies /api in development.
if (ROOT / "dist").is_dir():
    app.mount("/", StaticFiles(directory=ROOT / "dist", html=True), name="studio")
