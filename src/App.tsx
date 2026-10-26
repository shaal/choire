import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import type { CSSProperties, ChangeEvent } from "react";
import {
  AudioLines,
  Download,
  FileMusic,
  FolderOpen,
  Headphones,
  Info,
  LoaderCircle,
  Minus,
  Music2,
  Pause,
  Play,
  Plus,
  Redo2,
  RotateCcw,
  Save,
  Shuffle,
  SlidersHorizontal,
  Square,
  Trash2,
  Undo2,
  Volume2,
  Waves,
  X,
} from "lucide-react";
import PianoRoll from "./PianoRoll";
import SimpleStudio from "./SimpleStudio";
import useSimpleStudio from "./useSimpleStudio";
import {
  COLORS,
  VOICES,
  SINGING_VOICES,
  switchEngine,
  assignLyrics,
  download,
  exportMidi,
  fitNote,
  importMidi,
  initialScore,
  newId,
  noteName,
} from "./score";
import type { Note, Score, Track } from "./score";

type Result = {
  audioUrl: string;
  stemsUrl: string;
  waveform: number[];
  duration: number;
  sampleRate: number;
  bitDepth: number;
  elapsed: number;
  singers: number;
};
type Job = {
  id: string;
  status: string;
  progress: number;
  message: string;
  result?: Result;
};
type History = { present: Score; past: Score[]; future: Score[] };
type Action =
  | { type: "edit"; score: Score }
  | { type: "undo" }
  | { type: "redo" }
  | { type: "load"; score: Score };
