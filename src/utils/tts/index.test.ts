import { afterEach, describe, expect, it, vi } from "vitest";
import { getAudioBuffer } from ".";

describe("getAudioBuffer", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends the complete section body in one request", async () => {
    const text = "Hello, welcome to the presentation.";
    const audioBytes = new Uint8Array([82, 73, 70, 70, 1, 2, 3]);
    const generateSpeech = vi.fn().mockResolvedValue(audioBytes);
    vi.stubGlobal("window", { electronAPI: { generateSpeech } });

    const result = await getAudioBuffer(text);

    expect(generateSpeech).toHaveBeenCalledOnce();
    expect(generateSpeech).toHaveBeenCalledWith({ text, voiceOption: undefined });
    expect(new Uint8Array(result)).toEqual(audioBytes);
  });
});
