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
const context = await browser.newContext({
  viewport: { width: 1440, height: 1120 },
  acceptDownloads: true,
});
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
try {
  await page.goto("http://127.0.0.1:8765");
  await page.getByText("Voice engine ready", { exact: true }).waitFor();
  await page.getByText("Saved on this device", { exact: false }).waitFor();
  await page.screenshot({
    path: "artifacts/qa/studio-desktop.png",
    fullPage: true,
  });
  assert.equal(await page.locator(".midi-note").count(), 5);
  const first = page.locator(".midi-note").first();
  await first.click();
  assert.equal(await page.getByLabel("Selected note pitch").inputValue(), "69");
  await page.getByLabel("Selected note pitch").selectOption("70");
  assert.equal(await page.getByLabel("Selected note pitch").inputValue(), "70");
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  assert.equal(await page.getByLabel("Selected note pitch").inputValue(), "69");
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  assert.equal(await page.getByLabel("Selected note pitch").inputValue(), "70");
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await page.getByLabel("Part lyrics").fill("May our hearts shine on");
  await page.getByRole("button", { name: "Apply lyrics" }).click();
  assert.equal(
    await page.getByRole("button", { name: /hearts, C5/ }).count(),
    1,
  );
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await page.getByRole("button", { name: "Mute Bass", exact: true }).click();
  assert.equal(
    await page
      .getByRole("button", { name: "Mute Bass", exact: true })
      .getAttribute("aria-pressed"),
    "true",
  );
  await page.getByRole("button", { name: "Mute Bass", exact: true }).click();
  // Real audio request, without mocking any engine responses.
  await page.getByRole("button", { name: "Render choir", exact: true }).click();
  await page
    .getByText("Rendered · 24-bit stereo WAV", { exact: true })
    .waitFor({ timeout: 120000 });
  assert.equal(
    await page
      .getByRole("link", { name: "Export WAV", exact: true })
      .getAttribute("aria-disabled"),
    "false",
  );
  await page.getByRole("button", { name: "Play choir", exact: true }).click();
  await page.waitForFunction(
    () => {
      const a = document.querySelector("audio");
      return a && !a.paused && a.currentTime > 0.4;
    },
    { timeout: 10000 },
  );
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  const [wav] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("link", { name: "Export WAV", exact: true }).click(),
  ]);
  await wav.saveAs("artifacts/qa/browser-export.wav");
  const [stems] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("link", { name: "Stems", exact: true }).click(),
  ]);
  await stems.saveAs("artifacts/qa/browser-stems.zip");
  await page.screenshot({
    path: "artifacts/qa/studio-rendered.png",
    fullPage: true,
  });
  await page
    .getByRole("slider", { name: "Ensemble size", exact: true })
    .fill("5");
  await page
    .getByText("Score changed · render to hear your edits", { exact: true })
    .waitFor();
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
  const [project] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Save project", exact: true }).click(),
  ]);
  await project.saveAs("artifacts/qa/browser-project.choire.json");
  await page.getByLabel("Project title").fill("Saved composition");
  await page.waitForFunction(
    () =>
      JSON.parse(localStorage.getItem("choire.project.v1") || "{}").title ===
      "Saved composition",
  );
  await page.reload();
  await page.getByText("Saved on this device", { exact: false }).waitFor();
  assert.equal(
    await page.getByLabel("Project title").inputValue(),
    "Saved composition",
  );
  await page
    .locator("input[type=file]")
    .setInputFiles("artifacts/qa/browser-project.choire.json");
  await page
    .getByText("Project loaded. Undo returns to your previous score.", {
      exact: true,
    })
    .waitFor();
  assert.equal(
    await page.getByLabel("Project title").inputValue(),
    "A little light",
  );
  await page.getByRole("button", { name: "Dismiss message" }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: "artifacts/qa/studio-mobile.png",
    fullPage: true,
  });
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
    "Mobile page must not overflow horizontally",
  );

  // Every part and the audio export controls remain available on mobile.
  assert.equal(
    await page.getByRole("button", { name: "Solo Alto", exact: true }).count(),
    1,
  );
  assert.equal(
    await page
      .getByRole("slider", { name: "Ensemble size", exact: true })
      .count(),
    1,
  );
  assert.equal(
    await page.getByRole("link", { name: "Export WAV", exact: true }).count(),
    1,
  );
  assert.deepEqual(errors, []);
  await writeFile(
    "artifacts/qa/ui-verification.json",
    JSON.stringify(
      {
        passed: true,
        checks: [
          "edit pitch",
          "undo/redo",
          "assign lyrics",
          "mute part",
          "real four-part render",
          "audio playback advances",
          "download stereo WAV",
          "download stems ZIP",
          "invalidate stale audio",
          "restore render after undo",
          "save/load project",
          "local persistence",
          "390px responsive layout",
        ],
        consoleErrors: errors,
      },
      null,
      2,
    ),
  );
  console.log("UI verification passed; desktop and mobile captures saved.");
} finally {
  await browser.close();
}
