import { ActionIcon, Menu } from "@mantine/core";
import { IconChevronDown } from "@tabler/icons-react";
import type { ReactNode } from "react";

export interface SsmlToolbarMenuItem {
  label: string;
  onClick?: () => void;
  leftSection?: ReactNode;
}

interface SsmlToolbarMenuProps {
  icon: ReactNode;
  menuLabel?: string;
  items?: SsmlToolbarMenuItem[];
  closeOnItemClick?: boolean;
  children?: ReactNode;
}

export function SsmlToolbarMenu({
  icon,
  menuLabel,
  items = [],
  closeOnItemClick = true,
  children,
}: SsmlToolbarMenuProps) {
  return (
    <Menu trigger="hover" offset={0} closeOnItemClick={closeOnItemClick}>
      <Menu.Target>
        <ActionIcon variant="subtle" color="gray" size="lg">
          {icon}
          <IconChevronDown size={12} />
        </ActionIcon>
      </Menu.Target>
      <Menu.Dropdown>
        {menuLabel ? <Menu.Label>{menuLabel}</Menu.Label> : null}
        {items.map((item) => (
          <Menu.Item key={item.label} leftSection={item.leftSection} onClick={item.onClick}>
            {item.label}
          </Menu.Item>
        ))}
        {children}
      </Menu.Dropdown>
    </Menu>
  );
}
