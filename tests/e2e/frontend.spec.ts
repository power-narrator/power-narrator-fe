import type { ElectronApplication, Locator, Page } from "@playwright/test";
import {
  DETERMINISTIC_MP3_BYTES,
  FIXTURE_TEST,
  MOCK_MAPPINGS,
  MOCK_SLIDES,
  expect,
  getDiscardConfirmationCalls,
  getGeneratedSpeechCalls,
  getInsertAudioCalls,
  getPlaybackActivity,
  getSaveNotesCalls,
  resetProbes,
  test,
} from "./fixtures/app.js";

async function loadViewer(win: Page) {
  await win.getByRole("button", { name: "Select PowerPoint File" }).click();
  await expect(win.getByText("Add Section")).toBeVisible();
}

function notesEditor(win: Page): Locator {
  return win.getByRole("textbox", { name: "Slide 1 section 1 notes" });
}

function narratorPreview(win: Page): Locator {
  return win.getByRole("button", { name: "Narrator", exact: true });
}

test.describe("PPT Viewer UI Workflows", () => {
  test.beforeEach(async ({ app, win }) => {
    await win.reload();
    await resetProbes(app, win);
    await loadViewer(win);
  });

  test("previews narration through Electron with deterministic MP3 audio", async ({ app, win }) => {
    await narratorPreview(win).click();

    await expect
      .poll(() => getGeneratedSpeechCalls(app))
      .toContainEqual({
        text: MOCK_SLIDES[0]!.notes,
        voiceOption: MOCK_MAPPINGS.Narrator!.voice,
      });
    await expect
      .poll(() => getPlaybackActivity(win))
      .toMatchObject({
        playUrls: [expect.stringMatching(/^blob:/)],
      });
  });

  test("saves the full presentation through Electron narration preparation", async ({
    app,
    win,
  }) => {
    const saveAll = win.getByRole("button", { name: "Save All Slides", exact: true });

    await saveAll.click();

    await expect(saveAll).toBeEnabled();
    await expect
      .poll(() => getSaveNotesCalls(app))
      .toEqual([
        {
          filePath: FIXTURE_TEST,
          slides: MOCK_SLIDES.map((slide) => ({
            slideIndex: slide.slideIndex,
            notes: slide.notes,
          })),
        },
      ]);
    await expect
      .poll(() => getInsertAudioCalls(app))
      .toEqual([
        {
          filePath: FIXTURE_TEST,
          slidesAudio: MOCK_SLIDES.map((slide) => ({
            slideIndex: slide.slideIndex,
            sectionIndex: 0,
            audioData: new Uint8Array(DETERMINISTIC_MP3_BYTES),
            playAcrossSlides: false,
          })),
        },
      ]);
  });

  for (const closeCase of [
    {
      name: "window",
      attempt: (app: ElectronApplication) =>
        app.evaluate(({ BrowserWindow }) => {
          BrowserWindow.getAllWindows()[0]?.close();
        }),
    },
    {
      name: "application",
      attempt: (app: ElectronApplication) =>
        app.evaluate(({ app: electronApp }) => {
          electronApp.quit();
        }),
    },
  ]) {
    test(`warns when the ${closeCase.name} closes while narration edits are dirty`, async ({
      app,
      win,
    }) => {
      await notesEditor(win).fill("Unsaved close warning");

      await closeCase.attempt(app);

      await expect
        .poll(() => getDiscardConfirmationCalls(app))
        .toEqual([
          expect.objectContaining({
            buttons: ["Keep Editing", "Discard Changes"],
            message: "Discard unsaved narration changes?",
          }),
        ]);
      await expect(notesEditor(win)).toHaveValue("Unsaved close warning");
    });
  }
});
