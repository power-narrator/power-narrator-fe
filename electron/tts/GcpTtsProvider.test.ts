import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Voice } from "./TtsProvider.js";
import { GcpTtsProvider } from "./GcpTtsProvider.js";

const { clientConstructor, listVoices, synthesizeSpeech } = vi.hoisted(() => ({
  clientConstructor: vi.fn(),
  listVoices: vi.fn(),
  synthesizeSpeech: vi.fn(),
}));

vi.mock("@google-cloud/text-to-speech", () => ({
  TextToSpeechClient: class {
    constructor(options: unknown) {
      clientConstructor(options);
    }

    listVoices = listVoices;
    synthesizeSpeech = synthesizeSpeech;
  },
}));

const selectedVoice: Voice = {
  name: "en-GB-Chirp3-HD-Aoede",
  languageCodes: ["en-GB", "en-US"],
  ssmlGender: "FEMALE",
  provider: "gcp",
};

beforeEach(() => {
  clientConstructor.mockClear();
  listVoices.mockReset();
  synthesizeSpeech.mockReset();
  synthesizeSpeech.mockResolvedValue([{ audioContent: new Uint8Array([1, 2, 3]) }]);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("GcpTtsProvider", () => {
  it("returns no voices without constructing a client when credentials are missing", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});

    await expect(new GcpTtsProvider(() => undefined).getVoices()).resolves.toEqual([]);
    expect(clientConstructor).not.toHaveBeenCalled();
    expect(warning).toHaveBeenCalledOnce();
  });

  it("normalizes complete GB and US Chirp voices into owned records", async () => {
    const gbSdkVoice = {
      name: "en-GB-Chirp3-HD-Aoede",
      languageCodes: ["en-GB"],
      ssmlGender: "FEMALE",
      naturalSampleRateHertz: 24_000,
    };
    const usSdkVoice = {
      name: "en-US-Chirp3-HD-Puck",
      languageCodes: ["en-US"],
      ssmlGender: "MALE",
    };
    listVoices
      .mockResolvedValueOnce([
        {
          voices: [
            gbSdkVoice,
            { name: "en-GB-Neural2-A", languageCodes: ["en-GB"], ssmlGender: "FEMALE" },
            { name: "en-GB-Chirp3-HD-Incomplete", languageCodes: [] },
          ],
        },
      ])
      .mockResolvedValueOnce([{ voices: [usSdkVoice] }]);

    const voices = await new GcpTtsProvider(() => "/keys/gcp.json").getVoices();

    expect(listVoices).toHaveBeenNthCalledWith(1, { languageCode: "en-GB" });
    expect(listVoices).toHaveBeenNthCalledWith(2, { languageCode: "en-US" });
    expect(voices).toEqual([
      {
        name: "en-GB-Chirp3-HD-Aoede",
        languageCodes: ["en-GB"],
        ssmlGender: "FEMALE",
        provider: "gcp",
      },
      {
        name: "en-US-Chirp3-HD-Puck",
        languageCodes: ["en-US"],
        ssmlGender: "MALE",
        provider: "gcp",
      },
    ]);
    expect(voices[0]).not.toBe(gbSdkVoice);
    expect(voices[0]?.languageCodes).not.toBe(gbSdkVoice.languageCodes);
  });

  it.each([
    {
      name: "plain text",
      text: "  Plain text stays exact.  ",
      input: { text: "  Plain text stays exact.  " },
    },
    {
      name: "unwrapped SSML",
      text: 'Hello <break time="250ms"/>world',
      input: { ssml: '<speak>Hello <break time="250ms"/>world</speak>' },
    },
    {
      name: "wrapped SSML",
      text: "<speak>Hello <emphasis>world</emphasis></speak>",
      input: { ssml: "<speak>Hello <emphasis>world</emphasis></speak>" },
    },
  ])("formats $name for the SDK input", async ({ text, input }) => {
    await new GcpTtsProvider(() => "/keys/gcp.json").generateSpeech(text);

    expect(synthesizeSpeech.mock.calls[0]?.[0].input).toEqual(input);
  });

  it.each([
    {
      name: "uses a supplied voice",
      voice: selectedVoice,
      expected: { languageCode: "en-GB", name: "en-GB-Chirp3-HD-Aoede" },
    },
    {
      name: "uses the GCP default when the voice is omitted",
      voice: undefined,
      expected: { languageCode: "en-US", name: "en-US-Journey-F" },
    },
  ])("$name", async ({ voice, expected }) => {
    await new GcpTtsProvider(() => "/keys/gcp.json").generateSpeech("Hello", voice);

    expect(synthesizeSpeech.mock.calls[0]?.[0].voice).toEqual(expected);
  });
});
