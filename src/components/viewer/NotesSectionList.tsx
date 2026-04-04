import { Button, Group, ScrollArea, Select, Stack, Text, Textarea } from "@mantine/core";
import { IconPlus } from "@tabler/icons-react";
import type { NoteSection } from "../../types/notes";
import { getSpeakerOptions } from "../../utils/viewer";
import type { Voice } from "../../types/voice";
import { SectionPreviewButtons } from "./SectionPreviewButtons";

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
            <Stack gap="0" key={index} bd="1px solid var(--mantine-color-default-border)" bdrs="4">
              <Group
                justify="space-between"
                p="xs"
                bg="var(--mantine-color-default)"
                style={{
                  borderBottom: "1px solid var(--mantine-color-default-border)",
                }}
              >
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

              <SectionPreviewButtons
                section={section}
                mappings={mappings}
                onFocus={() => onFocusSection(index)}
                getTextarea={() => getTextarea(index)}
              />

              <Textarea
                ref={(element) => assignTextareaRef(index, element)}
                onFocus={() => onFocusSection(index)}
                value={section.text}
                onChange={(event) => onSectionTextChange(index, event.target.value)}
                ff="monospace"
                resize="vertical"
                styles={{
                  input: {
                    minHeight: "110px",
                  },
                }}
              />
            </Stack>
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
