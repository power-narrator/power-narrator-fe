import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Mock } from "vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TtsProvider, TtsProviderRegistry, Voice, VoiceOption } from "./TtsProvider.js";
import { getNarrationCacheDirectory, TtsManager } from "./TtsManager.js";

const { getUserDataPath, interruptNextCachePublish } = vi.hoisted(() => ({
  getUserDataPath: vi.fn<() => string>(),
  interruptNextCachePublish: { value: false },
}));

vi.mock("electron", () => ({
  app: { getPath: getUserDataPath },
}));

// Lets one cache publication fail the way a crash or power loss would.
vi.mock("fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("fs")>();
  const mocked = {
    ...actual,
    renameSync: (from: string, to: string) => {
      if (interruptNextCachePublish.value) {
        interruptNextCachePublish.value = false;
        throw new Error("interrupted");
      }
      actual.renameSync(from, to);
    },
  };
  // `default` must carry the overrides too, so the mock applies whether the
  // subject uses a namespace import or a default import.
  return { ...mocked, default: mocked };
});

let tempDir: string;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "power-narrator-tts-manager-"));
  getUserDataPath.mockReturnValue(tempDir);
});

afterEach(() => {
  vi.restoreAllMocks();
  interruptNextCachePublish.value = false;
  fs.rmSync(tempDir, { recursive: true, force: true });
});

function createProvider(
  voices: VoiceOption[] = [],
): TtsProvider & { generateSpeech: Mock<(text: string, voice: Voice) => Promise<Uint8Array>> } {
  const generateSpeech = vi
    .fn<(text: string, voice: Voice) => Promise<Uint8Array>>()
    .mockResolvedValue(new Uint8Array([1, 2, 3]));
  return {
    getVoices: vi.fn<TtsProvider["getVoices"]>().mockResolvedValue(voices),
    prepareSpeech: (text, voice) => ({
      cacheIdentity: { text, voice: voice.voiceId },
      synthesize: () => generateSpeech(text, voice),
    }),
    generateSpeech,
  };
}

const gcpVoice: Voice = {
  provider: "gcp",
  voiceId: "Aoede",
  model: "chirp-3-hd",
  languageCode: "en-US",
  supportsPrompt: false,
};

const futureVoice: Voice = {
  provider: "future-provider",
  voiceId: "future-voice",
  model: "future-model",
  languageCode: "en-US",
  supportsPrompt: true,
};

const gcpVoiceOption: VoiceOption = {
  provider: "gcp",
  name: "Aoede",
  ssmlGender: "FEMALE",
  models: [
    {
      id: "chirp-3-hd",
      label: "Chirp 3 HD",
      supportsPrompt: false,
      languages: [{ code: "en-US", label: "en-US" }],
    },
  ],
};

const futureVoiceOption: VoiceOption = {
  provider: "future-provider",
  name: "future-voice",
  ssmlGender: "NEUTRAL",
  models: [{ id: "future-model", label: "Future", supportsPrompt: true, languages: [] }],
};

const legacyLocalVoice: Voice = {
  provider: "local",
  voiceId: "apope_low",
  model: "local-1",
  languageCode: "en-GB",
  supportsPrompt: false,
};

