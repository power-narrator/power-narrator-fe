import { ActionIcon, Box, Divider, Group, Menu, rem, TextInput, Tooltip } from "@mantine/core";
import {
  IconArrowBackUp,
  IconArrowForwardUp,
  IconChevronDown,
  IconClock,
  IconKeyboard,
  IconPilcrow,
  IconPlayerPause,
  IconPlus,
  IconVolume,
} from "@tabler/icons-react";
import { useState } from "react";

interface SsmlToolbarProps {
  historyIndex: number;
  historyLength: number;
  onUndo: () => void;
  onRedo: () => void;
  onInsertSelfClosingTag: (tag: string) => void;
  onInsertWrappedTag: (startTag: string, endTag?: string) => void;
}

export function SsmlToolbar({
  historyIndex,
  historyLength,
  onUndo,
  onRedo,
  onInsertSelfClosingTag,
  onInsertWrappedTag,
}: SsmlToolbarProps) {
  const [customBreak, setCustomBreak] = useState("");

  const submitCustomBreak = () => {
    const trimmedBreak = customBreak.trim();
    if (!trimmedBreak) {
      return;
    }

    onInsertSelfClosingTag(`<break time="${trimmedBreak}"/>`);
    setCustomBreak("");
  };

  return (
    <Group bd="1px solid dark.4" p="4" bg="dark.6">
      <ActionIcon
        variant="subtle"
        color="gray"
        size="lg"
        onClick={onUndo}
        disabled={historyIndex === 0}
      >
        <IconArrowBackUp style={{ width: rem(18), height: rem(18) }} />
      </ActionIcon>
      <ActionIcon
        variant="subtle"
        color="gray"
        size="lg"
        onClick={onRedo}
        disabled={historyIndex === historyLength - 1}
      >
        <IconArrowForwardUp style={{ width: rem(18), height: rem(18) }} />
      </ActionIcon>

      <Divider orientation="vertical" />

      <Menu
        shadow="md"
        width={220}
        trigger="click"
        position="bottom-start"
        offset={0}
        closeOnItemClick={false}
      >
        <Menu.Target>
          <ActionIcon variant="subtle" color="gray" size="lg" aria-label="Break time">
            <IconPlayerPause style={{ width: rem(18), height: rem(18) }} />
            <IconChevronDown style={{ width: rem(12), height: rem(12), marginLeft: 4 }} />
          </ActionIcon>
        </Menu.Target>
        <Menu.Dropdown>
          <Menu.Label>Break Duration</Menu.Label>
          <Menu.Item
            leftSection={<IconClock size={14} />}
            onClick={() => onInsertSelfClosingTag('<break time="200ms"/>')}
          >
            200 ms
          </Menu.Item>
          <Menu.Item
            leftSection={<IconClock size={14} />}
            onClick={() => onInsertSelfClosingTag('<break time="500ms"/>')}
          >
            500 ms
          </Menu.Item>
          <Menu.Item
            leftSection={<IconClock size={14} />}
            onClick={() => onInsertSelfClosingTag('<break time="1s"/>')}
          >
            1 second
          </Menu.Item>
          <Menu.Item
            leftSection={<IconClock size={14} />}
            onClick={() => onInsertSelfClosingTag('<break time="2s"/>')}
          >
            2 seconds
          </Menu.Item>

          <Menu.Divider />
          <Menu.Label>Custom</Menu.Label>
          <Box p="xs" pt={0}>
            <Group gap={5}>
              <TextInput
                placeholder="e.g. 3s or 500ms"
                size="xs"
                value={customBreak}
                onChange={(event) => setCustomBreak(event.currentTarget.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    submitCustomBreak();
                  }
                }}
                style={{ flex: 1 }}
              />
              <ActionIcon variant="filled" color="blue" size="sm" onClick={submitCustomBreak}>
                <IconPlus size={14} />
              </ActionIcon>
            </Group>
          </Box>
        </Menu.Dropdown>
      </Menu>

      <Menu shadow="md" width={200} trigger="hover" position="bottom-start" offset={0}>
        <Menu.Target>
          <ActionIcon variant="subtle" color="gray" size="lg" aria-label="Say As">
            <IconKeyboard style={{ width: rem(18), height: rem(18) }} />
            <IconChevronDown style={{ width: rem(12), height: rem(12), marginLeft: 4 }} />
          </ActionIcon>
        </Menu.Target>
        <Menu.Dropdown>
          <Menu.Label>Interpret As</Menu.Label>
          <Menu.Item
            onClick={() => onInsertWrappedTag('<say-as interpret-as="spell-out">', "</say-as>")}
          >
            Spell Out
          </Menu.Item>
          <Menu.Item
            onClick={() => onInsertWrappedTag('<say-as interpret-as="cardinal">', "</say-as>")}
          >
            Number (Cardinal)
          </Menu.Item>
          <Menu.Item
            onClick={() => onInsertWrappedTag('<say-as interpret-as="ordinal">', "</say-as>")}
          >
            Ordinal (1st, 2nd)
          </Menu.Item>
          <Menu.Item
            onClick={() => onInsertWrappedTag('<say-as interpret-as="digits">', "</say-as>")}
          >
            Digits
          </Menu.Item>
          <Menu.Item
            onClick={() => onInsertWrappedTag('<say-as interpret-as="fraction">', "</say-as>")}
          >
            Fraction
          </Menu.Item>
          <Menu.Item
            onClick={() => onInsertWrappedTag('<say-as interpret-as="expletive">', "</say-as>")}
          >
            Expletive
          </Menu.Item>
        </Menu.Dropdown>
      </Menu>

      <Menu shadow="md" width={200} trigger="hover" position="bottom-start" offset={0}>
        <Menu.Target>
          <ActionIcon variant="subtle" color="gray" size="lg" aria-label="Emphasis">
            <IconVolume style={{ width: rem(18), height: rem(18) }} />
            <IconChevronDown style={{ width: rem(12), height: rem(12), marginLeft: 4 }} />
          </ActionIcon>
        </Menu.Target>
        <Menu.Dropdown>
          <Menu.Label>Emphasis Level</Menu.Label>
          <Menu.Item onClick={() => onInsertWrappedTag('<emphasis level="strong">', "</emphasis>")}>
            Strong
          </Menu.Item>
          <Menu.Item
            onClick={() => onInsertWrappedTag('<emphasis level="moderate">', "</emphasis>")}
          >
            Moderate
          </Menu.Item>
          <Menu.Item
            onClick={() => onInsertWrappedTag('<emphasis level="reduced">', "</emphasis>")}
          >
            Reduced
          </Menu.Item>
        </Menu.Dropdown>
      </Menu>

      <Tooltip label="Paragraph">
        <ActionIcon
          variant="subtle"
          color="gray"
          size="lg"
          onClick={() => onInsertWrappedTag("<p>", "</p>")}
        >
          <IconPilcrow style={{ width: rem(18), height: rem(18) }} />
        </ActionIcon>
      </Tooltip>
    </Group>
  );
}
