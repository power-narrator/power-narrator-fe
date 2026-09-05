import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TtsProvider, TtsProviderRegistry, Voice } from "./TtsProvider.js";
import { TtsManager } from "./TtsManager.js";

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

function createProvider(voices: Voice[] = []): TtsProvider {
  return {
    getVoices: vi.fn().mockResolvedValue(voices),
    generateSpeech: vi.fn().mockResolvedValue(null),
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
