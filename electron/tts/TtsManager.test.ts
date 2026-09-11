import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TtsProvider, TtsProviderRegistry, Voice } from "./TtsProvider.js";
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
  return {
    ...actual,
    default: actual,
    renameSync: (from: string, to: string) => {
      if (interruptNextCachePublish.value) {
        interruptNextCachePublish.value = false;
        throw new Error("interrupted");
      }
      actual.renameSync(from, to);
    },
  };
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
  voices: Voice[] = [],
): TtsProvider & { generateSpeech: ReturnType<typeof vi.fn> } {
  const generateSpeech = vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3]));
  return {
    getVoices: vi.fn().mockResolvedValue(voices),
    prepareSpeech: (text, voice) => ({
      cacheIdentity: { text, voice: voice.name },
      encoding: { fileExtension: "mp3", mediaType: "audio/mpeg" },
      synthesize: () => generateSpeech(text, voice),
    }),
    generateSpeech,
  };
}

const gcpVoice: Voice = {
  name: "en-US-Chirp3-HD-Aoede",
  languageCodes: ["en-US"],
  ssmlGender: "FEMALE",
  provider: "gcp",
};

const localVoice: Voice = {
  name: "en_UK/apope_low",
  languageCodes: ["en-GB"],
  ssmlGender: "MALE",
  provider: "local",
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
    const manager = new TtsManager(new Map([["gcp", provider]]), "gcp", { cacheDirectory });

    await manager.generateSpeech("../../unsafe / narration\0", gcpVoice);

    expect(fs.readdirSync(cacheDirectory)).toEqual([expect.stringMatching(/^[a-f0-9]{64}\.mp3$/)]);
  });

  it("names cache entries for the provider's actual output encoding", async () => {
    const wavProvider: TtsProvider = {
      getVoices: vi.fn().mockResolvedValue([]),
      prepareSpeech: (text, voice) => ({
        cacheIdentity: { text, voice: voice.name },
        encoding: { fileExtension: "wav", mediaType: "audio/wav" },
        synthesize: async () => new Uint8Array([1, 2, 3]),
      }),
    };
    const cacheDirectory = path.join(tempDir, "narration");
    const manager = new TtsManager(new Map([["local", wavProvider]]), "local", { cacheDirectory });

    await expect(manager.generateSpeech("Local narration", localVoice)).resolves.toEqual({
      audio: new Uint8Array([1, 2, 3]),
      mediaType: "audio/wav",
    });
    expect(fs.readdirSync(cacheDirectory)).toEqual([expect.stringMatching(/^[a-f0-9]{64}\.wav$/)]);
  });

  it("never serves an entry whose write was interrupted", async () => {
    const provider = createProvider();
    const cacheDirectory = path.join(tempDir, "narration");
    const manager = new TtsManager(new Map([["gcp", provider]]), "gcp", { cacheDirectory });
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

  it("reuses a cached entry instead of synthesizing a repeated request", async () => {
    const provider = createProvider();
    const cacheDirectory = path.join(tempDir, "narration");
    const manager = new TtsManager(new Map([["gcp", provider]]), "gcp", { cacheDirectory });

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
    await new TtsManager(new Map([["gcp", first]]), "gcp", { cacheDirectory }).generateSpeech(
      "Persistent narration",
      gcpVoice,
    );

    const restarted = createProvider();
    restarted.generateSpeech.mockRejectedValue(new Error("cache miss"));

    await expect(
      new TtsManager(new Map([["gcp", restarted]]), "gcp", { cacheDirectory }).generateSpeech(
        "Persistent narration",
        gcpVoice,
      ),
    ).resolves.toEqual({ audio: new Uint8Array([4, 5, 6]), mediaType: "audio/mpeg" });
    expect(restarted.generateSpeech).not.toHaveBeenCalled();
  });

  it("identifies cache entries from the normalized provider request", async () => {
    const synthesize = vi.fn().mockResolvedValue(new Uint8Array([3, 2, 1]));
    const provider: TtsProvider = {
      getVoices: vi.fn().mockResolvedValue([]),
      prepareSpeech: (text, voice) => ({
        cacheIdentity: {
          input: { ssml: text.startsWith("<speak>") ? text : `<speak>${text}</speak>` },
          voice: { languageCode: voice.languageCodes[0] ?? "", name: voice.name },
        },
        encoding: { fileExtension: "mp3", mediaType: "audio/mpeg" },
        synthesize,
      }),
    };
    const cacheDirectory = path.join(tempDir, "narration");
    const manager = new TtsManager(new Map([["gcp", provider]]), "gcp", { cacheDirectory });

    await manager.generateSpeech('Hello <break time="250ms"/>world', gcpVoice);
    await manager.generateSpeech('<speak>Hello <break time="250ms"/>world</speak>', gcpVoice);

    expect(synthesize).toHaveBeenCalledOnce();
  });

  it("does not reuse an entry when the prepared request changes", async () => {
    let audioEncoding = "MP3";
    const synthesize = vi.fn().mockResolvedValue(new Uint8Array([1]));
    const provider: TtsProvider = {
      getVoices: vi.fn().mockResolvedValue([]),
      prepareSpeech: (text, voice) => {
        const preparedEncoding = audioEncoding;
        return {
          cacheIdentity: { input: { text }, voice: voice.name, audioEncoding: preparedEncoding },
          encoding: { fileExtension: "mp3", mediaType: "audio/mpeg" },
          synthesize: () => synthesize(preparedEncoding),
        };
      },
    };
    const cacheDirectory = path.join(tempDir, "narration");
    const manager = new TtsManager(new Map([["gcp", provider]]), "gcp", { cacheDirectory });

    await manager.generateSpeech("Settings", gcpVoice);
    audioEncoding = "LINEAR16";
    await manager.generateSpeech("Settings", gcpVoice);

    expect(synthesize).toHaveBeenNthCalledWith(1, "MP3");
    expect(synthesize).toHaveBeenNthCalledWith(2, "LINEAR16");
  });

  it("combines simultaneous requests for the same narration", async () => {
    let finishSynthesis: (audio: Uint8Array) => void = () => {};
    const synthesize = vi.fn(
      () =>
        new Promise<Uint8Array>((resolve) => {
          finishSynthesis = resolve;
        }),
    );
    const provider: TtsProvider = {
      getVoices: vi.fn().mockResolvedValue([]),
      prepareSpeech: (text, voice) => ({
        cacheIdentity: { text, voice: voice.name },
        encoding: { fileExtension: "mp3", mediaType: "audio/mpeg" },
        synthesize,
      }),
    };
    const cacheDirectory = path.join(tempDir, "narration");
    const manager = new TtsManager(new Map([["gcp", provider]]), "gcp", { cacheDirectory });

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
    const manager = new TtsManager(new Map([["gcp", provider]]), "gcp", { cacheDirectory });

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
      getVoices: vi.fn().mockResolvedValue([]),
      prepareSpeech: (text) => ({
        cacheIdentity: { text },
        encoding: { fileExtension: "mp3", mediaType: "audio/mpeg" },
        synthesize: () =>
          new Promise<Uint8Array>((resolve) => {
            starts.push(text);
            pending.set(text, resolve);
          }),
      }),
    };
    const cacheDirectory = path.join(tempDir, "narration");
    const manager = new TtsManager(new Map([["gcp", provider]]), "gcp", { cacheDirectory });

    const first = manager.generateSpeech("First", gcpVoice);
    const second = manager.generateSpeech("Second", gcpVoice);
    await vi.waitFor(() => expect(starts).toEqual(["First", "Second"]));

    pending.get("Second")?.(new Uint8Array([2]));
    pending.get("First")?.(new Uint8Array([1]));
    await expect(first).resolves.toMatchObject({ audio: new Uint8Array([1]) });
    await expect(second).resolves.toMatchObject({ audio: new Uint8Array([2]) });
  });

  it("routes a concrete voice to its provider regardless of the configured preference", async () => {
    const gcp = createProvider();
    const local = createProvider();
    const manager = new TtsManager(
      new Map([
        ["gcp", gcp],
        ["local", local],
      ]),
      "local",
    );

    await manager.generateSpeech("A unique routing request", gcpVoice);

    expect(gcp.generateSpeech).toHaveBeenCalledWith("A unique routing request", gcpVoice);
    expect(local.generateSpeech).not.toHaveBeenCalled();
  });

  it("rejects an unregistered configured default", () => {
    expect(() => new TtsManager(new Map([["gcp", createProvider()]]), "local")).toThrow(
      "TTS Provider 'local' is not registered.",
    );
  });

  it("rejects a voice whose provider is absent from the registry", async () => {
    const manager = new TtsManager(new Map([["gcp", createProvider()]]), "gcp");

    await expect(manager.generateSpeech("Unavailable provider", localVoice)).rejects.toThrow(
      "TTS Provider 'local' is not registered.",
    );
  });

  it("rejects a supplied runtime voice without a provider instead of using the default", async () => {
    const gcp = createProvider();
    const manager = new TtsManager(new Map([["gcp", gcp]]), "gcp");
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
    let releaseGcp: (voices: Voice[]) => void = () => {};
    let releaseLocal: (voices: Voice[]) => void = () => {};
    const starts: string[] = [];
    const gcp = createProvider();
    const local = createProvider();
    vi.mocked(gcp.getVoices).mockImplementation(
      () =>
        new Promise((resolve) => {
          starts.push("gcp");
          releaseGcp = resolve;
        }),
    );
    vi.mocked(local.getVoices).mockImplementation(
      () =>
        new Promise((resolve) => {
          starts.push("local");
          releaseLocal = resolve;
        }),
    );
    const manager = new TtsManager(
      new Map([
        ["gcp", gcp],
        ["local", local],
      ]),
      "gcp",
    );

    const voicesPromise = manager.getVoices();
    expect(starts).toEqual(["gcp", "local"]);

    releaseLocal([localVoice]);
    releaseGcp([gcpVoice]);
    await expect(voicesPromise).resolves.toEqual([gcpVoice, localVoice]);
  });

  it("keeps healthy voices and identifies a failed provider in the log", async () => {
    const failure = new Error("credentials unavailable");
    const gcp = createProvider();
    const local = createProvider([localVoice]);
    vi.mocked(gcp.getVoices).mockRejectedValue(failure);
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    const registry: TtsProviderRegistry = new Map([
      ["gcp", gcp],
      ["local", local],
    ]);

    await expect(new TtsManager(registry, "gcp").getVoices()).resolves.toEqual([localVoice]);
    expect(errorLog).toHaveBeenCalledWith("Failed fetching voices from provider 'gcp':", failure);
  });
});
