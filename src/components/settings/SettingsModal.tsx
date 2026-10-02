import {
  ActionIcon,
  Box,
  Button,
  Code,
  Divider,
  Fieldset,
  Flex,
  Group,
  Loader,
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
import { getErrorMessage } from "../../utils/errors";
import { isDeepEqual } from "../../utils/isDeepEqual";
import type { Settings } from "../../../shared/types/settings";
import type { SpeakerMapping, VoiceOption } from "../../../shared/types/tts";
import { SpeakerPrompt } from "../SpeakerPrompt";
import { VoiceSelector } from "./VoiceSelector";

type SettingsModalProps = {
  opened: boolean;
  onClose: () => void;
};

type SpeakerMappingControlsProps = {
  speakerLabel: string;
  mapping: SpeakerMapping | undefined;
  voiceOptions: VoiceOption[] | null;
  onChange: (change: Partial<SpeakerMapping>) => void;
};

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

type SavedSettingsLoad =
  | { status: "loading" }
  | { status: "failed"; message: string }
  | { status: "loaded"; saved: Settings };

export function SettingsModal({ opened, onClose }: SettingsModalProps) {
  const [session, setSession] = useState(0);
  const [wasOpened, setWasOpened] = useState(opened);
  if (opened !== wasOpened) {
    setWasOpened(opened);
    if (opened) setSession((current) => current + 1);
  }

  return <SettingsDialog key={session} opened={opened} onClose={onClose} />;
}

function SettingsDialog({ opened, onClose }: SettingsModalProps) {
  const [load, setLoad] = useState<SavedSettingsLoad>({ status: "loading" });
  const [draft, setDraft] = useState<Settings | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [keyError, setKeyError] = useState<string | null>(null);
  const [newAlias, setNewAlias] = useState("");
  const [aliasProblem, setAliasProblem] = useState<string | null>(null);
  const [voiceOptions, setVoiceOptions] = useState<VoiceOption[] | null>(null);
  const { saveSettings } = useSettings();
  const mappings = draft?.speakerMappings ?? {};
  const mappedSpeakers = Object.entries(mappings).filter(([key]) => key !== DEFAULT_SPEAKER_KEY);
  const dirty = load.status === "loaded" && draft !== null && !isDeepEqual(draft, load.saved);

  useEffect(() => {
    if (!opened) {
      return;
    }

    let cancelled = false;
    window.electronAPI
      .getSettings()
      .then((settings) => {
        if (cancelled) return;
        setLoad({ status: "loaded", saved: settings });
        setDraft(settings);
      })
      .catch((loadError: unknown) => {
        if (!cancelled) {
          setLoad({
            status: "failed",
            message: `Failed to load settings: ${getErrorMessage(loadError)}`,
          });
        }
      });
    window.electronAPI
      .getVoices()
      .then((loadedVoices) => {
        if (!cancelled) setVoiceOptions(loadedVoices || []);
      })
      .catch((loadError) => {
        if (!cancelled) console.error(loadError);
      });
    return () => {
      cancelled = true;
    };
  }, [opened]);

  const dismiss = () => {
    if (!saving) onClose();
  };

  const updateDraft = (change: Partial<Settings>) => {
    setDraft((current) => current && { ...current, ...change });
  };

  const applyMappingChange = (
    update: (current: Record<string, SpeakerMapping>) => Record<string, SpeakerMapping>,
  ) => {
    setDraft(
      (current) => current && { ...current, speakerMappings: update(current.speakerMappings) },
    );
  };

  const updateMapping = (alias: string, change: Partial<SpeakerMapping>) => {
    applyMappingChange((current) => {
      const nextMapping: SpeakerMapping = { ...current[alias], ...change };
      if (!nextMapping.voice) {
        delete nextMapping.voice;
      }
      if (!toSpeakerPrompt(nextMapping.prompt)) {
        delete nextMapping.prompt;
      }

      if (alias === DEFAULT_SPEAKER_KEY && !nextMapping.voice && !nextMapping.prompt) {
        const { [alias]: _, ...rest } = current;
        return rest;
      }

      return { ...current, [alias]: nextMapping };
    });
  };

  const removeMapping = (alias: string) => {
    applyMappingChange((current) => {
      const next = { ...current };
      delete next[alias];
      return next;
    });
  };

  const addAlias = () => {
    if (!newAlias.trim() || !voiceOptions?.length) return;
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

    applyMappingChange((current) =>
      trimmedAlias in current ? current : { ...current, [trimmedAlias]: {} },
    );
    setNewAlias("");
  };

  const handleSelectKey = async () => {
    setKeyError(null);
    try {
      const result = await window.electronAPI.selectGcpKey();
      if (!result.success) {
        setKeyError(result.message);
      } else if (result.path) {
        updateDraft({ gcpKeyPath: result.path });
      }
    } catch (error) {
      console.error(error);
      setKeyError("Failed to select key");
    }
  };

  const handleSave = async () => {
    if (!draft || saving) return;
    setSaving(true);
    setSaveError(null);
    try {
      await saveSettings(draft);
      onClose();
    } catch (error) {
      setSaveError(`Failed to save settings: ${getErrorMessage(error)}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      opened={opened}
      onClose={dismiss}
      title="Settings"
      centered
      size="lg"
      closeButtonProps={{ "aria-label": "Close settings", disabled: saving }}
    >
      <Stack gap="sm">
        {load.status === "loading" && (
          <Group gap="xs">
            <Loader size="xs" />
            <Text size="sm">Loading settings…</Text>
          </Group>
        )}
        {load.status === "failed" && (
          <Text c="red" size="sm">
            {load.message}
          </Text>
        )}
        {draft && (
          <Fieldset variant="unstyled" disabled={saving}>
            <Stack gap="sm">
              <Box>
                <Title order={4}>Google Cloud TTS Configuration</Title>
                <Text size="sm" c="dimmed">
                  To use Google Cloud, you must provide a valid Google Cloud Service Account JSON
                  key.
                </Text>
              </Box>

              <Paper withBorder p="xs">
                <Group justify="space-between">
                  <Text size="sm">Current Key:</Text>
                  {draft.gcpKeyPath ? (
                    <Code p="xs" bg="green" style={{ overflowWrap: "anywhere" }}>
                      {draft.gcpKeyPath}
                    </Code>
                  ) : (
                    <Text size="sm" c="red">
                      Not Configured
                    </Text>
                  )}
                </Group>
              </Paper>

              <Button ml="auto" onClick={() => void handleSelectKey()} variant="light" size="xs">
                Select Key File...
              </Button>

              {keyError && (
                <Text c="red" size="sm">
                  {keyError}
                </Text>
              )}

              <Divider my="sm" />

              <Box>
                <Text fw={500}>Speaker Voices Mapping</Text>
                <Text size="sm" c="dimmed">
                  Assign voices to specific speaker aliases. Use tags like <Code>[speaker 1]</Code>{" "}
                  in your notes.
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
                  type="submit"
                  disabled={!newAlias.trim() || !voiceOptions?.length}
                >
                  Add Mapping
                </Button>
              </Flex>

              <Divider my="sm" />

              <Box>
                <Text>XML CLI Engine (Experimental)</Text>
                <Text size="sm" c="dimmed">
                  Use the Python XML CLI for PPTX operations instead of AppleScript. Less features
                  are supported but it does not require PowerPoint to be running.
                </Text>
              </Box>
              <Switch
                aria-label="Enable XML CLI engine"
                checked={draft.xmlCliEnabled}
                onChange={(event) => updateDraft({ xmlCliEnabled: event.currentTarget.checked })}
              />
            </Stack>
          </Fieldset>
        )}

        {saveError && (
          <Text c="red" size="sm">
            {saveError}
          </Text>
        )}

        <Group justify="flex-end">
          <Button variant="default" onClick={dismiss} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={() => void handleSave()} disabled={!dirty} loading={saving}>
            Save
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
