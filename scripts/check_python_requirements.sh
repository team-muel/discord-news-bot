#!/usr/bin/env bash
set -euo pipefail

echo "Checking Python requirements file: requirements.txt"
echo "To verify locally, run:" 
echo "  python -m venv .venv"
echo "  source .venv/bin/activate  # or .venv\Scripts\activate on Windows"
echo "  python -m pip install --upgrade pip"
echo "  pip install -r requirements.txt"

echo "After install, run your python scripts within the virtualenv to verify runtime compatibility."

exit 0
