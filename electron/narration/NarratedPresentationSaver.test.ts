import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BasicPptResult, SlideAudioEntry, SlideNotesEntry } from "../platform/types.js";
import { TtsManager } from "../tts/TtsManager.js";
import type { SpeakerMapping, SynthesizedSpeech, TtsProvider, Voice } from "../tts/TtsProvider.js";
import type { NarrationPreparationProgress } from "../../shared/types/narration.js";
import { NarrationPreparation } from "./NarrationPreparation.js";
import { NarratedPresentationSaver } from "./NarratedPresentationSaver.js";

const narratorVoice: Voice = {
  provider: "gcp",
  voiceId: "Narrator",
  model: "chirp-3-hd",
  languageCode: "en-US",
  supportsPrompt: false,
};

const alternateNarratorVoice: Voice = {
  ...narratorVoice,
  languageCode: "en-GB",
};

const temporaryDirectories: string[] = [];

class FakePowerPointAdapter {
  readonly committedNotes = new Map<number, string>();
  readonly insertedAudio = new Map<number, Map<number, Uint8Array>>();
  readonly removedAudio = new Set<number>();
  notesResult: BasicPptResult = { success: true };
  audioResults: BasicPptResult[] = [{ success: true }];
  removeResult: BasicPptResult = { success: true };

  readonly saveNotes = vi.fn<
    (filePath: string, slides: SlideNotesEntry[]) => Promise<BasicPptResult>
  >((_filePath, slides) => {
    if (this.notesResult.success) {
      for (const slide of slides) {
        this.committedNotes.set(slide.index, slide.notes);
      }
    }
    return Promise.resolve(this.notesResult);
  });

  readonly insertAudio = vi.fn<
    (filePath: string, slidesAudio: SlideAudioEntry[]) => Promise<BasicPptResult>
  >((_filePath, slidesAudio) => {
    const result = this.audioResults.shift() ?? { success: true as const };
    if (result.success) {
      for (const audio of slidesAudio) {
        const slideAudio = this.insertedAudio.get(audio.index) ?? new Map<number, Uint8Array>();
        slideAudio.set(audio.sectionIndex, audio.audioData);
        this.insertedAudio.set(audio.index, slideAudio);
        this.removedAudio.delete(audio.index);
      }
    }
    return Promise.resolve(result);
  });

  readonly removeAudio = vi.fn<
    (filePath: string, slideIndices: number[]) => Promise<BasicPptResult>
  >((_filePath, slideIndices) => {
    if (this.removeResult.success) {
      for (const slideIndex of slideIndices) {
        this.removedAudio.add(slideIndex);
        this.insertedAudio.delete(slideIndex);
      }
    }
    return Promise.resolve(this.removeResult);
  });
}

function expectNoPowerPointMutation(powerpoint: FakePowerPointAdapter) {
  expect({
    notes: [...powerpoint.committedNotes],
    audio: [...powerpoint.insertedAudio],
    removedAudio: [...powerpoint.removedAudio],
  }).toEqual({ notes: [], audio: [], removedAudio: [] });
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

function createSaver(
  generateSpeech = vi
    .fn<(text: string, voice: Voice) => Promise<SynthesizedSpeech>>()
    .mockResolvedValue({ audio: new Uint8Array([1]), mediaType: "audio/mpeg" }),
) {
  const preparation = new NarrationPreparation(
    { getSpeakerMappings: () => ({ Narrator: { voice: narratorVoice } }) },
    { supportsProvider: () => true, generateSpeech },
  );
  const powerpoint = new FakePowerPointAdapter();

  return {
    generateSpeech,
    powerpoint,
    saver: new NarratedPresentationSaver(preparation, () => powerpoint),
  };
}

function createCachedRetrySaver(
  getSpeakerMappings: () => Record<string, SpeakerMapping> = () => ({
    Narrator: { voice: narratorVoice },
  }),
) {
  const cacheDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "power-narrator-save-retry-"));
  temporaryDirectories.push(cacheDirectory);
  const synthesize = vi
    .fn<() => Promise<Uint8Array>>()
    .mockResolvedValue(new Uint8Array([4, 5, 6]));
  const provider: TtsProvider = {
    getVoices: vi.fn<TtsProvider["getVoices"]>().mockResolvedValue([]),
    prepareSpeech: (text, voice) => ({
      cacheIdentity: { text, voice: `${voice.languageCode}-${voice.voiceId}` },
      synthesize,
    }),
  };
  const preparation = new NarrationPreparation(
    { getSpeakerMappings },
    new TtsManager(new Map([["gcp", provider]]), cacheDirectory),
  );
  const powerpoint = new FakePowerPointAdapter();
  powerpoint.audioResults = [
    { success: false, message: "audio automation failed" },
    { success: true },
  ];

  return {
    synthesize,
    powerpoint,
    saver: new NarratedPresentationSaver(preparation, () => powerpoint),
  };
}

