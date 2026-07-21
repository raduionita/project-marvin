# mArvIn
mArvIn - your AI sidekick

## Getting Started

### Prerequisites

- [Bun](https://bun.sh/install) (v0.5.0 or higher) — installed automatically by the installer
- [systemd](https://systemd.io/) with user-session support (standard on modern Linux)
- [curl](https://curl.se/) or [wget](https://www.gnu.org/wget/)

### Installation (Server)

Marvin runs as a persistent background service on your server. The installer handles everything: downloading the latest release, installing Bun, setting up a systemd service, and starting it.

```bash
# One-line install (from a released version)
curl -fsSL https://raw.githubusercontent.com/raduionita/project-marvin/refs/heads/main/install.sh | bash
```

**What the installer does:**
1. Installs [Bun](https://bun.sh) if not already present
2. Downloads the latest release archive from GitHub (or clones from `main`)
3. Installs dependencies (`bun install`)
4. Creates a symlink at `/usr/local/bin/marvin`
5. Installs a user-level systemd service (`~/.config/systemd/user/marvin.service`)
6. Creates an environment file at `~/.config/marvin/env` (from template)
7. Starts the Marvin service

**After installation, configure your API keys:**

```bash
# 1. Edit environment file (add your API keys)
~/.config/marvin/env

# 2. Configure models, channels, and agents
~/.marvin/marvin.json

# 3. Check the service is running
systemctl --user status marvin

# 4. View live logs
journalctl --user -u marvin -f
```

### Usage

```bash
# Start the server (daemon mode)
marvin serve

# Client mode (interacts with the running server)
marvin

# Reload server config via HTTP
marvin reload

# Bootstrap the system (workspace + service + env)
marvin load

# Check for and apply updates from GitHub
marvin update

# Check service health and status
marvin status
```

## Contributing
