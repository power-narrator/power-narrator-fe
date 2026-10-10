import { toSlideIndex } from "../../shared/slides/slideCoordinates.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import { TtsManager } from "../tts/TtsManager.js";
import type { SpeakerMapping, TtsProvider, Voice } from "../tts/TtsProvider.js";
import { parseNarrationSections } from "../../shared/narration/NarrationSections.js";
import { NarrationPreparation } from "./NarrationPreparation.js";
import { NarratedPresentationSaver } from "./NarratedPresentationSaver.js";
import type { NarrationPowerPoint } from "./registerNarrationIpc.js";

const sections = (notes: string) =>
  parseNarrationSections(notes, ["Narrator"]).map((section) => ({
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

const alternateNarratorVoice: Voice = {
  ...narratorVoice,
  languageCode: "en-GB",
};

function createCachedRetrySaver(
  getSpeakerMappings: () => Record<string, SpeakerMapping> = () => ({
    Narrator: { voice: narratorVoice },
  }),
) {
  const cacheDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "power-narrator-save-retry-"));
  onTestFinished(() => fs.rmSync(cacheDirectory, { recursive: true, force: true }));
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
  const powerpoint = {
    saveNotes: vi.fn<NarrationPowerPoint["saveNotes"]>().mockResolvedValue({ success: true }),
    insertAudio: vi
      .fn<NarrationPowerPoint["insertAudio"]>()
      .mockResolvedValueOnce({ success: false, message: "audio automation failed" })
      .mockResolvedValue({ success: true }),
    removeAudio: vi.fn<NarrationPowerPoint["removeAudio"]>().mockResolvedValue({ success: true }),
  } satisfies NarrationPowerPoint;

  return {
    synthesize,
    powerpoint,
    saver: new NarratedPresentationSaver(preparation, () => powerpoint),
  };
}

describe("NarratedPresentationSaver cache retries", () => {
  it("reuses prepared narration when an ordinary retry follows a partial PowerPoint failure", async () => {
    const { powerpoint, saver, synthesize } = createCachedRetrySaver();
    const request = {
      filePath: "/slides/talk.pptx",
      slideIndex: toSlideIndex(1),
      sections: sections("[Narrator]\nRetry me"),
    };

    await expect(saver.saveSlide(request)).resolves.toEqual({
      success: false,
      stage: "powerpoint",
      partial: true,
      message: "audio automation failed",
    });
    await expect(saver.saveSlide(request)).resolves.toEqual({ success: true });

    expect(synthesize).toHaveBeenCalledTimes(1);
    expect(powerpoint.saveNotes).toHaveBeenCalledTimes(2);
    expect(powerpoint.insertAudio).toHaveBeenCalledTimes(2);
  });

  it("reuses cached narration when only the playback choice changes", async () => {
    const { powerpoint, saver, synthesize } = createCachedRetrySaver();
    powerpoint.insertAudio.mockReset().mockResolvedValue({ success: true });
    const saveWithPlayback = (playAcrossSlides: boolean) =>
      saver.savePresentation({
        filePath: "/slides/talk.pptx",
        slides: [
          {
            slideIndex: toSlideIndex(1),
            sections: [{ speaker: "Narrator", text: "Same notes", playAcrossSlides }],
          },
        ],
      });

    await saveWithPlayback(false);
    await expect(saveWithPlayback(true)).resolves.toEqual({
      outcome: { success: true },
      savedNoteSlides: [1],
    });

    expect(synthesize).toHaveBeenCalledTimes(1);
    expect(powerpoint.insertAudio.mock.lastCall?.[1]).toEqual([
      expect.objectContaining({ sectionIndex: 0, playAcrossSlides: true }),
    ]);
  });

  it("synthesizes a new cache identity when edited notes are retried", async () => {
    const { saver, synthesize } = createCachedRetrySaver();

    await saver.saveSlide({
      filePath: "/slides/talk.pptx",
      slideIndex: toSlideIndex(1),
      sections: sections("[Narrator]\nBefore edit"),
    });
    await saver.saveSlide({
      filePath: "/slides/talk.pptx",
      slideIndex: toSlideIndex(1),
      sections: sections("[Narrator]\nAfter edit"),
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
      slideIndex: toSlideIndex(1),
      sections: sections("[Narrator]\nSame notes"),
    };

    await saver.saveSlide(request);
    mappedVoice = alternateNarratorVoice;
    await saver.saveSlide(request);

    expect(synthesize).toHaveBeenCalledTimes(2);
  });
});
