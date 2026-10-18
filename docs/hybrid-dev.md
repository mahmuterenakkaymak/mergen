# Hybrid development: Claude (brain) + local Qwen (hands)

Goal: hand over a project brief and let the agents plan, build and test it without sitting in front of it, while
spending as little of the Claude Pro plan as possible.

```
 you ──brief──► OpenClaw (orchestrator, local Qwen)
                   │  project-brief skill: interview → PROJECT_BRIEF.md
                   │  hybrid-dev skill:
                   ├──► BRAIN  claude -p --model opus      (cloud, Pro limits)  PLAN.md, TASKS.md, REVIEW.md, rescues
                   └──► HANDS  claude-local -p             (Strata, unlimited)  code, tests, fixes, commits
                 files in the repo are the only channel between them; tests decide "done"
```

## Why this split

- Claude's strength (architecture, judgment, review) is needed a few times per project; its Pro limits are the
  scarce resource.
- Implementation, running tests and fixing is most of the token volume; the local model does it for free.
- `claude-local` is the same Claude Code CLI pointed at Strata (`ANTHROPIC_BASE_URL=http://127.0.0.1:8080`), so the
  local worker has the same file/edit/shell tools as cloud Claude. Strata measured 98.3% correct tool-call parsing
  for Qwen3.8 under Claude Code.
- Talking through files (PLAN/TASKS/REVIEW) instead of chat means every decision is visible, resumable after a crash
  or a usage limit, and in git history.

## Budget per project (default)

1 planning call + 1 review per milestone + up to 4 rescues (a task that failed its check twice). When Claude
returns a usage-limit error the orchestrator does not retry: reviews fall back to the local model and rescues wait
for the limit to reset.

## Brain mode: cloud or fully local

The same pipeline runs in two modes:

| | Hybrid (default) | Fully local |
|---|---|---|
| Plan, reviews, rescues | Claude (Opus plans, Sonnet reviews) | the local Strata model |
| Code, tests, fixes | local Strata model | local Strata model |
| Cloud calls | ~3-10 per project | none - nothing leaves the PC |
| Needs | a Claude account, logged in | only Strata |
| Use when | you want the strongest plan and review | private or customer data, no Claude account, or the limit is used up |

Say *"tam local"* (or "cloud kullanma", "Claude'suz") in the panel, or start the orchestrator with `--brain local`.
The choice is saved in `.hybrid/mode.json`, so resumed runs keep it. Hybrid runs also switch to the local brain on
their own when Claude's usage limit or the cloud budget runs out, and say so on Telegram.

Honest status: every build in [hybrid-results.md](hybrid-results.md) used the hybrid mode. Fully local mode is
implemented and used by the limit fallback, but no complete fully local build has been measured yet; expect slower
plans and weaker reviews than Claude's.

## How to use

1. Agent mode on (MERGEN shortcut).
2. In OpenClaw: "Yeni proje: <isim>. Amaç: ... Yöntem: ..." -> the project-brief skill asks the missing questions
   and writes `PROJECT_BRIEF.md`.
3. "hybrid-dev ile başlat" -> Claude writes PLAN.md and TASKS.md; you approve the milestones once.
4. The rest runs on its own; you get a message per milestone and `REPORT.md` at the end.

## Prerequisites

- `claude` logged in with your Pro account (`claude` then `/login` once; the token expires and needs a re-login).
- `claude-local` on PATH (`scripts\claude-local.cmd`, copied to `%USERPROFILE%\.local\bin`).
- Strata running (agent mode).
- For the visual review (optional): `pip install playwright` (it drives the installed Microsoft Edge, no browser
  download) and Strata started with `--vision` plus the model's mmproj file, so the local model can read images.

## Orchestrator

`hybrid/hybrid_run.py <project> [--plan-only|--build-only]` - deterministic loop (config at the top): plan with Opus,
each task with the local model, accept check run by the script, existing tests protected at function level (AST
compare against the last commit), rescue with Sonnet after 2 local failures, Sonnet review per finished milestone,
commit per task, max 10 cloud calls per run, stop on usage-limit errors. The `hybrid-dev` OpenClaw skill only starts
it and reports.

## Pilot (2026-10-15, `Documents\GitHub\hybrid-pilot-fis-parser`, see its REPORT.md)

- Turkish receipt parser from a brief: 16 tasks (13 planned + 3 from reviews), 106 tests, correct CLI output.
- Qwen passed **every task it actually attempted on the first try** (12 tasks, 0 retries in the final run).
- Sonnet reviews found 3 real bugs not in the brief (ARA/KDV TOPLAM counted as items, TARIH line read as store name,
  CLI traceback on non-UTF-8 input).
- Cloud calls: ~3 needed (1 plan + 2 reviews); 5 more were lost to orchestrator bugs the pilot exposed (now fixed:
  backticks in accept commands, .cmd wrapper dropping `--permission-mode`, cp1252 decoding of `git show`, review of a
  milestone finished in an interrupted run).
- Local speed: decode median 121.9 tok/s (p10 99.8), prompt reading median 1,124 tok/s, 110K tokens generated,
  91 % of prompt tokens reused from Strata's conversation cache.
- Final uninterrupted run: 8 tasks + 1 review in 12.2 min.

## Worker confinement (2026-10-16)

The Claude Code workers (brain and hands) get `--permission-mode acceptEdits` plus a Bash allowlist (python / uv /
pytest / dotnet build+test / read-only git) instead of a bare `Bash`. Tested with the local model: deleting a file
outside the project with `rm` or PowerShell `Remove-Item` is blocked ("may only list files in the allowed working
directory" / "requires approval"), while the test suite still runs. Inside the project folder file commands are
allowed - the folder is under git and every passing task is committed. A Docker-sandboxed OpenClaw agent was
considered and rejected: it could not reach Strata or cloud Claude, and the risk lives in these workers, not in
OpenClaw's own tools. MERGEN (main agent) keeps full host access for the PC-assistant tasks, with confirmation rules.

## Visual review (2026-10-18)

Tests can be green while the pages look wrong - a 48-task web app passed every check and was a plain admin table.
If the project has `.hybrid/visual.json` (start command, base URL, pages, optional login; format in
`hybrid/visual.py`), the orchestrator, after each listed milestone:

1. starts the app and screenshots every page at 390 px (phone) and 1366 px (laptop) with headless Edge,
2. checks HTTP errors, console errors and sideways scroll on the phone,
3. sends the phone screenshots to Telegram,
4. has a reviewer **look** at them and append fix tasks to TASKS.md. Default reviewer: local Strata
   (Qwen3.8-Flash-Next reads images when Strata runs with `--vision`); Sonnet only if Strata has no image input and
   the run is not fully local (`HYBRID_VISUAL_REVIEWER=cloud` forces it).

First run: 8 screenshots in 25 s, local review in 4 min, 5 real problems (a chart without a legend, the student page
261 px wider than the phone, ...), each turned into a concrete fix task.
