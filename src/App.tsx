import { useState } from "react";
import { ActionIcon, Button, Center, Text } from "@mantine/core";
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
        throw new Error(response.error || "Conversion failed");
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

  if (viewState === "loading") {
    return (
      <Center h="100vh">
        <Text ml="md">Processing...</Text>
      </Center>
    );
  }

  if (viewState === "error" && error) {
    return (
      <Center h="100vh" style={{ flexDirection: "column", gap: "1rem" }}>
        <Text c="red" size="xl">
          Error: {error}
        </Text>
        <Button variant="light" onClick={resetViewer}>
          Try Again
        </Button>
      </Center>
    );
  }

  return (
    <div style={{ height: "100vh", display: "flex", flexDirection: "column" }}>
      {viewState === "viewing" && slides ? (
        <ViewerPage slides={slides} onBack={resetViewer} filePath={currentFilePath || ""} />
      ) : (
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
      )}

      <SettingsModal opened={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  );
}

export default App;
