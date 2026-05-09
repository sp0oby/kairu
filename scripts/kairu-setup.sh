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

# 1. Node modules
echo "▶ Installing node modules..."
npm install --quiet

# 2. Compile all bundled extensions (typescript-language-features, git, json, etc.)
echo ""
echo "▶ Compiling bundled extensions (this takes ~3–5 min on first run)..."
npm run gulp compile-extensions 2>&1 | grep -E "Finished|Error|error TS" || true

# 3. Compile Kairu extensions
echo ""
echo "▶ Compiling Kairu extensions..."
for ext in kairu-ai kairu-foundry kairu-security kairu-chain kairu-dashboard kairu-web3-tools kairu-snippets; do
  dir="extensions/$ext"
  if [ -f "$dir/tsconfig.json" ]; then
    printf "  %-30s" "$ext"
    if npx tsc -p "$dir/tsconfig.json" 2>/dev/null; then
      echo "✓"
    else
      echo "✖ (check $dir for errors)"
    fi
  fi
done

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Done. Launch with:  ./scripts/code.sh"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
