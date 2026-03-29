import { ActionIcon, Box, Button, Group, Loader, Slider, Text } from '@mantine/core';
import { IconPlayerPause, IconPlayerPlay } from '@tabler/icons-react';
import { useRef, useState } from 'react';
import { DEFAULT_SPEAKER_KEY, DEFAULT_SPEAKER_LABEL, DEFAULT_SPEAKER_VALUE } from '../../constants/speakers';
import type { NoteSection } from '../../utils/notes';
import { getErrorMessage } from '../../utils/errors';
import { generateAudio } from '../../utils/tts';
import type { Voice } from '../../types/voice';

interface SectionPreviewButtonsProps {
    section: NoteSection;
    mappings: Record<string, Voice>;
    onFocus: () => void;
    getTextarea?: () => HTMLTextAreaElement | null;
}

export function SectionPreviewButtons({ section, mappings, onFocus, getTextarea }: SectionPreviewButtonsProps) {
    const [audioUrl, setAudioUrl] = useState<string | null>(null);
    const [activePreviewTarget, setActivePreviewTarget] = useState<string | null>(null);
    const [currentTime, setCurrentTime] = useState(0);
    const [duration, setDuration] = useState(0);
    const isSeekingRef = useRef(false);
    const audioRef = useRef<HTMLAudioElement | null>(null);
    const [isAudioGenerating, setIsAudioGenerating] = useState(false);
    const shouldAutoplayRef = useRef(false);

    const speakers = [{ value: DEFAULT_SPEAKER_VALUE, label: DEFAULT_SPEAKER_LABEL }].concat(
        Object.keys(mappings).filter((key) => key !== DEFAULT_SPEAKER_KEY).map((key) => ({ value: key, label: key }))
    );

    const handlePlay = async (speakerValue: string) => {
        if (activePreviewTarget === speakerValue) {
            if (audioRef.current) {
                audioRef.current.pause();
                audioRef.current.currentTime = 0;
            }
            shouldAutoplayRef.current = false;
            setActivePreviewTarget(null);
            return;
        }

        let textToPlay = section.text;
        if (getTextarea) {
            const textarea = getTextarea();
            if (textarea && textarea.selectionStart !== textarea.selectionEnd) {
                textToPlay = textarea.value.substring(textarea.selectionStart, textarea.selectionEnd);
            }
        }

        if (!textToPlay) {
            alert('No text to preview.');
            return;
        }

        onFocus();
        try {
            setIsAudioGenerating(true);
            setActivePreviewTarget(speakerValue);
            shouldAutoplayRef.current = true;
            const voiceOverride = speakerValue ? mappings[speakerValue] : undefined;
            const url = await generateAudio(textToPlay, voiceOverride);
            setCurrentTime(0);
            setDuration(0);
            setAudioUrl(url);
        } catch (error: unknown) {
            alert(`Failed to play audio: ${getErrorMessage(error)}`);
            shouldAutoplayRef.current = false;
            setActivePreviewTarget(null);
        } finally {
            setIsAudioGenerating(false);
        }
    };

    const formatTime = (time: number) => {
        const minutes = Math.floor(time / 60);
        const seconds = Math.floor(time % 60);
        return `${minutes}:${seconds.toString().padStart(2, '0')}`;
    };

    return (
        <Box px="xs" py="xs" style={{ borderBottom: '1px solid var(--mantine-color-dark-4)' }}>
            <audio
                ref={audioRef}
                src={audioUrl || ''}
                onCanPlay={() => {
                    if (!shouldAutoplayRef.current || !audioRef.current) {
                        return;
                    }

                    shouldAutoplayRef.current = false;
                    audioRef.current.currentTime = 0;
                    audioRef.current.play().catch((error) => {
                        console.error(error);
                        setActivePreviewTarget(null);
                    });
                }}
                onTimeUpdate={() => {
                    if (audioRef.current && !isSeekingRef.current) {
                        setCurrentTime(audioRef.current.currentTime);
                    }
                }}
                onLoadedMetadata={() => {
                    if (audioRef.current) {
                        setDuration(audioRef.current.duration);
                    }
                }}
                onEnded={() => setActivePreviewTarget(null)}
            />

            <Group gap="xs" mb="xs">
                {speakers.map((speaker) => {
                    const isActive = activePreviewTarget === speaker.value;
                    const isGenerating = isAudioGenerating && isActive;
                    return (
                        <Button
                            key={speaker.value}
                            size="compact-sm"
                            variant="outline"
                            color="blue"
                            onMouseDown={(event) => event.preventDefault()}
                            onClick={() => handlePlay(speaker.value)}
                            loading={isGenerating}
                            disabled={isAudioGenerating && !isGenerating}
                            leftSection={isActive ? <IconPlayerPause size={12} /> : <IconPlayerPlay size={12} />}
                        >
                            {speaker.label}
                        </Button>
                    );
                })}
            </Group>

            <Group gap="xs">
                <ActionIcon
                    variant="filled"
                    color={activePreviewTarget === section.speaker ? 'red' : 'blue'}
                    size="sm"
                    radius="xl"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => handlePlay(DEFAULT_SPEAKER_VALUE)}
                    disabled={!section.text || (isAudioGenerating && activePreviewTarget !== section.speaker)}
                >
                    {activePreviewTarget === section.speaker && !isAudioGenerating ? <IconPlayerPause size={12} /> : <IconPlayerPlay size={12} />}
                </ActionIcon>
                <Box style={{ flex: 1, position: 'relative' }}>
                    {isAudioGenerating && activePreviewTarget === section.speaker ? (
                        <div style={{ height: '20px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <Loader size="xs" variant="dots" color="blue" />
                        </div>
                    ) : (
                        <Group gap="xs" wrap="nowrap">
                            <Slider
                                style={{ flex: 1 }}
                                size="sm"
                                value={currentTime}
                                min={0}
                                max={duration || 100}
                                onChange={(value) => {
                                    isSeekingRef.current = true;
                                    setCurrentTime(value);
                                }}
                                onChangeEnd={(value) => {
                                    isSeekingRef.current = false;
                                    if (audioRef.current) {
                                        audioRef.current.currentTime = value;
                                    }
                                }}
                                label={formatTime}
                                disabled={!audioUrl}
                            />
                            <Text size="10px" c="dimmed" style={{ whiteSpace: 'nowrap' }}>
                                {formatTime(currentTime)} / {formatTime(duration)}
                            </Text>
                        </Group>
                    )}
                </Box>
            </Group>
        </Box>
    );
}
