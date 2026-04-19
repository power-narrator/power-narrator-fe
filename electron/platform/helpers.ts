import { app } from "electron";
import fs from "fs";
import path from "path";
import type { SlideManifestEntry, SlideWithSrc } from "./types.js";

export const APP_NAME = "power-narrator";
export const PPT_AUDIO_PREFIX = "ppt_audio";

export function resolveScriptPath(scriptName: string): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, "electron", "scripts", scriptName);
  }

  return path.join(app.getAppPath(), "electron", "scripts", scriptName);
}

export function resolveSlideAssetUrl(filePath: string): string {
  return `${APP_NAME}://slide/${encodeURIComponent(filePath)}`;
}

export function buildPptAudioFileName(sectionIndex: number): string {
  return `${PPT_AUDIO_PREFIX}_${sectionIndex + 1}.mp3`;
}

export function isManagedPptAudioName(name: string): boolean {
  return name.toLowerCase().startsWith(PPT_AUDIO_PREFIX);
}

export function normalizeNotes(notes: string): string {
  return notes.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

export function buildSlidesWithPaths(
  slides: SlideManifestEntry[],
  outputDir: string,
): SlideWithSrc[] {
  const timestamp = Date.now();

  return slides.flatMap((slide) => {
    if (!slide.image) {
      return [];
    }

    return [
      {
        ...slide,
        src: `${resolveSlideAssetUrl(path.join(outputDir, slide.image))}?t=${timestamp}`,
        notes: normalizeNotes(slide.notes || ""),
      },
    ];
  });
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
