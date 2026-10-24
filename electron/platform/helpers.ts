import { app } from "electron";
import fs from "node:fs";
import path from "node:path";
import { slideNumberOf, type SlideIndex } from "../../shared/slides/slideCoordinates.js";
import { getErrorMessage } from "./errors.js";
import type {
  ErrorResult,
  ExportSlideImagesResult,
  ReloadSlideImageResult,
  Result,
  SlideImageMap,
  SlideManifestEntry,
  SlideWithNotes,
} from "./types.js";

export const APP_NAME = "power-narrator";
export const PPT_AUDIO_PREFIX = "ppt_audio";
const SECTION_AUDIO_NAME = new RegExp(`^${PPT_AUDIO_PREFIX}_([1-9]\\d*)$`);

export function resolveScriptPath(scriptName: string): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, "electron", "scripts", scriptName);
  }

  return path.join(app.getAppPath(), "electron", "scripts", scriptName);
}

export function resolveSlideAssetUrl(filePath: string): string {
  return `${APP_NAME}://slide/${encodeURIComponent(filePath)}`;
}

/** PowerPoint names the inserted shape after the audio file it was staged as. */
export function buildPptAudioShapeName(sectionIndex: number): string {
  return `${PPT_AUDIO_PREFIX}_${sectionIndex + 1}`;
}

export function buildPptAudioFileName(sectionIndex: number): string {
  return `${buildPptAudioShapeName(sectionIndex)}.mp3`;
}

export function sectionIndexFromPptAudioShapeName(name: string): number | undefined {
  const ordinal = SECTION_AUDIO_NAME.exec(name)?.[1];
  return ordinal === undefined ? undefined : Number(ordinal) - 1;
}

export function normalizeNotes(notes: string): string {
  return notes.replaceAll("\r\n", "\n").replaceAll("\r", "\n");
}

export function buildSlidesWithPaths(
  slides: SlideManifestEntry[],
  outputDir: string,
): SlideWithNotes[] {
  const timestamp = Date.now();

  return slides.map(({ image, ...slide }) => ({
    ...slide,
    preview: image
      ? { image, src: `${resolveSlideAssetUrl(path.join(outputDir, image))}?t=${timestamp}` }
      : null,
    notes: normalizeNotes(slide.notes),
  }));
}

export async function exportedPreviewImages(
  exportImages: () => Promise<ExportSlideImagesResult>,
): Promise<SlideImageMap> {
  const imageResult = await settlePreviewExport(exportImages);
  if (!imageResult.success) {
    console.error("Slide previews are unavailable:", imageResult.message);
    return new Map();
  }
  return imageResult.images;
}

export async function reloadedPreviewImage(
  slideIndex: SlideIndex,
  exportImage: () => Promise<ReloadSlideImageResult>,
): Promise<string | null> {
  const imageResult = await settlePreviewExport(exportImage);
  if (!imageResult.success) {
    console.error(
      `Slide ${slideNumberOf(slideIndex)} preview is unavailable:`,
      imageResult.message,
    );
    return null;
  }
  return imageResult.image;
}

async function settlePreviewExport<T extends object>(
  exportPreview: () => Promise<Result<T>>,
): Promise<Result<T>> {
  try {
    return await exportPreview();
  } catch (error) {
    return toPreviewExportError(error);
  }
}

function toPreviewExportError(error: unknown): ErrorResult {
  return { success: false, message: getErrorMessage(error) };
}

export function cleanupPaths(...paths: Array<string | null | undefined>): void {
  for (const currentPath of paths) {
    if (!currentPath || !fs.existsSync(currentPath)) {
      continue;
    }

    try {
      const stats = fs.statSync(currentPath);
      if (stats.isDirectory()) {
        fs.rmSync(currentPath, { recursive: true, force: true });
      } else {
        fs.unlinkSync(currentPath);
      }
    } catch (error) {
      console.error(`Cleanup failed for ${currentPath}:`, error);
    }
  }
}
