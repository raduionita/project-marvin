#!/usr/bin/env bash
#
# install.sh - Install Marvin application.
#
# Usage: curl -fsSL https://github.com/<owner>/<repo>/releases/download/vX.Y.Z/install.sh | bash
#

set -euo pipefail

# ── Configuration ──────────────────────────────────────────────────────────
GITHUB_OWNER="raduionita"
GITHUB_REPO="project-marvin"
INSTALL_DIR="$HOME/.local/share/marvin"
SYMLINK_PATH="/usr/local/bin/marvin"
MARVIN_DIR="$HOME/.marvin"

# ── Helpers ────────────────────────────────────────────────────────────────
info()  { echo "[INFO] $*"; }
warn()  { echo "[WARN] $*" >&2; }
error() { echo "[ERR ] $*" >&2; exit 1; }

# ── Step 1: Check prerequisites ────────────────────────────────────────────
info "Checking prerequisites..."

if command -v curl &>/dev/null; then
  CURLORWGET="curl"
  info "Using curl"
elif command -v wget &>/dev/null; then
  CURLORWGET="wget"
  info "Using wget"
else
  error "Neither curl nor wget found. Install one and retry."
fi

if command -v bun &>/dev/null; then
  info "Bun found: $(bun --version)"
else
  info "Bun not found. Installing Bun..."
  if ! command -v curl &>/dev/null; then
    error "curl required to install Bun"
  fi
  curl -fsSL https://bun.sh/install | bash 2>&1
  BUN_INSTALL="${HOME}/.bun"
  export PATH="$BUN_INSTALL/bin:$PATH"
  export BUN_INSTALL
  for rcfile in "$HOME/.bashrc" "$HOME/.zshrc"; do
    if [ -f "$rcfile" ] && ! grep -q 'BUN_INSTALL' "$rcfile" 2>/dev/null; then
      echo '' >> "$rcfile"
      echo 'export BUN_INSTALL="${HOME}/.bun"' >> "$rcfile"
      echo 'export PATH="$BUN_INSTALL/bin:$PATH"' >> "$rcfile"
    fi
  done
  info "Bun installed. Add 'export BUN_INSTALL=\${HOME}/.bun' and 'export PATH=\$BUN_INSTALL/bin:\$PATH' to your shell profile, then restart your shell."
  info "Retrying bun check..."
  if ! command -v bun &>/dev/null; then
    error "Bun installation failed. Install it manually: https://bun.sh"
  fi
  info "Bun found: $(bun --version)"
fi

# ── Step 2: Download latest release ────────────────────────────────────────
info "Fetching latest release from GitHub..."

RELEASE_URL="https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest"
RELEASE_JSON=$(curl -fsSL "$RELEASE_URL" 2>/dev/null || echo "")

if [ -n "$RELEASE_JSON" ] && echo "$RELEASE_JSON" | grep -q '"tarball_url"'; then
  LATEST_TAG=$(echo "$RELEASE_JSON" | grep '"tag_name"' | head -1 | sed 's/.*"tag_name": "\(.*\)".*/\1/')
  info "  Release source: $RELEASE_URL"
  info "  Latest release: $LATEST_TAG"

  # https://api.github.com/repos/{owner}/{repo}/tarball/{tag}
  TARBALL_URL=$(echo "$RELEASE_JSON" | grep '"tarball_url"' | head -1 | sed 's/.*"tarball_url": "\(.*\)".*/\1/')""

  info "  Downloading $TARBALL_URL..."
  TMPFILE=$(mktemp /tmp/marvin-XXXXXXX.tar.gz)
  if [ "$CURLORWGET" = "curl" ]; then
    info "  curl -fsSL $TARBALL_URL -o $TMPFILE"
    curl -fsSL "$TARBALL_URL" -o "$TMPFILE"
  else
    info "  wget -q $TARBALL_URL -O $TMPFILE"
    wget -q "$TARBALL_URL" -O "$TMPFILE"
  fi

  info "  Extracting archive..."
  rm -rf "$INSTALL_DIR"
  mkdir -p "$INSTALL_DIR"
  tar -xzf "$TMPFILE" -C "$INSTALL_DIR" --strip-components=1
  rm -f "$TMPFILE"
  info "  Archive extracted to $INSTALL_DIR"
else
  error "No release found. This script requires a published release."
fi

# ── Step 3: Install dependencies ───────────────────────────────────────────
info "Installing dependencies..."
cd "$INSTALL_DIR"
if [ -f "bun.lock" ] || [ -f "bun.lockb" ]; then
  bun install --frozen-lockfile 2>&1
else
  bun install 2>&1
fi
info "  Dependencies installed."

# ── Step 4: Create shell wrapper ────────────────────────────────────────────
# Try /usr/local/bin first (may need sudo). Fall back to ~/.local/bin
# (already on PATH for most shells) if the system directory is unwritable.

WRAPPER="#!/bin/sh
exec bun \"$INSTALL_DIR/src/marvin.ts\" \"\$@\""

install_wrapper() {
  local target="$1"
  mkdir -p "$(dirname "$target")"
  rm -f "$target"
  if ! printf '%s\n' "$WRAPPER" > "$target"; then
    return 1
  fi
  chmod +x "$target"
  SYMLINK_PATH="$target"
}

if install_wrapper "$SYMLINK_PATH"; then
  info "  Created at $SYMLINK_PATH"
else
  FALLBACK="$HOME/.local/bin/marvin"
  if install_wrapper "$FALLBACK"; then
    warn "  Could not write to $SYMLINK_PATH (permission denied)."
    info "  Created at $FALLBACK instead."
  else
    error "  Could not write to $SYMLINK_PATH or $FALLBACK. Check permissions."
  fi
fi
info "  Wrapper created."

# ── Step 5: Ensure workspace directories ───────────────────────────────────
info "Ensuring workspace directories..."
mkdir -p "$MARVIN_DIR"
mkdir -p "$MARVIN_DIR/agents"
info "  Workspace directory: $MARVIN_DIR"
info "  Agents directory:    $MARVIN_DIR/agents"

# ── Step 6: Run 'marvin install' to create config & MARVIN.md ──────────────
info "Running [marvin install] to initialise workspace files..."
if "$SYMLINK_PATH" install 2>&1; then
  info "  Workspace files created."
else
  warn "  [marvin install] failed - you can re-run it manually."
fi

# ── Done ───────────────────────────────────────────────────────────────────
echo ""
info "Marvin installed successfully!"
echo ""
info "  Install directory: $INSTALL_DIR"
info "  Symlink:         $SYMLINK_PATH"
info "  Workspace:       $MARVIN_DIR"
echo ""
info "Next steps:"
info "  1. Configure ~/.marvin/marvin.json with your models and channels"
info "  2. Run: marvin serve"
echo ""
