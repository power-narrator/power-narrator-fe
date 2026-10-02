import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { IpcMainInvokeEvent } from "electron";
import { afterEach, beforeEach, expect, it } from "vitest";
import type { Settings } from "../../shared/types/settings.js";
import { registerSettingsIpc } from "./registerSettingsIpc.js";

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

function registerSettingsHandlers(
  store: ReturnType<typeof createStore>["store"],
  pickKeyFile: () => Promise<string | null> = () => Promise.resolve(null),
) {
  const handlers = new Map<string, IpcHandler>();
  registerSettingsIpc(
    {
      handle: (channel: string, handler: IpcHandler) => {
        handlers.set(channel, handler);
      },
    },
    { store, pickKeyFile },
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
