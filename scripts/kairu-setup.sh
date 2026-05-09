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

# Auto-discover any extension that has its own package.json with dependencies
# but no node_modules folder yet, and install them. This way new extensions are
# picked up automatically — no need to maintain a hardcoded list.
echo "▶ Installing dependencies for bundled extensions (auto-discovered)..."
COUNT=0
SKIPPED=0
while IFS= read -r pkg; do
  dir="$(dirname "$pkg")"
  # Skip if no deps declared, or node_modules already exists
  has_deps=$(node -p "Object.keys((require('./$pkg').dependencies||{})).length+Object.keys((require('./$pkg').optionalDependencies||{})).length" 2>/dev/null || echo "0")
  [ "$has_deps" = "0" ] && continue
  [ -d "$dir/node_modules" ] && continue
  rel="${dir#extensions/}"
  printf "  %-40s" "$rel"
  if (cd "$dir" && npm_config_ignore_scripts=true npm install --quiet --no-audit --no-fund 2>/dev/null); then
    echo "✓"
    COUNT=$((COUNT+1))
  else
    echo "✖"
    SKIPPED=$((SKIPPED+1))
  fi
done < <(find extensions -maxdepth 3 -name package.json -not -path '*/node_modules/*' -not -path '*/out/*' -not -path '*/dist/*' 2>/dev/null)
echo "  → installed $COUNT, skipped $SKIPPED"
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
