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
Reload Slide  → reload-slide.applescript → re-exports single slide image + notes
Sync All      → full convert-pptx re-run, resets all slide state
```

### Note Normalization & Parsing
To ensure reliable cross-platform compatibility and prevent formatting loss during the round-trip between Electron and PowerPoint, the application implements a robust normalization pipeline:

1. **Line Break Unification**: PowerPoint on macOS can inject various line-ending characters (e.g., `\r`, `\r\n`, `\u2028`, `\u2029`). The parser first normalizes all variations into standard `\n` to ensure regex consistency.
2. **Whitespace Preservation**: The parser avoids aggressive trimming. It only strips horizontal whitespace around tags (`[Speaker]`) and dividers (`---`), preserving all intentional vertical spacing and indentation within the content.
3. **Robust Section Splitting**: Uses advanced regex to identify section dividers regardless of surrounding whitespace or newline variations, preventing issues where sections might fail to split due to hidden PowerPoint formatting.
4. **Speaker Inheritance**: Implements a "sticky" fallback logic (`getEffectiveSpeaker`) that resolves the active voice for sections without explicit tags by searching backwards through the slide's history.

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
- **Speaker Inheritance** — sections without an explicit tag (or set to "Default") automatically inherit the voice from the most recently specified section on the slide
- **"Previous" Speaker** — use the "Previous" option in the speaker dropdown to explicitly inherit the preceding section's voice
- **Advanced SSML Toolbar** — insert tags at the cursor for:
    - `<break time="..."/>` with common presets and custom duration support
    - `<say-as interpret-as="...">` for spell-out, cardinal/ordinal numbers, digits, fractions, and expletives
    - `<emphasis level="...">` with strong, moderate, and reduced levels
    - `<p>` paragraph tags for structured narration
- **Undo / Redo History** — complete history for note edits with multi-level undo/redo (`Cmd+Z` / `Cmd+Y` or toolbar buttons)
- Save notes for a single slide or all slides back to the `.pptx`

### Text-to-Speech (TTS)
- **Google Cloud TTS** (default) — uses Chirp 3 HD voices for high-quality narration
- **Local TTS** (offline fallback) — uses a self-hosted [Mycroft Mimic 3](https://github.com/MycroftAI/mimic3) server
- **Enhanced Preview Buttons** — per-section voice preview with smart highlighting:
    - **Smart Highlighting**: Only the active/effective voice button is highlighted (even when inherited).
    - **Recently Played Indicator**: The play button icon changes to a history icon (`IconHistory`) for the most recently tested voice in each section.
- **Selection Playback** — highlight any subset of text in the editor before clicking a preview button to narrate only that specific selection
- **Audio Orchestration** — maintains a global audio context; starting a new preview or slide-playback automatically stops any existing audio to prevent overlapping
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
- **Automatic Focus Restoration** — provides a seamless UX by automatically returning focus to the Power Narrator window after background PowerPoint operations (like video export or audio insertion) complete

### XML CLI Mode (Advanced)
- Toggle in Settings to use the `slide-voice-pptx` Python CLI instead of VBA macros
- Supports: insert audio, remove audio, update notes, query slide data
- The presentation is automatically closed before and reopened after each CLI operation

### Settings
- Select GCP Service Account JSON key via file picker (stored securely in Electron Store)
- Configure speaker alias → voice mappings
- Toggle XML CLI mode on/off

---

## Project Structure

```
electron/
  main.ts               # IPC handler registration, provider & TTS manager setup
  preload.ts            # Context bridge (electronAPI)
  platform/
    PptProvider.ts      # Interface definition
    MacPptProvider.ts   # AppleScript + VBA macro implementation
    XmlPptProvider.ts   # XML CLI decorator implementation
    WindowsPptProvider.ts
  tts/
    TtsProvider.ts      # Interface definition
    TtsManager.ts       # Provider registry + disk cache
    GcpTtsProvider.ts   # Google Cloud TTS
    LocalTtsProvider.ts # Mimic3 / Larynx local server
    SsmlUtil.ts         # SSML formatting helpers
  scripts/
    convert-pptx.applescript
    reload-slide.applescript
    export-to-video.applescript
    play-slide.applescript
    trigger-macro.applescript
    ppt-tools.bas       # VBA macros: InsertAudio, RemoveAudio, UpdateNotes
    ppt-tools.ppam      # Compiled PowerPoint add-in
    xml-cli/            # Bundled slide-voice-pptx binary (packaged app)

src/
  components/
    ViewerPage.tsx      # Main UI: slide viewer, notes editor, toolbar
    SettingsModal.tsx   # GCP key, speaker mappings, XML CLI toggle
    LandingPage.tsx     # File picker entry screen
    VoiceSelector.tsx   # Voice dropdown component
  utils/
    tts.ts              # Frontend: speaker-tag parsing, audio segment assembly, IPC calls

xml/
  slide-voice-app/      # Python source for the XML CLI (development)
```

---

## Setup

### Prerequisites
- **macOS** (required — AppleScript automation)
- **Node.js** v16+
- **Microsoft PowerPoint** (desktop, licensed)
- **Docker Desktop** — only for local TTS mode

### Install & Run

```bash
git clone https://github.com/NorbertLoh/power-narrator.git
cd power-narrator
npm install
npm run dev
```

---

## Configuration

### Option 1 — Google Cloud TTS (Recommended)
1. Create a GCP Service Account and download its JSON key.
2. Open the app → click the **Settings (⚙)** icon → **Select JSON Key**.
3. The app stores the path and switches to GCP automatically.

### Option 2 — Local TTS (Offline)
Start the Mimic 3 Docker container:
```bash
docker run -it --user root -p 59125:59125 mycroftai/mimic3
```
Set in `.env`:
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
