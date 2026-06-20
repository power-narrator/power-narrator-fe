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
  slides: Slide[];
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
    ({ ipcMain }, { testFilePath, mockSlides, mockVoices, tinyFakeAudioBytes }) => {
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

async function resetCapturedIpcCalls() {
  await electronApp.evaluate(() => {
    const globals = globalThis as typeof globalThis & {
      __convertPptxCalls: unknown[];
      __saveNotesCalls: unknown[];
      __generatedSpeechCalls: unknown[];
    };

    globals.__convertPptxCalls = [];
    globals.__saveNotesCalls = [];
    globals.__generatedSpeechCalls = [];
  });
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

test.beforeAll(async () => {
  fs.copyFileSync(FIXTURE_ORIGINAL, FIXTURE_TEST);

  electronApp = await launchTestApp();
  await installMockIpcHandlers(electronApp);

  const appWindow = await electronApp.firstWindow();

  if (!appWindow) {
    throw new Error("Could not find application window");
  }

  window = appWindow;
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
        slides: [
          expect.objectContaining({
            index: MOCK_SLIDES[0]!.index,
            image: MOCK_SLIDES[0]!.image,
            notes: editedNotes,
          }),
        ],
      },
    ]);
  });
});
