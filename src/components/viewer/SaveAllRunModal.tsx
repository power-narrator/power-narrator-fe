import { Button, Group, Modal, Progress, Stack, Text } from "@mantine/core";
import type { SaveAllRunPhase } from "../../../shared/types/narration";
import type { SaveAllRunPurpose, SaveAllRunState } from "./useSaveAllRun";

type SaveAllRunModalProps = {
  state: SaveAllRunState;
  onConfirm: () => void;
  onDecline: () => void;
  onCancel: () => void;
};

const PHASE_LABEL: Record<SaveAllRunPhase, string> = {
  generating: "Generating narration...",
  saving: "Saving to PowerPoint...",
};

const CONFIRMATION: Record<
  SaveAllRunPurpose,
  { title: string; message: string; confirmLabel: string }
> = {
  saveAll: {
    title: "Save all slides?",
    message:
      "Narration will be generated and saved for every slide, one slide at a time. This may take some time.",
    confirmLabel: "Save All",
  },
  generateVideo: {
    title: "Generate video?",
    message:
      "Before the video is rendered, narration will be generated and saved for every slide, one slide at a time. Generating and saving narration may take some time.",
    confirmLabel: "Save and Generate",
  },
};

const ignoreDismissal = () => {};

export function SaveAllRunModal({ state, onConfirm, onDecline, onCancel }: SaveAllRunModalProps) {
  const progress = state.stage === "running" ? state.progress : null;
  const cancelling = state.stage === "running" && state.cancelling;
  const phaseLabel = cancelling ? "Cancelling..." : progress && PHASE_LABEL[progress.phase];
  const confirmation = state.stage === "confirming" ? CONFIRMATION[state.purpose] : undefined;

  return (
    <>
      <Modal
        opened={confirmation !== undefined}
        onClose={onDecline}
        title={confirmation?.title}
        centered
      >
        <Stack>
          <Text>{confirmation?.message}</Text>
          <Group justify="flex-end">
            <Button variant="default" onClick={onDecline}>
              Cancel
            </Button>
            <Button onClick={onConfirm}>{confirmation?.confirmLabel}</Button>
          </Group>
        </Stack>
      </Modal>

      <Modal
        opened={state.stage === "running"}
        onClose={ignoreDismissal}
        title="Saving all slides"
        centered
        closeOnEscape={false}
        closeOnClickOutside={false}
        withCloseButton={false}
      >
        <Stack>
          <Group justify="space-between">
            <Text fw={500}>
              {progress
                ? `Slide ${progress.completedSlides + 1} of ${progress.totalSlides}`
                : "Checking narration..."}
            </Text>
            {phaseLabel && <Text c="dimmed">{phaseLabel}</Text>}
          </Group>
          <Progress
            aria-label="Save all progress"
            value={progress ? (progress.completedSlides / progress.totalSlides) * 100 : 0}
          />
          <Group justify="flex-end">
            <Button variant="default" onClick={onCancel} disabled={cancelling}>
              Cancel
            </Button>
          </Group>
        </Stack>
      </Modal>
    </>
  );
}
