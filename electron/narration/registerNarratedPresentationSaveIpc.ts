import type { IpcMain } from "electron";
import type {
  NarratedPresentationSaveRequest,
  SaveAllRunRouting,
  SaveAllRunResult,
} from "../../shared/types/narration.js";
import {
  SaveAllRunCancellation,
  type NarratedPresentationSaver,
} from "./NarratedPresentationSaver.js";
import type { SaveAllRunLifecycle } from "./registerNarrationIpc.js";
import { resolvePresentationSaveTarget } from "./resolvePresentationSaveTarget.js";

type NarratedPresentationSaveIpcRequest = NarratedPresentationSaveRequest & SaveAllRunRouting;

type ActiveRun = { runId: number; cancellation: SaveAllRunCancellation };

export function registerNarratedPresentationSaveIpc(
  ipc: Pick<IpcMain, "handle">,
  saver: NarratedPresentationSaver,
  lifecycle: SaveAllRunLifecycle,
) {
  const activeRunsByWindow = new Map<number, ActiveRun>();

  ipc.handle(
    "save-narrated-presentation",
    async (event, request: NarratedPresentationSaveIpcRequest): Promise<SaveAllRunResult> => {
      const target = resolvePresentationSaveTarget(request);
      if (!target.resolved) {
        return { outcome: target.failure, savedNoteSlides: [] };
      }

      const webContentsId = event.sender.id;
      const run: ActiveRun = { runId: request.runId, cancellation: new SaveAllRunCancellation() };
      activeRunsByWindow.set(webContentsId, run);
      try {
        return await lifecycle.holdWindowOpen(webContentsId, () =>
          saver.savePresentation(
            target.request,
            (progress) => {
              event.sender.send(request.progressChannel, progress);
            },
            run.cancellation,
          ),
        );
      } finally {
        if (activeRunsByWindow.get(webContentsId) === run) {
          activeRunsByWindow.delete(webContentsId);
        }
      }
    },
  );

  ipc.handle("cancel-narrated-presentation-save", (event, runId: number) => {
    const run = activeRunsByWindow.get(event.sender.id);
    if (run?.runId === runId) {
      run.cancellation.request();
    }
  });
}
