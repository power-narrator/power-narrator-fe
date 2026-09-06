import type { IpcMain } from "electron";
import type { NarratedSlideSaveRequest } from "../../shared/types/narration.js";
import type { NarratedSlideSaver } from "./NarratedSlideSaver.js";

export function registerNarratedSlideSaveIpc(
  ipc: Pick<IpcMain, "handle">,
  saver: NarratedSlideSaver,
) {
  ipc.handle("save-narrated-slide", async (_, request: NarratedSlideSaveRequest) =>
    saver.save(request),
  );
}
