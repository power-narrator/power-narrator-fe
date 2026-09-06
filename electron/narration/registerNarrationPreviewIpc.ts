import type { IpcMain } from "electron";
import type { PreviewNarrationRequest } from "../../shared/types/narration.js";
import type { NarrationPreparation } from "./NarrationPreparation.js";

export function registerNarrationPreviewIpc(
  ipc: Pick<IpcMain, "handle">,
  narrationPreparation: NarrationPreparation,
) {
  ipc.handle("prepare-narration-preview", async (_, request: PreviewNarrationRequest) => {
    const audio = await narrationPreparation.preparePreview(request);
    return audio ? new Uint8Array(audio) : null;
  });
}
