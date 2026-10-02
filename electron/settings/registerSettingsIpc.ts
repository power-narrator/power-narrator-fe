import fs from "node:fs";
import type { IpcMain } from "electron";
import type { Result } from "../../shared/types/result.js";
import type { SelectGcpKeyResult, Settings, VoicePreview } from "../../shared/types/settings.js";
import type { SpeakerMapping } from "../../shared/types/tts.js";
import type { TtsProvider, TtsProviderRegistry } from "../tts/TtsProvider.js";

const GCP_PROVIDER_ID = "gcp";

/** `set` must persist all of its values or none of them. */
export type SettingsStore = {
  get(key: string): unknown;
  set(values: Record<string, unknown>): void;
};

export type SettingsAdapters = {
  store: SettingsStore;
  pickKeyFile: () => Promise<string | null>;
  voiceProviders: TtsProviderRegistry;
  /** Creates a Google Cloud provider for a key that is not saved. */
  createGcpProvider: (keyPath: string) => TtsProvider;
};

function gcpKeyProblem(keyPath: string): string | null {
  try {
    const content = JSON.parse(fs.readFileSync(keyPath, "utf8")) as { type?: string };
    return content.type === "service_account" ? null : "Invalid Service Account Key JSON";
  } catch (err: unknown) {
    return err instanceof SyntaxError ? "Invalid JSON file" : "Error reading file";
  }
}

function readSettings(store: SettingsStore): Settings {
  return {
    gcpKeyPath: (store.get("gcpKeyPath") as string | undefined) ?? null,
    speakerMappings: (store.get("speakerMappings") as Record<string, SpeakerMapping>) ?? {},
    xmlCliEnabled: Boolean(store.get("xmlCliEnabled")),
  };
}

export function registerSettingsIpc(
  ipc: Pick<IpcMain, "handle">,
  { store, pickKeyFile, voiceProviders, createGcpProvider }: SettingsAdapters,
): void {
  ipc.handle("get-settings", (): Settings => readSettings(store));

  ipc.handle("select-gcp-key", async (): Promise<SelectGcpKeyResult> => {
    const keyPath = await pickKeyFile();
    if (!keyPath) {
      return { success: true, path: null };
    }

    const problem = gcpKeyProblem(keyPath);
    return problem ? { success: false, message: problem } : { success: true, path: keyPath };
  });

  ipc.handle("preview-voices", async (_, keyPath: string): Promise<VoicePreview> => {
    let failure: string | null = null;
    const voiceLists = await Promise.all(
      Array.from(voiceProviders, async ([providerId, provider]) => {
        const staged = providerId === GCP_PROVIDER_ID;
        try {
          return await (staged ? createGcpProvider(keyPath) : provider).getVoices();
        } catch (error: unknown) {
          if (staged) {
            failure = error instanceof Error ? error.message : String(error);
          } else {
            console.error(`Failed fetching voices from provider '${providerId}':`, error);
          }
          return [];
        }
      }),
    );
    return { voices: voiceLists.flat(), failure };
  });

  ipc.handle("save-settings", (_, settings: Settings): Result => {
    const { gcpKeyPath, speakerMappings, xmlCliEnabled } = settings;
    if (gcpKeyPath && gcpKeyPath !== readSettings(store).gcpKeyPath) {
      const problem = gcpKeyProblem(gcpKeyPath);
      if (problem) {
        return { success: false, message: problem };
      }
    }

    try {
      store.set({ speakerMappings, xmlCliEnabled, ...(gcpKeyPath ? { gcpKeyPath } : {}) });
    } catch (err: unknown) {
      return { success: false, message: err instanceof Error ? err.message : String(err) };
    }
    return { success: true };
  });
}
