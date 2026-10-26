import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
const browser = await chromium.launch({
  headless: true,
  executablePath:
    process.env.CHROME_PATH ||
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
});
const page = await browser.newPage({
  viewport: { width: 1440, height: 1000 },
  acceptDownloads: true,
});
try {
  await page.goto("http://127.0.0.1:8765");
  await page.getByText("Voice engine ready", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Advanced", exact: true }).click();
  await page.getByRole("button", { name: "+ Note", exact: true }).click();
  assert.equal(await page.getByLabel("Selected note start").inputValue(), "17");
  assert.equal(
    await page.getByLabel("Selected note duration").inputValue(),
    "1",
  );
  await page.getByRole("button", { name: "Delete selected note" }).click();
  assert.equal(await page.locator(".midi-note").count(), 5);
  // Remove a note, then place one with the actual piano-roll pointer handler.
  await page.locator(".midi-note").first().click();
  await page.getByRole("button", { name: "Delete selected note" }).click();
  const grid = await page.locator(".note-grid").boundingBox();
  await page
    .locator(".note-grid")
    .click({ position: { x: grid.width / 32, y: 8 * 21 + 9 } });
  assert.equal(await page.getByLabel("Selected note pitch").inputValue(), "69");
  assert.equal(
    await page.getByLabel("Selected note start").inputValue(),
    "1.5",
  );
  // Move it a semitone with pointer capture.
  let box = await page
    .getByRole("button", { name: /ah, A4, beat 1.5/ })
    .boundingBox();
  await page.mouse.move(box.x + 10, box.y + 8);
  await page.mouse.down();
  await page.mouse.move(box.x + 10, box.y - 13, { steps: 4 });
  await page.mouse.up();
  assert.equal(await page.getByLabel("Selected note pitch").inputValue(), "70");
  // Resize into the remaining half beat before the next existing note.
  box = await page
    .getByRole("button", { name: /ah, A♯4, beat 1.5/ })
    .boundingBox();
  await page.mouse.move(box.x + box.width - 3, box.y + 8);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width - 3 + grid.width / 32, box.y + 8, {
    steps: 4,
  });
  await page.mouse.up();
  assert.equal(
    await page.getByLabel("Selected note duration").inputValue(),
    "1.5",
  );
  // Piano key editing and MIDI round trip.
  await page.getByRole("button", { name: /ah, A♯4, beat 1.5/ }).focus();
  await page.keyboard.press("ArrowDown");
  assert.equal(await page.getByLabel("Selected note pitch").inputValue(), "69");
  const [midi] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Export MIDI", exact: true }).click(),
  ]);
  await midi.saveAs("artifacts/qa/browser-score.mid");
  await page
    .locator("input[type=file]")
    .setInputFiles("artifacts/qa/browser-score.mid");
  await page
    .getByText(
      "MIDI imported at the first tempo, snapped to ¼ beats. Add lyrics to replace “ah”.",
      { exact: true },
    )
    .waitFor();
  assert.equal(await page.locator(".midi-note").count(), 5);
  assert.equal(
    await page.getByLabel("Part lyrics").inputValue(),
    "ah ah ah ah ah",
  );
  // Cancellation traverses the actual queued/rendering job endpoint.
  await page.getByRole("button", { name: "Render choir", exact: true }).click();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await page
    .getByRole("button", { name: "Render choir", exact: true })
    .waitFor({ state: "visible", timeout: 20000 });
  assert.equal(
    await page
      .getByRole("link", { name: "Export WAV", exact: true })
      .getAttribute("aria-disabled"),
    "true",
  );
  await writeFile(
    "artifacts/qa/editing-verification.json",
    JSON.stringify(
      {
        passed: true,
        checks: [
          "append note beyond demo",
          "delete note",
          "click empty grid",
          "pointer drag changes pitch",
          "pointer resize changes duration",
          "keyboard pitch edit",
          "export and re-import MIDI",
          "cancel real render",
        ],
      },
      null,
      2,
    ),
  );
  console.log("Piano roll, MIDI round trip, and cancellation passed.");
} finally {
  await browser.close();
}
