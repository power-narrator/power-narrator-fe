import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assert, describe, expect, it, onTestFinished } from "vitest";
import {
  type SlideIndex,
  slideIndexFromOneBased,
  slideNumberOf,
} from "../../shared/slides/slideCoordinates.js";
import type { PptProvider } from "../../electron/platform/PptProvider.js";
import type {
  Result,
  SlideNarrationEntry,
  SlideWithSrc,
  SuccessResult,
} from "../../electron/platform/types.js";
import {
  type InspectedEffect,
  type InspectedSlide,
  inspectPresentation,
  mediaDigest,
  presentationDifferences,
} from "./presentationInspector.js";

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
const MAIN_SEQUENCE_SLIDE = slideIndexFromOneBased(2);
const TRIGGERS_SLIDE = slideIndexFromOneBased(3);

function succeeded<T extends object>(result: Result<T>): SuccessResult<T> {
  if (!result.success) {
    assert.fail(result.message);
  }
  return result;
}

/**
 * Opens a copy of the hand-built deck for one case, closed without saving afterwards; a
 * failed case's copy is kept. The name cannot match a deck the user has open, because the
 * add-in also finds presentations by file name.
 */
export async function openHandBuiltDeckCopy(harness: PptProviderHarness): Promise<string> {
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

export function slideNarration(
  slideIndex: SlideIndex,
  notes: string,
  sections: ReadonlyArray<{ clip: string; playAcrossSlides: boolean }>,
): SlideNarrationEntry {
  return {
    slideIndex,
    notes,
    audio: sections.map((section, sectionIndex) => ({
      slideIndex,
      sectionIndex,
      audioData: clip(section.clip),
      playAcrossSlides: section.playAcrossSlides,
    })),
  };
}

/** Registers the promises every PowerPoint provider keeps. */
export function describePptProviderContract(harness: PptProviderHarness): void {
  const openDeckCopy = () => openHandBuiltDeckCopy(harness);

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
      expect.soft(clean?.notes).toBe(notes);
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
      expect.soft(slide.notes).toBe(notes);
      expect(slide.sectionsPlayingAcrossSlides).toEqual(new Set([0, 2]));
    });
  });

  describe("replacing section audio", () => {
    async function replace(
      slideIndex: SlideIndex,
      notes: string,
      sections: ReadonlyArray<{ clip: string; playAcrossSlides: boolean }>,
      effects: InspectedEffect[],
    ): Promise<SlideWithSrc> {
      const deck = await openDeckCopy();
      const before = inspectPresentation(deck);

      const saved = await harness.provider.saveSlideNarration(
        deck,
        slideNarration(slideIndex, notes, sections),
      );
      expect(saved).toEqual({ success: true });
      await harness.closePresentation(deck);

      const expected = {
        slides: before.slides.map((slide) =>
          slide.slideNumber === slideNumberOf(slideIndex)
            ? savedOver(slide, notes, sections, effects)
            : slide,
        ),
      };
      expect.soft(presentationDifferences(expected, inspectPresentation(deck))).toEqual([]);

      return succeeded(await harness.provider.reloadSlide(deck, slideIndex, imagesDir())).slide;
    }

    it("on slide 2, removes the obsolete section and keeps each kept section's place, volume and mute", async () => {
      const notes = "First section, replaced.\n---\nSecond section, replaced.";

      const slide = await replace(
        MAIN_SEQUENCE_SLIDE,
        notes,
        [
          { clip: "section-1.mp3", playAcrossSlides: true },
          { clip: "section-2.mp3", playAcrossSlides: false },
        ],
        [
          { type: "play", target: "ppt_audio_1" },
          { type: "fade", target: "Box" },
          { type: "pause", target: "ppt_audio_1" },
          { type: "stop", target: "ppt_audio_1" },
          { type: "play", target: "ppt_audio_01" },
          { type: "play", target: "ppt_audio_2" },
        ],
      );

      expect.soft(slide.notes).toBe(notes);
      expect(slide.sectionsPlayingAcrossSlides).toEqual(new Set([0]));
    });

    it("on slide 3, keeps each Play started by clicking its own trigger shape", async () => {
      const notes = "First section, replaced.\n---\nSecond section, replaced.";

      const slide = await replace(
        TRIGGERS_SLIDE,
        notes,
        [
          { clip: "section-2.mp3", playAcrossSlides: false },
          { clip: "section-3.mp3", playAcrossSlides: true },
        ],
        [
          { type: "play", target: "ppt_audio_1", trigger: "Button" },
          { type: "play", target: "ppt_audio_2", trigger: "ppt_audio_2" },
        ],
      );

      expect.soft(slide.notes).toBe(notes);
      expect(slide.sectionsPlayingAcrossSlides).toEqual(new Set([1]));
    });
  });
}

/**
 * The slide saved with new notes and clips, where each section audio keeps everything but
 * its clip, and `effects` is how its animation should read.
 */
function savedOver(
  slide: InspectedSlide,
  notes: string,
  sections: ReadonlyArray<{ clip: string }>,
  effects: InspectedEffect[],
): InspectedSlide {
  return {
    ...slide,
    notes,
    sectionAudio: sections.map((section, sectionIndex) => {
      const name = `ppt_audio_${sectionIndex + 1}`;
      const kept = slide.sectionAudio.find((audio) => audio.name === name);
      assert(kept, `Slide ${slide.slideNumber} of the hand-built deck has no ${name}.`);
      return { ...kept, media: mediaDigest(clip(section.clip)) };
    }),
    effects,
  };
}
