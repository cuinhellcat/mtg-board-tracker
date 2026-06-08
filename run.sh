#!/usr/bin/env bash
# Linux/macOS launcher for the MTG Board State Tracker.
#
# Creates a virtualenv OUTSIDE this folder (OneDrive can't hold the venv's
# symlinks), installs dependencies on first run, then starts the app.
# Re-run any time; setup is skipped once the venv exists.
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VENV_DIR="${MTG_VENV:-$HOME/.venvs/mtg-board-tracker}"

if [ ! -x "$VENV_DIR/bin/python" ]; then
  echo "Creating virtualenv at $VENV_DIR ..."
  python3 -m venv "$VENV_DIR"
  "$VENV_DIR/bin/python" -m pip install --upgrade pip
  "$VENV_DIR/bin/pip" install -r "$PROJECT_DIR/requirements.txt"
fi

cd "$PROJECT_DIR"
exec "$VENV_DIR/bin/python" start.py
