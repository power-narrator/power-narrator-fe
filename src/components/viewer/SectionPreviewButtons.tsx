import { ActionIcon, Box, Button, Group, Loader, Slider, Text } from '@mantine/core';
import { IconPlayerPlay, IconPlayerStop } from '@tabler/icons-react';
import { useRef, useState } from 'react';
import type { NoteSection } from '../../utils/notes';
import { getErrorMessage } from '../../utils/errors';
import { getSpeakerOptions } from '../../utils/viewer';
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
    const previewRequestIdRef = useRef(0);
    const autoplayRequestIdRef = useRef<number | null>(null);

    const speakers = getSpeakerOptions(mappings);

    const stopPlayback = () => {
        previewRequestIdRef.current += 1;
        autoplayRequestIdRef.current = null;
        if (audioRef.current) {
            audioRef.current.pause();
            audioRef.current.currentTime = 0;
        }
        setCurrentTime(0);
        setActivePreviewTarget(null);
        setIsAudioGenerating(false);
    };

    const handlePlay = async (speakerValue: string) => {
        if (activePreviewTarget === speakerValue) {
            stopPlayback();
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
        const requestId = previewRequestIdRef.current + 1;
        previewRequestIdRef.current = requestId;
        autoplayRequestIdRef.current = requestId;

        try {
            setIsAudioGenerating(true);
            setActivePreviewTarget(speakerValue);
            const voiceOverride = speakerValue ? mappings[speakerValue] : undefined;
            const url = await generateAudio(textToPlay, voiceOverride);

            if (previewRequestIdRef.current !== requestId) {
                return;
            }

            setCurrentTime(0);
            setDuration(0);
            setAudioUrl(url);
        } catch (error: unknown) {
            if (previewRequestIdRef.current !== requestId) {
                return;
            }

            alert(`Failed to play audio: ${getErrorMessage(error)}`);
            autoplayRequestIdRef.current = null;
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
        return `${minutes}:${seconds.toString().padStart(2, '0')}`;
    };

    const isAnyPreviewActive = activePreviewTarget !== null;

    return (
        <Box px="xs" py="xs" style={{ borderBottom: '1px solid var(--mantine-color-dark-4)' }}>
            <audio
                ref={audioRef}
                src={audioUrl || ''}
                onCanPlay={() => {
                    if (
                        autoplayRequestIdRef.current !== previewRequestIdRef.current
                        || !audioRef.current
                    ) {
                        return;
                    }

                    autoplayRequestIdRef.current = null;
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
                onEnded={() => {
                    autoplayRequestIdRef.current = null;
                    setActivePreviewTarget(null);
                }}
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
                            disabled={!section.text || isGenerating}
                            leftSection={isActive ? <IconPlayerStop size={12} /> : <IconPlayerPlay size={12} />}
                        >
                            {speaker.label}
                        </Button>
                    );
                })}
            </Group>

            <Group gap="xs">
                <ActionIcon
                    variant="filled"
                    color="blue"
                    size="sm"
                    radius="xl"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => {
                        if (isAnyPreviewActive) {
                            stopPlayback();
                            return;
                        }

                        void handlePlay(section.speaker);
                    }}
                    disabled={!section.text || isAudioGenerating}
                >
                    {isAnyPreviewActive ? <IconPlayerStop size={12} /> : <IconPlayerPlay size={12} />}
                </ActionIcon>
                <Box style={{ flex: 1, position: 'relative' }}>
                    {isAudioGenerating ? (
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
