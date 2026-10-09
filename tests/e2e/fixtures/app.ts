import { _electron as electron } from "playwright";
import { test as base, type ElectronApplication, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseNarrationSections } from "../../../shared/narration/NarrationSections.js";
import { toSlideIndex } from "../../../shared/slides/slideCoordinates.js";
import type { SlideWithSrc as Slide, StructuredSlide } from "../../../electron/platform/types.js";
import type { SpeakerMapping, Voice } from "../../../shared/types/tts.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const FIXTURE_ORIGINAL = path.join(__dirname, "../../fixtures/test-presentation.pptx");
export const FIXTURE_TEST = path.join(__dirname, "../../fixtures/test-presentation-run.pptx");

const TRANSPARENT_SLIDE_IMAGE =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

export const MOCK_SLIDES: Slide[] = [
  {
    slideIndex: toSlideIndex(0),
    image: "slide-1.png",
    src: TRANSPARENT_SLIDE_IMAGE,
    notes: "Initial notes for slide 1",
    sectionsPlayingAcrossSlides: new Set(),
  },
  {
    slideIndex: toSlideIndex(1),
    image: "slide-2.png",
    src: TRANSPARENT_SLIDE_IMAGE,
    notes: "Initial notes for slide 2\nLine 2",
    sectionsPlayingAcrossSlides: new Set(),
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

/** What the PowerPoint load seam hands the renderer, in place of raw note text. */
const MOCK_STRUCTURED_SLIDES: StructuredSlide[] = MOCK_SLIDES.map(
  ({ notes, sectionsPlayingAcrossSlides, ...slide }) => ({
    ...slide,
    sections: parseNarrationSections(notes, Object.keys(MOCK_MAPPINGS)).map(
      (section, sectionIndex) => ({
        ...section,
        playAcrossSlides: sectionsPlayingAcrossSlides.has(sectionIndex),
      }),
    ),
  }),
);

export type GeneratedSpeechCall = { text: string; voiceOption: Voice };
export type SaveNotesCall = {
  filePath: string;
  slides: Array<{ slideIndex: number; notes: string }>;
};
export type InsertAudioCall = {
  filePath: string;
  slidesAudio: Array<{
    slideIndex: number;
    sectionIndex: number;
    audioData: Uint8Array;
    playAcrossSlides: boolean;
  }>;
};

export type RemoveAudioCall = { filePath: string; slideIndices: number[] };

type MainProbes = {
  discardConfirmations: unknown[];
  generatedSpeech: GeneratedSpeechCall[];
  saveNotes: SaveNotesCall[];
  insertAudio: InsertAudioCall[];
  removeAudio: RemoveAudioCall[];
};

/** External narration work the fake adapters can hold until a test releases it. */
export type HeldWorkKind = "speech" | "saveNotes" | "insertAudio" | "removeAudio";
export type HeldWork = { kind: HeldWorkKind; label: string };

type HeldWorkControl = {
  holding: HeldWorkKind[];
  pending: Array<HeldWork & { release: () => void }>;
};

type MainGlobals = typeof globalThis & {
  __probes: MainProbes;
  __shouldDiscardNarrationChanges: boolean;
  __heldWork: HeldWorkControl;
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

function launchTestApp(): Promise<ElectronApplication> {
  return electron.launch({
    args: [path.join(__dirname, "../../../dist-electron/electron/main.js")],
    env: {
      ...process.env,
      NODE_ENV: "test",
    },
  });
}

async function installMockIpcHandlers(app: ElectronApplication) {
  await app.evaluate(
    ({ ipcMain }, { testFilePath, mockSlides, mockMappings, deterministicMp3Bytes }) => {
      const globals = globalThis as MainGlobals;
      const emptyProbes = (): MainProbes => ({
        discardConfirmations: [],
        generatedSpeech: [],
        saveNotes: [],
        insertAudio: [],
        removeAudio: [],
      });

      globals.__probes = emptyProbes();
      globals.__shouldDiscardNarrationChanges = false;
      globals.__heldWork = { holding: [], pending: [] };
      (globals as MainGlobals & { __resetProbes: () => void }).__resetProbes = () => {
        globals.__probes = emptyProbes();
        globals.__heldWork.holding = [];
        for (const work of globals.__heldWork.pending.splice(0)) {
          work.release();
        }
      };

      const settle = <T>(kind: HeldWorkKind, label: string, value: T): Promise<T> =>
        globals.__heldWork.holding.includes(kind)
          ? new Promise<T>((resolve) => {
              globals.__heldWork.pending.push({ kind, label, release: () => resolve(value) });
            })
          : Promise.resolve(value);

      globalThis.powerNarratorTestHarness!.useDiscardConfirmation((options) => {
        globals.__probes.discardConfirmations.push(options);
        return Promise.resolve(globals.__shouldDiscardNarrationChanges);
      });

      ipcMain.removeHandler("select-file");
      ipcMain.handle("select-file", () => testFilePath);

      ipcMain.removeHandler("convert-pptx");
      ipcMain.handle("convert-pptx", () => ({ success: true, slides: mockSlides }));

      ipcMain.removeHandler("get-speaker-mappings");
      ipcMain.handle("get-speaker-mappings", () => mockMappings);

      const synthesizer = {
        supportsProvider: () => true,
        generateSpeech: (text: string, voiceOption: Voice) => {
          globals.__probes.generatedSpeech.push({ text, voiceOption });

          return settle("speech", text, {
            audio: new Uint8Array(deterministicMp3Bytes),
            mediaType: "audio/mpeg",
          });
        },
      };

      const powerPoint = {
        saveNotes: (filePath: string, slides: SaveNotesCall["slides"]) => {
          globals.__probes.saveNotes.push({ filePath, slides });
          return settle("saveNotes", slides.map((slide) => slide.slideIndex).join(), {
            success: true as const,
          });
        },
        insertAudio: (filePath: string, slidesAudio: InsertAudioCall["slidesAudio"]) => {
          globals.__probes.insertAudio.push({ filePath, slidesAudio });
          return settle(
            "insertAudio",
            [...new Set(slidesAudio.map((audio) => audio.slideIndex))].join(),
            { success: true as const },
          );
        },
        removeAudio: (filePath: string, slideIndices: number[]) => {
          globals.__probes.removeAudio.push({ filePath, slideIndices });
          return settle("removeAudio", slideIndices.join(), { success: true as const });
        },
      };

      globalThis.powerNarratorTestHarness!.useNarrationAdapters({
        mappingSource: { getSpeakerMappings: () => mockMappings },
        synthesizer,
        getPowerPoint: () => powerPoint,
      });
    },
    {
      testFilePath: FIXTURE_TEST,
      mockSlides: MOCK_STRUCTURED_SLIDES,
      mockMappings: MOCK_MAPPINGS,
      deterministicMp3Bytes: DETERMINISTIC_MP3_BYTES,
    },
  );
}

async function installRendererProbes(page: Page) {
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

function stopHoldingNarrationWork(app: ElectronApplication) {
  return app.evaluate(() => {
    (globalThis as MainGlobals & { __resetProbes: () => void }).__resetProbes();
  });
}

export async function resetProbes(app: ElectronApplication, page: Page) {
  await stopHoldingNarrationWork(app);
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

export const getDiscardConfirmationCalls = (app: ElectronApplication) =>
  readProbe(app, "discardConfirmations");
export const getGeneratedSpeechCalls = (app: ElectronApplication) =>
  readProbe(app, "generatedSpeech");
export const getSaveNotesCalls = (app: ElectronApplication) => readProbe(app, "saveNotes");
export const getInsertAudioCalls = (app: ElectronApplication) => readProbe(app, "insertAudio");
export const getRemoveAudioCalls = (app: ElectronApplication) => readProbe(app, "removeAudio");

export function holdNarrationWork(app: ElectronApplication, kinds: HeldWorkKind[]) {
  return app.evaluate((_, heldKinds) => {
    (globalThis as MainGlobals).__heldWork.holding = heldKinds;
  }, kinds);
}

export function getHeldNarrationWork(app: ElectronApplication): Promise<HeldWork[]> {
  return app.evaluate(() =>
    (globalThis as MainGlobals).__heldWork.pending.map(({ kind, label }) => ({ kind, label })),
  );
}

/** Lets every currently held request finish; later requests are still held. */
export function releaseHeldNarrationWork(app: ElectronApplication) {
  return app.evaluate(() => {
    for (const work of (globalThis as MainGlobals).__heldWork.pending.splice(0)) {
      work.release();
    }
  });
}

function allowDiscardingNarrationChanges(app: ElectronApplication) {
  return app.evaluate(() => {
    (globalThis as MainGlobals).__shouldDiscardNarrationChanges = true;
  });
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

type WorkerFixtures = {
  app: ElectronApplication;
  win: Page;
};

export const test = base.extend<object, WorkerFixtures>({
  app: [
    // Playwright parses this signature for fixture names, so the empty pattern is required.
    // oxlint-disable-next-line no-empty-pattern
    async ({}, use) => {
      fs.copyFileSync(FIXTURE_ORIGINAL, FIXTURE_TEST);

      const app = await launchTestApp();
      await installMockIpcHandlers(app);

      await use(app);

      await stopHoldingNarrationWork(app);
      await allowDiscardingNarrationChanges(app);
      await app.close();
      fs.rmSync(FIXTURE_TEST, { force: true });
    },
    { scope: "worker" },
  ],

  win: [
    async ({ app }, use) => {
      const page = await app.firstWindow();
      await installRendererProbes(page);
      await use(page);
    },
    { scope: "worker" },
  ],
});

export { expect } from "@playwright/test";
