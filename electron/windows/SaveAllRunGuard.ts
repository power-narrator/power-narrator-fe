import { ipcMain } from "electron";
import type { BrowserWindow, IpcMain } from "electron";

/**
 * Keeps a window's renderer alive while it runs a save-all run: the window
 * cannot close, and its page cannot reload or navigate away, until the run
 * settles. A window runs at most one save-all run at a time.
 */
export class SaveAllRunGuard {
  private readonly windowsWithActiveRuns = new Set<number>();

  install(ipc: Pick<IpcMain, "on"> = ipcMain): void {
    ipc.on("may-unload-save-all-window", (event) => {
      event.returnValue = !this.windowsWithActiveRuns.has(event.sender.id);
    });
  }

  async holdWindowOpen<T>(webContentsId: number, run: () => Promise<T>): Promise<T> {
    this.windowsWithActiveRuns.add(webContentsId);
    try {
      return await run();
    } finally {
      this.windowsWithActiveRuns.delete(webContentsId);
    }
  }

  /** Must be attached before any close guard that defers to an already-prevented close. */
  guard(window: BrowserWindow): void {
    const webContentsId = window.webContents.id;
    window.on("close", (event) => {
      if (this.windowsWithActiveRuns.has(webContentsId)) {
        event.preventDefault();
      }
    });
  }
}
