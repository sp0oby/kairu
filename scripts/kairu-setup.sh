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

if ! command -v node &>/dev/null; then
  echo "✖ Node.js not found. Install from https://nodejs.org"
  exit 1
fi
echo "✓ node $(node --version)"
echo ""

# Install root deps WITHOUT VS Code's postinstall (which breaks on fresh Macs
# because it tries to compile Electron-specific native modules).
echo "▶ Installing root node modules (skipping electron postinstall)..."
npm_config_ignore_scripts=true \
npm_config_runtime=node \
npm_config_build_from_source=false \
  npm install --quiet --no-audit --no-fund 2>&1 | grep -iE "^npm (ERR|error)" | head -10 || true
echo "  done"
echo ""

# Install per-extension deps so bundled extensions (prettier, eslint, solidity,
# editorconfig, etc.) can actually load. Each gets its own --ignore-scripts pass.
echo "▶ Installing dependencies for bundled extensions..."
EXT_LIST=(
  prettier
  vscode-eslint/client
  vscode-eslint/server
  editorconfig
  solidity
  tailwindcss
)
for ext_path in "${EXT_LIST[@]}"; do
  dir="extensions/$ext_path"
  if [ -f "$dir/package.json" ] && [ ! -d "$dir/node_modules" ]; then
    printf "  %-32s" "$ext_path"
    if (cd "$dir" && npm_config_ignore_scripts=true npm install --quiet --no-audit --no-fund 2>&1 | tail -3 >/dev/null); then
      echo "✓"
    else
      echo "✖ (skipped — non-critical)"
    fi
  elif [ -d "$dir/node_modules" ]; then
    printf "  %-32s already installed\n" "$ext_path"
  fi
done
echo ""

# Compile bundled extensions (typescript-language-features, json, markdown, etc.)
echo "▶ Compiling bundled extensions (~3–5 min first run)..."
if [ -x "node_modules/.bin/gulp" ]; then
  node_modules/.bin/gulp compile-extensions 2>&1 | grep -E "Finished|✓|error" | head -40 || true
else
  npm run gulp compile-extensions 2>&1 | grep -E "Finished|✓|error" | head -40 || true
fi
echo ""

# Compile Kairu extensions
echo "▶ Compiling Kairu extensions..."
KAIRU_EXTS=(kairu-ai kairu-foundry kairu-security kairu-chain kairu-dashboard kairu-web3-tools kairu-snippets)
ALL_OK=true
for ext in "${KAIRU_EXTS[@]}"; do
  dir="extensions/$ext"
  if [ -f "$dir/tsconfig.json" ]; then
    printf "  %-32s" "$ext"
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
  echo "  ✓ Setup complete. Launch with:"
  echo ""
  echo "      ./scripts/code.sh"
else
  echo "  ⚠ Some Kairu extensions failed to compile."
  echo "    Try: xcode-select --install"
  echo "    Then re-run: ./scripts/kairu-setup.sh"
fi
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
