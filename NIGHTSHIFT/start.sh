#!/usr/bin/env sh
# NIGHTSHIFT server launcher for Linux / macOS.
cd "$(dirname "$0")" || exit 1

if [ -x "./runtime/node" ]; then
  NODE="./runtime/node"
elif command -v node >/dev/null 2>&1; then
  NODE="node"
else
  echo "ERROR: Node.js was not found."
  echo "Install Node.js 18 or newer (LTS) from https://nodejs.org or your package manager,"
  echo "e.g. 'sudo apt install nodejs' / 'brew install node', then run ./start.sh again."
  exit 1
fi

echo "Using Node.js $("$NODE" --version)"
exec "$NODE" server.js "$@"
