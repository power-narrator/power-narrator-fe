import { toSlideIndex } from "../../shared/slides/slideCoordinates.js";
import { describe, expect, it, vi } from "vitest";
import type { SavedSlideNarration } from "../../shared/types/narration.js";
import type { SlideNarrationSaveResult } from "../platform/types.js";
import type { SynthesizedSpeech, Voice } from "../tts/TtsProvider.js";
import { parseNarrationSections } from "../../shared/narration/NarrationSections.js";
import { NarrationPreparation } from "./NarrationPreparation.js";
import { NarratedPresentationSaver } from "./NarratedPresentationSaver.js";
import type { NarrationPowerPoint } from "./registerNarrationIpc.js";

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

/** Keeps what each save reports saved: the notes, and the section audio with them. */
class FakePowerPointAdapter {
  readonly committedNotes = new Map<number, string>();
  readonly sectionAudio = new Map<number, Map<number, Uint8Array>>();
  result: SlideNarrationSaveResult = { success: true };

  readonly saveSlideNarration = vi.fn<NarrationPowerPoint["saveSlideNarration"]>(
    (_filePath, slide) => {
      const saved: SavedSlideNarration = this.result.success ? "notesAndAudio" : this.result.saved;
      if (saved !== "nothing") {
        this.committedNotes.set(slide.slideIndex, slide.notes);
      }
      if (saved === "notesAndAudio") {
        this.sectionAudio.set(
          slide.slideIndex,
          new Map(slide.audio.map((audio) => [audio.sectionIndex, audio.audioData])),
        );
      }
      return Promise.resolve(this.result);
    },
  );
}

function expectNoPowerPointMutation(powerpoint: FakePowerPointAdapter) {
  expect(powerpoint.saveSlideNarration).not.toHaveBeenCalled();
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
  it("saves the notes of a slide without narratable text together with removing its stale audio", async () => {
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
    expect(powerpoint.sectionAudio).toEqual(new Map([[3, new Map()]]));
  });

  it.each<SavedSlideNarration>(["nothing", "notes", "notesAndAudio"])(
    "reports a PowerPoint failure that left %s saved",
    async (saved) => {
      const { powerpoint, saver } = createSaver();
      powerpoint.result = { success: false, saved, message: "media rejected" };

      await expect(
        saver.saveSlide({
          filePath: "/slides/talk.pptx",
          slideIndex: toSlideIndex(1),
          sections: sections("[Narrator]\nHello"),
        }),
      ).resolves.toEqual({
        success: false,
        stage: "powerpoint",
        saved,
        message: "media rejected",
      });
    },
  );

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
    ).resolves.toMatchObject({ success: false, stage: "synthesis", saved: "nothing" });
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
      saved: "nothing",
      message: "settings unavailable",
    });
    expectNoPowerPointMutation(powerpoint);
  });

  it("saves the current slide's notes and section audio together", async () => {
    const { powerpoint, saver } = createSaver();

    await expect(
      saver.saveSlide({
        filePath: "/slides/talk.pptx",
        slideIndex: toSlideIndex(6),
        sections: sections("[Narrator]\nOnly slide"),
      }),
    ).resolves.toEqual({ success: true });

    expect(powerpoint.saveSlideNarration).toHaveBeenCalledTimes(1);
    expect(powerpoint.committedNotes).toEqual(new Map([[6, "[Narrator]\nOnly slide"]]));
    expect(powerpoint.sectionAudio).toEqual(new Map([[6, new Map([[0, new Uint8Array([1])]])]]));
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
