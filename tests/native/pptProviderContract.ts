import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assert, describe, expect, it, onTestFinished } from "vitest";
import {
  slideIndexFromOneBased,
  slideNumberOf,
  type SlideIndex,
} from "../../shared/slides/slideCoordinates.js";
import type { PptProvider } from "../../electron/platform/PptProvider.js";
import type {
  Result,
  SlideNarrationEntry,
  SlideWithSrc,
  SuccessResult,
} from "../../electron/platform/types.js";
import {
  inspectPresentation,
  mediaDigest,
  presentationDifferences,
  type InspectedEffect,
  type InspectedSlide,
} from "./presentationInspector.js";

/** What a provider supplies to run the shared cases. */
export type PptProviderHarness = {
  provider: PptProvider;
  /** Makes the presentation open in the app the provider automates; a no-op for a file-based provider. */
  openPresentation(filePath: string): Promise<void>;
  /** Closes the presentation without saving, if it is open. */
  closePresentation(filePath: string): Promise<void>;
  /** Whether the presentation is open in the app the provider automates; always true for a file-based provider. */
  isPresentationOpen(filePath: string): Promise<boolean>;
  /** A directory the run owns, where the app the provider automates can open files. */
  tempDir(): string;
};

const FIXTURES = fileURLToPath(new URL("../fixtures/", import.meta.url));
const HAND_BUILT_DECK = path.join(FIXTURES, "hand-built-deck.pptx");
const clip = (name: string) => new Uint8Array(fs.readFileSync(path.join(FIXTURES, "audio", name)));

