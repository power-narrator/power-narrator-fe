import { Button, Collapse, Group, Stack, Text, Textarea } from "@mantine/core";
import { IconMessage } from "@tabler/icons-react";
import { useState, type ReactNode } from "react";
import { toSpeakerPrompt } from "../../shared/narration/prompt";

interface SpeakerPromptProps {
  speakerLabel: string;
  value: string | undefined;
  supportsPrompt: boolean | undefined;
  onChange: (prompt: string | undefined) => void;
  rowContent?: { leading?: ReactNode; trailing?: ReactNode };
  textareaWidth?: number | string;
}

export function SpeakerPrompt({
  speakerLabel,
  value,
  supportsPrompt,
  onChange,
  rowContent,
}: SpeakerPromptProps) {
  const label = `Prompt for ${speakerLabel}`;
  const hasPrompt = Boolean(toSpeakerPrompt(value));
  const [closedPrompt, setClosedPrompt] = useState<string>();
  const [emptyPromptOpened, setEmptyPromptOpened] = useState(false);
  const opened = hasPrompt ? value !== closedPrompt : emptyPromptOpened;

  const toggle = () => {
    if (hasPrompt) {
      setClosedPrompt(opened ? value : undefined);
    } else {
      setClosedPrompt(undefined);
      setEmptyPromptOpened(!opened);
    }
  };

  return (
    <Stack gap="xs" flex={rowContent ? 1 : undefined}>
      <Group justify="space-between">
        <Group gap="xs">
          {rowContent?.leading}
          <Button
            aria-label={hasPrompt ? `${label} (set)` : label}
            aria-expanded={opened}
            leftSection={<IconMessage size={14} />}
            variant={hasPrompt ? "light" : "subtle"}
            color={hasPrompt ? "blue" : "gray"}
            onClick={toggle}
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
        {rowContent?.trailing}
      </Group>
      <Collapse expanded={opened}>
        <Textarea
          aria-label={label}
          placeholder="e.g. conspiratorial, almost whispering"
          value={value ?? ""}
          onChange={(event) => onChange(event.currentTarget.value || undefined)}
          autosize
          minRows={2}
          size="xs"
        />
      </Collapse>
    </Stack>
  );
}
