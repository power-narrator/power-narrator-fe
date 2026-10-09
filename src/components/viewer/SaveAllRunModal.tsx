import { Button, Group, Modal, Progress, Stack, Text } from "@mantine/core";
import type { SaveAllRunPhase } from "../../../shared/types/narration";
import type { SaveAllRunState } from "./useSaveAllRun";

type SaveAllRunModalProps = {
  state: SaveAllRunState;
  onConfirm: () => void;
  onDecline: () => void;
};

const PHASE_LABEL: Record<SaveAllRunPhase, string> = {
  generating: "Generating narration...",
  saving: "Saving to PowerPoint...",
};

const ignoreDismissal = () => {};

export function SaveAllRunModal({ state, onConfirm, onDecline }: SaveAllRunModalProps) {
  const progress = state.stage === "running" ? state.progress : null;

  return (
    <>
      <Modal
        opened={state.stage === "confirming"}
        onClose={onDecline}
        title="Save all slides?"
        centered
      >
        <Stack>
          <Text>
            Narration will be generated and saved for every slide, one slide at a time. This may
            take some time.
          </Text>
          <Group justify="flex-end">
            <Button variant="default" onClick={onDecline}>
              Cancel
            </Button>
            <Button onClick={onConfirm}>Save All</Button>
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
            {progress && <Text c="dimmed">{PHASE_LABEL[progress.phase]}</Text>}
          </Group>
          <Progress
            aria-label="Save all progress"
            value={progress ? (progress.completedSlides / progress.totalSlides) * 100 : 0}
          />
        </Stack>
      </Modal>
    </>
  );
}
