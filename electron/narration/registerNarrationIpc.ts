import type { IpcMain } from "electron";
import type { PptProvider } from "../platform/PptProvider.js";
import { NarratedPresentationSaver } from "./NarratedPresentationSaver.js";
import {
  NarrationPreparation,
  type NarrationSynthesizer,
  type SpeakerMappingSource,
} from "./NarrationPreparation.js";
import { registerNarratedPresentationSaveIpc } from "./registerNarratedPresentationSaveIpc.js";
import { registerNarratedSlideSaveIpc } from "./registerNarratedSlideSaveIpc.js";
import { registerNarrationPreviewIpc } from "./registerNarrationPreviewIpc.js";

export type NarrationPowerPoint = Pick<PptProvider, "saveNotes" | "insertAudio" | "removeAudio">;

export type NarrationAdapters = {
  mappingSource: SpeakerMappingSource;
  synthesizer: NarrationSynthesizer;
  getPowerPoint: () => NarrationPowerPoint;
};

type NarrationIpc = Pick<IpcMain, "handle" | "removeHandler">;

export type SaveAllRunLifecycle = {
  holdWindowOpen<T>(webContentsId: number, run: () => Promise<T>): Promise<T>;
};

/**
 * Registering again replaces the previous handlers, which is the supported way
 * to run the app against fake TTS and PowerPoint adapters.
 */
export function registerNarrationIpc(
  ipc: NarrationIpc,
  adapters: NarrationAdapters,
  lifecycle: SaveAllRunLifecycle,
): void {
  const preparation = new NarrationPreparation(adapters.mappingSource, adapters.synthesizer);
  const saver = new NarratedPresentationSaver(preparation, adapters.getPowerPoint);

  ipc.removeHandler("prepare-narration-preview");
  registerNarrationPreviewIpc(ipc, preparation);

  ipc.removeHandler("save-narrated-slide");
  registerNarratedSlideSaveIpc(ipc, saver);

  ipc.removeHandler("save-narrated-presentation");
  ipc.removeHandler("cancel-narrated-presentation-save");
  registerNarratedPresentationSaveIpc(ipc, saver, lifecycle);
}
