import { useEffect, useRef, useState } from "react";
import type { CSSProperties, PointerEvent, KeyboardEvent } from "react";
import { COLORS, fitNote, isBlack, newId, noteName } from "./score";
import type { Note, Track } from "./score";

type Props = {
  track: Track;
  tracks: Track[];
  selected: string | null;
  onSelect: (id: string | null) => void;
  onNotes: (notes: Note[]) => void;
  onError: (message: string) => void;
  beat: number;
  snap: number;
  zoom: number;
  length: number;
};
export default function PianoRoll({
  track,
  tracks,
  selected,
  onSelect,
  onNotes,
  onError,
  beat,
  snap,
  zoom,
  length,
}: Props) {
  const scroll = useRef<HTMLDivElement>(null);
  const grid = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState<Note | null>(null);
  const drag = useRef<{
    note: Note;
    x: number;
    y: number;
    mode: "move" | "resize";
    width: number;
    moved: boolean;
  } | null>(null);
  const [offset, setOffset] = useState(0);
  const baseTop = { soprano: 77, alto: 72, tenor: 69, bass: 62 }[track.part];
  const top = Math.max(59, Math.min(84, baseTop + offset));
  const pitches = Array.from({ length: 25 }, (_, i) => top - i);
  const rowHeight = 21;
  useEffect(() => {
    setOffset(0);
    setDraft(null);
    drag.current = null;
  }, [track.id]);
  useEffect(() => {
    if (beat > 0 && scroll.current) {
      const width = grid.current?.clientWidth || 1;
      const x = (beat / length) * width;
      if (x > scroll.current.scrollLeft + scroll.current.clientWidth - 70)
        scroll.current.scrollLeft = x - 100;
    }
  }, [beat, length]);
  function add(e: PointerEvent<HTMLDivElement>) {
    if (e.button !== 0 || !grid.current) return;
    const r = grid.current.getBoundingClientRect();
    const start =
      Math.floor((((e.clientX - r.left) / r.width) * length) / snap) * snap;
    const pitch = top - Math.floor((e.clientY - r.top) / rowHeight);
    const duration = Math.max(snap, Math.min(1, length - start));
    const note = {
      id: newId(),
      pitch,
      start,
      duration,
      lyric: "ah",
      velocity: 0.8,
    };
    if (fitNote(track, note)) {
      onNotes([...track.notes, note]);
      onSelect(note.id);
    } else
      onError(
        "There is already a note at this time. Each part sings one note at a time.",
      );
  }
  function startDrag(e: PointerEvent<HTMLButtonElement>, note: Note) {
    if (e.button !== 0) return;
    e.stopPropagation();
    onSelect(note.id);
    const rect = e.currentTarget.getBoundingClientRect();
    drag.current = {
      note,
      x: e.clientX,
      y: e.clientY,
      mode: e.clientX > rect.right - 12 ? "resize" : "move",
      width: grid.current?.clientWidth || 1,
      moved: false,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  }
  function move(e: PointerEvent<HTMLButtonElement>) {
    const d = drag.current;
    if (!d) return;
    const delta =
      Math.round((((e.clientX - d.x) / d.width) * length) / snap) * snap;
    const dy = Math.round((e.clientY - d.y) / rowHeight);
    d.moved ||= Math.abs(e.clientX - d.x) > 3 || Math.abs(e.clientY - d.y) > 3;
    const n =
      d.mode === "resize"
        ? {
            ...d.note,
            duration: Math.max(
              snap,
              Math.min(16, d.note.duration + delta, 128 - d.note.start),
            ),
          }
        : {
            ...d.note,
            start: Math.max(
              0,
              Math.min(128 - d.note.duration, d.note.start + delta),
            ),
            pitch: Math.max(36, Math.min(84, d.note.pitch - dy)),
          };
    setDraft(n);
  }
  function end() {
    const d = drag.current;
    if (d?.moved && draft) {
      if (fitNote(track, draft))
        onNotes(track.notes.map((n) => (n.id === draft.id ? draft : n)));
      else onError("Notes cannot overlap within a vocal part.");
    }
    setDraft(null);
    drag.current = null;
  }
  function key(e: KeyboardEvent<HTMLButtonElement>, note: Note) {
    if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      onNotes(track.notes.filter((n) => n.id !== note.id));
      onSelect(null);
      return;
    }
    const delta = e.shiftKey ? 12 : 1;
    const n =
      e.key === "ArrowUp"
        ? { ...note, pitch: note.pitch + delta }
        : e.key === "ArrowDown"
          ? { ...note, pitch: note.pitch - delta }
          : e.key === "ArrowRight"
            ? { ...note, start: note.start + snap }
            : e.key === "ArrowLeft"
              ? { ...note, start: note.start - snap }
              : null;
    if (n) {
      e.preventDefault();
      if (fitNote(track, n))
        onNotes(track.notes.map((x) => (x.id === n.id ? n : x)));
      else onError("That move would overlap another note or leave the score.");
    }
  }
  const minWidth = Math.max(600, length * 44 * zoom);
  return (
    <div className="piano-editor">
      <div className="piano-side">
        <div className="octave-controls">
          <button
            aria-label="Scroll pitches up"
            onClick={() => setOffset((o) => Math.min(84 - baseTop, o + 12))}
          >
            ⌃
          </button>
          <button
            aria-label="Scroll pitches down"
            onClick={() => setOffset((o) => Math.max(59 - baseTop, o - 12))}
          >
            ⌄
          </button>
        </div>
        {pitches.map((p) => (
          <div key={p} className={`piano-key ${isBlack(p) ? "black" : ""}`}>
            <span>{noteName(p)}</span>
          </div>
        ))}
      </div>
      <div className="piano-scroll" ref={scroll}>
        <div className="piano-content" style={{ minWidth }}>
          <div className="ruler">
            {Array.from({ length: Math.ceil(length / 4) }, (_, i) => (
              <span key={i} style={{ left: `${((i * 4) / length) * 100}%` }}>
                {String(i + 1).padStart(2, "0")}
                <small>{i === 0 ? "  ·  4/4" : ""}</small>
              </span>
            ))}
          </div>
          <div
            ref={grid}
            className="note-grid"
            style={
              {
                height: 25 * rowHeight,
                "--bar-width": `${400 / length}%`,
                "--beat-width": `${100 / length}%`,
              } as CSSProperties
            }
            onPointerDown={add}
          >
            {pitches.map((p) => (
              <div
                key={p}
                className={`pitch-row ${isBlack(p) ? "sharp" : ""} ${p % 12 === 0 ? "octave" : ""}`}
              />
            ))}
            {tracks
              .filter((t) => t.id !== track.id && !t.mute)
              .flatMap((t) =>
                t.notes
                  .filter((n) => n.pitch <= top && n.pitch >= top - 24)
                  .map((n) => (
                    <div
                      key={`${t.id}-${n.id}`}
                      className="ghost-note"
                      style={{
                        left: `${(n.start / length) * 100}%`,
                        width: `${(n.duration / length) * 100}%`,
                        top: (top - n.pitch) * rowHeight + 3,
                        background: COLORS[t.part],
                      }}
                    />
                  )),
              )}
            {track.notes.map((original) => {
              const n = draft?.id === original.id ? draft : original;
              if (n.pitch > top || n.pitch < top - 24) return null;
              return (
                <button
                  type="button"
                  key={n.id}
                  className={`midi-note ${selected === n.id ? "selected" : ""}`}
                  style={
                    {
                      left: `${(n.start / length) * 100}%`,
                      width: `${(n.duration / length) * 100}%`,
                      top: (top - n.pitch) * rowHeight + 2,
                      "--note-color": COLORS[track.part],
                    } as CSSProperties
                  }
                  aria-label={`${n.lyric}, ${noteName(n.pitch)}, beat ${n.start + 1}, ${n.duration} beats`}
                  onPointerDown={(e) => startDrag(e, n)}
                  onPointerMove={move}
                  onPointerUp={end}
                  onPointerCancel={() => {
                    drag.current = null;
                    setDraft(null);
                  }}
                  onKeyDown={(e) => key(e, n)}
                  onFocus={() => onSelect(n.id)}
                >
                  <span>{n.lyric}</span>
                  <i />
                </button>
              );
            })}
            {beat > 0 && (
              <div
                className="playhead"
                style={{ left: `${(beat / length) * 100}%` }}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
