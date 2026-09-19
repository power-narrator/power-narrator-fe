import { _electron as electron } from "playwright";
import type { ElectronApplication, Page } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { SlideWithSrc as Slide } from "../../../electron/platform/types.js";
import type { SpeakerMapping, Voice } from "../../../shared/types/tts.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const FIXTURE_ORIGINAL = path.join(__dirname, "../../fixtures/test-presentation.pptx");
export const FIXTURE_TEST = path.join(__dirname, "../../fixtures/test-presentation-run.pptx");

const TRANSPARENT_SLIDE_IMAGE =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

export const MOCK_SLIDES: Slide[] = [
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

export const MOCK_MAPPINGS: Record<string, SpeakerMapping> = {
  _default_: {
    voice: {
      provider: "gcp",
      voiceId: "Default",
      model: "chirp-3-hd",
      languageCode: "en-US",
      supportsPrompt: false,
    },
  },
  Narrator: {
    voice: {
      provider: "gcp",
      voiceId: "Narrator",
      model: "chirp-3-hd",
      languageCode: "en-US",
      supportsPrompt: false,
    },
  },
};

const SILENT_MP3_FRAME = [0xff, 0xfb, 0x90, 0x64, ...Array.from({ length: 413 }, () => 0)];
export const DETERMINISTIC_MP3_BYTES = [
  ...SILENT_MP3_FRAME,
  ...SILENT_MP3_FRAME,
  ...SILENT_MP3_FRAME,
];

/** Text that parks synthesis until `releaseDelayedPreview` resolves it. */
export const DELAYED_PREVIEW_TEXT = "Delayed preview";

export type GeneratedSpeechCall = { text: string; voiceOption: Voice };
export type ConvertPptxCall = { filePath: string };
export type SaveNotesCall = {
  filePath: string;
  slides: Array<{ index: number; notes: string }>;
};
export type InsertAudioCall = {
  filePath: string;
  slidesAudio: Array<{ index: number; sectionIndex: number; audioData: Uint8Array }>;
};

type MainProbes = {
  convertPptx: ConvertPptxCall[];
  discardConfirmations: unknown[];
  generatedSpeech: GeneratedSpeechCall[];
  saveNotes: SaveNotesCall[];
  insertAudio: InsertAudioCall[];
};

type MainGlobals = typeof globalThis & {
  __probes: MainProbes;
  __shouldDiscardNarrationChanges: boolean;
  __completedPreviewSyntheses: number;
  __resolveDelayedPreview?: () => void;
};

type RendererGlobals = typeof globalThis & {
  __audioPlayUrls: string[];
  __createdBlobUrls: string[];
  __revokedBlobUrls: string[];
};

export type PlaybackActivity = {
  playUrls: string[];
  createdUrls: string[];
  revokedUrls: string[];
};

export function launchTestApp(): Promise<ElectronApplication> {
  return electron.launch({
    args: [path.join(__dirname, "../../../dist-electron/electron/main.js")],
    env: {
      ...process.env,
      NODE_ENV: "test",
    },
  });
}

export async function installMockIpcHandlers(app: ElectronApplication) {
  await app.evaluate(
    (
      { ipcMain },
      { testFilePath, mockSlides, mockMappings, deterministicMp3Bytes, delayedPreviewText },
    ) => {
      const globals = globalThis as MainGlobals;
      const emptyProbes = (): MainProbes => ({
        convertPptx: [],
        discardConfirmations: [],
        generatedSpeech: [],
        saveNotes: [],
        insertAudio: [],
      });

      globals.__probes = emptyProbes();
      globals.__shouldDiscardNarrationChanges = false;
      globals.__completedPreviewSyntheses = 0;
      (globals as MainGlobals & { __resetProbes: () => void }).__resetProbes = () => {
        globals.__probes = emptyProbes();
        globals.__completedPreviewSyntheses = 0;
      };

      globalThis.powerNarratorTestHarness!.useDiscardConfirmation((options) => {
        globals.__probes.discardConfirmations.push(options);
        return Promise.resolve(globals.__shouldDiscardNarrationChanges);
      });

      ipcMain.removeHandler("select-file");
      ipcMain.handle("select-file", () => testFilePath);

      ipcMain.removeHandler("convert-pptx");
      ipcMain.handle("convert-pptx", (_, filePath: string) => {
        globals.__probes.convertPptx.push({ filePath });
        return { success: true, slides: mockSlides };
      });

      ipcMain.removeHandler("get-speaker-mappings");
      ipcMain.handle("get-speaker-mappings", () => mockMappings);

      const synthesizer = {
        supportsProvider: () => true,
        generateSpeech: (text: string, voiceOption: Voice) => {
          globals.__probes.generatedSpeech.push({ text, voiceOption });

          if (text === delayedPreviewText) {
            return new Promise<{ audio: Uint8Array; mediaType: string }>((resolve) => {
              globals.__resolveDelayedPreview = () => {
                globals.__completedPreviewSyntheses += 1;
                resolve({ audio: new Uint8Array(deterministicMp3Bytes), mediaType: "audio/mpeg" });
              };
            });
          }

          return Promise.resolve({
            audio: new Uint8Array(deterministicMp3Bytes),
            mediaType: "audio/mpeg",
          });
        },
      };

      const powerPoint = {
        saveNotes: (filePath: string, slides: SaveNotesCall["slides"]) => {
          globals.__probes.saveNotes.push({ filePath, slides });
          return Promise.resolve({ success: true as const });
        },
        insertAudio: (filePath: string, slidesAudio: InsertAudioCall["slidesAudio"]) => {
          globals.__probes.insertAudio.push({ filePath, slidesAudio });
          return Promise.resolve({ success: true as const });
        },
        removeAudio: () => Promise.resolve({ success: true as const }),
      };

      globalThis.powerNarratorTestHarness!.useNarrationAdapters({
        mappingSource: { getSpeakerMappings: () => mockMappings },
        synthesizer,
        getPowerPoint: () => powerPoint,
      });
    },
    {
      testFilePath: FIXTURE_TEST,
      mockSlides: MOCK_SLIDES,
      mockMappings: MOCK_MAPPINGS,
      deterministicMp3Bytes: DETERMINISTIC_MP3_BYTES,
      delayedPreviewText: DELAYED_PREVIEW_TEXT,
    },
  );
}

/** Playback and blob-URL probes must exist before the renderer's first script runs. */
export async function installRendererProbes(page: Page) {
  await page.addInitScript(() => {
    const globals = globalThis as RendererGlobals;
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
        HTMLMediaElement: { prototype: { play: () => Promise<void>; pause: () => void } };
      }
    ).HTMLMediaElement.prototype;
    mediaPrototype.play = function (this: { src: string }) {
      globals.__audioPlayUrls.push(this.src);
      return Promise.resolve();
    };
    mediaPrototype.pause = () => {};
  });
}

