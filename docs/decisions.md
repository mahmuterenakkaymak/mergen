# Decisions

Why each setting is what it is. Hardware: RTX 5090 32 GB, 96 GB DDR5, Ryzen 9 9950X3D, two NVMe SSDs.

## Model: Unsloth UD-IQ4_XS

The ~4-bit Unsloth Dynamic quant is the highest-quality size Strata lists that runs well on 96 GB of RAM (Strata's
own table puts it at "96 GB+"). It keeps 55 GiB of experts in RAM and reads the rest from the NVMe SSD; Q4_K_XL is
marked experimental and slower. Download is 93.7 GB.

## Context: 256K, with KV streaming

From 64K up, Strata keeps the whole KV cache in RAM and only a 32K window per layer in VRAM (`--kv-resident 32768`).
So 256K costs the same VRAM as 32K, plus ~13.7 KB of RAM per context token (3.6 GB at 256K, 1.8 GB at 128K). The
model was trained on 262,144 positions, so no rope scaling is needed.

Rule used: keep 256K unless it is more than 10% slower than 128K. It was not (worst case -7.3%, see
[benchmarks.md](benchmarks.md)), so 256K stayed. Filling it is still slow in wall-clock terms (a 200K prompt is about
a minute of prompt reading before the conversation cache takes over).

## `--vram-reserve-mib 1500`

The 5090 also drives the desktop. With the default the card had 400-600 MiB free, and Strata warned that the driver
may page GPU memory to RAM (decode drops to a few tok/s, the screen can freeze). 1500 MiB leaves ~950 MiB free with
everything loaded. Raise to 2000 if you see stutter while gaming or recording.

## `--conversation-cache-mib 4096`

OpenClaw sends a ~19K-token system prompt with every turn and runs sub-sessions. Without this cache Strata keeps only
one conversation and re-reads the prompt after any other request (Strata measured ~90% re-reading). With it, the
second turn reused 18,991 of 19,363 tokens: 22 s -> 1.5 s of prompt reading (measured at 8192 MiB). Lowered to
4096 MiB on 2026-10-16 together with `--resident-budget-gib 55 -> 40` to free ~24 GB of RAM; see benchmarks.md.

## Page file: fixed 64 GB

Strata locks a lot of RAM for the GPU. With a 6 GB system-managed page file, Windows' commit limit was 99.6 GB and
Strata warned that only 3.2 GiB was left: it can exit silently (0xC0000409) even with RAM free. A fixed
65536 MB page file raised the limit to 157.6 GB and the warning is gone. Strata's docs recommend a fixed size because
a system-managed file may not grow in time.

## OpenClaw 2026.8.35 (pinned)

The latest releases (2026.9.9, 2026.10.3) stop on a state-database lock on this PC, even with an empty state folder
and with two different Node versions. 2026.8.35 is OpenClaw's `extended-stable` tag and works. See
[known-issues.md](known-issues.md).

## `tools.profile: coding`

Onboarding's default. It already includes read/write/edit, exec, web_search, web_fetch, memory, sessions, sub-agents
and automations; `full` would add everything (browser, messaging, canvas). Messaging gets added when a channel
(WhatsApp/Telegram) is connected.

## Memory: local EmbeddingGemma on CPU

OpenClaw's default embedding provider is OpenAI, which would send memory and session text to a cloud API (against the
local-first rule). The official `@openclaw/llama-cpp-provider` runs a managed `llama-server` with EmbeddingGemma 300M
(QAT Q8_0, 313 MB). On Windows it downloads the **CPU** build of llama.cpp, so it uses no VRAM. It listens on
`127.0.0.1:19432` and stops after 10 minutes idle.

EmbeddingGemma is under Gemma's terms; fine for personal use, check the license before shipping it in a product.

## Web search: local SearXNG

`web_search` uses OpenClaw's official SearXNG plugin against a SearXNG container on `127.0.0.1:8890`
(`scripts/start-searxng.ps1`, restarts with Docker). No API key, no account; queries reach the upstream engines
(Brave, DuckDuckGo, Wikipedia, ...) from the home IP, not tied to a Google account. The `searxng` MCP server adds
search + URL reading for the deep-research skill. Gemini remains an option:
`openclaw config set tools.web.search.provider gemini` with `GEMINI_API_KEY` set (free AI Studio key, daily limits,
free-tier prompts may be used by Google).

## `apiKey: "strata-local"`

Strata runs without an API key on loopback; OpenClaw accepts a non-secret marker for loopback providers. This is not
a secret. If Strata is ever exposed beyond `127.0.0.1`, set `--api-key` in Strata and move the key to an environment
variable.
