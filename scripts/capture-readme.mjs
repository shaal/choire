// Real screenshots in isolated browser contexts. No user profile, fixture
// injection, mocked responses, or edits to the shipped musical settings.
import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";

const baseURL = process.env.CHOIRE_URL || "http://127.0.0.1:8765";
const directory = "docs/screenshots";
await mkdir(directory, { recursive: true });
const demo = JSON.parse(await readFile("public/demo.choire.json", "utf8"));
const expected = {
  ...demo,
  engine: "diffsinger",
  vibrato: .85,
  tracks: demo.tracks.map((track, index) => ({ ...track, singers: 2,
    voice: ["nishiren-standard", "nishiren-soft", "nishiren-sweet", "nishiren-power"][index] })),
};
const defaultDraft = { lyrics: "May our light shine on", pace: "flowing", character: "warm", variation: 0 };
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  args: ["--autoplay-policy=no-user-gesture-required"],
});
const screenshots = [];
const errors = [];

async function openDefault(width, height) {
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2 });
  const page = await context.newPage();
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(baseURL);
  await page.getByText("Voice engine ready", { exact: true }).waitFor();
  await page.getByText("Every word fits. Your harmonies are ready.", { exact: true }).waitFor();
  await page.waitForFunction(() => localStorage.getItem("choire.project.v1") && localStorage.getItem("choire.simpleDraft.v1"));
  await page.evaluate(() => document.fonts.ready);
  await assertDefault(page);
  return { context, page };
}

async function assertDefault(page) {
  const state = await page.evaluate(() => ({
    score: JSON.parse(localStorage.getItem("choire.project.v1")),
    draft: JSON.parse(localStorage.getItem("choire.simpleDraft.v1")).settings,
  }));
  assert.deepEqual(state.score, expected, "The shipped composition must remain unchanged");
  assert.deepEqual(state.draft, defaultDraft, "Use the default lyrics, pace, feeling, and variation");
}

async function capture(page, filename, state) {
  // Move the pointer clear of controls without changing app state.
  await page.mouse.move(1, 1);
  const data = await page.screenshot({ path: `${directory}/${filename}`, fullPage: true });
  screenshots.push({ file: filename, state, viewport: page.viewportSize(), pixelWidth: data.readUInt32BE(16), pixelHeight: data.readUInt32BE(20), sha256: createHash("sha256").update(data).digest("hex") });
  console.log(`Captured ${filename}`);
}

try {
  const { context, page } = await openDefault(1440, 1120);
  await capture(page, "simple-studio.png", "Fresh Simple studio: default Flowing pace, Warm feeling, and demo lyrics");

  await page.getByRole("button", { name: "Advanced", exact: true }).click();
  await page.locator(".midi-note").first().click();
  assert.equal(await page.getByLabel("Selected note pitch").inputValue(), "69");
  assert.equal(await page.getByLabel("Selected note duration").inputValue(), "2");
  await assertDefault(page);
  await capture(page, "advanced-studio.png", "Default Advanced studio with the first note selected for inspection; nothing edited");

  await page.getByRole("button", { name: "Simple", exact: true }).click();
  await assertDefault(page);
  const renderRequest = page.waitForRequest(request => request.method() === "POST" && new URL(request.url()).pathname === "/api/render");
  await page.getByRole("button", { name: "Create & listen", exact: true }).click();
  const renderedScore = (await renderRequest).postDataJSON();
  assert.deepEqual(renderedScore.simple, defaultDraft);
  assert.equal(renderedScore.title, "A little light");
  assert.equal(renderedScore.bpm, 84);
  assert.equal(renderedScore.tracks.reduce((sum, track) => sum + track.singers, 0), 8);
  assert.ok(renderedScore.tracks.every(track => track.notes.map(note => note.lyric).join(" ") === defaultDraft.lyrics));
  await page.getByText("Rendered · 24-bit stereo WAV", { exact: true }).waitFor({ timeout: 240000 });
  await page.getByRole("button", { name: "Stop playback", exact: true }).click();
  assert.equal(await page.getByRole("link", { name: "Export WAV", exact: true }).getAttribute("aria-disabled"), "false");
  await capture(page, "render-and-export.png", "Real completed neural render using only the default Simple choices; playback stopped, WAV and stems available");
  await context.close();

  const mobile = await openDefault(390, 844);
  assert.ok(await mobile.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await capture(mobile.page, "mobile-studio.png", "Fresh mobile Simple studio with all default settings");
  await mobile.context.close();
  assert.deepEqual(errors, []);
  await writeFile(`${directory}/capture.json`, JSON.stringify({
    sourceCommit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
    capturedAt: new Date().toISOString(),
    browser: `Chrome ${browser.version()}`,
    deviceScaleFactor: 2,
    isolatedContexts: true,
    shippedScoreVerified: true,
    defaultSimpleSettings: defaultDraft,
    realAudioRender: true,
    screenshots,
    consoleErrors: errors,
  }, null, 2) + "\n");
} finally { await browser.close(); }
