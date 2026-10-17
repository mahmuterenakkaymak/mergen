@echo off
rem Claude Code running on the local Strata model instead of Anthropic's cloud.
rem Same CLI, same tools - no subscription limits, nothing leaves the PC.
rem Usage: claude-local [any claude args]   e.g.  claude-local -p "fix the failing test"
setlocal
rem --- config ---
set "ANTHROPIC_BASE_URL=http://127.0.0.1:8080"
rem Strata needs no key on loopback; Claude Code needs some token so it does not use your login.
set "ANTHROPIC_AUTH_TOKEN=strata-local"
rem Claude Code only accepts model names it knows; Strata ignores the name.
set "ANTHROPIC_MODEL=claude-sonnet-4-5"
set "ANTHROPIC_SMALL_FAST_MODEL=claude-haiku-4-5"
set "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1"
rem Long local prompts can take minutes to read.
set "API_TIMEOUT_MS=900000"
rem ---------------
claude %*
