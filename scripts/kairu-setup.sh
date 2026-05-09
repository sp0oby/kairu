#!/usr/bin/env bash
# Kairu Studio — first-time setup after git clone
# Run this once on each machine after cloning.
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT"

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Kairu Studio — setup"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# 1. Check prerequisites
check_prereq() {
  if ! command -v "$1" &>/dev/null; then
    echo "  ✖ $1 not found — $2"
    return 1
  fi
  echo "  ✓ $1 $(\"$1\" --version 2>&1 | head -1)"
}

echo "▶ Checking prerequisites..."
check_prereq node   "install from https://nodejs.org" || { echo ""; echo "Install Node.js 18+ and re-run."; exit 1; }
check_prereq python3 "install Xcode CLT: xcode-select --install" || true
echo ""

# 2. Install root node_modules
# Use --ignore-scripts to skip VS Code's postinstall (downloads Electron, builds native modules).
# The postinstall is only needed when building a distributable — not for running from source.
echo "▶ Installing node modules (skipping postinstall)..."
npm install --ignore-scripts --quiet 2>&1 | grep -E "error|warn" | grep -v "deprecated" || true

# Now run the subset of postinstall that matters: install deps for the build/ folder
if [ -f "build/package.json" ] && [ ! -d "build/node_modules" ]; then
  echo "  Installing build/ dependencies..."
  (cd build && npm install --quiet 2>/dev/null) || true
fi

echo ""

# 3. Compile bundled extensions via gulp
echo "▶ Compiling bundled extensions (~3–5 min on first run)..."
if node_modules/.bin/gulp --version &>/dev/null 2>&1; then
  node_modules/.bin/gulp compile-extensions 2>&1 | grep -E "Finished|Error|✓|✖" || true
else
  echo "  gulp not found — trying npm run gulp..."
  npm run gulp compile-extensions 2>&1 | grep -E "Finished|Error|✓|✖" || true
fi

echo ""

# 4. Compile Kairu extensions
echo "▶ Compiling Kairu extensions..."
KAIRU_EXTS=(kairu-ai kairu-foundry kairu-security kairu-chain kairu-dashboard kairu-web3-tools kairu-snippets)
for ext in "${KAIRU_EXTS[@]}"; do
  dir="extensions/$ext"
  if [ -f "$dir/tsconfig.json" ]; then
    printf "  %-34s" "$ext"
    if npx tsc -p "$dir/tsconfig.json" 2>/dev/null; then
      echo "✓"
    else
      echo "✖  (run: npx tsc -p $dir/tsconfig.json)"
    fi
  fi
done

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Done. Launch Kairu with:"
echo ""
echo "    ./scripts/code.sh"
echo ""
echo "  If bundled extensions still don't work, you may need:"
echo "    xcode-select --install   (macOS build tools)"
echo "    npm install              (full install with postinstall)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
