#!/bin/bash
# TUI launcher для AI-Agent
# Запуск: bash src/tui/run.sh [session-id]

cd "$(dirname "$0")/../.."

if [ -n "$1" ]; then
  npx tsx src/tui/index-run.ts "$1"
else
  npx tsx src/tui/index-run.ts
fi
