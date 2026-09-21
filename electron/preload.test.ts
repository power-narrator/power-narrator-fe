import fs from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import vm from "node:vm";
import { expect, it, vi } from "vitest";
import type {
  NarratedPresentationSaveRequest,
  NarratedSaveResult,
  NarrationPreparationProgress,
  NarrationPreviewResult,
  PreviewNarrationRequest,
} from "../shared/types/narration.js";
import type { StructuredSlidesResult } from "../shared/types/slides.js";
import { slideIndexFromLegacyNumber } from "../shared/slides/slideCoordinates.js";
import {
  formatNarrationSections,
  parseNarrationSections,
} from "../shared/narration/NarrationSections.js";

type PrepareNarrationPreview = (
  payload: PreviewNarrationRequest,
) => Promise<NarrationPreviewResult>;
type ProgressListener = (event: unknown, progress: NarrationPreparationProgress) => void;
type ConvertPptx = (filePath: string) => Promise<StructuredSlidesResult>;
type SaveNarratedPresentation = (
  payload: NarratedPresentationSaveRequest,
  onProgress: (progress: NarrationPreparationProgress) => void,
) => Promise<NarratedSaveResult>;

const electron = vi.hoisted(() => {
  const state = {
    exposedApi: undefined as
      | {
          convertPptx: ConvertPptx;
          saveNarratedPresentation: SaveNarratedPresentation;
          prepareNarrationPreview: PrepareNarrationPreview;
        }
      | undefined,
    listeners: new Set<ProgressListener>(),
  };
  return {
    state,
    contextBridge: {
      exposeInMainWorld: vi.fn<(name: string, api: unknown) => void>((_name, api) => {
        state.exposedApi = api as typeof state.exposedApi;
      }),
    },
    ipcRenderer: {
      invoke: vi.fn<(channel: string, ...args: unknown[]) => Promise<unknown>>(),
      on: vi.fn<(channel: string, listener: ProgressListener) => unknown>((_channel, listener) =>
        state.listeners.add(listener),
      ),
      removeListener: vi.fn<(channel: string, listener: ProgressListener) => unknown>(
        (_channel, listener) => state.listeners.delete(listener),
      ),
      sendSync: vi.fn<(channel: string, ...args: unknown[]) => unknown>(),
    },
  };
});

function controlledPromise<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function loadPreload() {
  const source = fs.readFileSync(new URL("./preload.cts", import.meta.url), "utf8");
  const javascript = stripTypeScriptTypes(source);
  vm.runInNewContext(javascript, {
    exports: {},
    require: (moduleName: string) => {
      if (moduleName === "electron") {
        return {
          contextBridge: electron.contextBridge,
          ipcRenderer: electron.ipcRenderer,
        };
      }
      throw new Error(`Unexpected preload dependency: ${moduleName}`);
    },
  });
}

it("stops delivering progress after a narrated presentation save settles", async () => {
  loadPreload();
  const pendingSave = controlledPromise<NarratedSaveResult>();
  electron.ipcRenderer.invoke.mockReturnValue(pendingSave.promise);
  const observedProgress: NarrationPreparationProgress[] = [];

  const saving = electron.state.exposedApi!.saveNarratedPresentation(
    {
      filePath: "/slides/talk.pptx",
      slides: [{ slideIndex: 1, sections: [{ speaker: "", text: "Narrate this" }] }],
    },
    (progress) => observedProgress.push(progress),
  );

  for (const listener of electron.state.listeners) {
    listener({}, { completed: 1, total: 2 });
  }
  expect(observedProgress).toEqual([{ completed: 1, total: 2 }]);

  pendingSave.resolve({ success: true });
  await saving;
  for (const listener of electron.state.listeners) {
    listener({}, { completed: 2, total: 2 });
  }

  expect(observedProgress).toEqual([{ completed: 1, total: 2 }]);
});

it("carries structured slide-note sections across the preview channel", async () => {
  loadPreload();
  const notes = "  [ Narrator ]  \n[p: almost whispering]\nFirst\n\n-----\nSecond\n";
  electron.ipcRenderer.invoke.mockResolvedValue({
    audio: new Uint8Array([1]),
    mediaType: "audio/mpeg",
  });

  await electron.state.exposedApi!.prepareNarrationPreview({
    slideIndex: 1,
    sectionIndex: 1,
    sections: parseNarrationSections(notes, ["Narrator"]),
    text: "Second",
    speakerChoice: { kind: "effective" },
  });

  const [channel, payload] = electron.ipcRenderer.invoke.mock.lastCall!;
  expect(channel).toBe("prepare-narration-preview");
  const delivered = structuredClone(payload) as PreviewNarrationRequest;
  expect(delivered.sectionIndex).toBe(1);
  expect(formatNarrationSections(delivered.sections)).toBe(notes);
});

it("carries structured slide-note sections across the narrated presentation save channel", async () => {
  loadPreload();
  const notes = "[Narrator]\nFirst\n----\n[ Guest ]\nSecond";
  electron.ipcRenderer.invoke.mockResolvedValue({ success: true });

  await electron.state.exposedApi!.saveNarratedPresentation(
    {
      filePath: "/slides/talk.pptx",
      slides: [{ slideIndex: 1, sections: parseNarrationSections(notes, ["Narrator", "Guest"]) }],
    },
    () => {},
  );

  const [, payload] = electron.ipcRenderer.invoke.mock.lastCall!;
  const delivered = structuredClone(payload) as NarratedPresentationSaveRequest;
  expect(formatNarrationSections(delivered.slides[0]!.sections)).toBe(notes);
});

it("carries structured slides back across the load channel with their slide indices intact", async () => {
  loadPreload();
  const notes = "  [ Narrator ]  \n[p: almost whispering]\nFirst\n\n-----\nSecond\n";
  electron.ipcRenderer.invoke.mockResolvedValue({
    success: true,
    slides: [
      {
        slideIndex: slideIndexFromLegacyNumber(4),
        index: 4,
        image: "slide-4.png",
        src: "app://slide-4.png",
        sections: parseNarrationSections(notes, ["Narrator"]),
      },
    ],
  } satisfies StructuredSlidesResult);

  const result = await electron.state.exposedApi!.convertPptx("/slides/talk.pptx");

  const delivered = structuredClone(result);
  expect(delivered.success).toBe(true);
  const slide = delivered.success ? delivered.slides[0]! : undefined;
  expect(slide!.slideIndex).toBe(3);
  expect(formatNarrationSections(slide!.sections)).toBe(notes);
});
