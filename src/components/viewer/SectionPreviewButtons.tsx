import { ActionIcon, Box, Button, Center, Group, Loader, Slider, Stack, Text } from "@mantine/core";
import { IconHistory, IconPlayerPlay, IconPlayerStop } from "@tabler/icons-react";
import type { NarrationSection } from "../../../shared/narration/NarrationSections";
import { DEFAULT_SPEAKER_VALUE } from "../../../shared/narration/speaker";
import { getSpeakerOptions } from "../../utils/viewer";
import type { SpeakerMapping } from "../../../shared/types/tts";
import { useNarrationPreview } from "./useNarrationPreview";

interface SectionPreviewButtonsProps {
  id: string;
  slideIndex: number;
  sectionIndex: number;
  slideNotes: string;
  section: NarrationSection;
  mappings: Record<string, SpeakerMapping>;
  onFocus: () => void;
  getTextarea?: () => HTMLTextAreaElement | null;
}

function formatTime(time: number) {
  const minutes = Math.floor(time / 60);
  const seconds = Math.floor(time % 60);
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

export function SectionPreviewButtons({
  id,
  slideIndex,
  sectionIndex,
  slideNotes,
  section,
  mappings,
  onFocus,
  getTextarea,
}: SectionPreviewButtonsProps) {
  const preview = useNarrationPreview({
    id,
    slideIndex,
    sectionIndex,
    slideNotes,
    section,
    onFocus,
    getTextarea,
  });
  const effectiveSpeaker = preview.effectiveSpeaker;
  const speakers = getSpeakerOptions(mappings);

  const isAnyPreviewActive = preview.isPlaying && preview.activeTarget !== null;

  return (
    <Stack p="xs" gap="xs">
      <Group gap="xs">
        {speakers.map((speaker) => {
          const isSelected = speaker.value === effectiveSpeaker;
          const isActive = preview.activeTarget === speaker.value;
          const isAnyPlaying = preview.activeTarget !== null;

          return (
            <Button
              key={speaker.value}
              size="compact-sm"
              variant={isActive || (isSelected && !isAnyPlaying) ? "filled" : "outline"}
              color="blue"
              title={
                speaker.value === preview.lastPlayedSpeaker ? "Previously previewed" : undefined
              }
              onMouseDown={(event) => event.preventDefault()}
              onClick={() =>
                void preview.play(
                  speaker.value === DEFAULT_SPEAKER_VALUE
                    ? { kind: "default" }
                    : { kind: "override", speaker: speaker.value },
                )
              }
              disabled={!section.text || (preview.isGenerating && !isActive)}
              leftSection={
                isActive ? (
                  <IconPlayerStop size={12} />
                ) : speaker.value === preview.lastPlayedSpeaker ? (
                  <IconHistory size={12} />
                ) : (
                  <IconPlayerPlay size={12} />
                )
              }
            >
              {speaker.label}
            </Button>
          );
        })}
      </Group>

      <Group gap="xs">
        <ActionIcon
          aria-label={preview.activeTarget === null ? "Preview effective speaker" : "Stop preview"}
          title={`Effective speaker: ${effectiveSpeaker || "Default"}`}
          color="blue"
          size="sm"
          radius="xl"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            if (preview.activeTarget !== null) {
              preview.stop();
              return;
            }

            void preview.play({ kind: "effective" });
          }}
          disabled={!section.text}
        >
          {isAnyPreviewActive ? <IconPlayerStop size={12} /> : <IconPlayerPlay size={12} />}
        </ActionIcon>
        <Box style={{ flex: 1, position: "relative" }}>
          {preview.isGenerating ? (
            <Center>
              <Loader size="xs" variant="dots" color="blue" />
            </Center>
          ) : (
            <Group gap="xs">
              <Slider
                style={{ flexGrow: 1 }}
                size="sm"
                value={preview.currentTime}
                min={0}
                max={preview.duration || 100}
                onChange={(value) => {
                  preview.setSeeking(true);
                  preview.seek(value);
                }}
                onChangeEnd={() => {
                  preview.setSeeking(false);
                }}
                label={formatTime}
                disabled={!preview.isCurrentAudio}
              />
              <Text size="xs" c="dimmed">
                {formatTime(preview.currentTime)} / {formatTime(preview.duration)}
              </Text>
            </Group>
          )}
        </Box>
      </Group>
    </Stack>
  );
}
