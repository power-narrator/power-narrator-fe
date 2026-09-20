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
import { parseNarrationSections } from "../shared/narration/NarrationSections.js";
import { toNotesText } from "../shared/narration/slideNotePayload.js";

type PrepareNarrationPreview = (
  payload: PreviewNarrationRequest,
) => Promise<NarrationPreviewResult>;
type ProgressListener = (event: unknown, progress: NarrationPreparationProgress) => void;
type SaveNarratedPresentation = (
  payload: NarratedPresentationSaveRequest,
  onProgress: (progress: NarrationPreparationProgress) => void,
) => Promise<NarratedSaveResult>;

const electron = vi.hoisted(() => {
  const state = {
    exposedApi: undefined as
      | {
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
      slides: [{ slideIndex: 1, notes: "Narrate this" }],
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
    sectionIndex: 0,
    sections: parseNarrationSections(notes, ["Narrator"]),
    text: "First",
    speakerChoice: { kind: "effective" },
  });

  const [channel, payload] = electron.ipcRenderer.invoke.mock.lastCall!;
  expect(channel).toBe("prepare-narration-preview");
  const delivered = structuredClone(payload) as PreviewNarrationRequest;
  expect(delivered).toEqual(payload);
  expect(toNotesText(delivered)).toBe(notes);
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
  expect(toNotesText(delivered.slides[0]!)).toBe(notes);
});
