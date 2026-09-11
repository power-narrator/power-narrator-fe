import type { IpcMain } from "electron";
import type { NarratedPresentationSaveRequest } from "../../shared/types/narration.js";
import type { NarratedPresentationSaver } from "./NarratedPresentationSaver.js";
import { resolvePresentationSaveTarget } from "./resolvePresentationSaveTarget.js";

interface NarratedPresentationSaveIpcRequest extends NarratedPresentationSaveRequest {
  progressChannel: string;
}

export function registerNarratedPresentationSaveIpc(
  ipc: Pick<IpcMain, "handle">,
  saver: NarratedPresentationSaver,
) {
  ipc.handle(
    "save-narrated-presentation",
    async (event, request: NarratedPresentationSaveIpcRequest) => {
      const target = resolvePresentationSaveTarget(request);
      if (!target.resolved) {
        return target.failure;
      }

      return saver.savePresentation(target.request, (progress) => {
        event.sender.send(request.progressChannel, progress);
      });
    },
  );
}
