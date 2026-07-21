#!/usr/bin/env bash
#
# uninstall.sh — Remove Marvin application.
#
# Usage: bash uninstall.sh [--keep-config]
#
# Options:
#   --keep-config   Keep ~/.marvin (your config and agents) instead of removing it.

set -euo pipefail

# ── Configuration ────────────────────────────────────────────────────────────
INSTALL_DIR="$HOME/.local/share/marvin"
SYMLINK_PATH="/usr/local/bin/marvin"
MARVIN_DIR="$HOME/.marvin"

# ── Helpers ──────────────────────────────────────────────────────────────────
info()  { echo "$*"; }
warn()  { echo "WARNING: $*" >&2; }
error() { echo "ERROR: $*" >&2; exit 1; }

# ── Parse arguments ──────────────────────────────────────────────────────────
KEEP_CONFIG=false
for arg in "$@"; do
  case "$arg" in
    --keep-config) KEEP_CONFIG=true ;;
    *) error "Unknown argument: $arg" ;;
  esac
done

# ── Step 1: Remove the shell wrapper symlink ──────────────────────────────────
info "Removing symlink at $SYMLINK_PATH..."

if [ -L "$SYMLINK_PATH" ]; then
  rm -f "$SYMLINK_PATH"
  info "  Symlink removed."
elif [ -f "$SYMLINK_PATH" ]; then
  warn "  $SYMLINK_PATH exists but is not a symlink. Skipping."
else
  info "  Symlink not found (already removed)."
fi

# ── Step 2: Remove the installed application directory ────────────────────────
info "Removing install directory $INSTALL_DIR..."

if [ -d "$INSTALL_DIR" ]; then
  rm -rf "$INSTALL_DIR"
  info "  Install directory removed."
else
  info "  Install directory not found (already removed)."
fi

# ── Step 3: Remove (or keep) workspace directory ─────────────────────────────
info "Handling workspace directory $MARVIN_DIR..."

if [ -d "$MARVIN_DIR" ]; then
  if [ "$KEEP_CONFIG" = true ]; then
    info "  Keeping $MARVIN_DIR (--keep-config)."
  else
    rm -rf "$MARVIN_DIR"
    info "  Workspace directory removed."
  fi
else
  info "  Workspace directory not found (already removed)."
fi

# ── Done ─────────────────────────────────────────────────────────────────────
echo ""
info "Marvin uninstalled successfully!"
echo ""
echo "  Removed: $SYMLINK_PATH (symlink)"
echo "  Removed: $INSTALL_DIR (install directory)"
if [ "$KEEP_CONFIG" = false ]; then
  echo "  Removed: $MARVIN_DIR (workspace)"
else
  echo "  Kept:    $MARVIN_DIR (workspace)"
fi
echo ""
echo "Optional: remove Bun from your shell profile."
echo "  1. Remove these lines from ~/.bashrc and ~/.zshrc:"
echo "       export BUN_INSTALL=\"\${HOME}/.bun\""
echo "       export PATH=\"\$BUN_INSTALL/bin:\$PATH\""
echo "  2. Run: source ~/.bashrc  (or ~/.zshrc)"
echo ""
