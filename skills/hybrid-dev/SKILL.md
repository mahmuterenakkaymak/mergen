---
name: hybrid-dev
description: Build a whole software project autonomously from a PROJECT_BRIEF.md - Claude (cloud, Pro plan) plans and reviews, the local Qwen model implements and tests - by starting the deterministic orchestrator hybrid_run.py and reporting its progress. Also fully local ("tam local") with --brain local. Use for ANY request to build software - a program, app, game, website, tool or bot ("... yap", "... geliştir", "... yaz", "kod pipeline'ını test et", "projeyi başlat") - after project-brief has written the brief. Never write such projects yourself.
metadata:
  {
    "openclaw": { "emoji": "🤝", "requires": { "bins": ["claude", "git", "python"] } }
  }
---

# Hybrid development

You do **not** run the build loop yourself. A deterministic Python orchestrator does it:

`python {{MERGEN_HOME}}\hybrid\hybrid_run.py <project_dir> [--plan-only | --build-only]`

It calls Claude Opus once to plan (PLAN.md + TASKS.md), the local model for every task (Claude Code on Strata),
runs each task's accept check itself, restores tests the local model changes, sends a task to Claude Sonnet after
2 local failures, has Sonnet review every finished milestone (bug-fix tasks get appended), commits after every
passing task. After 10 cloud calls or a Claude usage-limit error it does not stop: the local model becomes the brain for the rest of that run (Telegram says so); the next run tries Claude again. State: `<project>\.hybrid\`
(`log.md`, `budget.json`, `report.json`, `agents\*.log`).

Your job: talk to the user (in {{LANGUAGE}}), start runs, watch, report.

## Brain mode: cloud (default) or fully local

- **cloud** (default): Claude plans, reviews and rescues; the local model writes the code.
- **local**: the local Strata model does everything; no cloud calls, nothing leaves the PC. Use it when the user
  says "tam local", "local mod", "local brain", "cloud kullanma", "Claude'suz", or the project has private/customer
  data. Slower and plans/reviews are weaker than Claude's; say so once when they pick it.
- The AI Modes panel has a switch "Full local / Tamamen Yerel" | "Hybrid (Claude + Mergen)" (config/hybrid.json). When it is on Full local every run is local without any flag. Tell the user which one is active when you start a build.
- **Next run of an existing project** (all tasks done, the user wants more): have project-brief write a new
  brief file (e.g. `PROJECT_BRIEF_RUN2.md`), then start with `--extend PROJECT_BRIEF_RUN2.md` instead of a plan
  command. The architect only appends to PLAN.md / TASKS.md (existing tasks are guarded) and the build follows.
- Add `--brain local` to the **plan** command. The choice is saved in `.hybrid\mode.json`; later `--build-only`
  runs keep it, so the build command does not change. To switch an existing project, add `--brain cloud` or
  `--brain local` to the build command.
- If the user did not say, use cloud - unless the brief marks data as personal/customer: then ask.
- **Games, anything with a UI or a "feel"**: add `--prototype` to the plan command. The local model first builds a
  free, rich sketch in `prototype/` (no tests, ~5-15 min) and lists its features in `prototype/FEATURES.md`; the plan
  must then reach at least that richness, plus a "Delight" section of crafted details. Tell the user they can open
  `prototype/index.html` while the build runs. Skip it for pure back-end/data work.

## Steps

1. **Brief.** No `PROJECT_BRIEF.md` in the project folder -> use the project-brief skill first. The project folder
   is `{{PROJECTS_DIR}}\<slug>`; create it and `git init` if new.
2. **Plan.** Run it in the foreground (1-3 min), with the real project path written literally:
   ```powershell
   python {{MERGEN_HOME}}\hybrid\hybrid_run.py {{PROJECTS_DIR}}\<slug> --plan-only
   ```
   Then show the user the milestones and the task list from TASKS.md in a short table, plus a **time estimate**:
   tasks x ~3.5 min (measured 2026-10-16; small tasks ~2 min, big UI/world tasks ~5 min), e.g. "47 tasks =
   ~2.5-3 hours". If it is over ~1.5 h, offer to trim scope first. Then ask for approval. This is
   the only stop. If they want changes, edit PROJECT_BRIEF.md (not TASKS.md), delete PLAN.md/TASKS.md, plan again.
3. **Build.** Start it as a **detached process** so it survives this session (it can take 10-60 min). Write the
   path literally - no `$variables` inside `powershell -Command`:
   ```powershell
   Start-Process -WindowStyle Hidden -FilePath python -ArgumentList '{{MERGEN_HOME}}\hybrid\hybrid_run.py','{{PROJECTS_DIR}}\<slug>','--build-only' -RedirectStandardOutput '{{PROJECTS_DIR}}\<slug>\.hybrid\run.out' -RedirectStandardError '{{PROJECTS_DIR}}\<slug>\.hybrid\run.err'
   ```
   Tell the user it started and that progress comes to **Telegram by itself**: the orchestrator pushes each
   milestone review, any rescue or `FAILED` task, a usage-limit message and the final summary. You cannot poll
   (you only run when spoken to), so never promise "I will let you know" - say a Telegram notification will come.
   If the user asks "durum ne?", summarize the last lines of `.hybrid\log.md` (done/total tasks, current task).
4. **Finish.** Read `.hybrid\report.json`, run the full test command from TASKS.md's last task, and give the user a
   summary in {{LANGUAGE}}: what was built, how to run it, tests passed, tasks done locally vs. rescued, cloud calls used,
   open issues from REVIEW.md. If tasks are left open, offer to rerun `--build-only` later (it resumes).

## Rules

- Never edit the project's code, tests or TASKS.md checkboxes yourself while a run is going.
- Never start two runs on the same project; check the log before starting.
- Cloud calls cost the user's Pro limits: don't rerun planning without a reason.
- Secrets never go into the brief or the repo; local-first and read-only-database rules from the brief apply.

## Measured (pilot, 2026-10-15)

fis-parser: 16 tasks, Qwen passed every task it attempted on the first try; Sonnet's 2 reviews found 3 real bugs;
~3 cloud calls needed; local decode median ~122 tok/s; 106 tests. Report: `hybrid-pilot-fis-parser\REPORT.md`.
