import { ipcMain } from "electron";
import { registerNarrationIpc, type NarrationAdapters } from "../narration/registerNarrationIpc.js";
import type {
  DiscardConfirmation,
  UnsavedNarrationChanges,
} from "../windows/UnsavedNarrationChanges.js";

/**
 * The seam an automated end-to-end run uses to drive the real application
 * against deterministic fakes. It replaces the narration adapters and the
 * discard-changes prompt, and nothing else.
 */
export interface PowerNarratorTestHarness {
  /** Re-registers the narration IPC channels against fake TTS/PowerPoint adapters. */
  useNarrationAdapters(adapters: NarrationAdapters): void;
  /** Answers the discard-unsaved-changes prompt without opening a dialog. */
  useDiscardConfirmation(confirmDiscard: DiscardConfirmation): void;
}

declare global {
  var powerNarratorTestHarness: PowerNarratorTestHarness | undefined;
}

/**
 * Publishes the harness on the main-process global. Only the bootstrap calls
 * this, and only when the app was launched with `NODE_ENV=test`.
 */
export function installTestHarness(unsavedNarrationChanges: UnsavedNarrationChanges): void {
  globalThis.powerNarratorTestHarness = {
    useNarrationAdapters: (adapters) => registerNarrationIpc(ipcMain, adapters),
    useDiscardConfirmation: (confirmDiscard) =>
      unsavedNarrationChanges.useConfirmation(confirmDiscard),
  };
}
