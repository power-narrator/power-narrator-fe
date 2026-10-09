import type { IpcMain } from "electron";
import type {
  NarratedPresentationSaveRequest,
  SaveAllRunChannels,
  SaveAllRunResult,
} from "../../shared/types/narration.js";
import type { NarratedPresentationSaver } from "./NarratedPresentationSaver.js";
import type { SaveAllRunLifecycle } from "./registerNarrationIpc.js";
import { resolvePresentationSaveTarget } from "./resolvePresentationSaveTarget.js";

type NarratedPresentationSaveIpcRequest = NarratedPresentationSaveRequest & SaveAllRunChannels;

export function registerNarratedPresentationSaveIpc(
  ipc: Pick<IpcMain, "handle">,
  saver: NarratedPresentationSaver,
  lifecycle: SaveAllRunLifecycle,
) {
  const activeRuns = new Map<string, { requested: boolean }>();
  const runKey = (webContentsId: number, runId: number) => `${webContentsId}:${runId}`;

  ipc.handle(
    "save-narrated-presentation",
    async (event, request: NarratedPresentationSaveIpcRequest): Promise<SaveAllRunResult> => {
      const target = resolvePresentationSaveTarget(request);
      if (!target.resolved) {
        return { outcome: target.failure, savedNoteSlides: [] };
      }

      const key = runKey(event.sender.id, request.runId);
      const cancellation = { requested: false };
      activeRuns.set(key, cancellation);
      try {
        return await lifecycle.holdWindowOpen(event.sender.id, () =>
          saver.savePresentation(
            target.request,
            (progress) => {
              event.sender.send(request.progressChannel, progress);
            },
            cancellation,
          ),
        );
      } finally {
        activeRuns.delete(key);
      }
    },
  );

  ipc.handle("cancel-narrated-presentation-save", (event, runId: number) => {
    const cancellation = activeRuns.get(runKey(event.sender.id, runId));
    if (cancellation) {
      cancellation.requested = true;
    }
  });
}
