import { Midi } from "@tonejs/midi";
import demo from "../public/demo.choire.json";
export type Part = "soprano" | "alto" | "tenor" | "bass";
export type Note = {
  id: string;
  pitch: number;
  start: number;
  duration: number;
  lyric: string;
  velocity: number;
};
export type Track = {
  id: string;
  name: string;
  part: Part;
  voice: string;
  singers: number;
  gain: number;
  pan: number;
  mute: boolean;
  solo: boolean;
  notes: Note[];
};
export type Score = {
  version: 1;
  title: string;
  bpm: number;
  tracks: Track[];
  dispersion: number;
  timing: number;
  vibrato: number;
  room: number;
  seed: number;
};
export const PARTS: Part[] = ["soprano", "alto", "tenor", "bass"];
export const COLORS: Record<Part, string> = {
  soprano: "#b4a7d6",
  alto: "#d9ba85",
  tenor: "#89b9a5",
  bass: "#c58e93",
};
export const VOICES: Record<string, string> = {
  af_heart: "Clara · clear soprano",
  af_bella: "Elise · warm soprano",
  af_nicole: "Nora · soft alto",
  af_sarah: "Mara · full alto",
  am_fenrir: "Felix · clear tenor",
  am_michael: "Miles · warm baritone",
  am_adam: "Adam · deep bass",
  bm_george: "George · round bass",
};
export const newId = () => crypto.randomUUID();
export const initialScore = () => structuredClone(demo) as Score;
export const noteName = (pitch: number) =>
  ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"][
    pitch % 12
  ] +
  (Math.floor(pitch / 12) - 1);
export const isBlack = (pitch: number) => [1, 3, 6, 8, 10].includes(pitch % 12);
export function fitNote(track: Track, candidate: Note): boolean {
  return (
    [candidate.start, candidate.duration, candidate.pitch].every(
      Number.isFinite,
    ) &&
    candidate.duration <= 16 &&
    candidate.start >= 0 &&
    candidate.duration >= 0.25 &&
    candidate.start + candidate.duration <= 128 &&
    candidate.pitch >= 36 &&
    candidate.pitch <= 84 &&
    !track.notes.some(
      (n) =>
        n.id !== candidate.id &&
        n.start < candidate.start + candidate.duration - 0.001 &&
        candidate.start < n.start + n.duration - 0.001,
    )
  );
}
export function assignLyrics(track: Track, text: string): Track {
  const syllables = text
    .trim()
    .split(/[\s\-]+/)
    .filter(Boolean);
  const ordered = [...track.notes].sort((a, b) => a.start - b.start);
  return {
    ...track,
    notes: ordered.map((n, i) => ({ ...n, lyric: syllables[i] || n.lyric })),
  };
}
export function download(filename: string, data: Blob) {
  const url = URL.createObjectURL(data);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
export function exportMidi(score: Score) {
  const midi = new Midi();
  midi.header.name = score.title;
  midi.header.setTempo(score.bpm);
  score.tracks.forEach((t) => {
    const mt = midi.addTrack();
    mt.name = t.name;
    mt.instrument.number = 52;
    t.notes.forEach((n) =>
      mt.addNote({
        midi: n.pitch,
        ticks: Math.round(n.start * midi.header.ppq),
        durationTicks: Math.round(n.duration * midi.header.ppq),
        velocity: n.velocity,
      }),
    );
  });
  download(
    `${score.title || "choire"}.mid`,
    new Blob([new Uint8Array(midi.toArray())], { type: "audio/midi" }),
  );
}
export function importMidi(buffer: ArrayBuffer): Score {
  const midi = new Midi(buffer);
  const score = initialScore();
  score.title = midi.header.name || "Imported melody";
  score.bpm = Math.round(midi.header.tempos[0]?.bpm || 120);
  if (score.bpm < 40 || score.bpm > 200)
    throw new Error("Use a MIDI tempo between 40 and 200 BPM.");
  const lanes: Note[][] = [];
  for (const mt of midi.tracks) {
    const trackLanes: Note[][] = [];
    for (const n of [...mt.notes].sort(
      (a, b) => a.ticks - b.ticks || b.midi - a.midi,
    )) {
      const start = Math.round((n.ticks / midi.header.ppq) * 4) / 4;
      const duration = Math.max(
        0.25,
        Math.round((n.durationTicks / midi.header.ppq) * 4) / 4,
      );
      if (n.midi < 36 || n.midi > 84 || start + duration > 128)
        throw new Error("MIDI must fit C2–C6 and 128 beats.");
      const note: Note = {
        id: newId(),
        pitch: n.midi,
        start,
        duration,
        lyric: "ah",
        velocity: Math.max(0.1, n.velocity),
      };
      let lane = trackLanes.find(
        (l) =>
          l[l.length - 1].start + l[l.length - 1].duration <= start + 0.001,
      );
      if (!lane) {
        lane = [];
        trackLanes.push(lane);
      }
      lane.push(note);
    }
    lanes.push(...trackLanes);
  }
  if (!lanes.length) throw new Error("No MIDI notes found.");
  if (lanes.length > 4)
    throw new Error(
      "This MIDI needs more than four independent vocal parts. Import a simpler arrangement.",
    );
  lanes.sort(
    (a, b) =>
      b.reduce((sum, n) => sum + n.pitch, 0) / b.length -
      a.reduce((sum, n) => sum + n.pitch, 0) / a.length,
  );
  score.tracks = score.tracks.map((t, i) => ({ ...t, notes: lanes[i] || [] }));
  return score;
}
