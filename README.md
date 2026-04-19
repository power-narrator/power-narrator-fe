# Power Narrator & Video Generator

An Electron-based desktop application for macOS that converts PowerPoint presentations into narrated MP4 videos. It extracts slide images and speaker notes, generates AI text-to-speech audio per slide, inserts that audio back into the `.pptx` file, and exports the result as a video — all from one UI.

---

## Architecture Overview

The application is split into three layers:

```
┌─────────────────────────────────────────┐
│           React Frontend (Vite)         │  ← src/
│  ViewerPage · SettingsModal · LandingPage│
└────────────────┬────────────────────────┘
                 │  Electron IPC (ipcRenderer / ipcMain)
┌────────────────▼────────────────────────┐
│           Electron Main Process         │  ← electron/main.ts
│   IPC Handlers · TtsManager · Store     │
└──────┬─────────────────────┬────────────┘
       │                     │
┌──────▼──────┐     ┌────────▼────────────┐
│ PptProvider │     │    TtsProvider       │
│  (Platform) │     │  (TTS Backend)       │
└──────┬──────┘     └────────┬────────────┘
       │                     │
  ┌────▼──────────┐    ┌─────▼────────────┐
  │ MacPptProvider│    │ GcpTtsProvider   │
  │ (AppleScript) │    │ LocalTtsProvider │
  └──────┬────────┘    └──────────────────┘
         │
  ┌──────▼────────┐
  │XmlPptProvider │  ← Decorator over MacPptProvider
  │ (XML CLI)     │      uses slide-voice-pptx binary
  └───────────────┘
```

### Key Design Patterns

- **Provider Pattern** — `PptProvider` is an interface with two implementations:
  - `MacPptProvider` — drives PowerPoint directly via AppleScript (`osascript`) and VBA macros (`.ppam` add-in).
  - `XmlPptProvider` — a **Decorator** that wraps any `PptProvider`. Instead of VBA macros, it calls a bundled Python CLI (`slide-voice-pptx`) that directly manipulates the `.pptx` XML. It closes and reopens the presentation around each CLI invocation.
- **Strategy Pattern** — `TtsProvider` is an interface with `GcpTtsProvider` and `LocalTtsProvider` implementations. `TtsManager` selects the active provider at startup and handles persistent audio caching.

---

## Data Flow

### Load & Convert

```
User selects .pptx
  → IPC: convert-pptx
    → MacPptProvider.convertPptx()
      → convert-pptx.applescript
        → PowerPoint exports slide images + manifest.json
    → Returns: slides[] with { index, src (image path), notes }
```

### Generate & Insert Audio (per slide or all)

```
User clicks "Insert Audio"
  → Frontend: getAudioBuffer(notes text)
    → tts.ts: splits text on [speaker] tags into segments
      → IPC: generate-speech { text, voiceOption }
        → TtsManager → GcpTtsProvider or LocalTtsProvider
        → TTS audio cached to disk (SHA-256 hash key)
    → Segments concatenated into final MP3 buffer
  → IPC: insert-audio { filePath, slidesAudio[] }
    → MacPptProvider: writes MP3 to Office temp dir → VBA macro InsertAudio
    → XmlPptProvider: writes MP3 to temp dir → slide-voice-pptx CLI (save_audio_for_slide op)
```

### Generate Video

```
User clicks "Generate Video"
  → Auto-save notes to .pptx (save-all-notes)
  → Generate audio for all slides (same as above)
  → IPC: generate-video
    → insert-audio (all slides)
    → export-to-video.applescript → PowerPoint exports MP4
```

### Reload Slide / Sync All

```
Reload Slide  → active provider reloads the slide image and notes
Sync All      → full convert-pptx re-run, resets all slide state
```

---

## Features

### Presentation Viewer

- Load any `.pptx` file and display all slides as images
- Resizable split-pane layout (slide image / notes editor)
- Navigate slides via a scrollable sidebar

### Speaker Notes Editor

- Edit speaker notes per slide directly in the UI
- **Multi-section notes** — split a slide's notes into multiple sections separated by `---`
- **Multi-speaker support** — tag each section with a `[SpeakerName]` label to assign different voices
- Inline SSML tag toolbar for `<break>`, `<say-as>`, `<emphasis>`, `<p>`, and custom `<break time="..."/>` tags
- Undo / redo via the notes editor toolbar or `Cmd/Ctrl+Z` and `Cmd/Ctrl+Y`
- Save notes for a single slide or all slides back to the `.pptx`

### Text-to-Speech (TTS)

