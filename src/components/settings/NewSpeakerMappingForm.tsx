import { Button, Paper, Stack, TextInput } from "@mantine/core";
import { useState } from "react";
import { speakerNameProblem } from "../../../shared/narration/speakerName";
import type { SpeakerMapping, VoiceOption } from "../../../shared/types/tts";
import { SpeakerMappingControls } from "./SpeakerMappingControls";

type NewSpeakerMappingFormProps = {
  voiceOptions: VoiceOption[] | null;
  voiceCatalogueVersion: number;
  mappedAliases: string[];
  onAdd: (alias: string, mapping: SpeakerMapping) => void;
};

export function NewSpeakerMappingForm(props: NewSpeakerMappingFormProps) {
  const [entry, setEntry] = useState(0);

  return (
    <NewSpeakerMappingEntry
      key={`${props.voiceCatalogueVersion}:${entry}`}
      {...props}
      onAdd={(alias, mapping) => {
        props.onAdd(alias, mapping);
        setEntry((current) => current + 1);
      }}
    />
  );
}

function NewSpeakerMappingEntry({
  voiceOptions,
  voiceCatalogueVersion,
  mappedAliases,
  onAdd,
}: NewSpeakerMappingFormProps) {
  const [alias, setAlias] = useState("");
  const [aliasProblem, setAliasProblem] = useState<string | null>(null);
  const [mapping, setMapping] = useState<SpeakerMapping>({});
  const [voiceIncomplete, setVoiceIncomplete] = useState(false);
  const trimmedAlias = alias.trim();
  const canAdd = trimmedAlias !== "" && !!mapping.voice && !voiceIncomplete;

  const add = () => {
    if (!canAdd) return;
    const problem =
      speakerNameProblem(trimmedAlias) ??
      (mappedAliases.includes(trimmedAlias) ? `"${trimmedAlias}" already has a mapping` : null);
    if (problem) {
      setAliasProblem(problem);
      return;
    }

    onAdd(trimmedAlias, mapping);
  };

  return (
    <Paper
      component="form"
      withBorder
      p="xs"
      onSubmit={(event) => {
        event.preventDefault();
        add();
      }}
    >
      <Stack gap="xs">
        <TextInput
          placeholder="New alias (e.g. speaker 1)"
          size="xs"
          value={alias}
          error={aliasProblem}
          onChange={(event) => {
            setAlias(event.currentTarget.value);
            setAliasProblem(null);
          }}
        />
        <SpeakerMappingControls
          speakerLabel="new speaker"
          mapping={mapping}
          voiceOptions={voiceOptions}
          voiceCatalogueVersion={voiceCatalogueVersion}
          onChange={(change) => setMapping((current) => ({ ...current, ...change }))}
          onVoiceIncompleteChange={setVoiceIncomplete}
        />
        <Button ml="auto" size="xs" type="submit" disabled={!canAdd}>
          Add Mapping
        </Button>
      </Stack>
    </Paper>
  );
}
