import { app } from "electron";
import path from "path";

const slideAssetScheme = "power-narrator";

export function resolveScriptPath(scriptName: string): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, "electron", "scripts", scriptName);
  }

  return path.join(app.getAppPath(), "electron", "scripts", scriptName);
}

export function resolveSlideAssetUrl(filePath: string): string {
  return `${slideAssetScheme}://slide/${encodeURIComponent(filePath)}`;
}
