import { ipcMain } from "electron";
import { registerNarrationIpc, type NarrationAdapters } from "../narration/registerNarrationIpc.js";
import type { DiscardConfirmation } from "../windows/UnsavedNarrationChanges.js";
import type { WindowGuards } from "../windows/createMainWindow.js";

/**
 * The seam an automated end-to-end run uses to drive the real application
 * against deterministic fakes. It replaces the narration adapters and the
 * discard-changes prompt, and nothing else.
 */
export type PowerNarratorTestHarness = {
  useNarrationAdapters(adapters: NarrationAdapters): void;
  useDiscardConfirmation(confirmDiscard: DiscardConfirmation): void;
};

declare global {
  var powerNarratorTestHarness: PowerNarratorTestHarness | undefined;
}

/** Called by the bootstrap only, and only when launched with `NODE_ENV=test`. */
export function installTestHarness({ saveAllRuns, unsavedNarrationChanges }: WindowGuards): void {
  globalThis.powerNarratorTestHarness = {
    useNarrationAdapters: (adapters) => registerNarrationIpc(ipcMain, adapters, saveAllRuns),
    useDiscardConfirmation: (confirmDiscard) =>
      unsavedNarrationChanges.useConfirmation(confirmDiscard),
  };
}