function reducer(state: History, action: Action): History {
  if (action.type === "load")
    return { present: action.score, past: [], future: [] };
  if (action.type === "undo") {
    if (!state.past.length) return state;
    return {
      present: state.past.at(-1)!,
      past: state.past.slice(0, -1),
      future: [state.present, ...state.future],
    };
  }
  if (action.type === "redo") {
    if (!state.future.length) return state;
    return {
      present: state.future[0],
      past: [...state.past, state.present],
      future: state.future.slice(1),
    };
  }
  if (JSON.stringify(state.present) === JSON.stringify(action.score))
    return state;
  return {
    present: action.score,
    past: [...state.past, state.present].slice(-60),
    future: [],
  };
}
async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const r = await fetch(path, options);
  const data = await r.json().catch(() => null);
  if (!r.ok) {
    const d = data?.detail;
    throw new Error(
      typeof d === "string"
        ? d
        : Array.isArray(d)
          ? d
              .map((e: { msg: string }) => e.msg.replace("Value error, ", ""))
              .join(" ")
          : `Request failed (${r.status}).`,
    );
  }
  return data as T;
}
const jsonRequest = (score: Score) => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(score),
});
const fmt = (s: number) =>
  `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
function Slider({
  label,
  value,
  min = 0,
  max = 1,
  step = 0.01,
  onChange,
  display,
  hint,
}: {
  label: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  onChange: (v: number) => void;
  display: string;
  hint?: string;
}) {
  return (
    <label className="slider-control">
      <span>
        <span>{label}</span>
        <span className="slider-value">{display}</span>
      </span>
      <input
        aria-label={label}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(+e.target.value)}
        style={
          {
            "--fill": `${((value - min) / (max - min)) * 100}%`,
          } as CSSProperties
        }
      />
      {hint && <small>{hint}</small>}
    </label>
  );
}
function MiniScore({ track }: { track: Track }) {
  return (
    <svg className="mini-score" viewBox="0 0 180 24" aria-hidden="true">
      {track.notes.map((n) => (
        <rect
          key={n.id}
          x={
            (n.start /
              Math.max(16, ...track.notes.map((x) => x.start + x.duration))) *
            180
          }
          y={20 - ((n.pitch - 36) / 48) * 18}
          width={Math.max(
            2,
            (n.duration /
              Math.max(16, ...track.notes.map((x) => x.start + x.duration))) *
              180 -
              2,
          )}
          height="3"
          rx="1"
          fill={COLORS[track.part]}
        />
      ))}
    </svg>
  );
}
export default function App() {
  const [mode, setMode] = useState<"simple" | "advanced">(() => {
    try {
      const saved = localStorage.getItem("choire.studioMode.v1");
      return saved === "simple" || saved === "advanced"
        ? saved
        : localStorage.getItem("choire.project.v1")
          ? "advanced"
          : "simple";
    } catch {
      return "simple";
    }
  });
  const [history, dispatch] = useReducer(reducer, {
    present: initialScore(),
    past: [],
    future: [],
  });
  const score = history.present;
  const [active, setActive] = useState("soprano");
  const [selected, setSelected] = useState<string | null>(null);
  const track = score.tracks.find((t) => t.id === active) || score.tracks[0];
  const note = track.notes.find((n) => n.id === selected);
  const [lyrics, setLyrics] = useState("");
  const [snap, setSnap] = useState(0.5);
  const [zoom, setZoom] = useState(1);
  const [connection, setConnection] = useState<
    "loading" | "ready" | "offline" | "setup"
  >("loading");
  const [engineReady, setEngineReady] = useState<Record<string, boolean>>({});
  const simpleMode = mode === "simple";
  const neural = simpleMode || score.engine === "diffsinger";
  const health =
    connection === "ready" &&
    !engineReady[simpleMode ? "diffsinger" : score.engine]
      ? "setup"
      : connection;
  const outsideRange =
    neural && track.notes.some((n) => n.pitch < 55 || n.pitch > 74);
  const [notice, setNotice] = useState("");
  const [about, setAbout] = useState(false);
  const [job, setJob] = useState<Job | null>(null);
  const [rendered, setRendered] = useState<{
    result: Result;
    key: string;
  } | null>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [busy, setBusy] = useState(false);
  const [restoreReady, setRestoreReady] = useState(false);
  const guided = useSimpleStudio(score, simpleMode, restoreReady);
  const audio = useRef<HTMLAudioElement>(null);
  const importInput = useRef<HTMLInputElement>(null);
  const renderKey = useRef("");
  const autoplay = useRef(false);
  const scoreKey = JSON.stringify(score);
  const scoreRef = useRef(score);
  scoreRef.current = score;
  const isRendering =
    busy || job?.status === "queued" || job?.status === "rendering";
  const current =
    !!rendered && rendered.key === scoreKey && (!simpleMode || !guided.dirty);
  const audible = score.tracks.filter(
    (t) =>
      !t.mute &&
      (!score.tracks.some((t) => t.solo) || t.solo) &&
      t.notes.length,
  );
  const singerCount = audible.reduce((s, t) => s + t.singers, 0);
  const length = Math.max(
    16,
    Math.ceil(
      Math.max(
        0,
        ...score.tracks.flatMap((t) =>
          t.notes.map((n) => n.start + n.duration),
        ),
      ) / 4,
    ) * 4,
  );
  const edit = useCallback(
    (s: Score) =>
      dispatch({
        type: "edit",
        score: mode === "advanced" ? { ...s, simple: null } : s,
      }),
    [mode],
  );
  function changeMode(next: "simple" | "advanced") {
    setMode(next);
    try {
      localStorage.setItem("choire.studioMode.v1", next);
    } catch {}
  }
  const changeTrack = (patch: Partial<Track>) =>
    edit({
      ...score,
      tracks: score.tracks.map((t) =>
        t.id === track.id ? { ...t, ...patch } : t,
      ),
    });
  const changeAnyTrack = (id: string, patch: Partial<Track>) =>
    edit({
      ...score,
      tracks: score.tracks.map((t) => (t.id === id ? { ...t, ...patch } : t)),
    });
  const changeNote = (patch: Partial<Note>) => {
    if (!note) return;
    const n = { ...note, ...patch };
    if (!fitNote(track, n)) {
      setNotice("That edit overlaps another note or goes beyond the score.");
      return;
    }
    changeTrack({ notes: track.notes.map((x) => (x.id === n.id ? n : x)) });
  };
  const load = useCallback((s: Score) => {
    audio.current?.pause();
    dispatch({ type: "load", score: s });
    setActive(s.tracks[0].id);
    setSelected(null);
    setRendered(null);
    setTime(0);
    setJob(null);
  }, []);
  useEffect(() => {
    let gone = false;
    request<{ engines: Record<string, { ready: boolean }> }>("/api/health")
      .then((h) => {
        if (!gone) {
          setEngineReady(
            Object.fromEntries(
              Object.entries(h.engines).map(([id, e]) => [id, e.ready]),
            ),
          );
          setConnection("ready");
        }
      })
      .catch(() => {
        if (!gone) setConnection("offline");
      });
    let saved: string | null = null;
    try {
      saved = localStorage.getItem("choire.project.v1");
    } catch {
      setNotice(
        "Browser storage is unavailable. Use Save project to keep your work.",
      );
    }
    (async () => {
      if (saved) {
        try {
          const s = await request<Score>("/api/validate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: saved,
          });
          if (!gone) load(s);
        } catch {
          try {
            localStorage.setItem("choire.project.recovery", saved);
          } catch {}
          if (!gone)
            setNotice(
              "Could not restore the saved project. A recovery copy is kept in browser storage under choire.project.recovery.",
            );
        }
      }
      if (!gone) setRestoreReady(true);
    })();
    return () => {
      gone = true;
    };
  }, [load]);
  useEffect(() => {
    if (!restoreReady) return;
    const id = setTimeout(() => {
      try {
        localStorage.setItem("choire.project.v1", scoreKey);
      } catch {
        setNotice(
          "Browser storage is full. Save a project file to keep your work.",
        );
      }
    }, 500);
    return () => clearTimeout(id);
  }, [scoreKey, restoreReady]);
  useEffect(() => {
    setLyrics(
      [...track.notes]
        .sort((a, b) => a.start - b.start)
        .map((n) => n.lyric)
        .join(" "),
    );
  }, [track.id, track.notes]);
  useEffect(() => {
    if (rendered && !current) {
      audio.current?.pause();
      setTime(0);
    }
  }, [current, rendered]);
  useEffect(() => {
    if (!job || !["queued", "rendering"].includes(job.status)) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const id = job.id;
    async function poll() {
      try {
        const next = await request<Job>(`/api/jobs/${id}`);
        if (stopped) return;
        setJob(next);
        if (next.status === "complete" && next.result) {
          setRendered({ result: next.result, key: renderKey.current });
          setTime(0);
        } else if (next.status === "error") setNotice(next.message);
        else if (["rendering", "queued"].includes(next.status))
          timer = setTimeout(poll, 500);
      } catch (e) {
        if (!stopped) {
          setNotice((e as Error).message);
          setJob((j) => (j ? { ...j, status: "error" } : null));
        }
      }
    }
    timer = setTimeout(poll, 300);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [job?.id, job?.status]);
  useEffect(() => {
    if (!rendered || !current || !autoplay.current) return;
    autoplay.current = false;
    audio.current
      ?.play()
      .catch(() => setNotice("Your choir is ready. Press play to listen."));
  }, [rendered, current]);
  useEffect(() => {
    function key(e: KeyboardEvent) {
      const target = e.target as HTMLElement;
      if (target.closest("input,textarea,select,button")) return;
      if ((e.metaKey || e.ctrlKey) && e.key === "z") {
        e.preventDefault();
        dispatch({ type: e.shiftKey ? "redo" : "undo" });
      }
      if (e.code === "Space" && audio.current && current) {
        e.preventDefault();
        if (audio.current.paused) audio.current.play().catch(() => {});
        else audio.current.pause();
      }
    }
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [current]);
  async function render(play = false, composition = scoreRef.current) {
    if (isRendering) return;
    setBusy(true);
    setNotice("");
    audio.current?.pause();
    autoplay.current = play;
    renderKey.current = JSON.stringify(composition);
    try {
      const j = await request<{ id: string }>(
        "/api/render",
        jsonRequest(composition),
      );
      setJob({
        id: j.id,
        status: "queued",
        progress: 0,
        message: "Preparing the voice engine",
      });
    } catch (e) {
      setNotice((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function createSimple() {
    if (!guided.planned || isRendering) return;
    edit(guided.planned);
    setActive(guided.planned.tracks[0].id);
    setSelected(null);
    void render(true, guided.planned);
  }
  function playPause() {
    if (!current) {
      if (simpleMode) createSimple();
      else void render(true);
      return;
    }
    if (audio.current?.paused)
      audio.current
        .play()
        .catch((e) => setNotice(`Playback failed: ${e.message}`));
    else audio.current?.pause();
  }
  function stop() {
    audio.current?.pause();
    if (audio.current) audio.current.currentTime = 0;
    setTime(0);
  }
  async function importFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    if (file.size > 1_000_000) {
      setNotice("Import a project or MIDI file smaller than 1 MB.");
      return;
    }
    try {
      const isMidi = /\.midi?$/i.test(file.name);
      const data = isMidi
        ? importMidi(await file.arrayBuffer())
        : JSON.parse(await file.text());
      const valid = await request<Score>("/api/validate", jsonRequest(data));
      edit(valid);
      setActive(valid.tracks[0].id);
      setSelected(null);
      setNotice(
        isMidi
          ? "MIDI imported at the first tempo, snapped to ¼ beats. Add lyrics to replace “ah”."
          : "Project loaded. Undo returns to your previous score.",
      );
    } catch (err) {
      setNotice(`Import failed: ${(err as Error).message}`);
    }
  }
  function save() {
    const savedScore = simpleMode ? guided.planned : score;
    if (!savedScore) return;
    download(
      `${savedScore.title || "choire"}.choire.json`,
      new Blob([JSON.stringify(savedScore, null, 2)], {
        type: "application/json",
      }),
    );
  }
  function preset(name: string) {
    const values =
      name === "chamber"
        ? {
            singers: 3,
            dispersion: 0.22,
            timing: 0.16,
            vibrato: 0.25,
            room: 0.2,
          }
        : name === "hall"
          ? {
              singers: 8,
              dispersion: 0.45,
              timing: 0.45,
              vibrato: 0.5,
              room: 0.65,
            }
          : { singers: 1, dispersion: 0, timing: 0, vibrato: 0.2, room: 0.05 };
    const { singers, ...rest } = values;
    edit({
      ...score,
      ...rest,
      tracks: score.tracks.map((t) => ({ ...t, singers })),
    });
  }
  return (
    <div className={`studio ${mode}-mode`}>
      <header className="app-header">
        <a
          className="brand"
          href="#"
          onClick={(e) => e.preventDefault()}
          aria-label="Choire studio"
        >
          <AudioLines size={27} strokeWidth={1.5} />
          <span>
            choire<span className="brand-dot">.</span>
          </span>
          <small>STUDIO</small>
        </a>
        <div className="mode-switch" role="group" aria-label="Studio mode">
          <button
            aria-pressed={simpleMode}
            disabled={!!isRendering}
            onClick={() => changeMode("simple")}
          >
            Simple
          </button>
          <button
            aria-pressed={!simpleMode}
            disabled={!!isRendering}
            onClick={() => changeMode("advanced")}
          >
            Advanced
          </button>
        </div>
        <div className="header-actions">
          <button
            className="text-button"
            onClick={() => setAbout(!about)}
            aria-expanded={about}
          >
            <Info size={15} />
            About the engine
          </button>
          <span className={`engine-state ${health}`}>
            <i />
            {health === "ready"
              ? "Voice engine ready"
              : health === "loading"
                ? "Connecting…"
                : health === "setup"
                  ? "Model setup needed"
                  : "Engine offline"}
          </span>
        </div>
      </header>
      {about && (
        <div className="about-engine">
          <Info size={18} />
          <p>
            <strong>An independent, experimental singing studio.</strong>{" "}
            {neural ? (
              <>
                DiffSinger sings connected English phrases with learned
                pronunciation, pitch, and breath controls. The choir layers
                separate performances of Nishiren by Gardanana; the four colors
                are styles of one voice. Best range: G3–D5. Credit Nishiren when
                publishing. Commercial use needs the author’s approval.{" "}
                <a
                  href="https://github.com/Gardanana/Nishiren-AI-Diffsinger/blob/main/terms-of-service.md"
                  target="_blank"
                  rel="noreferrer"
                >
                  Voicebank terms
                </a>
                .
              </>
            ) : (
              <>
                The original renderer generates speech with Kokoro and retunes
                it with WORLD. Sustained vowels and transitions can sound
                artificial. Choose Neural singing to use a trained singing
                voice.
              </>
            )}
          </p>
          <button
            className="icon-button"
            aria-label="Close engine information"
            onClick={() => setAbout(false)}
          >
            <X size={16} />
          </button>
        </div>
      )}
      <section className="project-bar">
        <div>
          <div className="eyebrow">
            YOUR COMPOSITION <span>/ 01</span>
          </div>
          <input
            className="project-title"
            aria-label="Project title"
            value={score.title}
            maxLength={100}
            onChange={(e) => edit({ ...score, title: e.target.value })}
          />
          <div className="project-subtitle">
            <span className="save-dot" />
            {restoreReady ? "Saved on this device" : "Opening session"}
            <span>·</span>
            {score.tracks.length} vocal parts<span>·</span>English
          </div>
        </div>
        <div className="project-actions">
          <input
            ref={importInput}
            type="file"
            hidden
            accept=".json,.mid,.midi"
            onChange={importFile}
          />
          <button
            className="secondary-button"
            disabled={!!isRendering}
            onClick={() => importInput.current?.click()}
          >
            <FolderOpen size={15} />
            Open <span className="desktop-only">project / MIDI</span>
          </button>
          <button
            className="secondary-button"
            onClick={save}
            disabled={simpleMode && !guided.planned}
          >
            <Save size={15} />
            Save project
          </button>
          {simpleMode && (
            <>
              <button
                className="icon-button"
                aria-label="Undo"
                disabled={!history.past.length || !!isRendering}
                onClick={() => dispatch({ type: "undo" })}
              >
                <Undo2 size={17} />
              </button>
              <button
                className="icon-button"
                aria-label="Redo"
                disabled={!history.future.length || !!isRendering}
                onClick={() => dispatch({ type: "redo" })}
              >
                <Redo2 size={17} />
              </button>
            </>
          )}
          {!simpleMode && (
            <button
              className="primary-button"
              disabled={!!isRendering || health !== "ready"}
              onClick={() => render()}
            >
              {isRendering ? (
                <LoaderCircle size={16} className="spin" />
              ) : (
                <Waves size={16} />
              )}{" "}
              {isRendering ? "Rendering…" : "Render choir"}
            </button>
          )}
        </div>
      </section>
      {notice && (
        <div className="notice" role="status">
          <Info size={16} />
          <span>{notice}</span>
          <button
            className="icon-button"
            aria-label="Dismiss message"
            onClick={() => setNotice("")}
          >
            <X size={15} />
          </button>
        </div>
      )}
      {health === "offline" && (
        <div className="notice" role="alert">
          The local voice engine is disconnected. Start the application with{" "}
          <code>npm run dev</code>, then reload.
        </div>
      )}
      {health === "setup" && (
        <div className="notice" role="alert">
          Download the local voice model with{" "}
          <code>{neural ? "npm run setup:singing" : "npm run setup"}</code>,
          then restart the application.
        </div>
      )}
      {simpleMode ? (
        <SimpleStudio
          settings={guided.settings}
          onChange={guided.setSettings}
          planned={guided.planned}
          planning={guided.planning}
          error={guided.error}
          dirty={guided.dirty}
          rendering={!!isRendering}
          ready={health === "ready" && restoreReady}
          onCreate={createSimple}
          onAdvanced={() => {
            if (!guided.planned) return;
            edit(guided.planned);
            setActive(guided.planned.tracks[0].id);
            setSelected(null);
            changeMode("advanced");
          }}
        />
      ) : (
        <main className="workspace">
          <aside className="parts-panel">
            <div className="panel-heading">
              <h2>Ensemble</h2>
              <span>{singerCount} voices</span>
            </div>
            <div className="parts-list">
              {score.tracks.map((t, i) => (
                <div
                  key={t.id}
                  className={`part-strip ${track.id === t.id ? "active" : ""} ${t.mute ? "muted" : ""}`}
                  style={{ "--part-color": COLORS[t.part] } as CSSProperties}
                >
                  <button
                    className="part-select"
                    onClick={() => {
                      setActive(t.id);
                      setSelected(null);
                    }}
                    aria-pressed={track.id === t.id}
                  >
                    <div className="part-title">
                      <span className="part-number">0{i + 1}</span>
                      <span>{t.name}</span>
                      <span className="part-color-dot" />
                    </div>
                    <span className="part-subtitle">
                      {t.singers === 1 ? "Solo voice" : `${t.singers} singers`}{" "}
                      <span>
                        ·{" "}
                        {t.part === "soprano" || t.part === "alto"
                          ? "Upper register"
                          : "Lower register"}
                      </span>
                    </span>
                    <MiniScore track={t} />
                  </button>
                  <div className="part-controls">
                    <button
                      className={t.mute ? "lit" : ""}
                      aria-label={`Mute ${t.name}`}
                      aria-pressed={t.mute}
                      onClick={() => changeAnyTrack(t.id, { mute: !t.mute })}
                    >
                      M
                    </button>
                    <button
                      className={t.solo ? "lit" : ""}
                      aria-label={`Solo ${t.name}`}
                      aria-pressed={t.solo}
                      onClick={() => changeAnyTrack(t.id, { solo: !t.solo })}
                    >
                      S
                    </button>
                    <Volume2 size={12} />
                    <input
                      type="range"
                      aria-label={`${t.name} volume`}
                      min="0"
                      max="1.5"
                      step=".01"
                      value={t.gain}
                      onChange={(e) =>
                        changeAnyTrack(t.id, { gain: +e.target.value })
                      }
                    />
                  </div>
                </div>
              ))}
            </div>
            <div className="ensemble-preset">
              <span className="eyebrow">START WITH A SOUND</span>
              <button onClick={() => preset("chamber")}>
                <span>
                  Chamber ensemble<small>Intimate & articulate</small>
                </span>
                <span>12</span>
              </button>
              <button onClick={() => preset("hall")}>
                <span>
                  Concert hall<small>Wide & expressive</small>
                </span>
                <span>32</span>
              </button>
              <button onClick={() => preset("solo")}>
                <span>
                  Solo quartet<small>One voice per part</small>
                </span>
                <span>04</span>
              </button>
            </div>
            <div className="sidebar-bottom">
              <Headphones size={17} />
              <p>
                A little space. A lot of voices.
                <br />
                <span>Headphones recommended.</span>
              </p>
            </div>
          </aside>
          <section className="score-panel" aria-label="Score editor">
            <div className="score-toolbar">
              <div className="score-tabs">
                <span className="active">
                  <Music2 size={15} />
                  Piano roll
                </span>
                <span
                  className="current-part"
                  style={{ color: COLORS[track.part] }}
                >
                  {track.name}
                </span>
              </div>
              <div className="edit-tools">
                <button
                  className="icon-button"
                  aria-label="Undo"
                  title="Undo (⌘Z)"
                  disabled={!history.past.length}
                  onClick={() => dispatch({ type: "undo" })}
                >
                  <Undo2 size={16} />
                </button>
                <button
                  className="icon-button"
                  aria-label="Redo"
                  title="Redo (⇧⌘Z)"
                  disabled={!history.future.length}
                  onClick={() => dispatch({ type: "redo" })}
                >
                  <Redo2 size={16} />
                </button>
                <span className="toolbar-divider" />
                <label>
                  Snap{" "}
                  <select
                    aria-label="Snap resolution"
                    value={snap}
                    onChange={(e) => setSnap(+e.target.value)}
                  >
                    <option value={1}>1 beat</option>
                    <option value={0.5}>½ beat</option>
                    <option value={0.25}>¼ beat</option>
                  </select>
                </label>
                <button
                  className="icon-button"
                  aria-label="Zoom out"
                  disabled={zoom <= 0.5}
                  onClick={() => setZoom((z) => z / 1.5)}
                >
                  <Minus size={14} />
                </button>
                <button
                  className="icon-button"
                  aria-label="Zoom in"
                  disabled={zoom >= 3}
                  onClick={() => setZoom((z) => z * 1.5)}
                >
                  <Plus size={14} />
                </button>
              </div>
            </div>
            <PianoRoll
              track={track}
              tracks={score.tracks}
              selected={selected}
              onSelect={setSelected}
              onNotes={(notes) => changeTrack({ notes })}
              onError={setNotice}
              beat={(time * score.bpm) / 60}
              snap={snap}
              zoom={zoom}
              length={length}
            />
            <div className="roll-caption">
              <span>
                <i style={{ background: COLORS[track.part] }} />
                {track.notes.length} notes{" "}
                <span className="caption-divider">/</span>
                {length / 4} bars
              </span>
              <span>Click to add · Drag to move · Drag edge to resize</span>
              <button
                className="add-note-button"
                onClick={() => {
                  const start = Math.max(
                    0,
                    ...track.notes.map((n) => n.start + n.duration),
                  );
                  if (start + 1 > 128) {
                    setNotice("This score is limited to 128 beats.");
                    return;
                  }
                  const n = {
                    id: newId(),
                    start,
                    duration: 1,
                    pitch: note?.pitch || track.notes.at(-1)?.pitch || 60,
                    lyric: "ah",
                    velocity: 0.8,
                  };
                  changeTrack({ notes: [...track.notes, n] });
                  setSelected(n.id);
                }}
              >
                + Note
              </button>
            </div>
            <div className="lyrics-panel">
              <div className="lyrics-heading">
                <h3>
                  Lyrics <span>{track.name}</span>
                </h3>
                <span>
                  {neural
                    ? "One English word per note"
                    : "One word or syllable per note"}
                </span>
              </div>
              <div className="lyrics-input">
                <input
                  aria-label="Part lyrics"
                  value={lyrics}
                  maxLength={5000}
                  onChange={(e) => setLyrics(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter")
                      changeTrack(assignLyrics(track, lyrics));
                  }}
                  placeholder="May our light shine on"
                />
                <button
                  disabled={!track.notes.length}
                  onClick={() => {
                    const count = lyrics
                      .trim()
                      .split(/[\s\-]+/)
                      .filter(Boolean).length;
                    changeTrack(assignLyrics(track, lyrics));
                    if (count !== track.notes.length)
                      setNotice(
                        `${Math.min(count, track.notes.length)} lyrics assigned to ${track.notes.length} notes. Extra words are ignored; remaining notes keep their lyrics.`,
                      );
                  }}
                >
                  Apply lyrics <span>↵</span>
                </button>
              </div>
              <div className="lyric-hint">
                {neural ? (
                  <>
                    Use English dictionary words, or vowels like{" "}
                    <span>ah, oh, oo, la</span>.
                  </>
                ) : (
                  <>
                    Separate syllables with hyphens, like{" "}
                    <span>to-geth-er</span>.
                  </>
                )}{" "}
                Select a note to edit it individually.
              </div>
            </div>
            <div className="note-inspector">
              <div>
                <span className="eyebrow">
                  {note ? "SELECTED NOTE" : "NOTE INSPECTOR"}
                </span>
                <strong>{note ? noteName(note.pitch) : "Select a note"}</strong>
              </div>
              {note ? (
                <>
                  <label>
                    Lyric
                    <input
                      aria-label="Selected note lyric"
                      maxLength={40}
                      value={note.lyric}
                      onChange={(e) => {
                        if (e.target.value.trim())
                          changeNote({ lyric: e.target.value });
                      }}
                    />
                  </label>
                  <label>
                    Pitch
                    <select
                      aria-label="Selected note pitch"
                      value={note.pitch}
                      onChange={(e) => changeNote({ pitch: +e.target.value })}
                    >
                      {Array.from({ length: 49 }, (_, i) => 36 + i).map((p) => (
                        <option key={p} value={p}>
                          {noteName(p)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Start beat
                    <input
                      aria-label="Selected note start"
                      type="number"
                      min="1"
                      max="128"
                      step={snap}
                      value={note.start + 1}
                      onChange={(e) => {
                        if (e.target.value)
                          changeNote({ start: +e.target.value - 1 });
                      }}
                    />
                  </label>
                  <label>
                    Length
                    <input
                      aria-label="Selected note duration"
                      type="number"
                      min=".25"
                      max="16"
                      step={snap}
                      value={note.duration}
                      onChange={(e) => {
                        if (e.target.value)
                          changeNote({ duration: +e.target.value });
                      }}
                    />
                  </label>
                  <button
                    className="icon-button delete-note"
                    aria-label="Delete selected note"
                    onClick={() => {
                      changeTrack({
                        notes: track.notes.filter((n) => n.id !== note.id),
                      });
                      setSelected(null);
                    }}
                  >
                    <Trash2 size={16} />
                  </button>
                </>
              ) : (
                <p>
                  Use arrow keys to move a focused note.
                  <br />
                  Shift + ↑ / ↓ moves an octave. Delete removes it.
                </p>
              )}
            </div>
          </section>
          <aside className="sound-panel">
            <div className="panel-heading">
              <h2>Voice & expression</h2>
              <SlidersHorizontal size={15} />
            </div>
            <div className="sound-content">
              <div className="voice-choices">
                <label className="voice-select-label">
                  SINGING ENGINE
                  <select
                    aria-label="Singing engine"
                    value={score.engine}
                    disabled={!!isRendering}
                    onChange={(e) =>
                      edit(
                        switchEngine(score, e.target.value as Score["engine"]),
                      )
                    }
                  >
                    <option value="diffsinger">
                      Neural singing · DiffSinger
                    </option>
                    <option value="kokoro-world">
                      Original · speech-to-singing
                    </option>
                  </select>
                </label>
                <label className="voice-select-label">
                  VOICE COLOR
                  <select
                    aria-label="Voice color"
                    value={track.voice}
                    onChange={(e) => changeTrack({ voice: e.target.value })}
                  >
                    {Object.entries(neural ? SINGING_VOICES : VOICES).map(
                      ([v, n]) => (
                        <option key={v} value={v}>
                          {n}
                        </option>
                      ),
                    )}
                  </select>
                </label>
                {neural && (
                  <p className="voice-note">
                    Nishiren by Gardanana · one voice, four styles.
                    <br />
                    Non-commercial use.{" "}
                    <a
                      href="https://github.com/Gardanana/Nishiren-AI-Diffsinger/blob/main/terms-of-service.md"
                      target="_blank"
                      rel="noreferrer"
                    >
                      Usage terms
                    </a>
                    {outsideRange && (
                      <span className="range-note">
                        This part reaches beyond G3–D5. Vocal quality may vary.
                      </span>
                    )}
                  </p>
                )}
              </div>
              <div className="singers-heading">
                <span>Singers in {track.name.toLowerCase()}</span>
                <strong>{String(track.singers).padStart(2, "0")}</strong>
              </div>
              <div
                className="singer-stage"
                aria-label={`${track.singers} singers in this part`}
              >
                <div className="stage-arc arc-one" />
                <div className="stage-arc arc-two" />
                {Array.from({ length: track.singers }, (_, i) => {
                  const row = i < 8 ? 0 : 1;
                  const count =
                    row === 0 ? Math.min(track.singers, 8) : track.singers - 8;
                  const index = row === 0 ? i : i - 8;
                  const angle =
                    count === 1 ? 0 : (index / (count - 1) - 0.5) * 1.7;
                  return (
                    <span
                      className="singer-dot"
                      key={i}
                      style={{
                        left: `${50 + Math.sin(angle) * (row ? 43 : 34)}%`,
                        top: `${(row ? 12 : 32) + (1 - Math.cos(angle)) * 32}%`,
                        background: COLORS[track.part],
                      }}
                    />
                  );
                })}
                <div className="conductor">⌁</div>
                <span className="stage-label">ENSEMBLE POSITION</span>
              </div>
              <Slider
                label="Ensemble size"
                value={track.singers}
                min={1}
                max={16}
                step={1}
                onChange={(singers) => changeTrack({ singers })}
                display={
                  track.singers === 1 ? "Solo" : `${track.singers} voices`
                }
              />
              <Slider
                label="Pan"
                value={track.pan}
                min={-1}
                max={1}
                onChange={(pan) => changeTrack({ pan })}
                display={
                  track.pan === 0
                    ? "Center"
                    : `${Math.round(Math.abs(track.pan) * 100)}${track.pan < 0 ? "L" : "R"}`
                }
              />
              <Slider
                label="Part volume"
                value={track.gain}
                min={0}
                max={1.5}
                onChange={(gain) => changeTrack({ gain })}
                display={`${Math.round(track.gain * 100)}%`}
              />
              <div className="sound-divider" />
              <div className="section-label">
                ENSEMBLE EXPRESSION <span>All parts</span>
              </div>
              <Slider
                label="Pitch variation"
                value={score.dispersion}
                onChange={(dispersion) => edit({ ...score, dispersion })}
                display={`${Math.round(score.dispersion * 100)}%`}
                hint="Precise unison → natural differences"
              />
              <Slider
                label="Timing variation"
                value={score.timing}
                onChange={(timing) => edit({ ...score, timing })}
                display={`${Math.round(score.timing * 100)}%`}
              />
              <Slider
                label={neural ? "Pitch expression" : "Vibrato"}
                value={score.vibrato}
                onChange={(vibrato) => edit({ ...score, vibrato })}
                display={`${Math.round(score.vibrato * 100)}%`}
                hint={
                  neural ? "Straight notes → learned pitch movement" : undefined
                }
              />
              <Slider
                label="Room ambience"
                value={score.room}
                onChange={(room) => edit({ ...score, room })}
                display={`${Math.round(score.room * 100)}%`}
              />
              <button
                className="retake-button"
                onClick={() =>
                  edit({
                    ...score,
                    seed: Math.floor(Math.random() * 2147483647),
                  })
                }
              >
                <Shuffle size={14} />
                New performance <span>↗</span>
              </button>
              <p className="retake-hint">
                Vary each singer’s phrasing.
                <br />
                Your notes and lyrics stay the same.
              </p>
            </div>
          </aside>
        </main>
      )}
      <section className="transport" aria-label="Playback and export">
        <div className="transport-left">
          <button
            className="icon-button"
            aria-label="Stop playback"
            onClick={stop}
          >
            <Square size={16} />
          </button>
          <button
            className="play-button"
            aria-label={playing ? "Pause" : "Play choir"}
            onClick={playPause}
            disabled={
              !!isRendering ||
              health !== "ready" ||
              (simpleMode && !guided.planned)
            }
          >
            {isRendering ? (
              <LoaderCircle className="spin" size={19} />
            ) : playing ? (
              <Pause size={20} fill="currentColor" />
            ) : (
              <Play size={20} fill="currentColor" />
            )}
          </button>
          <div className="time-display">
            {fmt(time)}
            <span>
              /{" "}
              {fmt(
                current && rendered
                  ? rendered.result.duration
                  : simpleMode && guided.planned
                    ? (Math.max(
                        ...guided.planned.tracks[0].notes.map(
                          (n) => n.start + n.duration,
                        ),
                      ) *
                        60) /
                        guided.planned.bpm +
                      2
                    : (length * 60) / score.bpm,
              )}
            </span>
          </div>
          <span className="transport-divider" />
          {simpleMode ? (
            <span className="simple-tempo">
              {guided.settings.pace === "slow"
                ? "Unhurried"
                : guided.settings.pace === "bright"
                  ? "Bright"
                  : "Flowing"}
            </span>
          ) : (
            <>
              <label className="tempo">
                <input
                  aria-label="Tempo BPM"
                  type="number"
                  min="40"
                  max="200"
                  value={score.bpm}
                  onChange={(e) => {
                    const v = +e.target.value;
                    if (v >= 40 && v <= 200) edit({ ...score, bpm: v });
                  }}
                />
                <span>BPM</span>
              </label>
              <div className="time-signature">
                4/4<span>SIGNATURE</span>
              </div>
            </>
          )}
        </div>
        <div className="render-display">
          {isRendering ? (
            <>
              <div className="render-progress">
                <span
                  style={{
                    width: `${Math.max(2, (job?.progress || 0) * 100)}%`,
                  }}
                />
              </div>
              <div className="render-caption">
                <span>{job?.message || "Starting render…"}</span>
                <button
                  onClick={() =>
                    job &&
                    request(`/api/jobs/${job.id}`, { method: "DELETE" }).catch(
                      (e) => setNotice(e.message),
                    )
                  }
                >
                  Cancel
                </button>
              </div>
            </>
          ) : (
            <>
              <div
                className={`waveform ${current ? "ready" : ""}`}
                aria-hidden="true"
              >
                {(
                  rendered?.result.waveform ||
                  Array.from({ length: 100 }, () => 0.08)
                ).map((v, i) => (
                  <i
                    key={i}
                    style={{
                      height: `${Math.max(2, v * 32)}px`,
                      background:
                        current &&
                        rendered &&
                        i / rendered.result.waveform.length <
                          time / rendered.result.duration
                          ? "var(--accent)"
                          : undefined,
                    }}
                  />
                ))}
              </div>
              <div className="render-caption">
                <span>
                  {current
                    ? "Rendered · 24-bit stereo WAV"
                    : rendered
                      ? "Score changed · render to hear your edits"
                      : simpleMode
                        ? "Create your choir, then listen here."
                        : "Your choir is waiting. Render to hear it."}
                </span>
                {current && (
                  <span>{rendered?.result.elapsed.toFixed(1)}s render</span>
                )}
              </div>
            </>
          )}
        </div>
        <div className="export-controls">
          {!simpleMode && (
            <button
              className="icon-button"
              aria-label="Export MIDI"
              title="Export notes as MIDI"
              onClick={() => exportMidi(score)}
            >
              <FileMusic size={18} />
            </button>
          )}
          <a
            role="link"
            className={`secondary-button ${!current ? "disabled" : ""}`}
            href={current ? rendered?.result.stemsUrl : undefined}
            aria-disabled={!current}
            tabIndex={current ? 0 : -1}
          >
            <Download size={15} />
            Stems
          </a>
          <a
            role="link"
            className={`export-button ${!current ? "disabled" : ""}`}
            href={current ? rendered?.result.audioUrl : undefined}
            download="choire-mix.wav"
            aria-disabled={!current}
            tabIndex={current ? 0 : -1}
          >
            <Download size={15} />
            Export WAV
          </a>
        </div>
      </section>
      <footer className="studio-footer">
        <span>
          <i />
          {neural ? "DIFFSINGER · NISHIREN" : "EXPERIMENTAL VOICE ENGINE"}
          <span className="footer-separator">/</span>
          English · {neural ? "44.1" : "24"} kHz · Local rendering
        </span>
        <button
          disabled={!!isRendering}
          onClick={() => {
            edit(initialScore());
            setActive("soprano");
            setSelected(null);
            setNotice("Demo restored. Undo returns to your composition.");
          }}
        >
          <RotateCcw size={12} />
          Restore demo
        </button>
        <span className="footer-right">
          MADE FOR VOICES THAT BELONG TOGETHER
        </span>
      </footer>
      <audio
        ref={audio}
        src={rendered?.result.audioUrl}
        onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onError={() =>
          rendered &&
          setNotice("Audio could not be loaded. Render the score again.")
        }
        preload="auto"
      />
    </div>
  );
}
