import { ActionIcon, Box, Button, Center, Group, Loader, Slider, Stack, Text } from "@mantine/core";
import { IconHistory, IconPlayerPlay, IconPlayerStop } from "@tabler/icons-react";
import { useEffect, useRef, useState } from "react";
import type { NoteSection } from "../../types/notes";
import { getErrorMessage } from "../../utils/errors";
import { getSpeakerOptions } from "../../utils/viewer";
import { getPreviewAudioBuffer } from "../../utils/tts";
import type { Voice } from "../../../shared/types/tts";
import { useAudio } from "../../context/useAudio";

interface SectionPreviewButtonsProps {
  id: string;
  slideIndex: number;
  sectionIndex: number;
  slideNotes: string;
  section: NoteSection;
  effectiveSpeaker: string;
  mappings: Record<string, Voice>;
  onFocus: () => void;
  getTextarea?: () => HTMLTextAreaElement | null;
}

export function SectionPreviewButtons({
  id,
  slideIndex,
  sectionIndex,
  slideNotes,
  section,
  effectiveSpeaker,
  mappings,
  onFocus,
  getTextarea,
}: SectionPreviewButtonsProps) {
  const {
    activeId,
    isPlaying: globalIsPlaying,
    currentTime: globalCurrentTime,
    duration: globalDuration,
    play: audioPlay,
    stop: audioStop,
    seek: audioSeek,
    setSeeking: audioSetSeeking,
  } = useAudio();

  const [activePreviewTarget, setActivePreviewTarget] = useState<string | null>(null);
  const [lastPlayedSpeaker, setLastPlayedSpeaker] = useState<string | null>(null);
  const [isAudioGenerating, setIsAudioGenerating] = useState(false);
  const previewRequestIdRef = useRef(0);
  const ownsPreviewRef = useRef(false);

  const isCurrentActive = activeId === id;
  const isPlaying = globalIsPlaying && isCurrentActive;
  const currentTime = isCurrentActive ? globalCurrentTime : 0;
  const duration = isCurrentActive ? globalDuration : 0;
  const speakers = getSpeakerOptions(mappings);

  useEffect(() => {
    // Only clear if the global audio element stopped or switched to a different section entirely
    if (!globalIsPlaying && activeId === null && !isAudioGenerating) {
      ownsPreviewRef.current = false;
      setActivePreviewTarget(null);
    }
    if (activeId !== null && !isCurrentActive) {
      ownsPreviewRef.current = false;
      setActivePreviewTarget(null);
    }
  }, [globalIsPlaying, activeId, isCurrentActive, isAudioGenerating]);

  useEffect(
    () => () => {
      if (!ownsPreviewRef.current) {
        return;
      }

      previewRequestIdRef.current += 1;
      ownsPreviewRef.current = false;
      audioStop();
    },
    [audioStop],
  );

  const stopPlayback = () => {
    previewRequestIdRef.current += 1;
    ownsPreviewRef.current = false;
    audioStop();
    setActivePreviewTarget(null);
    setIsAudioGenerating(false);
  };

  const handlePlay = async (speakerValue: string, previewSpeaker?: string) => {
    if (activePreviewTarget === speakerValue) {
      stopPlayback();
      return;
    }

    let textToPlay = section.text;
    if (getTextarea) {
      const textarea = getTextarea();
      if (textarea) {
        textToPlay =
          textarea.selectionStart !== textarea.selectionEnd
            ? textarea.value.substring(textarea.selectionStart, textarea.selectionEnd)
            : textarea.value;
      }
    }

    if (!textToPlay) {
      alert("No text to preview.");
      return;
    }

    onFocus();
    const requestId = previewRequestIdRef.current + 1;
    previewRequestIdRef.current = requestId;
    ownsPreviewRef.current = true;

    try {
      setIsAudioGenerating(true);
      setActivePreviewTarget(speakerValue);
      setLastPlayedSpeaker(speakerValue);
      const buffer = await getPreviewAudioBuffer({
        slideIndex,
        sectionIndex,
        notes: slideNotes,
        text: textToPlay,
        ...(previewSpeaker !== undefined ? { previewSpeaker } : {}),
      });

      if (previewRequestIdRef.current !== requestId) {
        return;
      }

      if (!buffer) {
        ownsPreviewRef.current = false;
        alert("No text to preview.");
        setActivePreviewTarget(null);
        return;
      }

      const url = URL.createObjectURL(new Blob([buffer], { type: "audio/mpeg" }));
      audioPlay(id, url);
    } catch (error: unknown) {
      if (previewRequestIdRef.current !== requestId) {
        return;
      }

      alert(`Failed to play audio: ${getErrorMessage(error)}`);
      ownsPreviewRef.current = false;
      setActivePreviewTarget(null);
    } finally {
      if (previewRequestIdRef.current === requestId) {
        setIsAudioGenerating(false);
      }
    }
  };

  const formatTime = (time: number) => {
    const minutes = Math.floor(time / 60);
    const seconds = Math.floor(time % 60);
    return `${minutes}:${seconds.toString().padStart(2, "0")}`;
  };

  const isAnyPreviewActive = isPlaying && activePreviewTarget !== null;

  return (
    <Stack p="xs" gap="xs">
      <Group gap="xs">
        {speakers.map((speaker) => {
          const isSelected = speaker.value === effectiveSpeaker;
          const isActive = activePreviewTarget === speaker.value;
          const isAnyPlaying = activePreviewTarget !== null;

          return (
            <Button
              key={speaker.value}
              size="compact-sm"
              variant={isActive || (isSelected && !isAnyPlaying) ? "filled" : "outline"}
              color="blue"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => handlePlay(speaker.value, speaker.value)}
              disabled={!section.text || (isAudioGenerating && !isActive)}
              leftSection={
                isActive ? (
                  <IconPlayerStop size={12} />
                ) : speaker.value === lastPlayedSpeaker ? (
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
          color="blue"
          size="sm"
          radius="xl"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            if (activePreviewTarget !== null) {
              stopPlayback();
              return;
            }

            handlePlay(section.speaker);
          }}
          disabled={!section.text}
        >
          {isAnyPreviewActive ? <IconPlayerStop size={12} /> : <IconPlayerPlay size={12} />}
        </ActionIcon>
        <Box style={{ flex: 1, position: "relative" }}>
          {isAudioGenerating ? (
            <Center>
              <Loader size="xs" variant="dots" color="blue" />
            </Center>
          ) : (
            <Group gap="xs">
              <Slider
                style={{ flexGrow: 1 }}
                size="sm"
                value={currentTime}
                min={0}
                max={duration || 100}
                onChange={(value) => {
                  audioSetSeeking(true);
                  audioSeek(value);
                }}
                onChangeEnd={() => {
                  audioSetSeeking(false);
                }}
                label={formatTime}
                disabled={!isCurrentActive}
              />
              <Text size="xs" c="dimmed">
                {formatTime(currentTime)} / {formatTime(duration)}
              </Text>
            </Group>
          )}
        </Box>
      </Group>
    </Stack>
  );
}
