import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";

await mkdir("artifacts/qa", { recursive: true });
const browser = await chromium.launch({
  headless: true,
  executablePath:
    process.env.CHROME_PATH ||
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  args: ["--autoplay-policy=no-user-gesture-required"],
});
const page = await browser.newPage({
  viewport: { width: 1440, height: 1120 },
  acceptDownloads: true,
});
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const ready = () =>
  page
    .getByText("Every word fits. Your harmonies are ready.", { exact: true })
    .waitFor();
const stored = () =>
  page.evaluate(() => JSON.parse(localStorage.getItem("choire.project.v1")));
try {
  await page.goto("http://127.0.0.1:8765");
  await page.getByText("Voice engine ready", { exact: true }).waitFor();
  await ready();
  assert.equal(
    await page
      .getByRole("button", { name: "Simple", exact: true })
      .getAttribute("aria-pressed"),
    "true",
  );
  assert.equal(await page.locator(".midi-note").count(), 0);
  await page.waitForFunction(() => localStorage.getItem("choire.project.v1"));
  const original = await stored();
  await page.screenshot({
    path: "artifacts/qa/simple-desktop.png",
    fullPage: true,
  });

  await page.getByRole("radio", { name: "Unhurried", exact: true }).check();
  await page.getByRole("button", { name: "New lyrics", exact: true }).click();
  assert.equal(
    await page.getByLabel("Your lyrics").inputValue(),
    "Let the morning find us here",
  );
  await ready();
  await page.getByRole("button", { name: "Advanced", exact: true }).click();
  assert.equal(
    await page.locator(".midi-note").count(),
    original.tracks[0].notes.length,
  );
  assert.equal(
    await page.getByLabel("Tempo BPM").inputValue(),
    String(original.bpm),
  );
  await page.getByRole("button", { name: "Simple", exact: true }).click();
  assert.equal(
    await page.getByLabel("Your lyrics").inputValue(),
    "Let the morning find us here",
  );
  await page.getByLabel("Project title").fill("Morning choir");
  await ready();
  assert.equal(
    await page.getByLabel("Your lyrics").inputValue(),
    "Let the morning find us here",
    "Renaming must preserve the lyric draft",
  );
  await page.waitForFunction(() => {
    const d = JSON.parse(
      localStorage.getItem("choire.simpleDraft.v1") || "null",
    );
    return (
      d?.settings.lyrics === "Let the morning find us here" &&
      d?.score.includes("Morning choir")
    );
  });
  await page.reload();
  await ready();
  assert.equal(
    await page.getByLabel("Your lyrics").inputValue(),
    "Let the morning find us here",
    "Unrendered lyrics must survive reload",
  );
  assert.ok(
    await page
      .getByRole("radio", { name: "Unhurried", exact: true })
      .isChecked(),
  );

  await page.getByLabel("Your lyrics").fill("May zqxqzzq shine on");
  await page.getByText(/No English pronunciation for/).waitFor();
  assert.ok(
    await page
      .getByRole("button", { name: "Create & listen", exact: true })
      .isDisabled(),
  );
  await page.getByLabel("Your lyrics").fill("Let the morning find us here");
  await page.getByRole("radio", { name: "Bright", exact: true }).check();
  await page.getByRole("radio", { name: "Warm", exact: true }).check();
  await ready();
  const [project] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Save project", exact: true }).click(),
  ]);
  await project.saveAs("artifacts/qa/simple-project.choire.json");
  const planned = JSON.parse(
    await readFile("artifacts/qa/simple-project.choire.json", "utf8"),
  );
  assert.equal(planned.bpm, 104);
  assert.equal(planned.simple.pace, "bright");
  assert.deepEqual(
    planned.tracks[0].notes.map((n) => n.lyric),
    ["Let", "the", "morning", "find", "us", "here"],
  );
  assert.ok(
    planned.tracks.every((t) =>
      t.notes.every((n) => n.pitch >= 55 && n.pitch <= 74),
    ),
  );
  assert.deepEqual(
    (await stored()).tracks,
    original.tracks,
    "Drafting and saving must not replace the current score",
  );

  const started = Date.now();
  await page
    .getByRole("button", { name: "Create & listen", exact: true })
    .click();
  await page
    .getByText("Rendered · 24-bit stereo WAV", { exact: true })
    .waitFor({ timeout: 240000 });
  await page.waitForFunction(() => {
    const a = document.querySelector("audio");
    return a && !a.paused && a.currentTime > 0.5;
  });
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  const [wav] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("link", { name: "Export WAV", exact: true }).click(),
  ]);
  await wav.saveAs("artifacts/qa/simple-choir.wav");
  await page.screenshot({
    path: "artifacts/qa/simple-rendered.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Advanced", exact: true }).click();
  assert.equal(await page.getByLabel("Tempo BPM").inputValue(), "104");
  assert.equal(await page.locator(".midi-note").count(), 6);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  assert.deepEqual(
    (
      await page.evaluate(() =>
        [...document.querySelectorAll(".midi-note")].map((e) =>
          e.getAttribute("aria-label"),
        ),
      )
    ).length,
    original.tracks[0].notes.length,
  );
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await page.getByRole("button", { name: "Simple", exact: true }).click();
  await ready();
  await page
    .getByText("Rendered · 24-bit stereo WAV", { exact: true })
    .waitFor();
  await page
    .getByRole("button", { name: "Another melody", exact: true })
    .click();
  await ready();
  assert.equal(
    await page.getByLabel("Your lyrics").inputValue(),
    "Let the morning find us here",
  );
  assert.equal(
    await page
      .getByRole("link", { name: "Export WAV", exact: true })
      .getAttribute("aria-disabled"),
    "true",
  );

  for (const width of [1024, 390]) {
    await page.setViewportSize({ width, height: 844 });
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    await page.screenshot({
      path: `artifacts/qa/simple-${width}.png`,
      fullPage: true,
    });
    assert.ok(await page.getByLabel("Your lyrics").isVisible());
    assert.ok(
      await page
        .getByRole("button", { name: "Create & listen", exact: true })
        .isVisible(),
    );
  }
  assert.deepEqual(errors, []);
  const receipt = {
    passed: true,
    realNeuralChoir: true,
    singers: 8,
    lyrics: planned.simple.lyrics,
    pace: planned.bpm,
    notesInRange: true,
    played: true,
    downloaded: true,
    originalScorePreserved: true,
    unrenderedDraftRestored: true,
    invalidLyricsBlocked: true,
    undoRedo: true,
    responsive: true,
    elapsedSeconds: (Date.now() - started) / 1000,
    errors,
  };
  await writeFile(
    "artifacts/qa/simple-verification.json",
    JSON.stringify(receipt, null, 2),
  );
  console.log(JSON.stringify(receipt, null, 2));
} finally {
  await browser.close();
}
