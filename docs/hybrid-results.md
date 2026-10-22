# Hybrid development: what actually happened

Six builds, 2026-10-15..20, on one RTX 5090 (Qwen3.8-Flash-Next UD-IQ4_XS via Strata as the hands, Claude Opus/Sonnet
as the brain). Nothing below is cherry-picked: the failures taught more than the passes.

## The runs

| Run | What | Tasks | First try | Rescues | Tests | Build time | Review bugs |
|---|---|---:|---:|---:|---:|---:|---:|
| Pilot | Turkish receipt parser (Python) | 16 | 12/12 tried | 0 | 106 | 12 min for 8 tasks | 3 |
| Game v1 | 3D town driving game (three.js), "small test" brief | 19 | 19/19 | 0 | 195 | 35 min | 3 |
| Direct | The same game, written by the assistant in one go (no pipeline) | - | - | - | 0 | **~2 min** | - |
| Game v2 | Same game, full scope (sound, HUD, minimap, traffic, gamepad...) | 51 | 47/48 | 1 | 751 | 178 min | 6 |
| [strike-arena](../examples/strike-arena) | Browser FPS: 3 weapons, bots, rounds, procedural audio | 39 | **39/39** | 0 | 535 | 124 min | 10 |
| Game v3 | Driving game again, with `--prototype` and the creativity changes (lesson 7) | 86 | 78/86 | 0 | 570 | ~4 h 15 min | 16 + 21 visual |

The local model was never the weak link: 195 of 204 attempted tasks passed on the first try, and the 8 v3 misses were
a pipeline bug, not the model (lesson 8). Everything that went wrong was about **scope, wiring and nobody looking at
the screen**. v3 is the best of the four driving games by the user's own play test; it took 49 planned tasks plus 37
the reviews added.

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
also mathematically correct and unplayable (five rifles, 0.18 s reactions). Since then: a visual review after each
milestone (the app is started, user flows are clicked and played with a headless browser, the local model looks at the
screenshots), and workers open the pages they build themselves (`hybrid/browser_check.py`).

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

**7. Discipline killed the creativity - until it got a quality bar.** The direct 2-minute game still felt richer than
the planned ones. Now `--prototype` lets the local model build a free, rich sketch first; its feature list is the bar
the plan must reach, the plan gets a "Delight" section of crafted details, and the visual review may add "Polish:"
tasks. "Smallest change" applies to code, not to how the product feels. v3 was the first build with this.

**8. The reviewers can break the pipeline too.** In v3, reviewers wrote accept commands with an explanation after
them (`npx vitest run x.test.js (verifies the fix)`): cmd.exe cannot run that, so 8 tasks failed three times each and
emptied the cloud budget. Fixed in three layers: the prompt asks for the bare command, the orchestrator strips a
trailing explanation, and a command cmd.exe cannot run is never retried or rescued.

**9. Green task tests are not a working whole.** Playing v3 found two bugs no test had: bumpers and lamps stayed still
while the body leaned (the task said "body and cabin"), and traffic cars had no bodies (the renderer read fields the
traffic module never set: NaN). Three older tests had also stayed red for 50 tasks, because every task runs only its
own tests. Now every test suite and smoke run of the whole project runs after each milestone and at the end, plans
write the data contracts between modules and one real integration test per milestone, and the visual review follows
user flows instead of looking at the start screen only. None of this is game-specific.

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
