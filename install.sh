#!/usr/bin/env bash
#
# install.sh — Install Marvin as a user-level systemd service.
#
# Usage: bash install.sh
#
# This script is idempotent: safe to re-run. It detects existing installs,
# stops them gracefully, and proceeds with the update.
#
# Prerequisites on the target machine:
#   - systemd (with user session support)
#   - curl or wget
#   - git (for cloning, if no release archive available)
#

set -euo pipefail

# ── Configuration ──────────────────────────────────────────────────────────
GITHUB_OWNER="raduionita"
GITHUB_REPO="marvin"
INSTALL_DIR="$HOME/.local/share/marvin"
SYMLINK_PATH="/usr/local/bin/marvin"
SERVICE_NAME="marvin.service"
SERVICE_DIR="$HOME/.config/systemd/user"
MARVIN_DIR="$HOME/.marvin"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ── Helpers ────────────────────────────────────────────────────────────────
info()  { echo "[marvin] $*"; }
warn()  { echo "[marvin] WARNING: $*" >&2; }
error() { echo "[marvin] ERROR: $*" >&2; exit 1; }

# ── Git clone helper (used as fallback) ────────────────────────────────────
_git_clone() {
  if ! command -v git &>/dev/null; then
    error "git not found. Install git and retry, or provide a release archive."
  fi
  rm -rf "$INSTALL_DIR"
  mkdir -p "$INSTALL_DIR"
  info "  Cloning from https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}.git ..."
  git clone --depth 1 "https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}.git" "$INSTALL_DIR" 2>&1
  info "  Repository cloned to $INSTALL_DIR"
}

# ── Step 1: Check prerequisites ────────────────────────────────────────────
info "Checking prerequisites..."

# Check for curl or wget
if command -v curl &>/dev/null; then
  CURLORWGET="curl"
elif command -v wget &>/dev/null; then
  CURLORWGET="wget"
else
  error "Neither curl nor wget found. Install one and retry."
fi

# Check for bun
if command -v bun &>/dev/null; then
  info "Bun found: $(bun --version)"
else
  info "Bun not found. Installing Bun..."
  if ! command -v curl &>/dev/null; then
    error "curl required to install Bun"
  fi
  curl -fsSL https://bun.sh/install | bash 2>&1
  # Source the installed bun
  BUN_INSTALL="${HOME}/.bun"
  export PATH="$BUN_INSTALL/bin:$PATH"
  export BUN_INSTALL
  # Add to shell profile if not already there
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

# ── Step 2: Check for existing install ─────────────────────────────────────
info "Checking for existing Marvin installation..."

EXISTING_SYMLINK=false
EXISTING_SERVICE=false

if [ -L "$SYMLINK_PATH" ] || [ -f "$SYMLINK_PATH" ]; then
  EXISTING_SYMLINK=true
  info "  Symlink found at $SYMLINK_PATH"
fi

if systemctl --user is-active "$SERVICE_NAME" &>/dev/null; then
  EXISTING_SERVICE=true
  info "  Marvin service is currently running."
fi

if [ "$EXISTING_SYMLINK" = true ] || [ "$EXISTING_SERVICE" = true ]; then
  info "Existing installation detected. Stopping service if running..."
  systemctl --user stop "$SERVICE_NAME" 2>/dev/null || true
  systemctl --user disable "$SERVICE_NAME" 2>/dev/null || true
  info "Existing service stopped."
fi

# ── Step 3: Download latest release ────────────────────────────────────────
info "Fetching latest release from GitHub..."

RELEASE_URL="https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest"
RELEASE_JSON=$(curl -fsSL "$RELEASE_URL" 2>/dev/null || echo "")

if [ -n "$RELEASE_JSON" ] && echo "$RELEASE_JSON" | grep -q '"tag_name"'; then
  LATEST_TAG=$(echo "$RELEASE_JSON" | grep '"tag_name"' | head -1 | sed 's/.*"tag_name": "\(.*\)".*/\1/')
  info "  Latest release: $LATEST_TAG"

  # Find the .tar.gz asset URL
  ASSET_URL=$(echo "$RELEASE_JSON" | grep '"browser_download_url"' | grep '\.tar\.gz' | head -1 | sed 's/.*"browser_download_url": "\(.*\)".*/\1/')

  if [ -n "$ASSET_URL" ]; then
    info "  Downloading release archive..."
    TMPFILE=$(mktemp /tmp/marvin-XXXXXX.tar.gz)
    if [ "$CURLORWGET" = "curl" ]; then
      curl -fsSL "$ASSET_URL" -o "$TMPFILE"
    else
      wget -q "$ASSET_URL" -O "$TMPFILE"
    fi

    # Clean up existing install dir before extracting
    rm -rf "$INSTALL_DIR"
    mkdir -p "$INSTALL_DIR"
    tar -xzf "$TMPFILE" -C "$INSTALL_DIR" --strip-components=1
    rm -f "$TMPFILE"
    info "  Archive extracted to $INSTALL_DIR"
  else
    warn "No .tar.gz asset found in release. Falling back to git clone."
    _git_clone
  fi
else
  info "No release found. Cloning from main branch..."
  _git_clone
fi

# ── Step 4: Install dependencies ───────────────────────────────────────────
info "Installing dependencies..."
cd "$INSTALL_DIR"
# --frozen-lockfile only works with a lock file; fall back to regular install
if [ -f "bun.lock" ] || [ -f "bun.lockb" ]; then
  bun install --frozen-lockfile 2>&1
else
  bun install 2>&1
fi
info "  Dependencies installed."

# ── Step 5: Create symlink (shell wrapper) ─────────────────────────────────
info "Creating symlink at $SYMLINK_PATH..."

WRAPPER="#!/bin/sh
exec bun $INSTALL_DIR/src/marvin.ts \"\$@\""
mkdir -p "$(dirname "$SYMLINK_PATH")"
printf '%s\n' "$WRAPPER" > "$SYMLINK_PATH"
chmod +x "$SYMLINK_PATH"
info "  Symlink created."

# ── Step 6: Set up systemd service ─────────────────────────────────────────
info "Setting up systemd service..."

mkdir -p "$SERVICE_DIR"
cp "$SCRIPT_DIR/$SERVICE_NAME" "$SERVICE_DIR/$SERVICE_NAME"
info "  Service file installed to $SERVICE_DIR/$SERVICE_NAME"

# ── Step 7: Ensure workspace directory ─────────────────────────────────────
info "Ensuring workspace directory..."
mkdir -p "$MARVIN_DIR"
info "  Workspace directory: $MARVIN_DIR"

# ── Step 8: Start the service ──────────────────────────────────────────────
info "Starting Marvin service..."

systemctl --user daemon-reload
systemctl --user enable "$SERVICE_NAME" 2>&1 || true
systemctl --user start "$SERVICE_NAME" 2>&1 || true

# ── Done ───────────────────────────────────────────────────────────────────
echo ""
info "Marvin installed successfully!"
echo ""
echo "  Install directory: $INSTALL_DIR"
echo "  Symlink:         $SYMLINK_PATH"
echo "  Service file:    $SERVICE_DIR/$SERVICE_NAME"
echo "  Workspace:       $MARVIN_DIR"
echo ""
echo "Next steps:"
echo "  1. Configure ~/.marvin/marvin.json with your models and channels"
echo "  2. Check status: systemctl --user status marvin"
echo "  3. View logs:    journalctl --user -u marvin -f"
echo ""
