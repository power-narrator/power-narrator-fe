import type { IpcMain } from "electron";
import type { NarratedSlideSaveRequest } from "../../shared/types/narration.js";
import type { NarratedPresentationSaver } from "./NarratedPresentationSaver.js";

export function registerNarratedSlideSaveIpc(
  ipc: Pick<IpcMain, "handle">,
  saver: NarratedPresentationSaver,
) {
  ipc.handle("save-narrated-slide", async (_, request: NarratedSlideSaveRequest) =>
    saver.saveSlide(request),
  );
}
