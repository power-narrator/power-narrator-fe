import { test, expect, type ElectronApplication, type Page, type Locator } from "@playwright/test";
import { _electron as electron } from "playwright";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import type { SlideWithSrc as Slide } from "../../electron/platform/types.js";
import type { Voice } from "../../shared/types/tts.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const FIXTURE_ORIGINAL = path.join(__dirname, "../fixtures/test-presentation.pptx");
const FIXTURE_TEST = path.join(__dirname, "../fixtures/test-presentation-run.pptx");

const TRANSPARENT_SLIDE_IMAGE =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

const MOCK_SLIDES: Slide[] = [
  {
    index: 1,
    image: "slide-1.png",
    src: TRANSPARENT_SLIDE_IMAGE,
    notes: "Initial notes for slide 1",
  },
  {
    index: 2,
    image: "slide-2.png",
    src: TRANSPARENT_SLIDE_IMAGE,
    notes: "Initial notes for slide 2\nLine 2",
  },
];

const MOCK_VOICES: Record<string, Voice> = {
  _default_: {
    name: "default-test-voice",
    languageCodes: ["en-US"],
    ssmlGender: "NEUTRAL",
    provider: "gcp",
  },
  Narrator: {
    name: "narrator-test-voice",
    languageCodes: ["en-US"],
    ssmlGender: "FEMALE",
    provider: "gcp",
  },
};

const TINY_FAKE_AUDIO_BYTES = [1, 2, 3, 4];

type GeneratedSpeechCall = {
  text: string;
  voiceOption: Voice;
};

type ConvertPptxCall = {
  filePath: string;
};

type SaveNotesCall = {
  filePath: string;
  slides: Array<{ index: number; notes: string }>;
};

type InsertAudioCall = {
  filePath: string;
  slidesAudio: Array<{ index: number; sectionIndex: number; audioData: Uint8Array }>;
};

type NarrationProgress = { completed: number; total: number };

type RendererNarrationApi = {
  saveNarratedPresentation: (
    payload: { filePath: string; slides: Array<{ slideIndex: number; notes: string }> },
    onProgress: (progress: NarrationProgress) => void,
  ) => Promise<unknown>;
  getVideoSavePath: () => Promise<string | null>;
};

type DiscardConfirmationTestGlobals = typeof globalThis & {
  __discardConfirmationCalls: unknown[];
  __shouldDiscardNarrationChanges: boolean;
};

let electronApp: ElectronApplication;
let window: Page;

async function launchTestApp() {
  return electron.launch({
    args: [path.join(__dirname, "../../dist-electron/electron/main.js")],
    env: {
      ...process.env,
      NODE_ENV: "test",
    },
  });
}

