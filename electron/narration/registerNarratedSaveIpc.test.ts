import fs from "node:fs";
import { toSlideIndex } from "../../shared/slides/slideCoordinates.js";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  SaveAllRunCancellation,
  type NarratedPresentationSaver,
} from "./NarratedPresentationSaver.js";
import { registerNarratedPresentationSaveIpc } from "./registerNarratedPresentationSaveIpc.js";
import { registerNarratedSlideSaveIpc } from "./registerNarratedSlideSaveIpc.js";

import type { IpcMainInvokeEvent } from "electron";

type IpcHandler = (event: IpcMainInvokeEvent, request: never) => Promise<unknown>;

let presentationPath: string;
let temporaryDirectory: string;

beforeEach(() => {
  temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "power-narrator-narrated-save-"));
  presentationPath = path.join(temporaryDirectory, "talk.pptx");
  fs.writeFileSync(presentationPath, "presentation");
});

afterEach(() => {
  fs.rmSync(temporaryDirectory, { recursive: true, force: true });
});

function registerHandlers() {
  const handlers = new Map<string, IpcHandler>();
  const ipc = {
    handle: (channel: string, handler: IpcHandler) => {
      handlers.set(channel, handler);
    },
  };
  const saver = {
    saveSlide: vi.fn<NarratedPresentationSaver["saveSlide"]>().mockResolvedValue({ success: true }),
    savePresentation: vi.fn<NarratedPresentationSaver["savePresentation"]>().mockResolvedValue({
      outcome: { success: true },
      savedNoteSlides: [],
    }),
  } as unknown as NarratedPresentationSaver;

  registerNarratedSlideSaveIpc(ipc, saver);
  registerNarratedPresentationSaveIpc(ipc, saver, {
    holdWindowOpen: (_webContentsId, run) => run(),
  });
  return { handlers, saver };
}

const event = {
  sender: { send: vi.fn<(channel: string, ...args: unknown[]) => void>() },
} as unknown as IpcMainInvokeEvent;

const firstProgress = {
  slideIndex: toSlideIndex(1),
  completedSlides: 0,
  totalSlides: 1,
  phase: "generating",
} as const;
const secondProgress = { ...firstProgress, phase: "saving" } as const;

it("forwards save-all run progress to the requested progress channel", async () => {
  const { handlers, saver } = registerHandlers();
  vi.mocked(saver).savePresentation.mockImplementation((_request, onProgress) => {
    onProgress?.(firstProgress);
    onProgress?.(secondProgress);
    return Promise.resolve({ outcome: { success: true }, savedNoteSlides: [] });
  });
  const send = vi.fn<(channel: string, ...args: unknown[]) => void>();
  const progressEvent = { sender: { send } } as unknown as IpcMainInvokeEvent;

  await handlers.get("save-narrated-presentation")!(progressEvent, {
    filePath: presentationPath,
    slides: [
      {
        slideIndex: 1,
        sections: [{ speaker: "Narrator", text: "Hello", playAcrossSlides: false }],
      },
    ],
    progressChannel: "narrated-presentation-save-progress:7",
  } as never);

  expect(send.mock.calls).toEqual([
    ["narrated-presentation-save-progress:7", firstProgress],
    ["narrated-presentation-save-progress:7", secondProgress],
  ]);
});

describe.each([
  [
    "save-narrated-slide",
    (filePath: string) => ({
      filePath,
      slideIndex: 1,
      sections: [{ speaker: "Narrator", text: "Hello", playAcrossSlides: false }],
    }),
    "saveSlide" as const,
    (): unknown[] => [],
    (outcome: unknown) => outcome,
  ],
  [
    "save-narrated-presentation",
    (filePath: string) => ({
      filePath,
      slides: [
        {
          slideIndex: 1,
          sections: [{ speaker: "Narrator", text: "Hello", playAcrossSlides: false }],
        },
      ],
      runId: 1,
      progressChannel: "narrated-presentation-save-progress:1",
    }),
    "savePresentation" as const,
    (): unknown[] => [expect.any(Function), expect.any(SaveAllRunCancellation)],
    (outcome: unknown) => ({ outcome, savedNoteSlides: [] }),
  ],
])("%s", (channel, createRequest, saverMethod, expectedRunArguments, asResult) => {
  it("fails before preparation when the presentation is missing", async () => {
    const { handlers, saver } = registerHandlers();
    const missingPath = path.join(temporaryDirectory, "missing.pptx");

    await expect(
      handlers.get(channel)!(event, createRequest(missingPath) as never),
    ).resolves.toEqual(
      asResult({
        success: false,
        stage: "validation",
        partial: false,
        message: `File not found: ${missingPath}`,
      }),
    );
    expect(saver[saverMethod]).not.toHaveBeenCalled();
  });

  it("saves an existing presentation through its resolved absolute path", async () => {
    const { handlers, saver } = registerHandlers();
    const relativePath = path.relative(process.cwd(), presentationPath);

    await expect(
      handlers.get(channel)!(event, createRequest(relativePath) as never),
    ).resolves.toEqual(asResult({ success: true }));
    expect(saver[saverMethod]).toHaveBeenCalledWith(
      expect.objectContaining({ filePath: presentationPath }),
      ...expectedRunArguments(),
    );
  });
});
