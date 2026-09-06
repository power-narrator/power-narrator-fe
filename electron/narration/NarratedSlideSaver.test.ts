import { describe, expect, it, vi } from "vitest";
import type { Voice } from "../tts/TtsProvider.js";
import { NarrationPreparation } from "./NarrationPreparation.js";
import { NarratedSlideSaver } from "./NarratedSlideSaver.js";

const narratorVoice: Voice = {
  name: "en-US-narrator",
  languageCodes: ["en-US"],
  ssmlGender: "FEMALE",
  provider: "gcp",
};

const guestVoice: Voice = {
  name: "en-GB-guest",
  languageCodes: ["en-GB"],
  ssmlGender: "MALE",
  provider: "local",
};

function createHarness(mappings: Record<string, Voice>) {
  const pending = new Map<string, (audio: Uint8Array) => void>();
  const generateSpeech = vi.fn(
    (text: string) =>
      new Promise<Uint8Array>((resolve) => {
        pending.set(text, resolve);
      }),
  );
  const preparation = new NarrationPreparation(
    { getSpeakerMappings: () => mappings },
    { supportsProvider: () => true, generateSpeech },
  );
  const powerpoint = {
    saveNotes: vi.fn().mockResolvedValue({ success: true }),
    insertAudio: vi.fn().mockResolvedValue({ success: true }),
  };
  const saver = new NarratedSlideSaver(preparation, () => powerpoint);

  return { generateSpeech, pending, powerpoint, saver };
}

describe("NarratedSlideSaver.save", () => {
  it("prepares every section before committing notes and ordered audio", async () => {
    const { pending, powerpoint, saver } = createHarness({
      Narrator: narratorVoice,
      Guest: guestVoice,
    });
    const request = {
      filePath: "/slides/talk.pptx",
      slideIndex: 7,
      notes: "[Narrator]\nFirst\n---\nSecond\n---\n[Guest]\nThird",
    };

    const saving = saver.save(request);
    await vi.waitFor(() => expect(pending.size).toBe(3));
    expect(powerpoint.saveNotes).not.toHaveBeenCalled();
    expect(powerpoint.insertAudio).not.toHaveBeenCalled();

    pending.get("Third")?.(new Uint8Array([3]));
    pending.get("Second")?.(new Uint8Array([2]));
    pending.get("First")?.(new Uint8Array([1]));

    await expect(saving).resolves.toEqual({ success: true });
    expect(powerpoint.saveNotes).toHaveBeenCalledWith("/slides/talk.pptx", [
      { index: 7, notes: request.notes },
    ]);
    expect(powerpoint.insertAudio).toHaveBeenCalledWith("/slides/talk.pptx", [
      { index: 7, sectionIndex: 0, audioData: new Uint8Array([1]) },
      { index: 7, sectionIndex: 1, audioData: new Uint8Array([2]) },
      { index: 7, sectionIndex: 2, audioData: new Uint8Array([3]) },
    ]);
    expect(powerpoint.saveNotes.mock.invocationCallOrder[0]).toBeLessThan(
      powerpoint.insertAudio.mock.invocationCallOrder[0]!,
    );
  });

  it.each([
    ["missing default", {}, "No speaker", 'section 1, speaker "Default"'],
    [
      "unmapped speaker",
      { Narrator: narratorVoice },
      "[Narrator]\nValid\n---\n[Missing]\nInvalid",
      'section 2, speaker "Missing"',
    ],
  ])(
    "returns a contextual validation failure for %s without synthesizing or mutating PowerPoint",
    async (_, mappings, notes, context) => {
      const { generateSpeech, powerpoint, saver } = createHarness(mappings);

      await expect(
        saver.save({
          filePath: "/slides/talk.pptx",
          slideIndex: 4,
          notes,
        }),
      ).resolves.toMatchObject({
        success: false,
        stage: "validation",
        partial: false,
        message: expect.stringMatching(`slide 4, ${context}`),
      });
      expect(generateSpeech).not.toHaveBeenCalled();
      expect(powerpoint.saveNotes).not.toHaveBeenCalled();
      expect(powerpoint.insertAudio).not.toHaveBeenCalled();
    },
  );

  it("returns a contextual synthesis failure without mutating PowerPoint", async () => {
    const generateSpeech = vi.fn().mockRejectedValue(new Error("provider unavailable"));
    const preparation = new NarrationPreparation(
      { getSpeakerMappings: () => ({ Narrator: narratorVoice }) },
      { supportsProvider: () => true, generateSpeech },
    );
    const powerpoint = {
      saveNotes: vi.fn(),
      insertAudio: vi.fn(),
    };
    const saver = new NarratedSlideSaver(preparation, () => powerpoint);

    await expect(
      saver.save({
        filePath: "/slides/talk.pptx",
        slideIndex: 5,
        notes: "[Narrator]\nHello",
      }),
    ).resolves.toMatchObject({
      success: false,
      stage: "synthesis",
      partial: false,
      message: expect.stringMatching(
        /slide 5, section 1, speaker "Narrator".*provider unavailable/,
      ),
    });
    expect(powerpoint.saveNotes).not.toHaveBeenCalled();
    expect(powerpoint.insertAudio).not.toHaveBeenCalled();
  });

  it.each([
    ["notes", { success: false, message: "notes failed" }, { success: true }, false],
    ["audio", { success: true }, { success: false, message: "audio failed" }, true],
  ])(
    "reports a structured PowerPoint failure while committing %s",
    async (_, notesResult, audioResult, partial) => {
      const generateSpeech = vi.fn().mockResolvedValue(new Uint8Array([1]));
      const preparation = new NarrationPreparation(
        { getSpeakerMappings: () => ({ Narrator: narratorVoice }) },
        { supportsProvider: () => true, generateSpeech },
      );
      const powerpoint = {
        saveNotes: vi.fn().mockResolvedValue(notesResult),
        insertAudio: vi.fn().mockResolvedValue(audioResult),
      };
      const saver = new NarratedSlideSaver(preparation, () => powerpoint);

      await expect(
        saver.save({
          filePath: "/slides/talk.pptx",
          slideIndex: 2,
          notes: "[Narrator]\nHello",
        }),
      ).resolves.toEqual({
        success: false,
        stage: "powerpoint",
        partial,
        message: partial ? "audio failed" : "notes failed",
      });
      expect(powerpoint.insertAudio).toHaveBeenCalledTimes(partial ? 1 : 0);
    },
  );
});
