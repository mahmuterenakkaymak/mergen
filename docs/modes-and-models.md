# GPU modes and changing models

The RTX 5090 has 32 GB. Strata alone uses ~31 GB, so only one heavy workload runs at a time.

| Mode | What runs | VRAM | OpenClaw model | Use for |
|---|---|---|---|---|
| **agent** | Strata: Qwen3.8-Flash-Next UD-IQ4_XS, 256K | ~31 GB | `strata/qwen3.8-flash-next-unsloth-ud-iq4_xs` | assistant, coding, research, hybrid-dev |
| **creative** | Unsloth Studio (WSL): Qwen3.8-27B Q4 + ComfyUI desktop | ~17-18 GB + ComfyUI | `unsloth/qwen3.8-27b` (vision) | ComfyUI image/video automation |
| **free** | nothing | ~2 GB (desktop) | unchanged | games, fine-tuning, recording |

## Switching

- **One click:** desktop shortcut **AI Modes** (`scripts\mode-panel.bat`) - three buttons + Status.
- **Per mode:** `scripts\mode-agent.bat`, `mode-creative.bat`, `mode-free.bat`.
- **Everything up in Agent mode:** desktop shortcut **MERGEN** (`MERGEN-START.bat`).
- **CLI:** `powershell -ExecutionPolicy Bypass -File scripts\switch-mode.ps1 -Mode agent|creative|free|status`

Measured: `free` 13 s, `agent` from cold 133 s (most of it is Strata reading ~55 GB of experts).

The OpenClaw agent must never switch modes by itself: `creative` and `free` stop Strata, the model it runs on.

## One-time setup for creative mode

Unsloth Studio needs an API key and the key must be in an environment variable (never in a file):

1. In WSL: `unsloth studio run --model unsloth/Qwen3.8-27B-GGUF --gguf-variant UD-Q4_K_XL --api-key-name openclaw`
   It prints an API key. The label `openclaw` makes Unsloth reuse the same key on every later run. Stop it (Ctrl+C).
2. In PowerShell: `[Environment]::SetEnvironmentVariable("UNSLOTH_API_KEY", "<key>", "User")`, then
   `openclaw gateway restart`.
3. If you use a different 4-bit file than `UD-Q4_K_XL`, change `$UnslothVariant` at the top of
   `scripts\switch-mode.ps1`.

The first `creative` run adds the `unsloth` provider to OpenClaw. It is added only when the key exists, because an
OpenClaw provider whose env key is missing makes **every** `openclaw` command fail.

## Adding or changing a model later

### Another Strata model (new quant or family)

```powershell
cmd /c "%USERPROFILE%\Strata\START-HERE.bat --setup --yes --family <qwen|swift|coder|unsloth> --model <SIZE> --context 262144 --vram-reserve-mib 1500 --no-start"
```
Then in `scripts\switch-mode.ps1` update `$StrataRun` (setup prints `start script: run-....bat`) and `$StrataModelRef`,
and in OpenClaw:
```powershell
openclaw config set models.providers.strata.models --strict-json '[{"id":"<model id from http://127.0.0.1:8080/v1/models>","name":"...","contextWindow":262144,"maxTokens":16384,"reasoning":true,"input":["text"],"cost":{"input":0,"output":0,"cacheRead":0,"cacheWrite":0}}]'
openclaw models set strata/<model id>
```
Re-run `scripts\bench_strata.py` and compare with `docs/benchmarks.md`.

### Another model in Unsloth Studio (or any OpenAI-compatible server)

Change `$UnslothModel` / `$UnslothVariant` / `$UnslothContext` at the top of `switch-mode.ps1`, then update the model
entry: `openclaw config set models.providers.unsloth.models --strict-json '[{"id":"...", ...}]'`.
For a completely new server (Ollama, LM Studio, vLLM in WSL): add a provider the same way
(`baseUrl`, `api: "openai-completions"`, `apiKey` as env SecretRef), check with `openclaw models list`, switch with
`openclaw models set <provider>/<id>`.

### VRAM rules of thumb

- Strata's VRAM use is mostly expert cache; `--vram-reserve-mib N` hands N MiB back to other programs at some speed
  cost. 1500 is the minimum for a GPU that drives the desktop.
- 27B Q4 (~17-18 GB) + ComfyUI fits; Strata + ComfyUI does not, unless Strata gets a large reserve (e.g. 12000).
- Speech (faster-whisper, Piper) runs on the CPU and needs no VRAM.
