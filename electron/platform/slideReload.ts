import fs from "fs";
import path from "path";
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

function matchesSlideImageIndex(imagePath: string, slideIndex: number): boolean {
  const imageName = path.basename(imagePath);
  return imageName.startsWith(`Slide_${slideIndex}_`) && imageName.endsWith(".png");
}

function discardSlideImage(outputDir: string, slideIndex: number, image: string): void {
  const imagePath = resolveSlideImagePath(outputDir, image);

  if (imagePath && matchesSlideImageIndex(imagePath, slideIndex)) {
    removeSlideImage(imagePath);
  }
}

function isSlideImageAvailable(outputDir: string, slideIndex: number, image: string): boolean {
  const imagePath = resolveSlideImagePath(outputDir, image);
  if (!imagePath || !matchesSlideImageIndex(imagePath, slideIndex)) {
    return false;
  }

  try {
    return fs.statSync(imagePath).isFile();
  } catch {
    return false;
  }
}

function pruneSlideImageVersions(outputDir: string, slideIndex: number, keepImage: string): void {
  const slidesDir = path.resolve(outputDir, "slides");
  const keepImagePath = resolveSlideImagePath(outputDir, keepImage);
  if (!keepImagePath || !isSlideImageAvailable(outputDir, slideIndex, keepImage)) {
    return;
  }

  try {
    const slidePrefix = `Slide_${slideIndex}_`;

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
    console.error(`Failed to prune slide ${slideIndex} images:`, error);
  }
}

export async function completeSlideReload(
  outputDir: string,
  slideIndex: number,
  stagedImage: string,
  loadNotes: LoadSlideNotes,
): Promise<SlidePptResult> {
  let committed = false;

  try {
    if (!isSlideImageAvailable(outputDir, slideIndex, stagedImage)) {
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
      [{ index: slideIndex, image: stagedImage, notes: notesResult.notes }],
      outputDir,
    );

    if (!slide) {
      return { success: false, message: "Could not build the reloaded slide." };
    }

    pruneSlideImageVersions(outputDir, slideIndex, stagedImage);
    committed = true;
    return { success: true, slide };
  } catch (error: unknown) {
    console.error("Failed to complete slide reload:", error);
    return { success: false, message: getErrorMessage(error) };
  } finally {
    if (!committed) {
      discardSlideImage(outputDir, slideIndex, stagedImage);
    }
  }
}
