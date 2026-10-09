import type { IpcMain } from "electron";
import type {
  NarratedPresentationSaveRequest,
  SaveAllRunResult,
} from "../../shared/types/narration.js";
import type { NarratedPresentationSaver } from "./NarratedPresentationSaver.js";
import type { SaveAllRunLifecycle } from "./registerNarrationIpc.js";
import { resolvePresentationSaveTarget } from "./resolvePresentationSaveTarget.js";

type NarratedPresentationSaveIpcRequest = NarratedPresentationSaveRequest & {
  progressChannel: string;
};

export function registerNarratedPresentationSaveIpc(
  ipc: Pick<IpcMain, "handle">,
  saver: NarratedPresentationSaver,
  lifecycle: SaveAllRunLifecycle,
) {
  ipc.handle(
    "save-narrated-presentation",
    async (event, request: NarratedPresentationSaveIpcRequest): Promise<SaveAllRunResult> => {
      const target = resolvePresentationSaveTarget(request);
      if (!target.resolved) {
        return { outcome: target.failure, savedNoteSlides: [] };
      }

      return lifecycle.holdWindowOpen(event.sender.id, () =>
        saver.savePresentation(target.request, (progress) => {
          event.sender.send(request.progressChannel, progress);
        }),
      );
    },
  );
}