export async function resetProbes(app: ElectronApplication, page: Page) {
  await app.evaluate(() => {
    (globalThis as MainGlobals & { __resetProbes: () => void }).__resetProbes();
  });
  await page.evaluate(() => {
    const globals = globalThis as RendererGlobals;
    globals.__audioPlayUrls = [];
    globals.__createdBlobUrls = [];
    globals.__revokedBlobUrls = [];
  });
}

function readProbe<Key extends keyof MainProbes>(app: ElectronApplication, key: Key) {
  return app.evaluate(
    (_, probeKey) => (globalThis as MainGlobals).__probes[probeKey as Key],
    key,
  ) as Promise<MainProbes[Key]>;
}

export const getConvertPptxCalls = (app: ElectronApplication) => readProbe(app, "convertPptx");
export const getDiscardConfirmationCalls = (app: ElectronApplication) =>
  readProbe(app, "discardConfirmations");
export const getGeneratedSpeechCalls = (app: ElectronApplication) =>
  readProbe(app, "generatedSpeech");
export const getSaveNotesCalls = (app: ElectronApplication) => readProbe(app, "saveNotes");
export const getInsertAudioCalls = (app: ElectronApplication) => readProbe(app, "insertAudio");

export function setShouldDiscardNarrationChanges(app: ElectronApplication, shouldDiscard: boolean) {
  return app.evaluate((_, nextValue) => {
    (globalThis as MainGlobals).__shouldDiscardNarrationChanges = nextValue;
  }, shouldDiscard);
}

export function releaseDelayedPreview(app: ElectronApplication) {
  return app.evaluate(() => {
    const globals = globalThis as MainGlobals;
    globals.__resolveDelayedPreview?.();
    globals.__resolveDelayedPreview = undefined;
  });
}

export function getCompletedPreviewSyntheses(app: ElectronApplication) {
  return app.evaluate(() => (globalThis as MainGlobals).__completedPreviewSyntheses);
}

export function getPlaybackActivity(page: Page): Promise<PlaybackActivity> {
  return page.evaluate(() => {
    const globals = globalThis as RendererGlobals;
    return {
      playUrls: globals.__audioPlayUrls,
      createdUrls: globals.__createdBlobUrls,
      revokedUrls: globals.__revokedBlobUrls,
    };
  });
}
