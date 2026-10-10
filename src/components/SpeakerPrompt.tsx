import { Button, Collapse, Group, Stack, Text, Textarea } from "@mantine/core";
import { IconMessage } from "@tabler/icons-react";
import {
  useSpeakerPrompt,
  type SpeakerPromptProps,
  type SpeakerPromptState,
} from "./useSpeakerPrompt";

export function SpeakerPromptToggle({ prompt }: { prompt: SpeakerPromptState }) {
  const { label, hasPrompt, locked, opened, toggle, supportsPrompt } = prompt;

  return (
    <>
      <Button
        aria-label={hasPrompt ? `${label} (set)` : label}
        aria-expanded={opened}
        leftSection={<IconMessage size={14} />}
        variant={hasPrompt ? "light" : "subtle"}
        color={hasPrompt ? "blue" : "gray"}
        onClick={toggle}
        disabled={locked}
        size="compact-xs"
      >
        Prompt
      </Button>
      {supportsPrompt === false && (
        <Text size="xs" c="dimmed">
          This model ignores prompts.
        </Text>
      )}
    </>
  );
}

export function SpeakerPromptField({ prompt }: { prompt: SpeakerPromptState }) {
  const { label, opened, value, onChange } = prompt;

  return (
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
  );
}

export function SpeakerPrompt(props: SpeakerPromptProps) {
  const prompt = useSpeakerPrompt(props);

  return (
    <Stack gap="xs">
      <Group gap="xs">
        <SpeakerPromptToggle prompt={prompt} />
      </Group>
      <SpeakerPromptField prompt={prompt} />
    </Stack>
  );
}
