import { app, BrowserWindow, ipcMain, dialog, protocol, net } from "electron";
import path from "path";
import fs from "fs";
import dotenv from "dotenv";
import { fileURLToPath, pathToFileURL } from "url";
import Store from "electron-store";
import { NativePlatformProvider, PptProvider } from "./platform/PptProvider.js";
import { MacPptProvider } from "./platform/MacPptProvider.js";
import { WindowsPptProvider } from "./platform/WindowsPptProvider.js";
import { XmlPptProvider } from "./platform/XmlPptProvider.js";
import { APP_NAME } from "./platform/helpers.js";
import { TtsManager } from "./tts/TtsManager.js";
import type {
  GenerateVideoRequest,
  PlaySlideRequest,
  ReloadSlideRequest,
  RemoveAudioRequest,
  SlideAudioEntry,
  SlideManifestEntry,
} from "./platform/types.js";

protocol.registerSchemesAsPrivileged([
  {
    scheme: APP_NAME,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
    },
  },
]);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();

app.setName(APP_NAME);
const store = new Store();

function getGcpKeyPath(): string | undefined {
  const envPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;

  if (envPath) {
    const resolvedPath = path.resolve(envPath);
    if (fs.existsSync(resolvedPath) && fs.statSync(resolvedPath).isFile()) {
      return resolvedPath;
    } else {
      console.warn(`GOOGLE_APPLICATION_CREDENTIALS path not found or not a file: ${resolvedPath}`);
    }
  }

  return store.get("gcpKeyPath") as string;
}

const ttsManager = new TtsManager(process.env.TTS_PROVIDER ?? "gcp", getGcpKeyPath);

const nativeProvider: (PptProvider & NativePlatformProvider) | null =
  process.platform === "darwin"
    ? new MacPptProvider()
    : process.platform === "win32"
      ? new WindowsPptProvider()
      : null;

function getActiveCoreProvider(): PptProvider {
  const useXmlCli = Boolean(store.get("xmlCliEnabled"));

  if (useXmlCli) {
    return new XmlPptProvider(nativeProvider ?? undefined);
  }

  if (!nativeProvider) {
    throw new Error("No core PowerPoint provider is available on this platform");
  }

  return nativeProvider;
}

function getOutputDir(absolutePath: string): string {
  return path.join(
    app.getPath("temp"),
    APP_NAME,
    path.basename(absolutePath, path.extname(absolutePath)),
  );
}

const createWindow = () => {
  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
    },
  });

  if (!app.isPackaged && !(process.env.NODE_ENV === "test")) {
    mainWindow.loadURL("http://localhost:5173");
  } else {
    mainWindow.loadFile(path.join(__dirname, "../dist-vite/index.html"));
  }
};

