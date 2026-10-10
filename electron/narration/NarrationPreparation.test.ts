import { toSlideIndex } from "../../shared/slides/slideCoordinates.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, onTestFinished, vi } from "vitest";
import type { SpeakerMapping, SynthesizedSpeech, TtsProvider, Voice } from "../tts/TtsProvider.js";
import { TtsManager } from "../tts/TtsManager.js";
import type { NarrationSection } from "../../shared/narration/NarrationSections.js";
import { NarrationPreparation, NarrationPreparationError } from "./NarrationPreparation.js";

const narratorVoice: Voice = {
  provider: "gcp",
  voiceId: "Narrator",
  model: "chirp-3-hd",
  languageCode: "en-US",
  supportsPrompt: false,
};

const defaultVoice: Voice = {
  provider: "gcp",
  voiceId: "Default",
  model: "chirp-3-hd",
  languageCode: "en-US",
  supportsPrompt: false,
};

const guestVoice: Voice = {
  provider: "local",
  voiceId: "Guest",
  model: "local-1",
  languageCode: "en-GB",
  supportsPrompt: true,
};

afterEach(() => {
  vi.restoreAllMocks();
});

const defaultMappings: Record<string, SpeakerMapping> = { Narrator: { voice: narratorVoice } };

const FIRST_SECOND: NarrationSection[] = [
  { speaker: "Narrator", text: "First", playAcrossSlides: false },
  { speaker: "", text: "Second", playAcrossSlides: false },
];

async function prepareBatch(
  preparation: NarrationPreparation,
  slides: Parameters<NarrationPreparation["planSlides"]>[0],
) {
  const planned = await preparation.planSlides(slides);
  const audio = await Promise.all(planned.map((slide) => slide.synthesize()));
  return audio.flat();
}

