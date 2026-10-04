import { MantineProvider } from "@mantine/core";
import "@mantine/core/styles.css";
import { useState } from "react";
import { afterEach, expect, test, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import type { Settings } from "../../../shared/types/settings";
import type { SpeakerMapping, VoiceOption } from "../../../shared/types/tts";
import { SettingsProvider } from "../../context/SettingsContext";
import { useSettings } from "../../context/useSettings";
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

const savedSettings: Settings = {
  gcpKeyPath: "/keys/saved.json",
  speakerMappings: { Narrator: {} },
  xmlCliEnabled: false,
};

type SettingsSetup = {
  settings?: Partial<Settings>;
  voiceOptions?: VoiceOption[];
  electronApi?: Partial<typeof window.electronAPI>;
};

function SavedSpeakers() {
  const { mappings } = useSettings();
  return <output aria-label="Saved speakers">{Object.keys(mappings).join(", ")}</output>;
}

function SettingsHarness() {
  const [opened, setOpened] = useState(true);
  return (
    <>
      <button onClick={() => setOpened(true)}>Open settings</button>
      <SavedSpeakers />
      <SettingsModal opened={opened} onClose={() => setOpened(false)} />
    </>
  );
}

function renderSettings({
  settings = {},
  voiceOptions = [],
  electronApi = {},
}: SettingsSetup = {}) {
  let stored: Settings = { ...savedSettings, ...settings };
  const saveSettings = vi.fn<typeof window.electronAPI.saveSettings>((next) => {
    stored = next;
    return Promise.resolve({ success: true });
  });
  Object.defineProperty(window, "electronAPI", {
    configurable: true,
    value: {
      getSettings: () => Promise.resolve(stored),
      getSpeakerMappings: () => Promise.resolve(stored.speakerMappings),
      getVoices: () => Promise.resolve(voiceOptions),
      selectGcpKey: () => Promise.resolve({ success: true, path: null }),
      previewVoices: () => Promise.resolve({ voices: voiceOptions, failure: null }),
      saveSettings,
      ...electronApi,
    },
  });

  return render(
    <MantineProvider>
      <SettingsProvider>
        <SettingsHarness />
      </SettingsProvider>
    </MantineProvider>,
  );
}

type SettingsScreen = Awaited<ReturnType<typeof renderSettings>>;

async function waitForMapping(screen: SettingsScreen, alias = "Narrator") {
  await vi.waitFor(() => expect(screen.getByText(`[${alias}]`).query()).not.toBeNull());
}

async function choose(screen: SettingsScreen, controlName: string, optionName: string | RegExp) {
  await screen.getByRole("combobox", { name: controlName }).click();
  await screen.getByRole("option", { name: optionName }).click();
}

async function addMapping(screen: SettingsScreen, alias: string, voice: string | RegExp) {
  await screen.getByPlaceholder("New alias (e.g. speaker 1)").fill(alias);
  await choose(screen, "Voice for new speaker", voice);
  await screen.getByRole("button", { name: "Add Mapping" }).click();
}

async function saveAndGetMappings(screen: SettingsScreen) {
  await screen.getByRole("button", { name: "Save" }).click();
  await waitForClosed(screen);
  return vi.mocked(window.electronAPI.saveSettings).mock.lastCall?.[0].speakerMappings;
}

async function waitForClosed(screen: SettingsScreen) {
  await vi.waitFor(() => expect(screen.getByRole("dialog").query()).toBeNull());
}

test("creates a mapping from the voices exposed by the provider registry", async () => {
  const screen = await renderSettings({
    settings: { speakerMappings: {} },
    voiceOptions: [registryOption],
  });

  await addMapping(screen, "Narrator", "future-voice (NEUTRAL)");

  await expect(saveAndGetMappings(screen)).resolves.toEqual({
    Narrator: {
      voice: {
        provider: "future-provider",
        voiceId: "future-voice",
        model: "future-model",
        languageCode: "en-US",
        supportsPrompt: true,
      },
    },
  });
});

test("adds a new speaker only once its voice is complete, keeping its prompt", async () => {
  const screen = await renderSettings({
    settings: { speakerMappings: {} },
    voiceOptions: [multiModelOption],
  });
  const add = screen.getByRole("button", { name: "Add Mapping" });

  await screen.getByPlaceholder("New alias (e.g. speaker 1)").fill("Narrator");
  await expect.element(add).toBeDisabled();
  await choose(screen, "Voice for new speaker", "Kore (FEMALE)");
  await expect.element(add).toBeDisabled();
  await choose(screen, "Model for new speaker", "Gemini 2.5 Flash");
  await screen.getByRole("button", { name: "Prompt for new speaker" }).click();
  await screen.getByRole("textbox", { name: "Prompt for new speaker" }).fill("Whisper");
  await add.click();

  await waitForMapping(screen);
  await expect.element(screen.getByPlaceholder("New alias (e.g. speaker 1)")).toHaveValue("");
  await expect
    .element(screen.getByRole("combobox", { name: "Voice for new speaker" }))
    .toHaveValue("");
  await expect(saveAndGetMappings(screen)).resolves.toEqual({
    Narrator: {
      voice: {
        provider: "gcp",
        voiceId: "Kore",
        model: "gemini-2.5-flash-tts",
        languageCode: "en-US",
        supportsPrompt: true,
      },
      prompt: "Whisper",
    },
  });
});

test("saves other edits while leaving an unfinished new speaker out", async () => {
  const screen = await renderSettings({
    settings: { speakerMappings: {} },
    voiceOptions: [multiModelOption],
  });

  await screen.getByPlaceholder("New alias (e.g. speaker 1)").fill("Narrator");
  await choose(screen, "Voice for new speaker", "Kore (FEMALE)");
  await screen.getByRole("switch", { name: "Enable XML CLI engine" }).click();

  await expect(saveAndGetMappings(screen)).resolves.toEqual({});
});

test("refuses a new speaker whose alias is already mapped", async () => {
  const screen = await renderSettings({ voiceOptions: [gcpOption] });

  await waitForMapping(screen);
  await addMapping(screen, " Narrator ", /Aoede/);

  await expect.element(screen.getByText('"Narrator" already has a mapping')).toBeVisible();
  expect(screen.getByText("[Narrator]").elements()).toHaveLength(1);
  await expect.element(screen.getByRole("button", { name: "Save" })).toBeDisabled();
});

test("clears an unfinished new speaker when a newly selected key replaces the voices", async () => {
  const screen = await renderSettings({
    settings: { speakerMappings: {} },
    voiceOptions: [gcpOption],
    electronApi: {
      selectGcpKey: () => Promise.resolve({ success: true, path: "/keys/new.json" }),
      previewVoices: () => Promise.resolve({ voices: [registryOption], failure: null }),
    },
  });

  await screen.getByPlaceholder("New alias (e.g. speaker 1)").fill("Narrator");
  await choose(screen, "Voice for new speaker", /Aoede/);
  await screen.getByRole("button", { name: "Select Key File..." }).click();

  await expect
    .element(screen.getByRole("combobox", { name: "Voice for new speaker" }))
    .toHaveValue("");
  await expect.element(screen.getByRole("button", { name: "Add Mapping" })).toBeDisabled();
});

const unavailableMapping: SpeakerMapping = {
  voice: {
    provider: "local",
    voiceId: "apope_low",
    model: "local-1",
    languageCode: "en-GB",
    supportsPrompt: true,
  },
  prompt: "Whisper",
};

test("identifies a saved voice missing from the catalogue as unavailable and keeps it", async () => {
  const screen = await renderSettings({
    settings: {
      speakerMappings: {
        Narrator: unavailableMapping,
        Guest: { voice: gcpVoice },
        Host: { voice: { ...gcpVoice, languageCode: "fr-FR" } },
      },
    },
    voiceOptions: [gcpOption],
  });

  await expect
    .element(screen.getByRole("combobox", { name: "Voice for Narrator" }))
    .toHaveValue("apope_low (unavailable)");
  await expect
    .element(screen.getByRole("combobox", { name: "Model for Narrator" }))
    .toHaveValue("local-1");
  await expect
    .element(screen.getByRole("combobox", { name: "Language for Narrator" }))
    .toHaveValue("en-GB");
  await expect
    .element(screen.getByRole("textbox", { name: "Prompt for Narrator" }))
    .toHaveValue("Whisper");
  await expect
    .element(screen.getByRole("combobox", { name: "Voice for Guest" }))
    .toHaveValue("Aoede (FEMALE)");
  await expect
    .element(screen.getByRole("combobox", { name: "Voice for Host" }))
    .toHaveValue("Aoede (unavailable)");
  await expect.element(screen.getByRole("button", { name: "Save" })).toBeDisabled();

  await screen.getByRole("switch", { name: "Enable XML CLI engine" }).click();

  await expect(saveAndGetMappings(screen)).resolves.toEqual({
    Narrator: unavailableMapping,
    Guest: { voice: gcpVoice },
    Host: { voice: { ...gcpVoice, languageCode: "fr-FR" } },
  });
});

test.each([
  ["loads", () => new Promise<VoiceOption[]>(() => {})],
  ["fails to load", () => Promise.reject(new Error("Network down"))],
])("does not mark a saved voice unavailable while the catalogue %s", async (_, getVoices) => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  const screen = await renderSettings({
    settings: { speakerMappings: { Narrator: { voice: gcpVoice } } },
    electronApi: { getVoices },
  });

  await expect
    .element(screen.getByRole("combobox", { name: "Voice for Narrator" }))
    .toHaveValue("Aoede");
});

