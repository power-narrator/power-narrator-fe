import { useState } from 'react';
import { Center, Text, ActionIcon } from '@mantine/core';
import { IconSettings } from '@tabler/icons-react';
import { LandingPage } from './components/LandingPage';
import { ViewerPage } from './components/ViewerPage';
import { SettingsModal } from './components/SettingsModal';
import type { Slide } from './electron';
import { getErrorMessage } from './utils/errors';

function App() {
  const [loading, setLoading] = useState(false);
  const [slides, setSlides] = useState<Slide[] | null>(null);
  const [currentFilePath, setCurrentFilePath] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const handleManualSelect = async () => {
    if (window.electronAPI) {
      try {
        const path = await window.electronAPI.selectFile();
        if (path) {
          processFile(path);
        }
      } catch (e) {
        console.error(e);
      }
    }
  };

  const processFile = async (filePath: string) => {
    setLoading(true);
    setError(null);
    setCurrentFilePath(filePath);
    try {
      if (window.electronAPI) {
        const response = await window.electronAPI.convertPptx(filePath);
        if (response.success) {
          setSlides(response.slides);
        } else {
          setError(response.error || 'Conversion failed');
        }
      } else {
        console.warn('Electron API not found');
      }
    } catch (error: unknown) {
      setError(getErrorMessage(error));
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <Center h="100vh">
        <Text ml="md">Processing...</Text>
      </Center>
    );
  }

  if (error) {
    return (
      <Center h="100vh" style={{ flexDirection: 'column' }}>
        <Text c="red" size="xl">Error: {error}</Text>
        <Text
          c="blue"
          style={{ cursor: 'pointer', marginTop: '1rem' }}
          onClick={() => { setError(null); setSlides(null); }}
        >
          Try Again
        </Text>
      </Center>
    );
  }

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
      {!slides ? (
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
          {loading && <Text ta="center" mt="sm">Analysing file...</Text>}
        </>
      ) : (
        <ViewerPage slides={slides} onBack={() => setSlides(null)} filePath={currentFilePath || ''} />
      )}
      <SettingsModal opened={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  );
}

export default App;
