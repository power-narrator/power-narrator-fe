import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Voice } from "./TtsProvider.js";
import { LocalTtsProvider } from "./LocalTtsProvider.js";

const concreteVoice: Voice = {
  name: "en_US/cmu-arctic_low",
  languageCodes: ["en-US"],
  ssmlGender: "NEUTRAL",
  provider: "local",
};

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(new Response(new Uint8Array([1, 2, 3])));
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("LOCAL_TTS_VOICE", "configured/default_voice");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("LocalTtsProvider", () => {
  it("exposes the resolved configured voice instead of a default placeholder", async () => {
    await expect(new LocalTtsProvider().getVoices()).resolves.toContainEqual({
      name: "configured/default_voice",
      languageCodes: ["en-US"],
      ssmlGender: "NEUTRAL",
      provider: "local",
    });
    await expect(new LocalTtsProvider().getVoices()).resolves.not.toContainEqual(
      expect.objectContaining({ name: "default" }),
    );
  });

  it("records Mimic3's fixed WAV response encoding in the prepared request identity", () => {
    expect(
      new LocalTtsProvider().prepareSpeech("Hello", concreteVoice).cacheIdentity,
    ).toMatchObject({
      audioEncoding: "WAV",
    });
  });

  it("uses the supplied concrete voice", async () => {
    const localUrl = "http://localhost:59125/api/tts?voice=old&voice=duplicate&ssml=false&keep=yes";
    vi.stubEnv("LOCAL_TTS_URL", localUrl);

    await new LocalTtsProvider().prepareSpeech("Hello", concreteVoice).synthesize();

    const [requestUrl, requestInit] = fetchMock.mock.calls[0] ?? [];
    const url = new URL(String(requestUrl));
    expect(url.searchParams.getAll("voice")).toEqual(["en_US/cmu-arctic_low"]);
    expect(url.searchParams.getAll("ssml")).toEqual(["true"]);
    expect(requestInit).toMatchObject({
      method: "POST",
      headers: { "Content-Type": "text/plain" },
    });
    expect(url.searchParams.get("keep")).toBe("yes");
  });

  it("converts the response body to audio bytes", async () => {
    const audio = await new LocalTtsProvider().prepareSpeech("Hello", concreteVoice).synthesize();

    expect(audio).toEqual(new Uint8Array([1, 2, 3]));
  });

  it.each([
    { name: "plain text", text: "Plain text", body: "<speak>Plain text</speak>" },
    {
      name: "unwrapped SSML",
      text: 'Hello <break time="250ms"/>world',
      body: '<speak>Hello <break time="250ms"/>world</speak>',
    },
    {
      name: "wrapped SSML",
      text: "<speak>Hello <emphasis>world</emphasis></speak>",
      body: "<speak>Hello <emphasis>world</emphasis></speak>",
    },
    {
      name: "invalid XML controls",
      text: "A\u0000\u0008\tB\nC\rD\u000b\u001f",
      body: "<speak>A\tB\nC\rD</speak>",
    },
  ])("formats $name in the request body", async ({ text, body }) => {
    await new LocalTtsProvider().prepareSpeech(text, concreteVoice).synthesize();

    expect(fetchMock.mock.calls[0]?.[1]?.body).toBe(body);
  });

  it("throws a status-bearing error for a non-success response", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 503, statusText: "Unavailable" }));

    await expect(
      new LocalTtsProvider().prepareSpeech("Hello", concreteVoice).synthesize(),
    ).rejects.toThrow("Local TTS failed: 503 Unavailable");
  });

  it("rejects a successful response with no audio content", async () => {
    fetchMock.mockResolvedValue(new Response(new Uint8Array()));

    await expect(
      new LocalTtsProvider().prepareSpeech("Hello", concreteVoice).synthesize(),
    ).rejects.toThrow("Local TTS returned no audio content");
  });
});
