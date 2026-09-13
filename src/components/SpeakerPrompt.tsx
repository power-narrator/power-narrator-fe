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
  textareaWidth = 220,
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
    <Stack gap={4} flex={rowContent ? 1 : undefined}>
      <Group gap="xs" justify="space-between" wrap="nowrap">
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
          // Kept verbatim while it holds anything, so a space being typed
          // mid-word survives; blanking it deletes the prompt outright.
          onChange={(event) =>
            onChange(toSpeakerPrompt(event.currentTarget.value) && event.currentTarget.value)
          }
          autosize
          minRows={2}
          size="xs"
          w={textareaWidth}
        />
      </Collapse>
    </Stack>
  );
}
