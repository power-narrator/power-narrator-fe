import fs from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import vm from "node:vm";
import { expect, it, vi } from "vitest";
import type {
  NarratedPresentationSaveRequest,
  SaveAllRunCallbacks,
  SaveAllRunProgress,
  SaveAllRunResult,
  NarrationPreviewResult,
  PreviewNarrationRequest,
} from "../shared/types/narration.js";
import type { StructuredSlideResult, StructuredSlidesResult } from "../shared/types/slides.js";
import type {
  BasicPptResult,
  PlaySlideRequest,
  ReloadSlideRequest,
  RemoveAudioRequest,
} from "../shared/types/powerpoint.js";
import { slideIndexFromOneBased, toSlideIndex } from "../shared/slides/slideCoordinates.js";
import {
  formatNarrationSections,
  parseNarrationSections,
} from "../shared/narration/NarrationSections.js";

const sectionsOf = (notes: string, knownSpeakers: string[]) =>
  parseNarrationSections(notes, knownSpeakers).map((section) => ({
    ...section,
    playAcrossSlides: false,
  }));

type PrepareNarrationPreview = (
  payload: PreviewNarrationRequest,
) => Promise<NarrationPreviewResult>;
type ProgressListener = (event: unknown, progress: SaveAllRunProgress) => void;
type ConvertPptx = (filePath: string) => Promise<StructuredSlidesResult>;
type ReloadSlide = (payload: ReloadSlideRequest) => Promise<StructuredSlideResult>;
type PlaySlide = (payload: PlaySlideRequest) => Promise<BasicPptResult>;
type RemoveAudio = (payload: RemoveAudioRequest) => Promise<BasicPptResult>;
type SaveNarratedPresentation = (
  payload: NarratedPresentationSaveRequest,
  callbacks: SaveAllRunCallbacks,
) => Promise<SaveAllRunResult>;

