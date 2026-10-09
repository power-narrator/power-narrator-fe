import { useCallback, useRef, useState } from "react";
import type { SaveAllRunProgress } from "../../../shared/types/narration";

/** What the author is asked to confirm a save-all run for. */
export type SaveAllRunPurpose = "saveAll" | "generateVideo";

export type SaveAllRunState =
  | { stage: "idle" }
  | { stage: "confirming"; purpose: SaveAllRunPurpose }
  | { stage: "running"; progress: SaveAllRunProgress | null; cancelling: boolean };

export type SaveAllRunWork<T> = (
  onProgress: (progress: SaveAllRunProgress) => void,
  onCancellable: (cancel: () => void) => void,
) => Promise<T>;

type ActiveRun = { cancelRequested: boolean; cancel: (() => void) | null };

/**
 * The author-facing lifecycle of a save-all run: confirmation first, then a
 * blocking progress display for as long as the run's work is outstanding.
 * Cancelling is latched: once asked, the run stays cancelling until it settles.
 */
export function useSaveAllRun() {
  const [state, setState] = useState<SaveAllRunState>({ stage: "idle" });
  const answerConfirmation = useRef<((confirmed: boolean) => void) | null>(null);
  const activeRun = useRef<ActiveRun | null>(null);

  const confirm = useCallback(
    (purpose: SaveAllRunPurpose) =>
      new Promise<boolean>((resolve) => {
        answerConfirmation.current = resolve;
        setState({ stage: "confirming", purpose });
      }),
    [],
  );

  const answer = useCallback((confirmed: boolean) => {
    answerConfirmation.current?.(confirmed);
    answerConfirmation.current = null;
    setState(
      confirmed ? { stage: "running", progress: null, cancelling: false } : { stage: "idle" },
    );
  }, []);

  const track = useCallback(async <T>(work: SaveAllRunWork<T>) => {
    const run: ActiveRun = { cancelRequested: false, cancel: null };
    activeRun.current = run;
    setState({ stage: "running", progress: null, cancelling: false });
    try {
      return await work(
        (progress) => {
          if (activeRun.current === run) {
            setState({ stage: "running", progress, cancelling: run.cancelRequested });
          }
        },
        (cancel) => {
          run.cancel = cancel;
          if (run.cancelRequested) {
            cancel();
          }
        },
      );
    } finally {
      activeRun.current = null;
      setState({ stage: "idle" });
    }
  }, []);

  const cancel = useCallback(() => {
    const run = activeRun.current;
    if (!run || run.cancelRequested) {
      return;
    }

    run.cancelRequested = true;
    run.cancel?.();
    setState((current) =>
      current.stage === "running" ? { ...current, cancelling: true } : current,
    );
  }, []);

  return {
    state,
    active: state.stage !== "idle",
    confirm,
    track,
    cancel,
    onConfirm: () => answer(true),
    onDecline: () => answer(false),
  };
}
