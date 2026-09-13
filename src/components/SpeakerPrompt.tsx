import { Button, Collapse, Group, Stack, Text, Textarea } from "@mantine/core";
import { IconMessage } from "@tabler/icons-react";
import { useState, type ReactNode } from "react";
import { toSpeakerPrompt } from "../../shared/narration/prompt";

interface SpeakerPromptProps {
  /** Names the control apart, since a row's label is the only thing that does. */
  speakerLabel: string;
  value: string | undefined;
  /** Absent until a voice is chosen, so nothing is advised about a voice not yet picked. */
  supportsPrompt: boolean | undefined;
  onChange: (prompt: string | undefined) => void;
  /**
   * The rest of the row the toggle sits in, so the revealed box lands beneath
   * the whole row rather than beside its neighbours.
   */
  row?: { leading?: ReactNode; trailing?: ReactNode };
  boxWidth?: number | string;
}

export function SpeakerPrompt({
  speakerLabel,
  value,
  supportsPrompt,
  onChange,
  row,
  boxWidth = 220,
}: SpeakerPromptProps) {
  const [opened, setOpened] = useState(false);
  const label = `Prompt for ${speakerLabel}`;
  const hasPrompt = Boolean(toSpeakerPrompt(value));

  return (
    <Stack gap={4} flex={row ? 1 : undefined}>
      <Group gap="xs" justify="space-between" wrap="nowrap">
        <Group gap="xs">
          {row?.leading}
          <Button
            // The fill alone would leave a closed control able to hide a prompt
            // from an author reading by name rather than by eye.
            aria-label={hasPrompt ? `${label} (set)` : label}
            aria-expanded={opened}
            leftSection={<IconMessage size={14} />}
            variant={hasPrompt ? "light" : "subtle"}
            color={hasPrompt ? "blue" : "gray"}
            onClick={() => setOpened(!opened)}
            size="compact-xs"
          >
            Prompt
          </Button>
          {supportsPrompt === false && (
            <Text size="xs" c="dimmed">
              This model ignores prompts.
            </Text>
          )}
        </Group>
        {row?.trailing}
      </Group>
      <Collapse expanded={opened}>
        <Textarea
          aria-label={label}
          placeholder="e.g. conspiratorial, almost whispering"
          value={value ?? ""}
          // Kept verbatim while it holds anything, so a space being typed
          // mid-word survives; blanking it deletes the prompt outright.
          onChange={(event) =>
            onChange(toSpeakerPrompt(event.currentTarget.value) && event.currentTarget.value)
          }
          autosize
          minRows={2}
          size="xs"
          w={boxWidth}
        />
      </Collapse>
    </Stack>
  );
}
