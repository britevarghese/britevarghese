#!/usr/bin/env bash
# Build the Windows installer (dist/NIGHTSHIFT_SERVER_SETUP.exe) and a portable zip
# (dist/NIGHTSHIFT_SERVER_portable.zip) on Linux/macOS.
#
# Requires: curl, unzip, zip, makensis (NSIS 3). On Debian/Ubuntu:
#   sudo apt-get install -y nsis zip unzip
#
# Env overrides:
#   NODE_VERSION=v22.x.y   pin the bundled Node.js version (default: latest v22 LTS)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DIST="$ROOT/dist"
CACHE="$DIST/cache"
STAGE="$DIST/stage"
NODE_MAJOR=22
FALLBACK_NODE_VERSION="v22.23.3"

cd "$ROOT"
mkdir -p "$CACHE"

need() { command -v "$1" >/dev/null 2>&1; }
for tool in curl unzip zip makensis; do
  if ! need "$tool"; then
    pkg="$tool"; [ "$tool" = makensis ] && pkg=nsis
    if need apt-get && [ "$(id -u)" = 0 ]; then
      echo ">> Installing $pkg ..."
      apt-get install -y "$pkg" >/dev/null || { apt-get update >/dev/null && apt-get install -y "$pkg" >/dev/null; }
    else
      echo "ERROR: '$tool' is required. Install it (Debian/Ubuntu: sudo apt-get install -y $pkg; macOS: brew install ${pkg/nsis/makensis})." >&2
      exit 1
    fi
  fi
done

CURL=(curl -fL --retry 3 --silent --show-error)
[ -f /root/.ccr/ca-bundle.crt ] && CURL+=(--cacert /root/.ccr/ca-bundle.crt)

APP_VERSION="$(node -p "require('./package.json').version" 2>/dev/null || sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' package.json | head -1)"

# ---- 1. Resolve and download Node.js win-x64 ----
if [ -z "${NODE_VERSION:-}" ]; then
  NODE_VERSION="$("${CURL[@]}" https://nodejs.org/dist/index.json 2>/dev/null \
    | grep -o "\"version\":\"v${NODE_MAJOR}\.[0-9]*\.[0-9]*\"" | head -1 | cut -d'"' -f4 || true)"
  NODE_VERSION="${NODE_VERSION:-$FALLBACK_NODE_VERSION}"
fi
NODE_ZIP="node-${NODE_VERSION}-win-x64.zip"
NODE_URL="https://nodejs.org/dist/${NODE_VERSION}/${NODE_ZIP}"
echo ">> Bundling Node.js ${NODE_VERSION} (win-x64)"

if [ ! -f "$CACHE/$NODE_ZIP" ]; then
  echo ">> Downloading $NODE_URL"
  "${CURL[@]}" -o "$CACHE/$NODE_ZIP.part" "$NODE_URL" || {
    echo "ERROR: could not download $NODE_URL (network blocked?)." >&2
    echo "Download it manually and place it at $CACHE/$NODE_ZIP, then re-run." >&2
    exit 1
  }
  mv "$CACHE/$NODE_ZIP.part" "$CACHE/$NODE_ZIP"
fi

# Verify checksum when SHASUMS are reachable.
if "${CURL[@]}" -o "$CACHE/SHASUMS256-${NODE_VERSION}.txt" "https://nodejs.org/dist/${NODE_VERSION}/SHASUMS256.txt" 2>/dev/null; then
  expected="$(grep " ${NODE_ZIP}\$" "$CACHE/SHASUMS256-${NODE_VERSION}.txt" | cut -d' ' -f1)"
  actual="$(sha256sum "$CACHE/$NODE_ZIP" 2>/dev/null | cut -d' ' -f1 || shasum -a 256 "$CACHE/$NODE_ZIP" | cut -d' ' -f1)"
  if [ -n "$expected" ] && [ "$expected" != "$actual" ]; then
    echo "ERROR: checksum mismatch for $NODE_ZIP - deleting cached copy, please re-run." >&2
    rm -f "$CACHE/$NODE_ZIP"; exit 1
  fi
  echo ">> Checksum OK"
else
  echo ">> Warning: could not fetch SHASUMS256.txt, skipping checksum verification"
fi

NODE_EXE_CACHE="$CACHE/node-${NODE_VERSION}.exe"
if [ ! -f "$NODE_EXE_CACHE" ]; then
  unzip -p "$CACHE/$NODE_ZIP" "node-${NODE_VERSION}-win-x64/node.exe" > "$NODE_EXE_CACHE.part"
  mv "$NODE_EXE_CACHE.part" "$NODE_EXE_CACHE"
fi

# ---- 2. Stage a clean copy of the distributable files ----
echo ">> Staging files into dist/stage"
rm -rf "$STAGE"
mkdir -p "$STAGE/runtime"
for f in server.js config.json package.json start.bat start.sh README.md; do
  [ -f "$f" ] && cp "$f" "$STAGE/"
done
for d in server public src docs; do
  if [ -d "$d" ]; then
    # copy while excluding junk
    (tar -cf - --exclude='node_modules' --exclude='.git' --exclude='.DS_Store' --exclude='*.log' "$d") | (cd "$STAGE" && tar -xf -)
  fi
done
for req in server.js server public src start.bat config.json package.json; do
  [ -e "$STAGE/$req" ] || { echo "ERROR: missing $req in project root" >&2; exit 1; }
done
[ -f "$STAGE/public/index.html" ] || echo ">> Warning: public/index.html is missing - the game page will not load."
cp "$NODE_EXE_CACHE" "$STAGE/runtime/node.exe"

# ---- 3. Build the NSIS installer ----
echo ">> Running makensis"
makensis -V2 \
  -DSTAGE="$STAGE" \
  -DOUTFILE="$DIST/NIGHTSHIFT_SERVER_SETUP.exe" \
  -DVERSION="$APP_VERSION" \
  "$ROOT/installer/nightshift.nsi"

# ---- 4. Portable zip ----
echo ">> Creating portable zip"
rm -f "$DIST/NIGHTSHIFT_SERVER_portable.zip"
PORT_DIR="$DIST/portable/NIGHTSHIFT Server"
rm -rf "$DIST/portable"; mkdir -p "$PORT_DIR"
cp -R "$STAGE/." "$PORT_DIR/"
(cd "$DIST/portable" && zip -qr -9 "$DIST/NIGHTSHIFT_SERVER_portable.zip" "NIGHTSHIFT Server")
rm -rf "$DIST/portable"

echo ""
echo "Done:"
ls -lh "$DIST/NIGHTSHIFT_SERVER_SETUP.exe" "$DIST/NIGHTSHIFT_SERVER_portable.zip" | awk '{print "  " $5 "  " $9}'
