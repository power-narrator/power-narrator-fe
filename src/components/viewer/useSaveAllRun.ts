import { useCallback, useRef, useState } from "react";
import type { SaveAllRunCallbacks, SaveAllRunProgress } from "../../../shared/types/narration";

export type SaveAllRunPurpose = "saveAll" | "generateVideo";

export type SaveAllRunState =
  | { stage: "idle" }
  | { stage: "confirming"; purpose: SaveAllRunPurpose }
  | { stage: "running"; progress: SaveAllRunProgress | null; cancelling: boolean };

export type SaveAllRunWork = (callbacks: SaveAllRunCallbacks) => Promise<boolean>;

type ActiveRun = { cancelRequested: boolean; cancel: (() => void) | null };

const IDLE: SaveAllRunState = { stage: "idle" };
const STARTED: SaveAllRunState = { stage: "running", progress: null, cancelling: false };

export function useSaveAllRun() {
  const [state, setState] = useState<SaveAllRunState>(IDLE);
  const answerConfirmation = useRef<((confirmed: boolean) => void) | null>(null);
  const activeRun = useRef<ActiveRun | null>(null);

  const answer = useCallback((confirmed: boolean) => {
    answerConfirmation.current?.(confirmed);
    answerConfirmation.current = null;
    setState(confirmed ? STARTED : IDLE);
  }, []);

  const track = useCallback(async (work: SaveAllRunWork) => {
    const run: ActiveRun = { cancelRequested: false, cancel: null };
    activeRun.current = run;
    setState(STARTED);
    try {
      return await work({
        onProgress: (progress) => {
          if (activeRun.current === run) {
            setState({ stage: "running", progress, cancelling: run.cancelRequested });
          }
        },
        onCancellable: (cancel) => {
          run.cancel = cancel;
          if (run.cancelRequested) {
            cancel();
          }
        },
      });
    } finally {
      activeRun.current = null;
      setState(IDLE);
    }
  }, []);

  const confirmAndRun = useCallback(
    async (purpose: SaveAllRunPurpose, work: SaveAllRunWork) => {
      const confirmed = await new Promise<boolean>((resolve) => {
        answerConfirmation.current = resolve;
        setState({ stage: "confirming", purpose });
      });
      return confirmed && track(work);
    },
    [track],
  );

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
    confirmAndRun,
    cancel,
    onConfirm: () => answer(true),
    onDecline: () => answer(false),
  };
}
