import { Select } from "@mantine/core";
import type { Voice, VoiceOption } from "../../../shared/types/tts";
import { getProviderLabel } from "./providerLabels";

interface VoiceSelectorProps {
  value: Voice | undefined;
  onChange: (voice: Voice) => void;
  options: VoiceOption[];
}

/** Identity is the whole stored choice, so a saved voice matches its option. */
function getVoiceKey(voice: Voice): string {
  return JSON.stringify([voice.provider, voice.voiceId, voice.model, voice.languageCode]);
}

/**
 * Until the picker gains model and language selects, an option offering a
 * choice at either level has no way to make it, so it is withheld rather than
 * resolved to an arbitrary one.
 */
function toVoice(option: VoiceOption): Voice | null {
  const model = option.models.length === 1 ? option.models[0] : undefined;
  const language = model?.languages.length === 1 ? model.languages[0] : undefined;

  if (!model || !language) {
    return null;
  }

  return {
    provider: option.provider,
    voiceId: option.name,
    model: model.id,
    languageCode: language.code,
    supportsPrompt: model.supportsPrompt,
  };
}

export function VoiceSelector({ value, onChange, options }: VoiceSelectorProps) {
  const selectable = options.flatMap((option) => {
    const voice = toVoice(option);
    return voice ? [{ option, voice }] : [];
  });

  const handleChange = (selectedValue: string | null) => {
    const selected = selectable.find(({ voice }) => getVoiceKey(voice) === selectedValue);
    if (selected) {
      onChange(selected.voice);
    }
  };

  return (
    <Select
      placeholder="Select Voice"
      data={selectable.map(({ option, voice }) => ({
        value: getVoiceKey(voice),
        label: `${option.name} (${getProviderLabel(option.provider)}, ${option.ssmlGender}, ${voice.languageCode})`,
      }))}
      value={value ? getVoiceKey(value) : null}
      onChange={handleChange}
      searchable
      size="xs"
      w={250}
    />
  );
}
