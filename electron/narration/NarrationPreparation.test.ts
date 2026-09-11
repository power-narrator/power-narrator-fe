import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it, onTestFinished, vi } from "vitest";
import type { TtsProvider, Voice } from "../tts/TtsProvider.js";
import { TtsManager } from "../tts/TtsManager.js";
import { NarrationPreparation, NarrationPreparationError } from "./NarrationPreparation.js";

const narratorVoice: Voice = {
  name: "en-US-narrator",
  languageCodes: ["en-US"],
  ssmlGender: "FEMALE",
  provider: "gcp",
};

const defaultVoice: Voice = {
  name: "en-US-default",
  languageCodes: ["en-US"],
  ssmlGender: "NEUTRAL",
  provider: "gcp",
};

const guestVoice: Voice = {
  name: "en-GB-guest",
  languageCodes: ["en-GB"],
  ssmlGender: "MALE",
  provider: "local",
};

afterEach(() => {
  vi.restoreAllMocks();
});

function createPreparation(mappings: Record<string, Voice> = { Narrator: narratorVoice }) {
  const generateSpeech = vi
    .fn()
    .mockResolvedValue({ audio: new Uint8Array([1, 2, 3]), mediaType: "audio/mpeg" });
  const preparation = new NarrationPreparation(
    { getSpeakerMappings: () => mappings },
    {
      supportsProvider: (providerId) => providerId === "gcp" || providerId === "local",
      generateSpeech,
    },
  );

  return { preparation, generateSpeech };
}

