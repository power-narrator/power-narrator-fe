import { ActionIcon, Tooltip } from "@mantine/core";
import type { ReactNode } from "react";

interface SsmlToolbarButtonProps {
  label: string;
  icon: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
}

export function SsmlToolbarButton({
  label,
  icon,
  onClick,
  disabled = false,
}: SsmlToolbarButtonProps) {
  return (
    <Tooltip label={label}>
      <ActionIcon variant="subtle" color="gray" size="lg" onClick={onClick} disabled={disabled}>
        {icon}
      </ActionIcon>
    </Tooltip>
  );
}
