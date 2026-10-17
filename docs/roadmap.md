# Roadmap

Status on 2026-10-16. For third-party skills and MCPs: read the code and pin a version before installing - a skill
or MCP server runs with your user's rights.

## Done

- Strata 256K with any Qwen3.8-Flash-Next build (model menu in `01-install-strata.ps1`), RAM-tuned defaults
- OpenClaw 2026.8.35, local memory (EmbeddingGemma on CPU), SearXNG web search, tool search (prompt 45K -> 12K tokens)
- Agent / creative / free GPU modes + live mode panel, one-click start
- Turkish voice: "Mergen, ..." wake word, F9, widget; Telegram text and voice notes
- Hybrid pipeline: brief with unstated expectations + critic fallback, background cloud reviews in git worktrees,
  preloaded worker context, test-tamper guard for Python/JS/TS/C#, Claude-limit fallback to the local brain,
  fully local mode, Telegram progress, plan time estimate
- Worker change discipline (smallest complete change, surgical edits, reuse first, test-first, written
  `ASSUMPTION:` notes the review checks) and .NET project support (dotnet new/add/restore/ef/sln)

## Next

1. **Eyes for the reviews.** Open the built app in a headless browser, screenshot it, click through the first screen,
   and for games play 60 seconds (did the player die instantly?). strike-arena passed 535 tests with a menu that never
   closed. Candidate: Anthropic's Apache-2.0 `webapp-testing` skill + Playwright.
2. **2-3 tasks per worker session** - the biggest remaining cost is every task re-reading the project.
3. **A different model as the local reviewer** (e.g. a dense 27B on a second machine) - same-model reviews share the
   same blind spots.
4. **Resource watchdog** - save the project and stop the stack on sustained CPU/GPU overload (needs a CPU temperature
   source such as LibreHardwareMonitor).
5. ComfyUI MCP + a "video from a script" skill for creative mode.

## MCP / skill shortlist for your profile

| Area | Candidate | Why | Status |
|---|---|---|---|
| ComfyUI | `jaewilson07/comfy_mcp` (simple) or `artokun/comfyui-mcp` (108 tools) | generate / queue / fetch images and video from OpenClaw | to check |
| YouTube (API) | `kirbah/mcp-youtube` | channel/video/comment data via YouTube Data API (free key) - complements the yt-dlp skill | to check |
| BIST / TEFAS | `saidsurucu/borsa-mcp` | market and fund data, no key; you used it before | to check |
| MSSQL | `RichardHan/mssql_mcp_server` | T-SQL work, **read-only login only**; connection string in env vars | to check |
| Model work | Hugging Face MCP (official) | search models/datasets/papers for fine-tuning and quant choices | to check |
| Coding docs | Context7 | current library docs for hybrid-dev, fewer hallucinated APIs | to check |
| Web app testing | Playwright MCP (Microsoft) | lets hybrid-dev test web UIs it builds (Flask/Blazor) | to check |
| Search/RAG | Elasticsearch MCP (official) | inspect the NL->SQL project's two ES indexes | to check |
| FL Studio | `karl-andres/fl-studio-mcp` (MIDI + loopMIDI) or `rosasynthesiz/flstudio-mcp` (67 tools, 0 stars) | piano roll / mixer from chat | experimental |
| CapCut | `alex28042/capcut-mcp` (writes CapCut draft files) | assemble edits from generated clips | experimental, breaks with CapCut updates |
| Binance | - | **not recommended**: an agent with trading keys is a large risk; if ever, read-only keys only | skip |

Already covered without an MCP: GitHub (`gh` + bundled github skill), files/apps (windows-assistant),
web search (SearXNG), transcripts and summaries (yt-dlp + summarize-local).
