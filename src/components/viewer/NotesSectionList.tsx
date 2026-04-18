import { useEffect, useState } from "react";
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
import { getEffectiveSpeaker } from "../../utils/notes";
import { DEFAULT_SPEAKER_VALUE } from "../../constants/speaker";

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
  slideIndex: number;
}

interface SectionTextEditorProps {
  initialValue: string;
  onChange: (value: string) => void;
  onFocus: () => void;
  assignRef: (element: HTMLTextAreaElement | null) => void;
}

function SectionTextEditor({ initialValue, onChange, onFocus, assignRef }: SectionTextEditorProps) {
  const [localValue, setLocalValue] = useState(initialValue);

  // Sync from outside if needed (e.g. Undo/Redo)
  useEffect(() => {
    setLocalValue(initialValue);
  }, [initialValue]);

  return (
    <Textarea
      ref={assignRef}
      onFocus={onFocus}
      value={localValue}
      onChange={(event) => setLocalValue(event.currentTarget.value)}
      onBlur={() => {
        if (localValue !== initialValue) {
          onChange(localValue);
        }
      }}
      ff="monospace"
      resize="vertical"
      autosize
      minRows={1}
    />
  );
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
  slideIndex,
}: NotesSectionListProps) {
  const speakerOptions = getSpeakerOptions(mappings);

  return (
    <Stack gap="xs" mih={0} flex={1}>
      <Text size="sm">Presenter Notes</Text>
      <ScrollArea type="auto" flex={1}>
        <Stack>
          {sections.map((section, index) => {
            const effectiveSpeaker = getEffectiveSpeaker(sections, index);
            const isInherited = section.speaker === "" || section.speaker === DEFAULT_SPEAKER_VALUE;
            const placeholder = isInherited && effectiveSpeaker !== DEFAULT_SPEAKER_VALUE
              ? `Speaker (${effectiveSpeaker})`
              : "Speaker";

            return (
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
                    placeholder={placeholder}
                    allowDeselect={true}
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
                  id={`${slideIndex}-${index}`}
                  section={section}
                  effectiveSpeaker={effectiveSpeaker}
                  mappings={mappings}
                  onFocus={() => onFocusSection(index)}
                  getTextarea={() => getTextarea(index)}
                />
                <Divider />
                <SectionTextEditor
                  initialValue={section.text}
                  onChange={(value) => onSectionTextChange(index, value)}
                  onFocus={() => onFocusSection(index)}
                  assignRef={(element) => assignTextareaRef(index, element)}
                />
              </Paper>
            );
          })}
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
