import { expect, it, vi } from "vitest";
import type { IpcMainInvokeEvent } from "electron";
import type { NarrationPreviewResult } from "../../shared/types/narration.js";
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

function registerNarrationHandlers() {
  const handlers = new Map<string, IpcHandler>();
  const generateSpeech = vi
    .fn<(text: string, voice: Voice, prompt?: string) => Promise<SynthesizedSpeech>>()
    .mockResolvedValue({ audio: new Uint8Array([1, 2, 3]), mediaType: "audio/mpeg" });

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
      getPowerPoint: (): NarrationPowerPoint => {
        throw new Error("Preview never reaches PowerPoint");
      },
    },
    { holdWindowOpen: (_webContentsId, run) => run() },
  );

  return { handlers, generateSpeech };
}

const event = {} as IpcMainInvokeEvent;

it("narrates a preview from the structured sections the request carried", async () => {
  const { handlers, generateSpeech } = registerNarrationHandlers();

  const preview = (await handlers.get("prepare-narration-preview")!(event, {
    slideIndex: 2,
    sectionIndex: 1,
    // Section text holding a separator line proves the sections are used as
    // given: formatting and reparsing them would split the first section and
    // move the previewed one out from under its position.
    sections: [
      { speaker: "Narrator", text: "First\n---\nstill the first section", playAcrossSlides: false },
      { speaker: "", prompt: "wearily", text: "Second", playAcrossSlides: false },
    ],
    text: "Second",
    speakerChoice: { kind: "effective" },
  } as never)) as NarrationPreviewResult;

  expect(generateSpeech).toHaveBeenCalledWith("Second", narratorVoice, "wearily");
  expect(preview).toEqual({ audio: new Uint8Array([1, 2, 3]), mediaType: "audio/mpeg" });
});
