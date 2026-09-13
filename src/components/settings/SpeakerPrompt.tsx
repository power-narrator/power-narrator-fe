import { Button, Collapse, Group, Stack, Text, Textarea } from "@mantine/core";
import { IconMessage } from "@tabler/icons-react";
import { useState } from "react";

interface SpeakerPromptProps {
  /** Names the control apart, since a row's label is the only thing that does. */
  speakerLabel: string;
  value: string | undefined;
  /** Absent until a voice is chosen, so nothing is advised about a voice not yet picked. */
  supportsPrompt: boolean | undefined;
  onChange: (prompt: string | undefined) => void;
}

export function SpeakerPrompt({
  speakerLabel,
  value,
  supportsPrompt,
  onChange,
}: SpeakerPromptProps) {
  const [opened, setOpened] = useState(false);
  const hasPrompt = Boolean(value);

  // Carried in the accessible name as well as the fill, so a closed control can
  // never hide a prompt from an author reading it either way.
  const label = `Prompt for ${speakerLabel}${hasPrompt ? " (set)" : ""}`;

  return (
    <Stack gap={4}>
      <Group gap="xs">
        <Button
          aria-label={label}
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
      <Collapse expanded={opened}>
        <Textarea
          aria-label={label}
          placeholder="e.g. conspiratorial, almost whispering"
          value={value ?? ""}
          // A cleared prompt is deleted rather than stored empty, so the
          // provider's own default delivery still applies.
          onChange={(event) => onChange(event.currentTarget.value || undefined)}
          autosize
          minRows={2}
          size="xs"
          w={220}
        />
      </Collapse>
    </Stack>
  );
}
