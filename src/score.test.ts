import { describe, it, expect } from "vitest";
import { Midi } from "@tonejs/midi";
import { initialScore, fitNote, assignLyrics, importMidi } from "./score";
describe("musical edits", () => {
  it("does not allow overlapping notes in a vocal part", () => {
    const track = initialScore().tracks[0];
    expect(fitNote(track, { ...track.notes[0], start: 1 })).toBe(false);
    expect(fitNote(track, { ...track.notes[0], pitch: 70 })).toBe(true);
  });
  it("assigns syllables in time order and preserves notes without new lyrics", () => {
    const track = initialScore().tracks[0];
    const result = assignLyrics(
      { ...track, notes: [...track.notes].reverse() },
      "to-geth-er",
    );
    expect(result.notes.map((n) => n.lyric)).toEqual([
      "to",
      "geth",
      "er",
      "shine",
      "on",
    ]);
  });
  it("splits polyphonic MIDI into separate choir parts", () => {
    const midi = new Midi();
    midi.header.setTempo(90);
    const t = midi.addTrack();
    t.addNote({ midi: 60, ticks: 0, durationTicks: 480 });
    t.addNote({ midi: 67, ticks: 0, durationTicks: 480 });
    const bytes = new Uint8Array(midi.toArray());
    const score = importMidi(bytes.buffer);
    expect(score.tracks[0].notes[0].pitch).toBe(67);
    expect(score.tracks[1].notes[0].pitch).toBe(60);
    expect(score.bpm).toBe(90);
  });
  it("rejects a MIDI score with more than four simultaneous voices", () => {
    const midi = new Midi();
    const t = midi.addTrack();
    for (let i = 0; i < 5; i++)
      t.addNote({ midi: 60 + i, ticks: 0, durationTicks: 480 });
    expect(() => importMidi(new Uint8Array(midi.toArray()).buffer)).toThrow(
      "four",
    );
  });
});
