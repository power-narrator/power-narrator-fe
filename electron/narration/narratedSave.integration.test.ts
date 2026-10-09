import { toSlideIndex } from "../../shared/slides/slideCoordinates.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

/**
 * Slide media by name, changed the way the PowerPoint provider contract
 * describes: a slide's audio entries are its complete section audio.
 */
class FakeDeck implements NarrationPowerPoint {
  constructor(readonly media: Map<number, string[]>) {}

  saveNotes(): Promise<BasicPptResult> {
    return Promise.resolve({ success: true });
  }

  insertAudio(_filePath: string, slidesAudio: SlideAudioEntry[]): Promise<BasicPptResult> {
    for (const slideIndex of new Set(slidesAudio.map((entry) => entry.slideIndex))) {
      const sectionAudio = slidesAudio
        .filter((entry) => entry.slideIndex === slideIndex)
        .map((entry) => `ppt_audio_${entry.sectionIndex + 1}`);
      const otherMedia = (this.media.get(slideIndex) ?? []).filter(
        (name) => !/^ppt_audio_\d+$/.test(name),
      );
      this.media.set(slideIndex, [...otherMedia, ...sectionAudio]);
    }
    return Promise.resolve({ success: true });
  }

  removeAudio(_filePath: string, slideIndices: number[]): Promise<BasicPptResult> {
    for (const slideIndex of slideIndices) {
      this.media.set(
        slideIndex,
        (this.media.get(slideIndex) ?? []).filter((name) => !name.startsWith("ppt_audio")),
      );
    }
    return Promise.resolve({ success: true });
  }
}

function registerNarrationHandlers(deck?: FakeDeck) {
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
      getPowerPoint: () => deck ?? powerpoint,
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
            playAcrossSlides: false,
            format: { speakerPrefix: "  [ ", speakerSuffix: " ]  ", promptPrefix: "[p: " },
          },
          {
            speaker: "",
            text: "Second",
            playAcrossSlides: false,
            format: { separatorBefore: "\n-----\n" },
          },
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
    {
      slideIndex: 1,
      sectionIndex: 0,
      audioData: new Uint8Array([1, 2, 3]),
      playAcrossSlides: false,
    },
    {
      slideIndex: 1,
      sectionIndex: 1,
      audioData: new Uint8Array([1, 2, 3]),
      playAcrossSlides: false,
    },
  ]);
  expect(powerpoint.saveNotes.mock.invocationCallOrder[0]).toBeLessThan(
    powerpoint.insertAudio.mock.invocationCallOrder[0]!,
  );
});

it("asks PowerPoint for each section's submitted playback, which speech never sees", async () => {
  const { handlers, generateSpeech, powerpoint } = registerNarrationHandlers();

  const result = await handlers.get("save-narrated-slide")!(event, {
    filePath: presentationPath,
    slideIndex: toSlideIndex(1),
    sections: [
      { speaker: "Narrator", text: "First", playAcrossSlides: true },
      { speaker: "", text: " ", playAcrossSlides: true },
      { speaker: "", text: "Third", playAcrossSlides: false },
      { speaker: "", text: "Fourth", playAcrossSlides: false },
      { speaker: "", text: "Fifth", playAcrossSlides: true },
    ],
  } as never);

  expect(result).toEqual({ success: true });
  expect(
    powerpoint.insertAudio.mock.calls[0]![1].map(({ sectionIndex, playAcrossSlides }) => ({
      sectionIndex,
      playAcrossSlides,
    })),
  ).toEqual([
    { sectionIndex: 0, playAcrossSlides: true },
    { sectionIndex: 2, playAcrossSlides: false },
    { sectionIndex: 3, playAcrossSlides: false },
    { sectionIndex: 4, playAcrossSlides: true },
  ]);
  expect(generateSpeech.mock.calls).toEqual([
    ["First", narratorVoice, undefined],
    ["Third", narratorVoice, undefined],
    ["Fourth", narratorVoice, undefined],
    ["Fifth", narratorVoice, undefined],
  ]);
});

describe("saving removes obsolete section audio", () => {
  const narrated = (...texts: string[]) =>
    texts.map((text) => ({ speaker: "Narrator", text, playAcrossSlides: false }));

  it.each([
    {
      change: "deleting the last section",
      before: ["ppt_audio_1", "ppt_audio_2", "Background music"],
      sections: narrated("First"),
      after: ["Background music", "ppt_audio_1"],
    },
    {
      change: "deleting an earlier section, renumbering the survivors",
      before: ["ppt_audio_1", "ppt_audio_2", "ppt_audio_3", "Background music"],
      sections: narrated("Second", "Third"),
      after: ["Background music", "ppt_audio_1", "ppt_audio_2"],
    },
    {
      change: "emptying a section while a later section keeps its narration",
      before: ["ppt_audio_1", "ppt_audio_2", "Background music"],
      sections: narrated("", "Second"),
      after: ["Background music", "ppt_audio_2"],
    },
    {
      change: "emptying every section",
      before: ["ppt_audio_1", "Background music"],
      sections: narrated(" "),
      after: ["Background music"],
    },
  ])("after $change", async ({ before, sections, after }) => {
    const deck = new FakeDeck(
      new Map([
        [1, before],
        [2, ["ppt_audio_1", "ppt_audio_2"]],
      ]),
    );
    const { handlers } = registerNarrationHandlers(deck);

    const result = await handlers.get("save-narrated-slide")!(event, {
      filePath: presentationPath,
      slideIndex: toSlideIndex(1),
      sections,
    } as never);

    expect(result).toEqual({ success: true });
    expect(deck.media.get(1)!.toSorted()).toEqual(after);
    expect(deck.media.get(2)).toEqual(["ppt_audio_1", "ppt_audio_2"]);
  });
});
