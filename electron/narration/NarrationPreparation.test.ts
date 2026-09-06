import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TtsProvider, Voice } from "../tts/TtsProvider.js";
import { TtsManager } from "../tts/TtsManager.js";
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

const temporaryDirectories: string[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

function createCachedPreparation(provider: TtsProvider, cacheDirectory?: string) {
  const directory =
    cacheDirectory ?? fs.mkdtempSync(path.join(os.tmpdir(), "power-narrator-preparation-"));
  if (!cacheDirectory) {
    temporaryDirectories.push(directory);
  }
  const synthesizer = new TtsManager(new Map([["gcp", provider]]), "gcp", {
    cacheDirectory: directory,
  });
  return new NarrationPreparation(
    { getSpeakerMappings: () => ({ Narrator: narratorVoice }) },
    synthesizer,
  );
}

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
  it("reuses cached narration for a repeated prepared request", async () => {
    const generateSpeech = vi.fn().mockResolvedValue(new Uint8Array([7, 8, 9]));
    const provider: TtsProvider = {
      getVoices: vi.fn().mockResolvedValue([]),
      prepareSpeech: (text, voice) => ({
        cacheIdentity: { text, voice: voice?.name ?? null },
        synthesize: () => generateSpeech(text, voice),
      }),
    };
    const preparation = createCachedPreparation(provider);
    const request = {
      slideIndex: 2,
      sectionIndex: 0,
      notes: "[Narrator]\nHello",
      text: " Hello ",
    };

    await expect(preparation.preparePreview(request)).resolves.toEqual(new Uint8Array([7, 8, 9]));
    await expect(preparation.preparePreview(request)).resolves.toEqual(new Uint8Array([7, 8, 9]));

    expect(generateSpeech).toHaveBeenCalledOnce();
  });

  it("reuses cached narration after narration preparation is recreated", async () => {
    const cacheDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "power-narrator-preparation-"));
    temporaryDirectories.push(cacheDirectory);
    const firstProvider: TtsProvider = {
      getVoices: vi.fn().mockResolvedValue([]),
      prepareSpeech: (text, voice) => ({
        cacheIdentity: { text, voice: voice?.name ?? null },
        synthesize: vi.fn().mockResolvedValue(new Uint8Array([4, 5, 6])),
      }),
    };
    const request = {
      slideIndex: 1,
      sectionIndex: 0,
      notes: "[Narrator]\nPersistent",
      text: "Persistent",
    };

    await createCachedPreparation(firstProvider, cacheDirectory).preparePreview(request);

    const generateAfterRestart = vi.fn().mockRejectedValue(new Error("cache miss"));
    const restartedProvider: TtsProvider = {
      getVoices: vi.fn().mockResolvedValue([]),
      prepareSpeech: (text, voice) => ({
        cacheIdentity: { text, voice: voice?.name ?? null },
        synthesize: generateAfterRestart,
      }),
    };
    await expect(
      createCachedPreparation(restartedProvider, cacheDirectory).preparePreview(request),
    ).resolves.toEqual(new Uint8Array([4, 5, 6]));
    expect(generateAfterRestart).not.toHaveBeenCalled();
  });

  it("identifies cache entries from the normalized provider request", async () => {
    const generateSpeech = vi.fn().mockResolvedValue(new Uint8Array([3, 2, 1]));
    const provider: TtsProvider = {
      getVoices: vi.fn().mockResolvedValue([]),
      prepareSpeech: (text: string, voice: Voice) => ({
        cacheIdentity: {
          input: {
            ssml: text.startsWith("<speak>") ? text : `<speak>${text}</speak>`,
          },
          voice: { languageCode: voice.languageCodes[0] ?? "", name: voice.name },
          audioConfig: { audioEncoding: "MP3" },
        },
        synthesize: () => generateSpeech(text, voice),
      }),
    };
    const preparation = createCachedPreparation(provider);

    await preparation.preparePreview({
      slideIndex: 1,
      sectionIndex: 0,
      notes: "[Narrator]\nHello",
      text: 'Hello <break time="250ms"/>world',
    });
    await preparation.preparePreview({
      slideIndex: 1,
      sectionIndex: 0,
      notes: "[Narrator]\nHello",
      text: '<speak>Hello <break time="250ms"/>world</speak>',
    });

    expect(generateSpeech).toHaveBeenCalledOnce();
  });

  it("does not reuse narration when the prepared audio request changes", async () => {
    let audioEncoding = "MP3";
    const generateSpeech = vi.fn().mockResolvedValue(new Uint8Array([1]));
    const provider: TtsProvider = {
      getVoices: vi.fn().mockResolvedValue([]),
      prepareSpeech: (text, voice) => {
        const preparedEncoding = audioEncoding;
        return {
          cacheIdentity: {
            input: { text },
            voice: voice?.name ?? null,
            audioEncoding: preparedEncoding,
          },
          synthesize: () => generateSpeech(preparedEncoding),
        };
      },
    };
    const preparation = createCachedPreparation(provider);
    const request = {
      slideIndex: 1,
      sectionIndex: 0,
      notes: "[Narrator]\nSettings",
      text: "Settings",
    };

    await preparation.preparePreview(request);
    audioEncoding = "LINEAR16";
    await preparation.preparePreview(request);

    expect(generateSpeech).toHaveBeenNthCalledWith(1, "MP3");
    expect(generateSpeech).toHaveBeenNthCalledWith(2, "LINEAR16");
  });

  it("combines simultaneous requests for the same narration", async () => {
    let finishSynthesis: (audio: Uint8Array) => void = () => {};
    const generateSpeech = vi.fn(
      () =>
        new Promise<Uint8Array>((resolve) => {
          finishSynthesis = resolve;
        }),
    );
    const provider: TtsProvider = {
      getVoices: vi.fn().mockResolvedValue([]),
      prepareSpeech: (text, voice) => ({
        cacheIdentity: { text, voice: voice?.name ?? null },
        synthesize: () => generateSpeech(),
      }),
    };
    const cacheDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "power-narrator-preparation-"));
    temporaryDirectories.push(cacheDirectory);
    const preparation = createCachedPreparation(provider, cacheDirectory);
    const request = {
      slideIndex: 1,
      sectionIndex: 0,
      notes: "[Narrator]\nShared",
      text: "Shared",
    };

    const preview = preparation.preparePreview(request);
    const save = preparation.prepareBatch([{ slideIndex: 1, notes: request.notes }]);
    await vi.waitFor(() => expect(generateSpeech).toHaveBeenCalledOnce());

    finishSynthesis(new Uint8Array([5, 5, 5]));
    await expect(preview).resolves.toEqual(new Uint8Array([5, 5, 5]));
    await expect(save).resolves.toEqual([
      { index: 1, sectionIndex: 0, audioData: new Uint8Array([5, 5, 5]) },
    ]);
    expect(fs.readdirSync(cacheDirectory)).toHaveLength(1);
  });

  it("retries narration after a shared pending request fails", async () => {
    const generateSpeech = vi
      .fn()
      .mockRejectedValueOnce(new Error("temporary outage"))
      .mockResolvedValueOnce(new Uint8Array([9, 9, 9]));
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    const provider: TtsProvider = {
      getVoices: vi.fn().mockResolvedValue([]),
      prepareSpeech: (text, voice) => ({
        cacheIdentity: { text, voice: voice?.name ?? null },
        synthesize: () => generateSpeech(),
      }),
    };
    const preparation = createCachedPreparation(provider);
    const request = {
      slideIndex: 1,
      sectionIndex: 0,
      notes: "[Narrator]\nRetry me",
      text: "Retry me",
    };

    const firstPreview = preparation.preparePreview(request);
    const firstSave = preparation.prepareBatch([{ slideIndex: 1, notes: request.notes }]);
    await expect(firstPreview).rejects.toThrow("temporary outage");
    await expect(firstSave).rejects.toThrow("temporary outage");

    await expect(preparation.preparePreview(request)).resolves.toEqual(new Uint8Array([9, 9, 9]));
    expect(generateSpeech).toHaveBeenCalledTimes(2);
    expect(errorLog).toHaveBeenCalledOnce();
  });

  it("starts unrelated narration requests without waiting for each other", async () => {
    const pending = new Map<string, (audio: Uint8Array) => void>();
    const starts: string[] = [];
    const provider: TtsProvider = {
      getVoices: vi.fn().mockResolvedValue([]),
      prepareSpeech: (text) => ({
        cacheIdentity: { text },
        synthesize: () =>
          new Promise<Uint8Array>((resolve) => {
            starts.push(text);
            pending.set(text, resolve);
          }),
      }),
    };
    const preparation = createCachedPreparation(provider);

    const batch = preparation.prepareBatch([
      { slideIndex: 1, notes: "[Narrator]\nFirst\n---\nSecond" },
    ]);
    await vi.waitFor(() => expect(starts).toEqual(["First", "Second"]));

    pending.get("Second")?.(new Uint8Array([2]));
    pending.get("First")?.(new Uint8Array([1]));
    await expect(batch).resolves.toEqual([
      { index: 1, sectionIndex: 0, audioData: new Uint8Array([1]) },
      { index: 1, sectionIndex: 1, audioData: new Uint8Array([2]) },
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
