import { toSlideIndex } from "../../shared/slides/slideCoordinates.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { IpcMainInvokeEvent } from "electron";
import type { NarrationSection } from "../../shared/narration/NarrationSections.js";
import type { SaveAllRunResult } from "../../shared/types/narration.js";
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

const isSectionAudioName = (name: string) => /^ppt_audio_[1-9]\d*$/.test(name);

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
        (name) => !isSectionAudioName(name),
      );
      this.media.set(slideIndex, [...otherMedia, ...sectionAudio]);
    }
    return Promise.resolve({ success: true });
  }

  removeAudio(_filePath: string, slideIndices: number[]): Promise<BasicPptResult> {
    for (const slideIndex of slideIndices) {
      this.media.set(
        slideIndex,
        (this.media.get(slideIndex) ?? []).filter((name) => !isSectionAudioName(name)),
      );
    }
    return Promise.resolve({ success: true });
  }
}

type HeldSpeech = {
  resolve: (audio: Uint8Array) => void;
  reject: (error: Error) => void;
};

function registerNarrationHandlers(deck?: FakeDeck) {
  const handlers = new Map<string, IpcHandler>();
  const externalWork: string[] = [];
  const generateSpeech = vi
    .fn<(text: string, voice: Voice, prompt?: string) => Promise<SynthesizedSpeech>>()
    .mockImplementation((text) => {
      externalWork.push(`synthesize ${text}`);
      return Promise.resolve({ audio: new Uint8Array([1, 2, 3]), mediaType: "audio/mpeg" });
    });
  const powerpoint = {
    saveNotes: vi
      .fn<(filePath: string, slides: SlideNotesEntry[]) => Promise<BasicPptResult>>()
      .mockImplementation((_filePath, slides) => {
        externalWork.push(`save notes ${slides.map((slide) => slide.slideIndex).join()}`);
        return Promise.resolve({ success: true });
      }),
    insertAudio: vi
      .fn<(filePath: string, slidesAudio: SlideAudioEntry[]) => Promise<BasicPptResult>>()
      .mockImplementation((_filePath, slidesAudio) => {
        externalWork.push(
          `insert audio ${[...new Set(slidesAudio.map((audio) => audio.slideIndex))].join()}`,
        );
        return Promise.resolve({ success: true });
      }),
    removeAudio: vi
      .fn<(filePath: string, slideIndices: number[]) => Promise<BasicPptResult>>()
      .mockImplementation((_filePath, slideIndices) => {
        externalWork.push(`remove audio ${slideIndices.join()}`);
        return Promise.resolve({ success: true });
      }),
  } satisfies NarrationPowerPoint;

  const heldSpeech = new Map<string, HeldSpeech>();
  const holdSpeech = () =>
    generateSpeech.mockImplementation(
      (text) =>
        new Promise<SynthesizedSpeech>((resolve, reject) => {
          externalWork.push(`synthesize ${text}`);
          heldSpeech.set(text, {
            resolve: (audio) => resolve({ audio, mediaType: "audio/mpeg" }),
            reject,
          });
        }),
    );

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
    { holdWindowOpen: (_webContentsId, run) => run() },
  );

  return { handlers, generateSpeech, powerpoint, externalWork, heldSpeech, holdSpeech };
}

const narrator = (text: string): NarrationSection => ({
  speaker: "Narrator",
  text,
  playAcrossSlides: false,
});

function saveAll(
  handlers: Map<string, IpcHandler>,
  slides: Array<{ slideIndex: number; sections: NarrationSection[] }>,
  progressEvent = event,
) {
  return handlers.get("save-narrated-presentation")!(progressEvent, {
    filePath: presentationPath,
    slides: slides.map((slide) => ({ ...slide, slideIndex: toSlideIndex(slide.slideIndex) })),
    progressChannel: "narrated-presentation-save-progress:1",
  } as never) as Promise<SaveAllRunResult>;
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
  } as never)) as SaveAllRunResult;

  expect(result).toEqual({ outcome: { success: true }, savedNoteSlides: [1] });
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
      before: [
        "ppt_audio_1",
        "ppt_audio_2",
        "Background music",
        "ppt_audio_0",
        "ppt_audio_01",
        "ppt_audio_background",
      ],
      sections: narrated("First"),
      after: [
        "Background music",
        "ppt_audio_0",
        "ppt_audio_01",
        "ppt_audio_1",
        "ppt_audio_background",
      ],
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
      before: [
        "ppt_audio_1",
        "Background music",
        "ppt_audio_0",
        "ppt_audio_01",
        "ppt_audio_background",
      ],
      sections: narrated(" "),
      after: ["Background music", "ppt_audio_0", "ppt_audio_01", "ppt_audio_background"],
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

