import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
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
      exposeInMainWorld: vi.fn((_name: string, api: unknown) => {
        state.exposedApi = api as typeof state.exposedApi;
      }),
    },
    ipcRenderer: {
      invoke: vi.fn(),
      on: vi.fn((_channel: string, listener: ProgressListener) => state.listeners.add(listener)),
      removeListener: vi.fn((_channel: string, listener: ProgressListener) =>
        state.listeners.delete(listener),
      ),
      sendSync: vi.fn(),
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
  const javascript = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
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
