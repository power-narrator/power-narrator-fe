import { ActionIcon, Button, Group, Text, Title } from '@mantine/core';
import { IconRefresh, IconSettings } from '@tabler/icons-react';

interface ViewerHeaderProps {
    onBack: () => void;
    onOpenSettings: () => void;
    onSyncAll: () => void;
    onInsertAllAudio: () => void;
    onSaveAllNotes: () => void;
    onRemoveAllAudio: () => void;
    onGenerateVideo: () => void;
    isSyncing: boolean;
    isSaving: boolean;
    isInsertingAudio: boolean;
    isRemoving: boolean;
    isGenerating: boolean;
    busy: boolean;
    saveStatus: string;
    insertStatus: string;
    removeStatus: string;
    genStatus: string;
}

export function ViewerHeader({
    onBack,
    onOpenSettings,
    onSyncAll,
    onInsertAllAudio,
    onSaveAllNotes,
    onRemoveAllAudio,
    onGenerateVideo,
    isSyncing,
    isSaving,
    isInsertingAudio,
    isRemoving,
    isGenerating,
    busy,
    saveStatus,
    insertStatus,
    removeStatus,
    genStatus,
}: ViewerHeaderProps) {
    return (
        <Group justify="space-between" p="xs" style={{ borderBottom: '1px solid var(--mantine-color-dark-4)', background: 'var(--mantine-color-dark-7)' }}>
            <Group>
                <Button variant="subtle" size="xs" onClick={onBack}>&larr; Back</Button>
                <Title order={5}>Viewer</Title>
                <ActionIcon variant="subtle" size="sm" onClick={onOpenSettings}>
                    <IconSettings size={16} />
                </ActionIcon>
            </Group>

            <Group>
                {(isSyncing || isSaving || isInsertingAudio || isRemoving || isGenerating) && (
                    <Group gap="xs" mr="xs">
                        {isSyncing && <Text size="xs" c="dimmed">Syncing...</Text>}
                        {isSaving && <Text size="xs" c="dimmed">{saveStatus}</Text>}
                        {isInsertingAudio && <Text size="xs" c="dimmed">{insertStatus}</Text>}
                        {isRemoving && <Text size="xs" c="dimmed">{removeStatus}</Text>}
                        {isGenerating && <Text size="xs" c="dimmed">{genStatus}</Text>}
                    </Group>
                )}

                <Button
                    variant="default"
                    size="xs"
                    leftSection={<IconRefresh size={14} className={isSyncing ? 'mantine-rotate' : ''} />}
                    onClick={onSyncAll}
                    loading={isSyncing}
                    disabled={busy}
                >
                    Sync All Slides
                </Button>

                <Button
                    variant="filled"
                    color="blue"
                    size="xs"
                    onClick={onInsertAllAudio}
                    loading={isInsertingAudio}
                    disabled={busy}
                >
                    Insert All Audio
                </Button>

                <Button
                    variant="default"
                    size="xs"
                    onClick={onSaveAllNotes}
                    loading={isSaving}
                    disabled={busy}
                >
                    Save All Slide Notes
                </Button>

                <Button
                    variant="default"
                    size="xs"
                    onClick={onRemoveAllAudio}
                    loading={isRemoving}
                    disabled={busy}
                >
                    Remove All Audio
                </Button>

                <Button
                    size="xs"
                    variant="light"
                    color="blue"
                    onClick={onGenerateVideo}
                    loading={isGenerating}
                    disabled={busy}
                >
                    {isGenerating ? 'Generating...' : 'Generate Video'}
                </Button>
            </Group>
        </Group>
    );
}
