import { Group, Select, Stack } from "@mantine/core";
import { useState } from "react";
import type { Voice, VoiceModel, VoiceOption } from "../../../shared/types/tts";

interface VoiceSelectorProps {
  /** Names the selects apart, since a row's label is the only thing that does. */
  speakerLabel: string;
  value: Voice | undefined;
  onChange: (voice: Voice | undefined) => void;
  options: VoiceOption[];
}

/** An in-progress selection, which is only persisted once every level is made. */
interface Draft {
  key: string;
  model: string | null;
  language: string | null;
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

function findModel(option: VoiceOption, modelId: string | null): VoiceModel | undefined {
  return option.models.find((candidate) => candidate.id === modelId);
}

/**
 * Keeps a language the new model also speaks, and otherwise clears it rather
 * than substituting one — a swapped language is a change an author discovers by
 * listening, which is too late.
 */
function carryLanguage(model: VoiceModel | undefined, language: string | null): string | null {
  if (!model || model.languages.some((candidate) => candidate.code === language)) {
    return model ? language : null;
  }

  // A sole language is chosen for the author; several start unmade.
  return model.languages.length === 1 ? model.languages[0]!.code : null;
}

function toVoice(option: VoiceOption, model: VoiceModel, languageCode: string): Voice {
  return {
    provider: option.provider,
    voiceId: option.name,
    model: model.id,
    languageCode,
    supportsPrompt: model.supportsPrompt,
  };
}

export function VoiceSelector({ speakerLabel, value, onChange, options }: VoiceSelectorProps) {
  const [draft, setDraft] = useState<Draft | null>(null);

  const committedOption = value ? findOption(options, value) : undefined;
  const selectedOption = draft
    ? options.find((option) => getOptionKey(option) === draft.key)
    : committedOption;
  const selectedKey = selectedOption ? getOptionKey(selectedOption) : null;
  const selectedModelId = draft ? draft.model : (value?.model ?? null);
  const selectedModel = selectedOption ? findModel(selectedOption, selectedModelId) : undefined;
  const selectedLanguage = draft ? draft.language : (value?.languageCode ?? null);

  const select = (option: VoiceOption, modelId: string | null, languageCode: string | null) => {
    setDraft({ key: getOptionKey(option), model: modelId, language: languageCode });

    const model = findModel(option, modelId);
    onChange(model && languageCode ? toVoice(option, model, languageCode) : undefined);
  };

  const handleVoiceChange = (optionKey: string | null) => {
    const option = options.find((candidate) => getOptionKey(candidate) === optionKey);
    if (!option) {
      return;
    }

    // A billed model is never reached without having been picked.
    const modelId = option.models.length === 1 ? option.models[0]!.id : null;
    select(option, modelId, carryLanguage(findModel(option, modelId), selectedLanguage));
  };

  const handleModelChange = (modelId: string | null) => {
    if (!selectedOption || !modelId) {
      return;
    }

    select(
      selectedOption,
      modelId,
      carryLanguage(findModel(selectedOption, modelId), selectedLanguage),
    );
  };

  const handleLanguageChange = (languageCode: string | null) => {
    // Guarded on the model too, so a language can never be the only choice made.
    if (selectedOption && selectedModel && languageCode) {
      select(selectedOption, selectedModel.id, languageCode);
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
      <Group gap={4}>
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
          w={170}
        />
        <Select
          aria-label={`Language for ${speakerLabel}`}
          placeholder="Select Language"
          data={(selectedModel?.languages ?? []).map((language) => ({
            value: language.code,
            label: language.label,
          }))}
          value={selectedLanguage}
          onChange={handleLanguageChange}
          disabled={!selectedModel}
          searchable
          size="xs"
          w={190}
        />
      </Group>
    </Stack>
  );
}
