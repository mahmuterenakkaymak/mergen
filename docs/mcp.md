# MCP servers and tools

| Name | Source / version | Tools | Notes |
|---|---|---|---|
| searxng | `mcp-searxng@2.6.0` (MIT) | 4 | local SearXNG `127.0.0.1:8890` |
| borsa | `saidsurucu/borsa-mcp` @ `e3b45b2` (MIT), `uv tool install` | 23 | BIST/TEFAS/KAP/macro, runs locally; `EVDS_API_KEY` (free TCMB key) only for EVDS data |
| context7 | `@upstash/context7-mcp@4.4.2` (MIT) | 2 | current library docs for coding |
| playwright | `@playwright/mcp@0.0.83` (Apache-2.0, Microsoft) | 25 | `--browser msedge --headless`; browse/test web apps |
| huggingface | `https://huggingface.co/mcp` (official, anonymous) | 4 | search models, datasets, papers |
| mssql | `microsoft_sql_server_mcp==0.1.0` (MIT), `uv tool install` | - | **disabled** until the read-only login exists |

## Tool search (important for speed)

`tools.toolSearch.mode = "tools"`: tool schemas load on demand. Measured on a one-word question: prompt
45,000 -> 12,000 tokens, reply 27 s -> 12 s; MCP calls still work (borsa THYAO price in 28 s).

## MSSQL (read-only)

The server can run INSERT/UPDATE/DELETE, so read-only comes from the database login. Windows auth on this PC is
sysadmin - never use it for the MCP. Steps: `scripts/mssql-readonly-login.sql` (creates `mergen_ro` with
`db_datareader` + DENY writes on your databases; you set the password), then
`[Environment]::SetEnvironmentVariable("MSSQL_PASSWORD", "<password>", "User")`, `openclaw gateway restart`,
`openclaw mcp configure mssql --enable --probe`. Configured: `MSSQL_SERVER=localhost`, `MSSQL_PORT=1433`,
`MSSQL_DATABASE=<YOUR_DB>`, `MSSQL_USER=mergen_ro`; the password is inherited from the environment.

## Voice notes from chat channels

`tools.media.models`: a local CLI transcriber (`voice\transcribe_cli.py`, faster-whisper large-v3-turbo on the CPU,
Turkish). An OGG/Opus voice note was transcribed in 7 s. `echoTranscript` shows what was understood.

## Telegram

Bundled `@openclaw/telegram` plugin, enabled. Add the bot: create it with @BotFather, then
`openclaw channels add --channel telegram --token <token>` (you type the token), `openclaw gateway restart`,
message the bot, and approve the pairing code with `openclaw pairing approve telegram <code>`.