const electron = vi.hoisted(() => {
  const state = {
    exposedApi: undefined as
      | {
          convertPptx: ConvertPptx;
          reloadSlide: ReloadSlide;
          playSlide: PlaySlide;
          removeAudio: RemoveAudio;
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
    addEventListener: () => {},
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
  const pendingSave = controlledPromise<SaveAllRunResult>();
  electron.ipcRenderer.invoke.mockReturnValue(pendingSave.promise);
  const observedProgress: SaveAllRunProgress[] = [];

  const saving = electron.state.exposedApi!.saveNarratedPresentation(
    {
      filePath: "/slides/talk.pptx",
      slides: [
        {
          slideIndex: toSlideIndex(0),
          sections: [{ speaker: "", text: "Narrate this", playAcrossSlides: false }],
        },
      ],
    },
    { onProgress: (progress) => observedProgress.push(progress), onCancellable: () => {} },
  );

  const generating = {
    slideIndex: toSlideIndex(0),
    completedSlides: 0,
    totalSlides: 1,
    phase: "generating",
  } as const;
  for (const listener of electron.state.listeners) {
    listener({}, generating);
  }
  expect(observedProgress).toEqual([generating]);

  pendingSave.resolve({ outcome: { success: true }, savedNoteSlides: [toSlideIndex(0)] });
  await saving;
  for (const listener of electron.state.listeners) {
    listener({}, { ...generating, phase: "saving" });
  }

  expect(observedProgress).toEqual([generating]);
});

it("cancels only the run it was handed for, and only while that run is active", async () => {
  loadPreload();
  const pendingSave = controlledPromise<SaveAllRunResult>();
  electron.ipcRenderer.invoke.mockReturnValueOnce(pendingSave.promise);
  let cancel!: () => void;

  const saving = electron.state.exposedApi!.saveNarratedPresentation(
    { filePath: "/slides/talk.pptx", slides: [] },
    {
      onProgress: () => {},
      onCancellable: (cancelRun) => {
        cancel = cancelRun;
      },
    },
  );
  const [, request] = electron.ipcRenderer.invoke.mock.lastCall! as [string, { runId: number }];

  electron.ipcRenderer.invoke.mockResolvedValue(undefined);
  cancel();
  expect(electron.ipcRenderer.invoke).toHaveBeenLastCalledWith(
    "cancel-narrated-presentation-save",
    request.runId,
  );

  pendingSave.resolve({ outcome: { success: false, stage: "cancelled" }, savedNoteSlides: [] });
  await saving;
  electron.ipcRenderer.invoke.mockClear();
  cancel();

  expect(electron.ipcRenderer.invoke).not.toHaveBeenCalled();
});

it("carries structured slide-note sections across the preview channel", async () => {
  loadPreload();
  const notes = "  [ Narrator ]  \n[p: almost whispering]\nFirst\n\n-----\nSecond\n";
  electron.ipcRenderer.invoke.mockResolvedValue({
    audio: new Uint8Array([1]),
    mediaType: "audio/mpeg",
  });

  await electron.state.exposedApi!.prepareNarrationPreview({
    slideIndex: toSlideIndex(0),
    sectionIndex: 1,
    sections: sectionsOf(notes, ["Narrator"]),
    text: "Second",
    speakerChoice: { kind: "effective" },
  });

  const [channel, payload] = electron.ipcRenderer.invoke.mock.lastCall!;
  expect(channel).toBe("prepare-narration-preview");
  const delivered = structuredClone(payload) as PreviewNarrationRequest;
  expect(delivered.slideIndex).toBe(0);
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
      slides: [
        {
          slideIndex: toSlideIndex(0),
          sections: sectionsOf(notes, ["Narrator", "Guest"]),
        },
      ],
    },
    { onProgress: () => {}, onCancellable: () => {} },
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
        slideIndex: slideIndexFromOneBased(4),
        image: "slide-4.png",
        src: "app://slide-4.png",
        sections: sectionsOf(notes, ["Narrator"]),
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

it.each([0, 6])(
  "carries slide index %i across the reload and playback channels unchanged",
  async (zeroBased) => {
    loadPreload();
    electron.ipcRenderer.invoke.mockResolvedValue({ success: true });

    await electron.state.exposedApi!.reloadSlide({
      filePath: "/slides/talk.pptx",
      slideIndex: toSlideIndex(zeroBased),
    });
    const [reloadChannel, reloadRequest] = electron.ipcRenderer.invoke.mock.lastCall!;

    await electron.state.exposedApi!.playSlide({
      filePath: "/slides/talk.pptx",
      slideIndex: toSlideIndex(zeroBased),
    });
    const [playChannel, playRequest] = electron.ipcRenderer.invoke.mock.lastCall!;

    await electron.state.exposedApi!.removeAudio({
      filePath: "/slides/talk.pptx",
      slideIndices: [toSlideIndex(zeroBased)],
    });
    const [removeChannel, removeRequest] = electron.ipcRenderer.invoke.mock.lastCall!;

    expect([reloadChannel, playChannel, removeChannel]).toEqual([
      "reload-slide",
      "play-slide",
      "remove-audio",
    ]);
    expect(structuredClone(reloadRequest)).toEqual({
      filePath: "/slides/talk.pptx",
      slideIndex: zeroBased,
    });
    expect(structuredClone(playRequest)).toEqual({
      filePath: "/slides/talk.pptx",
      slideIndex: zeroBased,
    });
    expect(structuredClone(removeRequest)).toEqual({
      filePath: "/slides/talk.pptx",
      slideIndices: [zeroBased],
    });
  },
);

it("carries a reloaded structured slide back across the reload channel", async () => {
  loadPreload();
  const notes = "[ Narrator ]\nReplaced\n-----\nSecond\n";
  electron.ipcRenderer.invoke.mockResolvedValue({
    success: true,
    slide: {
      slideIndex: slideIndexFromOneBased(2),
      image: "slide-2.png",
      src: "app://slide-2.png",
      sections: sectionsOf(notes, ["Narrator"]),
    },
  } satisfies StructuredSlideResult);

  const result = await electron.state.exposedApi!.reloadSlide({
    filePath: "/slides/talk.pptx",
    slideIndex: toSlideIndex(1),
  });

  const [, request] = electron.ipcRenderer.invoke.mock.lastCall!;
  expect(structuredClone(request)).toEqual({ filePath: "/slides/talk.pptx", slideIndex: 1 });
  const delivered = structuredClone(result);
  expect(delivered.success).toBe(true);
  const slide = delivered.success ? delivered.slide : undefined;
  expect(slide!.slideIndex).toBe(1);
  expect(formatNarrationSections(slide!.sections)).toBe(notes);
});
