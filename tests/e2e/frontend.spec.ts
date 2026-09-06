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
  voiceOption?: Voice;
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

let electronApp: ElectronApplication;
let window: Page;

async function launchTestApp() {
  return electron.launch({
    args: [path.join(__dirname, "../../dist-electron/main.js")],
    env: {
      ...process.env,
      NODE_ENV: "test",
      TTS_PROVIDER: "gcp",
    },
  });
}

async function installMockIpcHandlers(app: ElectronApplication) {
  await app.evaluate(
    async ({ ipcMain }, { testFilePath, mockSlides, mockVoices, tinyFakeAudioBytes }) => {
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

      ipcMain.removeHandler("insert-audio");
      ipcMain.handle("insert-audio", async () => ({ success: true }));

      ipcMain.removeHandler("get-speaker-mappings");
      ipcMain.handle("get-speaker-mappings", async () => mockVoices);

      ipcMain.removeHandler("set-speaker-mappings");
      ipcMain.handle("set-speaker-mappings", async () => ({ success: true }));

      ipcMain.removeHandler("generate-speech");
      (
        globalThis as typeof globalThis & { __generatedSpeechCalls?: unknown[] }
      ).__generatedSpeechCalls = [];
      ipcMain.handle("generate-speech", async (_, payload) => {
        (
          globalThis as typeof globalThis & {
            __generatedSpeechCalls: unknown[];
          }
        ).__generatedSpeechCalls.push(payload);

        return new Uint8Array(tinyFakeAudioBytes);
      });

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
          (
            globalThis as typeof globalThis & {
              __generatedSpeechCalls: unknown[];
            }
          ).__generatedSpeechCalls.push({ text, voiceOption });

          if (text === "Delayed preview") {
            return new Promise<Uint8Array>((resolve) => {
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
                resolve(new Uint8Array(tinyFakeAudioBytes));
              };
            });
          }

          return new Uint8Array(tinyFakeAudioBytes);
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
          (
            globalThis as typeof globalThis & {
              __insertAudioCalls: unknown[];
            }
          ).__insertAudioCalls.push({ filePath, slidesAudio });
          return { success: true as const };
        },
      };

      const installNarrationPreviewTestAdapter = (
        globalThis as typeof globalThis & {
          __installNarrationPreviewTestAdapter: (
            mappingSource: unknown,
            synthesizer: unknown,
            powerpoint: unknown,
          ) => void;
        }
      ).__installNarrationPreviewTestAdapter;
      installNarrationPreviewTestAdapter(
        mappingSource,
        deterministicFakeTtsAdapter,
        deterministicFakePowerPointAdapter,
      );
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
      __saveNotesCalls: unknown[];
      __generatedSpeechCalls: unknown[];
      __insertAudioCalls: unknown[];
      __completedPreviewSyntheses: number;
      __previewMappings: Record<string, Voice>;
    };

    globals.__convertPptxCalls = [];
    globals.__saveNotesCalls = [];
    globals.__generatedSpeechCalls = [];
    globals.__insertAudioCalls = [];
    globals.__completedPreviewSyntheses = 0;
    globals.__previewMappings = mockVoices;
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

async function setPreviewMappings(mappings: Record<string, Voice>) {
  await electronApp.evaluate((_, nextMappings) => {
    (
      globalThis as typeof globalThis & {
        __previewMappings: Record<string, Voice>;
      }
    ).__previewMappings = nextMappings;
  }, mappings);
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

  test("loads mocked slides into the viewer", async () => {
    await expect.poll(getConvertPptxCalls).toEqual([{ filePath: FIXTURE_TEST }]);

    const thumbnails = window.getByRole("img", { name: /Slide \d+ thumbnail/ });
    await expect(thumbnails).toHaveCount(MOCK_SLIDES.length, { timeout: 10000 });
    await expect(window.getByRole("img", { name: "Slide 1 preview" })).toBeVisible();

    await expect(notesEditor()).toHaveValue(MOCK_SLIDES[0]!.notes);
  });

  test("previews edited text before textarea blur", async () => {
    await resetGeneratedSpeechCalls();

    const notesTextarea = notesEditor();
    await expect(notesTextarea).toBeVisible();

    await notesTextarea.fill("Preview text edited before blur");
    await expect(notesTextarea).toBeFocused();

    await window.getByRole("button", { name: "Narrator", exact: true }).click();

    await expect.poll(getGeneratedSpeechCalls).toContainEqual({
      text: "Preview text edited before blur",
      voiceOption: MOCK_VOICES.Narrator,
    });
  });

  test("previews only the live selected text", async () => {
    await resetGeneratedSpeechCalls();
    const notesTextarea = notesEditor();
    await notesTextarea.fill("Read only this phrase please");
    await notesTextarea.evaluate(
      (element: { focus(): void; setSelectionRange(a: number, b: number): void }) => {
        element.focus();
        element.setSelectionRange(5, 21);
      },
    );

    await window.getByRole("button", { name: "Narrator", exact: true }).click();

    await expect.poll(getGeneratedSpeechCalls).toContainEqual({
      text: "only this phrase",
      voiceOption: MOCK_VOICES.Narrator,
    });
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

  test("surfaces contextual narration validation errors", async () => {
    await setPreviewMappings({ Narrator: MOCK_VOICES.Narrator! });
    const dialogMessage = new Promise<string>((resolve) => {
      window.once("dialog", async (dialog) => {
        resolve(dialog.message());
        await dialog.dismiss();
      });
    });

    await window.getByRole("button", { name: "Default", exact: true }).click();

    await expect(dialogMessage).resolves.toMatch(
      /slide 1, section 1, speaker "Default": no voice mapping is configured/,
    );
  });

  test("revokes obsolete Blob URLs when preview playback is replaced and disposed", async () => {
    await notesEditor().fill("First preview");
    await window.getByRole("button", { name: "Narrator", exact: true }).click();
    await expect.poll(getPlaybackActivity).toMatchObject({ playUrls: [expect.any(String)] });

    await notesEditor().fill("Replacement preview");
    await window.getByRole("button", { name: "Default", exact: true }).click();
    await expect.poll(getPlaybackActivity).toMatchObject({
      playUrls: [expect.any(String), expect.any(String)],
      revokedUrls: [expect.any(String)],
    });

    await window.getByRole("button", { name: "Back", exact: false }).click();
    await expect.poll(getPlaybackActivity).toMatchObject({
      revokedUrls: [expect.any(String), expect.any(String)],
    });
  });

  test("saves edited slide notes", async () => {
    const editedNotes = "Initial notes for slide 1 - EDITED IN TEST";
    const notesTextarea = notesEditor();
    await expect(notesTextarea).toBeVisible();

    await notesTextarea.fill(editedNotes);
    await window.getByRole("button", { name: "Save Slide", exact: true }).click();

    await expect(window.getByRole("button", { name: "Save Slide", exact: true })).toBeEnabled();
    await expect.poll(getSaveNotesCalls).toEqual([
      {
        filePath: FIXTURE_TEST,
        slides: [{ index: MOCK_SLIDES[0]!.index, notes: editedNotes }],
      },
    ]);
    await expect.poll(getInsertAudioCalls).toEqual([
      {
        filePath: FIXTURE_TEST,
        slidesAudio: [
          {
            index: MOCK_SLIDES[0]!.index,
            sectionIndex: 0,
            audioData: new Uint8Array(TINY_FAKE_AUDIO_BYTES),
          },
        ],
      },
    ]);
  });
});
