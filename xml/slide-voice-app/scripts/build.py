import argparse
import subprocess
import sys
from pathlib import Path

from utils import (
    BASE_DIR,
    PKG_DIR,
    compile_resources,
    generate_qml_module_artifacts,
)


def build_parser() -> argparse.ArgumentParser:
    """Create the command-line argument parser."""
    parser = argparse.ArgumentParser(description="Build Slide Voice App targets.")
    parser.add_argument(
        "target",
        nargs="?",
        choices=("app", "pptx"),
        default="app",
        help="Build target to compile (default: app)",
    )
    return parser


def _build_args(target: str) -> list[str | Path]:
    """Return the Nuitka command arguments for the selected target."""
    args: list[str | Path] = [
        "uv",
        "run",
        "python",
        "-m",
        "nuitka",
        f"--output-dir={BASE_DIR / 'dist'}",
        "--include-data-files=src/slide_voice_pptx/resources/narration-icon.png=slide_voice_pptx/resources/narration-icon.png",
        f"--output-filename=slide-voice-{target}",
    ]

    if target == "app":
        return [
            *args,
            "--enable-plugin=pyside6",
            "--include-qt-plugins=qml,multimedia",
            "--mode=app",
            PKG_DIR,
        ]

    return [
        *args,
        "--mode=onefile",
        BASE_DIR / "src" / "slide_voice_pptx",
    ]


def run_build(target: str = "app"):
    """Build the selected target using Nuitka."""
    if target == "app":
        generate_qml_module_artifacts()
        compile_resources()

    try:
        _ = subprocess.run(_build_args(target), check=True)
    except subprocess.CalledProcessError as e:
        print(f"Nuitka build failed: {e}")
        sys.exit(1)


if __name__ == "__main__":
    args = build_parser().parse_args()
    run_build(args.target)
