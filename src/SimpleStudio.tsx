import {
  ArrowUpRight,
  Check,
  LoaderCircle,
  RefreshCw,
  Waves,
} from "lucide-react";
import type { Score, SimpleSettings } from "./score";
import { COLORS } from "./score";
import "./simple.css";

export const LYRIC_STARTERS = [
  "May our light shine on",
  "Let the morning find us here",
  "We are home beneath the stars",
  "Hold this moment in your heart",
  "Every road can lead us home",
  "Where the river meets the sea",
];

const PACES = [
  { id: "slow", name: "Unhurried", hint: "Room to breathe", bpm: 68 },
  { id: "flowing", name: "Flowing", hint: "An easy movement", bpm: 84 },
  { id: "bright", name: "Bright", hint: "A little more lift", bpm: 104 },
] as const;
const CHARACTERS = [
  {
    id: "intimate",
    name: "Intimate",
    hint: "Four voices, close and clear",
    voices: 4,
  },
  {
    id: "warm",
    name: "Warm",
    hint: "A small choir, softly blended",
    voices: 8,
  },
  {
    id: "radiant",
    name: "Radiant",
    hint: "A fuller choir, an open room",
    voices: 12,
  },
] as const;

type Props = {
  settings: SimpleSettings;
  onChange: (settings: SimpleSettings) => void;
  planned: Score | null;
  planning: boolean;
  error: string;
  rendering: boolean;
  ready: boolean;
  dirty: boolean;
  onCreate: () => void;
  onAdvanced: () => void;
};

