import { useCallback, useRef, useState } from "react";
import type { SaveAllRunProgress } from "../../../shared/types/narration";

export type SaveAllRunState =
  | { stage: "idle" }
  | { stage: "confirming" }
  | { stage: "running"; progress: SaveAllRunProgress | null };

/**
 * The author-facing lifecycle of a save-all run: confirmation first, then a
 * blocking progress display for as long as the run's work is outstanding.
 */
export function useSaveAllRun() {
  const [state, setState] = useState<SaveAllRunState>({ stage: "idle" });
  const answerConfirmation = useRef<((confirmed: boolean) => void) | null>(null);

  const confirm = useCallback(
    () =>
      new Promise<boolean>((resolve) => {
        answerConfirmation.current = resolve;
        setState({ stage: "confirming" });
      }),
    [],
  );

  const answer = useCallback((confirmed: boolean) => {
    answerConfirmation.current?.(confirmed);
    answerConfirmation.current = null;
    setState(confirmed ? { stage: "running", progress: null } : { stage: "idle" });
  }, []);

  const track = useCallback(
    async <T>(work: (onProgress: (progress: SaveAllRunProgress) => void) => Promise<T>) => {
      setState({ stage: "running", progress: null });
      try {
        return await work((progress) => setState({ stage: "running", progress }));
      } finally {
        setState({ stage: "idle" });
      }
    },
    [],
  );

  return {
    state,
    active: state.stage !== "idle",
    confirm,
    track,
    onConfirm: () => answer(true),
    onDecline: () => answer(false),
  };
}