describe("NarratedPresentationSaver", () => {
  it("removes stale narration before succeeding when a slide has no narratable text", async () => {
    const { generateSpeech, powerpoint, saver } = createSaver();

    await expect(
      saver.savePresentation({
        filePath: "/slides/talk.pptx",
        slides: [{ slideIndex: 4, notes: "[Narrator]\n  \n---\n\t" }],
      }),
    ).resolves.toEqual({ success: true });

    expect(generateSpeech).not.toHaveBeenCalled();
    expect(powerpoint.committedNotes).toEqual(new Map([[4, "[Narrator]\n  \n---\n\t"]]));
    expect(powerpoint.removedAudio).toEqual(new Set([4]));
    expect(powerpoint.insertedAudio).toEqual(new Map());
    expect(powerpoint.saveNotes.mock.invocationCallOrder[0]).toBeLessThan(
      powerpoint.removeAudio.mock.invocationCallOrder[0]!,
    );
  });

  it("reports a partial PowerPoint failure when stale narration cannot be removed", async () => {
    const { powerpoint, saver } = createSaver();
    powerpoint.removeResult = { success: false, message: "remove failed" };

    await expect(
      saver.savePresentation({
        filePath: "/slides/talk.pptx",
        slides: [{ slideIndex: 4, notes: "  " }],
      }),
    ).resolves.toEqual({
      success: false,
      stage: "powerpoint",
      partial: true,
      message: "remove failed",
    });

    expect(powerpoint.committedNotes).toEqual(new Map([[4, "  "]]));
    expect(powerpoint.removedAudio).toEqual(new Set());
    expect(powerpoint.insertedAudio).toEqual(new Map());
  });

  it("preflights every requested slide before synthesis or PowerPoint mutation", async () => {
    const { generateSpeech, powerpoint, saver } = createSaver();

    await expect(
      saver.savePresentation({
        filePath: "/slides/talk.pptx",
        slides: [
          { slideIndex: 2, notes: "[Narrator]\nValid" },
          { slideIndex: 8, notes: "[Missing]\nInvalid" },
        ],
      }),
    ).resolves.toMatchObject({
      success: false,
      stage: "validation",
      partial: false,
    });
    expect(generateSpeech).not.toHaveBeenCalled();
    expectNoPowerPointMutation(powerpoint);
  });

  it("reports eligible completion while preserving request order after parallel synthesis", async () => {
    const pending = new Map<string, (audio: Uint8Array) => void>();
    const generateSpeech = vi.fn<(text: string, voice: Voice) => Promise<SynthesizedSpeech>>(
      (text) =>
        new Promise<{ audio: Uint8Array; mediaType: string }>((resolve) => {
          pending.set(text, (audio) => resolve({ audio, mediaType: "audio/mpeg" }));
        }),
    );
    const { powerpoint, saver } = createSaver(generateSpeech);
    const onProgress = vi.fn<(progress: NarrationPreparationProgress) => void>();
    const request = {
      filePath: "/slides/talk.pptx",
      slides: [
        {
          slideIndex: 9,
          notes: "[Narrator]\nNine first\n---\n[Missing]\n  \n---\n[Narrator]\nNine third",
        },
        { slideIndex: 3, notes: "[Narrator]\nThree first" },
      ],
    };

    const saving = saver.savePresentation(request, onProgress);
    await vi.waitFor(() => expect(pending.size).toBe(3));
    expect(generateSpeech).toHaveBeenCalledTimes(3);
    expectNoPowerPointMutation(powerpoint);

    pending.get("Three first")?.(new Uint8Array([3]));
    await vi.waitFor(() => expect(onProgress).toHaveBeenLastCalledWith({ completed: 1, total: 3 }));
    pending.get("Nine third")?.(new Uint8Array([2]));
    await vi.waitFor(() => expect(onProgress).toHaveBeenLastCalledWith({ completed: 2, total: 3 }));
    pending.get("Nine first")?.(new Uint8Array([1]));

    await expect(saving).resolves.toEqual({ success: true });
    expect(onProgress.mock.calls).toEqual([
      [{ completed: 1, total: 3 }],
      [{ completed: 2, total: 3 }],
      [{ completed: 3, total: 3 }],
    ]);
    expect(powerpoint.committedNotes).toEqual(
      new Map([
        [9, request.slides[0]!.notes],
        [3, request.slides[1]!.notes],
      ]),
    );
    expect(powerpoint.insertedAudio).toEqual(
      new Map([
        [
          9,
          new Map([
            [0, new Uint8Array([1])],
            [2, new Uint8Array([2])],
          ]),
        ],
        [3, new Map([[0, new Uint8Array([3])]])],
      ]),
    );
  });

  it("reports a structured synthesis failure without mutating PowerPoint", async () => {
    const { powerpoint, saver } = createSaver(
      vi.fn().mockRejectedValue(new Error("provider unavailable")),
    );

    await expect(
      saver.savePresentation({
        filePath: "/slides/talk.pptx",
        slides: [{ slideIndex: 5, notes: "[Narrator]\nHello" }],
      }),
    ).resolves.toMatchObject({ success: false, stage: "synthesis", partial: false });
    expectNoPowerPointMutation(powerpoint);
  });

  it("reports a structured preparation failure when speaker mappings cannot be read", async () => {
    const preparation = new NarrationPreparation(
      {
        getSpeakerMappings: () => {
          throw new Error("settings unavailable");
        },
      },
      {
        supportsProvider: () => true,
        generateSpeech: vi.fn<(text: string, voice: Voice) => Promise<SynthesizedSpeech>>(),
      },
    );
    const powerpoint = new FakePowerPointAdapter();
    const saver = new NarratedPresentationSaver(preparation, () => powerpoint);

    await expect(
      saver.savePresentation({
        filePath: "/slides/talk.pptx",
        slides: [{ slideIndex: 5, notes: "[Narrator]\nHello" }],
      }),
    ).resolves.toEqual({
      success: false,
      stage: "validation",
      partial: false,
      message: "settings unavailable",
    });
    expectNoPowerPointMutation(powerpoint);
  });

  it.each([
    ["notes", { success: false, message: "notes failed" }, { success: true }, false] as const,
    ["audio", { success: true }, { success: false, message: "audio failed" }, true] as const,
  ])(
    "reports a structured PowerPoint failure while committing %s",
    async (_, notesResult, audioResult, partial) => {
      const { powerpoint, saver } = createSaver();
      powerpoint.notesResult = notesResult;
      powerpoint.audioResults = [audioResult];

      await expect(
        saver.savePresentation({
          filePath: "/slides/talk.pptx",
          slides: [{ slideIndex: 2, notes: "[Narrator]\nHello" }],
        }),
      ).resolves.toEqual({
        success: false,
        stage: "powerpoint",
        partial,
        message: partial ? "audio failed" : "notes failed",
      });
      expect(powerpoint.committedNotes).toEqual(
        partial ? new Map([[2, "[Narrator]\nHello"]]) : new Map(),
      );
      expect(powerpoint.insertedAudio).toEqual(new Map());
      expect(powerpoint.removedAudio).toEqual(new Set());
    },
  );

  it("reuses prepared narration when an ordinary retry follows a partial PowerPoint failure", async () => {
    const { powerpoint, saver, synthesize } = createCachedRetrySaver();
    const request = {
      filePath: "/slides/talk.pptx",
      slides: [{ slideIndex: 2, notes: "[Narrator]\nRetry me" }],
    };

    await expect(saver.savePresentation(request)).resolves.toEqual({
      success: false,
      stage: "powerpoint",
      partial: true,
      message: "audio automation failed",
    });
    await expect(saver.savePresentation(request)).resolves.toEqual({ success: true });

    expect(synthesize).toHaveBeenCalledTimes(1);
    expect(powerpoint.saveNotes).toHaveBeenCalledTimes(2);
    expect(powerpoint.insertAudio).toHaveBeenCalledTimes(2);
  });

  it("synthesizes a new cache identity when edited notes are retried", async () => {
    const { saver, synthesize } = createCachedRetrySaver();

    await saver.savePresentation({
      filePath: "/slides/talk.pptx",
      slides: [{ slideIndex: 2, notes: "[Narrator]\nBefore edit" }],
    });
    await saver.savePresentation({
      filePath: "/slides/talk.pptx",
      slides: [{ slideIndex: 2, notes: "[Narrator]\nAfter edit" }],
    });

    expect(synthesize).toHaveBeenCalledTimes(2);
  });

  it("synthesizes a new cache identity when speaker mappings change before retry", async () => {
    let mappedVoice = narratorVoice;
    const { saver, synthesize } = createCachedRetrySaver(() => ({
      Narrator: { voice: mappedVoice },
    }));
    const request = {
      filePath: "/slides/talk.pptx",
      slides: [{ slideIndex: 2, notes: "[Narrator]\nSame notes" }],
    };

    await saver.savePresentation(request);
    mappedVoice = alternateNarratorVoice;
    await saver.savePresentation(request);

    expect(synthesize).toHaveBeenCalledTimes(2);
  });

  it("saves the current slide as a single-slide presentation request", async () => {
    const { powerpoint, saver } = createSaver();

    await expect(
      saver.saveSlide({
        filePath: "/slides/talk.pptx",
        slideIndex: 7,
        notes: "[Narrator]\nOnly slide",
      }),
    ).resolves.toEqual({ success: true });

    expect(powerpoint.committedNotes).toEqual(new Map([[7, "[Narrator]\nOnly slide"]]));
    expect(powerpoint.insertedAudio).toEqual(new Map([[7, new Map([[0, new Uint8Array([1])]])]]));
  });
});
