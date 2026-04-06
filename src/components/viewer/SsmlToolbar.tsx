import { ActionIcon, Divider, Group, Menu, Paper, TextInput } from "@mantine/core";
import {
  IconArrowBackUp,
  IconArrowForwardUp,
  IconClock,
  IconKeyboard,
  IconPilcrow,
  IconPlayerPause,
  IconPlus,
  IconVolume,
} from "@tabler/icons-react";
import { useState } from "react";
import { SsmlToolbarButton } from "./SsmlToolbarButton";
import { SsmlToolbarMenu } from "./SsmlToolbarMenu";

const BREAK_OPTIONS = ["200ms", "500ms", "1s", "2s"] as const;

const SAY_AS_OPTIONS = [
  { label: "Spell Out", interpretAs: "spell-out" },
  { label: "Number (Cardinal)", interpretAs: "cardinal" },
  { label: "Ordinal (1st, 2nd)", interpretAs: "ordinal" },
  { label: "Digits", interpretAs: "digits" },
  { label: "Fraction", interpretAs: "fraction" },
  { label: "Expletive", interpretAs: "expletive" },
] as const;

const EMPHASIS_OPTIONS = [
  { label: "Strong", level: "strong" },
  { label: "Moderate", level: "moderate" },
  { label: "Reduced", level: "reduced" },
] as const;

const formatBreakLabel = (value: (typeof BREAK_OPTIONS)[number]) => {
  if (value.endsWith("ms")) {
    return `${value.replace("ms", "")} ms`;
  }

  return `${value.replace("s", "")} seconds`;
};

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
    <Paper component={Group} withBorder p="4" bg="var(--mantine-color-default)">
      <SsmlToolbarButton
        label="Undo"
        icon={<IconArrowBackUp size={18} />}
        onClick={onUndo}
        disabled={historyIndex === 0}
      />
      <SsmlToolbarButton
        label="Redo"
        icon={<IconArrowForwardUp size={18} />}
        onClick={onRedo}
        disabled={historyIndex === historyLength - 1}
      />

      <Divider orientation="vertical" />

      <SsmlToolbarMenu
        icon={<IconPlayerPause size={18} />}
        menuLabel="Break Duration"
        closeOnItemClick={false}
        items={BREAK_OPTIONS.map((value) => ({
          label: formatBreakLabel(value),
          leftSection: <IconClock size={14} />,
          onClick: () => onInsertSelfClosingTag(`<break time="${value}"/>`),
        }))}
      >
        <Menu.Divider />
        <Menu.Label>Custom</Menu.Label>
        <Group gap="xs">
          <TextInput
            placeholder="e.g. 3s or 500ms"
            size="xs"
            flex="1"
            value={customBreak}
            onChange={(event) => setCustomBreak(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                submitCustomBreak();
              }
            }}
          />
          <ActionIcon variant="filled" color="blue" size="sm" onClick={submitCustomBreak}>
            <IconPlus size={14} />
          </ActionIcon>
        </Group>
      </SsmlToolbarMenu>

      <SsmlToolbarMenu
        icon={<IconKeyboard size={18} />}
        menuLabel="Interpret As"
        items={SAY_AS_OPTIONS.map((option) => ({
          label: option.label,
          onClick: () =>
            onInsertWrappedTag(`<say-as interpret-as="${option.interpretAs}">`, "</say-as>"),
        }))}
      />

      <SsmlToolbarMenu
        icon={<IconVolume size={18} />}
        menuLabel="Emphasis Level"
        items={EMPHASIS_OPTIONS.map((option) => ({
          label: option.label,
          onClick: () => onInsertWrappedTag(`<emphasis level="${option.level}">`, "</emphasis>"),
        }))}
      />

      <SsmlToolbarButton
        label="Paragraph"
        icon={<IconPilcrow size={18} />}
        onClick={() => onInsertWrappedTag("<p>", "</p>")}
      />
    </Paper>
  );
}
