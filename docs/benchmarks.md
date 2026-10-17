# Benchmarks: 128K vs 256K context

`scripts/bench_strata.py`, greedy, `reasoning_effort: none`, median of 3 runs each. Raw numbers: [bench/](bench/).

- **Short:** a ~20-token prompt, 512 output tokens.
- **Long:** a 49K-token prompt (random nonce first, so the conversation cache cannot reuse it), 128 output tokens.

Measured 2026-10-15 on RTX 5090 32 GB, 96 GB DDR5-6400, Ryzen 9 9950X3D, Strata engine 0.1.43.1, Unsloth
UD-IQ4_XS, 8-bit KV with KV streaming, `--vram-reserve-mib 1500`, `--conversation-cache-mib 8192`.

| Metric | 128K | 256K | Change |
|---|---|---|---|
| Short prompt, output | 120.0 tok/s | 111.3 tok/s | -7.3% |
| 49K prompt, prompt reading | 3,723 tok/s | 3,559 tok/s | -4.4% |
| 49K prompt, output | 72.0 tok/s | 78.4 tok/s | +8.9% (noise) |

Decision rule was "stay at 256K unless something is >10% slower"; nothing was, so 256K is the default.

Caveats: the 256K run was made right after Strata started (expert cache still warming), the 128K run after the
server had been in use, so the real gap is likely smaller. Speculative decoding makes output speed depend on the
text, so a few % between runs is normal. Neither run filled the context; output speed falls as the context fills.

Earlier observations with real OpenClaw traffic (128K): a 19K-token agent prompt was read in 22 s at 841 tok/s; the
next turn reused 18,991 tokens and took 1.5 s; output 84-88 tok/s.

# RAM budget: `--resident-budget-gib` 55 -> 40, conversation cache 8192 -> 4096 MiB (2026-10-16)

Why: with budget 55 Strata's working set was ~70 GB and free RAM fell to 0.6-1.8 GB during a hybrid build
(page file in use). Same bench as above, 3 runs, after a warm-up run. Raw: [bench/](bench/) `2026-10-16-budget*.json`.

| Metric | budget 55 / cache 8192 | budget 40 / cache 4096 | Change |
|---|---|---|---|
| Strata working set | ~70 GB | 46 GB | -24 GB |
| Free RAM (idle, nothing else heavy) | 1.8 GB | 26-29 GB | +~25 GB |
| Short prompt, output | 121.0 tok/s | 118.6 tok/s | -2.0% |
| 49K prompt, prompt reading | 3,990 tok/s | 3,648 tok/s | -8.6% |
| 49K prompt, output | 77.4 tok/s | 71.9 tok/s | -7.1% |

Rule ">10% slower -> revert" not hit, so budget 40 / cache 4096 is the default. Commit charge stays ~107 GB
(private bytes ~75 GB): the difference is reserved but not resident, backed by the 64 GB page file.
Backup of the old run config: `%USERPROFILE%\Strata\strata-unsloth-ud-iq4_xs.json.before-ram-20261016`.
