# Hybrid development: what actually happened

Five builds, 2026-10-15/16, on one RTX 5090 (Qwen3.8-Flash-Next UD-IQ4_XS via Strata as the hands, Claude Opus/Sonnet
as the brain). Nothing below is cherry-picked: the failures taught more than the passes.

## The runs

| Run | What | Tasks | First try | Rescues | Tests | Build time | Review bugs |
|---|---|---:|---:|---:|---:|---:|---:|
| Pilot | Turkish receipt parser (Python) | 16 | 12/12 tried | 0 | 106 | 12 min for 8 tasks | 3 |
| Game v1 | 3D town driving game (three.js), "small test" brief | 19 | 19/19 | 0 | 195 | 35 min | 3 |
| Direct | The same game, written by the assistant in one go (no pipeline) | - | - | - | 0 | **~2 min** | - |
| Game v2 | Same game, full scope (sound, HUD, minimap, traffic, gamepad...) | 51 | 47/48 | 1 | 751 | 178 min | 6 |
| [strike-arena](../examples/strike-arena) | Browser FPS: 3 weapons, bots, rounds, procedural audio | 39 | **39/39** | 0 | 535 | 124 min | 10 |

The local model was never the weak link: 117 of 118 attempted tasks passed on the first try. Everything that went
wrong was about **scope, wiring and nobody looking at the screen**.

## What we learned, in order

**1. The brief decides the product.** Game v1 was solid and tested, and it felt empty: the brief had quietly put sound,
HUD, minimap and visual detail "out of scope" and the user only saw four questions. The assistant's direct version
(2 minutes, no tests, ~20-40x fewer tokens) had all of them and felt better.
Fix: before planning, the assistant lists the *unstated expectations* for this kind of product and the full out-of-scope
list, and asks. If there is no answer in 5 minutes (or on "ask Claude"), a critic agent reviews the brief and the
result goes to Telegram. The plan prompt now also plans what a user sees, hears and feels.

**2. Reviews find what tests cannot.** Across the runs, milestone reviews found 22 real bugs that every test had passed:
mirrored steering locked in by the model's *own* test, gamepad buttons that never fire on a real pad (mocks reused one
object; Chrome returns a new snapshot per call), traffic and pedestrians coded and tested but never added to the scene
(invisible, yet colliding), a 3D audio listener that was never moved off the world origin.

**3. Tests are not eyes.** strike-arena: 39/39 tasks, 4 reviews, 535 green tests, and the game did not start. The menu
panels hid themselves with the `hidden` attribute while an inline `display: flex` overrode it, so the pause panel sat on
top of Start. The fake DOM in the tests checks `.hidden`, not CSS. One screenshot showed it instantly. The bots were
also mathematically correct and unplayable (five rifles, 0.18 s reactions). Next step: a "open it, screenshot it, play
60 seconds" step in the review.

**4. Waiting is the hidden cost.** v2 spent ~30 minutes with the local model idle while Sonnet reviewed. Reviews now run
in the background in a detached git worktree and are merged between tasks; strike-arena waited ~5 minutes in total
(only the last milestone).

**5. Fewer turns, not faster tokens.** Worker time is ~80% token generation and two thirds of that is the model's
thinking (effort kept high on purpose). Every task is a fresh session that re-reads the project. Preloading PLAN.md,
the file list and the files a task names cut the median turns per task from 15 to 9 and the context read by 27%; time
per task barely moved because thinking dominates. Next lever: 2-3 related tasks per session.

**6. Limits are an event, not an error.** A Claude session limit hit mid-run once and silently skipped a review
(Claude Code said "You've hit your session limit", which the matcher did not know). Now any limit or an empty cloud
budget switches the rest of the run to the local model as the brain and says so on Telegram.

## Per-task numbers (worker sessions, medians)

| | Game v2 (before) | strike-arena (after) |
|---|---:|---:|
| Model turns per task | 15 | 9 |
| Context read per task | 785K tokens | 573K tokens |
| Tokens generated per task | 15.8K | 13.7K |
| Minutes per task (worker only) | 2.7 | 2.6 |
| Minutes per task incl. reviews | 3.7 | 3.2 |

Different projects, so this is a direction, not an A/B test.

## Cost

Cloud use stays small: a full run is 1 plan + 1 review per milestone + rare rescues (5-6 orchestrator calls; v2's 85
API turns produced ~59K output tokens, mostly cache reads). The local side is where the tokens go: v2 generated 800K
tokens and processed ~50M on the GPU. That is free, but it is ~3 hours of a 300 W GPU and a CPU at 75-88 °C.

## When to use what

- Throwaway, single file, "show me something": let the assistant write it directly.
- Anything that will grow, be maintained or be sold: the pipeline. The direct version will not have tests, reviews or
  a history you can bisect.
