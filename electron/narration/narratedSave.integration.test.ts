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

type HeldWrite = {
  resolve: (result: BasicPptResult) => void;
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
  const writesToHold = new Set<string>();
  const heldWrites = new Map<string, HeldWrite>();
  const scriptedWrites = new Map<string, BasicPptResult | Error>();
  const write = (label: string): Promise<BasicPptResult> => {
    externalWork.push(label);
    if (writesToHold.has(label)) {
      return new Promise((resolve, reject) => heldWrites.set(label, { resolve, reject }));
    }
    const scripted = scriptedWrites.get(label) ?? { success: true };
    return scripted instanceof Error ? Promise.reject(scripted) : Promise.resolve(scripted);
  };
  const powerpoint = {
    saveNotes: vi
      .fn<(filePath: string, slides: SlideNotesEntry[]) => Promise<BasicPptResult>>()
      .mockImplementation((_filePath, slides) =>
        write(`save notes ${slides.map((slide) => slide.slideIndex).join()}`),
      ),
    insertAudio: vi
      .fn<(filePath: string, slidesAudio: SlideAudioEntry[]) => Promise<BasicPptResult>>()
      .mockImplementation((_filePath, slidesAudio) =>
        write(`insert audio ${[...new Set(slidesAudio.map((audio) => audio.slideIndex))].join()}`),
      ),
    removeAudio: vi
      .fn<(filePath: string, slideIndices: number[]) => Promise<BasicPptResult>>()
      .mockImplementation((_filePath, slideIndices) =>
        write(`remove audio ${slideIndices.join()}`),
      ),
  } satisfies NarrationPowerPoint;

  const heldSpeech = new Map<string, HeldSpeech>();
  const holdSpeech = (shouldHold: (text: string) => boolean = () => true) =>
    generateSpeech.mockImplementation((text) => {
      externalWork.push(`synthesize ${text}`);
      if (!shouldHold(text)) {
        return Promise.resolve({ audio: new Uint8Array([1]), mediaType: "audio/mpeg" });
      }
      return new Promise<SynthesizedSpeech>((resolve, reject) => {
        heldSpeech.set(text, {
          resolve: (audio) => resolve({ audio, mediaType: "audio/mpeg" }),
          reject,
        });
      });
    });

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

  return {
    handlers,
    generateSpeech,
    powerpoint,
    externalWork,
    heldSpeech,
    holdSpeech,
    heldWrites,
    holdWrite: (label: string) => writesToHold.add(label),
    scriptWrite: (label: string, outcome: BasicPptResult | Error) =>
      scriptedWrites.set(label, outcome),
  };
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
  runId = 1,
) {
  return handlers.get("save-narrated-presentation")!(progressEvent, {
    filePath: presentationPath,
    slides: slides.map((slide) => ({ ...slide, slideIndex: toSlideIndex(slide.slideIndex) })),
    runId,
    progressChannel: `narrated-presentation-save-progress:${runId}`,
  } as never) as Promise<SaveAllRunResult>;
}

function cancelRun(handlers: Map<string, IpcHandler>, runId = 1, cancelEvent = event) {
  return handlers.get("cancel-narrated-presentation-save")!(cancelEvent, runId as never);
}

const flushPromises = () => new Promise((resolve) => setTimeout(resolve, 0));

