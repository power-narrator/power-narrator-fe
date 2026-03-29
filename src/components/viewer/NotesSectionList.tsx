import { Box, Button, Group, ScrollArea, Select, Text, Textarea } from '@mantine/core';
import { IconPlus } from '@tabler/icons-react';
import type { NoteSection } from '../../utils/notes';
import { getSpeakerOptions } from '../../utils/viewer';
import type { Voice } from '../../types/voice';
import { SectionPreviewButtons } from './SectionPreviewButtons';

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
        <>
            <Text size="sm" fw={500} mb={4}>Presenter Notes</Text>
            <ScrollArea style={{ flex: 1 }} type="auto" styles={{ viewport: { '& > div': { display: 'flex', flexDirection: 'column', height: '100%' } } }}>
                <Box style={{ display: 'flex', flexDirection: 'column', gap: '8px', paddingRight: '12px' }}>
                    {sections.map((section, index) => (
                        <Box key={index} style={{ border: '1px solid var(--mantine-color-dark-4)', borderRadius: 4, display: 'flex', flexDirection: 'column', minHeight: 150, flexShrink: 0 }}>
                            <Group justify="space-between" px="xs" py={4} style={{ borderBottom: '1px solid var(--mantine-color-dark-4)', background: 'var(--mantine-color-dark-6)' }}>
                                <Select
                                    data={speakerOptions}
                                    value={section.speaker}
                                    onChange={(value) => onSpeakerChange(index, value)}
                                    size="xs"
                                    w={150}
                                    placeholder="Speaker"
                                />
                                {sections.length > 1 && (
                                    <Button variant="subtle" color="red" size="compact-xs" onClick={() => onDeleteSection(index)}>
                                        Remove Section
                                    </Button>
                                )}
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
                                styles={{
                                    input: { resize: 'vertical', fontFamily: 'monospace', border: 'none', minHeight: '110px' },
                                }}
                            />
                        </Box>
                    ))}
                    <Button variant="light" size="sm" fullWidth leftSection={<IconPlus size={16} />} onClick={onAddSection} style={{ flexShrink: 0, marginBottom: '20px' }}>
                        Add Section
                    </Button>
                </Box>
            </ScrollArea>
        </>
    );
}
