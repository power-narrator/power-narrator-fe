import { Group, Select } from "@mantine/core";
import { useState } from "react";
import type { Voice, VoiceModel, VoiceOption } from "../../../shared/types/tts";

interface VoiceSelectorProps {
  speakerLabel: string;
  value: Voice | undefined;
  onChange: (voice: Voice | undefined) => void;
  options: VoiceOption[];
}

interface Draft {
  key: string;
  model: string | null;
  language: string | null;
}

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

function selectLanguageForModel(
  model: VoiceModel | undefined,
  currentLanguage: string | null,
): string | null {
  if (!model || model.languages.some((candidate) => candidate.code === currentLanguage)) {
    return model ? currentLanguage : null;
  }

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

  const updateDraftAndCommitVoice = (
    option: VoiceOption,
    modelId: string | null,
    languageCode: string | null,
  ) => {
    setDraft({ key: getOptionKey(option), model: modelId, language: languageCode });

    const model = findModel(option, modelId);
    onChange(model && languageCode ? toVoice(option, model, languageCode) : undefined);
  };

  const handleVoiceChange = (optionKey: string | null) => {
    const option = options.find((candidate) => getOptionKey(candidate) === optionKey);
    if (!option) {
      return;
    }

    const modelId = option.models.length === 1 ? option.models[0]!.id : null;
    updateDraftAndCommitVoice(
      option,
      modelId,
      selectLanguageForModel(findModel(option, modelId), selectedLanguage),
    );
  };

  const handleModelChange = (modelId: string | null) => {
    if (!selectedOption || !modelId) {
      return;
    }

    updateDraftAndCommitVoice(
      selectedOption,
      modelId,
      selectLanguageForModel(findModel(selectedOption, modelId), selectedLanguage),
    );
  };

  const handleLanguageChange = (languageCode: string | null) => {
    if (selectedOption && selectedModel && languageCode) {
      updateDraftAndCommitVoice(selectedOption, selectedModel.id, languageCode);
    }
  };

  return (
    <Group gap={4} wrap="nowrap" grow>
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
        miw={0}
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
        miw={0}
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
        miw={0}
      />
    </Group>
  );
}
