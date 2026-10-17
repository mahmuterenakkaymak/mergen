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
