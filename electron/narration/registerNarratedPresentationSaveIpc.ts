import type { IpcMain } from "electron";
import type {
  NarratedPresentationSaveRequest,
  NarrationPreparationProgress,
} from "../../shared/types/narration.js";
import type { NarratedPresentationSaver } from "./NarratedPresentationSaver.js";

interface NarratedPresentationSaveIpcRequest extends NarratedPresentationSaveRequest {
  progressChannel: string;
}

export function registerNarratedPresentationSaveIpc(
  ipc: Pick<IpcMain, "handle">,
  saver: NarratedPresentationSaver,
) {
  ipc.handle(
    "save-narrated-presentation",
    async (event, request: NarratedPresentationSaveIpcRequest) =>
      saver.savePresentation(request, (progress) => {
        event.sender.send(request.progressChannel, progress);
      }),
  );
}
