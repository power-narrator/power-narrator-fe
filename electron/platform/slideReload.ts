import fs from "node:fs";
import path from "node:path";
import {
  slideNumberOf,
  type SlideIndex,
  type SlideNumber,
} from "../../shared/slides/slideCoordinates.js";
import { getErrorMessage } from "./errors.js";
import { buildSlidesWithPaths } from "./helpers.js";
import type { ReadSlideNotesResult, SlidePptResult } from "./types.js";

type LoadSlideNotes = () => Promise<ReadSlideNotesResult>;

function resolveSlideImagePath(outputDir: string, image: string): string | null {
  const slidesDir = path.resolve(outputDir, "slides");
  const imagePath = path.resolve(outputDir, image);
  const relativePath = path.relative(slidesDir, imagePath);

  if (
    relativePath === "" ||
    relativePath.startsWith("..") ||
    path.isAbsolute(relativePath) ||
    path.dirname(imagePath) !== slidesDir
  ) {
    return null;
  }

  return imagePath;
}

function removeSlideImage(imagePath: string): void {
  try {
    fs.rmSync(imagePath, { force: true });
  } catch (error) {
    console.error(`Failed to remove slide image ${imagePath}:`, error);
  }
}

/** Exported images are named by the 1-based slide number PowerPoint uses. */
const slideImagePrefix = (slideNumber: SlideNumber): string => `Slide_${slideNumber}_`;

function matchesSlideImage(imagePath: string, slideNumber: SlideNumber): boolean {
  const imageName = path.basename(imagePath);
  return imageName.startsWith(slideImagePrefix(slideNumber)) && imageName.endsWith(".png");
}

function discardSlideImage(outputDir: string, slideNumber: SlideNumber, image: string): void {
  const imagePath = resolveSlideImagePath(outputDir, image);

  if (imagePath && matchesSlideImage(imagePath, slideNumber)) {
    removeSlideImage(imagePath);
  }
}

function isSlideImageAvailable(
  outputDir: string,
  slideNumber: SlideNumber,
  image: string,
): boolean {
  const imagePath = resolveSlideImagePath(outputDir, image);
  if (!imagePath || !matchesSlideImage(imagePath, slideNumber)) {
    return false;
  }

  try {
    return fs.statSync(imagePath).isFile();
  } catch {
    return false;
  }
}

function pruneSlideImageVersions(
  outputDir: string,
  slideNumber: SlideNumber,
  keepImage: string,
): void {
  const slidesDir = path.resolve(outputDir, "slides");
  const keepImagePath = resolveSlideImagePath(outputDir, keepImage);
  if (!keepImagePath || !isSlideImageAvailable(outputDir, slideNumber, keepImage)) {
    return;
  }

  try {
    const slidePrefix = slideImagePrefix(slideNumber);

    for (const entry of fs.readdirSync(slidesDir, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.startsWith(slidePrefix) || !entry.name.endsWith(".png")) {
        continue;
      }

      const imagePath = path.join(slidesDir, entry.name);

      if (imagePath !== keepImagePath) {
        removeSlideImage(imagePath);
      }
    }
  } catch (error) {
    console.error(`Failed to prune slide ${slideNumber} images:`, error);
  }
}

export async function completeSlideReload(
  outputDir: string,
  slideIndex: SlideIndex,
  stagedImage: string,
  loadNotes: LoadSlideNotes,
): Promise<SlidePptResult> {
  const slideNumber = slideNumberOf(slideIndex);
  let committed = false;

  try {
    if (!isSlideImageAvailable(outputDir, slideNumber, stagedImage)) {
      return { success: false, message: "The exported slide image is not available." };
    }

    const notesResult = await loadNotes();
    if (!notesResult.success) {
      return notesResult;
    }
    if (notesResult.notes === undefined) {
      return { success: false, message: "Slide notes are not available." };
    }

    const [slide] = buildSlidesWithPaths(
      [{ slideIndex, image: stagedImage, notes: notesResult.notes }],
      outputDir,
    );

    if (!slide) {
      return { success: false, message: "Could not build the reloaded slide." };
    }

    pruneSlideImageVersions(outputDir, slideNumber, stagedImage);
    committed = true;
    return { success: true, slide };
  } catch (error: unknown) {
    console.error("Failed to complete slide reload:", error);
    return { success: false, message: getErrorMessage(error) };
  } finally {
    if (!committed) {
      discardSlideImage(outputDir, slideNumber, stagedImage);
    }
  }
}
