import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { MantineProvider } from "@mantine/core";
import App from "./App.tsx";
import { SettingsProvider } from "./context/SettingsContext.tsx";
import "@mantine/core/styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <MantineProvider defaultColorScheme="dark">
      <SettingsProvider>
        <App />
      </SettingsProvider>
    </MantineProvider>
  </StrictMode>,
);
