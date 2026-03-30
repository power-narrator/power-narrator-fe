import { ActionIcon, Button, Group } from "@mantine/core";
import { IconRefresh, IconSettings } from "@tabler/icons-react";
import type { ReactNode } from "react";
import type { ActionButtonState } from "../../types/actions";
import { ActionButtonList } from "./ActionButtonList";

export type ViewerHeaderActionKey =
  | "syncAll"
  | "insertAllAudio"
  | "saveAllNotes"
  | "removeAllAudio"
  | "generateVideo";

interface ViewerHeaderProps {
  onBack: () => void;
  onOpenSettings: () => void;
  actionStates: Record<ViewerHeaderActionKey, ActionButtonState>;
  handlers: Record<ViewerHeaderActionKey, () => void>;
}

const HEADER_ACTION_ITEMS = [
  { key: "syncAll", label: "Sync All Slides", icon: <IconRefresh size={14} /> },
  { key: "insertAllAudio", label: "Insert All Audio" },
  { key: "saveAllNotes", label: "Save All Slide Notes" },
  { key: "removeAllAudio", label: "Remove All Audio" },
  { key: "generateVideo", label: "Generate Video" },
] satisfies Array<{ key: ViewerHeaderActionKey; label: string; icon?: ReactNode }>;

export function ViewerHeader({
  onBack,
  onOpenSettings,
  actionStates,
  handlers,
}: ViewerHeaderProps) {
  return (
    <Group
      justify="space-between"
      p="xs"
      style={{
        borderBottom: "1px solid var(--mantine-color-dark-4)",
      }}
    >
      <Group>
        <Button variant="subtle" onClick={onBack}>
          &larr; Back
        </Button>
        <ActionIcon variant="subtle" onClick={onOpenSettings}>
          <IconSettings />
        </ActionIcon>
      </Group>

      <ActionButtonList
        items={HEADER_ACTION_ITEMS}
        actionStates={actionStates}
        handlers={handlers}
      />
    </Group>
  );
}
