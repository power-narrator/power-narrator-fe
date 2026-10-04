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
import { useEffect, useRef, useState, type ReactNode } from "react";
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
  voiceCatalogueVersion: number;
  onChange: (change: Partial<SpeakerMapping>) => void;
  onVoiceIncompleteChange: (incomplete: boolean) => void;
};

function SpeakerMappingControls({
  speakerLabel,
  mapping,
  voiceOptions,
  voiceCatalogueVersion,
  onChange,
  onVoiceIncompleteChange,
}: SpeakerMappingControlsProps) {
  return (
    <Stack>
      <VoiceSelector
        key={voiceCatalogueVersion}
        speakerLabel={speakerLabel}
        value={mapping?.voice}
        onChange={(voice) => onChange({ voice })}
        onIncompleteChange={onVoiceIncompleteChange}
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

type SectionHeadingProps = {
  title: string;
  children: ReactNode;
};

function SectionHeading({ title, children }: SectionHeadingProps) {
  return (
    <Box>
      <Title order={4}>{title}</Title>
      <Text size="sm" c="dimmed">
        {children}
      </Text>
    </Box>
  );
}

function ErrorText({ children }: { children: ReactNode }) {
  return (
    <Text c="red" size="sm">
      {children}
    </Text>
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
  const [voiceCatalogueVersion, setVoiceCatalogueVersion] = useState(0);
  const [previewFailure, setPreviewFailure] = useState<string | null>(null);
  const [incompleteVoices, setIncompleteVoices] = useState<Set<string>>(() => new Set());
  const voiceRequest = useRef(0);
  const { saveSettings } = useSettings();
  const mappings = draft?.speakerMappings ?? {};
  const mappedSpeakers = Object.entries(mappings).filter(([key]) => key !== DEFAULT_SPEAKER_KEY);
  const dirty = load.status === "loaded" && draft !== null && !isDeepEqual(draft, load.saved);
  const canSave = dirty && incompleteVoices.size === 0;
  const trimmedAlias = newAlias.trim();
  const canAddAlias = trimmedAlias !== "" && !!voiceOptions?.length;

  useEffect(() => {
    if (!opened) {
      return;
    }

    let cancelled = false;
    const request = voiceRequest.current;
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
        if (!cancelled && request === voiceRequest.current) setVoiceOptions(loadedVoices || []);
      })
      .catch((loadError) => {
        if (!cancelled) console.error(loadError);
      });
    return () => {
      cancelled = true;
      voiceRequest.current += 1;
    };
  }, [opened]);

  const previewVoices = async (keyPath: string) => {
    const request = ++voiceRequest.current;
    setVoiceCatalogueVersion((current) => current + 1);
    setIncompleteVoices(new Set());
    setVoiceOptions(null);
    setPreviewFailure(null);
    const preview = await window.electronAPI
      .previewVoices(keyPath)
      .catch((error: unknown) => ({ voices: [], failure: getErrorMessage(error) }));
    if (request !== voiceRequest.current) return;
    setVoiceOptions(preview.voices);
    setPreviewFailure(preview.failure);
  };

  const dismiss = () => {
    if (!saving) onClose();
  };

  const updateDraft = (change: Partial<Settings>) => {
    setDraft((current) => current && { ...current, ...change });
  };

  const setVoiceIncomplete = (alias: string, incomplete: boolean) => {
    setIncompleteVoices((current) => {
      if (current.has(alias) === incomplete) return current;
      const next = new Set(current);
      if (incomplete) next.add(alias);
      else next.delete(alias);
      return next;
    });
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
    setVoiceIncomplete(alias, false);
    applyMappingChange((current) => {
      const next = { ...current };
      delete next[alias];
      return next;
    });
  };

  const addAlias = () => {
    if (!canAddAlias) return;
    const problem = speakerNameProblem(trimmedAlias);
    if (problem) {
      setAliasProblem(problem);
      return;
    }

    setAliasProblem(null);
    if (mappings[trimmedAlias]) {
      return;
    }

    applyMappingChange((current) => ({ ...current, [trimmedAlias]: {} }));
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
        void previewVoices(result.path);
      }
    } catch (error) {
      console.error(error);
      setKeyError("Failed to select key");
    }
  };

  const handleSave = async () => {
    if (!canSave || saving) return;
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
        {load.status === "failed" && <ErrorText>{load.message}</ErrorText>}
        {draft && (
          <Fieldset variant="unstyled" disabled={saving}>
            <Stack gap="sm">
              <SectionHeading title="Google Cloud TTS Configuration">
                To use Google Cloud, you must provide a valid Google Cloud Service Account JSON key.
              </SectionHeading>

              <Paper withBorder p="xs">
                <Group justify="space-between">
                  <Text size="sm">Current Key:</Text>
                  <Text size="sm" p="xs" c={draft.gcpKeyPath ? undefined : "red"}>
                    {draft.gcpKeyPath ?? "Not Configured"}
                  </Text>
                </Group>
              </Paper>

              <Button ml="auto" onClick={() => void handleSelectKey()} variant="light" size="xs">
                Select Key File...
              </Button>

              {keyError && <ErrorText>{keyError}</ErrorText>}

              {previewFailure && (
                <ErrorText>Failed to load voices for the selected key: {previewFailure}</ErrorText>
              )}

              <Divider my="sm" />

              <SectionHeading title="Speaker Voices Mapping">
                Assign voices to specific speaker aliases. Use tags like <Code>[speaker 1]</Code> in
                your notes.
              </SectionHeading>

              <Paper p="xs" bg="dark.6">
                <Group align="flex-start" wrap="nowrap">
                  <Text size="sm" w={100}>
                    Default Voice (No Tag)
                  </Text>
                  <SpeakerMappingControls
                    speakerLabel={DEFAULT_SPEAKER_LABEL}
                    mapping={mappings[DEFAULT_SPEAKER_KEY]}
                    voiceOptions={voiceOptions}
                    voiceCatalogueVersion={voiceCatalogueVersion}
                    onChange={(change) => updateMapping(DEFAULT_SPEAKER_KEY, change)}
                    onVoiceIncompleteChange={(incomplete) =>
                      setVoiceIncomplete(DEFAULT_SPEAKER_KEY, incomplete)
                    }
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
                      voiceCatalogueVersion={voiceCatalogueVersion}
                      onChange={(change) => updateMapping(alias, change)}
                      onVoiceIncompleteChange={(incomplete) =>
                        setVoiceIncomplete(alias, incomplete)
                      }
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
                <Button size="xs" type="submit" disabled={!canAddAlias}>
                  Add Mapping
                </Button>
              </Flex>

              <Divider my="sm" />

              <SectionHeading title="XML CLI Engine (Experimental)">
                Use the Python XML CLI for PPTX operations instead of AppleScript. Less features are
                supported but it does not require PowerPoint to be running.
              </SectionHeading>
              <Switch
                aria-label="Enable XML CLI engine"
                checked={draft.xmlCliEnabled}
                onChange={(event) => updateDraft({ xmlCliEnabled: event.currentTarget.checked })}
              />
            </Stack>
          </Fieldset>
        )}

        {saveError && <ErrorText>{saveError}</ErrorText>}

        <Group justify="flex-end">
          <Button variant="default" onClick={dismiss} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={() => void handleSave()} disabled={!canSave} loading={saving}>
            Save
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
