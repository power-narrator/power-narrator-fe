import { app, BrowserWindow } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { SaveAllRunGuard } from "./SaveAllRunGuard.js";
import type { UnsavedNarrationChanges } from "./UnsavedNarrationChanges.js";

export type WindowGuards = {
  saveAllRuns: SaveAllRunGuard;
  unsavedNarrationChanges: UnsavedNarrationChanges;
};

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));

export function createMainWindow(guards: WindowGuards): BrowserWindow {
  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(currentDirectory, "..", "preload.cjs"),
    },
  });
  guards.saveAllRuns.guard(mainWindow);
  guards.unsavedNarrationChanges.guard(mainWindow);

  if (!app.isPackaged && process.env.NODE_ENV !== "test") {
    void mainWindow.loadURL("http://localhost:5173");
  } else {
    void mainWindow.loadFile(path.join(currentDirectory, "../../../dist-vite/index.html"));
  }

  return mainWindow;
}
