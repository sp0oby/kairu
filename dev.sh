#!/usr/bin/env bash
# Kairu Studio development launcher
# Wraps the required env vars for building/running on Node 22.x

export VSCODE_SKIP_NODE_VERSION_CHECK=1
export NODE_OPTIONS="--experimental-strip-types --no-warnings=ExperimentalWarning"

case "$1" in
  run)
    exec VSCODE_SKIP_PRELAUNCH=1 ./scripts/code.sh "${@:2}"
    ;;
  build)
    exec npm run gulp vscode-darwin-arm64 "${@:2}"
    ;;
  compile)
    exec npm run compile "${@:2}"
    ;;
  watch)
    exec npm run watch "${@:2}"
    ;;
  install)
    exec npm install "${@:2}"
    ;;
  *)
    echo "Usage: ./dev.sh [run|build|compile|watch|install]"
    echo ""
    echo "  run      - Launch IDE in development mode"
    echo "  build    - Build macOS .app bundle (arm64)"
    echo "  compile  - One-time TypeScript compile"
    echo "  watch    - Watch mode for development"
    echo "  install  - Install dependencies"
    ;;
esac
