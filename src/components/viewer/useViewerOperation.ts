import { useCallback, useEffect, useReducer, useRef } from "react";
import type { ActionButtonState } from "../../types/viewer";

export type ViewerOperationKind =
  | "reloadAllSlides"
  | "saveAllSlides"
  | "removeAllAudio"
  | "generateVideo"
  | "reloadSlide"
  | "saveSlide"
  | "playSlide"
  | "removeAudio";

interface OperationState {
  owner: ViewerOperationKind | null;
  running: boolean;
  status: string;
}

type OperationAction =
  | { type: "started"; owner: ViewerOperationKind; status: string }
  | { type: "status"; owner: ViewerOperationKind; status: string }
  | { type: "finished"; owner: ViewerOperationKind }
  | { type: "cleared"; owner: ViewerOperationKind };

const INITIAL_STATE: OperationState = { owner: null, running: false, status: "" };

function reduceOperation(state: OperationState, action: OperationAction): OperationState {
  if (action.type === "started") {
    return { owner: action.owner, running: true, status: action.status };
  }
  if (state.owner !== action.owner) return state;
  if (action.type === "status") return { ...state, status: action.status };
  if (action.type === "finished") return { ...state, running: false };
  return INITIAL_STATE;
}

interface OperationControls {
  setStatus: (status: string) => void;
  clearStatus: () => void;
  showOutcome: (status: string) => void;
}

export function useViewerOperation() {
  const [state, dispatch] = useReducer(reduceOperation, INITIAL_STATE);
  const activeOperationRef = useRef<ViewerOperationKind | null>(null);
  const statusTimeoutRef = useRef<number | null>(null);

  const clearScheduledStatus = useCallback(() => {
    if (statusTimeoutRef.current !== null) {
      window.clearTimeout(statusTimeoutRef.current);
      statusTimeoutRef.current = null;
    }
  }, []);

  useEffect(() => clearScheduledStatus, [clearScheduledStatus]);

  const run = useCallback(
    async (
      owner: ViewerOperationKind,
      initialStatus: string,
      work: (controls: OperationControls) => Promise<void>,
      onError: (error: unknown) => void,
    ) => {
      if (activeOperationRef.current !== null) return;

      clearScheduledStatus();
      activeOperationRef.current = owner;
      dispatch({ type: "started", owner, status: initialStatus });
      const controls: OperationControls = {
        setStatus: (status) => dispatch({ type: "status", owner, status }),
        clearStatus: () => dispatch({ type: "status", owner, status: "" }),
        showOutcome: (status) => {
          dispatch({ type: "status", owner, status });
          statusTimeoutRef.current = window.setTimeout(() => {
            dispatch({ type: "cleared", owner });
            statusTimeoutRef.current = null;
          }, 2000);
        },
      };

      try {
        await work(controls);
      } catch (error: unknown) {
        dispatch({ type: "status", owner, status: "" });
        onError(error);
      } finally {
        activeOperationRef.current = null;
        dispatch({ type: "finished", owner });
      }
    },
    [clearScheduledStatus],
  );

  const actionState = useCallback(
    (owner: ViewerOperationKind): ActionButtonState => ({
      loading: state.running && state.owner === owner,
      busy: state.running && state.owner !== owner,
      status: state.owner === owner ? state.status : "",
    }),
    [state],
  );

  return { busy: state.running, run, actionState };
}
