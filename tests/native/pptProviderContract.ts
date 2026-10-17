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
const FAILURES_DIR = fileURLToPath(
  new URL("../../.scratch/native-powerpoint-failures/", import.meta.url),
);
const clip = (name: string) => new Uint8Array(fs.readFileSync(path.join(FIXTURES, "audio", name)));

const REPLACE_MAIN_SLIDE = slideIndexFromOneBased(2);
const REPLACE_TRIGGERS_SLIDE = slideIndexFromOneBased(3);
export const CLEAN_SLIDE = slideIndexFromOneBased(5);

export type NarrationSection = { clip: string; playAcrossSlides: boolean };

const sectionAudioName = (sectionIndex: number) => `ppt_audio_${sectionIndex + 1}`;

function succeeded<T extends object>(result: Result<T>, context?: string): SuccessResult<T> {
  if (!result.success) {
    assert.fail(context ? `${context}: ${result.message}` : result.message);
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
      fs.mkdirSync(FAILURES_DIR, { recursive: true });
      const failedDeck = path.join(FAILURES_DIR, path.basename(deck));
      fs.copyFileSync(deck, failedDeck, fs.constants.COPYFILE_EXCL);
      fs.rmSync(deck);
      console.error(`Kept the deck of the failed case "${task.name}": ${failedDeck}`);
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
  sections: readonly NarrationSection[],
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
      const sections = [
        { clip: "section-1.mp3", playAcrossSlides: true },
        { clip: "section-2.mp3", playAcrossSlides: false },
        { clip: "section-3.mp3", playAcrossSlides: true },
      ];

      const saved = await harness.provider.saveSlideNarration(
        deck,
        slideNarration(CLEAN_SLIDE, notes, sections),
      );
      expect(saved).toEqual({ success: true });
      await harness.closePresentation(deck);

      const after = inspectPresentation(deck);
      const clean = after.slides[CLEAN_SLIDE];
      expect.soft(clean?.notes).toBe(notes);
      expect(clean?.sectionAudio.map(({ name, media }) => ({ name, media }))).toEqual(
        expectedSectionAudio(sections),
      );
      expect(clean?.otherShapes).toEqual(before.slides[CLEAN_SLIDE]?.otherShapes);
      expect(withoutSlide(after.slides, CLEAN_SLIDE)).toEqual(
        withoutSlide(before.slides, CLEAN_SLIDE),
      );

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
      const validClip = "section-1.mp3";

      const failed = await harness.provider.saveSlideNarration(
        deck,
        slideNarration(CLEAN_SLIDE, failedNotes, [
          { clip: validClip, playAcrossSlides: true },
          { clip: "not-audio.mp3", playAcrossSlides: true },
        ]),
      );
      expect(failed).toMatchObject({ success: false, saved: "nothing" });
      expect(inspectPresentation(deck)).toEqual(before);
      expect(await harness.isPresentationOpen(deck)).toBe(true);

      const otherSlideNotes = "Another slide saved after the failure.";
      const otherSlideSaved = await harness.provider.saveSlideNarration(
        deck,
        slideNarration(REPLACE_MAIN_SLIDE, otherSlideNotes, []),
      );
      expect(otherSlideSaved).toEqual({ success: true });
      await harness.closePresentation(deck);

      const afterOtherSlide = inspectPresentation(deck);
      expect(afterOtherSlide.slides[REPLACE_MAIN_SLIDE]?.notes).toBe(otherSlideNotes);
      expect(afterOtherSlide.slides[REPLACE_MAIN_SLIDE]?.sectionAudio).toEqual([]);
      expect(
        presentationDifferences(
          { slides: withoutSlide(before.slides, REPLACE_MAIN_SLIDE) },
          { slides: withoutSlide(afterOtherSlide.slides, REPLACE_MAIN_SLIDE) },
        ),
      ).toEqual([]);

      await harness.openPresentation(deck);
      const notes = ["First section after the failure.", "---", "Second section after it."].join(
        "\n",
      );
      const sections = [
        { clip: "section-2.mp3", playAcrossSlides: false },
        { clip: "section-3.mp3", playAcrossSlides: false },
      ];
      const saved = await harness.provider.saveSlideNarration(
        deck,
        slideNarration(CLEAN_SLIDE, notes, sections),
      );
      expect(saved).toEqual({ success: true });
      await harness.closePresentation(deck);

      const after = inspectPresentation(deck);
      const clean = after.slides[CLEAN_SLIDE];
      expect.soft(clean?.notes).toBe(notes);
      expect(clean?.sectionAudio.map(({ name, media }) => ({ name, media }))).toEqual(
        expectedSectionAudio(sections),
      );
      expect(after.slides.flatMap(({ otherShapes }) => otherShapes)).not.toContainEqual(
        expect.objectContaining({ media: mediaDigest(clip(validClip)) }),
      );
      expect(clean?.otherShapes).toEqual(before.slides[CLEAN_SLIDE]?.otherShapes);
      expect(withoutSlide(after.slides, CLEAN_SLIDE)).toEqual(
        withoutSlide(afterOtherSlide.slides, CLEAN_SLIDE),
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

      const reloaded = [];
      for (const loaded of slides) {
        const slideLabel = `slide ${slideNumberOf(loaded.slideIndex)}`;
        const reloadDir = imagesDir();
        const { slide } = succeeded(
          await harness.provider.reloadSlide(deck, loaded.slideIndex, reloadDir),
          slideLabel,
        );
        reloaded.push({
          slide: slideLabel,
          imageExists: fs.existsSync(path.join(reloadDir, slide.image)),
          slideIndex: slide.slideIndex,
          notes: slide.notes,
          sectionsPlayingAcrossSlides: slide.sectionsPlayingAcrossSlides,
        });
      }
      expect(reloaded).toEqual(
        slides.map((loaded) => ({
          slide: `slide ${slideNumberOf(loaded.slideIndex)}`,
          imageExists: true,
          slideIndex: loaded.slideIndex,
          notes: loaded.notes,
          sectionsPlayingAcrossSlides: loaded.sectionsPlayingAcrossSlides,
        })),
      );
    });
  });

  describe("replacing section audio", () => {
    async function replace(
      slideIndex: SlideIndex,
      notes: string,
      sections: readonly NarrationSection[],
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

function expectedSectionAudio(
  sections: readonly NarrationSection[],
): Array<{ name: string; media: string }> {
  return sections.map((section, sectionIndex) => ({
    name: sectionAudioName(sectionIndex),
    media: mediaDigest(clip(section.clip)),
  }));
}

/**
 * The slide saved with new notes and clips, where each section audio keeps everything but
 * its clip, and `effects` is how its animation should read.
 */
function savedOver(
  slide: InspectedSlide,
  notes: string,
  sections: readonly NarrationSection[],
  effects: InspectedEffect[],
): InspectedSlide {
  return {
    ...slide,
    notes,
    sectionAudio: sections.map((section, sectionIndex) => {
      const name = sectionAudioName(sectionIndex);
      const kept = slide.sectionAudio.find((audio) => audio.name === name);
      assert(kept, `Slide ${slide.slideNumber} of the hand-built deck has no ${name}.`);
      return { ...kept, media: mediaDigest(clip(section.clip)) };
    }),
    effects,
  };
}
