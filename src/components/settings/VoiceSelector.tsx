import { Select, Stack } from "@mantine/core";
import { useState } from "react";
import type { Voice, VoiceModel, VoiceOption } from "../../../shared/types/tts";

interface VoiceSelectorProps {
  /** Names the selects apart, since a row's label is the only thing that does. */
  speakerLabel: string;
  value: Voice | undefined;
  onChange: (voice: Voice | undefined) => void;
  options: VoiceOption[];
}

/** A voice is chosen by name and gender alone; its model is the next choice. */
function getOptionKey(option: VoiceOption): string {
  return JSON.stringify([option.provider, option.name, option.ssmlGender]);
}

function findOption(options: VoiceOption[], voice: Voice): VoiceOption | undefined {
  return options.find(
    (option) =>
      option.provider === voice.provider &&
      option.name === voice.voiceId &&
      option.models.some((model) => model.id === voice.model),
  );
}

/**
 * The language stays at the provider's first advertised value until the
 * language select arrives; a model advertising none offers no voice at all.
 */
function toVoice(option: VoiceOption, model: VoiceModel): Voice | null {
  const language = model.languages[0];
  if (!language) {
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

export function VoiceSelector({ speakerLabel, value, onChange, options }: VoiceSelectorProps) {
  const [draft, setDraft] = useState<{ key: string; model: string | null } | null>(null);

  const committedOption = value ? findOption(options, value) : undefined;
  const selectedOption = draft
    ? options.find((option) => getOptionKey(option) === draft.key)
    : committedOption;
  const selectedKey = selectedOption ? getOptionKey(selectedOption) : null;
  const selectedModelId = draft ? draft.model : (value?.model ?? null);

  const select = (option: VoiceOption, modelId: string | null) => {
    setDraft({ key: getOptionKey(option), model: modelId });

    const model = option.models.find((candidate) => candidate.id === modelId);
    onChange(model ? (toVoice(option, model) ?? undefined) : undefined);
  };

  const handleVoiceChange = (optionKey: string | null) => {
    const option = options.find((candidate) => getOptionKey(candidate) === optionKey);
    if (!option) {
      return;
    }

    // A sole model is chosen for the author; several start unmade, so a billed
    // model is never reached without having been picked.
    select(option, option.models.length === 1 ? option.models[0]!.id : null);
  };

  const handleModelChange = (modelId: string | null) => {
    if (selectedOption && modelId) {
      select(selectedOption, modelId);
    }
  };

  return (
    <Stack gap={4}>
      <Select
        aria-label={`Voice for ${speakerLabel}`}
        placeholder="Select Voice"
        data={options.map((option) => ({
          value: getOptionKey(option),
          label: `${option.name} (${option.ssmlGender})`,
        }))}
        value={selectedKey}
        onChange={handleVoiceChange}
        searchable
        size="xs"
        w={220}
      />
      <Select
        aria-label={`Model for ${speakerLabel}`}
        placeholder="Select Model"
        data={(selectedOption?.models ?? []).map((model) => ({
          value: model.id,
          label: model.label,
        }))}
        value={selectedModelId}
        onChange={handleModelChange}
        disabled={!selectedOption}
        size="xs"
        w={220}
      />
    </Stack>
  );
}