test("replaces an unavailable saved voice, keeping its prompt", async () => {
  const screen = await renderSettings({
    settings: { speakerMappings: { Narrator: unavailableMapping } },
    voiceOptions: [gcpOption],
  });

  await expect
    .element(screen.getByRole("combobox", { name: "Voice for Narrator" }))
    .toHaveValue("apope_low (unavailable)");
  await choose(screen, "Voice for Narrator", /Aoede/);

  await expect(saveAndGetMappings(screen)).resolves.toEqual({
    Narrator: { voice: gcpVoice, prompt: "Whisper" },
  });
});

test("withholds a voice until its model is chosen, then saves the pair", async () => {
  const screen = await renderSettings({ voiceOptions: [multiModelOption] });

  await waitForMapping(screen);
  await choose(screen, "Voice for Narrator", "Kore (FEMALE)");

  await expect.element(screen.getByRole("button", { name: "Save" })).toBeDisabled();

  await choose(screen, "Model for Narrator", "Gemini 2.5 Flash");

  await expect(saveAndGetMappings(screen)).resolves.toEqual({
    Narrator: {
      voice: {
        provider: "gcp",
        voiceId: "Kore",
        model: "gemini-2.5-flash-tts",
        languageCode: "en-US",
        supportsPrompt: true,
      },
    },
  });
});

