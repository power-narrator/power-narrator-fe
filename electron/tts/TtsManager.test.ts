import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TtsProvider, TtsProviderRegistry, Voice } from "./TtsProvider.js";
import { getNarrationCacheDirectory, TtsManager } from "./TtsManager.js";

const { getUserDataPath } = vi.hoisted(() => ({
  getUserDataPath: vi.fn<() => string>(),
}));

vi.mock("electron", () => ({
  app: { getPath: getUserDataPath },
}));

let tempDir: string;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "power-narrator-tts-manager-"));
  getUserDataPath.mockReturnValue(tempDir);
});

afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

function createProvider(
  voices: Voice[] = [],
): TtsProvider & { generateSpeech: ReturnType<typeof vi.fn> } {
  const generateSpeech = vi.fn().mockResolvedValue(null);
  return {
    getVoices: vi.fn().mockResolvedValue(voices),
    prepareSpeech: (text, voice) => ({
      cacheIdentity: { text, voice: voice?.name ?? null },
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
      "win32",
      { LOCALAPPDATA: "C:\\Users\\example\\AppData\\Local" },
      path.join("C:\\Users\\example\\AppData\\Local", "power-narrator", "narration"),
    ],
  ] as const)(
    "uses the conventional %s application cache location",
    (platform, environment, expected) => {
      expect(
        getNarrationCacheDirectory("/users/example", platform, environment as NodeJS.ProcessEnv),
      ).toBe(expected);
    },
  );

  it("removes the obsolete configuration cache without migrating it", () => {
    const obsoleteCacheDirectory = path.join(tempDir, "user-data", "tts_cache");
    fs.mkdirSync(obsoleteCacheDirectory, { recursive: true });
    fs.writeFileSync(path.join(obsoleteCacheDirectory, "legacy.mp3"), "legacy audio");

    new TtsManager(new Map([["gcp", createProvider()]]), "gcp", {
      cacheDirectory: path.join(tempDir, "cache", "power-narrator", "narration"),
      obsoleteCacheDirectory,
    });

    expect(fs.existsSync(obsoleteCacheDirectory)).toBe(false);
  });

  it("writes cache entries with hashed safe filenames", async () => {
    const provider = createProvider();
    provider.generateSpeech.mockResolvedValue(new Uint8Array([1, 2, 3]));
    const cacheDirectory = path.join(tempDir, "narration");
    const manager = new TtsManager(new Map([["gcp", provider]]), "gcp", { cacheDirectory });

    await manager.generateSpeech("../../unsafe / narration\0", gcpVoice);

    expect(fs.readdirSync(cacheDirectory)).toEqual([expect.stringMatching(/^[a-f0-9]{64}\.mp3$/)]);
  });

  it.each([
    {
      name: "routes a supplied voice to its provider",
      defaultProvider: "local",
      voice: gcpVoice,
      selectedProvider: "gcp",
    },
    {
      name: "routes an omitted voice to the configured default",
      defaultProvider: "gcp",
      voice: undefined,
      selectedProvider: "gcp",
    },
  ] as const)("$name", async ({ defaultProvider, voice, selectedProvider }) => {
    const gcp = createProvider();
    const local = createProvider();
    const manager = new TtsManager(
      new Map([
        ["gcp", gcp],
        ["local", local],
      ]),
      defaultProvider,
    );

    await manager.generateSpeech("A unique routing request", voice);

    const selected = selectedProvider === "gcp" ? gcp : local;
    const unselected = selectedProvider === "gcp" ? local : gcp;
    expect(selected.generateSpeech).toHaveBeenCalledWith("A unique routing request", voice);
    expect(unselected.generateSpeech).not.toHaveBeenCalled();
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
