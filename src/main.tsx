import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { MantineProvider } from "@mantine/core";
import App from "./App.tsx";
import { SettingsProvider } from "./context/SettingsContext.tsx";
import { AudioProvider } from "./context/AudioContext.tsx";
import { NarrationPreviewProvider } from "./components/viewer/useNarrationPreview.ts";
import "@mantine/core/styles.css";
import "@gfazioli/mantine-split-pane/styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <MantineProvider defaultColorScheme="dark">
      <SettingsProvider>
        <AudioProvider>
          <NarrationPreviewProvider>
            <App />
          </NarrationPreviewProvider>
        </AudioProvider>
      </SettingsProvider>
    </MantineProvider>
  </StrictMode>,
);
