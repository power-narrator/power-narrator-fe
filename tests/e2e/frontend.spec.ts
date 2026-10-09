import type { ElectronApplication, Locator, Page } from "@playwright/test";
import {
  DETERMINISTIC_MP3_BYTES,
  FIXTURE_TEST,
  MOCK_MAPPINGS,
  MOCK_SLIDES,
  expect,
  VIDEO_OUTPUT_PATH,
  declineVideoDestination,
  failHeldNarrationWork,
  getAlerts,
  getDiscardConfirmationCalls,
  getGeneratedSpeechCalls,
  getGeneratedVideoCalls,
  getHeldNarrationWork,
  getInsertAudioCalls,
  getPlaybackActivity,
  getSaveNotesCalls,
  getVideoDestinationRequests,
  holdNarrationWork,
  releaseHeldNarrationWork,
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

function saveAllButton(win: Page): Locator {
  return win.getByRole("button", { name: "Save All Slides", exact: true });
}

function saveAllProgress(win: Page): Locator {
  return win.getByRole("dialog", { name: "Saving all slides" });
}

async function startSaveAll(win: Page) {
  await saveAllButton(win).click();
  await win
    .getByRole("dialog", { name: "Save all slides?" })
    .getByRole("button", { name: "Save All", exact: true })
    .click();
}

function generateVideoButton(win: Page): Locator {
  return win.getByRole("button", { name: "Generate Video", exact: true });
}

function videoConfirmation(win: Page): Locator {
  return win.getByRole("dialog", { name: "Generate video?" });
}

async function startGenerateVideo(win: Page) {
  await generateVideoButton(win).click();
  await videoConfirmation(win).getByRole("button", { name: "Save and Generate" }).click();
}

type CloseAttemptGlobals = typeof globalThis & { __closeAttempts: number };

async function observeCloseAttempts(app: ElectronApplication) {
  await app.evaluate(({ BrowserWindow }) => {
    const globals = globalThis as CloseAttemptGlobals;
    globals.__closeAttempts = 0;
    BrowserWindow.getAllWindows()[0]!.once("close", () => {
      globals.__closeAttempts += 1;
    });
  });
  return () => app.evaluate(() => (globalThis as CloseAttemptGlobals).__closeAttempts);
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

  test("asks before Save All and starts no work when the author declines", async ({ app, win }) => {
    await notesEditor(win).fill("Kept after declining");
    await saveAllButton(win).click();

    const confirmation = win.getByRole("dialog", { name: "Save all slides?" });
    await expect(confirmation).toContainText("may take some time");
    await confirmation.getByRole("button", { name: "Cancel", exact: true }).click();

    await expect(confirmation).toBeHidden();
    await expect(notesEditor(win)).toHaveValue("Kept after declining");
    await expect(saveAllButton(win)).toBeEnabled();
    expect(await getGeneratedSpeechCalls(app)).toEqual([]);
    expect(await getSaveNotesCalls(app)).toEqual([]);
  });

  test("saves one complete slide at a time while showing the run's progress", async ({
    app,
    win,
  }) => {
    await holdNarrationWork(app, ["speech", "saveNotes"]);
    await startSaveAll(win);

    const progress = saveAllProgress(win);
    await expect(progress).toContainText("Slide 1 of 2");
    await expect(progress).toContainText("Generating narration...");
    const progressBar = progress.getByRole("progressbar");
    await expect(progressBar).toHaveAttribute("aria-valuenow", "0");
    await expect
      .poll(() => getHeldNarrationWork(app))
      .toEqual([{ kind: "speech", label: MOCK_SLIDES[0]!.notes }]);

    await releaseHeldNarrationWork(app);
    await expect(progress).toContainText("Saving to PowerPoint...");
    await expect.poll(() => getHeldNarrationWork(app)).toEqual([{ kind: "saveNotes", label: "0" }]);
    expect(await getGeneratedSpeechCalls(app)).toHaveLength(1);

    await releaseHeldNarrationWork(app);
    await expect(progress).toContainText("Slide 2 of 2");
    await expect(progressBar).toHaveAttribute("aria-valuenow", "50");
    await expect
      .poll(() => getHeldNarrationWork(app))
      .toEqual([{ kind: "speech", label: MOCK_SLIDES[1]!.notes }]);
    expect(await getInsertAudioCalls(app)).toEqual([
      {
        filePath: FIXTURE_TEST,
        slidesAudio: [
          {
            slideIndex: 0,
            sectionIndex: 0,
            audioData: new Uint8Array(DETERMINISTIC_MP3_BYTES),
            playAcrossSlides: false,
          },
        ],
      },
    ]);
    await expect(progress).not.toContainText(/saved/i);

    await releaseHeldNarrationWork(app);
    await expect.poll(() => getHeldNarrationWork(app)).toEqual([{ kind: "saveNotes", label: "1" }]);
    await releaseHeldNarrationWork(app);

    await expect(progress).toBeHidden();
    expect(await getSaveNotesCalls(app)).toEqual(
      MOCK_SLIDES.map((slide) => ({
        filePath: FIXTURE_TEST,
        slides: [{ slideIndex: slide.slideIndex, notes: slide.notes }],
      })),
    );
    expect(await getInsertAudioCalls(app)).toHaveLength(2);
  });

  test("locks the viewer until the save-all run settles", async ({ app, win }) => {
    await notesEditor(win).fill("Submitted narration");
    const secondThumbnail = await win
      .getByRole("button", { name: "Slide 2", exact: true })
      .boundingBox();
    await holdNarrationWork(app, ["speech"]);
    await startSaveAll(win);
    const progress = saveAllProgress(win);
    await expect.poll(() => getHeldNarrationWork(app)).toHaveLength(1);

    await win.keyboard.press("Escape");
    await win.mouse.click(
      secondThumbnail!.x + secondThumbnail!.width / 2,
      secondThumbnail!.y + secondThumbnail!.height / 2,
    );
    await win.keyboard.press("ControlOrMeta+z");
    await win.keyboard.type("typed while saving");
    await expect(progress).toBeVisible();

    await holdNarrationWork(app, []);
    await releaseHeldNarrationWork(app);
    await expect(progress).toBeHidden();

    await expect(notesEditor(win)).toHaveValue("Submitted narration");
    await notesEditor(win).fill("Editable again");
    await expect(notesEditor(win)).toHaveValue("Editable again");
  });

  test("cancels safely while a slide generates and lets a later run finish", async ({
    app,
    win,
  }) => {
    await notesEditor(win).fill("Kept after cancelling");
    await holdNarrationWork(app, ["speech"]);
    await startSaveAll(win);
    const progress = saveAllProgress(win);
    await expect.poll(() => getHeldNarrationWork(app)).toHaveLength(1);

    const cancel = progress.getByRole("button", { name: "Cancel", exact: true });
    await cancel.click();
    await expect(progress).toContainText("Cancelling...");
    await expect(cancel).toBeDisabled();
    await win.keyboard.press("Escape");
    const closeAttempts = await observeCloseAttempts(app);
    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.close();
    });
    await expect.poll(closeAttempts).toBe(1);
    await expect(progress).toBeVisible();

    await releaseHeldNarrationWork(app);
    await expect(progress).toBeHidden();
    expect(await getSaveNotesCalls(app)).toEqual([]);
    expect(await getGeneratedSpeechCalls(app)).toHaveLength(1);
    expect(await getAlerts(win)).toEqual([]);
    await expect(notesEditor(win)).toHaveValue("Kept after cancelling");

    await holdNarrationWork(app, []);
    await startSaveAll(win);
    await expect(progress).toBeHidden();
    expect(await getSaveNotesCalls(app)).toEqual([
      { filePath: FIXTURE_TEST, slides: [{ slideIndex: 0, notes: "Kept after cancelling" }] },
      { filePath: FIXTURE_TEST, slides: [{ slideIndex: 1, notes: MOCK_SLIDES[1]!.notes }] },
    ]);
  });

  test("stops at a slide that fails to generate and alerts which section failed", async ({
    app,
    win,
  }) => {
    await holdNarrationWork(app, ["speech"]);
    await startSaveAll(win);
    await expect.poll(() => getHeldNarrationWork(app)).toHaveLength(1);
    await releaseHeldNarrationWork(app);
    await expect
      .poll(() => getHeldNarrationWork(app))
      .toEqual([{ kind: "speech", label: MOCK_SLIDES[1]!.notes }]);

    await failHeldNarrationWork(
      app,
      { kind: "speech", label: MOCK_SLIDES[1]!.notes },
      "quota exhausted",
    );

    await expect(saveAllProgress(win)).toBeHidden();
    expect(await getAlerts(win)).toEqual([
      'Save error: Narration synthesis failed for slide 2, section 1, speaker "Default": quota exhausted. Earlier slides remain saved.',
    ]);
    expect(await getSaveNotesCalls(app)).toEqual([
      { filePath: FIXTURE_TEST, slides: [{ slideIndex: 0, notes: MOCK_SLIDES[0]!.notes }] },
    ]);
    await expect(saveAllButton(win)).toBeEnabled();
  });

  test("asks before preparing a video and renders nothing when the author declines", async ({
    app,
    win,
  }) => {
    await notesEditor(win).fill("Kept after declining video");
    await generateVideoButton(win).click();

    const confirmation = videoConfirmation(win);
    await expect(confirmation).toContainText("may take some time");
    await confirmation.getByRole("button", { name: "Cancel", exact: true }).click();

    await expect(confirmation).toBeHidden();
    await expect(notesEditor(win)).toHaveValue("Kept after declining video");
    await expect(generateVideoButton(win)).toBeEnabled();
    expect(await getGeneratedSpeechCalls(app)).toEqual([]);
    expect(await getSaveNotesCalls(app)).toEqual([]);
    expect(await getVideoDestinationRequests(app)).toBe(0);
    expect(await getGeneratedVideoCalls(app)).toEqual([]);
  });

  test("renders the video only after every slide saves through the save-all run", async ({
    app,
    win,
  }) => {
    await holdNarrationWork(app, ["saveNotes"]);
    await startGenerateVideo(win);
    const progress = saveAllProgress(win);
    await expect.poll(() => getHeldNarrationWork(app)).toEqual([{ kind: "saveNotes", label: "0" }]);
    await expect(progress).toContainText("Slide 1 of 2");
    await expect(progress).toContainText("Saving to PowerPoint...");
    await releaseHeldNarrationWork(app);
    await expect.poll(() => getHeldNarrationWork(app)).toEqual([{ kind: "saveNotes", label: "1" }]);
    await expect(progress).toContainText("Slide 2 of 2");
    expect(await getVideoDestinationRequests(app)).toBe(0);

    await releaseHeldNarrationWork(app);

    await expect(progress).toBeHidden();
    await expect
      .poll(() => getGeneratedVideoCalls(app))
      .toEqual([{ filePath: FIXTURE_TEST, videoOutputPath: VIDEO_OUTPUT_PATH }]);
    expect(await getSaveNotesCalls(app)).toHaveLength(2);
    await expect
      .poll(() => getAlerts(win))
      .toEqual([`Video generated successfully at: ${VIDEO_OUTPUT_PATH}`]);
  });

  test("keeps the saved slides and renders nothing when no video destination is chosen", async ({
    app,
    win,
  }) => {
    await declineVideoDestination(app);
    await notesEditor(win).fill("Saved before declining a destination");
    await startGenerateVideo(win);

    await expect.poll(() => getVideoDestinationRequests(app)).toBe(1);
    await expect(generateVideoButton(win)).toBeEnabled();
    expect(await getGeneratedVideoCalls(app)).toEqual([]);
    expect(await getSaveNotesCalls(app)).toEqual([
      {
        filePath: FIXTURE_TEST,
        slides: [{ slideIndex: 0, notes: "Saved before declining a destination" }],
      },
      { filePath: FIXTURE_TEST, slides: [{ slideIndex: 1, notes: MOCK_SLIDES[1]!.notes }] },
    ]);
    expect(await getAlerts(win)).toEqual([]);
  });

  test("renders nothing when video preparation is cancelled while a slide generates", async ({
    app,
    win,
  }) => {
    await notesEditor(win).fill("Kept after cancelling video");
    await holdNarrationWork(app, ["speech"]);
    await startGenerateVideo(win);
    const progress = saveAllProgress(win);
    await expect.poll(() => getHeldNarrationWork(app)).toHaveLength(1);

    await progress.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(progress).toContainText("Cancelling...");
    await releaseHeldNarrationWork(app);

    await expect(progress).toBeHidden();
    await expect(generateVideoButton(win)).toBeEnabled();
    expect(await getSaveNotesCalls(app)).toEqual([]);
    expect(await getVideoDestinationRequests(app)).toBe(0);
    expect(await getGeneratedVideoCalls(app)).toEqual([]);
    expect(await getAlerts(win)).toEqual([]);
    await expect(notesEditor(win)).toHaveValue("Kept after cancelling video");
  });

  test("finishes the saving slide but renders nothing when cancelled while saving", async ({
    app,
    win,
  }) => {
    await holdNarrationWork(app, ["insertAudio"]);
    await startGenerateVideo(win);
    const progress = saveAllProgress(win);
    await expect
      .poll(() => getHeldNarrationWork(app))
      .toEqual([{ kind: "insertAudio", label: "0" }]);

    await progress.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(progress).toContainText("Cancelling...");
    await releaseHeldNarrationWork(app);

    await expect(progress).toBeHidden();
    await expect(generateVideoButton(win)).toBeEnabled();
    expect(await getSaveNotesCalls(app)).toEqual([
      { filePath: FIXTURE_TEST, slides: [{ slideIndex: 0, notes: MOCK_SLIDES[0]!.notes }] },
    ]);
    expect(await getInsertAudioCalls(app)).toHaveLength(1);
    expect(await getGeneratedVideoCalls(app)).toEqual([]);
  });

  test("renders nothing when a slide fails to generate during video preparation", async ({
    app,
    win,
  }) => {
    await holdNarrationWork(app, ["speech"]);
    await startGenerateVideo(win);
    await expect.poll(() => getHeldNarrationWork(app)).toHaveLength(1);

    await failHeldNarrationWork(
      app,
      { kind: "speech", label: MOCK_SLIDES[0]!.notes },
      "quota exhausted",
    );

    await expect(saveAllProgress(win)).toBeHidden();
    await expect(generateVideoButton(win)).toBeEnabled();
    expect(await getAlerts(win)).toEqual([
      'Save error: Narration synthesis failed for slide 1, section 1, speaker "Default": quota exhausted.',
    ]);
    expect(await getSaveNotesCalls(app)).toEqual([]);
    expect(await getGeneratedVideoCalls(app)).toEqual([]);
  });

  test("renders nothing when a slide's audio fails to save during video preparation", async ({
    app,
    win,
  }) => {
    await notesEditor(win).fill("Saved without its audio");
    await holdNarrationWork(app, ["insertAudio"]);
    await startGenerateVideo(win);
    await expect
      .poll(() => getHeldNarrationWork(app))
      .toEqual([{ kind: "insertAudio", label: "0" }]);

    await failHeldNarrationWork(app, { kind: "insertAudio", label: "0" }, "media rejected");

    await expect(saveAllProgress(win)).toBeHidden();
    await expect(generateVideoButton(win)).toBeEnabled();
    expect(await getAlerts(win)).toEqual([
      expect.stringMatching(
        /^Save error on slide 1: its notes were saved, but its narration audio was not fully saved.*media rejected.* Later slides were not changed\.$/,
      ),
    ]);
    expect(await getSaveNotesCalls(app)).toHaveLength(1);
    expect(await getGeneratedVideoCalls(app)).toEqual([]);
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
    test(`keeps the ${closeCase.name} open while a save-all run is active`, async ({
      app,
      win,
    }) => {
      await holdNarrationWork(app, ["speech"]);
      await startSaveAll(win);
      await expect.poll(() => getHeldNarrationWork(app)).toHaveLength(1);

      const closeAttempts = await observeCloseAttempts(app);
      await closeCase.attempt(app);
      await expect.poll(closeAttempts).toBe(1);
      await holdNarrationWork(app, []);
      await releaseHeldNarrationWork(app);
      await expect(saveAllProgress(win)).toBeHidden();

      expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(
        1,
      );
      expect(await getDiscardConfirmationCalls(app)).toEqual([]);

      await notesEditor(win).fill("Dirty after the run");
      await closeCase.attempt(app);
      await expect
        .poll(() => getDiscardConfirmationCalls(app))
        .toEqual([expect.objectContaining({ message: "Discard unsaved narration changes?" })]);
    });

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