test("blocks saving other edits while a replacement voice is incomplete", async () => {
  const screen = await renderSettings({
    settings: { speakerMappings: { Narrator: { voice: gcpVoice } } },
    voiceOptions: [gcpOption, multiModelOption],
  });

  await waitForMapping(screen);
  await screen.getByRole("switch", { name: "Enable XML CLI engine" }).click();
  await expect.element(screen.getByRole("button", { name: "Save" })).toBeEnabled();

  await choose(screen, "Voice for Narrator", "Kore (FEMALE)");
  await expect.element(screen.getByRole("button", { name: "Save" })).toBeDisabled();

  await choose(screen, "Model for Narrator", "Gemini 2.5 Flash");
  await expect(saveAndGetMappings(screen)).resolves.toEqual({
    Narrator: {
      voice: {
        provider: "gcp",
        voiceId: "Kore",
        model: "gemini-2.5-flash-tts",
        languageCode: "en-US",
        supportsPrompt: true,
      },
    },
  });
  expect(window.electronAPI.saveSettings).toHaveBeenCalledWith(
    expect.objectContaining({ xmlCliEnabled: true }),
  );
});

test("keeps the saved voice visible when a key preview removes an incomplete choice", async () => {
  const screen = await renderSettings({
    settings: { speakerMappings: { Narrator: { voice: gcpVoice } } },
    voiceOptions: [gcpOption, multiModelOption],
    electronApi: {
      selectGcpKey: () => Promise.resolve({ success: true, path: "/keys/new.json" }),
      previewVoices: () => Promise.resolve({ voices: [], failure: null }),
    },
  });

  await waitForMapping(screen);
  await choose(screen, "Voice for Narrator", "Kore (FEMALE)");
  await screen.getByRole("button", { name: "Select Key File..." }).click();

  await expect
    .element(screen.getByRole("combobox", { name: "Voice for Narrator" }))
    .toHaveValue("Aoede (unavailable)");
  await expect(saveAndGetMappings(screen)).resolves.toEqual({ Narrator: { voice: gcpVoice } });
});

