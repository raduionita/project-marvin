# mArvIn

> **mArvIn** — your extensible AI sidekick and autonomous agent runner with tool calling, MCP connectivity, multi-channel support (Slack), and scheduled task automation.

---

## Prerequisites & Dependencies

Marvin requires **Bun**, **Node.js**, and **Chromium** (used by Puppeteer for web search and browser automation). Follow the instructions for your operating system below:

### 1. macOS

1. **Install Bun:**
   ```bash
   curl -fsSL https://bun.sh/install | bash
   # or via Homebrew:
   brew install oven-sh/bun/bun
   ```
2. **Install Node.js:**
   ```bash
   brew install node
   ```
3. **Install Chromium / Google Chrome:**
   ```bash
   brew install --cask google-chrome
   # or install Puppeteer's Chrome binary:
   bun x puppeteer browsers install chrome
   ```

---

### 2. Linux (Ubuntu / Debian)

1. **Install Bun:**
   ```bash
   curl -fsSL https://bun.sh/install | bash
   # ensure bun is in your PATH:
   export PATH="$HOME/.bun/bin:$PATH"
   ```
2. **Install Node.js & system build tools:**
   ```bash
   sudo apt update
   sudo apt install -y nodejs npm curl wget git
   ```
3. **Install Chromium & Puppeteer runtime dependencies:**
   ```bash
   sudo apt install -y chromium-browser \
     libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libgbm1 \
     libasound2 libpangocairo-1.0-0 libxss1 libxcomposite1 libxdamage1 libxrandr2
   # or install Puppeteer's Chrome binary:
   bun x puppeteer browsers install chrome
   ```

---

### 3. Windows

> [!TIP]
> **WSL2 Recommended:** For the smoothest experience on Windows, running Marvin inside **WSL2 (Ubuntu)** is recommended (follow the Linux steps above). 

If running natively on Windows PowerShell:

1. **Install Bun:**
   ```powershell
   powershell -c "irm bun.sh/install.ps1 | iex"
   ```
2. **Install Node.js:**
   ```powershell
   winget install OpenJS.NodeJS
   # or download from https://nodejs.org
   ```
3. **Install Chromium / Google Chrome:**
   Ensure Google Chrome is installed, or install Chrome via Puppeteer:
   ```powershell
   bun x puppeteer browsers install chrome
   ```

---

## Getting Started Locally

Simple step-by-step guide to clone, configure, and run Marvin locally:

### 1. Clone the repository
```bash
git clone https://github.com/raduionita/project-marvin.git
cd project-marvin
```

### 2. Install dependencies
```bash
bun install
```

### 3. Initialize workspace & default configuration
Run the installer command to generate `~/.marvin/` workspace directories, `marvin.json`, and `MARVIN.md`:
```bash
bun run src/marvin.ts install
```

### 4. Configure API keys & environment
Create a `.env` or `.env.local` file in the project root:
```bash
cp .env .env.local
```

Add your provider credentials:
```env
# Models (configure at least one)
OPENAI_API_KEY=your-openai-api-key
DEEPSEEK_API_KEY=your-deepseek-api-key

# Optional: Slack Integration (Socket Mode)
SLACK_BOT_TOKEN=xoxb-...
SLACK_APP_TOKEN=xapp-...

# Optional: Log level (debug, info, warn, error)
MARVIN_LOG_LEVEL=info
```

### 5. Verify the installation
Run the test suite to ensure everything is operating cleanly:
```bash
bun test
```

### 6. Start Marvin
Start the daemon locally:
```bash
bun run serve
# or: bun run src/marvin.ts serve
```

---

## CLI Usage

You can interact with Marvin using the CLI entrypoint (`bun run src/marvin.ts <command>`):

```bash
# General help
bun run src/marvin.ts help

# Start daemon server
bun run src/marvin.ts serve

# Manage agents
bun run src/marvin.ts agents list
bun run src/marvin.ts agents add
bun run src/marvin.ts agents edit <agentId>

# Manage tasks
bun run src/marvin.ts tasks list
bun run src/marvin.ts tasks add

# Manage Model Context Protocol (MCP) servers
bun run src/marvin.ts mcps list
bun run src/marvin.ts mcps add
bun run src/marvin.ts mcps info <mcpId>

# Manage tools & skills
bun run src/marvin.ts tools list
bun run src/marvin.ts skills list

# Server status & diagnostics
bun run src/marvin.ts status
bun run src/marvin.ts logs -n 50
bun run src/marvin.ts reload
```

---

## Server Deployment (Linux systemd)

For persistent deployment on a Linux server, run the automated installation script:

```bash
curl -fsSL https://raw.githubusercontent.com/raduionita/project-marvin/refs/heads/main/install.sh | bash
```

This installs Bun, registers a user-level systemd unit (`~/.config/systemd/user/marvin.service`), and creates the `marvin` wrapper executable in `~/.local/bin/marvin`.

Manage the service with:
```bash
systemctl --user status marvin
journalctl --user -u marvin -f
```
