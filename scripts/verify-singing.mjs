import { chromium } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";

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
try {
  await page.goto("http://127.0.0.1:8765");
  await page.getByText("Voice engine ready", { exact: true }).waitFor();
  await page.getByText("Saved on this device", { exact: false }).waitFor();
  assert.equal(
    await page.getByLabel("Singing engine", { exact: true }).inputValue(),
    "diffsinger",
  );
  // Import a pre-upgrade project: it must retain its original sound engine.
  await page
    .locator("input[type=file]")
    .setInputFiles("public/demo.choire.json");
  await page
    .getByText("Project loaded. Undo returns to your previous score.", {
      exact: true,
    })
    .waitFor();
  assert.equal(
    await page.getByLabel("Singing engine", { exact: true }).inputValue(),
    "kokoro-world",
  );
  assert.equal(
    await page.getByLabel("Voice color", { exact: true }).inputValue(),
    "af_heart",
  );
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  assert.equal(
    await page.getByLabel("Singing engine", { exact: true }).inputValue(),
    "diffsinger",
  );
  await page.getByRole("button", { name: "Dismiss message" }).click();
  await page.getByRole("button", { name: "Solo Soprano", exact: true }).click();
  await page
    .getByRole("slider", { name: "Room ambience", exact: true })
    .fill("0");
  await page.screenshot({
    path: "artifacts/qa/singing-desktop.png",
    fullPage: true,
  });
  const start = Date.now();
  await page.getByRole("button", { name: "Render choir", exact: true }).click();
  await page
    .getByText("Rendered · 24-bit stereo WAV", { exact: true })
    .waitFor({ timeout: 120000 });
  await page.getByRole("button", { name: "Play choir", exact: true }).click();
  await page.waitForFunction(() => {
    const audio = document.querySelector("audio");
    return audio && !audio.paused && audio.currentTime > 0.5;
  });
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  const [wav] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("link", { name: "Export WAV", exact: true }).click(),
  ]);
  await wav.saveAs("artifacts/qa/neural-browser.wav");
  const [stems] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("link", { name: "Stems", exact: true }).click(),
  ]);
  await stems.saveAs("artifacts/qa/neural-stems.zip");
  // Engine selection is a musical edit: stale audio cannot be exported.
  await page
    .getByLabel("Singing engine", { exact: true })
    .selectOption("kokoro-world");
  assert.equal(
    await page
      .getByRole("link", { name: "Export WAV", exact: true })
      .getAttribute("aria-disabled"),
    "true",
  );
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await page
    .getByText("Rendered · 24-bit stereo WAV", { exact: true })
    .waitFor();
  await page.getByRole("button", { name: "About the engine" }).click();
  await page.getByText("Best range: G3–D5.", { exact: false }).waitFor();
  await page.getByRole("button", { name: "Close engine information" }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: "artifacts/qa/singing-mobile.png",
    fullPage: true,
  });
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  const overlaps = await page.evaluate(() => {
    const a = document.querySelector(".voice-choices").getBoundingClientRect();
    const b = document
      .querySelector(".singers-heading")
      .getBoundingClientRect();
    return (
      a.left < b.right &&
      a.right > b.left &&
      a.top < b.bottom &&
      a.bottom > b.top
    );
  });
  assert.equal(
    overlaps,
    false,
    "Voice controls must not overlap the ensemble controls on mobile",
  );
  await page.reload();
  await page.getByText("Saved on this device", { exact: false }).waitFor();
  assert.equal(
    await page.getByLabel("Singing engine", { exact: true }).inputValue(),
    "diffsinger",
  );
  assert.equal(
    await page
      .getByRole("button", { name: "Solo Soprano", exact: true })
      .getAttribute("aria-pressed"),
    "true",
  );
  assert.deepEqual(errors, []);
  const receipt = {
    passed: true,
    realEngine: "DiffSinger / Nishiren",
    singers: 2,
    played: true,
    downloadedWav: true,
    downloadedStems: true,
    oldProjectMigration: true,
    engineUndo: true,
    mobileLayout: true,
    elapsedSeconds: (Date.now() - start) / 1000,
    errors,
  };
  await writeFile(
    "artifacts/qa/singing-verification.json",
    JSON.stringify(receipt, null, 2),
  );
  console.log(JSON.stringify(receipt, null, 2));
} finally {
  await browser.close();
}
