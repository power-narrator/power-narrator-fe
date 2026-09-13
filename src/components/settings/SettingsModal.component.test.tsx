import { MantineProvider } from "@mantine/core";
import { afterEach, expect, test, vi } from "vitest";
import { render } from "vitest-browser-react";
import type { SpeakerMapping, VoiceOption } from "../../../shared/types/tts";
import { SettingsProvider } from "../../context/SettingsContext";
import { SettingsModal } from "./SettingsModal";

const registryOption: VoiceOption = {
  provider: "future-provider",
  name: "future-voice",
  ssmlGender: "NEUTRAL",
  models: [
    {
      id: "future-model",
      label: "Future",
      supportsPrompt: true,
      languages: [{ code: "en-US", label: "en-US" }],
    },
  ],
};

const gcpOption: VoiceOption = {
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

const gcpVoice = {
  provider: "gcp",
  voiceId: "Aoede",
  model: "chirp-3-hd",
  languageCode: "en-US",
  supportsPrompt: false,
} as const;

afterEach(() => {
  vi.restoreAllMocks();
  Reflect.deleteProperty(window, "electronAPI");
});

test("creates a mapping from the voices exposed by the provider registry", async () => {
  const savedMappings: Record<string, SpeakerMapping>[] = [];
  Object.defineProperty(window, "electronAPI", {
    configurable: true,
    value: {
      getSpeakerMappings: () => Promise.resolve({}),
      setSpeakerMappings: (mappings: Record<string, SpeakerMapping>) => {
        savedMappings.push(mappings);
        return Promise.resolve({ success: true });
      },
      getGcpKeyPath: () => Promise.resolve(null),
      getVoices: () => Promise.resolve([registryOption]),
      getXmlCliEnabled: () => Promise.resolve(false),
      setXmlCliEnabled: () => Promise.resolve({ success: true }),
    },
  });

  const screen = await render(
    <MantineProvider>
      <SettingsProvider>
        <SettingsModal opened onClose={() => {}} />
      </SettingsProvider>
    </MantineProvider>,
  );

  await vi.waitFor(() =>
    expect(screen.getByText("future-provider", { exact: true }).query()).not.toBeNull(),
  );
  await screen.getByPlaceholder("New alias (e.g. speaker 1)").fill("Narrator");
  await screen.getByRole("button", { name: "Add Mapping" }).click();
  await vi.waitFor(() => expect(savedMappings).toHaveLength(1));

  expect(savedMappings[0]).toEqual({ Narrator: {} });
  expect(screen.getByText("Local TTS").query()).toBeNull();
});

test("replaces a persisted mapping whose provider is no longer registered", async () => {
  const savedMappings: Record<string, SpeakerMapping>[] = [];
  const staleMapping: SpeakerMapping = {
    voice: {
      provider: "local",
      voiceId: "apope_low",
      model: "local-1",
      languageCode: "en-GB",
      supportsPrompt: false,
    },
  };
  Object.defineProperty(window, "electronAPI", {
    configurable: true,
    value: {
      getSpeakerMappings: () => Promise.resolve({ Narrator: staleMapping }),
      setSpeakerMappings: (mappings: Record<string, SpeakerMapping>) => {
        savedMappings.push(mappings);
        return Promise.resolve({ success: true });
      },
      getGcpKeyPath: () => Promise.resolve(null),
      getVoices: () => Promise.resolve([gcpOption]),
      getXmlCliEnabled: () => Promise.resolve(false),
      setXmlCliEnabled: () => Promise.resolve({ success: true }),
    },
  });

  const screen = await render(
    <MantineProvider>
      <SettingsProvider>
        <SettingsModal opened onClose={() => {}} />
      </SettingsProvider>
    </MantineProvider>,
  );

  await vi.waitFor(() => expect(screen.getByText("[Narrator]").query()).not.toBeNull());
  const mappingSelector = screen.getByRole("combobox").nth(1);
  await mappingSelector.click();
  await screen.getByRole("option", { name: /Aoede/ }).click();

  await vi.waitFor(() => expect(savedMappings).toContainEqual({ Narrator: { voice: gcpVoice } }));
});
