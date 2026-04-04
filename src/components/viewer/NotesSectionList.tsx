import {
  Button,
  Divider,
  Group,
  Paper,
  ScrollArea,
  Select,
  Stack,
  Text,
  Textarea,
} from "@mantine/core";
import type { NoteSection } from "../../types/notes";
import { getSpeakerOptions } from "../../utils/viewer";
import type { Voice } from "../../types/voice";
import { SectionPreviewButtons } from "./SectionPreviewButtons";
import { IconPlus } from "@tabler/icons-react";

interface NotesSectionListProps {
  sections: NoteSection[];
  mappings: Record<string, Voice>;
  onFocusSection: (index: number) => void;
  onSpeakerChange: (index: number, speaker: string | null) => void;
  onSectionTextChange: (index: number, value: string) => void;
  onDeleteSection: (index: number) => void;
  onAddSection: () => void;
  assignTextareaRef: (index: number, element: HTMLTextAreaElement | null) => void;
  getTextarea: (index: number) => HTMLTextAreaElement | null;
}

export function NotesSectionList({
  sections,
  mappings,
  onFocusSection,
  onSpeakerChange,
  onSectionTextChange,
  onDeleteSection,
  onAddSection,
  assignTextareaRef,
  getTextarea,
}: NotesSectionListProps) {
  const speakerOptions = getSpeakerOptions(mappings);

  return (
    <Stack gap="xs" mih={0}>
      <Text size="sm">Presenter Notes</Text>
      <ScrollArea type="auto">
        <Stack>
          {sections.map((section, index) => (
            <Paper
              component={Stack}
              withBorder
              bg="var(--mantine-color-default)"
              gap="0"
              key={index} // oxlint-disable-line react/no-array-index-key cannot be unique with data to refocus
              bdrs="4"
            >
              <Group justify="space-between" p="xs">
                <Select
                  data={speakerOptions}
                  value={section.speaker}
                  onChange={(value) => onSpeakerChange(index, value)}
                  size="xs"
                  placeholder="Speaker"
                />
                <Button
                  variant="subtle"
                  color="red"
                  size="xs"
                  onClick={() => onDeleteSection(index)}
                >
                  Remove Section
                </Button>
              </Group>
              <Divider />
              <SectionPreviewButtons
                section={section}
                mappings={mappings}
                onFocus={() => onFocusSection(index)}
                getTextarea={() => getTextarea(index)}
              />
              <Divider />
              <Textarea
                ref={(element) => assignTextareaRef(index, element)}
                onFocus={() => onFocusSection(index)}
                value={section.text}
                onChange={(event) => onSectionTextChange(index, event.target.value)}
                ff="monospace"
                resize="vertical"
              />
            </Paper>
          ))}
          <Button
            variant="light"
            size="sm"
            leftSection={<IconPlus size={16} />}
            onClick={onAddSection}
          >
            Add Section
          </Button>
        </Stack>
      </ScrollArea>
    </Stack>
  );
}
