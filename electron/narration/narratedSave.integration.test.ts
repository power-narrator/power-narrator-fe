import { toSlideIndex } from "../../shared/slides/slideCoordinates.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { IpcMainInvokeEvent } from "electron";
import type { NarratedSaveResult } from "../../shared/types/narration.js";
import type { BasicPptResult, SlideAudioEntry, SlideNotesEntry } from "../platform/types.js";
import type { SpeakerMapping, SynthesizedSpeech, Voice } from "../tts/TtsProvider.js";
import { registerNarrationIpc, type NarrationPowerPoint } from "./registerNarrationIpc.js";

type IpcHandler = (event: IpcMainInvokeEvent, request: never) => Promise<unknown>;

const narratorVoice: Voice = {
  provider: "gcp",
  voiceId: "Narrator",
  model: "gemini-2.5-flash-tts",
  languageCode: "en-US",
  supportsPrompt: true,
};

const mappings: Record<string, SpeakerMapping> = { Narrator: { voice: narratorVoice } };

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

function registerNarrationHandlers() {
  const handlers = new Map<string, IpcHandler>();
  const generateSpeech = vi
    .fn<(text: string, voice: Voice, prompt?: string) => Promise<SynthesizedSpeech>>()
    .mockResolvedValue({ audio: new Uint8Array([1, 2, 3]), mediaType: "audio/mpeg" });
  const powerpoint = {
    saveNotes: vi
      .fn<(filePath: string, slides: SlideNotesEntry[]) => Promise<BasicPptResult>>()
      .mockResolvedValue({ success: true }),
    insertAudio: vi
      .fn<(filePath: string, slidesAudio: SlideAudioEntry[]) => Promise<BasicPptResult>>()
      .mockResolvedValue({ success: true }),
    removeAudio: vi
      .fn<(filePath: string, slideIndices: number[]) => Promise<BasicPptResult>>()
      .mockResolvedValue({ success: true }),
  } satisfies NarrationPowerPoint;

  registerNarrationIpc(
    {
      handle: (channel: string, handler: IpcHandler) => {
        handlers.set(channel, handler);
      },
      removeHandler: (channel: string) => handlers.delete(channel),
    },
    {
      mappingSource: { getSpeakerMappings: () => mappings },
      synthesizer: { supportsProvider: () => true, generateSpeech },
      getPowerPoint: () => powerpoint,
    },
  );

  return { handlers, generateSpeech, powerpoint };
}

const event = {
  sender: { send: vi.fn<(channel: string, ...args: unknown[]) => void>() },
} as unknown as IpcMainInvokeEvent;

it("formats the submitted structured sections only as PowerPoint takes them", async () => {
  const { handlers, generateSpeech, powerpoint } = registerNarrationHandlers();

  const result = (await handlers.get("save-narrated-presentation")!(event, {
    filePath: presentationPath,
    slides: [
      {
        slideIndex: toSlideIndex(1),
        // Section text holding a separator line, a prompt marker written with
        // the author's own spacing, and a second section prove the sections
        // cross unchanged: reparsing anywhere would split the first section and
        // move the narration positions out from under the audio.
        sections: [
          {
            speaker: "Narrator",
            prompt: "wearily",
            text: "First\n---\nstill the first section",
            format: { speakerPrefix: "  [ ", speakerSuffix: " ]  ", promptPrefix: "[p: " },
          },
          { speaker: "", text: "Second", format: { separatorBefore: "\n-----\n" } },
        ],
      },
    ],
    progressChannel: "narrated-presentation-save-progress:1",
  } as never)) as NarratedSaveResult;

  expect(result).toEqual({ success: true });
  expect(generateSpeech.mock.calls).toEqual([
    ["First\n---\nstill the first section", narratorVoice, "wearily"],
    ["Second", narratorVoice, undefined],
  ]);
  expect(powerpoint.saveNotes).toHaveBeenCalledWith(presentationPath, [
    {
      slideIndex: 1,
      notes: "  [ Narrator ]  \n[p: wearily]\nFirst\n---\nstill the first section\n-----\nSecond",
    },
  ]);
  expect(powerpoint.insertAudio).toHaveBeenCalledWith(presentationPath, [
    { slideIndex: 1, sectionIndex: 0, audioData: new Uint8Array([1, 2, 3]) },
    { slideIndex: 1, sectionIndex: 1, audioData: new Uint8Array([1, 2, 3]) },
  ]);
  expect(powerpoint.saveNotes.mock.invocationCallOrder[0]).toBeLessThan(
    powerpoint.insertAudio.mock.invocationCallOrder[0]!,
  );
});