test("preselects the sole model and language of a voice that offers one", async () => {
  const screen = await renderSettings({ voiceOptions: [gcpOption] });

  await waitForMapping(screen);
  await choose(screen, "Voice for Narrator", "Aoede (FEMALE)");

  await expect
    .element(screen.getByRole("combobox", { name: "Model for Narrator" }))
    .toHaveValue("Chirp 3 HD");
  await expect
    .element(screen.getByRole("combobox", { name: "Language for Narrator" }))
    .toHaveValue("en-US");
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

test("withholds a voice until its language is chosen, then saves it", async () => {
  const screen = await renderSettings({ voiceOptions: [bilingualOption] });

  await waitForMapping(screen);
  await choose(screen, "Voice for Narrator", "Kore (FEMALE)");
  await choose(screen, "Model for Narrator", "Gemini 2.5 Pro");

  await expect.element(screen.getByRole("button", { name: "Save" })).toBeDisabled();

  await choose(screen, "Language for Narrator", "fr-FR");

  await expect(saveAndGetMappings(screen)).resolves.toEqual({
    Narrator: {
      voice: {
        provider: "gcp",
        voiceId: "Kore",
        model: "gemini-2.5-pro-tts",
        languageCode: "fr-FR",
        supportsPrompt: true,
      },
    },
  });
});

test("keeps a language the newly chosen voice can also speak", async () => {
  const soleModelOption: VoiceOption = {
    ...bilingualOption,
    name: "Puck",
    models: [bilingualOption.models[1]!],
  };
  const screen = await renderSettings({ voiceOptions: [bilingualOption, soleModelOption] });

  await waitForMapping(screen);
  await choose(screen, "Voice for Narrator", "Kore (FEMALE)");
  await choose(screen, "Model for Narrator", "Chirp 3 HD");
  await choose(screen, "Language for Narrator", "de-DE");
  await choose(screen, "Voice for Narrator", "Puck (FEMALE)");

  await expect(saveAndGetMappings(screen)).resolves.toEqual({
    Narrator: {
      voice: {
        provider: "gcp",
        voiceId: "Puck",
        model: "chirp-3-hd",
        languageCode: "de-DE",
        supportsPrompt: false,
      },
    },
  });
});

test("clears a language the newly chosen model cannot speak", async () => {
  const screen = await renderSettings({ voiceOptions: [bilingualOption] });

  await waitForMapping(screen);
  await choose(screen, "Voice for Narrator", "Kore (FEMALE)");
  await choose(screen, "Model for Narrator", "Gemini 2.5 Pro");
  await choose(screen, "Language for Narrator", "fr-FR");
  await expect.element(screen.getByRole("button", { name: "Save" })).toBeEnabled();

  await choose(screen, "Model for Narrator", "Chirp 3 HD");

  await expect
    .element(screen.getByRole("combobox", { name: "Language for Narrator" }))
    .toHaveValue("");
  await expect.element(screen.getByRole("button", { name: "Save" })).toBeDisabled();
});

test("selects the sole language when a newly chosen model cannot speak the current one", async () => {
  const option: VoiceOption = {
    ...bilingualOption,
    models: [
      bilingualOption.models[0]!,
      {
        id: "future-model",
        label: "Future",
        supportsPrompt: true,
        languages: [{ code: "de-DE", label: "de-DE" }],
      },
    ],
  };
  const screen = await renderSettings({ voiceOptions: [option] });

  await waitForMapping(screen);
  await choose(screen, "Voice for Narrator", "Kore (FEMALE)");
  await choose(screen, "Model for Narrator", "Gemini 2.5 Pro");
  await choose(screen, "Language for Narrator", "fr-FR");
  await choose(screen, "Model for Narrator", "Future");

  await expect
    .element(screen.getByRole("combobox", { name: "Language for Narrator" }))
    .toHaveValue("de-DE");
  const mappings = await saveAndGetMappings(screen);
  expect(mappings?.Narrator?.voice).toEqual({
    provider: "gcp",
    voiceId: "Kore",
    model: "future-model",
    languageCode: "de-DE",
    supportsPrompt: true,
  });
});

test("keeps a language the newly chosen model can also speak", async () => {
  const screen = await renderSettings({ voiceOptions: [bilingualOption] });

  await waitForMapping(screen);
  await choose(screen, "Voice for Narrator", "Kore (FEMALE)");
  await choose(screen, "Model for Narrator", "Gemini 2.5 Pro");
  await choose(screen, "Language for Narrator", "en-US");
  await choose(screen, "Model for Narrator", "Chirp 3 HD");

  await expect(saveAndGetMappings(screen)).resolves.toEqual({
    Narrator: {
      voice: {
        provider: "gcp",
        voiceId: "Kore",
        model: "chirp-3-hd",
        languageCode: "en-US",
        supportsPrompt: false,
      },
    },
  });
});

test("opens stored prompts after mappings load while empty prompts stay closed", async () => {
  const screen = await renderSettings({
    settings: { speakerMappings: { Narrator: { prompt: "Whisper" }, Guest: {} } },
    voiceOptions: [multiModelOption],
  });

  await expect
    .element(screen.getByRole("textbox", { name: "Prompt for Narrator" }))
    .toHaveValue("Whisper");
  expect(screen.getByRole("textbox", { name: "Prompt for Guest" }).query()).toBeNull();
});

test("keeps a prompt a voice will use open, closable again once it is ignored", async () => {
  const screen = await renderSettings({ voiceOptions: [bilingualOption] });

  await waitForMapping(screen);
  await screen.getByRole("button", { name: "Prompt for Narrator" }).click();
  await screen.getByRole("textbox", { name: "Prompt for Narrator" }).fill("Whisper");

  await expect
    .element(screen.getByRole("button", { name: "Prompt for Narrator (set)" }))
    .toBeDisabled();

  await choose(screen, "Voice for Narrator", "Kore (FEMALE)");
  await choose(screen, "Model for Narrator", "Chirp 3 HD");
  await choose(screen, "Language for Narrator", "de-DE");
  await screen.getByRole("button", { name: "Prompt for Narrator (set)" }).click();

  await vi.waitFor(() =>
    expect(screen.getByRole("textbox", { name: "Prompt for Narrator" }).query()).toBeNull(),
  );
});

test("keeps a prompt through a switch to a voice that ignores prompts, advising so", async () => {
  const screen = await renderSettings({ voiceOptions: [bilingualOption] });

  await waitForMapping(screen);
  await screen.getByRole("button", { name: "Prompt for Narrator" }).click();
  await screen.getByRole("textbox", { name: "Prompt for Narrator" }).fill("Whisper");
  await choose(screen, "Voice for Narrator", "Kore (FEMALE)");
  await choose(screen, "Model for Narrator", "Chirp 3 HD");
  await choose(screen, "Language for Narrator", "de-DE");

  await expect.element(screen.getByText("This model ignores prompts.")).toBeVisible();
  await expect
    .element(screen.getByRole("textbox", { name: "Prompt for Narrator" }))
    .toHaveValue("Whisper");
  const mappings = await saveAndGetMappings(screen);
  expect(mappings?.Narrator?.prompt).toBe("Whisper");
});

test("keeps two speakers sharing one voice on separate prompts", async () => {
  const screen = await renderSettings({
    settings: { speakerMappings: { Narrator: {}, Guest: {} } },
    voiceOptions: [multiModelOption],
  });

  await waitForMapping(screen, "Guest");
  await screen.getByRole("button", { name: "Prompt for Narrator" }).click();
  await screen.getByRole("textbox", { name: "Prompt for Narrator" }).fill("Whisper");
  await screen.getByRole("button", { name: "Prompt for Guest" }).click();
  await screen.getByRole("textbox", { name: "Prompt for Guest" }).fill("Shout");

  await expect(saveAndGetMappings(screen)).resolves.toEqual({
    Narrator: { prompt: "Whisper" },
    Guest: { prompt: "Shout" },
  });
});

test("counts a blank prompt as no prompt rather than one set but ignored", async () => {
  const screen = await renderSettings({ voiceOptions: [multiModelOption] });

  await waitForMapping(screen);
  await screen.getByRole("button", { name: "Prompt for Narrator" }).click();
  await screen.getByRole("textbox", { name: "Prompt for Narrator" }).fill("   ");

  await expect.element(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Prompt for Narrator (set)" }).query()).toBeNull();
});

test("refuses a mapping name the notes syntax cannot express", async () => {
  const screen = await renderSettings({
    settings: { speakerMappings: { "prompt: legacy": {} } },
    voiceOptions: [gcpOption],
  });

  await vi.waitFor(() => expect(screen.getByText("[prompt: legacy]").query()).not.toBeNull());
  await addMapping(screen, "p:aside", /Aoede/);

  await vi.waitFor(() =>
    expect(screen.getByText(/cannot start with p: or prompt:/).query()).not.toBeNull(),
  );
  expect(screen.getByText("[p:aside]").query()).toBeNull();
  expect(screen.getByText("[prompt: legacy]").query()).not.toBeNull();

  await screen.getByPlaceholder("New alias (e.g. speaker 1)").fill("Narrator");
  await screen.getByRole("button", { name: "Add Mapping" }).click();
  await waitForMapping(screen);
  expect(screen.getByText(/cannot start with p: or prompt:/).query()).toBeNull();
});

test("submits an alias once with Enter", async () => {
  const screen = await renderSettings({
    settings: { speakerMappings: {} },
    voiceOptions: [gcpOption],
  });

  await choose(screen, "Voice for new speaker", /Aoede/);
  await screen.getByPlaceholder("New alias (e.g. speaker 1)").fill("Narrator");
  await userEvent.keyboard("{Enter}");

  await waitForMapping(screen);
  expect(screen.getByText("[Narrator]").elements()).toHaveLength(1);
});

test("does not submit an alias from the keyboard before voices load", async () => {
  const screen = await renderSettings({
    settings: { speakerMappings: {} },
    voiceOptions: [],
  });

  await screen.getByPlaceholder("New alias (e.g. speaker 1)").fill("Narrator");
  await userEvent.keyboard("{Enter}");

  expect(screen.getByText("[Narrator]").query()).toBeNull();
});

test("opens with the saved settings and enables Save only once they load and change", async () => {
  let finishLoad: ((settings: Settings) => void) | undefined;
  const screen = await renderSettings({
    voiceOptions: [gcpOption],
    electronApi: {
      getSettings: () =>
        new Promise((resolve) => {
          finishLoad = resolve;
        }),
    },
  });

  await expect.element(screen.getByText("Loading settings…")).toBeVisible();
  await expect.element(screen.getByRole("button", { name: "Save" })).toBeDisabled();

  finishLoad?.({ ...savedSettings, xmlCliEnabled: true });

  await expect.element(screen.getByText("/keys/saved.json")).toBeVisible();
  await expect.element(screen.getByText("[Narrator]")).toBeVisible();
  await expect.element(screen.getByRole("switch", { name: "Enable XML CLI engine" })).toBeChecked();
  await expect.element(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  await expect.element(screen.getByRole("button", { name: "Cancel" })).toBeEnabled();
});

test("shows a failed load and offers nothing to save", async () => {
  const screen = await renderSettings({
    electronApi: { getSettings: () => Promise.reject(new Error("Store unreadable")) },
  });

  await expect.element(screen.getByText("Failed to load settings: Store unreadable")).toBeVisible();
  await expect.element(screen.getByRole("button", { name: "Save" })).toBeDisabled();
});

test("disables Save again once every edit is reversed", async () => {
  const screen = await renderSettings({
    settings: { speakerMappings: { Narrator: { voice: gcpVoice } } },
    voiceOptions: [gcpOption],
  });
  const save = screen.getByRole("button", { name: "Save" });
  const engine = screen.getByRole("switch", { name: "Enable XML CLI engine" });

  await waitForMapping(screen);
  await engine.click();
  await screen.getByRole("button", { name: "Delete mapping for Narrator" }).click();
  await expect.element(save).toBeEnabled();

  await engine.click();
  await addMapping(screen, "Narrator", /Aoede/);

  await expect.element(save).toBeDisabled();
});

test("saves a draft of every setting together, leaving the app on saved settings until then", async () => {
  const screen = await renderSettings({
    settings: { speakerMappings: { Narrator: {}, Guest: {} } },
    voiceOptions: [gcpOption],
    electronApi: {
      selectGcpKey: () => Promise.resolve({ success: true, path: "/keys/new.json" }),
    },
  });

  await waitForMapping(screen, "Guest");
  await screen.getByRole("button", { name: "Select Key File..." }).click();
  await choose(screen, "Voice for Default", /Aoede/);
  await screen.getByRole("button", { name: "Prompt for Narrator" }).click();
  await screen.getByRole("textbox", { name: "Prompt for Narrator" }).fill("Whisper");
  await screen.getByRole("button", { name: "Delete mapping for Guest" }).click();
  await addMapping(screen, "Host", /Aoede/);
  await screen.getByRole("switch", { name: "Enable XML CLI engine" }).click();

  await expect.element(screen.getByText("/keys/new.json")).toBeVisible();
  await expect
    .element(screen.getByRole("status", { name: "Saved speakers" }))
    .toHaveTextContent("Narrator, Guest");

  await screen.getByRole("button", { name: "Save" }).click();
  await waitForClosed(screen);

  const draft: Settings = {
    gcpKeyPath: "/keys/new.json",
    speakerMappings: {
      Narrator: { prompt: "Whisper" },
      _default_: { voice: gcpVoice },
      Host: { voice: gcpVoice },
    },
    xmlCliEnabled: true,
  };
  expect(window.electronAPI.saveSettings).toHaveBeenCalledExactlyOnceWith(draft);
  await expect
    .element(screen.getByRole("status", { name: "Saved speakers" }))
    .toHaveTextContent("Narrator, _default_, Host");

  await screen.getByRole("button", { name: "Open settings" }).click();
  await expect.element(screen.getByText("/keys/new.json")).toBeVisible();
  await expect
    .element(screen.getByRole("textbox", { name: "Prompt for Narrator" }))
    .toHaveValue("Whisper");
  await expect.element(screen.getByText("[Host]")).toBeVisible();
  expect(screen.getByText("[Guest]").query()).toBeNull();
  await expect.element(screen.getByRole("switch", { name: "Enable XML CLI engine" })).toBeChecked();
});

const dismissals: [string, (screen: SettingsScreen) => Promise<void>][] = [
  ["Cancel", (screen) => screen.getByRole("button", { name: "Cancel" }).click()],
  ["the close button", (screen) => screen.getByRole("button", { name: "Close settings" }).click()],
  ["Escape", () => userEvent.keyboard("{Escape}")],
  [
    "a backdrop click",
    () => userEvent.click(document.elementFromPoint(5, 5)!, { position: { x: 5, y: 5 } }),
  ],
];

test.each(dismissals)("discards the draft when dismissed with %s", async (_, dismiss) => {
  const screen = await renderSettings({
    electronApi: {
      selectGcpKey: () => Promise.resolve({ success: true, path: "/keys/new.json" }),
      previewVoices: () => Promise.resolve({ voices: [gcpOption], failure: null }),
    },
  });

  await waitForMapping(screen);
  await screen.getByRole("button", { name: "Select Key File..." }).click();
  await choose(screen, "Voice for Default", "Aoede (FEMALE)");
  await screen.getByRole("button", { name: "Delete mapping for Narrator" }).click();
  await screen.getByRole("switch", { name: "Enable XML CLI engine" }).click();
  await dismiss(screen);
  await waitForClosed(screen);

  expect(window.electronAPI.saveSettings).not.toHaveBeenCalled();
  await screen.getByRole("button", { name: "Open settings" }).click();
  await expect.element(screen.getByText("/keys/saved.json")).toBeVisible();
  await expect.element(screen.getByText("[Narrator]")).toBeVisible();
  await expect.element(screen.getByRole("combobox", { name: "Voice for Default" })).toHaveValue("");
  await expect
    .element(screen.getByRole("switch", { name: "Enable XML CLI engine" }))
    .not.toBeChecked();
});

test("keeps the draft key when the picker is dismissed or the chosen key is invalid", async () => {
  const selectGcpKey = vi
    .fn<typeof window.electronAPI.selectGcpKey>()
    .mockResolvedValueOnce({ success: true, path: null })
    .mockResolvedValueOnce({ success: false, message: "Invalid Service Account Key JSON" });
  const screen = await renderSettings({ electronApi: { selectGcpKey } });
  const selectKey = screen.getByRole("button", { name: "Select Key File..." });

  await expect.element(screen.getByText("/keys/saved.json")).toBeVisible();
  await selectKey.click();
  await expect.poll(() => selectGcpKey.mock.calls.length).toBe(1);
  await selectKey.click();

  await expect.element(screen.getByText("Invalid Service Account Key JSON")).toBeVisible();
  await expect.element(screen.getByText("/keys/saved.json")).toBeVisible();
  await expect.element(screen.getByRole("button", { name: "Save" })).toBeDisabled();
});

test("holds the modal open while saving and keeps the draft for a retry after failure", async () => {
  let finishSave:
    | ((result: Awaited<ReturnType<typeof window.electronAPI.saveSettings>>) => void)
    | undefined;
  const saveSettings = vi
    .fn<typeof window.electronAPI.saveSettings>()
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishSave = resolve;
        }),
    )
    .mockResolvedValueOnce({ success: true });
  const screen = await renderSettings({ electronApi: { saveSettings } });
  const save = screen.getByRole("button", { name: "Save" });

  await waitForMapping(screen);
  await screen.getByRole("switch", { name: "Enable XML CLI engine" }).click();
  await save.click();

  await expect.element(save).toBeDisabled();
  await expect
    .element(screen.getByRole("switch", { name: "Enable XML CLI engine" }))
    .toBeDisabled();
  await expect.element(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
  await expect.element(screen.getByRole("button", { name: "Close settings" })).toBeDisabled();
  await userEvent.keyboard("{Escape}");
  await save.click({ force: true });
  expect(screen.getByRole("dialog").query()).not.toBeNull();
  expect(saveSettings).toHaveBeenCalledOnce();

  finishSave?.({ success: false, message: "Disk unavailable" });

  await expect.element(screen.getByText("Failed to save settings: Disk unavailable")).toBeVisible();
  await expect.element(screen.getByRole("switch", { name: "Enable XML CLI engine" })).toBeChecked();
  await expect.element(screen.getByRole("button", { name: "Cancel" })).toBeEnabled();

  await save.click();
  await waitForClosed(screen);
  expect(saveSettings).toHaveBeenLastCalledWith({ ...savedSettings, xmlCliEnabled: true });
});

test("lets a first-time user choose a voice from a newly selected key and save both", async () => {
  const previewVoices = vi.fn<typeof window.electronAPI.previewVoices>(() =>
    Promise.resolve({ voices: [gcpOption, registryOption], failure: null }),
  );
  const screen = await renderSettings({
    settings: { gcpKeyPath: null, speakerMappings: {} },
    voiceOptions: [registryOption],
    electronApi: {
      selectGcpKey: () => Promise.resolve({ success: true, path: "/keys/new.json" }),
      previewVoices,
    },
  });

  await expect.element(screen.getByText("Not Configured")).toBeVisible();
  await screen.getByRole("button", { name: "Select Key File..." }).click();
  await addMapping(screen, "Narrator", "Aoede (FEMALE)");
  await screen.getByRole("combobox", { name: "Voice for Default" }).click();
  await expect
    .element(screen.getByRole("option", { name: "future-voice (NEUTRAL)" }))
    .toBeVisible();
  await userEvent.keyboard("{Escape}");

  expect(previewVoices).toHaveBeenCalledExactlyOnceWith("/keys/new.json");
  await screen.getByRole("button", { name: "Save" }).click();
  await waitForClosed(screen);
  expect(window.electronAPI.saveSettings).toHaveBeenCalledExactlyOnceWith({
    gcpKeyPath: "/keys/new.json",
    speakerMappings: { Narrator: { voice: gcpVoice } },
    xmlCliEnabled: false,
  });
});

test("shows a failed voice preview yet saves the selected key and keeps existing mappings", async () => {
  const screen = await renderSettings({
    settings: { speakerMappings: { Narrator: { voice: gcpVoice, prompt: "Whisper" } } },
    voiceOptions: [gcpOption],
    electronApi: {
      selectGcpKey: () => Promise.resolve({ success: true, path: "/keys/new.json" }),
      previewVoices: () =>
        Promise.resolve({ voices: [registryOption], failure: "Network unavailable" }),
    },
  });

  await waitForMapping(screen);
  await screen.getByRole("button", { name: "Select Key File..." }).click();

  await expect
    .element(screen.getByText("Failed to load voices for the selected key: Network unavailable"))
    .toBeVisible();
  await expect
    .element(screen.getByRole("combobox", { name: "Voice for Narrator" }))
    .toHaveValue("Aoede (unavailable)");
  await screen.getByRole("button", { name: "Save" }).click();
  await waitForClosed(screen);
  expect(window.electronAPI.saveSettings).toHaveBeenCalledExactlyOnceWith({
    ...savedSettings,
    gcpKeyPath: "/keys/new.json",
    speakerMappings: { Narrator: { voice: gcpVoice, prompt: "Whisper" } },
  });
});

test("ignores voices previewed for a key that has since been replaced", async () => {
  const previews: ((voices: VoiceOption[]) => void)[] = [];
  const selectGcpKey = vi
    .fn<typeof window.electronAPI.selectGcpKey>()
    .mockResolvedValueOnce({ success: true, path: "/keys/old.json" })
    .mockResolvedValueOnce({ success: true, path: "/keys/new.json" });
  const screen = await renderSettings({
    settings: { speakerMappings: {} },
    electronApi: {
      selectGcpKey,
      previewVoices: () =>
        new Promise((resolve) => {
          previews.push((voices) => resolve({ voices, failure: null }));
        }),
    },
  });
  const selectKey = screen.getByRole("button", { name: "Select Key File..." });

  await selectKey.click();
  await expect.poll(() => previews.length).toBe(1);
  await selectKey.click();
  await expect.poll(() => previews.length).toBe(2);
  previews[1]!([gcpOption]);
  await expect.element(screen.getByText("/keys/new.json")).toBeVisible();
  previews[0]!([registryOption]);

  await screen.getByRole("combobox", { name: "Voice for Default" }).click();
  await expect.element(screen.getByRole("option", { name: "Aoede (FEMALE)" })).toBeVisible();
  await expect
    .element(screen.getByRole("option", { name: "future-voice (NEUTRAL)" }))
    .not.toBeInTheDocument();
});

test("ignores a voice preview that finishes after the modal is dismissed", async () => {
  let finishPreview: ((voices: VoiceOption[]) => void) | undefined;
  const screen = await renderSettings({
    settings: { speakerMappings: {} },
    voiceOptions: [registryOption],
    electronApi: {
      selectGcpKey: () => Promise.resolve({ success: true, path: "/keys/new.json" }),
      previewVoices: () =>
        new Promise((resolve) => {
          finishPreview = (voices) => resolve({ voices, failure: null });
        }),
    },
  });

  await expect.element(screen.getByText("/keys/saved.json")).toBeVisible();
  await screen.getByRole("button", { name: "Select Key File..." }).click();
  await expect.element(screen.getByText("/keys/new.json")).toBeVisible();
  await vi.waitFor(() => expect(finishPreview).toBeDefined());

  await screen.getByRole("button", { name: "Cancel" }).click();
  await waitForClosed(screen);
  await screen.getByRole("button", { name: "Open settings" }).click();
  await expect.element(screen.getByText("/keys/saved.json")).toBeVisible();

  finishPreview?.([gcpOption]);
  await screen.getByRole("combobox", { name: "Voice for Default" }).click();
  await expect
    .element(screen.getByRole("option", { name: "future-voice (NEUTRAL)" }))
    .toBeVisible();
  await expect
    .element(screen.getByRole("option", { name: "Aoede (FEMALE)" }))
    .not.toBeInTheDocument();
});
