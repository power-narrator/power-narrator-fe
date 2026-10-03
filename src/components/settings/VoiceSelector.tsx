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
  voiceKey: string | null;
  modelId: string | null;
  languageCode: string | null;
};

type Preference = {
  model: string | null;
  language: string | null;
};

const UNAVAILABLE_VOICE_KEY = "unavailable";

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

function selectModel(option: VoiceOption, preferredModel: string | null): string | null {
  if (findModel(option, preferredModel)) {
    return preferredModel;
  }

  return option.models.length === 1 ? option.models[0]!.id : null;
}

function selectLanguage(
  model: VoiceModel | undefined,
  preferredLanguage: string | null,
): string | null {
  if (!model) {
    return null;
  }
  if (model.languages.some((candidate) => candidate.code === preferredLanguage)) {
    return preferredLanguage;
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
  const [preference, setPreference] = useState<Preference>(() => ({
    model: value?.model ?? null,
    language: value?.languageCode ?? null,
  }));

  const catalogue = options ?? [];
  const committedOption = value ? findOption(catalogue, value) : undefined;
  const selection: Selection = draft ?? {
    voiceKey: committedOption
      ? getOptionKey(committedOption)
      : value
        ? UNAVAILABLE_VOICE_KEY
        : null,
    modelId: value?.model ?? null,
    languageCode: value?.languageCode ?? null,
  };
  const selectedOption = catalogue.find((option) => getOptionKey(option) === selection.voiceKey);
  const selectedModel = selectedOption ? findModel(selectedOption, selection.modelId) : undefined;
  const unavailableVoice = selection.voiceKey === UNAVAILABLE_VOICE_KEY ? value : undefined;

  const updateDraftAndCommitVoice = (
    option: VoiceOption,
    modelId: string | null,
    preferredLanguage: string | null,
  ) => {
    const model = findModel(option, modelId);
    const languageCode = selectLanguage(model, preferredLanguage);
    setDraft({ voiceKey: getOptionKey(option), modelId, languageCode });
    setPreference((current) => ({
      model: modelId ?? current.model,
      language: languageCode ?? current.language,
    }));

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

    updateDraftAndCommitVoice(option, selectModel(option, preference.model), preference.language);
  };

  const handleModelChange = (modelId: string | null) => {
    if (!selectedOption || !modelId) {
      return;
    }

    updateDraftAndCommitVoice(selectedOption, modelId, preference.language);
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
          ...(unavailableVoice
            ? [
                {
                  value: UNAVAILABLE_VOICE_KEY,
                  label: options
                    ? `${unavailableVoice.voiceId} (unavailable)`
                    : unavailableVoice.voiceId,
                  disabled: true,
                },
              ]
            : []),
          ...catalogue.map((option) => ({
            value: getOptionKey(option),
            label: `${option.name} (${option.ssmlGender})`,
          })),
        ]}
        value={selectedOption || unavailableVoice ? selection.voiceKey : null}
        onChange={handleVoiceChange}
        searchable
        size="xs"
      />
      <Select
        aria-label={`Model for ${speakerLabel}`}
        placeholder="Select Model"
        data={
          unavailableVoice
            ? [unavailableVoice.model]
            : (selectedOption?.models ?? []).map((model) => ({
                value: model.id,
                label: model.label,
              }))
        }
        value={selection.modelId}
        onChange={handleModelChange}
        disabled={!selectedOption}
        size="xs"
      />
      <Select
        aria-label={`Language for ${speakerLabel}`}
        placeholder="Select Language"
        data={
          unavailableVoice
            ? [unavailableVoice.languageCode]
            : (selectedModel?.languages ?? []).map((language) => ({
                value: language.code,
                label: language.label,
              }))
        }
        value={selection.languageCode}
        onChange={handleLanguageChange}
        disabled={!selectedModel}
        searchable
        size="xs"
      />
    </Group>
  );
}
