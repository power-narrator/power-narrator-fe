import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assert, describe, expect, it, onTestFinished } from "vitest";
import { slideIndexFromOneBased } from "../../shared/slides/slideCoordinates.js";
import type { PptProvider } from "../../electron/platform/PptProvider.js";
import type { Result, SuccessResult } from "../../electron/platform/types.js";
import { inspectPresentation, mediaDigest } from "./presentationInspector.js";

/** What a provider supplies to run the shared cases. */
export type PptProviderHarness = {
  provider: PptProvider;
  /** Makes the presentation open in the app the provider automates; a no-op for a file-based provider. */
  openPresentation(filePath: string): Promise<void>;
  /** Closes the presentation without saving, if it is open. */
  closePresentation(filePath: string): Promise<void>;
  /** A directory the run owns, where the app the provider automates can open files. */
  tempDir(): string;
};

const FIXTURES = fileURLToPath(new URL("../fixtures/", import.meta.url));
const HAND_BUILT_DECK = path.join(FIXTURES, "hand-built-deck.pptx");
const clip = (name: string) => new Uint8Array(fs.readFileSync(path.join(FIXTURES, "audio", name)));

const CLEAN_SLIDE = slideIndexFromOneBased(5);

function succeeded<T extends object>(result: Result<T>): SuccessResult<T> {
  if (!result.success) {
    assert.fail(result.message);
  }
  return result;
}

/**
 * Registers the promises every PowerPoint provider keeps. Each case works on its own copy
 * of a fixture deck, closed without saving afterwards; a failed case's copy is kept.
 */
export function describePptProviderContract(harness: PptProviderHarness): void {
  /**
   * The name cannot match a deck the user has open, because the add-in also finds
   * presentations by file name.
   */
  async function openDeckCopy(): Promise<string> {
    const deck = path.join(harness.tempDir(), `power-narrator-native-${randomUUID()}.pptx`);
    fs.copyFileSync(HAND_BUILT_DECK, deck);
    onTestFinished(async ({ task }) => {
      await harness.closePresentation(deck);
      if (task.result?.state === "fail") {
        console.error(`Kept the deck of the failed case "${task.name}": ${deck}`);
      } else {
        fs.rmSync(deck, { force: true });
      }
    });
    await harness.openPresentation(deck);
    return deck;
  }

  const imagesDir = () => path.join(harness.tempDir(), `images-${randomUUID()}`);

  describe("saving new section audio", () => {
    it("keeps each section's notes and Play Across Slides choice, and leaves the rest of the presentation alone", async () => {
      const deck = await openDeckCopy();
      const before = inspectPresentation(deck);
      const notes = [
        "[Narrator]",
        "Bonjour — café, naïve “quotes” and 日本語.",
        "---",
        "Second section, first line.",
        "Second section, second line.",
        "---",
        "[Guest]",
        "Third section.",
      ].join("\n");
      const clips = ["section-1.mp3", "section-2.mp3", "section-3.mp3"].map(clip);
      const playAcrossSlides = [true, false, true];

      const saved = await harness.provider.saveSlideNarration(deck, {
        slideIndex: CLEAN_SLIDE,
        notes,
        audio: clips.map((audioData, sectionIndex) => ({
          slideIndex: CLEAN_SLIDE,
          sectionIndex,
          audioData,
          playAcrossSlides: playAcrossSlides[sectionIndex] ?? false,
        })),
      });
      expect(saved).toEqual({ success: true });
      await harness.closePresentation(deck);

      const after = inspectPresentation(deck);
      const [clean, ...otherSlidesAfter] = after.slides.toReversed();
      const [cleanBefore, ...otherSlidesBefore] = before.slides.toReversed();
      expect(clean?.notes).toBe(notes);
      expect(clean?.sectionAudio.map(({ name, media }) => ({ name, media }))).toEqual(
        clips.map((audio, sectionIndex) => ({
          name: `ppt_audio_${sectionIndex + 1}`,
          media: mediaDigest(audio),
        })),
      );
      expect(clean?.otherShapes).toEqual(cleanBefore?.otherShapes);
      expect(otherSlidesAfter).toEqual(otherSlidesBefore);

      const { slide } = succeeded(
        await harness.provider.reloadSlide(deck, CLEAN_SLIDE, imagesDir()),
      );
      expect(slide.notes).toBe(notes);
      expect(slide.sectionsPlayingAcrossSlides).toEqual(new Set([0, 2]));
    });
  });
}
