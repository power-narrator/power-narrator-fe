import { useState } from "react";
import { ActionIcon, Button, Group, Loader, Stack, Text } from "@mantine/core";
import { IconSettings } from "@tabler/icons-react";
import { LandingPage } from "./components/LandingPage";
import { SettingsModal } from "./components/settings/SettingsModal";
import { ViewerPage } from "./components/viewer/ViewerPage";
import type { Slide } from "./types/electron";
import { getErrorMessage } from "./utils/errors";

type AppViewState =
  | { kind: "idle" }
  | { kind: "loading"; filePath: string }
  | { kind: "error"; message: string }
  | { kind: "viewing"; filePath: string; slides: Slide[] };

function App() {
  const [view, setView] = useState<AppViewState>({ kind: "idle" });
  const [settingsOpen, setSettingsOpen] = useState(false);

  const resetViewer = () => {
    setView({ kind: "idle" });
  };

  const processFile = async (filePath: string) => {
    setView({ kind: "loading", filePath });

    try {
      const response = await window.electronAPI.convertPptx(filePath);
      if (!response.success) {
        throw new Error(response.message);
      }

      setView({ kind: "viewing", filePath, slides: response.slides });
    } catch (error: unknown) {
      setView({ kind: "error", message: getErrorMessage(error) });
    }
  };

  const handleManualSelect = async () => {
    try {
      const path = await window.electronAPI.selectFile();
      if (path) {
        await processFile(path);
      }
    } catch (error: unknown) {
      console.error(error);
      setView({ kind: "error", message: getErrorMessage(error) });
    }
  };

  let content;

  if (view.kind === "loading") {
    content = (
      <Group>
        <Loader />
        <Text>Processing...</Text>
      </Group>
    );
  } else if (view.kind === "error") {
    content = (
      <>
        <Text c="red" size="xl">
          Error: {view.message}
        </Text>
        <Button variant="light" onClick={resetViewer}>
          Try Again
        </Button>
      </>
    );
  } else if (view.kind === "viewing") {
    content = (
      <ViewerPage
        key={view.filePath}
        slides={view.slides}
        onBack={resetViewer}
        onOpenSettings={() => setSettingsOpen(true)}
        filePath={view.filePath}
      />
    );
  } else {
    content = (
      <>
        <ActionIcon
          aria-label="Open settings"
          variant="subtle"
          size="lg"
          pos="absolute"
          top={10}
          left={10}
          onClick={() => setSettingsOpen(true)}
        >
          <IconSettings size={24} />
        </ActionIcon>
        <LandingPage onSelectFile={() => void handleManualSelect()} />
      </>
    );
  }

  return (
    <>
      <Stack
        h="100dvh"
        justify={view.kind === "viewing" ? "flex-start" : "center"}
        align={view.kind === "viewing" ? "stretch" : "center"}
      >
        {content}
      </Stack>
      <SettingsModal opened={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </>
  );
}

export default App;