const event = {
  sender: { id: 1, send: vi.fn<(channel: string, ...args: unknown[]) => void>() },
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

it("waits for every active section request after cancellation and leaves the generating slide unchanged", async () => {
  const { handlers, externalWork, heldSpeech, holdSpeech } = registerNarrationHandlers();
  holdSpeech((text) => text !== "Zero");

  let settled = false;
  const saving = saveAll(handlers, [
    { slideIndex: 0, sections: [narrator("Zero")] },
    { slideIndex: 1, sections: [narrator("One first"), narrator("One second")] },
    { slideIndex: 2, sections: [narrator("Two")] },
  ]).finally(() => {
    settled = true;
  });
  await vi.waitFor(() => expect(heldSpeech.size).toBe(2));

  await cancelRun(handlers);
  await cancelRun(handlers);
  heldSpeech.get("One second")!.resolve(new Uint8Array([2]));
  await flushPromises();
  expect(settled).toBe(false);
  heldSpeech.get("One first")!.resolve(new Uint8Array([1]));

  await expect(saving).resolves.toEqual({
    outcome: { success: false, stage: "cancelled" },
    savedNoteSlides: [0],
  });
  expect(externalWork).toEqual([
    "synthesize Zero",
    "save notes 0",
    "insert audio 0",
    "synthesize One first",
    "synthesize One second",
  ]);
});

for (const cancelDuring of [
  {
    write: "save notes 0",
    sections: [narrator("Zero")],
    expectedWork: ["synthesize Zero", "save notes 0", "insert audio 0"],
  },
  {
    write: "insert audio 0",
    sections: [narrator("Zero")],
    expectedWork: ["synthesize Zero", "save notes 0", "insert audio 0"],
  },
  {
    write: "remove audio 0",
    sections: [narrator(" ")],
    expectedWork: ["save notes 0", "remove audio 0"],
  },
]) {
  it(`finishes the slide's save sequence when cancelled during "${cancelDuring.write}" and starts no later slide`, async () => {
    const { handlers, externalWork, heldWrites, holdWrite } = registerNarrationHandlers();
    holdWrite(cancelDuring.write);

    const saving = saveAll(handlers, [
      { slideIndex: 0, sections: cancelDuring.sections },
      { slideIndex: 1, sections: [narrator("One")] },
    ]);
    await vi.waitFor(() => expect(heldWrites.has(cancelDuring.write)).toBe(true));
    await cancelRun(handlers);
    heldWrites.get(cancelDuring.write)!.resolve({ success: true });

    await expect(saving).resolves.toEqual({
      outcome: { success: false, stage: "cancelled" },
      savedNoteSlides: [0],
    });
    expect(externalWork).toEqual(cancelDuring.expectedWork);
  });
}

it("ignores cancellation meant for an earlier run or another window", async () => {
  const { handlers, heldSpeech, holdSpeech } = registerNarrationHandlers();
  await saveAll(handlers, [{ slideIndex: 0, sections: [narrator("Earlier")] }], event, 1);
  holdSpeech();

  const saving = saveAll(handlers, [{ slideIndex: 0, sections: [narrator("Later")] }], event, 2);
  await vi.waitFor(() => expect(heldSpeech.size).toBe(1));
  await cancelRun(handlers, 1);
  await cancelRun(handlers, 2, { sender: { id: 2 } } as unknown as IpcMainInvokeEvent);
  heldSpeech.get("Later")!.resolve(new Uint8Array([1]));

  await expect(saving).resolves.toEqual({ outcome: { success: true }, savedNoteSlides: [0] });
});

it("writes nothing for a slide whose section fails and ends only after its sibling requests settle", async () => {
  const { handlers, externalWork, heldSpeech, holdSpeech } = registerNarrationHandlers();
  holdSpeech();

  let settled = false;
  const saving = saveAll(handlers, [
    {
      slideIndex: 3,
      sections: [
        narrator("First"),
        { speaker: "", text: "Second", playAcrossSlides: false },
        narrator("Third"),
      ],
    },
    { slideIndex: 4, sections: [narrator("Later")] },
  ]).finally(() => {
    settled = true;
  });
  await vi.waitFor(() => expect(heldSpeech.size).toBe(3));

  heldSpeech.get("Second")!.reject(new Error("quota exhausted"));
  heldSpeech.get("First")!.resolve(new Uint8Array([1]));
  await flushPromises();
  expect(settled).toBe(false);
  heldSpeech.get("Third")!.resolve(new Uint8Array([3]));

  const result = await saving;
  expect(result).toEqual({
    outcome: {
      success: false,
      stage: "synthesis",
      partial: false,
      message:
        'Narration synthesis failed for slide 4, section 2, speaker "Narrator": quota exhausted.',
    },
    savedNoteSlides: [],
    failedSlideIndex: 3,
  });
  expect(externalWork).toEqual(["synthesize First", "synthesize Second", "synthesize Third"]);
});

for (const failure of [
  {
    name: "a reported notes failure",
    write: "save notes 1",
    outcome: { success: false, message: "notes locked" },
    partial: false,
    savedNoteSlides: [0],
    work: ["save notes 1"],
  },
  {
    name: "a thrown notes failure",
    write: "save notes 1",
    outcome: new Error("PowerPoint closed"),
    partial: false,
    savedNoteSlides: [0],
    work: ["save notes 1"],
  },
  {
    name: "a reported audio failure after the notes saved",
    write: "insert audio 1",
    outcome: { success: false, message: "media rejected" },
    partial: true,
    savedNoteSlides: [0, 1],
    work: ["save notes 1", "insert audio 1"],
  },
  {
    name: "a thrown audio failure after the notes saved",
    write: "insert audio 1",
    outcome: new Error("PowerPoint closed"),
    partial: true,
    savedNoteSlides: [0, 1],
    work: ["save notes 1", "insert audio 1"],
  },
  {
    name: "a stale-audio removal failure after the notes saved",
    write: "remove audio 1",
    outcome: { success: false, message: "shape locked" },
    partial: true,
    savedNoteSlides: [0, 1],
    work: ["save notes 1", "remove audio 1"],
  },
] as const) {
  it(`stops at ${failure.name} on a later slide and keeps the earlier slide saved`, async () => {
    const { handlers, externalWork, scriptWrite } = registerNarrationHandlers();
    scriptWrite(failure.write, failure.outcome);

    const result = await saveAll(handlers, [
      { slideIndex: 0, sections: [narrator("Zero")] },
      {
        slideIndex: 1,
        sections: [narrator(failure.write === "remove audio 1" ? " " : "One")],
      },
      { slideIndex: 2, sections: [narrator("Two")] },
    ]);

    expect(result).toEqual({
      outcome: {
        success: false,
        stage: "powerpoint",
        partial: failure.partial,
        message: failure.outcome.message,
      },
      savedNoteSlides: failure.savedNoteSlides,
      failedSlideIndex: 1,
    });
    expect(externalWork.filter((work) => !work.endsWith("One"))).toEqual([
      "synthesize Zero",
      "save notes 0",
      "insert audio 0",
      ...failure.work,
    ]);
  });
}

it("reports a write failure met while cancelling as a PowerPoint failure, not a cancellation", async () => {
  const { handlers, heldWrites, holdWrite } = registerNarrationHandlers();
  holdWrite("insert audio 0");

  const saving = saveAll(handlers, [
    { slideIndex: 0, sections: [narrator("Zero")] },
    { slideIndex: 1, sections: [narrator("One")] },
  ]);
  await vi.waitFor(() => expect(heldWrites.has("insert audio 0")).toBe(true));
  await cancelRun(handlers);
  heldWrites.get("insert audio 0")!.resolve({ success: false, message: "media rejected" });

  await expect(saving).resolves.toEqual({
    outcome: { success: false, stage: "powerpoint", partial: true, message: "media rejected" },
    savedNoteSlides: [0],
    failedSlideIndex: 0,
  });
});
