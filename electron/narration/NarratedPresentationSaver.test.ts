import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TtsManager } from "../tts/TtsManager.js";
import type { TtsProvider, Voice } from "../tts/TtsProvider.js";
import { NarrationPreparation } from "./NarrationPreparation.js";
import { NarratedPresentationSaver } from "./NarratedPresentationSaver.js";

const narratorVoice: Voice = {
  name: "en-US-narrator",
  languageCodes: ["en-US"],
  ssmlGender: "FEMALE",
  provider: "gcp",
};

const alternateNarratorVoice: Voice = {
  ...narratorVoice,
  name: "en-GB-narrator",
};

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

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

function createCachedRetrySaver(
  getSpeakerMappings: () => Record<string, Voice> = () => ({ Narrator: narratorVoice }),
) {
  const cacheDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "power-narrator-save-retry-"));
  temporaryDirectories.push(cacheDirectory);
  const synthesize = vi.fn().mockResolvedValue(new Uint8Array([4, 5, 6]));
  const provider: TtsProvider = {
    getVoices: vi.fn().mockResolvedValue([narratorVoice, alternateNarratorVoice]),
    prepareSpeech: (text, voice) => ({
      cacheIdentity: { text, voice: voice.name },
      synthesize,
    }),
  };
  const preparation = new NarrationPreparation(
    { getSpeakerMappings },
    new TtsManager(new Map([["gcp", provider]]), "gcp", { cacheDirectory }),
  );
  const powerpoint = {
    saveNotes: vi.fn().mockResolvedValue({ success: true }),
    insertAudio: vi
      .fn()
      .mockResolvedValueOnce({ success: false, message: "audio automation failed" })
      .mockResolvedValueOnce({ success: true }),
  };

  return {
    synthesize,
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
    const { saver, synthesize } = createCachedRetrySaver(() => ({ Narrator: mappedVoice }));
    const request = {
      filePath: "/slides/talk.pptx",
      slides: [{ slideIndex: 2, notes: "[Narrator]\nSame notes" }],
    };

    await saver.savePresentation(request);
    mappedVoice = alternateNarratorVoice;
    await saver.savePresentation(request);

    expect(synthesize).toHaveBeenCalledTimes(2);
  });
});
