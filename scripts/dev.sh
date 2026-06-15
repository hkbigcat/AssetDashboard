#!/usr/bin/env bash
# macOS / Linux — install deps and start backend + frontend
set -e
cd "$(dirname "$0")/.."

echo "Installing dependencies..."
npm run install:all

if [ ! -f server/.env ]; then
  echo "Creating server/.env from example..."
  cp server/.env.example server/.env
fi

echo "Starting dashboard (Ctrl+C to stop)..."
npm run dev