function createPreparation(mappings: Record<string, SpeakerMapping> = defaultMappings) {
  const generateSpeech = vi
    .fn<(text: string, voice: Voice, prompt?: string) => Promise<SynthesizedSpeech>>()
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
    const synthesize = vi
      .fn<() => Promise<Uint8Array>>()
      .mockResolvedValue(new Uint8Array([7, 8, 9]));
    const provider: TtsProvider = {
      getVoices: vi.fn<TtsProvider["getVoices"]>().mockResolvedValue([]),
      prepareSpeech: (text, voice) => ({
        cacheIdentity: { text, voice: voice.voiceId },
        synthesize,
      }),
    };
    const preparation = new NarrationPreparation(
      { getSpeakerMappings: () => ({ Narrator: { voice: narratorVoice } }) },
      new TtsManager(new Map([["gcp", provider]]), cacheDirectory),
    );
    const request = {
      slideIndex: toSlideIndex(1),
      sectionIndex: 0,
      sections: [{ speaker: "Narrator", text: "Hello", playAcrossSlides: false }],
      text: " Hello ",
      speakerChoice: { kind: "effective" as const },
    };

    await preparation.preparePreview(request);
    await expect(preparation.preparePreview(request)).resolves.toEqual({
      audio: new Uint8Array([7, 8, 9]),
      mediaType: "audio/mpeg",
    });

    expect(synthesize).toHaveBeenCalledOnce();
  });

  it("preserves a planned slide's section order when synthesis finishes out of order", async () => {
    const pending = new Map<string, (audio: { audio: Uint8Array; mediaType: string }) => void>();
    const generateSpeech = vi.fn<(text: string, voice: Voice) => Promise<SynthesizedSpeech>>(
      (text) =>
        new Promise<{ audio: Uint8Array; mediaType: string }>((resolve) => {
          pending.set(text, resolve);
        }),
    );
    const preparation = new NarrationPreparation(
      { getSpeakerMappings: () => ({ Narrator: { voice: narratorVoice } }) },
      { supportsProvider: () => true, generateSpeech },
    );

    const planned = await preparation.planSlides([
      {
        slideIndex: toSlideIndex(4),
        sections: [
          { speaker: "Narrator", text: "Five first", playAcrossSlides: false },
          { speaker: "", text: "Five second", playAcrossSlides: false },
        ],
      },
      {
        slideIndex: toSlideIndex(0),
        sections: [{ speaker: "Narrator", text: "One first", playAcrossSlides: false }],
      },
    ]);
    expect(generateSpeech).not.toHaveBeenCalled();

    const audio = planned[0]!.synthesize();
    await vi.waitFor(() =>
      expect(new Set(pending.keys())).toEqual(new Set(["Five first", "Five second"])),
    );

    pending.get("Five second")!({ audio: new Uint8Array([2]), mediaType: "audio/mpeg" });
    pending.get("Five first")!({ audio: new Uint8Array([1]), mediaType: "audio/mpeg" });

    await expect(audio).resolves.toEqual([
      { slideIndex: 4, sectionIndex: 0, audioData: new Uint8Array([1]), playAcrossSlides: false },
      { slideIndex: 4, sectionIndex: 1, audioData: new Uint8Array([2]), playAcrossSlides: false },
    ]);
  });

  it("normalizes live text and synthesizes with the section's mapped speaker", async () => {
    const { preparation, generateSpeech } = createPreparation();

    await expect(
      preparation.preparePreview({
        slideIndex: toSlideIndex(1),
        sectionIndex: 0,
        sections: [{ speaker: "Narrator", text: "Stored text", playAcrossSlides: false }],
        text: "  Live renderer text  \n",
        speakerChoice: { kind: "effective" },
      }),
    ).resolves.toEqual({ audio: new Uint8Array([1, 2, 3]), mediaType: "audio/mpeg" });
    expect(generateSpeech).toHaveBeenCalledWith("Live renderer text", narratorVoice, undefined);
  });

  it("adds section context when preview synthesis returns no audio", async () => {
    const { preparation, generateSpeech } = createPreparation();
    generateSpeech.mockRejectedValue(new Error("GCP TTS returned no audio content"));

    const preview = preparation.preparePreview({
      slideIndex: toSlideIndex(3),
      sectionIndex: 1,
      sections: FIRST_SECOND,
      text: "Second",
      speakerChoice: { kind: "effective" },
    });

    await expect(preview).rejects.toEqual(
      new NarrationPreparationError(
        "synthesis",
        'Narration synthesis failed for slide 4, section 2, speaker "Narrator": GCP TTS returned no audio content.',
      ),
    );
  });

  it.each<[string, SpeakerMapping | undefined]>([
    ["unconfigured", {}],
    ["absent", undefined],
    ["prompt-only", { prompt: "Whisper" }],
    ["unknown provider", { voice: { ...narratorVoice, provider: "unknown" } }],
  ])("rejects a %s mapping before synthesis with preview context", async (_, mapping) => {
    const mappings: Record<string, SpeakerMapping> = mapping ? { Narrator: mapping } : {};
    const { preparation, generateSpeech } = createPreparation(mappings);

    await expect(
      preparation.preparePreview({
        slideIndex: toSlideIndex(3),
        sectionIndex: 1,
        sections: FIRST_SECOND,
        text: "Second",
        speakerChoice: { kind: "effective" },
      }),
    ).rejects.toThrow(/slide 4, section 2, speaker "Narrator"/);
    expect(generateSpeech).not.toHaveBeenCalled();
  });

  it("inherits the speaker from an earlier section in the supplied slide", async () => {
    const { preparation, generateSpeech } = createPreparation({
      Narrator: { voice: narratorVoice },
      _default_: { voice: defaultVoice },
    });

    await preparation.preparePreview({
      slideIndex: toSlideIndex(2),
      sectionIndex: 1,
      sections: FIRST_SECOND,
      text: "Inherited",
      speakerChoice: { kind: "effective" },
    });

    expect(generateSpeech).toHaveBeenCalledWith("Inherited", narratorVoice, undefined);
  });

  it("uses the default voice when the supplied slide names no speaker", async () => {
    const { preparation, generateSpeech } = createPreparation({
      Narrator: { voice: narratorVoice },
      _default_: { voice: defaultVoice },
    });

    await preparation.preparePreview({
      slideIndex: toSlideIndex(3),
      sectionIndex: 0,
      sections: [{ speaker: "", text: "No speaker on this slide", playAcrossSlides: false }],
      text: "Defaulted",
      speakerChoice: { kind: "effective" },
    });

    expect(generateSpeech).toHaveBeenCalledWith("Defaulted", defaultVoice, undefined);
  });

  it("uses a temporary preview speaker without changing the supplied sections", async () => {
    const { preparation, generateSpeech } = createPreparation({
      Narrator: { voice: narratorVoice },
      Guest: { voice: guestVoice },
    });
    const request = {
      slideIndex: toSlideIndex(0),
      sectionIndex: 0,
      sections: [{ speaker: "Narrator", text: "Welcome", playAcrossSlides: false }],
      text: "Welcome",
      speakerChoice: { kind: "override" as const, speaker: "Guest" },
    };

    await preparation.preparePreview(request);

    expect(generateSpeech).toHaveBeenCalledWith("Welcome", guestVoice, undefined);
    expect(request.sections).toEqual([
      { speaker: "Narrator", text: "Welcome", playAcrossSlides: false },
    ]);
  });

  it("treats an explicit Default preview as an override of the effective speaker", async () => {
    const { preparation, generateSpeech } = createPreparation({
      Narrator: { voice: narratorVoice },
      _default_: { voice: defaultVoice },
    });

    await preparation.preparePreview({
      slideIndex: toSlideIndex(0),
      sectionIndex: 0,
      sections: [{ speaker: "Narrator", text: "Welcome", playAcrossSlides: false }],
      text: "Welcome",
      speakerChoice: { kind: "default" },
    });

    expect(generateSpeech).toHaveBeenCalledWith("Welcome", defaultVoice, undefined);
  });

  it("fails a mapping left unconfigured without reaching a provider", async () => {
    const { preparation, generateSpeech } = createPreparation({ Narrator: {} });

    await expect(
      preparation.preparePreview({
        slideIndex: toSlideIndex(3),
        sectionIndex: 0,
        sections: [{ speaker: "Narrator", text: "Hello", playAcrossSlides: false }],
        text: "Hello",
        speakerChoice: { kind: "effective" },
      }),
    ).rejects.toEqual(
      new NarrationPreparationError(
        "validation",
        'Narration validation failed for slide 4, section 1, speaker "Narrator": no voice mapping is configured.',
      ),
    );
    expect(generateSpeech).not.toHaveBeenCalled();
  });

  it("rejects whitespace-only preview text before loading mappings or synthesis", async () => {
    const getSpeakerMappings = vi
      .fn<() => Record<string, SpeakerMapping>>()
      .mockReturnValue({ Narrator: { voice: narratorVoice } });
    const generateSpeech = vi.fn<(text: string, voice: Voice) => Promise<SynthesizedSpeech>>();
    const preparation = new NarrationPreparation(
      { getSpeakerMappings },
      { supportsProvider: () => true, generateSpeech },
    );

    await expect(
      preparation.preparePreview({
        slideIndex: toSlideIndex(0),
        sectionIndex: 0,
        sections: [{ speaker: "Narrator", text: "Stored", playAcrossSlides: false }],
        text: " \n\t ",
        speakerChoice: { kind: "effective" },
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

describe("NarrationPreparation prompts", () => {
  const promptableVoice: Voice = { ...narratorVoice, supportsPrompt: true };

  it("delivers every section a speaker narrates with that speaker's prompt", async () => {
    const { preparation, generateSpeech } = createPreparation({
      Narrator: { voice: promptableVoice, prompt: "conspiratorial, almost whispering" },
    });

    await prepareBatch(preparation, [{ slideIndex: toSlideIndex(0), sections: FIRST_SECOND }]);

    expect(generateSpeech.mock.calls).toEqual([
      ["First", promptableVoice, "conspiratorial, almost whispering"],
      ["Second", promptableVoice, "conspiratorial, almost whispering"],
    ]);
  });

  it("keeps two speakers sharing one voice on their own prompts", async () => {
    const { preparation, generateSpeech } = createPreparation({
      Narrator: { voice: promptableVoice, prompt: "whisper" },
      Guest: { voice: promptableVoice, prompt: "shout" },
    });

    await prepareBatch(preparation, [
      {
        slideIndex: toSlideIndex(0),
        sections: [
          { speaker: "Narrator", text: "First", playAcrossSlides: false },
          { speaker: "Guest", text: "Second", playAcrossSlides: false },
        ],
      },
    ]);

    expect(generateSpeech.mock.calls).toEqual([
      ["First", promptableVoice, "whisper"],
      ["Second", promptableVoice, "shout"],
    ]);
  });

  it("narrates a prompt the chosen voice ignores rather than refusing it", async () => {
    const { preparation, generateSpeech } = createPreparation({
      Narrator: { voice: narratorVoice, prompt: "whisper" },
    });

    await preparation.preparePreview({
      slideIndex: toSlideIndex(0),
      sectionIndex: 0,
      sections: [{ speaker: "Narrator", text: "First", playAcrossSlides: false }],
      text: "First",
      speakerChoice: { kind: "effective" },
    });

    expect(generateSpeech).toHaveBeenCalledWith("First", narratorVoice, "whisper");
  });
});

describe("NarrationPreparation inline prompts", () => {
  const promptableVoice: Voice = { ...narratorVoice, supportsPrompt: true };
  const combinedPrompt =
    "Follow all of the instructions below. Where a later instruction conflicts with an earlier one, follow the later instruction.\nconspiratorial\nalmost whispering";

  it("appends a section's inline prompt to the speaker's preset prompt so it wins conflicts", async () => {
    const { preparation, generateSpeech } = createPreparation({
      Narrator: { voice: promptableVoice, prompt: "conspiratorial" },
    });

    await prepareBatch(preparation, [
      {
        slideIndex: toSlideIndex(0),
        sections: [
          {
            speaker: "Narrator",
            prompt: "almost whispering",
            text: "First",
            playAcrossSlides: false,
          },
        ],
      },
    ]);

    expect(generateSpeech).toHaveBeenCalledWith("First", promptableVoice, combinedPrompt);
  });

  it("narrates an inline prompt in a section with no preset prompt", async () => {
    const { preparation, generateSpeech } = createPreparation({
      Narrator: { voice: promptableVoice },
    });

    await prepareBatch(preparation, [
      {
        slideIndex: toSlideIndex(0),
        sections: [
          { speaker: "Narrator", prompt: "sigh first", text: "First", playAcrossSlides: false },
        ],
      },
    ]);

    expect(generateSpeech).toHaveBeenCalledWith("First", promptableVoice, "sigh first");
  });

  it("confines an inline prompt to its own section while the speaker still carries", async () => {
    const { preparation, generateSpeech } = createPreparation({
      Narrator: { voice: promptableVoice, prompt: "conspiratorial" },
    });

    await prepareBatch(preparation, [
      {
        slideIndex: toSlideIndex(0),
        sections: [
          {
            speaker: "Narrator",
            prompt: "almost whispering",
            text: "First",
            playAcrossSlides: false,
          },
          { speaker: "", text: "Second", playAcrossSlides: false },
        ],
      },
    ]);

    expect(generateSpeech.mock.calls).toEqual([
      ["First", promptableVoice, combinedPrompt],
      ["Second", promptableVoice, "conspiratorial"],
    ]);
  });

  it("previews a section with the same prompts saving it would use", async () => {
    const { preparation, generateSpeech } = createPreparation({
      Narrator: { voice: promptableVoice, prompt: "conspiratorial" },
    });

    await preparation.preparePreview({
      slideIndex: toSlideIndex(0),
      sectionIndex: 0,
      sections: [
        {
          speaker: "Narrator",
          prompt: "almost whispering",
          text: "First",
          playAcrossSlides: false,
        },
      ],
      text: "First",
      speakerChoice: { kind: "effective" },
    });

    expect(generateSpeech).toHaveBeenCalledWith("First", promptableVoice, combinedPrompt);
  });

  it("narrates an inline prompt the chosen voice ignores rather than refusing it", async () => {
    const { preparation, generateSpeech } = createPreparation({
      Narrator: { voice: narratorVoice },
    });

    await prepareBatch(preparation, [
      {
        slideIndex: toSlideIndex(0),
        sections: [
          {
            speaker: "Narrator",
            prompt: "almost whispering",
            text: "First",
            playAcrossSlides: false,
          },
        ],
      },
    ]);

    expect(generateSpeech).toHaveBeenCalledWith("First", narratorVoice, "almost whispering");
  });

  it("previews selected text with its section's effective speaker and inline prompt", async () => {
    const { preparation, generateSpeech } = createPreparation();

    await expect(
      preparation.preparePreview({
        slideIndex: toSlideIndex(1),
        sectionIndex: 1,
        sections: [
          { speaker: "Narrator", text: "First", playAcrossSlides: false },
          {
            speaker: "",
            prompt: "wearily",
            text: "Second sentence and more",
            playAcrossSlides: false,
          },
        ],
        text: "Second sentence",
        speakerChoice: { kind: "effective" },
      }),
    ).resolves.toEqual({ audio: new Uint8Array([1, 2, 3]), mediaType: "audio/mpeg" });
    expect(generateSpeech).toHaveBeenCalledWith("Second sentence", narratorVoice, "wearily");
  });

  it("prepares a batch from structured sections without parsing note text", async () => {
    const { preparation, generateSpeech } = createPreparation();

    await expect(
      prepareBatch(preparation, [
        {
          slideIndex: toSlideIndex(2),
          sections: [
            { speaker: "Narrator", text: "First", playAcrossSlides: false },
            { speaker: "", text: "   ", playAcrossSlides: false },
            { speaker: "", text: "Third", playAcrossSlides: false },
          ],
        },
      ]),
    ).resolves.toEqual([
      {
        slideIndex: 2,
        sectionIndex: 0,
        audioData: new Uint8Array([1, 2, 3]),
        playAcrossSlides: false,
      },
      {
        slideIndex: 2,
        sectionIndex: 2,
        audioData: new Uint8Array([1, 2, 3]),
        playAcrossSlides: false,
      },
    ]);
    expect(generateSpeech.mock.calls.map(([text]) => text)).toEqual(["First", "Third"]);
  });
});
