# AGENTS.md

MERGEN is a Turkish, local-first AI assistant for one Windows PC: Strata serves Qwen3.8-Flash-Next on `127.0.0.1:8080`,
OpenClaw runs the agent (gateway `127.0.0.1:18789`), and `hybrid/hybrid_run.py` is a deterministic orchestrator that
builds software with a cloud or local brain and local workers.

## Installing MERGEN for a user

Follow **[docs/AI_SETUP.md](docs/AI_SETUP.md)**: check the PC, pick the model build by RAM, run the numbered scripts
with `-Model` (no menus), verify, then offer the optional pieces. Keep everything on loopback, never type the user's
secrets, and ask before changing system settings.

## Working on the code

- Scripts keep their settings at the top; read `docs/` (known-issues, decisions, hybrid-dev) before changing the stack.
- Line endings: LF for `.md`, `.py`, `.json`; CRLF for `.bat`, `.cmd`, `.ps1` (and a UTF-8 BOM on `.ps1`, so Windows
  PowerShell 5.1 reads non-ASCII text correctly).
- Skills and `openclaw-workspace/` are templates (`{{MERGEN_HOME}}`, `{{USER_NAME}}`, ...) rendered by
  `scripts/03-configure-openclaw.ps1`; never put real paths, names, chat ids or tokens in them.
- Numbers in the docs are measured, with what they were measured on. Keep failures in
  [docs/hybrid-results.md](docs/hybrid-results.md) next to the successes.
