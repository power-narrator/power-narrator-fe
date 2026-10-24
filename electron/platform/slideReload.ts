import fs from "node:fs";
import path from "node:path";
import {
  slideNumberOf,
  type SlideIndex,
  type SlideNumber,
} from "../../shared/slides/slideCoordinates.js";
import { getErrorMessage } from "./errors.js";
import { buildSlidesWithPaths } from "./helpers.js";
import type { SlideContent, SlidePptResult } from "./types.js";

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

/** Removes every image of the slide except `keepImagePath`, or all of them when it is null. */
function pruneSlideImageVersions(
  outputDir: string,
  slideNumber: SlideNumber,
  keepImagePath: string | null,
): void {
  const slidesDir = path.resolve(outputDir, "slides");

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

/**
 * Accepts freshly read slide content, with the preview staged for it when one
 * exported. Without a usable staged image the slide has no preview, so none
 * of its earlier images are kept beside the fresh content.
 */
export function completeSlideReload(
  outputDir: string,
  slideIndex: SlideIndex,
  content: SlideContent,
  stagedImage: string | null,
): SlidePptResult {
  const slideNumber = slideNumberOf(slideIndex);

  try {
    const image =
      stagedImage !== null && isSlideImageAvailable(outputDir, slideNumber, stagedImage)
        ? stagedImage
        : null;

    const [slide] = buildSlidesWithPaths(
      [
        {
          slideIndex,
          image,
          notes: content.notes,
          sectionsPlayingAcrossSlides: content.sectionsPlayingAcrossSlides,
        },
      ],
      outputDir,
    );

    if (!slide) {
      return { success: false, message: "Could not build the reloaded slide." };
    }

    pruneSlideImageVersions(
      outputDir,
      slideNumber,
      image && resolveSlideImagePath(outputDir, image),
    );
    return { success: true, slide };
  } catch (error: unknown) {
    console.error("Failed to complete slide reload:", error);
    return { success: false, message: getErrorMessage(error) };
  }
}
