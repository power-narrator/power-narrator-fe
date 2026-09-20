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
import { getSpeakerOptions } from "../../utils/viewer";
import type { SpeakerMapping } from "../../../shared/types/tts";
import { SectionPreviewButtons } from "./SectionPreviewButtons";
import { IconPlus } from "@tabler/icons-react";
import { getEffectiveSpeaker } from "../../../shared/narration/NarrationSections";
import { DEFAULT_SPEAKER_VALUE, toSynthesisSpeaker } from "../../../shared/narration/speaker";
import { SpeakerPrompt } from "../SpeakerPrompt";
import type { EditorSection, SectionId } from "./SlideNoteEditor";
import type { SectionTextareas } from "./useSectionTextareas";

interface NotesSectionListProps {
  sections: readonly EditorSection[];
  mappings: Record<string, SpeakerMapping>;
  onFocusSection: (id: SectionId) => void;
  onSpeakerChange: (id: SectionId, speaker: string | null) => void;
  onSectionTextChange: (id: SectionId, value: string) => void;
  onSectionPromptChange: (id: SectionId, prompt: string | undefined) => void;
  onDeleteSection: (id: SectionId) => void;
  onAddSection: () => void;
  textareas: SectionTextareas;
  slideIndex: number;
}

interface SectionTextEditorProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  onFocus: () => void;
  assignRef: (element: HTMLTextAreaElement | null) => void;
}

function SectionTextEditor({ label, value, onChange, onFocus, assignRef }: SectionTextEditorProps) {
  return (
    <Textarea
      ref={assignRef}
      aria-label={label}
      onFocus={onFocus}
      value={value}
      onChange={(event) => onChange(event.currentTarget.value)}
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
  onSectionPromptChange,
  onDeleteSection,
  onAddSection,
  textareas,
  slideIndex,
}: NotesSectionListProps) {
  const speakerOptions = getSpeakerOptions(mappings);

  return (
    <Stack gap="xs" mih={0}>
      <Text size="sm">Presenter Notes</Text>
      <ScrollArea flex={1}>
        <Stack>
          {sections.map((section, index) => {
            const sectionLabel = `slide ${slideIndex} section ${index + 1}`;
            const effectiveSpeaker = getEffectiveSpeaker(sections, index);
            const isInherited = section.speaker === "" || section.speaker === DEFAULT_SPEAKER_VALUE;
            const placeholder =
              isInherited && effectiveSpeaker !== DEFAULT_SPEAKER_VALUE
                ? `Speaker (${effectiveSpeaker})`
                : "Speaker";

            return (
              <Paper
                component={Stack}
                withBorder
                bg="var(--mantine-color-default)"
                gap="0"
                key={section.id}
                bdrs="4"
              >
                <Group p="xs">
                  <SpeakerPrompt
                    speakerLabel={sectionLabel}
                    value={section.prompt}
                    supportsPrompt={
                      mappings[toSynthesisSpeaker(effectiveSpeaker).mappingKey]?.voice
                        ?.supportsPrompt
                    }
                    onChange={(prompt) => onSectionPromptChange(section.id, prompt)}
                    rowContent={{
                      leading: (
                        <Select
                          aria-label={`Speaker for ${sectionLabel}`}
                          data={speakerOptions}
                          value={section.speaker}
                          onChange={(value) => onSpeakerChange(section.id, value)}
                          size="xs"
                          placeholder={placeholder}
                          allowDeselect
                        />
                      ),
                      trailing: (
                        <Button
                          aria-label={`Remove ${sectionLabel}`}
                          variant="subtle"
                          color="red"
                          size="xs"
                          onClick={() => onDeleteSection(section.id)}
                        >
                          Remove Section
                        </Button>
                      ),
                    }}
                  />
                </Group>
                <Divider />
                <SectionPreviewButtons
                  id={`${slideIndex}-${section.id}`}
                  slideIndex={slideIndex}
                  sectionIndex={index}
                  sections={sections}
                  mappings={mappings}
                  onFocus={() => onFocusSection(section.id)}
                  getSelectedText={() => textareas.selectedTextIn(section.id)}
                />
                <Divider />
                <SectionTextEditor
                  label={`Slide ${slideIndex} section ${index + 1} notes`}
                  value={section.text}
                  onChange={(value) => onSectionTextChange(section.id, value)}
                  onFocus={() => onFocusSection(section.id)}
                  assignRef={(element) => textareas.assign(section.id, element)}
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
