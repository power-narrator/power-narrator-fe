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

interface SettingsSetup {
  mappings?: Record<string, SpeakerMapping>;
  voiceOptions?: VoiceOption[];
  electronApi?: Partial<typeof window.electronAPI>;
}

function renderSettings(
  { mappings = { Narrator: {} }, voiceOptions = [], electronApi = {} }: SettingsSetup = {},
  savedMappings: Record<string, SpeakerMapping>[] = [],
) {
  Object.defineProperty(window, "electronAPI", {
    configurable: true,
    value: {
      getSpeakerMappings: () => Promise.resolve(mappings),
      setSpeakerMappings: (nextMappings: Record<string, SpeakerMapping>) => {
        savedMappings.push(nextMappings);
        return Promise.resolve({ success: true });
      },
      getGcpKeyPath: () => Promise.resolve(null),
      getVoices: () => Promise.resolve(voiceOptions),
      getXmlCliEnabled: () => Promise.resolve(false),
      setXmlCliEnabled: () => Promise.resolve({ success: true }),
      ...electronApi,
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

type SettingsScreen = Awaited<ReturnType<typeof renderSettings>>;

async function waitForMapping(screen: SettingsScreen, alias = "Narrator") {
  await vi.waitFor(() => expect(screen.getByText(`[${alias}]`).query()).not.toBeNull());
}

async function choose(screen: SettingsScreen, controlName: string, optionName: string | RegExp) {
  await screen.getByRole("combobox", { name: controlName }).click();
  await screen.getByRole("option", { name: optionName }).click();
}

test("creates a mapping from the voices exposed by the provider registry", async () => {
  const savedMappings: Record<string, SpeakerMapping>[] = [];
  const screen = await renderSettings(
    { mappings: {}, voiceOptions: [registryOption] },
    savedMappings,
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
  const screen = await renderSettings(
    { mappings: { Narrator: staleMapping }, voiceOptions: [gcpOption] },
    savedMappings,
  );

  await waitForMapping(screen);
  await choose(screen, "Voice for Narrator", /Aoede/);

  await vi.waitFor(() => expect(savedMappings).toContainEqual({ Narrator: { voice: gcpVoice } }));
});

test("withholds a voice until its model is chosen, then saves the pair", async () => {
  const savedMappings: Record<string, SpeakerMapping>[] = [];
  const screen = await renderSettings({ voiceOptions: [multiModelOption] }, savedMappings);

  await waitForMapping(screen);
  await choose(screen, "Voice for Narrator", "Kore (FEMALE)");

  expect(savedMappings.length).toBeGreaterThan(0);
  expect(savedMappings.every((mappings) => !mappings.Narrator?.voice)).toBe(true);

  await choose(screen, "Model for Narrator", "Gemini 2.5 Flash");

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
  const savedMappings: Record<string, SpeakerMapping>[] = [];
  const screen = await renderSettings({ voiceOptions: [bilingualOption] }, savedMappings);

  await waitForMapping(screen);
  await choose(screen, "Voice for Narrator", "Kore (FEMALE)");
  await choose(screen, "Model for Narrator", "Gemini 2.5 Pro");

  expect(savedMappings.length).toBeGreaterThan(0);
  expect(savedMappings.every((mappings) => !mappings.Narrator?.voice)).toBe(true);

  await choose(screen, "Language for Narrator", "fr-FR");

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

test("keeps a language the newly chosen voice can also speak", async () => {
  const savedMappings: Record<string, SpeakerMapping>[] = [];
  const soleModelOption: VoiceOption = {
    ...bilingualOption,
    name: "Puck",
    models: [bilingualOption.models[1]!],
  };
  const screen = await renderSettings(
    { voiceOptions: [bilingualOption, soleModelOption] },
    savedMappings,
  );

  await waitForMapping(screen);
  await choose(screen, "Voice for Narrator", "Kore (FEMALE)");
  await choose(screen, "Model for Narrator", "Chirp 3 HD");
  await choose(screen, "Language for Narrator", "de-DE");
  await choose(screen, "Voice for Narrator", "Puck (FEMALE)");

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
  const screen = await renderSettings({ voiceOptions: [bilingualOption] }, savedMappings);

  await waitForMapping(screen);
  await choose(screen, "Voice for Narrator", "Kore (FEMALE)");
  await choose(screen, "Model for Narrator", "Gemini 2.5 Pro");
  await choose(screen, "Language for Narrator", "fr-FR");
  await vi.waitFor(() => expect(savedMappings.length).toBeGreaterThan(1));

  await choose(screen, "Model for Narrator", "Chirp 3 HD");

  await expect
    .element(screen.getByRole("combobox", { name: "Language for Narrator" }))
    .toHaveValue("");
  await vi.waitFor(() => expect(savedMappings.at(-1)).toEqual({ Narrator: {} }));
});

test("selects the sole language when a newly chosen model cannot speak the current one", async () => {
  const savedMappings: Record<string, SpeakerMapping>[] = [];
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
  const screen = await renderSettings({ voiceOptions: [option] }, savedMappings);

  await waitForMapping(screen);
  await choose(screen, "Voice for Narrator", "Kore (FEMALE)");
  await choose(screen, "Model for Narrator", "Gemini 2.5 Pro");
  await choose(screen, "Language for Narrator", "fr-FR");
  await choose(screen, "Model for Narrator", "Future");

  await expect
    .element(screen.getByRole("combobox", { name: "Language for Narrator" }))
    .toHaveValue("de-DE");
  await vi.waitFor(() =>
    expect(savedMappings.at(-1)?.Narrator?.voice).toEqual({
      provider: "gcp",
      voiceId: "Kore",
      model: "future-model",
      languageCode: "de-DE",
      supportsPrompt: true,
    }),
  );
});

test("keeps a language the newly chosen model can also speak", async () => {
  const savedMappings: Record<string, SpeakerMapping>[] = [];
  const screen = await renderSettings({ voiceOptions: [bilingualOption] }, savedMappings);

  await waitForMapping(screen);
  await choose(screen, "Voice for Narrator", "Kore (FEMALE)");
  await choose(screen, "Model for Narrator", "Gemini 2.5 Pro");
  await choose(screen, "Language for Narrator", "en-US");
  await choose(screen, "Model for Narrator", "Chirp 3 HD");

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

test("saves a prompt on the speaker and clears it away entirely", async () => {
  const savedMappings: Record<string, SpeakerMapping>[] = [];
  const screen = await renderSettings({ voiceOptions: [multiModelOption] }, savedMappings);

  await waitForMapping(screen);
  await screen.getByRole("button", { name: "Prompt for Narrator" }).click();
  await screen.getByRole("textbox", { name: "Prompt for Narrator" }).fill("Whisper");

  await vi.waitFor(() => expect(savedMappings.at(-1)).toEqual({ Narrator: { prompt: "Whisper" } }));

  await screen.getByRole("textbox", { name: "Prompt for Narrator" }).fill("");

  await vi.waitFor(() => expect(savedMappings.at(-1)).toEqual({ Narrator: {} }));
});

test("opens stored prompts after mappings load while empty prompts stay closed", async () => {
  const screen = await renderSettings({
    mappings: { Narrator: { prompt: "Whisper" }, Guest: {} },
    voiceOptions: [multiModelOption],
    electronApi: {
      getSpeakerMappings: () =>
        new Promise((resolve) => {
          setTimeout(() => resolve({ Narrator: { prompt: "Whisper" }, Guest: {} }), 0);
        }),
    },
  });

  await expect
    .element(screen.getByRole("textbox", { name: "Prompt for Narrator" }))
    .toHaveValue("Whisper");
  expect(screen.getByRole("textbox", { name: "Prompt for Guest" }).query()).toBeNull();
});

test("keeps a prompt through a switch to a voice that ignores prompts, advising so", async () => {
  const savedMappings: Record<string, SpeakerMapping>[] = [];
  const screen = await renderSettings({ voiceOptions: [bilingualOption] }, savedMappings);

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
  await vi.waitFor(() => expect(savedMappings.at(-1)?.Narrator?.prompt).toBe("Whisper"));
});

test("keeps two speakers sharing one voice on separate prompts", async () => {
  const savedMappings: Record<string, SpeakerMapping>[] = [];
  const screen = await renderSettings(
    {
      mappings: { Narrator: {}, Guest: {} },
      voiceOptions: [multiModelOption],
    },
    savedMappings,
  );

  await waitForMapping(screen, "Guest");
  await screen.getByRole("button", { name: "Prompt for Narrator" }).click();
  await screen.getByRole("textbox", { name: "Prompt for Narrator" }).fill("Whisper");
  await screen.getByRole("button", { name: "Prompt for Guest" }).click();
  await screen.getByRole("textbox", { name: "Prompt for Guest" }).fill("Shout");

  await vi.waitFor(() =>
    expect(savedMappings.at(-1)).toEqual({
      Narrator: { prompt: "Whisper" },
      Guest: { prompt: "Shout" },
    }),
  );
});

test("counts a blank prompt as no prompt rather than one set but ignored", async () => {
  const savedMappings: Record<string, SpeakerMapping>[] = [];
  const screen = await renderSettings({ voiceOptions: [multiModelOption] }, savedMappings);

  await waitForMapping(screen);
  await screen.getByRole("button", { name: "Prompt for Narrator" }).click();
  await screen.getByRole("textbox", { name: "Prompt for Narrator" }).fill("   ");

  await vi.waitFor(() => expect(savedMappings.at(-1)).toEqual({ Narrator: {} }));
  expect(screen.getByRole("button", { name: "Prompt for Narrator (set)" }).query()).toBeNull();
});

test("refuses a mapping name the notes syntax cannot express", async () => {
  const savedMappings: Record<string, SpeakerMapping>[] = [];
  const screen = await renderSettings(
    {
      mappings: { "prompt: legacy": {} },
      voiceOptions: [gcpOption],
    },
    savedMappings,
  );

  await vi.waitFor(() => expect(screen.getByText("[prompt: legacy]").query()).not.toBeNull());
  await screen.getByPlaceholder("New alias (e.g. speaker 1)").fill("p:aside");
  await screen.getByRole("button", { name: "Add Mapping" }).click();

  await vi.waitFor(() =>
    expect(screen.getByText(/cannot start with p: or prompt:/).query()).not.toBeNull(),
  );
  expect(savedMappings).toHaveLength(0);
  expect(screen.getByText("[prompt: legacy]").query()).not.toBeNull();

  await screen.getByPlaceholder("New alias (e.g. speaker 1)").fill("Narrator");
  await screen.getByRole("button", { name: "Add Mapping" }).click();
  await vi.waitFor(() => expect(savedMappings).toHaveLength(1));
  expect(screen.getByText(/cannot start with p: or prompt:/).query()).toBeNull();
});
