import { test, expect, type ElectronApplication, type Page, type Locator } from "@playwright/test";
import fs from "node:fs";
import {
  DELAYED_PREVIEW_TEXT,
  DETERMINISTIC_MP3_BYTES,
  FIXTURE_ORIGINAL,
  FIXTURE_TEST,
  MOCK_MAPPINGS,
  MOCK_SLIDES,
  getCompletedPreviewSyntheses,
  getConvertPptxCalls,
  getDiscardConfirmationCalls,
  getGeneratedSpeechCalls,
  getInsertAudioCalls,
  getPlaybackActivity,
  getSaveNotesCalls,
  installMockIpcHandlers,
  installRendererProbes,
  launchTestApp,
  releaseDelayedPreview,
  resetProbes,
  setShouldDiscardNarrationChanges,
} from "./fixtures/app.js";

let electronApp: ElectronApplication;
let window: Page;

async function loadViewer() {
  await window.waitForLoadState("networkidle");
  await window.getByRole("button", { name: "Select PowerPoint File" }).click();
  await expect(window.getByText("Add Section")).toBeVisible({ timeout: 15000 });
}

function notesEditor(): Locator {
  return window.getByRole("textbox", { name: "Slide 1 section 1 notes" });
}

const discardConfirmations = () => getDiscardConfirmationCalls(electronApp);

test.beforeAll(async () => {
  fs.copyFileSync(FIXTURE_ORIGINAL, FIXTURE_TEST);

  electronApp = await launchTestApp();
  await installMockIpcHandlers(electronApp);

  const appWindow = await electronApp.firstWindow();

  if (!appWindow) {
    throw new Error("Could not find application window");
  }

  window = appWindow;
  await installRendererProbes(window);
});

test.afterAll(async () => {
  await electronApp?.close();

  if (fs.existsSync(FIXTURE_TEST)) {
    fs.unlinkSync(FIXTURE_TEST);
  }
});

test.describe("PPT Viewer UI Workflows", () => {
  test.beforeEach(async () => {
    await window.reload();
    await resetProbes(electronApp, window);
    await loadViewer();
  });

  test.afterEach(async () => {
    const backButton = window.getByRole("button", { name: "Back", exact: false });
    if (!(await backButton.isVisible())) {
      return;
    }

    await setShouldDiscardNarrationChanges(electronApp, true);
    await backButton.click();
    await setShouldDiscardNarrationChanges(electronApp, false);
  });

  test("loads mocked slides into the viewer", async () => {
    await expect.poll(() => getConvertPptxCalls(electronApp)).toEqual([{ filePath: FIXTURE_TEST }]);

    const thumbnails = window.getByRole("img", { name: /Slide \d+ thumbnail/ });
    await expect(thumbnails).toHaveCount(MOCK_SLIDES.length, { timeout: 10000 });
    await expect(window.getByRole("img", { name: "Slide 1 preview" })).toBeVisible();

    await expect(notesEditor()).toHaveValue(MOCK_SLIDES[0]!.notes);
  });

  test("previews narration through Electron with deterministic MP3 audio", async () => {
    await window.getByRole("button", { name: "Narrator", exact: true }).click();

    await expect
      .poll(() => getGeneratedSpeechCalls(electronApp))
      .toContainEqual({
        text: MOCK_SLIDES[0]!.notes,
        voiceOption: MOCK_MAPPINGS.Narrator!.voice,
      });
    await expect
      .poll(() => getPlaybackActivity(window))
      .toMatchObject({
        playUrls: [expect.stringMatching(/^blob:/)],
      });
  });

  test("stopping a pending preview prevents late playback without cancelling synthesis", async () => {
    await notesEditor().fill(DELAYED_PREVIEW_TEXT);
    const narratorPreview = window.getByRole("button", { name: "Narrator", exact: true });

    await narratorPreview.click();
    await expect
      .poll(() => getGeneratedSpeechCalls(electronApp))
      .toContainEqual({
        text: DELAYED_PREVIEW_TEXT,
        voiceOption: MOCK_MAPPINGS.Narrator!.voice,
      });
    await narratorPreview.click();
    await releaseDelayedPreview(electronApp);

    await expect.poll(() => getPlaybackActivity(window)).toMatchObject({ playUrls: [] });
    await expect.poll(() => getCompletedPreviewSyntheses(electronApp)).toBe(1);
  });

  test("saves the full presentation through Electron narration preparation", async () => {
    await window.getByRole("button", { name: "Save All Slides", exact: true }).click();

    await expect(
      window.getByRole("button", { name: "Save All Slides", exact: true }),
    ).toBeEnabled();
    await expect
      .poll(() => getSaveNotesCalls(electronApp))
      .toEqual([
        {
          filePath: FIXTURE_TEST,
          slides: MOCK_SLIDES.map((slide) => ({ index: slide.index, notes: slide.notes })),
        },
      ]);
    await expect
      .poll(() => getInsertAudioCalls(electronApp))
      .toEqual([
        {
          filePath: FIXTURE_TEST,
          slidesAudio: MOCK_SLIDES.map((slide) => ({
            index: slide.index,
            sectionIndex: 0,
            audioData: new Uint8Array(DETERMINISTIC_MP3_BYTES),
          })),
        },
      ]);
  });

  for (const closeCase of [
    {
      name: "window",
      attempt: () =>
        electronApp.evaluate(({ BrowserWindow }) => {
          BrowserWindow.getAllWindows()[0]?.close();
        }),
    },
    {
      name: "application",
      attempt: () =>
        electronApp.evaluate(({ app }) => {
          app.quit();
        }),
    },
  ]) {
    test(`warns when the ${closeCase.name} closes while narration edits are dirty`, async () => {
      await notesEditor().fill("Unsaved close warning");

      await closeCase.attempt();
      await expect.poll(discardConfirmations).toHaveLength(1);
      await expect(notesEditor()).toHaveValue("Unsaved close warning");

      await expect.poll(discardConfirmations).toEqual([
        expect.objectContaining({
          buttons: ["Keep Editing", "Discard Changes"],
          message: "Discard unsaved narration changes?",
        }),
      ]);
    });
  }
});
