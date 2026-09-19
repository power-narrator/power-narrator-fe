import fs from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import vm from "node:vm";
import { expect, it, vi } from "vitest";
import type {
  NarratedPresentationSaveRequest,
  NarratedSaveResult,
  NarrationPreparationProgress,
} from "../shared/types/narration.js";

type ProgressListener = (event: unknown, progress: NarrationPreparationProgress) => void;
type SaveNarratedPresentation = (
  payload: NarratedPresentationSaveRequest,
  onProgress: (progress: NarrationPreparationProgress) => void,
) => Promise<NarratedSaveResult>;

const electron = vi.hoisted(() => {
  const state = {
    exposedApi: undefined as { saveNarratedPresentation: SaveNarratedPresentation } | undefined,
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
