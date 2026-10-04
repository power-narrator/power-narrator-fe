import { Group, Select } from "@mantine/core";
import { useState } from "react";
import type { Voice, VoiceModel, VoiceOption } from "../../../shared/types/tts";

type VoiceSelectorProps = {
  speakerLabel: string;
  value: Voice | undefined;
  onChange: (voice: Voice) => void;
  onIncompleteChange: (incomplete: boolean) => void;
  options: VoiceOption[] | null;
};

type Selection = {
  key: string | null;
  model: string | null;
  language: string | null;
};

const SAVED_VOICE_KEY = "saved";

function getOptionKey(option: VoiceOption): string {
  return JSON.stringify([option.provider, option.name, option.ssmlGender]);
}

function findOption(options: VoiceOption[], voice: Voice): VoiceOption | undefined {
  return options.find(
    (option) =>
      option.provider === voice.provider &&
      option.name === voice.voiceId &&
      option.models.some(
        (model) =>
          model.id === voice.model &&
          model.languages.some((language) => language.code === voice.languageCode),
      ),
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

export function VoiceSelector({
  speakerLabel,
  value,
  onChange,
  onIncompleteChange,
  options,
}: VoiceSelectorProps) {
  const [draft, setDraft] = useState<Selection | null>(null);

  const catalogue = options ?? [];
  const committedOption = value ? findOption(catalogue, value) : undefined;
  const selection: Selection = draft ?? {
    key: committedOption ? getOptionKey(committedOption) : value ? SAVED_VOICE_KEY : null,
    model: value?.model ?? null,
    language: value?.languageCode ?? null,
  };
  const selectedOption = catalogue.find((option) => getOptionKey(option) === selection.key);
  const selectedModel = selectedOption ? findModel(selectedOption, selection.model) : undefined;
  const savedVoice = selection.key === SAVED_VOICE_KEY ? value : undefined;

  const updateDraftAndCommitVoice = (
    option: VoiceOption,
    modelId: string | null,
    preferredLanguage: string | null,
  ) => {
    const model = findModel(option, modelId);
    const languageCode = selectLanguageForModel(model, preferredLanguage);
    setDraft({ key: getOptionKey(option), model: modelId, language: languageCode });

    if (!model || !languageCode) {
      onIncompleteChange(true);
      return;
    }

    onIncompleteChange(false);
    onChange(toVoice(option, model, languageCode));
  };

  const handleVoiceChange = (optionKey: string | null) => {
    const option = catalogue.find((candidate) => getOptionKey(candidate) === optionKey);
    if (!option) {
      return;
    }

    const modelId = option.models.length === 1 ? option.models[0]!.id : null;
    updateDraftAndCommitVoice(option, modelId, selection.language);
  };

  const handleModelChange = (modelId: string | null) => {
    if (!selectedOption || !modelId) {
      return;
    }

    updateDraftAndCommitVoice(selectedOption, modelId, selection.language);
  };

  const handleLanguageChange = (languageCode: string | null) => {
    if (selectedOption && selectedModel && languageCode) {
      updateDraftAndCommitVoice(selectedOption, selectedModel.id, languageCode);
    }
  };

  return (
    <Group gap="xs" grow>
      <Select
        aria-label={`Voice for ${speakerLabel}`}
        placeholder="Select Voice"
        data={[
          ...(savedVoice
            ? [
                {
                  value: SAVED_VOICE_KEY,
                  label: options ? `${savedVoice.voiceId} (unavailable)` : savedVoice.voiceId,
                  disabled: true,
                },
              ]
            : []),
          ...catalogue.map((option) => ({
            value: getOptionKey(option),
            label: `${option.name} (${option.ssmlGender})`,
          })),
        ]}
        value={selectedOption || savedVoice ? selection.key : null}
        onChange={handleVoiceChange}
        searchable
        size="xs"
      />
      <Select
        aria-label={`Model for ${speakerLabel}`}
        placeholder="Select Model"
        data={
          savedVoice
            ? [savedVoice.model]
            : (selectedOption?.models ?? []).map((model) => ({
                value: model.id,
                label: model.label,
              }))
        }
        value={selection.model}
        onChange={handleModelChange}
        disabled={!selectedOption}
        size="xs"
      />
      <Select
        aria-label={`Language for ${speakerLabel}`}
        placeholder="Select Language"
        data={
          savedVoice
            ? [savedVoice.languageCode]
            : (selectedModel?.languages ?? []).map((language) => ({
                value: language.code,
                label: language.label,
              }))
        }
        value={selection.language}
        onChange={handleLanguageChange}
        disabled={!selectedModel}
        searchable
        size="xs"
      />
    </Group>
  );
}
