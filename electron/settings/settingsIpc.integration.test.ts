import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { IpcMainInvokeEvent } from "electron";
import { afterEach, beforeEach, expect, it } from "vitest";
import type { Settings } from "../../shared/types/settings.js";
import type { VoiceOption } from "../../shared/types/tts.js";
import type { TtsProvider } from "../tts/TtsProvider.js";
import { registerSettingsIpc, type SettingsAdapters } from "./registerSettingsIpc.js";

type IpcHandler = (event: IpcMainInvokeEvent, ...args: never[]) => unknown;

const event = {} as IpcMainInvokeEvent;
let keyDirectory: string;

beforeEach(() => {
  keyDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "settings-ipc-"));
});

afterEach(() => {
  fs.rmSync(keyDirectory, { recursive: true, force: true });
});

function writeKeyFile(name: string, content: string) {
  const keyPath = path.join(keyDirectory, name);
  fs.writeFileSync(keyPath, content);
  return keyPath;
}

/** Applies a write as a whole or not at all, as electron-store does for one `set` call. */
function createStore(initial: Record<string, unknown>, failingKey?: string) {
  let data = { ...initial };
  return {
    read: () => data,
    store: {
      get: (key: string) => data[key],
      set: (values: Record<string, unknown>) => {
        const next = { ...data };
        for (const [key, value] of Object.entries(values)) {
          if (key === failingKey) throw new Error("Disk unavailable");
          next[key] = value;
        }
        data = next;
      },
    },
  };
}

function voiceOption(provider: string, name: string): VoiceOption {
  return { provider, name, ssmlGender: "NEUTRAL", models: [] };
}

function voiceProvider(getVoices: () => Promise<VoiceOption[]>): TtsProvider {
  return {
    getVoices,
    prepareSpeech: () => {
      throw new Error("Not used");
    },
  };
}

type VoiceAdapters = Pick<SettingsAdapters, "voiceProviders" | "createGcpProvider">;

const defaultVoiceAdapters: VoiceAdapters = {
  voiceProviders: new Map(),
  createGcpProvider: () => voiceProvider(() => Promise.resolve([])),
};

function registerSettingsHandlers(
  store: ReturnType<typeof createStore>["store"],
  pickKeyFile: () => Promise<string | null> = () => Promise.resolve(null),
  voiceAdapters: VoiceAdapters = defaultVoiceAdapters,
) {
  const handlers = new Map<string, IpcHandler>();
  registerSettingsIpc(
    {
      handle: (channel: string, handler: IpcHandler) => {
        handlers.set(channel, handler);
      },
    },
    { store, pickKeyFile, ...voiceAdapters },
  );
  const invoke = (channel: string, ...args: unknown[]) =>
    Promise.resolve(handlers.get(channel)!(event, ...(args as never[])));
  return { invoke };
}

const savedState = {
  gcpKeyPath: "/keys/saved.json",
  speakerMappings: { Narrator: { prompt: "Whisper" } },
  xmlCliEnabled: false,
};

it("commits every setting in the draft together", async () => {
  const newKey = writeKeyFile("new.json", JSON.stringify({ type: "service_account" }));
  const { store, read } = createStore(savedState);
  const { invoke } = registerSettingsHandlers(store);
  const draft: Settings = {
    gcpKeyPath: newKey,
    speakerMappings: { Guest: { prompt: "Shout" } },
    xmlCliEnabled: true,
  };

  await expect(invoke("save-settings", draft)).resolves.toEqual({ success: true });

  expect(read()).toEqual(draft);
  await expect(invoke("get-settings")).resolves.toEqual(draft);
});

it("validates a chosen key without saving it", async () => {
  const validKey = writeKeyFile("valid.json", JSON.stringify({ type: "service_account" }));
  const invalidKey = writeKeyFile("invalid.json", JSON.stringify({ type: "user" }));
  const picks = [null, invalidKey, validKey];
  const { store, read } = createStore(savedState);
  const { invoke } = registerSettingsHandlers(store, () => Promise.resolve(picks.shift() ?? null));

  await expect(invoke("select-gcp-key")).resolves.toEqual({ success: true, path: null });
  await expect(invoke("select-gcp-key")).resolves.toEqual({
    success: false,
    message: "Invalid Service Account Key JSON",
  });
  await expect(invoke("select-gcp-key")).resolves.toEqual({ success: true, path: validKey });

  expect(read()).toEqual(savedState);
});

it("keeps every saved setting when a commit fails", async () => {
  const newKey = writeKeyFile("new.json", JSON.stringify({ type: "service_account" }));
  const { store, read } = createStore(savedState, "xmlCliEnabled");
  const { invoke } = registerSettingsHandlers(store);

  await expect(
    invoke("save-settings", {
      gcpKeyPath: newKey,
      speakerMappings: { Guest: {} },
      xmlCliEnabled: true,
    }),
  ).resolves.toEqual({ success: false, message: "Disk unavailable" });

  expect(read()).toEqual(savedState);
});

it("refuses to commit a key that is no longer a valid service account key", async () => {
  const { store, read } = createStore(savedState);
  const { invoke } = registerSettingsHandlers(store);

  await expect(
    invoke("save-settings", {
      gcpKeyPath: writeKeyFile("broken.json", "{"),
      speakerMappings: {},
      xmlCliEnabled: true,
    }),
  ).resolves.toEqual({ success: false, message: "Invalid JSON file" });

  expect(read()).toEqual(savedState);
});

it("previews voices with a staged key without saving or activating it", async () => {
  const stagedKey = writeKeyFile("staged.json", JSON.stringify({ type: "service_account" }));
  const { store, read } = createStore(savedState);
  const stagedKeys: string[] = [];
  const { invoke } = registerSettingsHandlers(store, undefined, {
    voiceProviders: new Map([
      ["gcp", voiceProvider(() => Promise.resolve([voiceOption("gcp", "Saved-key voice")]))],
      ["local", voiceProvider(() => Promise.resolve([voiceOption("local", "Local voice")]))],
    ]),
    createGcpProvider: (keyPath) => {
      stagedKeys.push(keyPath);
      return voiceProvider(() => Promise.resolve([voiceOption("gcp", "Staged-key voice")]));
    },
  });

  await expect(invoke("preview-voices", stagedKey)).resolves.toEqual({
    voices: [voiceOption("gcp", "Staged-key voice"), voiceOption("local", "Local voice")],
    failure: null,
  });

  expect(stagedKeys).toEqual([stagedKey]);
  expect(read()).toEqual(savedState);
});

it("reports a staged key's provider failure apart from an empty catalogue", async () => {
  const stagedKey = writeKeyFile("staged.json", JSON.stringify({ type: "service_account" }));
  const stagedCatalogues = [
    () => Promise.resolve([]),
    () => Promise.reject(new Error("Network unavailable")),
  ];
  const { store } = createStore(savedState);
  const { invoke } = registerSettingsHandlers(store, undefined, {
    voiceProviders: new Map([
      ["gcp", voiceProvider(() => Promise.resolve([]))],
      ["local", voiceProvider(() => Promise.resolve([voiceOption("local", "Local voice")]))],
    ]),
    createGcpProvider: () => voiceProvider(stagedCatalogues.shift()!),
  });

  await expect(invoke("preview-voices", stagedKey)).resolves.toEqual({
    voices: [voiceOption("local", "Local voice")],
    failure: null,
  });
  await expect(invoke("preview-voices", stagedKey)).resolves.toEqual({
    voices: [voiceOption("local", "Local voice")],
    failure: "Network unavailable",
  });
});