const REPLACE_MAIN_SLIDE = slideIndexFromOneBased(2);
const REPLACE_TRIGGERS_SLIDE = slideIndexFromOneBased(3);
const CLEAN_SLIDE = slideIndexFromOneBased(5);

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

  function withoutSlide(slides: InspectedSlide[], slideIndex: SlideIndex): InspectedSlide[] {
    return slides.filter((_, index) => index !== slideIndex);
  }

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

  describe("removing audio", () => {
    it("leaves the slide with no section audio and keeps its other media, unrelated effects and notes", async () => {
      const deck = await openDeckCopy();
      const before = inspectPresentation(deck);
      const slideBefore = before.slides[REPLACE_MAIN_SLIDE];
      assert(slideBefore);
      const sectionAudioNames = new Set(slideBefore.sectionAudio.map(({ name }) => name));

      const removed = await harness.provider.removeAudio(deck, [REPLACE_MAIN_SLIDE]);
      expect(removed).toEqual({ success: true });
      await harness.closePresentation(deck);

      const after = inspectPresentation(deck);
      const slide = after.slides[REPLACE_MAIN_SLIDE];
      expect.soft(slide?.notes).toBe(slideBefore.notes);
      expect(slide?.sectionAudio).toEqual([]);
      expect(slide?.otherShapes).toEqual(slideBefore.otherShapes);
      expect(slide?.effects).toEqual(
        slideBefore.effects.filter(({ target }) => !sectionAudioNames.has(target)),
      );
      expect(withoutSlide(after.slides, REPLACE_MAIN_SLIDE)).toEqual(
        withoutSlide(before.slides, REPLACE_MAIN_SLIDE),
      );

      const { slide: reloaded } = succeeded(
        await harness.provider.reloadSlide(deck, REPLACE_MAIN_SLIDE, imagesDir()),
      );
      expect.soft(reloaded.notes).toBe(slideBefore.notes);
      expect(reloaded.sectionsPlayingAcrossSlides).toEqual(new Set());
    });
  });

  describe("failure part-way through a slide save", () => {
    it("reports that nothing was saved, leaves the presentation as last saved and open, and a later save holds none of the failed edits", async () => {
      const deck = await openDeckCopy();
      const before = inspectPresentation(deck);
      const failedNotes = ["Failed first section.", "---", "Failed second section."].join("\n");
      const validClip = clip("section-1.mp3");

      const failed = await harness.provider.saveSlideNarration(deck, {
        slideIndex: CLEAN_SLIDE,
        notes: failedNotes,
        audio: [validClip, clip("not-audio.mp3")].map((audioData, sectionIndex) => ({
          slideIndex: CLEAN_SLIDE,
          sectionIndex,
          audioData,
          playAcrossSlides: true,
        })),
      });
      expect(failed).toMatchObject({ success: false, saved: "nothing" });
      expect(inspectPresentation(deck)).toEqual(before);
      expect(await harness.isPresentationOpen(deck)).toBe(true);

      const notes = ["First section after the failure.", "---", "Second section after it."].join(
        "\n",
      );
      const clips = [clip("section-2.mp3"), clip("section-3.mp3")];
      const saved = await harness.provider.saveSlideNarration(deck, {
        slideIndex: CLEAN_SLIDE,
        notes,
        audio: clips.map((audioData, sectionIndex) => ({
          slideIndex: CLEAN_SLIDE,
          sectionIndex,
          audioData,
          playAcrossSlides: false,
        })),
      });
      expect(saved).toEqual({ success: true });
      await harness.closePresentation(deck);

      const after = inspectPresentation(deck);
      const clean = after.slides[CLEAN_SLIDE];
      expect.soft(clean?.notes).toBe(notes);
      expect(clean?.sectionAudio.map(({ name, media }) => ({ name, media }))).toEqual(
        clips.map((audio, sectionIndex) => ({
          name: `ppt_audio_${sectionIndex + 1}`,
          media: mediaDigest(audio),
        })),
      );
      expect(after.slides.flatMap(({ otherShapes }) => otherShapes)).not.toContainEqual(
        expect.objectContaining({ media: mediaDigest(validClip) }),
      );
      expect(clean?.otherShapes).toEqual(before.slides[CLEAN_SLIDE]?.otherShapes);
      expect(withoutSlide(after.slides, CLEAN_SLIDE)).toEqual(
        withoutSlide(before.slides, CLEAN_SLIDE),
      );

      const { slide } = succeeded(
        await harness.provider.reloadSlide(deck, CLEAN_SLIDE, imagesDir()),
      );
      expect.soft(slide.notes).toBe(notes);
      expect(slide.sectionsPlayingAcrossSlides).toEqual(new Set());
    });
  });

  describe("loading the hand-built deck", () => {
    /** What the recipe in tests/fixtures/hand-built-deck.md sets in PowerPoint's UI. */
    const recipe = [
      {
        notes: "First line of slide one.\nCafé — naïve “quotes” 日本語",
        sectionsPlayingAcrossSlides: new Set([0]),
      },
      { notes: "Slide two notes.", sectionsPlayingAcrossSlides: new Set([1]) },
      { notes: "Slide three notes.", sectionsPlayingAcrossSlides: new Set([0]) },
      { notes: "Slide four notes.", sectionsPlayingAcrossSlides: new Set<number>() },
      { notes: "Slide five notes.", sectionsPlayingAcrossSlides: new Set<number>() },
    ];

    it("reads each slide's image, notes and Play Across Slides choices as the author set them, slide by slide too", async () => {
      const deck = await openDeckCopy();
      const outputDir = imagesDir();

      const { slides } = succeeded(await harness.provider.convertPptx(deck, outputDir));

      expect(slides.map(({ slideIndex }) => slideIndex)).toEqual(
        recipe.map((_, slideIndex) => slideIndex),
      );
      expect(slides.filter(({ image }) => !fs.existsSync(path.join(outputDir, image)))).toEqual([]);
      expect.soft(slides.map(({ notes }) => notes)).toEqual(recipe.map(({ notes }) => notes));
      expect(slides.map(({ sectionsPlayingAcrossSlides }) => sectionsPlayingAcrossSlides)).toEqual(
        recipe.map(({ sectionsPlayingAcrossSlides }) => sectionsPlayingAcrossSlides),
      );

      for (const loaded of slides) {
        const reloadDir = imagesDir();
        const { slide } = succeeded(
          await harness.provider.reloadSlide(deck, loaded.slideIndex, reloadDir),
        );
        expect(path.join(reloadDir, slide.image)).toSatisfy(fs.existsSync);
        expect({
          slideIndex: slide.slideIndex,
          notes: slide.notes,
          sectionsPlayingAcrossSlides: slide.sectionsPlayingAcrossSlides,
        }).toEqual({
          slideIndex: loaded.slideIndex,
          notes: loaded.notes,
          sectionsPlayingAcrossSlides: loaded.sectionsPlayingAcrossSlides,
        });
      }
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
        REPLACE_MAIN_SLIDE,
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
        REPLACE_TRIGGERS_SLIDE,
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
