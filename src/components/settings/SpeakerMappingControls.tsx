import { Stack } from "@mantine/core";
import type { SpeakerMapping, VoiceOption } from "../../../shared/types/tts";
import { SpeakerPrompt } from "../SpeakerPrompt";
import { VoiceSelector } from "./VoiceSelector";

type SpeakerMappingControlsProps = {
  speakerLabel: string;
  mapping: SpeakerMapping | undefined;
  voiceOptions: VoiceOption[] | null;
  voiceCatalogueVersion: number;
  onChange: (change: Partial<SpeakerMapping>) => void;
  onVoiceIncompleteChange: (incomplete: boolean) => void;
};

export function SpeakerMappingControls({
  speakerLabel,
  mapping,
  voiceOptions,
  voiceCatalogueVersion,
  onChange,
  onVoiceIncompleteChange,
}: SpeakerMappingControlsProps) {
  return (
    <Stack>
      <VoiceSelector
        speakerLabel={speakerLabel}
        value={mapping?.voice}
        onChange={(voice) => onChange({ voice })}
        onIncompleteChange={onVoiceIncompleteChange}
        options={voiceOptions}
        catalogueVersion={voiceCatalogueVersion}
      />
      <SpeakerPrompt
        speakerLabel={speakerLabel}
        value={mapping?.prompt}
        supportsPrompt={mapping?.voice?.supportsPrompt}
        onChange={(prompt) => onChange({ prompt })}
      />
    </Stack>
  );
}
