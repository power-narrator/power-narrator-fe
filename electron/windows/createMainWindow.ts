import { app, BrowserWindow } from "electron";
import path from "path";
import { fileURLToPath } from "url";
import type { UnsavedNarrationChanges } from "./UnsavedNarrationChanges.js";

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));

export function createMainWindow(unsavedNarrationChanges: UnsavedNarrationChanges): BrowserWindow {
  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(currentDirectory, "..", "preload.cjs"),
    },
  });
  unsavedNarrationChanges.guard(mainWindow);

  if (!app.isPackaged && process.env.NODE_ENV !== "test") {
    mainWindow.loadURL("http://localhost:5173");
  } else {
    mainWindow.loadFile(path.join(currentDirectory, "../../../dist-vite/index.html"));
  }

  return mainWindow;
}
