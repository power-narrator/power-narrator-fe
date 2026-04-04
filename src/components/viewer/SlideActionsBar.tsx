import { IconDeviceTv, IconRefresh } from "@tabler/icons-react";
import type { ReactNode } from "react";
import type { ActionButtonState } from "../../types/viewer";
import { ActionButtonList } from "./ActionButtonList";

export type SlideActionBarKey =
  | "syncSlide"
  | "insertSlideAudio"
  | "playSlide"
  | "saveSlideNotes"
  | "removeSlideAudio";

interface SlideActionsBarProps {
  actionStates: Record<SlideActionBarKey, ActionButtonState>;
  handlers: Record<SlideActionBarKey, () => void>;
}

const SLIDE_ACTION_ITEMS = [
  { key: "syncSlide", label: "Sync Slide", icon: <IconRefresh size={14} /> },
  { key: "insertSlideAudio", label: "Insert Audio" },
  { key: "playSlide", label: "Play", icon: <IconDeviceTv size={14} /> },
  { key: "saveSlideNotes", label: "Save Slide Notes" },
  { key: "removeSlideAudio", label: "Remove Audio" },
] satisfies Array<{ key: SlideActionBarKey; label: string; icon?: ReactNode }>;

export function SlideActionsBar({ actionStates, handlers }: SlideActionsBarProps) {
  return (
    <ActionButtonList items={SLIDE_ACTION_ITEMS} actionStates={actionStates} handlers={handlers} />
  );
}
