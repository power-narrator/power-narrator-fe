import { Select } from "@mantine/core";
import type { Voice } from "../../../shared/types/tts";
import { getProviderLabel } from "./providerLabels";

interface VoiceSelectorProps {
  value: Voice | null;
  onChange: (voice: Voice) => void;
  voices: Voice[];
}

function getVoiceOptionValue(voice: Voice): string {
  return JSON.stringify([voice.provider, voice.name]);
}

export function VoiceSelector({ value, onChange, voices }: VoiceSelectorProps) {
  const options = voices.map((voice) => ({
    value: getVoiceOptionValue(voice),
    label: `${voice.name.split("/").pop()} (${getProviderLabel(voice.provider)}, ${voice.ssmlGender})`,
  }));

  const handleChange = (selectedValue: string | null) => {
    const voice = voices.find((option) => getVoiceOptionValue(option) === selectedValue);
    if (voice) {
      onChange(voice);
    }
  };

  return (
    <Select
      placeholder="Select Voice"
      data={options}
      value={value ? getVoiceOptionValue(value) : null}
      onChange={handleChange}
      searchable
      size="xs"
      w={250}
    />
  );
}
