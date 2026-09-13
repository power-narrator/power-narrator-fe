import { MantineProvider } from "@mantine/core";
import "@mantine/core/styles.css";
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

const multiModelOption: VoiceOption = {
  provider: "gcp",
  name: "Kore",
  ssmlGender: "FEMALE",
  models: [
    {
      id: "gemini-2.5-pro-tts",
      label: "Gemini 2.5 Pro",
      supportsPrompt: true,
      languages: [{ code: "en-US", label: "en-US" }],
    },
    {
      id: "gemini-2.5-flash-tts",
      label: "Gemini 2.5 Flash",
      supportsPrompt: true,
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
  await screen.getByRole("combobox", { name: "Voice for Narrator" }).click();
  await screen.getByRole("option", { name: /Aoede/ }).click();

  await vi.waitFor(() => expect(savedMappings).toContainEqual({ Narrator: { voice: gcpVoice } }));
});

test("withholds a voice until its model is chosen, then saves the pair", async () => {
  const savedMappings: Record<string, SpeakerMapping>[] = [];
  Object.defineProperty(window, "electronAPI", {
    configurable: true,
    value: {
      getSpeakerMappings: () => Promise.resolve({ Narrator: {} }),
      setSpeakerMappings: (mappings: Record<string, SpeakerMapping>) => {
        savedMappings.push(mappings);
        return Promise.resolve({ success: true });
      },
      getGcpKeyPath: () => Promise.resolve(null),
      getVoices: () => Promise.resolve([multiModelOption]),
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
  await screen.getByRole("combobox", { name: "Voice for Narrator" }).click();
  await screen.getByRole("option", { name: "Kore (FEMALE)" }).click();

  // A voice offering several models leaves the mapping unconfigured until one
  // is chosen, so nothing partial is ever stored.
  expect(savedMappings.length).toBeGreaterThan(0);
  expect(savedMappings.every((mappings) => !mappings.Narrator?.voice)).toBe(true);

  await screen.getByRole("combobox", { name: "Model for Narrator" }).click();
  await screen.getByRole("option", { name: "Gemini 2.5 Flash" }).click();

  await vi.waitFor(() =>
    expect(savedMappings).toContainEqual({
      Narrator: {
        voice: {
          provider: "gcp",
          voiceId: "Kore",
          model: "gemini-2.5-flash-tts",
          languageCode: "en-US",
          supportsPrompt: true,
        },
      },
    }),
  );
});

test("preselects the sole model of a voice that offers one", async () => {
  Object.defineProperty(window, "electronAPI", {
    configurable: true,
    value: {
      getSpeakerMappings: () => Promise.resolve({ Narrator: {} }),
      setSpeakerMappings: () => Promise.resolve({ success: true }),
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
  await screen.getByRole("combobox", { name: "Voice for Narrator" }).click();
  await screen.getByRole("option", { name: "Aoede (FEMALE)" }).click();

  await expect
    .element(screen.getByRole("combobox", { name: "Model for Narrator" }))
    .toHaveValue("Chirp 3 HD");
});

const bilingualOption: VoiceOption = {
  provider: "gcp",
  name: "Kore",
  ssmlGender: "FEMALE",
  models: [
    {
      id: "gemini-2.5-pro-tts",
      label: "Gemini 2.5 Pro",
      supportsPrompt: true,
      languages: [
        { code: "en-US", label: "en-US" },
        { code: "fr-FR", label: "fr-FR" },
      ],
    },
    {
      id: "chirp-3-hd",
      label: "Chirp 3 HD",
      supportsPrompt: false,
      languages: [
        { code: "en-US", label: "en-US" },
        { code: "de-DE", label: "de-DE" },
      ],
    },
  ],
};

function renderSettings(options: VoiceOption[], savedMappings: Record<string, SpeakerMapping>[]) {
  Object.defineProperty(window, "electronAPI", {
    configurable: true,
    value: {
      getSpeakerMappings: () => Promise.resolve({ Narrator: {} }),
      setSpeakerMappings: (mappings: Record<string, SpeakerMapping>) => {
        savedMappings.push(mappings);
        return Promise.resolve({ success: true });
      },
      getGcpKeyPath: () => Promise.resolve(null),
      getVoices: () => Promise.resolve(options),
      getXmlCliEnabled: () => Promise.resolve(false),
      setXmlCliEnabled: () => Promise.resolve({ success: true }),
    },
  });

  return render(
    <MantineProvider>
      <SettingsProvider>
        <SettingsModal opened onClose={() => {}} />
      </SettingsProvider>
    </MantineProvider>,
  );
}

test("withholds a voice until its language is chosen, then saves it", async () => {
  const savedMappings: Record<string, SpeakerMapping>[] = [];
  const screen = await renderSettings([bilingualOption], savedMappings);

  await vi.waitFor(() => expect(screen.getByText("[Narrator]").query()).not.toBeNull());
  await screen.getByRole("combobox", { name: "Voice for Narrator" }).click();
  await screen.getByRole("option", { name: "Kore (FEMALE)" }).click();
  await screen.getByRole("combobox", { name: "Model for Narrator" }).click();
  await screen.getByRole("option", { name: "Gemini 2.5 Pro" }).click();

  // A model speaking several languages leaves the mapping unconfigured until
  // one is chosen, so narration never reaches a provider in a guessed language.
  expect(savedMappings.length).toBeGreaterThan(0);
  expect(savedMappings.every((mappings) => !mappings.Narrator?.voice)).toBe(true);

  await screen.getByRole("combobox", { name: "Language for Narrator" }).click();
  await screen.getByRole("option", { name: "fr-FR" }).click();

  await vi.waitFor(() =>
    expect(savedMappings).toContainEqual({
      Narrator: {
        voice: {
          provider: "gcp",
          voiceId: "Kore",
          model: "gemini-2.5-pro-tts",
          languageCode: "fr-FR",
          supportsPrompt: true,
        },
      },
    }),
  );
});

test("preselects the sole language of a model that offers one", async () => {
  const screen = await renderSettings([gcpOption], []);

  await vi.waitFor(() => expect(screen.getByText("[Narrator]").query()).not.toBeNull());
  await screen.getByRole("combobox", { name: "Voice for Narrator" }).click();
  await screen.getByRole("option", { name: "Aoede (FEMALE)" }).click();

  await expect
    .element(screen.getByRole("combobox", { name: "Language for Narrator" }))
    .toHaveValue("en-US");
});

test("keeps a language the newly chosen voice can also speak", async () => {
  const savedMappings: Record<string, SpeakerMapping>[] = [];
  const soleModelOption: VoiceOption = {
    ...bilingualOption,
    name: "Puck",
    models: [bilingualOption.models[1]!],
  };
  const screen = await renderSettings([bilingualOption, soleModelOption], savedMappings);

  await vi.waitFor(() => expect(screen.getByText("[Narrator]").query()).not.toBeNull());
  await screen.getByRole("combobox", { name: "Voice for Narrator" }).click();
  await screen.getByRole("option", { name: "Kore (FEMALE)" }).click();
  await screen.getByRole("combobox", { name: "Model for Narrator" }).click();
  await screen.getByRole("option", { name: "Chirp 3 HD" }).click();
  await screen.getByRole("combobox", { name: "Language for Narrator" }).click();
  await screen.getByRole("option", { name: "de-DE" }).click();

  await screen.getByRole("combobox", { name: "Voice for Narrator" }).click();
  await screen.getByRole("option", { name: "Puck (FEMALE)" }).click();

  // Nothing about the new voice invalidated the language, so re-picking it
  // would be busywork.
  await vi.waitFor(() =>
    expect(savedMappings.at(-1)).toEqual({
      Narrator: {
        voice: {
          provider: "gcp",
          voiceId: "Puck",
          model: "chirp-3-hd",
          languageCode: "de-DE",
          supportsPrompt: false,
        },
      },
    }),
  );
});

test("clears a language the newly chosen model cannot speak", async () => {
  const savedMappings: Record<string, SpeakerMapping>[] = [];
  const screen = await renderSettings([bilingualOption], savedMappings);

  await vi.waitFor(() => expect(screen.getByText("[Narrator]").query()).not.toBeNull());
  await screen.getByRole("combobox", { name: "Voice for Narrator" }).click();
  await screen.getByRole("option", { name: "Kore (FEMALE)" }).click();
  await screen.getByRole("combobox", { name: "Model for Narrator" }).click();
  await screen.getByRole("option", { name: "Gemini 2.5 Pro" }).click();
  await screen.getByRole("combobox", { name: "Language for Narrator" }).click();
  await screen.getByRole("option", { name: "fr-FR" }).click();
  await vi.waitFor(() => expect(savedMappings.length).toBeGreaterThan(1));

  await screen.getByRole("combobox", { name: "Model for Narrator" }).click();
  await screen.getByRole("option", { name: "Chirp 3 HD" }).click();

  await expect
    .element(screen.getByRole("combobox", { name: "Language for Narrator" }))
    .toHaveValue("");
  await vi.waitFor(() => expect(savedMappings.at(-1)).toEqual({ Narrator: {} }));
});

test("keeps a language the newly chosen model can also speak", async () => {
  const savedMappings: Record<string, SpeakerMapping>[] = [];
  const screen = await renderSettings([bilingualOption], savedMappings);

  await vi.waitFor(() => expect(screen.getByText("[Narrator]").query()).not.toBeNull());
  await screen.getByRole("combobox", { name: "Voice for Narrator" }).click();
  await screen.getByRole("option", { name: "Kore (FEMALE)" }).click();
  await screen.getByRole("combobox", { name: "Model for Narrator" }).click();
  await screen.getByRole("option", { name: "Gemini 2.5 Pro" }).click();
  await screen.getByRole("combobox", { name: "Language for Narrator" }).click();
  await screen.getByRole("option", { name: "en-US" }).click();

  await screen.getByRole("combobox", { name: "Model for Narrator" }).click();
  await screen.getByRole("option", { name: "Chirp 3 HD" }).click();

  await vi.waitFor(() =>
    expect(savedMappings.at(-1)).toEqual({
      Narrator: {
        voice: {
          provider: "gcp",
          voiceId: "Kore",
          model: "chirp-3-hd",
          languageCode: "en-US",
          supportsPrompt: false,
        },
      },
    }),
  );
});
