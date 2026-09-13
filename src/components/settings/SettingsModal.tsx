import {
  ActionIcon,
  Box,
  Button,
  Code,
  Divider,
  Group,
  Modal,
  Paper,
  Stack,
  Switch,
  Text,
  TextInput,
} from "@mantine/core";
import { IconTrash } from "@tabler/icons-react";
import { useEffect, useState } from "react";
import { DEFAULT_SPEAKER_KEY, DEFAULT_SPEAKER_LABEL } from "../../../shared/narration/speaker";
import { toSpeakerPrompt } from "../../../shared/narration/prompt";
import { speakerNameProblem } from "../../../shared/narration/speakerName";
import { useSettings } from "../../context/useSettings";
import type { SpeakerMapping, VoiceOption } from "../../../shared/types/tts";
import { getProviderLabel } from "./providerLabels";
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
    <Stack gap={4} flex={1} miw={0}>
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
        textareaWidth="100%"
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
      <Stack>
        <Text fw={500}>Google Cloud TTS Configuration</Text>
        <Text size="sm" c="dimmed">
          To use high-quality voices (Chirp 3 HD), you must provide a valid Google Cloud Service
          Account JSON key.
        </Text>

        <Paper withBorder p="xs">
          <Group justify="space-between">
            <Text size="sm" fw={700}>
              Current Key:
            </Text>
            {keyPath ? (
              <Code
                color="green"
                maw={200}
                style={{ overflow: "hidden", textOverflow: "ellipsis" }}
              >
                {keyPath}
              </Code>
            ) : (
              <Text size="sm" c="red">
                Not Configured
              </Text>
            )}
          </Group>
        </Paper>

        <Group justify="flex-end">
          <Button onClick={() => void handleSetKey()} variant="light" size="xs">
            Select Key File...
          </Button>
        </Group>

        <Divider my="sm" />

        <Group justify="space-between" align="center">
          <Box>
            <Text fw={500}>Speaker Voices Mapping</Text>
            <Text size="sm" c="dimmed">
              Assign voices to specific speaker aliases. Use tags like <Code>[speaker 1]</Code> in
              your notes.
            </Text>
          </Box>
          <Text size="sm" fw={600} c="dimmed">
            {Array.from(
              new Set(voiceOptions.map((option) => getProviderLabel(option.provider))),
            ).join(", ")}
          </Text>
        </Group>

        <Stack gap="xs">
          <Paper p="xs" bg="dark.6">
            <Group align="flex-start" wrap="nowrap">
              <Text size="sm" fw={600} w={130} miw={130} pt={6}>
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
                <Box w={100} miw={100} pt={4}>
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

          <Group mt="xs">
            <TextInput
              placeholder="New alias (e.g. speaker 1)"
              size="xs"
              value={newAlias}
              error={aliasProblem}
              onChange={(event) => {
                setNewAlias(event.currentTarget.value);
                setAliasProblem(null);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  addAlias();
                }
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
          </Group>
        </Stack>

        {error && (
          <Text c="red" size="sm" mt="sm">
            {error}
          </Text>
        )}

        <Divider my="sm" />

        <Group justify="space-between" align="center">
          <Box>
            <Text fw={500}>XML CLI Engine (Experimental)</Text>
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
            size="md"
          />
        </Group>

        <Group justify="flex-end" mt="md">
          <Button onClick={onClose}>Close</Button>
        </Group>
      </Stack>
    </Modal>
  );
}
