import { MantineProvider } from "@mantine/core";
import { afterEach, expect, test, vi } from "vitest";
import { render } from "vitest-browser-react";
import type { Voice } from "../../../shared/types/tts";
import { SettingsProvider } from "../../context/SettingsContext";
import { SettingsModal } from "./SettingsModal";

const registryVoice: Voice = {
  name: "future-voice",
  languageCodes: ["en-US"],
  ssmlGender: "NEUTRAL",
  provider: "future-provider",
};

const gcpVoice: Voice = {
  name: "en-US-Chirp3-HD-Aoede",
  languageCodes: ["en-US"],
  ssmlGender: "FEMALE",
  provider: "gcp",
};

afterEach(() => {
  vi.restoreAllMocks();
  Reflect.deleteProperty(window, "electronAPI");
});

test("creates a mapping from the voices exposed by the provider registry", async () => {
  const savedMappings: Record<string, Voice>[] = [];
  Object.defineProperty(window, "electronAPI", {
    configurable: true,
    value: {
      getSpeakerMappings: () => Promise.resolve({}),
      setSpeakerMappings: (mappings: Record<string, Voice>) => {
        savedMappings.push(mappings);
        return Promise.resolve({ success: true });
      },
      getGcpKeyPath: () => Promise.resolve(null),
      getVoices: () => Promise.resolve([registryVoice]),
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

  expect(savedMappings[0]).toEqual({
    Narrator: { name: "", languageCodes: [], ssmlGender: "", provider: "future-provider" },
  });
  expect(screen.getByText("Local TTS").query()).toBeNull();
});

test("replaces a persisted mapping whose provider is no longer registered", async () => {
  const savedMappings: Record<string, Voice>[] = [];
  const legacyVoice: Voice = {
    name: "legacy-local-voice",
    languageCodes: ["en-GB"],
    ssmlGender: "MALE",
    provider: "local",
  };
  Object.defineProperty(window, "electronAPI", {
    configurable: true,
    value: {
      getSpeakerMappings: () => Promise.resolve({ Narrator: legacyVoice }),
      setSpeakerMappings: (mappings: Record<string, Voice>) => {
        savedMappings.push(mappings);
        return Promise.resolve({ success: true });
      },
      getGcpKeyPath: () => Promise.resolve(null),
      getVoices: () => Promise.resolve([gcpVoice]),
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
  await screen.getByRole("option", { name: /en-US-Chirp3-HD-Aoede/ }).click();

  await vi.waitFor(() => expect(savedMappings).toContainEqual({ Narrator: gcpVoice }));
});
