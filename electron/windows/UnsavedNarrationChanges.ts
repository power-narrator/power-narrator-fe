import { app, BrowserWindow, dialog, ipcMain } from "electron";
import type { IpcMain, MessageBoxOptions } from "electron";

const DISCARD_CHANGES_RESPONSE = 1;

const DISCARD_NARRATION_CHANGES_DIALOG: MessageBoxOptions = {
  type: "warning",
  buttons: ["Keep Editing", "Discard Changes"],
  defaultId: 0,
  cancelId: 0,
  message: "Discard unsaved narration changes?",
  detail: "Continuing will discard your session-only narration edits.",
};

/**
 * Asks the user whether session-only narration edits may be discarded. An
 * automated run substitutes its own implementation so no real dialog opens.
 */
export type DiscardConfirmation = (
  options: MessageBoxOptions,
  window?: BrowserWindow,
) => Promise<boolean>;

const showDiscardDialog: DiscardConfirmation = async (options, window) => {
  const result = window
    ? await dialog.showMessageBox(window, options)
    : await dialog.showMessageBox(options);
  return result.response === DISCARD_CHANGES_RESPONSE;
};

/**
 * Tracks which windows hold unsaved narration edits and blocks closing one
 * until the user confirms discarding them.
 */
export class UnsavedNarrationChanges {
  private readonly windowsWithChanges = new Set<number>();
  private quitRequested = false;
  private confirmDiscard: DiscardConfirmation = showDiscardDialog;

  /** Replaces the confirmation prompt; used to answer it without a real dialog. */
  useConfirmation(confirmDiscard: DiscardConfirmation): void {
    this.confirmDiscard = confirmDiscard;
  }

  install(ipc: Pick<IpcMain, "on" | "handle"> = ipcMain): void {
    ipc.on("set-has-unsaved-narration-changes", (event, hasChanges: boolean) => {
      if (hasChanges) {
        this.windowsWithChanges.add(event.sender.id);
      } else {
        this.windowsWithChanges.delete(event.sender.id);
      }
      event.returnValue = undefined;
    });

    ipc.handle("confirm-discard-narration-changes", (event) =>
      this.confirm(BrowserWindow.fromWebContents(event.sender) ?? undefined),
    );

    app.on("before-quit", () => {
      this.quitRequested = true;
    });
  }

  /** Intercepts `window`'s close while it still holds unsaved narration edits. */
  guard(window: BrowserWindow): void {
    const webContentsId = window.webContents.id;
    let allowClose = false;
    let confirmationOpen = false;

    window.on("close", (event) => {
      if (allowClose || !this.windowsWithChanges.has(webContentsId)) {
        return;
      }

      event.preventDefault();
      if (confirmationOpen) {
        return;
      }

      confirmationOpen = true;
      void this.confirm(window).then((discardChanges) => {
        confirmationOpen = false;
        if (!discardChanges) {
          this.quitRequested = false;
          return;
        }

        allowClose = true;
        if (this.quitRequested) {
          app.quit();
        } else {
          window.close();
        }
      });
    });

    window.on("closed", () => {
      this.windowsWithChanges.delete(webContentsId);
    });
  }

  private confirm(window?: BrowserWindow): Promise<boolean> {
    return this.confirmDiscard(DISCARD_NARRATION_CHANGES_DIALOG, window);
  }
}