describe("TtsManager", () => {
  it.each([
    ["darwin", {}, path.join("/users/example", "Library", "Caches", "power-narrator", "narration")],
    ["linux", {}, path.join("/users/example", ".cache", "power-narrator", "narration")],
    [
      "linux",
      { XDG_CACHE_HOME: "/var/cache/example" },
      path.join("/var/cache/example", "power-narrator", "narration"),
    ],
    [
      "linux",
      { XDG_CACHE_HOME: "relative-cache" },
      path.join("/users/example", ".cache", "power-narrator", "narration"),
    ],
    [
      "win32",
      { LOCALAPPDATA: "C:\\Users\\example\\AppData\\Local" },
      path.win32.join("C:\\Users\\example\\AppData\\Local", "power-narrator", "Cache", "narration"),
    ],
    [
      "win32",
      {},
      path.win32.join("/users/example", "AppData", "Local", "power-narrator", "Cache", "narration"),
    ],
    [
      "win32",
      { LOCALAPPDATA: "relative\\cache" },
      path.win32.join("/users/example", "AppData", "Local", "power-narrator", "Cache", "narration"),
    ],
  ] as const)(
    "uses the conventional %s application cache location",
    (platform, environment, expected) => {
      expect(
        getNarrationCacheDirectory("/users/example", platform, environment as NodeJS.ProcessEnv),
      ).toBe(expected);
    },
  );

  it("writes cache entries with hashed safe filenames", async () => {
    const provider = createProvider();
    provider.generateSpeech.mockResolvedValue(new Uint8Array([1, 2, 3]));
    const cacheDirectory = path.join(tempDir, "narration");
    const manager = new TtsManager(new Map([["gcp", provider]]), cacheDirectory);

    await manager.generateSpeech("../../unsafe / narration\0", gcpVoice);

    expect(fs.readdirSync(cacheDirectory)).toEqual([expect.stringMatching(/^[a-f0-9]{64}\.mp3$/)]);
  });

  it("stores output from every registered provider as PowerPoint-compatible MP3", async () => {
    const futureProvider: TtsProvider = {
      getVoices: vi.fn<TtsProvider["getVoices"]>().mockResolvedValue([]),
      prepareSpeech: (text, voice) => ({
        cacheIdentity: { text, voice: voice.voiceId },
        synthesize: () => Promise.resolve(new Uint8Array([1, 2, 3])),
      }),
    };
    const cacheDirectory = path.join(tempDir, "narration");
    const manager = new TtsManager(new Map([["future-provider", futureProvider]]), cacheDirectory);

    await expect(manager.generateSpeech("Future narration", futureVoice)).resolves.toEqual({
      audio: new Uint8Array([1, 2, 3]),
      mediaType: "audio/mpeg",
    });
    expect(fs.readdirSync(cacheDirectory)).toEqual([expect.stringMatching(/^[a-f0-9]{64}\.mp3$/)]);
  });

  it("never serves an entry whose write was interrupted", async () => {
    const provider = createProvider();
    const cacheDirectory = path.join(tempDir, "narration");
    const manager = new TtsManager(new Map([["gcp", provider]]), cacheDirectory);
    vi.spyOn(console, "error").mockImplementation(() => {});
    interruptNextCachePublish.value = true;

    await expect(manager.generateSpeech("Interrupted narration", gcpVoice)).resolves.toEqual({
      audio: new Uint8Array([1, 2, 3]),
      mediaType: "audio/mpeg",
    });
    expect(fs.readdirSync(cacheDirectory)).toEqual([]);

    provider.generateSpeech.mockResolvedValue(new Uint8Array([4, 5, 6]));
    await expect(manager.generateSpeech("Interrupted narration", gcpVoice)).resolves.toEqual({
      audio: new Uint8Array([4, 5, 6]),
      mediaType: "audio/mpeg",
    });
    expect(fs.readdirSync(cacheDirectory)).toEqual([expect.stringMatching(/^[a-f0-9]{64}\.mp3$/)]);
  });

  it("synthesizes again for an edited prompt rather than replaying the recording", async () => {
    const synthesize = vi.fn<() => Promise<Uint8Array>>().mockResolvedValue(new Uint8Array([1]));
    const promptProvider: TtsProvider = {
      getVoices: vi.fn<TtsProvider["getVoices"]>().mockResolvedValue([]),
      prepareSpeech: (text, voice, prompt) => ({
        cacheIdentity: { text, voice: voice.voiceId, prompt: prompt ?? null },
        synthesize,
      }),
    };
    const manager = new TtsManager(
      new Map([["gcp", promptProvider]]),
      path.join(tempDir, "narration"),
    );

    await manager.generateSpeech("Hello", gcpVoice, "whisper");
    await manager.generateSpeech("Hello", gcpVoice, "whisper");
    await manager.generateSpeech("Hello", gcpVoice, "shout");

    expect(synthesize).toHaveBeenCalledTimes(2);
  });

  it("reuses a cached entry instead of synthesizing a repeated request", async () => {
    const provider = createProvider();
    const cacheDirectory = path.join(tempDir, "narration");
    const manager = new TtsManager(new Map([["gcp", provider]]), cacheDirectory);

    await manager.generateSpeech("Repeated narration", gcpVoice);
    await expect(manager.generateSpeech("Repeated narration", gcpVoice)).resolves.toEqual({
      audio: new Uint8Array([1, 2, 3]),
      mediaType: "audio/mpeg",
    });

    expect(provider.generateSpeech).toHaveBeenCalledOnce();
  });

  it("reuses a cached entry written by an earlier session", async () => {
    const cacheDirectory = path.join(tempDir, "narration");
    const first = createProvider();
    first.generateSpeech.mockResolvedValue(new Uint8Array([4, 5, 6]));
    await new TtsManager(new Map([["gcp", first]]), cacheDirectory).generateSpeech(
      "Persistent narration",
      gcpVoice,
    );

    const restarted = createProvider();
    restarted.generateSpeech.mockRejectedValue(new Error("cache miss"));

    await expect(
      new TtsManager(new Map([["gcp", restarted]]), cacheDirectory).generateSpeech(
        "Persistent narration",
        gcpVoice,
      ),
    ).resolves.toEqual({ audio: new Uint8Array([4, 5, 6]), mediaType: "audio/mpeg" });
    expect(restarted.generateSpeech).not.toHaveBeenCalled();
  });

  it("identifies cache entries from the normalized provider request", async () => {
    const synthesize = vi
      .fn<() => Promise<Uint8Array>>()
      .mockResolvedValue(new Uint8Array([3, 2, 1]));
    const provider: TtsProvider = {
      getVoices: vi.fn<TtsProvider["getVoices"]>().mockResolvedValue([]),
      prepareSpeech: (text, voice) => ({
        cacheIdentity: {
          input: { ssml: text.startsWith("<speak>") ? text : `<speak>${text}</speak>` },
          voice: { languageCode: voice.languageCode, name: voice.voiceId },
        },
        synthesize,
      }),
    };
    const cacheDirectory = path.join(tempDir, "narration");
    const manager = new TtsManager(new Map([["gcp", provider]]), cacheDirectory);

    await manager.generateSpeech('Hello <break time="250ms"/>world', gcpVoice);
    await manager.generateSpeech('<speak>Hello <break time="250ms"/>world</speak>', gcpVoice);

    expect(synthesize).toHaveBeenCalledOnce();
  });

  it("does not reuse an entry when the prepared request changes", async () => {
    let speakingRate = 1;
    const synthesize = vi
      .fn<(speakingRate: number) => Promise<Uint8Array>>()
      .mockResolvedValue(new Uint8Array([1]));
    const provider: TtsProvider = {
      getVoices: vi.fn<TtsProvider["getVoices"]>().mockResolvedValue([]),
      prepareSpeech: (text, voice) => {
        const preparedSpeakingRate = speakingRate;
        return {
          cacheIdentity: {
            input: { text },
            voice: voice.voiceId,
            audioConfig: { audioEncoding: "MP3", speakingRate: preparedSpeakingRate },
          },
          synthesize: () => synthesize(preparedSpeakingRate),
        };
      },
    };
    const cacheDirectory = path.join(tempDir, "narration");
    const manager = new TtsManager(new Map([["gcp", provider]]), cacheDirectory);

    await manager.generateSpeech("Settings", gcpVoice);
    speakingRate = 1.25;
    await manager.generateSpeech("Settings", gcpVoice);

    expect(synthesize).toHaveBeenNthCalledWith(1, 1);
    expect(synthesize).toHaveBeenNthCalledWith(2, 1.25);
  });

  it("combines simultaneous requests for the same narration", async () => {
    let finishSynthesis: (audio: Uint8Array) => void = () => {};
    const synthesize = vi.fn<() => Promise<Uint8Array>>(
      () =>
        new Promise<Uint8Array>((resolve) => {
          finishSynthesis = resolve;
        }),
    );
    const provider: TtsProvider = {
      getVoices: vi.fn<TtsProvider["getVoices"]>().mockResolvedValue([]),
      prepareSpeech: (text, voice) => ({
        cacheIdentity: { text, voice: voice.voiceId },
        synthesize,
      }),
    };
    const cacheDirectory = path.join(tempDir, "narration");
    const manager = new TtsManager(new Map([["gcp", provider]]), cacheDirectory);

    const first = manager.generateSpeech("Shared", gcpVoice);
    const second = manager.generateSpeech("Shared", gcpVoice);
    await vi.waitFor(() => expect(synthesize).toHaveBeenCalledOnce());

    finishSynthesis(new Uint8Array([5, 5, 5]));
    await expect(first).resolves.toEqual({
      audio: new Uint8Array([5, 5, 5]),
      mediaType: "audio/mpeg",
    });
    await expect(second).resolves.toEqual({
      audio: new Uint8Array([5, 5, 5]),
      mediaType: "audio/mpeg",
    });
    expect(fs.readdirSync(cacheDirectory)).toHaveLength(1);
  });

  it("synthesizes again after a shared pending request fails", async () => {
    const provider = createProvider();
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    provider.generateSpeech
      .mockRejectedValueOnce(new Error("temporary outage"))
      .mockResolvedValueOnce(new Uint8Array([9, 9, 9]));
    const cacheDirectory = path.join(tempDir, "narration");
    const manager = new TtsManager(new Map([["gcp", provider]]), cacheDirectory);

    const first = manager.generateSpeech("Retry me", gcpVoice);
    const second = manager.generateSpeech("Retry me", gcpVoice);
    await expect(first).rejects.toThrow("temporary outage");
    await expect(second).rejects.toThrow("temporary outage");

    await expect(manager.generateSpeech("Retry me", gcpVoice)).resolves.toEqual({
      audio: new Uint8Array([9, 9, 9]),
      mediaType: "audio/mpeg",
    });
    expect(provider.generateSpeech).toHaveBeenCalledTimes(2);
    expect(errorLog).toHaveBeenCalledOnce();
  });

  it("starts unrelated requests without waiting for each other", async () => {
    const pending = new Map<string, (audio: Uint8Array) => void>();
    const starts: string[] = [];
    const provider: TtsProvider = {
      getVoices: vi.fn<TtsProvider["getVoices"]>().mockResolvedValue([]),
      prepareSpeech: (text) => ({
        cacheIdentity: { text },
        synthesize: () =>
          new Promise<Uint8Array>((resolve) => {
            starts.push(text);
            pending.set(text, resolve);
          }),
      }),
    };
    const cacheDirectory = path.join(tempDir, "narration");
    const manager = new TtsManager(new Map([["gcp", provider]]), cacheDirectory);

    const first = manager.generateSpeech("First", gcpVoice);
    const second = manager.generateSpeech("Second", gcpVoice);
    await vi.waitFor(() => expect(starts).toEqual(["First", "Second"]));

    pending.get("Second")?.(new Uint8Array([2]));
    pending.get("First")?.(new Uint8Array([1]));
    await expect(first).resolves.toMatchObject({ audio: new Uint8Array([1]) });
    await expect(second).resolves.toMatchObject({ audio: new Uint8Array([2]) });
  });

  it("routes a concrete voice to its provider registry entry", async () => {
    const gcp = createProvider();
    const futureProvider = createProvider();
    const manager = new TtsManager(
      new Map([
        ["gcp", gcp],
        ["future-provider", futureProvider],
      ]),
    );

    await manager.generateSpeech("A unique routing request", futureVoice);

    expect(futureProvider.generateSpeech).toHaveBeenCalledWith(
      "A unique routing request",
      futureVoice,
    );
    expect(gcp.generateSpeech).not.toHaveBeenCalled();
  });

  it("rejects a voice whose provider is absent from the registry", async () => {
    const manager = new TtsManager(new Map([["gcp", createProvider()]]));

    await expect(manager.generateSpeech("Unavailable provider", legacyLocalVoice)).rejects.toThrow(
      "TTS Provider 'local' is not registered.",
    );
  });

  it("rejects a supplied runtime voice without a provider instead of using the default", async () => {
    const gcp = createProvider();
    const manager = new TtsManager(new Map([["gcp", gcp]]));
    const voiceWithoutProvider = {
      name: "legacy-voice",
      languageCodes: ["en-US"],
      ssmlGender: "NEUTRAL",
    } as unknown as Voice;

    await expect(
      manager.generateSpeech("Malformed persisted voice", voiceWithoutProvider),
    ).rejects.toThrow("TTS Provider 'undefined' is not registered.");
    expect(gcp.generateSpeech).not.toHaveBeenCalled();
  });

  it("loads providers concurrently and retains registry order", async () => {
    let releaseGcp: (voices: VoiceOption[]) => void = () => {};
    let releaseFuture: (voices: VoiceOption[]) => void = () => {};
    const starts: string[] = [];
    const gcp = createProvider();
    const futureProvider = createProvider();
    vi.mocked(gcp.getVoices).mockImplementation(
      () =>
        new Promise((resolve) => {
          starts.push("gcp");
          releaseGcp = resolve;
        }),
    );
    vi.mocked(futureProvider.getVoices).mockImplementation(
      () =>
        new Promise((resolve) => {
          starts.push("future-provider");
          releaseFuture = resolve;
        }),
    );
    const manager = new TtsManager(
      new Map([
        ["gcp", gcp],
        ["future-provider", futureProvider],
      ]),
    );

    const voicesPromise = manager.getVoices();
    expect(starts).toEqual(["gcp", "future-provider"]);

    releaseFuture([futureVoiceOption]);
    releaseGcp([gcpVoiceOption]);
    await expect(voicesPromise).resolves.toEqual([gcpVoiceOption, futureVoiceOption]);
  });

  it("keeps healthy voices and identifies a failed provider in the log", async () => {
    const failure = new Error("credentials unavailable");
    const gcp = createProvider();
    const futureProvider = createProvider([futureVoiceOption]);
    vi.mocked(gcp.getVoices).mockRejectedValue(failure);
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    const registry: TtsProviderRegistry = new Map([
      ["gcp", gcp],
      ["future-provider", futureProvider],
    ]);

    await expect(new TtsManager(registry).getVoices()).resolves.toEqual([futureVoiceOption]);
    expect(errorLog).toHaveBeenCalledWith("Failed fetching voices from provider 'gcp':", failure);
  });
});
