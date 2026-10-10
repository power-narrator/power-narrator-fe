import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, it, onTestFinished, vi } from "vitest";
import { toSlideIndex } from "../../shared/slides/slideCoordinates.js";
import { TtsManager } from "../tts/TtsManager.js";
import type { TtsProvider, Voice } from "../tts/TtsProvider.js";
import { NarrationPreparation } from "./NarrationPreparation.js";

const narratorVoice: Voice = {
  provider: "gcp",
  voiceId: "Narrator",
  model: "chirp-3-hd",
  languageCode: "en-US",
  supportsPrompt: false,
};

it("reuses cached narration for a repeated prepared request", async () => {
  const cacheDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "power-narrator-preparation-"));
  onTestFinished(() => fs.rmSync(cacheDirectory, { recursive: true, force: true }));
  const synthesize = vi
    .fn<() => Promise<Uint8Array>>()
    .mockResolvedValue(new Uint8Array([7, 8, 9]));
  const provider: TtsProvider = {
    getVoices: vi.fn<TtsProvider["getVoices"]>().mockResolvedValue([]),
    prepareSpeech: (text, voice) => ({
      cacheIdentity: { text, voice: voice.voiceId },
      synthesize,
    }),
  };
  const preparation = new NarrationPreparation(
    { getSpeakerMappings: () => ({ Narrator: { voice: narratorVoice } }) },
    new TtsManager(new Map([["gcp", provider]]), cacheDirectory),
  );
  const request = {
    slideIndex: toSlideIndex(1),
    sectionIndex: 0,
    sections: [{ speaker: "Narrator", text: "Hello", playAcrossSlides: false }],
    text: " Hello ",
    speakerChoice: { kind: "effective" as const },
  };

  await preparation.preparePreview(request);
  await expect(preparation.preparePreview(request)).resolves.toEqual({
    audio: new Uint8Array([7, 8, 9]),
    mediaType: "audio/mpeg",
  });

  expect(synthesize).toHaveBeenCalledOnce();
});