describe("NarrationPreparation", () => {
  it("reuses cached narration for a repeated prepared request", async () => {
    const cacheDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "power-narrator-preparation-"));
    onTestFinished(() => fs.rmSync(cacheDirectory, { recursive: true, force: true }));
    const synthesize = vi.fn().mockResolvedValue(new Uint8Array([7, 8, 9]));
    const provider: TtsProvider = {
      getVoices: vi.fn().mockResolvedValue([]),
      prepareSpeech: (text, voice) => ({
        cacheIdentity: { text, voice: voice.name },
        synthesize,
      }),
    };
    const preparation = new NarrationPreparation(
      { getSpeakerMappings: () => ({ Narrator: narratorVoice }) },
      new TtsManager(new Map([["gcp", provider]]), cacheDirectory),
    );
    const request = {
      slideIndex: 2,
      sectionIndex: 0,
      notes: "[Narrator]\nHello",
      text: " Hello ",
    };

    await preparation.preparePreview(request);
    await expect(preparation.preparePreview(request)).resolves.toEqual({
      audio: new Uint8Array([7, 8, 9]),
      mediaType: "audio/mpeg",
    });

    expect(synthesize).toHaveBeenCalledOnce();
  });

  it("returns batch audio in slide and section order regardless of synthesis order", async () => {
    const pending = new Map<string, (audio: { audio: Uint8Array; mediaType: string }) => void>();
    const generateSpeech = vi.fn(
      (text: string) =>
        new Promise<{ audio: Uint8Array; mediaType: string }>((resolve) => {
          pending.set(text, resolve);
        }),
    );
    const preparation = new NarrationPreparation(
      { getSpeakerMappings: () => ({ Narrator: narratorVoice }) },
      { supportsProvider: () => true, generateSpeech },
    );

    const batch = preparation.prepareBatch([
      { slideIndex: 5, notes: "[Narrator]\nFive first\n---\nFive second" },
      { slideIndex: 1, notes: "[Narrator]\nOne first" },
    ]);
    await vi.waitFor(() => expect(pending.size).toBe(3));

    pending.get("One first")?.({ audio: new Uint8Array([3]), mediaType: "audio/mpeg" });
    pending.get("Five second")?.({ audio: new Uint8Array([2]), mediaType: "audio/mpeg" });
    pending.get("Five first")?.({ audio: new Uint8Array([1]), mediaType: "audio/mpeg" });

    await expect(batch).resolves.toEqual([
      { index: 5, sectionIndex: 0, audioData: new Uint8Array([1]) },
      { index: 5, sectionIndex: 1, audioData: new Uint8Array([2]) },
      { index: 1, sectionIndex: 0, audioData: new Uint8Array([3]) },
    ]);
  });

  it("normalizes live text and synthesizes with the section's mapped speaker", async () => {
    const { preparation, generateSpeech } = createPreparation();

    await expect(
      preparation.preparePreview({
        slideIndex: 2,
        sectionIndex: 0,
        notes: "[Narrator]\nStored text",
        text: "  Live renderer text  \n",
      }),
    ).resolves.toEqual({ audio: new Uint8Array([1, 2, 3]), mediaType: "audio/mpeg" });
    expect(generateSpeech).toHaveBeenCalledWith("Live renderer text", narratorVoice);
  });

  it("adds section context when preview synthesis returns no audio", async () => {
    const { preparation, generateSpeech } = createPreparation();
    generateSpeech.mockRejectedValue(new Error("GCP TTS returned no audio content"));

    const preview = preparation.preparePreview({
      slideIndex: 4,
      sectionIndex: 1,
      notes: "[Narrator]\nFirst\n---\nSecond",
      text: "Second",
    });

    await expect(preview).rejects.toEqual(
      new NarrationPreparationError(
        "synthesis",
        'Narration synthesis failed for slide 4, section 2, speaker "Narrator": GCP TTS returned no audio content.',
      ),
    );
  });

  it.each([
    ["missing", undefined],
    ["empty", {}],
    ["legacy placeholder", { ...narratorVoice, name: "default" }],
    ["unknown provider", { ...narratorVoice, provider: "unknown" }],
  ])("rejects a %s voice before synthesis with preview context", async (_, mappedVoice) => {
    const mappings: Record<string, Voice> = mappedVoice ? { Narrator: mappedVoice as Voice } : {};
    const { preparation, generateSpeech } = createPreparation(mappings);

    await expect(
      preparation.preparePreview({
        slideIndex: 4,
        sectionIndex: 1,
        notes: "[Narrator]\nFirst\n---\nSecond",
        text: "Second",
      }),
    ).rejects.toThrow(/slide 4, section 2, speaker "Narrator"/);
    expect(generateSpeech).not.toHaveBeenCalled();
  });

  it("inherits the speaker from an earlier section in the supplied slide", async () => {
    const { preparation, generateSpeech } = createPreparation({
      Narrator: narratorVoice,
      _default_: defaultVoice,
    });

    await preparation.preparePreview({
      slideIndex: 3,
      sectionIndex: 1,
      notes: "[Narrator]\nFirst\n---\nSecond",
      text: "Inherited",
    });

    expect(generateSpeech).toHaveBeenCalledWith("Inherited", narratorVoice);
  });

  it("uses the default voice when the supplied slide names no speaker", async () => {
    const { preparation, generateSpeech } = createPreparation({
      Narrator: narratorVoice,
      _default_: defaultVoice,
    });

    await preparation.preparePreview({
      slideIndex: 4,
      sectionIndex: 0,
      notes: "No speaker on this slide",
      text: "Defaulted",
    });

    expect(generateSpeech).toHaveBeenCalledWith("Defaulted", defaultVoice);
  });

  it("uses a temporary preview speaker without changing the supplied notes", async () => {
    const { preparation, generateSpeech } = createPreparation({
      Narrator: narratorVoice,
      Guest: guestVoice,
    });
    const request = {
      slideIndex: 1,
      sectionIndex: 0,
      notes: "[Narrator]\nWelcome",
      text: "Welcome",
      previewSpeaker: "Guest",
    };

    await preparation.preparePreview(request);

    expect(generateSpeech).toHaveBeenCalledWith("Welcome", guestVoice);
    expect(request.notes).toBe("[Narrator]\nWelcome");
  });

  it("rejects whitespace-only preview text before loading mappings or synthesis", async () => {
    const getSpeakerMappings = vi.fn().mockReturnValue({ Narrator: narratorVoice });
    const generateSpeech = vi.fn();
    const preparation = new NarrationPreparation(
      { getSpeakerMappings },
      { supportsProvider: () => true, generateSpeech },
    );

    await expect(
      preparation.preparePreview({
        slideIndex: 1,
        sectionIndex: 0,
        notes: "[Narrator]\nStored",
        text: " \n\t ",
      }),
    ).rejects.toEqual(
      new NarrationPreparationError(
        "validation",
        "Narration validation failed for slide 1, section 1: text is empty.",
      ),
    );
    expect(getSpeakerMappings).not.toHaveBeenCalled();
    expect(generateSpeech).not.toHaveBeenCalled();
  });
});
