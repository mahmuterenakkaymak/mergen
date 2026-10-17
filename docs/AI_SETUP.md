# Installing MERGEN for a user (instructions for AI agents)

This page is written for an AI coding assistant (Claude Code, Cursor, Codex, GitHub Copilot, ...) that a user asked to
set up MERGEN on their PC. MERGEN is a Turkish, local-first assistant: [Strata](https://github.com/Niko1221/Strata)
runs Qwen3.8-Flash-Next on the GPU + system RAM, [OpenClaw](https://docs.openclaw.ai) runs the agent, and everything
listens on `127.0.0.1`. The human version of these steps is the [Quick start](../README.md#quick-start).

Work through the steps in order. Tell the user what you are doing in plain words; they may not be technical.

## 0. Ground rules

- **Everything stays on loopback.** Do not bind Strata, the OpenClaw gateway or SearXNG to `0.0.0.0`, and do not put
  a tunnel or port forward in front of them.
- **Never type secrets for the user.** The Telegram bot token, the Claude login and API keys are entered by the user.
  Never write them into a file in this repository; they live in the user's environment or OpenClaw's own config.
- **Ask before changing the system.** The page file (step 1), drivers, Node.js and Docker Desktop are the user's
  decision. Say what you want to change and why, and wait for a yes.
- **Confirm the download.** The model is ~70 GB (94 GB for `UD-IQ4_XS`, 111 GB for `UD-Q4_K_XL`). Check that the
  user is fine with that, especially on a metered connection.
- **Long-running steps.** Strata's setup can take an hour or more. Run it in the background or with a long timeout and
  poll its output; do not kill it because it is quiet. Rerunning the same command resumes it.
- **The scripts menus are for humans.** `01-install-strata.ps1` shows an arrow-key menu when it has a console; from an
  agent's shell always pass `-Model` so nothing waits for a key press.

## 1. Check the PC

| What | Command (PowerShell) | Needed |
|---|---|---|
| OS | `[Environment]::OSVersion` | Windows 10/11 (tested on Windows 11) |
| GPU, VRAM, driver | `nvidia-smi --query-gpu=name,memory.total,driver_version --format=csv` | NVIDIA, 12 GB+ VRAM, driver 580+ (tested: RTX 5090 32 GB). Other cards: [Strata's list](https://github.com/Niko1221/Strata#what-you-need) |
| RAM | `(Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory / 1GB` | 32 GB+; it decides the model (step 3) |
| Free disk | `Get-PSDrive -PSProvider FileSystem` | ~80-120 GB, ideally NVMe |
| Page file | `(Get-CimInstance Win32_OperatingSystem).TotalVirtualMemorySize / 1MB` | RAM + ~64 GB (see below) |
| Node.js | `node -v` | 24.16 or newer |
| git | `git --version` | any |
| Docker Desktop | `docker info` | for local web search (SearXNG); optional |

If the GPU, RAM or disk is missing, say which part and stop.

**Page file:** with the system-managed page file Strata can exit silently under load. Ask the user to set a fixed
64 GB page file on C: and restart (`sysdm.cpl` -> Advanced -> Performance Settings -> Advanced -> Virtual memory ->
Custom size 65536 / 65536). The steps and the reason are in [known-issues.md](known-issues.md). Do not change it
yourself.

**Node.js:** if it is missing or too old, suggest nvm-windows (`nvm install 24`, `nvm use <version>`) and ask first.

## 2. Get MERGEN

```powershell
git clone https://github.com/mahmuterenakkaymak/mergen.git
cd mergen
```

Every script has its settings at the top. Strata is cloned to `$HOME\Strata` by default (`-StrataDir` changes it);
the model files go to a `Strata-data` folder next to it.

## 3. Pick the model

By RAM, and ask whether the user mainly wants it for code (then `CODER` is a good pick at any size):

| RAM | `-Model` | Notes |
|---|---|---|
| 32 GB | `CODER` | best at code, weaker elsewhere |
| 48-64 GB | `IQ2_XS` | Strata's pick; `Q2_0` is faster, `IQ3_XXS` / `IQ3_S` slower and a bit better |
| 96 GB+ | `UD-IQ4_XS` | ~4-bit Unsloth build, this repo's tested setup (94 GB download) |

All builds and what they need: run `.\scripts\01-install-strata.ps1` without `-Model` in a real console, or see the
table in the [README](../README.md#quick-start). `SWIFT-*` builds think shorter; `UD-Q4_K_XL` is experimental.

## 4. Install, in order

```powershell
# Strata + the model (long: background it and poll)
.\scripts\01-install-strata.ps1 -Model IQ2_XS

# start Strata and wait until the model is loaded (the PC can stutter for 1-3 minutes);
# its last step checks the OpenClaw gateway, which fails here because OpenClaw is not installed yet - that is fine
.\scripts\start-all.bat

# OpenClaw (pinned 2026.8.35, newer releases fail on Windows - known-issues.md) + the gateway service
.\scripts\02-install-openclaw.ps1

# point OpenClaw at Strata; web search, memory, skills, MERGEN's identity files
.\scripts\03-configure-openclaw.ps1
```

`03-configure-openclaw.ps1` sets `$UserName` to the Windows user name; MERGEN calls the user by it. Ask the user for
their first name and change that line before running it.

**One step you cannot do:** the local embedding server is chosen in an interactive OpenClaw menu with no flag. The
script prints the exact answers; ask the user to run `openclaw configure --section model` and follow them, then run
`openclaw gateway restart` and `openclaw memory status --index --agent main`.

## 5. Verify

```powershell
.\scripts\verify.ps1
```

It checks Strata's `/health`, the gateway, the memory index and runs one real agent turn. Then open
`http://127.0.0.1:18789` (the panel). From now on the user starts everything with `MERGEN-START.bat`.

## 6. Optional pieces (ask which ones the user wants)

| Piece | What the user does | Docs |
|---|---|---|
| **Software pipeline, hybrid** | installs Claude Code and logs in with `claude` -> `/login` (their own account) | [hybrid-dev.md](hybrid-dev.md) |
| **Software pipeline, fully local** | nothing extra: says *"tam local"* and plan, reviews and rescues also run on Strata (no Claude account needed) | [hybrid-dev.md](hybrid-dev.md#brain-mode-cloud-or-fully-local) |
| Voice ("Mergen, ...", F9) | nothing; you create the venv and download the Piper voice | [voice/README.md](../voice/README.md) |
| Telegram | creates a bot with @BotFather and types the token into `openclaw channels add` | [mcp.md](mcp.md#telegram) |
| Creative mode (27B + ComfyUI) | WSL2 + Unsloth Studio, sets `UNSLOTH_API_KEY` | [modes-and-models.md](modes-and-models.md) |

## 7. When something fails

| Symptom | What to do |
|---|---|
| Strata exits with no message, or warns about the commit limit | page file too small: step 1 |
| Strata setup stopped | rerun the same `01-install-strata.ps1 -Model ...`; it resumes |
| `Strata is not running` in step 02 | `.\scripts\start-all.bat`, wait for "Strata is ready" |
| OpenClaw "offline maintenance" / state-db lock | a newer OpenClaw was installed: reinstall the pinned version (`02-install-openclaw.ps1`) |
| `Node ... is too old` | Node 24.16+ (step 1) |
| Very slow, disk busy | not enough free RAM for the build: close programs or pick a smaller `-Model` |

More: [known-issues.md](known-issues.md). Strata's own problems: its
[AI_SETUP.md](https://github.com/Niko1221/Strata/blob/main/docs/AI_SETUP.md) and
[TROUBLESHOOTING.md](https://github.com/Niko1221/Strata/blob/main/docs/TROUBLESHOOTING.md).
