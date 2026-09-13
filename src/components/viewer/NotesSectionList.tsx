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
import type { NarrationSection } from "../../../shared/narration/NarrationSections";
import { getSpeakerOptions } from "../../utils/viewer";
import type { SpeakerMapping } from "../../../shared/types/tts";
import { SectionPreviewButtons } from "./SectionPreviewButtons";
import { IconPlus } from "@tabler/icons-react";
import { getEffectiveSpeaker } from "../../../shared/narration/NarrationSections";
import { DEFAULT_SPEAKER_VALUE, toSynthesisSpeaker } from "../../../shared/narration/speaker";
import { SpeakerPrompt } from "../SpeakerPrompt";

interface NotesSectionListProps {
  sections: NarrationSection[];
  mappings: Record<string, SpeakerMapping>;
  onFocusSection: (index: number) => void;
  onSpeakerChange: (index: number, speaker: string | null) => void;
  onSectionTextChange: (index: number, value: string) => void;
  onSectionPromptChange: (index: number, prompt: string | undefined) => void;
  onDeleteSection: (index: number) => void;
  onAddSection: () => void;
  assignTextareaRef: (index: number, element: HTMLTextAreaElement | null) => void;
  getTextarea: (index: number) => HTMLTextAreaElement | null;
  slideIndex: number;
  slideNotes: string;
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
  assignTextareaRef,
  getTextarea,
  slideIndex,
  slideNotes,
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
                key={index} // oxlint-disable-line react/no-array-index-key cannot be unique with data to refocus
                bdrs="4"
              >
                <Group p="xs">
                  <SpeakerPrompt
                    speakerLabel={`slide ${slideIndex} section ${index + 1}`}
                    value={section.prompt}
                    supportsPrompt={
                      mappings[toSynthesisSpeaker(effectiveSpeaker).mappingKey]?.voice
                        ?.supportsPrompt
                    }
                    onChange={(prompt) => onSectionPromptChange(index, prompt)}
                    textareaWidth="100%"
                    rowContent={{
                      leading: (
                        <Select
                          data={speakerOptions}
                          value={section.speaker}
                          onChange={(value) => onSpeakerChange(index, value)}
                          size="xs"
                          placeholder={placeholder}
                          allowDeselect={true}
                        />
                      ),
                      trailing: (
                        <Button
                          variant="subtle"
                          color="red"
                          size="xs"
                          onClick={() => onDeleteSection(index)}
                        >
                          Remove Section
                        </Button>
                      ),
                    }}
                  />
                </Group>
                <Divider />
                <SectionPreviewButtons
                  id={`${slideIndex}-${index}`}
                  slideIndex={slideIndex}
                  sectionIndex={index}
                  slideNotes={slideNotes}
                  section={section}
                  mappings={mappings}
                  onFocus={() => onFocusSection(index)}
                  getTextarea={() => getTextarea(index)}
                />
                <Divider />
                <SectionTextEditor
                  label={`Slide ${slideIndex} section ${index + 1} notes`}
                  value={section.text}
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
