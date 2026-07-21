#!/usr/bin/env bash
#
# install.sh — Install Marvin application.
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
info()  { echo "$*"; }
warn()  { echo "WARNING: $*" >&2; }
error() { echo "ERROR: $*" >&2; exit 1; }

# ── Step 1: Check prerequisites ────────────────────────────────────────────
info "Checking prerequisites..."

if command -v curl &>/dev/null; then
  CURLORWGET="curl"
elif command -v wget &>/dev/null; then
  CURLORWGET="wget"
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
  info "  Latest release: $LATEST_TAG"

  # GitHub's tarball_url points to a URL like:
  #   https://api.github.com/repos/{owner}/{repo}/tarball/{tag}
  # — the URL itself does not end with .tar.gz, but the HTTP response is a valid .tar.gz.
  # We append .tar.gz to the URL so the downloaded file has the expected extension.
  TARBALL_URL=$(echo "$RELEASE_JSON" | grep '"tarball_url"' | head -1 | sed 's/.*"tarball_url": "\(.*\)".*/\1/')".tar.gz"

  info "  Downloading release archive..."
  TMPFILE=$(mktemp /tmp/marvin-XXXXXX.tar.gz)
  if [ "$CURLORWGET" = "curl" ]; then
    curl -fsSL "$TARBALL_URL" -o "$TMPFILE"
  else
    wget -q "$TARBALL_URL" -O "$TMPFILE"
  fi

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

# ── Step 4: Create symlink (shell wrapper) ─────────────────────────────────
info "Creating symlink at $SYMLINK_PATH..."

WRAPPER="#!/bin/sh
exec bun $INSTALL_DIR/src/marvin.ts \"\$@\""
mkdir -p "$(dirname "$SYMLINK_PATH")"
printf '%s\n' "$WRAPPER" > "$SYMLINK_PATH"
chmod +x "$SYMLINK_PATH"
info "  Symlink created."

# ── Step 5: Ensure workspace directories ───────────────────────────────────
info "Ensuring workspace directories..."
mkdir -p "$MARVIN_DIR"
mkdir -p "$MARVIN_DIR/agents"
info "  Workspace directory: $MARVIN_DIR"
info "  Agents directory:    $MARVIN_DIR/agents"

# ── Done ───────────────────────────────────────────────────────────────────
echo ""
info "Marvin installed successfully!"
echo ""
echo "  Install directory: $INSTALL_DIR"
echo "  Symlink:         $SYMLINK_PATH"
echo "  Workspace:       $MARVIN_DIR"
echo ""
echo "Next steps:"
echo "  1. Configure ~/.marvin/marvin.json with your models and channels"
echo "  2. Run: marvin serve"
echo ""