- **Google Cloud TTS** (default) — uses Chirp 3 HD voices for high-quality narration
- **Local TTS** (offline fallback) — uses a self-hosted [Mycroft Mimic 3](https://github.com/MycroftAI/mimic3) server
- Per-section voice preview with inline audio player and seek bar
- Preview a text selection only by highlighting it before clicking play
- Persistent audio cache (SHA-256 keyed, stored in Electron `userData`)

### Multi-Speaker Mapping

- Configure named speaker aliases (e.g. `[Alice]`, `[Bob]`) in Settings
- Assign any available TTS voice to each alias
- Speaker tags in notes automatically route each section to the correct voice

### Audio Management

- Insert generated audio into the `.pptx` for a single slide or all slides
- Remove audio from a single slide or the entire presentation
- Audio insertion supports multiple sections per slide (segments stored as `ppt_audio_1.mp3`, `ppt_audio_2.mp3`, …)

### Video Export

- Auto-saves notes, generates audio for all slides, inserts it, then triggers PowerPoint's built-in video export
- Output: MP4 with fully synchronized narration
- User selects the output save path before generation begins

### Slide Sync

- **Reload Slide** — re-exports a single slide's image and notes from the live `.pptx` (picks up edits made in PowerPoint)
- **Sync All** — full re-conversion of the entire presentation

### XML CLI Mode (Advanced)

- Toggle in Settings to use the bundled XML CLI instead of VBA macros for supported PPTX operations
- Supports: insert audio, remove audio, update notes, query slide data
- Slide image export and video generation still rely on the native PowerPoint provider
- The presentation is automatically closed before and reopened after each CLI operation when a native provider is active

### Settings

- Select GCP Service Account JSON key via file picker (stored securely in Electron Store)
- Configure speaker alias → voice mappings
- Toggle XML CLI mode on/off

---

## Project Structure

```
electron/
  main.ts               # IPC handler registration, provider & TTS manager setup
  preload.cts           # Context bridge (electronAPI)
  platform/
    PptProvider.ts      # Interface definition
    MacPptProvider.ts   # AppleScript integration + VBA-backed edit operations
    XmlPptProvider.ts   # XML CLI decorator implementation
    WindowsPptProvider.ts
  tts/
    TtsProvider.ts      # Interface definition
    TtsManager.ts       # Provider registry + disk cache
    GcpTtsProvider.ts   # Google Cloud TTS
    LocalTtsProvider.ts # Mimic 3 local server integration
    SsmlUtil.ts         # SSML formatting helpers
  scripts/
    convert-pptx.applescript
    close-presentation.applescript
    export-to-video.applescript
    play-slide.applescript # Pure AppleScript slideshow start/jump
    reopen-presentation.applescript
    trigger-macro.applescript
    ppt-tools.bas       # VBA macros: InsertAudio, RemoveAudio, UpdateNotes
    ppt-tools.ppam      # Compiled PowerPoint add-in
    power-narrator-cli  # Bundled XML CLI binary

src/
  components/
    LandingPage.tsx     # File picker entry screen
    settings/
      SettingsModal.tsx # GCP key, speaker mappings, XML CLI toggle
      VoiceSelector.tsx # Voice dropdown component
    viewer/
      ViewerPage.tsx    # Main UI: slide viewer, notes editor, toolbar
  utils/
    notes.ts            # Split/join multi-section speaker notes
    tts/
      index.ts          # Frontend TTS orchestration and caching
      ttsParse.ts       # Speaker-tag parsing

python-xml-main/        # XML CLI source and related docs
```

---

## Setup

### Prerequisites

- **macOS** (required — AppleScript automation)
- **Node.js** current LTS
- **Microsoft PowerPoint** (desktop, licensed)
- **Docker Desktop** — only for local TTS mode

### Install & Run

```bash
git clone git@github.com:power-narrator/power-narrator-fe.git
cd power-narrator-fe
npm install
npm run dev
```

---

## Configuration

### Option 1 — Google Cloud TTS (Recommended)

1. Create a GCP Service Account and download its JSON key.
2. Open the app → click the **Settings (⚙)** icon → **Select Key File...**.
3. The app stores the path and uses it whenever GCP is selected for TTS.

### Option 2 — Local TTS (Offline)

Start the Mimic 3 Docker container:

```bash
docker run -it --user root -p 59125:59125 mycroftai/mimic3
```

Create a `.env` file from `.env.example`, then set:

```
TTS_PROVIDER=local
LOCAL_TTS_URL=http://localhost:59125/api/tts
LOCAL_TTS_VOICE=en_UK/apope_low
```

### Option 3 — PowerPoint Add-in (PPAM)

For reliable VBA macro execution:

1. Open PowerPoint → **Tools** → **PowerPoint Add-ins…**
2. Click **+** and navigate to `electron/scripts/ppt-tools.ppam`.
3. Allow macro execution when prompted.

---

## Troubleshooting

### macOS Gatekeeper Warning

```bash
xattr -cr "/path/to/Power Narrator.app"
```

Or right-click the app → **Open** → **Open**.

### Local TTS Returns 500

- Ensure the Docker container is running on port `59125`.
- Check that `LOCAL_TTS_VOICE` in `.env` is a valid installed Mimic3 voice (e.g. `en_UK/apope_low`). The value `default` is a UI placeholder and is automatically resolved to the env var fallback.
