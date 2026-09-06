import { describe, expect, it, vi } from "vitest";
import type { Voice } from "../tts/TtsProvider.js";
import { NarrationPreparation } from "./NarrationPreparation.js";
import { NarratedPresentationSaver } from "./NarratedPresentationSaver.js";

const narratorVoice: Voice = {
  name: "en-US-narrator",
  languageCodes: ["en-US"],
  ssmlGender: "FEMALE",
  provider: "gcp",
};

function createSaver(generateSpeech = vi.fn().mockResolvedValue(new Uint8Array([1]))) {
  const preparation = new NarrationPreparation(
    { getSpeakerMappings: () => ({ Narrator: narratorVoice }) },
    { supportsProvider: () => true, generateSpeech },
  );
  const powerpoint = {
    saveNotes: vi.fn().mockResolvedValue({ success: true }),
    insertAudio: vi.fn().mockResolvedValue({ success: true }),
  };

  return {
    generateSpeech,
    powerpoint,
    saver: new NarratedPresentationSaver(preparation, () => powerpoint),
  };
}

describe("NarratedPresentationSaver.savePresentation", () => {
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
      message: expect.stringMatching(/slide 8, section 1, speaker "Missing"/),
    });
    expect(generateSpeech).not.toHaveBeenCalled();
    expect(powerpoint.saveNotes).not.toHaveBeenCalled();
    expect(powerpoint.insertAudio).not.toHaveBeenCalled();
  });

  it("reports eligible completion while preserving request order after parallel synthesis", async () => {
    const pending = new Map<string, (audio: Uint8Array) => void>();
    const generateSpeech = vi.fn(
      (text: string) =>
        new Promise<Uint8Array>((resolve) => {
          pending.set(text, resolve);
        }),
    );
    const { powerpoint, saver } = createSaver(generateSpeech);
    const onProgress = vi.fn();
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
    expect(powerpoint.saveNotes).not.toHaveBeenCalled();

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
    expect(powerpoint.saveNotes).toHaveBeenCalledWith("/slides/talk.pptx", [
      { index: 9, notes: request.slides[0]!.notes },
      { index: 3, notes: request.slides[1]!.notes },
    ]);
    expect(powerpoint.insertAudio).toHaveBeenCalledWith("/slides/talk.pptx", [
      { index: 9, sectionIndex: 0, audioData: new Uint8Array([1]) },
      { index: 9, sectionIndex: 2, audioData: new Uint8Array([2]) },
      { index: 3, sectionIndex: 0, audioData: new Uint8Array([3]) },
    ]);
  });
});
