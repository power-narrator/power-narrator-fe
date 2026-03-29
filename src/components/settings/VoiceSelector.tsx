import { Select } from "@mantine/core";
import type { Voice } from "../../types/voice";

interface VoiceSelectorProps {
  value: Voice | null;
  onChange: (voice: Voice) => void;
  voices: Voice[];
  providerFilter?: "gcp" | "local";
}

export function VoiceSelector({ value, onChange, voices, providerFilter }: VoiceSelectorProps) {
  const filteredVoices = providerFilter
    ? voices.filter((voice) => voice.provider === providerFilter)
    : voices;

  const options = filteredVoices.map((voice) => ({
    value: voice.name,
    label: `${voice.name.split("/").pop()} (${voice.provider === "gcp" ? "Google" : "Local"}, ${voice.ssmlGender})`,
  }));

  const handleChange = (selectedValue: string | null) => {
    const voice = voices.find((option) => option.name === selectedValue);
    if (voice) {
      onChange(voice);
    }
  };

  return (
    <Select
      placeholder="Select Voice"
      data={options}
      value={value?.name || null}
      onChange={handleChange}
      searchable
      size="xs"
      w={250}
    />
  );
}