async function installMockIpcHandlers(app: ElectronApplication) {
  await app.evaluate(
    async ({ ipcMain }, { testFilePath, mockSlides, mockVoices, tinyFakeAudioBytes }) => {
      const discardConfirmationGlobals = globalThis as DiscardConfirmationTestGlobals;
      discardConfirmationGlobals.__discardConfirmationCalls = [];
      discardConfirmationGlobals.__shouldDiscardNarrationChanges = false;
      globalThis.powerNarratorTestHarness!.useDiscardConfirmation(async (options) => {
        const globals = globalThis as DiscardConfirmationTestGlobals;
        globals.__discardConfirmationCalls.push(options);
        return globals.__shouldDiscardNarrationChanges;
      });

      ipcMain.removeHandler("select-file");
      ipcMain.handle("select-file", async () => testFilePath);

      ipcMain.removeHandler("convert-pptx");
      (globalThis as typeof globalThis & { __convertPptxCalls?: unknown[] }).__convertPptxCalls =
        [];
      ipcMain.handle("convert-pptx", async (_, filePath) => {
        (
          globalThis as typeof globalThis & {
            __convertPptxCalls: unknown[];
          }
        ).__convertPptxCalls.push({ filePath });

        return {
          success: true,
          slides: mockSlides,
        };
      });

      ipcMain.removeHandler("reload-slide");
      (globalThis as typeof globalThis & { __reloadSlideCalls?: unknown[] }).__reloadSlideCalls =
        [];
      ipcMain.handle("reload-slide", async (_, { filePath, slideIndex }) => {
        (
          globalThis as typeof globalThis & {
            __reloadSlideCalls: unknown[];
          }
        ).__reloadSlideCalls.push({ filePath, slideIndex });

        return {
          success: true,
          slide: mockSlides[slideIndex - 1],
        };
      });

      ipcMain.removeHandler("get-video-save-path");
      ipcMain.handle("get-video-save-path", async () => "/tmp/output.mp4");

      ipcMain.removeHandler("save-notes");
      (globalThis as typeof globalThis & { __saveNotesCalls?: unknown[] }).__saveNotesCalls = [];
      ipcMain.handle("save-notes", async (_, filePath, slides) => {
        (
          globalThis as typeof globalThis & {
            __saveNotesCalls: unknown[];
          }
        ).__saveNotesCalls.push({ filePath, slides });

        return { success: true };
      });

      ipcMain.removeHandler("get-speaker-mappings");
      ipcMain.handle("get-speaker-mappings", async () => mockVoices);

      ipcMain.removeHandler("set-speaker-mappings");
      ipcMain.handle("set-speaker-mappings", async () => ({ success: true }));

      (
        globalThis as typeof globalThis & { __generatedSpeechCalls?: unknown[] }
      ).__generatedSpeechCalls = [];

      (
        globalThis as typeof globalThis & {
          __previewMappings?: Record<string, Voice>;
          __completedPreviewSyntheses?: number;
        }
      ).__previewMappings = mockVoices;
      (
        globalThis as typeof globalThis & {
          __completedPreviewSyntheses: number;
        }
      ).__completedPreviewSyntheses = 0;
      const mappingSource = {
        getSpeakerMappings: () =>
          (
            globalThis as typeof globalThis & {
              __previewMappings: Record<string, Voice>;
            }
          ).__previewMappings,
      };
      const deterministicFakeTtsAdapter = {
        supportsProvider: () => true,
        generateSpeech: async (text: string, voiceOption: Voice) => {
          const synthesisGlobals = globalThis as typeof globalThis & {
            __failNextNarrationSynthesis?: boolean;
          };
          if (synthesisGlobals.__failNextNarrationSynthesis) {
            synthesisGlobals.__failNextNarrationSynthesis = false;
            throw new Error("narration synthesis failed");
          }

          (
            globalThis as typeof globalThis & {
              __generatedSpeechCalls: unknown[];
            }
          ).__generatedSpeechCalls.push({ text, voiceOption });

          if (text === "Delayed preview") {
            return new Promise<{ audio: Uint8Array; mediaType: string }>((resolve) => {
              (
                globalThis as typeof globalThis & {
                  __resolveDelayedPreview?: () => void;
                }
              ).__resolveDelayedPreview = () => {
                (
                  globalThis as typeof globalThis & {
                    __completedPreviewSyntheses: number;
                  }
                ).__completedPreviewSyntheses += 1;
                resolve({ audio: new Uint8Array(tinyFakeAudioBytes), mediaType: "audio/mpeg" });
              };
            });
          }

          return { audio: new Uint8Array(tinyFakeAudioBytes), mediaType: "audio/mpeg" };
        },
      };
      (globalThis as typeof globalThis & { __insertAudioCalls?: unknown[] }).__insertAudioCalls =
        [];
      const deterministicFakePowerPointAdapter = {
        saveNotes: async (filePath: string, slides: unknown[]) => {
          (
            globalThis as typeof globalThis & {
              __saveNotesCalls: unknown[];
            }
          ).__saveNotesCalls.push({ filePath, slides });
          return { success: true as const };
        },
        insertAudio: async (filePath: string, slidesAudio: unknown[]) => {
          const globals = globalThis as typeof globalThis & {
            __insertAudioCalls: unknown[];
            __failNextAudioInsertion?: boolean;
          };
          globals.__insertAudioCalls.push({ filePath, slidesAudio });
          if (globals.__failNextAudioInsertion) {
            globals.__failNextAudioInsertion = false;
            return { success: false as const, message: "audio automation failed" };
          }
          return { success: true as const };
        },
        removeAudio: async () => ({ success: true as const }),
      };

      globalThis.powerNarratorTestHarness!.useNarrationAdapters({
        mappingSource,
        synthesizer: deterministicFakeTtsAdapter,
        getPowerPoint: () => deterministicFakePowerPointAdapter,
      });
    },
    {
      testFilePath: FIXTURE_TEST,
      mockSlides: MOCK_SLIDES,
      mockVoices: MOCK_VOICES,
      tinyFakeAudioBytes: TINY_FAKE_AUDIO_BYTES,
    },
  );
}

