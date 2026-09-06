import type { IpcMain } from "electron";
import type {
  NarratedPresentationSaveRequest,
  NarrationPreparationProgress,
} from "../../shared/types/narration.js";
import type { NarratedPresentationSaver } from "./NarratedPresentationSaver.js";

export const NARRATED_PRESENTATION_PROGRESS_CHANNEL = "narrated-presentation-save-progress";

interface NarratedPresentationSaveIpcRequest extends NarratedPresentationSaveRequest {
  requestId: number;
}

export interface NarratedPresentationProgressEvent extends NarrationPreparationProgress {
  requestId: number;
}

export function registerNarratedPresentationSaveIpc(
  ipc: Pick<IpcMain, "handle">,
  saver: NarratedPresentationSaver,
) {
  ipc.handle(
    "save-narrated-presentation",
    async (event, request: NarratedPresentationSaveIpcRequest) =>
      saver.savePresentation(request, (progress) => {
        const update: NarratedPresentationProgressEvent = {
          requestId: request.requestId,
          ...progress,
        };
        event.sender.send(NARRATED_PRESENTATION_PROGRESS_CHANNEL, update);
      }),
  );
}
