import { useState } from "react";
import { ActionIcon, Button, Group, Loader, Stack, Text } from "@mantine/core";
import { IconSettings } from "@tabler/icons-react";
import { LandingPage } from "./components/LandingPage";
import { SettingsModal } from "./components/settings/SettingsModal";
import { ViewerPage } from "./components/viewer/ViewerPage";
import type { Slide } from "./types/electron";
import { getErrorMessage } from "./utils/errors";

type AppViewState = "idle" | "loading" | "error" | "viewing";

function App() {
  const [viewState, setViewState] = useState<AppViewState>("idle");
  const [slides, setSlides] = useState<Slide[] | null>(null);
  const [currentFilePath, setCurrentFilePath] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const resetViewer = () => {
    setSlides(null);
    setCurrentFilePath(null);
    setError(null);
    setViewState("idle");
  };

  const processFile = async (filePath: string) => {
    setViewState("loading");
    setError(null);
    setCurrentFilePath(filePath);

    try {
      const response = await window.electronAPI.convertPptx(filePath);
      if (!response.success) {
        throw new Error(response.message);
      }

      setSlides(response.slides);
      setViewState("viewing");
    } catch (error: unknown) {
      setSlides(null);
      setError(getErrorMessage(error));
      setViewState("error");
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
      setError(getErrorMessage(error));
      setViewState("error");
    }
  };

  let content;

  if (viewState === "loading") {
    content = (
      <Group>
        <Loader />
        <Text>Processing...</Text>
      </Group>
    );
  } else if (viewState === "error" && error) {
    content = (
      <>
        <Text c="red" size="xl">
          Error: {error}
        </Text>
        <Button variant="light" onClick={resetViewer}>
          Try Again
        </Button>
      </>
    );
  } else if (viewState === "viewing" && slides) {
    content = (
      <ViewerPage
        slides={slides}
        onBack={resetViewer}
        onOpenSettings={() => setSettingsOpen(true)}
        filePath={currentFilePath || ""}
      />
    );
  } else {
    content = (
      <>
        <ActionIcon
          variant="subtle"
          size="lg"
          pos="absolute"
          top={10}
          left={10}
          onClick={() => setSettingsOpen(true)}
        >
          <IconSettings size={24} />
        </ActionIcon>
        <LandingPage onSelectFile={handleManualSelect} />
      </>
    );
  }

  return (
    <>
      <Stack
        h="100dvh"
        justify={viewState === "viewing" ? "flex-start" : "center"}
        align={viewState === "viewing" ? "stretch" : "center"}
      >
        {content}
      </Stack>
      <SettingsModal opened={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </>
  );
}

export default App;