async function loadViewer() {
  await window.waitForLoadState("networkidle");
  await window.getByRole("button", { name: "Select PowerPoint File" }).click();
  await expect(window.getByText("Add Section")).toBeVisible({ timeout: 15000 });
}

function notesEditor(): Locator {
  return window.getByRole("textbox", { name: "Slide 1 section 1 notes" });
}

async function getConvertPptxCalls(): Promise<ConvertPptxCall[]> {
  return electronApp.evaluate(() => {
    return (
      globalThis as typeof globalThis & {
        __convertPptxCalls: ConvertPptxCall[];
      }
    ).__convertPptxCalls;
  });
}

async function getDiscardConfirmationCalls(): Promise<unknown[]> {
  return electronApp.evaluate(() => {
    return (globalThis as DiscardConfirmationTestGlobals).__discardConfirmationCalls;
  });
}

async function setShouldDiscardNarrationChanges(shouldDiscard: boolean) {
  await electronApp.evaluate((_, nextValue) => {
    (globalThis as DiscardConfirmationTestGlobals).__shouldDiscardNarrationChanges = nextValue;
  }, shouldDiscard);
}

async function attemptCloseAndKeepEditing(
  attemptClose: () => Promise<unknown>,
  expectedConfirmations: number,
) {
  await attemptClose();
  await expect.poll(getDiscardConfirmationCalls).toHaveLength(expectedConfirmations);
  await expect(notesEditor()).toHaveValue("Unsaved close warning");
}

async function getSaveNotesCalls(): Promise<SaveNotesCall[]> {
  return electronApp.evaluate(() => {
    return (
      globalThis as typeof globalThis & {
        __saveNotesCalls: SaveNotesCall[];
      }
    ).__saveNotesCalls;
  });
}

async function getGeneratedSpeechCalls(): Promise<GeneratedSpeechCall[]> {
  return electronApp.evaluate(() => {
    return (
      globalThis as typeof globalThis & {
        __generatedSpeechCalls: GeneratedSpeechCall[];
      }
    ).__generatedSpeechCalls;
  });
}

async function getInsertAudioCalls(): Promise<InsertAudioCall[]> {
  return electronApp.evaluate(() => {
    return (
      globalThis as typeof globalThis & {
        __insertAudioCalls: InsertAudioCall[];
      }
    ).__insertAudioCalls;
  });
}

async function resetCapturedIpcCalls() {
  await electronApp.evaluate((_, mockVoices) => {
    const globals = globalThis as typeof globalThis & {
      __convertPptxCalls: unknown[];
      __discardConfirmationCalls: unknown[];
      __reloadSlideCalls: unknown[];
      __saveNotesCalls: unknown[];
      __generatedSpeechCalls: unknown[];
      __insertAudioCalls: unknown[];
      __completedPreviewSyntheses: number;
      __previewMappings: Record<string, Voice>;
      __failNextNarrationSynthesis?: boolean;
    };

    globals.__convertPptxCalls = [];
    globals.__discardConfirmationCalls = [];
    globals.__reloadSlideCalls = [];
    globals.__saveNotesCalls = [];
    globals.__generatedSpeechCalls = [];
    globals.__insertAudioCalls = [];
    globals.__completedPreviewSyntheses = 0;
    globals.__previewMappings = mockVoices;
    globals.__failNextNarrationSynthesis = false;
  }, MOCK_VOICES);
}

async function resetGeneratedSpeechCalls() {
  await electronApp.evaluate(() => {
    (
      globalThis as typeof globalThis & {
        __generatedSpeechCalls: unknown[];
      }
    ).__generatedSpeechCalls = [];
  });
}

