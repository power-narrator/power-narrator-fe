import { Select } from "@mantine/core";
import type { Voice } from "../../types/voice";

interface VoiceSelectorProps {
  value: Voice | null;
  onChange: (voice: Voice) => void;
  voices: Voice[];
}

export function VoiceSelector({ value, onChange, voices }: VoiceSelectorProps) {
  const options = voices.map((voice) => ({
    value: voice.name,
    label: `${voice.displayName || voice.name.split("/").pop()} (${voice.provider === "gcp" ? "Google" : voice.provider === "elevenlabs" ? "ElevenLabs" : "Local"}, ${voice.ssmlGender})`,
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