export default function SimpleStudio({
  settings,
  onChange,
  planned,
  planning,
  error,
  rendering,
  ready,
  dirty,
  onCreate,
  onAdvanced,
}: Props) {
  const words =
    settings.lyrics.trim().match(/[a-zA-Z]+(?:['’][a-zA-Z]+)?/g) || [];
  const end = planned
    ? Math.max(...planned.tracks[0].notes.map((n) => n.start + n.duration))
    : 0;
  const seconds = planned ? Math.ceil((end * 60) / planned.bpm + 2) : 0;
  const selectedCharacter = CHARACTERS.find(
    (c) => c.id === settings.character,
  )!;
  return (
    <main className="simple-studio" aria-label="Simple studio">
      <div className="simple-intro">
        <div>
          <div className="eyebrow">LESS TUNING. MORE FEELING.</div>
          <h1>
            A few words.
            <br />
            <span>A room full of voices.</span>
          </h1>
        </div>
        <p>
          Choose the feeling. Write what matters.
          <br />
          We’ll take care of the harmonies.
        </p>
      </div>
      <div className="simple-workbench">
        <section className="simple-words">
          <div className="simple-section-heading">
            <label htmlFor="simple-lyrics">
              <span>01</span> Your words
            </label>
            <button
              type="button"
              className="simple-text-button"
              disabled={rendering}
              onClick={() => {
                const index = LYRIC_STARTERS.indexOf(settings.lyrics.trim());
                onChange({
                  ...settings,
                  lyrics: LYRIC_STARTERS[(index + 1) % LYRIC_STARTERS.length],
                });
              }}
            >
              <RefreshCw size={13} /> New lyrics
            </button>
          </div>
          <textarea
            id="simple-lyrics"
            aria-label="Your lyrics"
            value={settings.lyrics}
            maxLength={400}
            disabled={rendering}
            spellCheck={true}
            aria-invalid={!!error}
            aria-describedby="simple-lyric-help simple-error"
            onChange={(e) => onChange({ ...settings, lyrics: e.target.value })}
            placeholder="What would you like your choir to sing?"
          />
          <div className="simple-lyric-meta" id="simple-lyric-help">
            <span>English · a new line leaves room for a breath</span>
            <span className={words.length > 24 ? "over-limit" : ""}>
              {words.length} / 24 words
            </span>
          </div>
          <div
            id="simple-error"
            className={`simple-feedback ${error ? "has-error" : ""}`}
            role="status"
          >
            {error ||
              (planning ? (
                <>
                  <LoaderCircle size={13} className="spin" /> Finding a place
                  for every word…
                </>
              ) : (
                <>
                  <Check size={13} /> Every word fits. Your harmonies are ready.
                </>
              ))}
          </div>
          <div
            className="simple-score-preview"
            aria-label={
              planned
                ? `Arrangement preview, ${seconds} seconds, four harmonies`
                : "Arrangement preview"
            }
          >
            <div className="simple-preview-heading">
              <span>THE SHAPE OF YOUR CHOIR</span>
              <span>{planned ? `~${seconds} sec` : "—"}</span>
            </div>
            <svg
              viewBox="0 0 560 120"
              role="img"
              aria-label="Four vocal lines with phrased entrances and a gentle ending"
            >
              {[0, 1, 2, 3].map((row) => (
                <line
                  key={row}
                  x1="0"
                  y1={18 + row * 28}
                  x2="560"
                  y2={18 + row * 28}
                  stroke="var(--line)"
                />
              ))}
              {planned?.tracks.map((track, row) =>
                track.notes.map((note) => (
                  <rect
                    key={note.id}
                    x={(note.start / end) * 554 + 2}
                    y={row * 28 + 15 - (note.pitch - 60) * 0.5}
                    width={Math.max(2, (note.duration / end) * 554 - 3)}
                    height="5"
                    rx="2"
                    fill={COLORS[track.part]}
                    opacity={0.85}
                  />
                )),
              )}
            </svg>
            <div className="simple-preview-foot">
              <span>Melody · harmony · breathing space</span>
              <button
                className="simple-text-button"
                onClick={onAdvanced}
                disabled={rendering || !planned}
              >
                Edit arrangement <ArrowUpRight size={13} />
              </button>
            </div>
          </div>
        </section>
        <section className="simple-feeling">
          <fieldset disabled={rendering}>
            <legend className="simple-section-heading">
              <span>02</span> Set the pace
            </legend>
            <div className="pace-options">
              {PACES.map((p) => (
                <label
                  key={p.id}
                  className={`pace-option ${settings.pace === p.id ? "selected" : ""}`}
                >
                  <input
                    type="radio"
                    name="simple-pace"
                    aria-label={p.name}
                    checked={settings.pace === p.id}
                    onChange={() => onChange({ ...settings, pace: p.id })}
                  />
                  <span className={`pace-symbol ${p.id}`} aria-hidden="true">
                    <i />
                    <i />
                    <i />
                    <i />
                  </span>
                  <strong>{p.name}</strong>
                  <small>{p.hint}</small>
                </label>
              ))}
            </div>
          </fieldset>
          <fieldset disabled={rendering}>
            <legend className="simple-section-heading">
              <span>03</span> Choose the feeling
            </legend>
            <div className="character-options">
              {CHARACTERS.map((c) => (
                <label
                  key={c.id}
                  className={`character-option ${settings.character === c.id ? "selected" : ""}`}
                >
                  <input
                    type="radio"
                    name="simple-character"
                    aria-label={c.name}
                    checked={settings.character === c.id}
                    onChange={() => onChange({ ...settings, character: c.id })}
                  />
                  <span className="character-voices" aria-hidden="true">
                    {Array.from({ length: c.voices }, (_, i) => (
                      <i key={i} />
                    ))}
                  </span>
                  <span>
                    <strong>{c.name}</strong>
                    <small>{c.hint}</small>
                  </span>
                  <span className="choice-check" aria-hidden="true">
                    {settings.character === c.id && <Check size={13} />}
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
        </section>
      </div>
      <div className="simple-create-row">
        <div className="simple-reassurance">
          <span className="simple-check">
            <Check size={17} />
          </span>
          <div>
            <strong>Thoughtfully arranged, every time.</strong>
            <p>Comfortable notes. Balanced voices. A gentle ending.</p>
          </div>
        </div>
        <div className="simple-create-actions">
          <button
            className="simple-text-button"
            disabled={rendering}
            onClick={() =>
              onChange({
                ...settings,
                variation: (settings.variation + 1) % 1000000,
              })
            }
          >
            <RefreshCw size={13} /> Another melody
          </button>
          <button
            className="primary-button simple-create"
            disabled={!planned || !ready || rendering}
            onClick={onCreate}
          >
            {rendering ? (
              <LoaderCircle size={17} className="spin" />
            ) : (
              <Waves size={17} />
            )}
            {rendering ? "Bringing your choir together…" : "Create & listen"}
          </button>
        </div>
      </div>
      <div className="simple-bottom-note">
        <span>
          {selectedCharacter.voices} voices · four harmonies · local rendering
        </span>
        <span>
          {dirty
            ? "Creating arranges your words into a new score. Undo restores the previous score."
            : "Your arrangement is ready to explore in Advanced."}
        </span>
      </div>
    </main>
  );
}
