import { toSlideIndex } from "../../shared/slides/slideCoordinates.js";
import { describe, expect, it, vi } from "vitest";
import type { BasicPptResult, SlideAudioEntry, SlideNotesEntry } from "../platform/types.js";
import type { SynthesizedSpeech, Voice } from "../tts/TtsProvider.js";
import { parseNarrationSections } from "../../shared/narration/NarrationSections.js";
import { NarrationPreparation } from "./NarrationPreparation.js";
import { NarratedPresentationSaver } from "./NarratedPresentationSaver.js";

const sections = (notes: string, knownSpeakers: string[] = ["Narrator"]) =>
  parseNarrationSections(notes, knownSpeakers).map((section) => ({
    ...section,
    playAcrossSlides: false,
  }));

const narratorVoice: Voice = {
  provider: "gcp",
  voiceId: "Narrator",
  model: "chirp-3-hd",
  languageCode: "en-US",
  supportsPrompt: false,
};

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
        this.committedNotes.set(slide.slideIndex, slide.notes);
      }
    }
    return Promise.resolve(this.notesResult);
  });

  readonly insertAudio = vi.fn<
    (filePath: string, slidesAudio: SlideAudioEntry[]) => Promise<BasicPptResult>
  >((_filePath, slidesAudio) => {
    const result = this.audioResults.shift() ?? { success: true as const };
    if (result.success) {
      for (const slideIndex of new Set(slidesAudio.map((audio) => audio.slideIndex))) {
        this.insertedAudio.set(slideIndex, new Map());
        this.removedAudio.delete(slideIndex);
      }
      for (const audio of slidesAudio) {
        this.insertedAudio.get(audio.slideIndex)!.set(audio.sectionIndex, audio.audioData);
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

describe("NarratedPresentationSaver", () => {
  it("removes stale narration before succeeding when a slide has no narratable text", async () => {
    const { generateSpeech, powerpoint, saver } = createSaver();

    await expect(
      saver.saveSlide({
        filePath: "/slides/talk.pptx",
        slideIndex: toSlideIndex(3),
        sections: sections("[Narrator]\n  \n---\n\t"),
      }),
    ).resolves.toEqual({ success: true });

    expect(generateSpeech).not.toHaveBeenCalled();
    expect(powerpoint.committedNotes).toEqual(new Map([[3, "[Narrator]\n  \n---\n\t"]]));
    expect(powerpoint.removedAudio).toEqual(new Set([3]));
    expect(powerpoint.insertedAudio).toEqual(new Map());
    expect(powerpoint.saveNotes.mock.invocationCallOrder[0]).toBeLessThan(
      powerpoint.removeAudio.mock.invocationCallOrder[0]!,
    );
  });

  it("reports a partial PowerPoint failure when stale narration cannot be removed", async () => {
    const { powerpoint, saver } = createSaver();
    powerpoint.removeResult = { success: false, message: "remove failed" };

    await expect(
      saver.saveSlide({
        filePath: "/slides/talk.pptx",
        slideIndex: toSlideIndex(3),
        sections: sections("  "),
      }),
    ).resolves.toEqual({
      success: false,
      stage: "powerpoint",
      partial: true,
      message: "remove failed",
    });

    expect(powerpoint.committedNotes).toEqual(new Map([[3, "  "]]));
    expect(powerpoint.removedAudio).toEqual(new Set());
    expect(powerpoint.insertedAudio).toEqual(new Map());
  });

  it("reports a structured synthesis failure without mutating PowerPoint", async () => {
    const { powerpoint, saver } = createSaver(
      vi.fn().mockRejectedValue(new Error("provider unavailable")),
    );

    await expect(
      saver.saveSlide({
        filePath: "/slides/talk.pptx",
        slideIndex: toSlideIndex(4),
        sections: sections("[Narrator]\nHello"),
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
      saver.saveSlide({
        filePath: "/slides/talk.pptx",
        slideIndex: toSlideIndex(4),
        sections: sections("[Narrator]\nHello"),
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
        saver.saveSlide({
          filePath: "/slides/talk.pptx",
          slideIndex: toSlideIndex(1),
          sections: sections("[Narrator]\nHello"),
        }),
      ).resolves.toEqual({
        success: false,
        stage: "powerpoint",
        partial,
        message: partial ? "audio failed" : "notes failed",
      });
      expect(powerpoint.committedNotes).toEqual(
        partial ? new Map([[1, "[Narrator]\nHello"]]) : new Map(),
      );
      expect(powerpoint.insertedAudio).toEqual(new Map());
      expect(powerpoint.removedAudio).toEqual(new Set());
    },
  );

  it("saves the current slide as a single-slide presentation request", async () => {
    const { powerpoint, saver } = createSaver();

    await expect(
      saver.saveSlide({
        filePath: "/slides/talk.pptx",
        slideIndex: toSlideIndex(6),
        sections: sections("[Narrator]\nOnly slide"),
      }),
    ).resolves.toEqual({ success: true });

    expect(powerpoint.committedNotes).toEqual(new Map([[6, "[Narrator]\nOnly slide"]]));
    expect(powerpoint.insertedAudio).toEqual(new Map([[6, new Map([[0, new Uint8Array([1])]])]]));
  });

  it("writes untouched structured notes back byte for byte", async () => {
    const { powerpoint, saver } = createSaver();
    const notes = "  [ Narrator ]  \n[p: almost whispering]\nFirst\n\n-----\nSecond\n";

    await expect(
      saver.saveSlide({
        filePath: "/slides/talk.pptx",
        slideIndex: toSlideIndex(1),
        sections: sections(notes),
      }),
    ).resolves.toEqual({ success: true });

    expect(powerpoint.committedNotes).toEqual(new Map([[1, notes]]));
  });
});
