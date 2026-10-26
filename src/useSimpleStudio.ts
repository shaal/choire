import { useEffect, useRef, useState } from "react";
import type { Score, SimpleSettings } from "./score";

export function scoreSignature(score: Score) {
  return JSON.stringify(
    { ...score, simple: score.simple ?? null },
    (_, value) =>
      value && typeof value === "object" && !Array.isArray(value)
        ? Object.fromEntries(
            Object.entries(value).sort(([a], [b]) => a.localeCompare(b)),
          )
        : value,
  );
}

function fromScore(score: Score): SimpleSettings {
  if (score.simple) return score.simple;
  const melody =
    score.tracks.find((t) => t.part === "soprano" && t.notes.length) ||
    score.tracks.find((t) => t.notes.length);
  return {
    lyrics: melody
      ? [...melody.notes]
          .sort((a, b) => a.start - b.start)
          .map((n) => n.lyric)
          .join(" ")
      : "May our light shine on",
    pace: score.bpm < 76 ? "slow" : score.bpm > 94 ? "bright" : "flowing",
    character:
      score.tracks[0].singers <= 1
        ? "intimate"
        : score.tracks[0].singers <= 2
          ? "warm"
          : "radiant",
    variation: 0,
  };
}

export default function useSimpleStudio(
  score: Score,
  enabled: boolean,
  restored: boolean,
) {
  const [settings, setSettings] = useState<SimpleSettings>(() =>
    fromScore(score),
  );
  const [plan, setPlan] = useState<{ key: string; score: Score } | null>(null);
  const [failure, setFailure] = useState<{
    key: string;
    message: string;
  } | null>(null);
  const base = useRef<string | null>(null);
  const musicalBase = useRef<string | null>(null);
  const signature = scoreSignature(score);
  const musicalSignature = scoreSignature({ ...score, title: "" });
  const key = JSON.stringify({ ...settings, title: score.title });

  useEffect(() => {
    if (!restored || base.current === signature) return;
    let next = fromScore(score);
    if (base.current === null) {
      try {
        const saved = JSON.parse(
          localStorage.getItem("choire.simpleDraft.v1") || "null",
        );
        if (
          saved?.score === signature &&
          typeof saved.settings?.lyrics === "string" &&
          ["slow", "flowing", "bright"].includes(saved.settings.pace) &&
          ["intimate", "warm", "radiant"].includes(saved.settings.character) &&
          Number.isInteger(saved.settings.variation)
        )
          next = saved.settings;
      } catch {
        /* A damaged optional draft must not prevent opening a score. */
      }
    } else if (musicalBase.current === musicalSignature) {
      // Renaming a project must not discard lyrics that have not been rendered.
      base.current = signature;
      return;
    }
    base.current = signature;
    musicalBase.current = musicalSignature;
    setSettings(next);
  }, [signature, musicalSignature, restored]);

  useEffect(() => {
    if (!restored) return;
    const timer = setTimeout(() => {
      try {
        localStorage.setItem(
          "choire.simpleDraft.v1",
          JSON.stringify({ score: signature, settings }),
        );
      } catch {
        /* Save project remains available if browser storage is full. */
      }
    }, 350);
    return () => clearTimeout(timer);
  }, [signature, settings, restored]);

  useEffect(() => {
    if (!enabled || !restored || plan?.key === key) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const response = await fetch("/api/arrange", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: key,
          signal: controller.signal,
        });
        const data = await response.json();
        if (!response.ok)
          throw new Error(
            typeof data.detail === "string"
              ? data.detail
              : "Please check your words and try again.",
          );
        if (!controller.signal.aborted) setPlan({ key, score: data });
      } catch (error) {
        if (!controller.signal.aborted)
          setFailure({ key, message: (error as Error).message });
      }
    }, 300);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [key, enabled, restored]);

  const planned = plan?.key === key ? plan.score : null;
  const error = failure?.key === key && !planned ? failure.message : "";
  return {
    settings,
    setSettings,
    planned,
    error,
    planning: !planned && !error,
    dirty: !planned || scoreSignature(planned) !== signature,
  };
}
