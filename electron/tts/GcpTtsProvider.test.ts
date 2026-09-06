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
    await new GcpTtsProvider(() => "/keys/gcp.json")
      .prepareSpeech(text, selectedVoice)
      .synthesize();

    expect(synthesizeSpeech.mock.calls[0]?.[0].input).toEqual(input);
  });

  it("uses the supplied concrete voice", async () => {
    await new GcpTtsProvider(() => "/keys/gcp.json")
      .prepareSpeech("Hello", selectedVoice)
      .synthesize();

    expect(synthesizeSpeech.mock.calls[0]?.[0].voice).toEqual({
      languageCode: "en-GB",
      name: "en-GB-Chirp3-HD-Aoede",
    });
  });

  it.each([
    ["base64 strings", "AQID", [1, 2, 3]],
    ["byte arrays", new Uint8Array([4, 5, 6]), [4, 5, 6]],
  ])("converts %s to audio bytes", async (_, audioContent, expected) => {
    synthesizeSpeech.mockResolvedValue([{ audioContent }]);

    const audio = await new GcpTtsProvider(() => "/keys/gcp.json")
      .prepareSpeech("Hello", selectedVoice)
      .synthesize();

    expect(Array.from(audio)).toEqual(expected);
  });

  it.each([undefined, "", new Uint8Array()])(
    "rejects a successful response with no audio content (%j)",
    async (audioContent) => {
      synthesizeSpeech.mockResolvedValue([{ audioContent }]);

      await expect(
        new GcpTtsProvider(() => "/keys/gcp.json")
          .prepareSpeech("Hello", selectedVoice)
          .synthesize(),
      ).rejects.toThrow("GCP TTS returned no audio content");
    },
  );

  it("translates synthesis failures with provider context", async () => {
    synthesizeSpeech.mockRejectedValue(new Error("quota exhausted"));

    await expect(
      new GcpTtsProvider(() => "/keys/gcp.json").prepareSpeech("Hello", selectedVoice).synthesize(),
    ).rejects.toThrow("GCP TTS failed: quota exhausted");
  });
});
