import { Group, Select } from "@mantine/core";
import { useState } from "react";
import type { Voice, VoiceModel, VoiceOption } from "../../../shared/types/tts";

type VoiceSelectorProps = {
  speakerLabel: string;
  value: Voice | undefined;
  onChange: (voice: Voice) => void;
  onIncompleteChange: (incomplete: boolean) => void;
  options: VoiceOption[] | null;
  catalogueVersion: number;
};

type Choices = {
  model: string | null;
  language: string | null;
};

type Draft = Choices & { key: string };

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

function selectPreferredOrSole(available: string[], preferred: string | null): string | null {
  if (preferred !== null && available.includes(preferred)) {
    return preferred;
  }

  return available.length === 1 ? available[0]! : null;
}

function selectModel(option: VoiceOption, preferredModel: string | null): string | null {
  return selectPreferredOrSole(
    option.models.map((model) => model.id),
    preferredModel,
  );
}

function selectLanguage(
  model: VoiceModel | undefined,
  preferredLanguage: string | null,
): string | null {
  return model
    ? selectPreferredOrSole(
        model.languages.map((language) => language.code),
        preferredLanguage,
      )
    : null;
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
  catalogueVersion,
}: VoiceSelectorProps) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [draftCatalogueVersion, setDraftCatalogueVersion] = useState(catalogueVersion);
  if (catalogueVersion !== draftCatalogueVersion) {
    setDraftCatalogueVersion(catalogueVersion);
    setDraft(null);
  }
  const [preference, setPreference] = useState<Choices>(() => ({
    model: value?.model ?? null,
    language: value?.languageCode ?? null,
  }));

  const catalogue = options ?? [];
  const committedOption = value ? findOption(catalogue, value) : undefined;
  const selectedOption = draft
    ? catalogue.find((option) => getOptionKey(option) === draft.key)
    : committedOption;
  const savedVoice = !draft && !committedOption ? value : undefined;
  const selectedKey = selectedOption
    ? getOptionKey(selectedOption)
    : savedVoice
      ? SAVED_VOICE_KEY
      : null;
  const selectedModelId = draft ? draft.model : (value?.model ?? null);
  const selectedModel = selectedOption ? findModel(selectedOption, selectedModelId) : undefined;
  const selectedLanguage = draft ? draft.language : (value?.languageCode ?? null);

  const updateDraftAndCommitVoice = (
    option: VoiceOption,
    modelId: string | null,
    languageCode: string | null,
  ) => {
    setDraft({ key: getOptionKey(option), model: modelId, language: languageCode });
    setPreference((current) => ({
      model: modelId ?? current.model,
      language: languageCode ?? current.language,
    }));

    const model = findModel(option, modelId);
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

    const modelId = selectModel(option, preference.model);
    updateDraftAndCommitVoice(
      option,
      modelId,
      selectLanguage(findModel(option, modelId), preference.language),
    );
  };

  const handleModelChange = (modelId: string | null) => {
    if (!selectedOption || !modelId) {
      return;
    }

    updateDraftAndCommitVoice(
      selectedOption,
      modelId,
      selectLanguage(findModel(selectedOption, modelId), preference.language),
    );
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
        value={selectedKey}
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
        value={selectedModelId}
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
        value={selectedLanguage}
        onChange={handleLanguageChange}
        disabled={!selectedModel}
        searchable
        size="xs"
      />
    </Group>
  );
}
