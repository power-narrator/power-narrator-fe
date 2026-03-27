# Slide Voice App - Agent Guide

Slide Voice App is a desktop tool that edits PowerPoint slide notes, generates TTS audio, and embeds the audio back into `.pptx` files.

Package manager: `uv`

Common commands

```bash
# Run (dev)
uv run scripts/run.py

# Build (dist/)
uv run scripts/build.py

# Manual compile Qt resources and QML module artifacts
# Default build/run scripts do this automatically
uv run scripts/utils.py

# Tests
uv run pytest

# Lint / format
uv run ruff check --select I --fix .
uv run ruff format .

# Typecheck
uv run ty check .
```
Project structure: docs/agents/project-structure.md
Python guidelines: docs/agents/python.md
PySide guidelines: docs/agents/pyside.md
Documentation: docs/agents/documentation.md
