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
  useNarrationAdapters(adapters: NarrationAdapters): void;
  useDiscardConfirmation(confirmDiscard: DiscardConfirmation): void;
}

declare global {
  var powerNarratorTestHarness: PowerNarratorTestHarness | undefined;
}

/** Called by the bootstrap only, and only when launched with `NODE_ENV=test`. */
export function installTestHarness(unsavedNarrationChanges: UnsavedNarrationChanges): void {
  globalThis.powerNarratorTestHarness = {
    useNarrationAdapters: (adapters) => registerNarrationIpc(ipcMain, adapters),
    useDiscardConfirmation: (confirmDiscard) =>
      unsavedNarrationChanges.useConfirmation(confirmDiscard),
  };
}
