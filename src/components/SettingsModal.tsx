import { Modal, Button, Text, Group, Stack, Code, Divider, TextInput, ActionIcon, Box, Switch } from '@mantine/core';
import { useState, useEffect } from 'react';
import { VoiceSelector } from './VoiceSelector';
import { IconTrash } from '@tabler/icons-react';
import { useSettings } from '../context/useSettings';
import { DEFAULT_SPEAKER_KEY } from '../constants/speakers';
import type { Voice } from '../types/voice';

interface SettingsModalProps {
    opened: boolean;
    onClose: () => void;
}

export function SettingsModal({ opened, onClose }: SettingsModalProps) {
    const [keyPath, setKeyPath] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [newAlias, setNewAlias] = useState('');
    const [voices, setVoices] = useState<Voice[]>([]);
    const [providerMode, setProviderMode] = useState<'gcp' | 'local'>('local');
    const { mappings, xmlCliEnabled, refreshSettings, saveMappings, setXmlCliEnabled } = useSettings();

    async function checkKey() {
        const path = await window.electronAPI.getGcpKeyPath();
        setKeyPath(path || null);
    }

    async function loadVoices() {
        const loadedVoices = await window.electronAPI.getVoices();
        setVoices(loadedVoices || []);
    }

    async function loadProviderMode() {
        const provider = await window.electronAPI.getTtsProvider();
        setProviderMode(provider || 'local');
    }

    useEffect(() => {
        async function loadOpenedSettings() {
            await Promise.all([checkKey(), refreshSettings(), loadVoices(), loadProviderMode()]);
        }

        if (opened) {
            loadOpenedSettings().catch((error) => {
                console.error(error);
            });
        }
    }, [opened, refreshSettings]);

    const handleXmlCliToggle = async (checked: boolean) => {
        await setXmlCliEnabled(checked);
    };

    const handleSetKey = async () => {
        setError(null);
        try {
            const result = await window.electronAPI.setGcpKey();
            if (result.success && result.path) {
                setKeyPath(result.path);
            } else if (result.error) {
                setError(result.error);
            }
        } catch (err) {
            console.error(err);
            setError("Failed to set key");
        }
    };

    const updateMapping = (alias: string, voice: Voice) => {
        saveMappings({ ...mappings, [alias]: voice });
    };

    const removeMapping = (alias: string) => {
        const newM = { ...mappings };
        delete newM[alias];
        saveMappings(newM);
    };

    const addAlias = () => {
        if (newAlias.trim() && !mappings[newAlias.trim()]) {
            saveMappings({ ...mappings, [newAlias.trim()]: { name: '', languageCodes: [], ssmlGender: '', provider: '' } });
            setNewAlias('');
        }
    };

    return (
        <Modal opened={opened} onClose={onClose} title="Settings" centered size="lg">
            <Stack>
                <Text fw={500}>Google Cloud TTS Configuration</Text>
                <Text size="sm" c="dimmed">
                    To use high-quality voices (Chirp 3 HD), you must provide a valid Google Cloud Service Account JSON key.
                </Text>

                <Group justify="space-between" align="center" p="xs" style={{ border: '1px solid var(--mantine-color-gray-8)', borderRadius: 4 }}>
                    <Text size="sm" fw={700}>Current Key:</Text>
                    {keyPath ? (
                        <Code color="green" style={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {keyPath}
                        </Code>
                    ) : (
                        <Text size="sm" c="red">Not Configured</Text>
                    )}
                </Group>

                <Group justify="flex-end">
                    <Button onClick={handleSetKey} variant="light" size="xs">
                        Select Key File...
                    </Button>
                </Group>

                <Divider my="sm" />

                <Group justify="space-between" align="center">
                    <Box>
                        <Text fw={500}>Speaker Voices Mapping</Text>
                        <Text size="sm" c="dimmed">
                            Assign voices to specific speaker aliases. Use tags like <code>[speaker 1]</code> in your notes.
                        </Text>
                    </Box>
                    <Text size="sm" fw={600} c="dimmed">
                        {providerMode === 'gcp' ? 'Google Cloud' : 'Local TTS'}
                    </Text>
                </Group>

                <Stack gap="xs">
                    {/* Default Voice */}
                    <Group justify="space-between" align="center" p="xs" style={{ backgroundColor: 'var(--mantine-color-dark-6)', borderRadius: 4 }}>
                            <Text size="sm" fw={600}>Default Voice (No Tag)</Text>
                        <VoiceSelector
                            value={mappings[DEFAULT_SPEAKER_KEY] || null}
                            onChange={(v) => updateMapping(DEFAULT_SPEAKER_KEY, v)}
                            voices={voices}
                            providerFilter={providerMode}
                        />
                    </Group>

                    {/* Mapped Voices */}
                    {Object.entries(mappings).filter(([key]) => key !== DEFAULT_SPEAKER_KEY).map(([alias, voice]) => (
                        <Group key={alias} justify="space-between" align="center" p="xs" style={{ border: '1px solid var(--mantine-color-dark-4)', borderRadius: 4 }}>
                            <Code>[{alias}]</Code>
                            <Group gap="xs">
                                <VoiceSelector
                                    value={voice}
                                    onChange={(v) => updateMapping(alias, v)}
                                    voices={voices}
                                    providerFilter={providerMode}
                                />
                                <ActionIcon color="red" variant="subtle" onClick={() => removeMapping(alias)}>
                                    <IconTrash size={16} />
                                </ActionIcon>
                            </Group>
                        </Group>
                    ))}

                    <Group mt="xs">
                        <TextInput
                            placeholder="New alias (e.g. speaker 1)"
                            size="xs"
                            value={newAlias}
                            onChange={(e) => setNewAlias(e.currentTarget.value)}
                            onKeyDown={(e) => e.key === 'Enter' && addAlias()}
                            style={{ flex: 1 }}
                        />
                        <Button size="xs" onClick={addAlias} disabled={!newAlias.trim()}>Add Mapping</Button>
                    </Group>
                </Stack>

                {error && <Text c="red" size="sm" mt="sm">{error}</Text>}

                <Divider my="sm" />

                <Group justify="space-between" align="center">
                    <Box>
                        <Text fw={500}>XML CLI Engine (Experimental)</Text>
                        <Text size="sm" c="dimmed">
                            Use the Python XML CLI for PPTX operations instead of AppleScript. Less features are supported but it does not require PowerPoint to be running.
                        </Text>
                    </Box>
                    <Switch 
                        checked={xmlCliEnabled} 
                        onChange={(event) => handleXmlCliToggle(event.currentTarget.checked)} 
                        size="md" 
                    />
                </Group>

                <Group justify="flex-end" mt="md">
                    <Button onClick={onClose}>Close</Button>
                </Group>
            </Stack>
        </Modal>
    );
}
