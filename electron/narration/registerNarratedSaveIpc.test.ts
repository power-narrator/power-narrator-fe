import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NarratedPresentationSaver } from "./NarratedPresentationSaver.js";
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
      success: true,
    }),
  } as unknown as NarratedPresentationSaver;

  registerNarratedSlideSaveIpc(ipc, saver);
  registerNarratedPresentationSaveIpc(ipc, saver);
  return { handlers, saver };
}

const event = {
  sender: { send: vi.fn<(channel: string, ...args: unknown[]) => void>() },
} as unknown as IpcMainInvokeEvent;

it("forwards preparation progress to the requested progress channel", async () => {
  const { handlers, saver } = registerHandlers();
  vi.mocked(saver).savePresentation.mockImplementation((_request, onProgress) => {
    onProgress?.({ completed: 1, total: 2 });
    onProgress?.({ completed: 2, total: 2 });
    return Promise.resolve({ success: true });
  });
  const send = vi.fn<(channel: string, ...args: unknown[]) => void>();
  const progressEvent = { sender: { send } } as unknown as IpcMainInvokeEvent;

  await handlers.get("save-narrated-presentation")!(progressEvent, {
    filePath: presentationPath,
    slides: [{ slideIndex: 1, notes: "[Narrator]\nHello" }],
    progressChannel: "narrated-presentation-save-progress:7",
  } as never);

  expect(send.mock.calls).toEqual([
    ["narrated-presentation-save-progress:7", { completed: 1, total: 2 }],
    ["narrated-presentation-save-progress:7", { completed: 2, total: 2 }],
  ]);
});

describe.each([
  [
    "save-narrated-slide",
    (filePath: string) => ({ filePath, slideIndex: 1, notes: "[Narrator]\nHello" }),
    "saveSlide" as const,
    0,
  ],
  [
    "save-narrated-presentation",
    (filePath: string) => ({
      filePath,
      slides: [{ slideIndex: 1, notes: "[Narrator]\nHello" }],
      progressChannel: "narrated-presentation-save-progress:1",
    }),
    "savePresentation" as const,
    1,
  ],
])("%s", (channel, createRequest, saverMethod, progressArgumentCount) => {
  it("fails before preparation when the presentation is missing", async () => {
    const { handlers, saver } = registerHandlers();
    const missingPath = path.join(temporaryDirectory, "missing.pptx");

    await expect(
      handlers.get(channel)!(event, createRequest(missingPath) as never),
    ).resolves.toEqual({
      success: false,
      stage: "validation",
      partial: false,
      message: `File not found: ${missingPath}`,
    });
    expect(saver[saverMethod]).not.toHaveBeenCalled();
  });

  it("saves an existing presentation through its resolved absolute path", async () => {
    const { handlers, saver } = registerHandlers();
    const relativePath = path.relative(process.cwd(), presentationPath);

    await expect(
      handlers.get(channel)!(event, createRequest(relativePath) as never),
    ).resolves.toEqual({ success: true });
    const expectedProgressArguments: unknown[] = Array.from(
      { length: progressArgumentCount },
      (): unknown => expect.any(Function),
    );
    expect(saver[saverMethod]).toHaveBeenCalledWith(
      expect.objectContaining({ filePath: presentationPath }),
      ...expectedProgressArguments,
    );
  });
});
