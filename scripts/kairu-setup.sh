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

# Check Node
if ! command -v node &>/dev/null; then
  echo "✖ Node.js not found. Install from https://nodejs.org"
  exit 1
fi
echo "✓ node $(node --version)"
echo ""

# VS Code's .npmrc sets ignore-scripts=false and runtime=electron
# which causes postinstall to try to compile native Electron modules.
# Override with env vars so we get a clean Node-only install.
echo "▶ Installing node modules..."
npm_config_ignore_scripts=true \
npm_config_runtime=node \
npm_config_build_from_source=false \
  npm install --quiet 2>&1 | grep -iE "^npm (ERR|error)" | head -20 || true
echo "  done"
echo ""

# Compile all bundled extensions (typescript, git, json, markdown, etc.)
echo "▶ Compiling bundled extensions (~3–5 min first run)..."
node_modules/.bin/gulp compile-extensions 2>&1 | grep -E "Finished|✓|error" | head -40 || \
  npm run gulp compile-extensions 2>&1 | grep -E "Finished|✓|error" | head -40 || true
echo ""

# Compile Kairu extensions
echo "▶ Compiling Kairu extensions..."
KAIRU_EXTS=(kairu-ai kairu-foundry kairu-security kairu-chain kairu-dashboard kairu-web3-tools kairu-snippets)
ALL_OK=true
for ext in "${KAIRU_EXTS[@]}"; do
  dir="extensions/$ext"
  if [ -f "$dir/tsconfig.json" ]; then
    printf "  %-34s" "$ext"
    if npx tsc -p "$dir/tsconfig.json" 2>/dev/null; then
      echo "✓"
    else
      echo "✖"
      ALL_OK=false
    fi
  fi
done

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
if $ALL_OK; then
  echo "  ✓ Setup complete. Launch with: ./scripts/code.sh"
else
  echo "  ⚠ Some extensions failed. Try:"
  echo "    xcode-select --install   (installs macOS build tools)"
  echo "    then re-run: ./scripts/kairu-setup.sh"
fi
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
