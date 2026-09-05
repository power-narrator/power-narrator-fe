import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Voice } from "./TtsProvider.js";
import { LocalTtsProvider } from "./LocalTtsProvider.js";

const concreteVoice: Voice = {
  name: "en_US/cmu-arctic_low",
  languageCodes: ["en-US"],
  ssmlGender: "NEUTRAL",
  provider: "local",
};

const defaultPlaceholder: Voice = {
  name: "default",
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
  it.each([
    {
      name: "a concrete selected voice wins",
      voice: concreteVoice,
      expectedVoice: "en_US/cmu-arctic_low",
      localUrl: "http://localhost:59125/api/tts?voice=old&voice=duplicate&ssml=false&keep=yes",
    },
    {
      name: "an omitted voice uses LOCAL_TTS_VOICE",
      voice: undefined,
      expectedVoice: "configured/default_voice",
      localUrl: "http://localhost:59125/api/tts",
    },
    {
      name: "the default placeholder uses LOCAL_TTS_VOICE",
      voice: defaultPlaceholder,
      expectedVoice: "configured/default_voice",
      localUrl: "http://localhost:59125/api/tts",
    },
  ])("resolves $name", async ({ voice, expectedVoice, localUrl }) => {
    vi.stubEnv("LOCAL_TTS_URL", localUrl);

    await new LocalTtsProvider().generateSpeech("Hello", voice);

    const [requestUrl, requestInit] = fetchMock.mock.calls[0] ?? [];
    const url = new URL(String(requestUrl));
    expect(url.searchParams.getAll("voice")).toEqual([expectedVoice]);
    expect(url.searchParams.getAll("ssml")).toEqual(["true"]);
    expect(requestInit).toMatchObject({
      method: "POST",
      headers: { "Content-Type": "text/plain" },
    });
    if (voice === concreteVoice) {
      expect(url.searchParams.get("keep")).toBe("yes");
    }
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
    await new LocalTtsProvider().generateSpeech(text);

    expect(fetchMock.mock.calls[0]?.[1]?.body).toBe(body);
  });

  it("throws a status-bearing error for a non-success response", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 503, statusText: "Unavailable" }));

    await expect(new LocalTtsProvider().generateSpeech("Hello")).rejects.toThrow(
      "Local TTS failed: 503 Unavailable",
    );
  });
});
