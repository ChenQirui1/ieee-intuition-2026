#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

if [[ ! -d ".venv" ]]; then
  echo "Error: virtual environment not found at $SCRIPT_DIR/.venv"
  echo "Create it first: python -m venv .venv"
  exit 1
fi

if [[ -f ".venv/bin/activate" ]]; then
  # Linux/macOS/WSL
  # shellcheck disable=SC1091
  source ".venv/bin/activate"
elif [[ -f ".venv/Scripts/activate" ]]; then
  # Git Bash on Windows
  # shellcheck disable=SC1091
  source ".venv/Scripts/activate"
else
  echo "Error: could not find an activation script in .venv"
  exit 1
fi

HOST="${HOST:-0.0.0.0}"
PORT="${PORT:-8000}"

echo "Starting FastAPI server on http://$HOST:$PORT"
exec python -m uvicorn main:app --host "$HOST" --port "$PORT" --reload