import { IconDeviceTv, IconRefresh } from "@tabler/icons-react";
import type { ReactNode } from "react";
import type { ActionButtonState } from "../../types/viewer";
import { ActionButtonList } from "./ActionButtonList";

export type SlideActionBarKey =
  | "reloadSlide"
  | "saveSlide"
  | "playSlide"
  | "removeSlideAudio";

interface SlideActionsBarProps {
  actionStates: Record<SlideActionBarKey, ActionButtonState>;
  handlers: Record<SlideActionBarKey, () => void>;
}

const SLIDE_ACTION_ITEMS = [
  { key: "reloadSlide", label: "Reload Slide", icon: <IconRefresh size={14} /> },
  { key: "saveSlide", label: "Save Slide" },
  { key: "playSlide", label: "Play", icon: <IconDeviceTv size={14} /> },
  { key: "removeSlideAudio", label: "Remove Audio" },
] satisfies Array<{ key: SlideActionBarKey; label: string; icon?: ReactNode }>;

export function SlideActionsBar({ actionStates, handlers }: SlideActionsBarProps) {
  return (
    <ActionButtonList items={SLIDE_ACTION_ITEMS} actionStates={actionStates} handlers={handlers} />
  );
}
