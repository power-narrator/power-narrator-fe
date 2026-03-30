import { Button, Group } from "@mantine/core";
import type { ReactNode } from "react";
import type { ActionButtonState } from "../../types/actions";

export interface ActionButtonItem<TKey extends string> {
  key: TKey;
  label: string;
  icon?: ReactNode;
}

interface ActionButtonListProps<TKey extends string> {
  items: ActionButtonItem<TKey>[];
  actionStates: Record<TKey, ActionButtonState>;
  handlers: Record<TKey, () => void>;
}

export function ActionButtonList<TKey extends string>({
  items,
  actionStates,
  handlers,
}: ActionButtonListProps<TKey>) {
  return (
    <Group gap="md">
      {items.map((item) => {
        const actionState = actionStates[item.key];

        return (
          <Button
            key={item.key}
            size="xs"
            leftSection={item.icon}
            onClick={handlers[item.key]}
            loading={actionState.loading}
            disabled={actionState.busy}
          >
            {actionState.status || item.label}
          </Button>
        );
      })}
    </Group>
  );
}
