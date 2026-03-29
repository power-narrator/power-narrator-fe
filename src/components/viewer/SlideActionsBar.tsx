import { Button, Group, Text, Tooltip } from '@mantine/core';
import { IconDeviceTv, IconRefresh } from '@tabler/icons-react';

interface SlideActionsBarProps {
    busy: boolean;
    xmlCliEnabled: boolean;
    isSyncing: boolean;
    isInsertingAudio: boolean;
    isSaving: boolean;
    isRemoving: boolean;
    removeStatus: string;
    onSyncSlide: () => void;
    onInsertSlideAudio: () => void;
    onPlaySlide: () => void;
    onSaveCurrentSlideNotes: () => void;
    onRemoveSlideAudio: () => void;
}

export function SlideActionsBar({
    busy,
    xmlCliEnabled,
    isSyncing,
    isInsertingAudio,
    isSaving,
    isRemoving,
    removeStatus,
    onSyncSlide,
    onInsertSlideAudio,
    onPlaySlide,
    onSaveCurrentSlideNotes,
    onRemoveSlideAudio,
}: SlideActionsBarProps) {
    return (
        <Group gap="md" py="xs" style={{ borderBottom: '1px solid var(--mantine-color-dark-4)' }}>
            <Tooltip
                label="Individual slide sync is disabled in XML mode"
                disabled={!xmlCliEnabled}
            >
                <Button
                    variant="default"
                    size="xs"
                    leftSection={<IconRefresh size={14} className={isSyncing ? 'mantine-rotate' : ''} />}
                    onClick={onSyncSlide}
                    loading={isSyncing}
                    disabled={busy || xmlCliEnabled}
                >
                    Sync Slide
                </Button>
            </Tooltip>

            <Button
                variant="filled"
                color="blue"
                size="xs"
                onClick={onInsertSlideAudio}
                loading={isInsertingAudio}
                disabled={busy}
            >
                Insert Audio
            </Button>

            <Tooltip
                label="Disabled when XML CLI is enabled"
                disabled={!xmlCliEnabled}
            >
                <Button
                    variant="default"
                    size="xs"
                    leftSection={<IconDeviceTv size={14} />}
                    onClick={onPlaySlide}
                    disabled={busy || xmlCliEnabled}
                >
                    Play
                </Button>
            </Tooltip>

            <Button
                variant="default"
                size="xs"
                onClick={onSaveCurrentSlideNotes}
                loading={isSaving}
                disabled={busy}
            >
                Save Slide Notes
            </Button>

            <Button
                variant="default"
                size="xs"
                onClick={onRemoveSlideAudio}
                loading={isRemoving}
                disabled={busy}
            >
                Remove Audio
            </Button>

            {isRemoving && removeStatus && (
                <Text size="xs" c="dimmed" ml="xs">
                    {removeStatus}
                </Text>
            )}
        </Group>
    );
}