it("generates the active slide's sections in parallel and saves that slide before the next starts", async () => {
  const { handlers, powerpoint, externalWork, heldSpeech, holdSpeech } =
    registerNarrationHandlers();
  holdSpeech();

  const saving = saveAll(handlers, [
    { slideIndex: 4, sections: [narrator("Four first"), narrator("Four second")] },
    { slideIndex: 9, sections: [narrator("Nine only")] },
  ]);

  await vi.waitFor(() => expect(heldSpeech.size).toBe(2));
  expect(externalWork).toEqual(["synthesize Four first", "synthesize Four second"]);

  heldSpeech.get("Four second")!.resolve(new Uint8Array([2]));
  heldSpeech.get("Four first")!.resolve(new Uint8Array([1]));
  await vi.waitFor(() => expect(heldSpeech.size).toBe(3));

  expect(externalWork).toEqual([
    "synthesize Four first",
    "synthesize Four second",
    "save notes 4",
    "insert audio 4",
    "synthesize Nine only",
  ]);
  expect(powerpoint.saveNotes).toHaveBeenCalledWith(presentationPath, [
    { slideIndex: 4, notes: "[Narrator]\nFour first\n---\n[Narrator]\nFour second" },
  ]);
  expect(powerpoint.insertAudio).toHaveBeenCalledWith(presentationPath, [
    { slideIndex: 4, sectionIndex: 0, audioData: new Uint8Array([1]), playAcrossSlides: false },
    { slideIndex: 4, sectionIndex: 1, audioData: new Uint8Array([2]), playAcrossSlides: false },
  ]);

  heldSpeech.get("Nine only")!.resolve(new Uint8Array([9]));

  await expect(saving).resolves.toEqual({ outcome: { success: true }, savedNoteSlides: [4, 9] });
  expect(externalWork.slice(5)).toEqual(["save notes 9", "insert audio 9"]);
});

it("reports each slide's position in the run and its generating and saving phases", async () => {
  const { handlers } = registerNarrationHandlers();
  const send = vi.fn<(channel: string, ...args: unknown[]) => void>();

  await saveAll(
    handlers,
    [
      { slideIndex: 6, sections: [narrator("Six")] },
      { slideIndex: 2, sections: [narrator("Two")] },
    ],
    { sender: { send } } as unknown as IpcMainInvokeEvent,
  );

  expect(send.mock.calls).toEqual([
    [
      "narrated-presentation-save-progress:1",
      { slideIndex: 6, completedSlides: 0, totalSlides: 2, phase: "generating" },
    ],
    [
      "narrated-presentation-save-progress:1",
      { slideIndex: 6, completedSlides: 0, totalSlides: 2, phase: "saving" },
    ],
    [
      "narrated-presentation-save-progress:1",
      { slideIndex: 2, completedSlides: 1, totalSlides: 2, phase: "generating" },
    ],
    [
      "narrated-presentation-save-progress:1",
      { slideIndex: 2, completedSlides: 1, totalSlides: 2, phase: "saving" },
    ],
  ]);
});

it("rejects an unmapped speaker on a later slide before any synthesis or PowerPoint write", async () => {
  const { handlers, externalWork } = registerNarrationHandlers();

  const result = await saveAll(handlers, [
    { slideIndex: 0, sections: [narrator("Valid")] },
    { slideIndex: 1, sections: [{ speaker: "Missing", text: "Invalid", playAcrossSlides: false }] },
  ]);

  expect(result).toMatchObject({
    outcome: { success: false, stage: "validation", partial: false },
    savedNoteSlides: [],
  });
  expect(externalWork).toEqual([]);
});

it("saves the notes of a slide without narration and removes its stale audio", async () => {
  const { handlers, externalWork, powerpoint } = registerNarrationHandlers();

  const result = await saveAll(handlers, [
    { slideIndex: 3, sections: [{ speaker: "Narrator", text: "  ", playAcrossSlides: false }] },
    { slideIndex: 5, sections: [narrator("Five")] },
  ]);

  expect(result).toEqual({ outcome: { success: true }, savedNoteSlides: [3, 5] });
  expect(externalWork).toEqual([
    "save notes 3",
    "remove audio 3",
    "synthesize Five",
    "save notes 5",
    "insert audio 5",
  ]);
  expect(powerpoint.saveNotes).toHaveBeenNthCalledWith(1, presentationPath, [
    { slideIndex: 3, notes: "[Narrator]\n  " },
  ]);
});

it("keeps earlier saved slides and leaves later slides untouched when a slide fails to generate", async () => {
  const { handlers, externalWork, generateSpeech } = registerNarrationHandlers();
  generateSpeech.mockImplementation((text) => {
    externalWork.push(`synthesize ${text}`);
    return text === "Two"
      ? Promise.reject(new Error("quota exhausted"))
      : Promise.resolve({ audio: new Uint8Array([1]), mediaType: "audio/mpeg" });
  });

  const result = await saveAll(handlers, [
    { slideIndex: 0, sections: [narrator("One")] },
    { slideIndex: 1, sections: [narrator("Two")] },
    { slideIndex: 2, sections: [narrator("Three")] },
  ]);

  expect(result).toMatchObject({
    outcome: { success: false, stage: "synthesis" },
    savedNoteSlides: [0],
  });
  expect(result.outcome).toHaveProperty("message", expect.stringContaining("slide 2, section 1"));
  expect(externalWork).toEqual([
    "synthesize One",
    "save notes 0",
    "insert audio 0",
    "synthesize Two",
  ]);
});