app.whenReady().then(() => {
  protocol.handle(APP_NAME, (request) => {
    const url = new URL(request.url);
    if (url.hostname !== "slide") {
      return new Response("Not Found", { status: 404 });
    }

    const encodedPath = url.pathname.startsWith("/") ? url.pathname.slice(1) : url.pathname;
    const assetPath = path.normalize(decodeURIComponent(encodedPath));
    const allowedRoot = path.join(app.getPath("temp"), APP_NAME);
    const relativePath = path.relative(allowedRoot, assetPath);

    if (relativePath !== "" && (relativePath.startsWith("..") || path.isAbsolute(relativePath))) {
      return new Response("Forbidden", { status: 403 });
    }

    if (!fs.existsSync(assetPath) || !fs.statSync(assetPath).isFile()) {
      return new Response("Not Found", { status: 404 });
    }

    return net.fetch(pathToFileURL(assetPath).toString());
  });
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

// ==========================================
// File & Dialog Handlers
// ==========================================
ipcMain.handle("select-file", async () => {
  const result = await dialog.showOpenDialog({
    properties: ["openFile"],
    filters: [{ name: "PowerPoint", extensions: ["pptx"] }],
  });
  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }
  return result.filePaths[0];
});

ipcMain.handle("get-video-save-path", async () => {
  const win = BrowserWindow.getFocusedWindow();
  const options = {
    title: "Save Video As",
    defaultPath: path.join(app.getPath("documents"), "Output.mp4"),
    filters: [{ name: "MPEG-4 Video", extensions: ["mp4"] }],
  };
  const result = win
    ? await dialog.showSaveDialog(win, options)
    : await dialog.showSaveDialog(options);

  if (result.canceled || !result.filePath) {
    return null;
  }
  return result.filePath;
});

// ==========================================
// PowerPoint Lifecycle Handlers
// ==========================================
ipcMain.handle("convert-pptx", async (_, filePath) => {
  console.log("Convert request for (raw):", filePath);
  const absolutePath = path.resolve(filePath);
  console.log("Convert request for (absolute):", absolutePath);

  if (!fs.existsSync(absolutePath)) {
    return { success: false, message: `File not found: ${absolutePath}` };
  }

  return getActiveCoreProvider().convertPptx(absolutePath, getOutputDir(absolutePath));
});

// ==========================================
// PowerPoint Action Handlers
// ==========================================
ipcMain.handle("save-notes", async (_, filePath: string, slides: SlideManifestEntry[]) => {
  const absolutePath = path.resolve(filePath);
  if (!fs.existsSync(absolutePath)) return { success: false, message: "File not found" };
  return getActiveCoreProvider().saveNotes(absolutePath, slides);
});

ipcMain.handle("insert-audio", async (_, filePath: string, slidesAudio: SlideAudioEntry[]) => {
  const absolutePath = path.resolve(filePath);
  if (!fs.existsSync(absolutePath)) return { success: false, message: "File not found" };
  return getActiveCoreProvider().insertAudio(absolutePath, slidesAudio);
});

ipcMain.handle("remove-audio", async (_, { filePath, slideIndices }: RemoveAudioRequest) => {
  const absolutePath = path.resolve(filePath);
  if (!fs.existsSync(absolutePath)) return { success: false, message: "File not found" };
  return getActiveCoreProvider().removeAudio(absolutePath, slideIndices);
});

ipcMain.handle("play-slide", async (_, { filePath, slideIndex }: PlaySlideRequest) => {
  if (!nativeProvider) {
    return { success: false, message: "playSlide not supported on this platform" };
  }

  const absolutePath = path.resolve(filePath);
  return nativeProvider.playSlide(absolutePath, slideIndex);
});

ipcMain.handle("reload-slide", async (_, { filePath, slideIndex }: ReloadSlideRequest) => {
  const absolutePath = path.resolve(filePath);
  const outputDir = getOutputDir(absolutePath);

  if (!fs.existsSync(outputDir)) {
    return { success: false, message: "Conversion directory not found. Please sync all first." };
  }
  return getActiveCoreProvider().reloadSlide(absolutePath, slideIndex, outputDir);
});

ipcMain.handle("generate-video", async (_, { filePath, videoOutputPath }: GenerateVideoRequest) => {
  if (!nativeProvider) {
    return { success: false, message: "generateVideo not supported on this platform" };
  }

  if (!videoOutputPath) return { success: false, message: "No output path provided." };
  const absolutePath = path.resolve(filePath);
  return nativeProvider.generateVideo(absolutePath, videoOutputPath);
});

// ==========================================
// Settings Handlers
// ==========================================
ipcMain.handle("get-tts-provider", async () => {
  return process.env.TTS_PROVIDER ?? "gcp";
});

ipcMain.handle("get-speaker-mappings", async () => {
  return store.get("speakerMappings") || {};
});

ipcMain.handle("set-speaker-mappings", async (_, mappings) => {
  store.set("speakerMappings", mappings);
  return { success: true };
});

ipcMain.handle("get-gcp-key-path", async () => {
  return store.get("gcpKeyPath");
});

ipcMain.handle("set-gcp-key", async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    properties: ["openFile"],
    filters: [{ name: "JSON", extensions: ["json"] }],
  });

  if (canceled || filePaths.length === 0) {
    return { success: false, message: "No file selected" };
  }

  const keyPath = filePaths[0];

  // Basic validation
  try {
    const content = JSON.parse(fs.readFileSync(keyPath, "utf8"));
    if (!content.type || content.type !== "service_account") {
      return { success: false, message: "Invalid Service Account Key JSON" };
    }
  } catch (err: unknown) {
    if (err instanceof SyntaxError) {
      return { success: false, message: "Invalid JSON file" };
    }

    return { success: false, message: "Error reading file" };
  }

  store.set("gcpKeyPath", keyPath);
  return { success: true, path: keyPath };
});

ipcMain.handle("get-xml-cli-enabled", async () => {
  return store.get("xmlCliEnabled") || false;
});

ipcMain.handle("set-xml-cli-enabled", async (_, enabled) => {
  store.set("xmlCliEnabled", enabled);
  return { success: true };
});

// ==========================================
// TTS Handlers
// ==========================================
ipcMain.handle("get-voices", async () => {
  return ttsManager.getVoices();
});

ipcMain.handle("generate-speech", async (_, { text, voiceOption }) => {
  return ttsManager.generateSpeech(text, voiceOption);
});