async function releaseDelayedPreview() {
  await electronApp.evaluate(() => {
    const globals = globalThis as typeof globalThis & {
      __resolveDelayedPreview?: () => void;
    };
    globals.__resolveDelayedPreview?.();
    globals.__resolveDelayedPreview = undefined;
  });
}

async function getPlaybackActivity() {
  return window.evaluate(() => {
    const globals = globalThis as typeof globalThis & {
      __audioPlayUrls: string[];
      __createdBlobUrls: string[];
      __revokedBlobUrls: string[];
    };

    return {
      playUrls: globals.__audioPlayUrls,
      createdUrls: globals.__createdBlobUrls,
      revokedUrls: globals.__revokedBlobUrls,
    };
  });
}

async function getCompletedPreviewSyntheses() {
  return electronApp.evaluate(
    () =>
      (
        globalThis as typeof globalThis & {
          __completedPreviewSyntheses: number;
        }
      ).__completedPreviewSyntheses,
  );
}

test.beforeAll(async () => {
  fs.copyFileSync(FIXTURE_ORIGINAL, FIXTURE_TEST);

  electronApp = await launchTestApp();
  await installMockIpcHandlers(electronApp);

  const appWindow = await electronApp.firstWindow();

  if (!appWindow) {
    throw new Error("Could not find application window");
  }

  window = appWindow;
  await window.addInitScript(() => {
    const globals = globalThis as typeof globalThis & {
      __audioPlayUrls: string[];
      __createdBlobUrls: string[];
      __revokedBlobUrls: string[];
    };
    globals.__audioPlayUrls = [];
    globals.__createdBlobUrls = [];
    globals.__revokedBlobUrls = [];

    const originalCreateObjectUrl = URL.createObjectURL.bind(URL);
    const originalRevokeObjectUrl = URL.revokeObjectURL.bind(URL);
    URL.createObjectURL = (object) => {
      const url = originalCreateObjectUrl(object);
      globals.__createdBlobUrls.push(url);
      return url;
    };
    URL.revokeObjectURL = (url) => {
      globals.__revokedBlobUrls.push(url);
      originalRevokeObjectUrl(url);
    };
    const mediaPrototype = (
      globalThis as typeof globalThis & {
        HTMLMediaElement: {
          prototype: {
            play: () => Promise<void>;
            pause: () => void;
          };
        };
      }
    ).HTMLMediaElement.prototype;
    mediaPrototype.play = function (this: { src: string }) {
      globals.__audioPlayUrls.push(this.src);
      return Promise.resolve();
    };
    mediaPrototype.pause = () => {};
  });
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
    await resetCapturedIpcCalls();
    await loadViewer();
  });

  test.afterEach(async () => {
    const backButton = window.getByRole("button", { name: "Back", exact: false });
    if (!(await backButton.isVisible())) {
      return;
    }

    await setShouldDiscardNarrationChanges(true);
    await backButton.click();
    await setShouldDiscardNarrationChanges(false);
  });

  test("loads mocked slides into the viewer", async () => {
    await expect.poll(getConvertPptxCalls).toEqual([{ filePath: FIXTURE_TEST }]);

    const thumbnails = window.getByRole("img", { name: /Slide \d+ thumbnail/ });
    await expect(thumbnails).toHaveCount(MOCK_SLIDES.length, { timeout: 10000 });
    await expect(window.getByRole("img", { name: "Slide 1 preview" })).toBeVisible();

    await expect(notesEditor()).toHaveValue(MOCK_SLIDES[0]!.notes);
  });

  test("stopping a pending preview prevents late playback without cancelling synthesis", async () => {
    await resetGeneratedSpeechCalls();
    await notesEditor().fill("Delayed preview");
    const narratorPreview = window.getByRole("button", { name: "Narrator", exact: true });

    await narratorPreview.click();
    await expect.poll(getGeneratedSpeechCalls).toContainEqual({
      text: "Delayed preview",
      voiceOption: MOCK_VOICES.Narrator,
    });
    await narratorPreview.click();
    await releaseDelayedPreview();

    await expect.poll(getPlaybackActivity).toMatchObject({ playUrls: [] });
    await expect.poll(getCompletedPreviewSyntheses).toBe(1);
  });

  test("saves the full presentation through Electron narration preparation", async () => {
    await window.getByRole("button", { name: "Save All Slides", exact: true }).click();

    await expect(
      window.getByRole("button", { name: "Save All Slides", exact: true }),
    ).toBeEnabled();
    await expect.poll(getSaveNotesCalls).toEqual([
      {
        filePath: FIXTURE_TEST,
        slides: MOCK_SLIDES.map((slide) => ({ index: slide.index, notes: slide.notes })),
      },
    ]);
    await expect.poll(getInsertAudioCalls).toEqual([
      {
        filePath: FIXTURE_TEST,
        slidesAudio: MOCK_SLIDES.map((slide) => ({
          index: slide.index,
          sectionIndex: 0,
          audioData: new Uint8Array(TINY_FAKE_AUDIO_BYTES),
        })),
      },
    ]);
  });

  test("delivers narration progress over the bridge and stops listening once settled", async () => {
    const observed = await window.evaluate(
      async ({ filePath, slides }) => {
        const globals = globalThis as typeof globalThis & {
          __bridgeProgress: NarrationProgress[];
          electronAPI: RendererNarrationApi;
        };
        globals.__bridgeProgress = [];

        const result = await globals.electronAPI.saveNarratedPresentation(
          { filePath, slides },
          (progress) => globals.__bridgeProgress.push(progress),
        );

        return { result, progress: [...globals.__bridgeProgress] };
      },
      {
        filePath: FIXTURE_TEST,
        slides: MOCK_SLIDES.map((slide) => ({
          slideIndex: slide.index,
          notes: slide.notes ?? "",
        })),
      },
    );

    expect(observed.result).toEqual({ success: true });
    // Main sends an update per prepared slide, but the renderer resolves the invoke reply
    // before the last one is dispatched, so the teardown asserted below discards it. This
    // flow therefore proves only that progress crosses the bridge
    expect(observed.progress.length).toBeGreaterThan(0);
    for (const progress of observed.progress) {
      expect(progress.total).toBe(MOCK_SLIDES.length);
    }

    // The channel name below is duplicated from electron/preload.cts, whose sandboxed
    // require cannot reach a shared constant. Keep the two in step: if the bridge is
    // renamed and this is not, the probe lands on a channel nobody listens to, and the
    // assertion that no stray update arrived passes without testing anything.
    // The bridge numbers each channel from a counter private to the preload, so probe
    // every id this window could plausibly have used rather than guessing one.
    await electronApp.evaluate(({ BrowserWindow }, probeCount) => {
      const webContents = BrowserWindow.getAllWindows()[0]?.webContents;
      for (let requestId = 1; requestId <= probeCount; requestId += 1) {
        webContents?.send(`narrated-presentation-save-progress:${requestId}`, {
          completed: 99,
          total: 99,
        });
      }
    }, 5);
    await window.evaluate(() =>
      (
        globalThis as typeof globalThis & { electronAPI: RendererNarrationApi }
      ).electronAPI.getVideoSavePath(),
    );

    const progressAfterSettle = await window.evaluate(
      () =>
        (globalThis as typeof globalThis & { __bridgeProgress: NarrationProgress[] })
          .__bridgeProgress,
    );
    expect(progressAfterSettle).toEqual(observed.progress);
  });

  test("warns window and application close while narration edits are dirty", async () => {
    await notesEditor().fill("Unsaved close warning");

    await attemptCloseAndKeepEditing(
      () =>
        electronApp.evaluate(({ BrowserWindow }) => {
          BrowserWindow.getAllWindows()[0]?.close();
        }),
      1,
    );
    await attemptCloseAndKeepEditing(
      () =>
        electronApp.evaluate(({ app }) => {
          app.quit();
        }),
      2,
    );

    await expect.poll(getDiscardConfirmationCalls).toEqual([
      expect.objectContaining({
        buttons: ["Keep Editing", "Discard Changes"],
        message: "Discard unsaved narration changes?",
      }),
      expect.objectContaining({
        buttons: ["Keep Editing", "Discard Changes"],
        message: "Discard unsaved narration changes?",
      }),
    ]);
  });
});
