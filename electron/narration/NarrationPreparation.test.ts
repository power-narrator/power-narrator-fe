import { describe, expect, it, vi } from "vitest";
import type { Voice } from "../tts/TtsProvider.js";
import { NarrationPreparation } from "./NarrationPreparation.js";

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

function createPreparation(mappings: Record<string, Voice> = { Narrator: narratorVoice }) {
  const generateSpeech = vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3]));
  const preparation = new NarrationPreparation(
    { getSpeakerMappings: () => mappings },
    {
      supportsProvider: (providerId) => providerId === "gcp" || providerId === "local",
      generateSpeech,
    },
  );

  return { preparation, generateSpeech };
}

describe("NarrationPreparation.preparePreview", () => {
  it("normalizes live text and synthesizes with the section's mapped speaker", async () => {
    const { preparation, generateSpeech } = createPreparation();

    await expect(
      preparation.preparePreview({
        slideIndex: 2,
        sectionIndex: 0,
        notes: "[Narrator]\nStored text",
        text: "  Live renderer text  \n",
      }),
    ).resolves.toEqual(new Uint8Array([1, 2, 3]));
    expect(generateSpeech).toHaveBeenCalledWith("Live renderer text", narratorVoice);
  });

  it.each(["\u2028", "\u2029"])(
    "normalizes PowerPoint's %j line ending before resolving the speaker",
    async (lineEnding) => {
      const { preparation, generateSpeech } = createPreparation();

      await preparation.preparePreview({
        slideIndex: 2,
        sectionIndex: 0,
        notes: `[Narrator]${lineEnding}Stored text`,
        text: "Preview",
      });

      expect(generateSpeech).toHaveBeenCalledWith("Preview", narratorVoice);
    },
  );

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

  it("inherits only from an earlier section in the supplied slide and otherwise uses the default voice", async () => {
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
    await preparation.preparePreview({
      slideIndex: 4,
      sectionIndex: 0,
      notes: "No speaker on this slide",
      text: "Defaulted",
    });

    expect(generateSpeech).toHaveBeenNthCalledWith(1, "Inherited", narratorVoice);
    expect(generateSpeech).toHaveBeenNthCalledWith(2, "Defaulted", defaultVoice);
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

  it("does not load mappings or synthesize whitespace-only preview text", async () => {
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
    ).resolves.toBeNull();
    expect(getSpeakerMappings).not.toHaveBeenCalled();
    expect(generateSpeech).not.toHaveBeenCalled();
  });
});
