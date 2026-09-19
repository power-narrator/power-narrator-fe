import {
  ActionIcon,
  Box,
  Button,
  Code,
  Divider,
  Flex,
  Group,
  Modal,
  Paper,
  Stack,
  Switch,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { IconTrash } from "@tabler/icons-react";
import { useEffect, useState } from "react";
import { DEFAULT_SPEAKER_KEY, DEFAULT_SPEAKER_LABEL } from "../../../shared/narration/speaker";
import { toSpeakerPrompt } from "../../../shared/narration/prompt";
import { speakerNameProblem } from "../../../shared/narration/speakerName";
import { useSettings } from "../../context/useSettings";
import type { SpeakerMapping, VoiceOption } from "../../../shared/types/tts";
import { SpeakerPrompt } from "../SpeakerPrompt";
import { VoiceSelector } from "./VoiceSelector";

interface SettingsModalProps {
  opened: boolean;
  onClose: () => void;
}

interface SpeakerMappingControlsProps {
  speakerLabel: string;
  mapping: SpeakerMapping | undefined;
  voiceOptions: VoiceOption[];
  onChange: (change: Partial<SpeakerMapping>) => void;
}

function SpeakerMappingControls({
  speakerLabel,
  mapping,
  voiceOptions,
  onChange,
}: SpeakerMappingControlsProps) {
  return (
    <Stack>
      <VoiceSelector
        speakerLabel={speakerLabel}
        value={mapping?.voice}
        onChange={(voice) => onChange({ voice })}
        options={voiceOptions}
      />
      <SpeakerPrompt
        speakerLabel={speakerLabel}
        value={mapping?.prompt}
        supportsPrompt={mapping?.voice?.supportsPrompt}
        onChange={(prompt) => onChange({ prompt })}
      />
    </Stack>
  );
}

export function SettingsModal({ opened, onClose }: SettingsModalProps) {
  const [keyPath, setKeyPath] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [newAlias, setNewAlias] = useState("");
  const [aliasProblem, setAliasProblem] = useState<string | null>(null);
  const [voiceOptions, setVoiceOptions] = useState<VoiceOption[]>([]);
  const [xmlCliEnabled, setXmlCliEnabled] = useState(false);
  const { mappings, saveMappings } = useSettings();
  const mappedSpeakers = Object.entries(mappings).filter(([key]) => key !== DEFAULT_SPEAKER_KEY);

  useEffect(() => {
    if (!opened) {
      return;
    }

    Promise.all([
      window.electronAPI.getGcpKeyPath(),
      window.electronAPI.getVoices(),
      window.electronAPI.getXmlCliEnabled(),
    ])
      .then(([path, loadedVoices, xmlEnabled]) => {
        setKeyPath(path || null);
        setVoiceOptions(loadedVoices || []);
        setXmlCliEnabled(Boolean(xmlEnabled));
      })
      .catch((loadError) => {
        console.error(loadError);
      });
  }, [opened]);

  const updateMapping = (alias: string, change: Partial<SpeakerMapping>) => {
    const nextMapping: SpeakerMapping = { ...mappings[alias], ...change };
    if (!nextMapping.voice) {
      delete nextMapping.voice;
    }
    if (!toSpeakerPrompt(nextMapping.prompt)) {
      delete nextMapping.prompt;
    }

    void saveMappings({ ...mappings, [alias]: nextMapping });
  };

  const removeMapping = (alias: string) => {
    const nextMappings = { ...mappings };
    delete nextMappings[alias];
    void saveMappings(nextMappings);
  };

  const addAlias = () => {
    const trimmedAlias = newAlias.trim();
    const problem = speakerNameProblem(trimmedAlias);
    if (problem) {
      setAliasProblem(problem);
      return;
    }

    setAliasProblem(null);
    if (mappings[trimmedAlias]) {
      return;
    }

    void saveMappings({ ...mappings, [trimmedAlias]: {} });
    setNewAlias("");
  };

  const handleSetKey = async () => {
    setError(null);
    try {
      const result = await window.electronAPI.setGcpKey();
      if (result.success) {
        setKeyPath(result.path);
        return;
      }

      setError(result.message);
    } catch (setKeyError) {
      console.error(setKeyError);
      setError("Failed to set key");
    }
  };

  return (
    <Modal opened={opened} onClose={onClose} title="Settings" centered size="lg">
      <Stack gap="sm">
        <Box>
          <Title order={4}>Google Cloud TTS Configuration</Title>
          <Text size="sm" c="dimmed">
            To use Google Cloud, you must provide a valid Google Cloud Service Account JSON key.
          </Text>
        </Box>

        <Paper withBorder p="xs">
          <Group justify="space-between">
            <Text size="sm">Current Key:</Text>
            {keyPath ? (
              <Code p="xs" bg="green" style={{ overflowWrap: "anywhere" }}>
                {keyPath}
              </Code>
            ) : (
              <Text size="sm" c="red">
                Not Configured
              </Text>
            )}
          </Group>
        </Paper>

        <Button
          style={{ alignSelf: "flex-end" }}
          onClick={() => void handleSetKey()}
          variant="light"
          size="xs"
        >
          Select Key File...
        </Button>

        <Divider my="sm" />

        <Box>
          <Text fw={500}>Speaker Voices Mapping</Text>
          <Text size="sm" c="dimmed">
            Assign voices to specific speaker aliases. Use tags like <Code>[speaker 1]</Code> in
            your notes.
          </Text>
        </Box>

        <Paper p="xs" bg="dark.6">
          <Group align="flex-start" wrap="nowrap">
            <Text size="sm" w={100}>
              Default Voice (No Tag)
            </Text>
            <SpeakerMappingControls
              speakerLabel={DEFAULT_SPEAKER_LABEL}
              mapping={mappings[DEFAULT_SPEAKER_KEY]}
              voiceOptions={voiceOptions}
              onChange={(change) => updateMapping(DEFAULT_SPEAKER_KEY, change)}
            />
          </Group>
        </Paper>

        {mappedSpeakers.map(([alias, mapping]) => (
          <Paper key={alias} withBorder p="xs">
            <Group align="flex-start" wrap="nowrap">
              <Box w={100}>
                <Code>[{alias}]</Code>
              </Box>
              <SpeakerMappingControls
                speakerLabel={alias}
                mapping={mapping}
                voiceOptions={voiceOptions}
                onChange={(change) => updateMapping(alias, change)}
              />
              <ActionIcon
                aria-label={`Delete mapping for ${alias}`}
                color="red"
                variant="subtle"
                onClick={() => removeMapping(alias)}
              >
                <IconTrash size={16} />
              </ActionIcon>
            </Group>
          </Paper>
        ))}

        <Flex
          component="form"
          gap="xs"
          onSubmit={(event) => {
            event.preventDefault();
            addAlias();
          }}
        >
          <TextInput
            placeholder="New alias (e.g. speaker 1)"
            size="xs"
            value={newAlias}
            error={aliasProblem}
            onChange={(event) => {
              setNewAlias(event.currentTarget.value);
              setAliasProblem(null);
            }}
            flex={1}
          />
          <Button
            size="xs"
            onClick={addAlias}
            disabled={!newAlias.trim() || voiceOptions.length === 0}
          >
            Add Mapping
          </Button>
        </Flex>

        {error && (
          <Text c="red" size="sm">
            {error}
          </Text>
        )}

        <Divider my="sm" />

        <Group justify="space-between" align="center">
          <Box>
            <Text>XML CLI Engine (Experimental)</Text>
            <Text size="sm" c="dimmed">
              Use the Python XML CLI for PPTX operations instead of AppleScript. Less features are
              supported but it does not require PowerPoint to be running.
            </Text>
          </Box>
          <Switch
            checked={xmlCliEnabled}
            onChange={(event) => {
              const enabled = event.currentTarget.checked;
              setXmlCliEnabled(enabled);
              void window.electronAPI.setXmlCliEnabled(enabled);
            }}
          />
        </Group>

        <Button onClick={onClose} style={{ alignSelf: "flex-end" }}>
          Close
        </Button>
      </Stack>
    </Modal>
  );
}
