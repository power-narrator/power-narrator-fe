import type { IpcMain } from "electron";
import type { NarratedSlideSaveRequest } from "../../shared/types/narration.js";
import type { NarratedPresentationSaver } from "./NarratedPresentationSaver.js";
import { resolvePresentationSaveTarget } from "./resolvePresentationSaveTarget.js";

export function registerNarratedSlideSaveIpc(
  ipc: Pick<IpcMain, "handle">,
  saver: NarratedPresentationSaver,
) {
  ipc.handle("save-narrated-slide", async (_, request: NarratedSlideSaveRequest) => {
    const target = resolvePresentationSaveTarget(request);
    return target.resolved ? saver.saveSlide(target.request) : target.failure;
  });
}
