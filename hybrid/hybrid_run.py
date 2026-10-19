"""Hybrid development orchestrator: Claude (cloud) = brain, local Qwen via claude-local = hands.

The loop is deterministic code, not an LLM: task order, running the accept checks, retry counting,
escalation, the cloud-call budget and the test-tampering check all live here.

    python hybrid_run.py <project_dir>            # plan (if no TASKS.md yet), then build
    python hybrid_run.py <project_dir> --plan-only
    python hybrid_run.py <project_dir> --build-only
    python hybrid_run.py <project_dir> --brain local   # fully local: Strata also plans, reviews and rescues
    python hybrid_run.py <project_dir> --critique-only  # brain reads PROJECT_BRIEF.md, writes BRIEF_REVIEW.md
    python hybrid_run.py <project_dir> --critique-after 300   # same, but only if the user has not answered in 300 s

The brain choice (cloud | local) is saved in .hybrid/mode.json, so a resumed --build-only run keeps it.
The AI Modes panel switch ("Full local" | "Hybrid (Claude + Mergen)") writes config/hybrid.json; local wins whenever
the panel or the project says local, so a project locked to local never goes to the cloud.

Project files (the agents talk only through these):
    PROJECT_BRIEF.md  (you)        PLAN.md, TASKS.md (BRAIN)        REVIEW.md (BRAIN)
    .hybrid/log.md, .hybrid/budget.json, .hybrid/report.json (this script)

TASKS.md line format (written by BRAIN, parsed here):
    - [ ] T01 | M1 | short description | accept: <shell command that exits 0 when the task is done>
"""
import argparse
import ast
import datetime as dt
import difflib
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import urllib.request
from concurrent.futures import Future, ThreadPoolExecutor
from pathlib import Path

import visual                      # screenshots of the running app for the visual review (hybrid/visual.py)

# --- config -----------------------------------------------------------------
BRAIN_PLAN_MODEL = "opus"          # one planning call per project
BRAIN_REVIEW_MODEL = "sonnet"      # milestone reviews and rescues
# Visual review: after a milestone listed in the project's .hybrid/visual.json, the app is started, every page is
# screenshotted at phone and laptop width (hybrid/visual.py) and a reviewer LOOKS at them. "local" = Strata (needs
# --vision; Qwen3.8-Flash-Next reads images, tested 2026-10-18), "cloud" = Sonnet. Local keeps screenshots of real
# data at home; it falls back to cloud only when Strata has no image input and the run is not fully local.
VISUAL_REVIEWER = os.environ.get("HYBRID_VISUAL_REVIEWER", "local")
VISUAL_MAX_FIX_TASKS = 5
VISUAL_PHONE_WIDTH = 390           # these screenshots also go to the phone
CLAUDE_EXE = "claude"              # Claude Code CLI; BRAIN uses your Pro login
HANDS_ENV = {                      # HANDS = the same CLI pointed at the local Strata model (like claude-local.cmd)
    "ANTHROPIC_BASE_URL": "http://127.0.0.1:8080",
    "ANTHROPIC_AUTH_TOKEN": "strata-local",
    "ANTHROPIC_MODEL": "claude-sonnet-4-5",          # Claude Code only accepts names it knows; Strata ignores it
    "ANTHROPIC_SMALL_FAST_MODEL": "claude-haiku-4-5",
    "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC": "1",
    "API_TIMEOUT_MS": "900000",
}
# Inherited variables that would hijack the cloud brain. Found 2026-10-16: user-level ANTHROPIC_BASE_URL=
# http://localhost:8001 (a dead proxy from an old setup) made every brain call fail with ECONNREFUSED when the
# orchestrator was started from OpenClaw. The brain gets them removed; the hands get their own values above.
STRIP_FOR_BRAIN = ("ANTHROPIC_BASE_URL", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_API_KEY", "ANTHROPIC_MODEL",
                   "ANTHROPIC_SMALL_FAST_MODEL", "CLAUDE_CODE_USE_LOCAL", "CLAUDE_CODE_LOCAL_URL")
BRAIN_SWITCH_FILE = Path(__file__).resolve().parent.parent / "config" / "hybrid.json"   # written by the panel
MAX_BRAIN_CALLS = 10               # plan + reviews + rescues, per run (cloud brain: Pro limits)
MAX_LOCAL_BRAIN_CALLS = 30         # same cap for the local brain - free, but stops a review/fix loop
MAX_TRIES_LOCAL = 2                # HANDS attempts before a rescue
MAX_RESCUES_PER_TASK = 1
AGENT_TIMEOUT_S = 1800             # one agent call
CONTEXT_PLAN_CHARS = 12000         # PLAN.md preloaded into every hands prompt (cut beyond this)
CONTEXT_FILES_CHARS = 40000        # files named in the task text, preloaded until this budget is used
ACCEPT_TIMEOUT_S = 600             # one accept check
# Workers are confined to the project folder: Claude Code's acceptEdits mode only auto-approves file edits and
# file commands inside the working directory, and Bash is limited to these prefixes. A bare "Bash" here would allow
# every command anywhere - tested 2026-10-16: with this list, rm / PowerShell Remove-Item outside the project are
# blocked while tests still run. Add a prefix (e.g. Bash(npm:*)) per project stack if needed.
ALLOWED_TOOLS = ",".join([
    "Read", "Write", "Edit", "Glob", "Grep",
    "Bash(.venv/Scripts/python:*)", "Bash(.venv\\Scripts\\python:*)", "Bash(python:*)", "Bash(uv:*)",
    "Bash(pytest:*)", "Bash(dotnet build:*)", "Bash(dotnet test:*)",
    "Bash(dotnet new:*)", "Bash(dotnet add:*)", "Bash(dotnet restore:*)", "Bash(dotnet ef:*)",
    "Bash(dotnet tool restore:*)", "Bash(dotnet sln:*)",
    "Bash(npm install:*)", "Bash(npm test:*)", "Bash(npm run:*)", "Bash(npx vitest:*)", "Bash(node:*)",
    "Bash(git status:*)", "Bash(git diff:*)", "Bash(git log:*)", "Bash(git show:*)",
])
# Push notifications to the user's phone at the moments that matter (review, FAILED, rescue, limit, finish).
# Sent by this script through OpenClaw's Telegram channel - no LLM turn, so no load on the GPU the hands are using.
# MERGEN cannot poll the log by itself (it only runs when spoken to). Empty target disables notifications.
NOTIFY_TELEGRAM_TARGET = os.environ.get("HYBRID_NOTIFY_TELEGRAM", "")   # your paired Telegram chat id
# Language of the notifications (Turkish or English) and of BRIEF_REVIEW.md: MERGEN's language from
# config/language.json (03-configure-openclaw.ps1); HYBRID_LANG=tr|en overrides the notifications.
def _mergen_language() -> str:
    try:
        cfg = Path(__file__).resolve().parent.parent / "config" / "language.json"
        return json.loads(cfg.read_text(encoding="utf-8-sig")).get("language") or "Turkish"
    except (OSError, ValueError):
        return "Turkish"


LANGUAGE_NAME = _mergen_language()
NOTIFY_LANG = os.environ.get("HYBRID_LANG") or ("tr" if LANGUAGE_NAME == "Turkish" else "en")
MESSAGES = {
    "tr": {
        "fallback": "{why}: run durmadı, bundan sonra plan/review/rescue local Strata'da (tam local).",
        "critique": "{minutes} dk cevap gelmedi, brief'i {brain} eleştirdi. MERGEN'e hangilerini ekleyeceğini yaz:\n{text}",
        "critique_failed": "brief eleştirisi başarısız - MERGEN'e 'Claude'a sor' yazarak tekrar deneyebilirsin.",
        "plan_failed": "plan BAŞARISIZ: {out}",
        "plan_ready": "plan hazır: {n} görev. MERGEN'e onay ver, build başlasın.",
        "extend_failed": "plan (devam) BAŞARISIZ: {out}",
        "extend_ready": "plan (devam) hazır: {n} yeni görev ({brief}), build başlıyor.",
        "rescue": "{id} yerel modelde {tries} kez geçmedi, {brain} kurtarıyor.",
        "task_failed": "❌ {id} BAŞARISIZ, açık bırakıldı: {desc}",
        "review_fixes": "{ms} bitti, review: {n} fix görevi eklendi.\n{head}",
        "review_skipped": "{ms} bitti, review yapılamadı (cloud).",
        "bg_review_fixes": "{ms} review: {n} fix görevi eklendi.\n{head}",
        "bg_review_failed": "{ms} review iki kez başarısız oldu, atlandı.",
        "memory_note": "🧠 {who} memory'ye not yazdı ({name}): {desc}",
        "visual_no_screens": "{ms}: ekran görüntüsü alınamadı - {problems}",
        "visual_screen": "{ms} ekranı: {name}",
        "visual_done": "{ms} görsel review: {n} fix görevi eklendi.\n{head}",
        "done": "✅ bitti ({minutes} dk): {tasks} görev, {first_try} ilk denemede, {rescues} rescue, "
                "başarısız: {failed}, {where} brain çağrısı: {calls}.",
        "none": "yok", "local": "yerel", "cloud": "cloud",
    },
    "en": {
        "fallback": "{why}: the run goes on; plan/review/rescue now run on local Strata (fully local).",
        "critique": "No answer for {minutes} min, so {brain} reviewed the brief. Tell MERGEN which ones to add:\n{text}",
        "critique_failed": "brief review failed - tell MERGEN \"ask Claude\" to try again.",
        "plan_failed": "plan FAILED: {out}",
        "plan_ready": "plan ready: {n} tasks. Approve it in MERGEN to start the build.",
        "extend_failed": "plan (next run) FAILED: {out}",
        "extend_ready": "plan (next run) ready: {n} new tasks ({brief}), build starting.",
        "rescue": "{id} failed {tries} times on the local model, {brain} is rescuing it.",
        "task_failed": "❌ {id} FAILED, left open: {desc}",
        "review_fixes": "{ms} done, review: {n} fix tasks added.\n{head}",
        "review_skipped": "{ms} done, the review could not run (cloud).",
        "bg_review_fixes": "{ms} review: {n} fix tasks added.\n{head}",
        "bg_review_failed": "{ms} review failed twice, skipped.",
        "memory_note": "🧠 {who} saved a memory note ({name}): {desc}",
        "visual_no_screens": "{ms}: no screenshots - {problems}",
        "visual_screen": "{ms} screen: {name}",
        "visual_done": "{ms} visual review: {n} fix tasks added.\n{head}",
        "done": "✅ done ({minutes} min): {tasks} tasks, {first_try} first try, {rescues} rescues, "
                "failed: {failed}, {where} brain calls: {calls}.",
        "none": "none", "local": "local", "cloud": "cloud",
    },
}


def msg(key: str, **values) -> str:
    table = MESSAGES.get(NOTIFY_LANG, MESSAGES["en"])
    return table[key].format(**values)


# node + entry script: openclaw.cmd re-parses arguments through cmd.exe and mangles them
OPENCLAW_ENTRY = os.environ.get("OPENCLAW_ENTRY") or str(
    Path(shutil.which("openclaw") or "openclaw").resolve().parent / "node_modules" / "openclaw" / "openclaw.mjs")
# OpenClaw sends local files only from its own media roots ("Local media path is not under an allowed directory"),
# so screenshots are copied here first.
OPENCLAW_MEDIA_DIR = Path.home() / ".openclaw" / "media" / "hybrid"
# Test files guarded against tampering. Python: per test function (AST). Other languages: per file - no committed
# line may be removed or changed (new tests may be added). Until 2026-10-16 only .py was checked: a JS project's
# hands edited an existing vitest file unnoticed. A test file named in the task text may be edited (review fix tasks
# that say "update tests/x.test.js because it encodes the wrong behaviour").
TEST_GLOBS = ["tests/**/*.py", "test_*.py", "*_test.py",
              "*.test.js", "*.spec.js", "*.test.ts", "*.spec.ts", "*.test.mjs",
              "tests/**/*.cs", "*Tests.cs", "*Test.cs"]
# Files that decide WHICH tests run (2026-10-19 review: a new conftest hook or an `addopts = -k ...` line can skip a
# whole suite without touching a test). These must not change at all - additions included - unless the task names
# them. conftest.py: existing functions must stay and no pytest_* hook may be added (new fixtures are fine).
# package.json / pyproject.toml: only the test-runner part is guarded, so tasks can still add dependencies.
TEST_CONFIG_GLOBS = ["pytest.ini", "tox.ini", "setup.cfg", "vitest.config.*", "vite.config.*", "jest.config.*",
                     "*.runsettings"]
# Claude Code wording seen 2026-10-16: "You've hit your session limit · resets 4:40pm" - "session limit" was missing,
# so the M3 review of town-driving-game-v2 failed silently instead of falling back to the local brain.
LIMIT_MARKERS = ("usage limit", "session limit", "weekly limit", "hit your", "rate limit", "limit reached", "quota",
                 "429", "overloaded")
# -----------------------------------------------------------------------------

def test_functions(rel: str, src: str) -> dict[str, str]:
    """'file::test_name' -> AST dump of each top-level or class-level test function (unparseable file -> {})."""
    try:
        tree = ast.parse(src)
    except SyntaxError:
        return {}
    out = {}
    for node in ast.walk(tree):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name.startswith("test"):
            out[f"{rel}::{node.name}"] = ast.dump(node, include_attributes=False)
    return out


def conftest_functions(rel: str, src: str) -> dict[str, str]:
    """conftest.py: 'file::fn:<name>' -> AST dump of every module-level function (fixtures and pytest_* hooks)."""
    try:
        tree = ast.parse(src)
    except SyntaxError:
        return {}
    return {f"{rel}::fn:{n.name}": ast.dump(n, include_attributes=False) for n in tree.body
            if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef))}


def runner_section(rel: str, src: str):
    """The test-runner part of a manifest: package.json "scripts", pyproject [tool.pytest.ini_options]; else None."""
    try:
        if Path(rel).name == "package.json":
            return json.loads(src).get("scripts", {})
        if Path(rel).name == "pyproject.toml":
            import tomllib
            return tomllib.loads(src).get("tool", {}).get("pytest", {})
    except ValueError:
        return None
    return None


def mentioned_paths(text: str) -> set[str]:
    """Paths written in a task text, as exact tokens. `rel in text` (until 2026-10-19) also matched a file whose
    path is only part of another one (test_a.py inside tests/test_a.py)."""
    return {tok.replace("\\", "/").rstrip(".,:;)'\"`") for tok in re.findall(r"[\w./\\-]+", text)}


def panel_brain() -> str:
    """'local' when the AI Modes panel is set to Full local, else 'cloud' (missing/broken file = cloud)."""
    try:
        return json.loads(BRAIN_SWITCH_FILE.read_text(encoding="utf-8-sig")).get("brain", "cloud")
    except (OSError, ValueError):
        return "cloud"


TASK_RE = re.compile(r"^- \[( |x)\] (T\d+) \| (M\d+) \| (.+?) \| accept: (.+)$")


class Run:
    def __init__(self, root: Path, brain_mode: str | None = None):
        self.root = root
        self.state = root / ".hybrid"
        self.state.mkdir(exist_ok=True)
        mode_file = self.state / "mode.json"
        if brain_mode:
            mode_file.write_text(json.dumps({"brain": brain_mode}))
        saved = json.loads(mode_file.read_text())["brain"] if mode_file.exists() else "cloud"
        self.local = saved == "local" or panel_brain() == "local"
        self.budget_file = self.state / "budget.json"
        self.budget = json.loads(self.budget_file.read_text()) if self.budget_file.exists() else {"brain_calls": 0}
        self.brain_blocked = False
        self.stats = {"tasks": 0, "first_try": 0, "local_retries": 0, "rescues": 0, "failed": [], "reviews": 0}
        # Cloud reviews run in the background (own git worktree) while the hands keep building - added 2026-10-16
        # after a 49-task run spent 5-10 min per milestone with the hands idle waiting for Sonnet.
        self.lock = threading.RLock()
        self.pool = ThreadPoolExecutor(max_workers=2)
        self.pending: dict[str, tuple[Path, set, Future]] = {}   # ms -> (worktree, TASKS.md lines at start, job)
        self.review_failures: dict[str, int] = {}

    # --- logging --------------------------------------------------------------
    def log(self, role: str, msg: str) -> None:
        line = f"{dt.datetime.now():%Y-%m-%d %H:%M:%S} | {role:<6} | {msg}"
        with self.lock:
            print(line, flush=True)
            with open(self.state / "log.md", "a", encoding="utf-8") as f:
                f.write(line + "\n")

    def notify(self, msg: str, media: Path | None = None) -> None:
        """Best effort: a failed notification never stops the build."""
        node = shutil.which("node")
        if not (NOTIFY_TELEGRAM_TARGET and node and Path(OPENCLAW_ENTRY).exists()):
            return
        text = f"🤝 {self.root.name}: {msg}"[:3500]
        if media:
            OPENCLAW_MEDIA_DIR.mkdir(parents=True, exist_ok=True)
            media = Path(shutil.copy(media, OPENCLAW_MEDIA_DIR / f"{self.root.name}-{media.name}"))
        try:
            r = subprocess.run([node, OPENCLAW_ENTRY, "message", "send", "--channel", "telegram",
                                "--target", NOTIFY_TELEGRAM_TARGET, "--message", text]
                               + (["--media", str(media)] if media else []),
                               stdin=subprocess.DEVNULL, capture_output=True, text=True, encoding="utf-8",
                               errors="replace", timeout=120)
            if r.returncode != 0:
                self.log("ORCH", f"notify failed: {(r.stderr or r.stdout).strip()[-200:]}")
        except Exception as e:  # noqa: BLE001 - notifications are optional
            self.log("ORCH", f"notify failed: {e}")

    def save_budget(self) -> None:
        self.budget_file.write_text(json.dumps(self.budget, indent=1))

    # --- agents ---------------------------------------------------------------
    def agent(self, label: str, prompt: str, model: str | None = None, env: dict | None = None,
              cwd: Path | None = None) -> tuple[bool, str]:
        # Call claude.exe directly and send the prompt on stdin: a .cmd wrapper re-parses arguments through cmd.exe,
        # which dropped --permission-mode for HANDS (edits then waited for an approval nobody could give).
        exe = shutil.which(CLAUDE_EXE) or CLAUDE_EXE
        args = [exe, "-p", "--permission-mode", "acceptEdits", "--allowedTools", ALLOWED_TOOLS]
        if model:
            args += ["--model", model]
        base = {k: v for k, v in os.environ.items() if env is not None or k not in STRIP_FOR_BRAIN}
        try:
            r = subprocess.run(args, cwd=cwd or self.root, input=prompt, capture_output=True, text=True,
                               encoding="utf-8", errors="replace", timeout=AGENT_TIMEOUT_S,
                               env={**base, **(env or {})})
            out = ((r.stdout or "") + (r.stderr or "")).strip()
            ok = r.returncode == 0
        except subprocess.TimeoutExpired:
            ok, out = False, "agent timed out"
        logs = self.state / "agents"
        logs.mkdir(exist_ok=True)
        stamp = dt.datetime.now().strftime("%H%M%S%f")[:-3]   # ms: parallel agents must not share a log name
        (logs / f"{stamp}-{label}.log").write_text(f"PROMPT:\n{prompt}\n\nOUTPUT (ok={ok}):\n{out}\n", encoding="utf-8")
        return ok, out

    def brain_name(self, model: str) -> str:
        return "local Strata" if self.local else model

    def fall_back_to_local(self, why: str) -> None:
        """Cloud brain unavailable mid-run -> the local model takes over plan/review/rescue for the rest of this run.
        In memory only (not mode.json): the next run tries Claude again, since session limits reset."""
        with self.lock:
            if self.local:
                return
            self.local = True
        self.log("BRAIN", f"{why} - local Strata is the brain for the rest of this run")
        self.notify(msg("fallback", why=why))

    def brain(self, prompt: str, model: str, cwd: Path | None = None) -> tuple[bool, str]:
        with self.lock:
            if not self.local and self.budget["brain_calls"] >= MAX_BRAIN_CALLS:
                self.fall_back_to_local(f"cloud budget of {MAX_BRAIN_CALLS} calls used")
            if self.brain_blocked or self.budget["brain_calls"] >= MAX_BRAIN_CALLS + MAX_LOCAL_BRAIN_CALLS:
                return False, "brain unavailable (budget)"
            self.budget["brain_calls"] += 1
            self.save_budget()
            local = self.local
        if local:                          # same CLI and endpoint as the hands, fresh context, brain prompt
            return self.agent("brain-local", prompt, env=HANDS_ENV, cwd=cwd)
        ok, out = self.agent(f"brain-{model}", prompt, model, cwd=cwd)
        if not ok and any(m in out.lower() for m in LIMIT_MARKERS):
            self.fall_back_to_local("Claude usage limit hit")
            return self.brain(prompt, model, cwd)   # retry the same job locally
        return ok, out

    def memory_dir(self) -> Path:
        # Claude Code keeps per-project auto-memory under ~/.claude/projects/<path with non-alphanumerics as "-">.
        return Path.home() / ".claude" / "projects" / re.sub(r"[^A-Za-z0-9]", "-", str(self.root.resolve())) / "memory"

    def memory_snapshot(self) -> dict[str, float]:
        d = self.memory_dir()
        return {f.name: f.stat().st_mtime for f in d.glob("*.md") if f.name != "MEMORY.md"} if d.exists() else {}

    def report_memory(self, before: dict[str, float], who: str) -> None:
        """Agents save what they learn to project memory - in one run the workers diagnosed an orchestrator bug and
        recorded the one-line fix there hours before anyone read it. Surface every new or changed note."""
        for name, mtime in self.memory_snapshot().items():
            if before.get(name) == mtime:
                continue
            text = (self.memory_dir() / name).read_text(encoding="utf-8", errors="replace")
            desc = next((l.split(":", 1)[1].strip().strip('"') for l in text.splitlines()
                         if l.startswith("description:")), "")
            kind = "changed" if name in before else "new"
            self.log("ORCH", f"{who}: {kind} memory note {name} - {desc}")
            self.notify(msg("memory_note", who=who, name=name, desc=desc[:300]))

    def hands(self, prompt: str) -> tuple[bool, str]:
        mem = self.memory_snapshot()
        out = self.agent("hands", prompt, env=HANDS_ENV)
        self.report_memory(mem, "hands")
        return out

    # --- git / checks -----------------------------------------------------------
    def git(self, *args: str) -> str:
        # UTF-8 explicitly: Windows' default code page garbles non-ASCII test strings (e.g. "≠"), which made the
        # tamper check see unchanged tests as changed.
        return subprocess.run(["git", *args], cwd=self.root, capture_output=True, text=True,
                              encoding="utf-8", errors="replace").stdout.strip()

    @staticmethod
    def guard_keys(rel: str, src: str) -> dict[str, str]:
        """What is guarded in one file. Keys 'file::<kind>':
        <test name>  Python test function, AST dump (unchanged; new tests are fine)
        *            other test files, text (no committed line removed or changed; additions are fine)
        exact        test-runner config, text (no change at all)
        fn:<name>    conftest.py function, AST dump (unchanged)    hooks  conftest pytest_* hook names (none added)
        runner       package.json scripts / pyproject pytest section, JSON (no change at all)"""
        name = Path(rel).name
        if name == "conftest.py":
            fns = conftest_functions(rel, src)
            hooks = sorted(k.split("fn:", 1)[1] for k in fns if k.split("fn:", 1)[1].startswith("pytest_"))
            return {**fns, f"{rel}::hooks": json.dumps(hooks)}
        if name in ("package.json", "pyproject.toml"):
            section = runner_section(rel, src)
            return {} if section is None else {f"{rel}::runner": json.dumps(section, sort_keys=True)}
        if any(Path(rel).match(g) for g in TEST_CONFIG_GLOBS):
            return {f"{rel}::exact": src}
        if any(Path(rel).match(g) for g in TEST_GLOBS):
            return test_functions(rel, src) if rel.endswith(".py") else {f"{rel}::*": src}
        return {}

    @staticmethod
    def guarded(rel: str) -> bool:
        name = Path(rel).name
        return (name in ("conftest.py", "package.json", "pyproject.toml")
                or any(Path(rel).match(g) for g in TEST_GLOBS + TEST_CONFIG_GLOBS))

    def committed_tests(self) -> dict[str, str]:
        """Everything guard_keys() protects, as of the last commit. An existing test (or a file deciding which tests
        run) that changed or vanished after an agent ran is tampering; new tests are fine."""
        found = {}
        for rel in self.git("ls-files").splitlines():
            if self.guarded(rel):
                found.update(self.guard_keys(rel, self.git("show", f"HEAD:{rel}")))
        return found

    def renamed_to(self, rel: str) -> tuple[str, list[tuple[str, str]]] | None:
        """A guarded file that vanished: the present file with the same name it was moved to, and the name pairs the
        move implies (tests/OldName.Tests/X.cs -> tests/NewName.Tests/X.cs gives OldName.Tests -> NewName.Tests
        and OldName -> NewName). A rename task (2026-10-18) moved every test file and changed its namespace;
        without this the guard rejected it every try."""
        present = set(self.git("ls-files", "--cached", "--others", "--exclude-standard").splitlines())
        old = Path(rel).parts
        best = None
        for cand in present:
            new = Path(cand).parts
            if new[-1] != old[-1] or len(new) != len(old) or not (self.root / cand).exists():
                continue
            diff = [(a, b) for a, b in zip(old, new) if a != b]
            if best is None or len(diff) < len(best[1]):
                best = (cand, diff)
        if best is None:
            return None
        pairs = set(best[1])
        for a, b in best[1]:                   # dotted parts too: OldName.Tests -> OldName, NewName
            pairs |= {(x, y) for x, y in zip(a.split("."), b.split(".")) if x != y}
        return best[0], sorted(pairs, key=lambda p: -len(p[0]))

    def changed_tests(self, before: dict[str, str], allowed: str = "") -> list[str]:
        """Keys of tampered guarded items. Files whose exact path is written in `allowed` (the task text) are exempt."""
        exempt = mentioned_paths(allowed)
        self.last_moves: dict[str, str] = {}          # old path -> where it was moved (for restore_tampered)
        by_file: dict[str, dict[str, str]] = {}
        for key, old in before.items():
            by_file.setdefault(key.split("::", 1)[0], {})[key] = old
        out = []
        for rel, olds in by_file.items():
            if rel in exempt:
                continue
            p = self.root / rel
            if p.exists():
                now = self.guard_keys(rel, p.read_text(encoding="utf-8", errors="replace"))
            else:
                moved = self.renamed_to(rel)
                if moved is None:
                    out += olds
                    continue
                new_rel, pairs = moved
                self.last_moves[rel] = new_rel
                if new_rel in exempt:
                    continue
                src = self.git("show", f"HEAD:{rel}")
                for a, b in pairs:                # whole identifiers only: "A" must not turn Assert into Bssert
                    src = re.sub(rf"(?<![\w]){re.escape(a)}(?![\w])", b, src)
                olds = self.guard_keys(rel, src)          # the committed file, as the move should have left it
                cur = (self.root / new_rel).read_text(encoding="utf-8", errors="replace")
                now = {k.replace(new_rel, rel, 1): v for k, v in self.guard_keys(new_rel, cur).items()}
            for key, old in olds.items():
                kind = key.split("::", 1)[1]
                new = now.get(key)
                if new is None:
                    bad = True
                elif kind == "*":                  # line-based: every committed line must still be there, in order
                    bad = self.lines_removed(old, new)
                elif kind == "exact":
                    bad = [l.strip() for l in old.splitlines() if l.strip()] != \
                          [l.strip() for l in new.splitlines() if l.strip()]
                elif kind == "hooks":
                    bad = not set(json.loads(new)) <= set(json.loads(old))
                else:
                    # Python test keys are "file::name" - compared by the full key. Using `name` alone flagged every
                    # existing Python test as changed, so every task of a Python project went to rescue.
                    bad = new != old
                if bad:
                    out.append(key)
        # New files that decide which tests run: a fresh conftest.py with a hook, or a new runner config.
        for rel in self.git("ls-files", "--others", "--exclude-standard").splitlines():
            if rel in exempt or rel in by_file or rel in self.last_moves.values():
                continue
            keys = self.guard_keys(rel, (self.root / rel).read_text(encoding="utf-8", errors="replace"))
            if json.loads(keys.get(f"{rel}::hooks", "[]")) or f"{rel}::exact" in keys:
                out.append(f"{rel}::{'exact' if f'{rel}::exact' in keys else 'hooks'}")
        return sorted(out)

    def restore_tampered(self, tampered: list[str]) -> list[str]:
        """Committed files go back to the last commit. A file the agent created or moved one to is renamed to
        '<name>.rejected' (kept for inspection, never deleted; pytest/dotnet/vitest no longer load it)."""
        files = sorted({k.split("::", 1)[0] for k in tampered})
        tracked = set(self.git("ls-files").splitlines())
        exclude = self.root / self.git("rev-parse", "--git-path", "info/exclude")   # keep .rejected out of commits
        exclude.parent.mkdir(parents=True, exist_ok=True)
        if "*.rejected" not in (exclude.read_text() if exclude.exists() else ""):
            with open(exclude, "a", encoding="utf-8") as f:
                f.write("\n*.rejected\n")
        for rel in files:
            extra = [self.last_moves[rel]] if rel in self.last_moves else []
            if rel in tracked:
                self.git("checkout", "HEAD", "--", rel)
            else:
                extra.append(rel)
            for x in extra:
                p = self.root / x
                if p.exists():
                    p.replace(p.with_name(p.name + ".rejected"))
        return files

    def guard_tasks_file(self, snapshot: str, who: str) -> None:
        """Agents never edit TASKS.md (2026-10-19 review: a worker could tick other tasks or rewrite later accept
        commands). The orchestrator ticks tasks and merges review lines itself, so any agent edit is rolled back."""
        path = self.root / "TASKS.md"
        if path.exists() and path.read_text(encoding="utf-8") != snapshot:
            path.write_text(snapshot, encoding="utf-8")
            self.log("ORCH", f"{who} edited TASKS.md - restored")

    @staticmethod
    def lines_removed(old: str, new: str) -> bool:
        a = [l.strip() for l in old.splitlines() if l.strip()]
        b = [l.strip() for l in new.splitlines() if l.strip()]
        sm = difflib.SequenceMatcher(a=a, b=b, autojunk=False)
        return any(tag in ("replace", "delete") for tag, *_ in sm.get_opcodes())

    def accept(self, command: str) -> tuple[bool, str]:
        try:
            r = subprocess.run(command, cwd=self.root, shell=True, capture_output=True, text=True,
                               encoding="utf-8", errors="replace", timeout=ACCEPT_TIMEOUT_S)
        except subprocess.TimeoutExpired:
            return False, "accept check timed out"
        return r.returncode == 0, ((r.stdout or "") + (r.stderr or ""))[-3000:]

    # --- tasks file -------------------------------------------------------------
    def tasks(self) -> list[dict]:
        path = self.root / "TASKS.md"
        out = []
        for line in path.read_text(encoding="utf-8").splitlines() if path.exists() else []:
            m = TASK_RE.match(line.strip())
            if m:
                accept = m[5].strip().strip("`").strip()     # models like to wrap commands in backticks
                out.append({"done": m[1] == "x", "id": m[2], "ms": m[3], "desc": m[4].strip(), "accept": accept})
        return out

    def tick(self, task_id: str) -> None:
        path = self.root / "TASKS.md"
        text = path.read_text(encoding="utf-8")
        text = re.sub(rf"^- \[ \] {task_id} \|", f"- [x] {task_id} |", text, count=1, flags=re.M)
        path.write_text(text, encoding="utf-8")

    # --- phases -------------------------------------------------------------------
    def critique(self) -> bool:
        """Agent-to-agent brief review: a second agent lists what users of this kind of product expect but the brief
        does not say (found 2026-10-16: a 'small test' game brief silently dropped sound, HUD, minimap, wheels, lane
        lines and a stuck-reset; the build was solid but felt empty). The user decides; nothing is added here."""
        if not (self.root / "PROJECT_BRIEF.md").exists():
            self.log("ORCH", "PROJECT_BRIEF.md missing - write it first (project-brief skill)")
            return False
        self.log("BRAIN", f"brief critique with {self.brain_name(BRAIN_PLAN_MODEL)}")
        ok, out = self.brain(CRITIQUE_PROMPT, BRAIN_PLAN_MODEL)
        done = ok and (self.root / "BRIEF_REVIEW.md").exists()
        self.log("BRAIN", f"critique {'done' if done else 'FAILED'}")
        if not done:
            self.log("BRAIN", out[-800:])
        return done

    def critique_after(self, seconds: int) -> None:
        """MERGEN asks the user first and starts this detached. It cannot wake itself, so the timeout lives here:
        if the user has not answered (MERGEN creates .hybrid/brief_answered) the critic runs and the result goes to
        Telegram. No LLM turn while waiting."""
        marker = self.state / "brief_answered"
        deadline = time.time() + seconds
        while time.time() < deadline:
            if marker.exists():
                self.log("ORCH", "brief answered by the user - critique not needed")
                return
            time.sleep(5)
        marker.write_text("timeout")
        self.log("ORCH", f"no answer in {seconds} s - asking the critic")
        if self.critique():
            text = (self.root / "BRIEF_REVIEW.md").read_text(encoding="utf-8", errors="replace")
            self.notify(msg("critique", minutes=seconds // 60, brain=self.brain_name(BRAIN_PLAN_MODEL), text=text[:2500]))
        else:
            self.notify(msg("critique_failed"))

    def plan(self) -> bool:
        if not (self.root / "PROJECT_BRIEF.md").exists():
            self.log("ORCH", "PROJECT_BRIEF.md missing - write it first (project-brief skill)")
            return False
        self.log("BRAIN", f"planning with {self.brain_name(BRAIN_PLAN_MODEL)}")
        ok, out = self.brain(PLAN_PROMPT, BRAIN_PLAN_MODEL)
        n = len(self.tasks())
        self.log("BRAIN", f"plan {'done' if ok and n else 'FAILED'}: {n} tasks")
        if not (ok and n):
            self.log("BRAIN", out[-800:])
            self.notify(msg("plan_failed", out=out[-300:]))
            return False
        self.notify(msg("plan_ready", n=n))
        self.git("add", "-A")
        self.git("commit", "-q", "-m", "Plan: PLAN.md and TASKS.md (brain)")
        return True

    def extend(self, brief: str) -> bool:
        """Next run of an existing project (added 2026-10-18): the plan call must keep every done
        task and the existing PLAN.md, and only append. Checked deterministically - a plan that rewrote or dropped
        an existing task line is rolled back."""
        if not (self.root / brief).exists():
            self.log("ORCH", f"{brief} missing")
            return False
        tasks_file = self.root / "TASKS.md"
        before = [l.strip() for l in tasks_file.read_text(encoding="utf-8").splitlines() if TASK_RE.match(l.strip())]
        last = max(int(TASK_RE.match(l)[2][1:]) for l in before)
        last_ms = max(int(TASK_RE.match(l)[3][1:]) for l in before)
        self.log("BRAIN", f"extending the plan from {brief} with {self.brain_name(BRAIN_PLAN_MODEL)}")
        ok, out = self.brain(EXTEND_PROMPT.format(brief=brief, next_t=last + 1, next_ms=last_ms + 1),
                             BRAIN_PLAN_MODEL)
        now = {l.strip() for l in tasks_file.read_text(encoding="utf-8").splitlines() if TASK_RE.match(l.strip())}
        lost = [l for l in before if l not in now]
        added = len(self.tasks()) - len(before)
        if lost:
            self.log("ORCH", f"extend rewrote {len(lost)} existing task line(s) - rolled back: {lost[:2]}")
            self.git("checkout", "HEAD", "--", "TASKS.md", "PLAN.md")
            ok = False
        self.log("BRAIN", f"extend {'done' if ok and added > 0 else 'FAILED'}: {added} new tasks")
        if not (ok and added > 0):
            self.log("BRAIN", out[-800:])
            self.notify(msg("extend_failed", out=out[-300:]))
            return False
        self.notify(msg("extend_ready", n=added, brief=brief))
        self.git("add", "-A")
        self.git("commit", "-q", "-m", f"Plan: extend PLAN.md and TASKS.md from {brief} (brain)")
        return True

    def task_context(self, t: dict) -> str:
        """Preloaded context for the hands, so a fresh session does not spend its first turns reading the project
        (v2 2026-10-16: 10-25 turns per task, later tasks read 1.2-1.7M tokens). Text only, capped."""
        parts = []
        plan = self.root / "PLAN.md"
        if plan.exists():
            parts.append("## PLAN.md\n" + plan.read_text(encoding="utf-8", errors="replace")[:CONTEXT_PLAN_CHARS])
        files = [f for f in self.git("ls-files").splitlines() if not f.startswith(".hybrid/")]
        parts.append("## Files in the project\n" + "\n".join(files[:300]))
        budget = CONTEXT_FILES_CHARS
        named = dict.fromkeys(re.findall(r"[\w./-]+\.(?:js|mjs|ts|py|cs|html|css|json)", t["desc"]))
        for rel in named:
            if not (self.root / rel).is_file():           # "game.js" without a folder -> the one tracked file
                hits = [f for f in files if f.endswith("/" + rel)]
                rel = hits[0] if len(hits) == 1 else rel
            p = self.root / rel
            if not p.is_file() or budget <= 0:
                continue
            body = p.read_text(encoding="utf-8", errors="replace")
            if len(body) > budget:
                parts.append(f"## {rel} (too long, read it yourself)")
                continue
            budget -= len(body)
            parts.append(f"## {rel}\n```\n{body}\n```")
        return "# Context (current, from the orchestrator)\n\n" + "\n\n".join(parts)

    def run_task(self, t: dict) -> bool:
        self.stats["tasks"] += 1
        before = self.committed_tests()
        feedback = ""
        for attempt in range(1, MAX_TRIES_LOCAL + 1):
            self.log("HANDS", f"{t['id']} try {attempt}: {t['desc']}")
            # The worker's shell is Git Bash, which eats backslashes (.venv\Scripts\python -> .venvScriptspython,
            # exit 127). A worker once read that as "no shell" and saved it to memory, so later workers stopped
            # running their accept checks. The orchestrator still runs the original command in cmd.exe.
            tasks_snapshot = (self.root / "TASKS.md").read_text(encoding="utf-8")
            self.hands(HANDS_PROMPT.format(**{**t, "accept": t["accept"].replace("\\", "/")}, feedback=feedback,
                                           context=self.task_context(t)))
            self.guard_tasks_file(tasks_snapshot, f"{t['id']} hands")
            tampered = self.changed_tests(before, allowed=t["desc"])
            if tampered:
                files = self.restore_tampered(tampered)
                self.log("ORCH", f"{t['id']}: existing tests changed {tampered} - restored {files}")
                feedback = (f"You changed or removed existing tests {tampered}; that is not allowed. Those files were "
                            "restored to the last commit (your new tests in them are gone too - add them again). "
                            "Fix the code, not the tests.")
                self.stats["local_retries"] += 1
                continue
            ok, out = self.accept(t["accept"])
            if ok:
                if attempt == 1:
                    self.stats["first_try"] += 1
                return self.commit(t, "hands")
            feedback = f"The accept check `{t['accept']}` failed:\n{out}"
            self.stats["local_retries"] += 1
        # rescue
        for _ in range(MAX_RESCUES_PER_TASK):
            self.log("BRAIN", f"{t['id']}: rescue with {self.brain_name(BRAIN_REVIEW_MODEL)}")
            self.notify(msg("rescue", id=t["id"], tries=MAX_TRIES_LOCAL, brain=self.brain_name(BRAIN_REVIEW_MODEL)))
            mem = self.memory_snapshot()
            tasks_snapshot = (self.root / "TASKS.md").read_text(encoding="utf-8")
            ok, out = self.brain(RESCUE_PROMPT.format(**t, feedback=feedback), BRAIN_REVIEW_MODEL)
            self.report_memory(mem, "rescue")
            self.guard_tasks_file(tasks_snapshot, f"{t['id']} rescue")
            if not ok:
                break
            self.stats["rescues"] += 1
            # The rescue is guarded like the hands (2026-10-19 review: it was not, so a rescue that weakened a test
            # got committed).
            tampered = self.changed_tests(before, allowed=t["desc"])
            if tampered:
                files = self.restore_tampered(tampered)
                self.log("ORCH", f"{t['id']}: rescue changed existing tests {tampered} - restored {files}")
                feedback = (f"The previous rescue changed existing tests {tampered}; that is not allowed and was "
                            "undone. Fix the code, not the tests.")
                continue
            ok, out = self.accept(t["accept"])
            if ok:
                return self.commit(t, "brain")
            feedback = out
        self.log("ORCH", f"{t['id']}: FAILED - left open")
        self.notify(msg("task_failed", id=t["id"], desc=t["desc"][:150]))
        self.stats["failed"].append(t["id"])
        return False

    def commit(self, t: dict, by: str) -> bool:
        self.tick(t["id"])
        self.git("add", "-A")
        self.git("commit", "-q", "-m", f"{t['id']}: {t['desc']} ({by})")
        self.log("ORCH", f"{t['id']}: PASSED ({by})")
        return True

    def review(self, ms: str) -> None:
        if self.brain_blocked:
            self.log("ORCH", f"{ms}: review skipped (cloud unavailable)")
            return
        self.log("BRAIN", f"{ms}: review with {self.brain_name(BRAIN_REVIEW_MODEL)}")
        open_before = sum(1 for t in self.tasks() if not t["done"])
        ok, _ = self.brain(REVIEW_PROMPT.format(ms=ms), BRAIN_REVIEW_MODEL)
        if ok:
            self.stats["reviews"] += 1
            # A review only writes REVIEW.md and new TASKS.md lines ("Do not fix code yourself"). Anything else it
            # touched is set aside in a stash, not committed (2026-10-19 review: `git add -A` committed it unchecked).
            changed = (self.git("diff", "--name-only", "HEAD").splitlines()
                       + self.git("ls-files", "--others", "--exclude-standard").splitlines())
            other = [p for p in changed if p not in ("TASKS.md", "REVIEW.md") and not p.startswith(".hybrid/")]
            if other:
                self.git("stash", "push", "-u", "-q", "-m", f"{ms} review side effects", "--", *other)
                self.log("ORCH", f"{ms}: review also changed {other[:5]} - stashed, not committed")
            self.git("add", "TASKS.md", "REVIEW.md")
            self.git("commit", "-q", "-m", f"{ms}: review (brain)")
            added = sum(1 for t in self.tasks() if not t["done"]) - open_before
            review = (self.root / "REVIEW.md")
            head = review.read_text(encoding="utf-8", errors="replace")[:1200] if review.exists() else ""
            self.notify(msg("review_fixes", ms=ms, n=added, head=head))
        else:
            self.notify(msg("review_skipped", ms=ms))

    # --- background reviews ---------------------------------------------------------
    # A cloud review runs in a detached git worktree of the milestone's last commit, so the hands keep editing the
    # main tree meanwhile. Its REVIEW.md and new TASKS.md lines are merged back by the main thread between tasks
    # (new task ids renumbered). With a local brain (mode or limit fallback) reviews stay in the foreground: they
    # would share Strata with the hands and gain nothing.
    def strata_sees_images(self) -> bool:
        try:
            with urllib.request.urlopen(HANDS_ENV["ANTHROPIC_BASE_URL"] + "/health", timeout=5) as r:
                return bool(json.loads(r.read()).get("images"))
        except Exception:  # noqa: BLE001 - Strata down or old
            return False

    def visual_review(self, ms: str) -> None:
        """Runs in the main loop between tasks (the hands are idle, so the app and Strata are free). Fix tasks it
        appends to TASKS.md are picked up like review fixes."""
        cfg = visual.load_config(self.root)
        if not visual.wanted(cfg, ms):
            return
        out_dir = self.state / "screens" / ms
        exclude = self.root / self.git("rev-parse", "--git-path", "info/exclude")   # screenshots stay out of commits
        exclude.parent.mkdir(parents=True, exist_ok=True)
        if ".hybrid/screens/" not in (exclude.read_text() if exclude.exists() else ""):
            with open(exclude, "a", encoding="utf-8") as f:
                f.write("\n.hybrid/screens/\n")
        self.log("ORCH", f"{ms}: screenshots for the visual review")
        pngs, problems = visual.take_screens(self.root, cfg, out_dir)
        for prob in problems:
            self.log("ORCH", f"{ms}: page problem: {prob}")
        if not pngs:
            self.notify(msg("visual_no_screens", ms=ms, problems="; ".join(problems)[:300]))
            return
        for png in pngs:
            if png.stem.endswith(f"-{VISUAL_PHONE_WIDTH}"):
                self.notify(msg("visual_screen", ms=ms, name=png.stem), media=png)
        rel = [str(png.relative_to(self.root)).replace("\\", "/") for png in pngs]
        prompt = VISUAL_REVIEW_PROMPT.format(ms=ms, files="\n".join(rel), max_tasks=VISUAL_MAX_FIX_TASKS,
                                             problems="\n".join(problems) or "none")
        before = len(self.tasks())
        if VISUAL_REVIEWER == "local" and self.strata_sees_images():
            self.log("BRAIN", f"{ms}: visual review with local Strata ({len(pngs)} screenshots)")
            ok, out = self.agent("visual-local", prompt, env=HANDS_ENV)
        elif not self.local:
            self.log("BRAIN", f"{ms}: visual review with {BRAIN_REVIEW_MODEL} ({len(pngs)} screenshots)")
            ok, out = self.brain(prompt, BRAIN_REVIEW_MODEL)
        else:
            self.log("BRAIN", f"{ms}: visual review skipped - local brain cannot read images (Strata without --vision)")
            return
        added = len(self.tasks()) - before
        self.git("add", "TASKS.md", "VISUAL_REVIEW.md")
        self.git("commit", "-q", "-m", f"{ms}: visual review")
        self.log("BRAIN", f"{ms}: visual review {'done' if ok else 'FAILED'} - {added} fix task(s) added")
        report = self.root / "VISUAL_REVIEW.md"
        head = report.read_text(encoding="utf-8", errors="replace")[:600] if report.exists() else out[-400:]
        self.notify(msg("visual_done", ms=ms, n=added, head=head))

    def start_review(self, ms: str) -> None:
        if self.local:
            self.review(ms)
            return
        wt = Path(tempfile.mkdtemp(prefix=f"hybrid-{self.root.name}-{ms}-"))
        wt.rmdir()                                         # git creates it
        self.git("worktree", "add", "--detach", str(wt), "HEAD")
        if not (wt / "TASKS.md").exists():
            self.log("ORCH", f"{ms}: worktree failed - reviewing in the foreground")
            self.review(ms)
            return
        for d in ("node_modules", ".venv"):               # share installed deps through a junction (no copy)
            if (self.root / d).is_dir():
                subprocess.run(["cmd", "/c", "mklink", "/J", str(wt / d), str(self.root / d)], capture_output=True)
        base_lines = {l.strip() for l in (wt / "TASKS.md").read_text(encoding="utf-8").splitlines()}
        self.log("BRAIN", f"{ms}: review with {BRAIN_REVIEW_MODEL} in the background - hands keep building")
        job = self.pool.submit(self.brain, REVIEW_PROMPT.format(ms=ms), BRAIN_REVIEW_MODEL, wt)
        self.pending[ms] = (wt, base_lines, job)

    def remove_worktree(self, wt: Path) -> None:
        for d in ("node_modules", ".venv"):
            link = wt / d
            if link.exists():
                try:
                    os.rmdir(link)                        # removes the junction only, never its target
                except OSError as e:
                    self.log("ORCH", f"left worktree {wt} in place: could not unlink {d} ({e})")
                    return                                # never let git delete through a junction
        self.git("worktree", "remove", "--force", str(wt))
        self.git("worktree", "prune")

    def harvest_reviews(self, reviewed: set, wait: bool = False) -> None:
        for ms, (wt, base_lines, job) in list(self.pending.items()):
            if not (wait or job.done()):
                continue
            del self.pending[ms]
            try:
                ok, _ = job.result()
                if ok:
                    self.merge_review(ms, wt, base_lines)
                else:
                    self.review_failed(ms, reviewed)
            finally:
                self.remove_worktree(wt)

    def merge_review(self, ms: str, wt: Path, base_lines: set) -> None:
        lines = (wt / "TASKS.md").read_text(encoding="utf-8").splitlines()
        # new = task lines the reviewer appended (by content: its T number may clash with tasks added since)
        new = [l.strip() for l in lines if TASK_RE.match(l.strip()) and l.strip() not in base_lines]
        n = max([int(t["id"][1:]) for t in self.tasks()] + [0]) + 1
        added = []
        for line in new:
            old_id = TASK_RE.match(line)[2]
            added.append(line.replace(f"{old_id} |", f"T{n:02d} |", 1))
            n += 1
        if added:
            path = self.root / "TASKS.md"
            path.write_text(path.read_text(encoding="utf-8").rstrip("\n") + "\n" + "\n".join(added) + "\n",
                            encoding="utf-8")
        head = ""
        if (wt / "REVIEW.md").exists():
            review = (wt / "REVIEW.md").read_text(encoding="utf-8", errors="replace")
            (self.root / "REVIEW.md").write_text(review, encoding="utf-8")
            (self.state / "reviews").mkdir(exist_ok=True)
            (self.state / "reviews" / f"{ms}.md").write_text(review, encoding="utf-8")
            head = review[:1200]
        self.git("add", "TASKS.md", "REVIEW.md")
        self.git("commit", "-q", "-m", f"{ms}: review (brain)")
        self.stats["reviews"] += 1
        self.log("BRAIN", f"{ms}: review merged - {len(added)} fix task(s) added")
        self.notify(msg("bg_review_fixes", ms=ms, n=len(added), head=head))

    def review_failed(self, ms: str, reviewed: set) -> None:
        """One retry: the milestone is un-marked and reviewed again on the next loop pass."""
        self.review_failures[ms] = self.review_failures.get(ms, 0) + 1
        if self.review_failures[ms] <= 1:
            reviewed.discard(ms)
            self.log("BRAIN", f"{ms}: review failed - will retry once")
        else:
            self.log("BRAIN", f"{ms}: review failed twice - skipped")
            self.notify(msg("bg_review_failed", ms=ms))

    def build(self) -> None:
        reviewed_file = self.state / "reviewed.json"
        reviewed = set(json.loads(reviewed_file.read_text())) if reviewed_file.exists() else set()

        def review_done_milestones() -> None:
            # Also catches milestones finished in an earlier, interrupted run.
            all_tasks = self.tasks()
            for ms in dict.fromkeys(t["ms"] for t in all_tasks):
                if ms not in reviewed and ms not in self.pending and all(t["done"] for t in all_tasks if t["ms"] == ms):
                    reviewed.add(ms)
                    reviewed_file.write_text(json.dumps(sorted(reviewed)))
                    self.visual_review(ms)
                    self.start_review(ms)

        def open_tasks() -> list[dict]:
            out = [t for t in self.tasks() if not t["done"] and t["id"] not in self.stats["failed"]]
            return sorted(out, key=lambda t: int(t["ms"][1:]))   # an earlier milestone's fix tasks go first

        try:
            review_done_milestones()
            while True:
                self.harvest_reviews(reviewed)
                reviewed_file.write_text(json.dumps(sorted(reviewed)))
                todo = open_tasks()
                if not todo:
                    if self.pending:
                        self.log("ORCH", f"all tasks done - waiting for review(s) {sorted(self.pending)}")
                        self.harvest_reviews(reviewed, wait=True)
                        continue
                    review_done_milestones()      # a failed review may have been un-marked for its retry
                    if self.pending or open_tasks():
                        continue
                    break
                self.run_task(todo[0])
                review_done_milestones()          # a review may append fix tasks to TASKS.md; the loop picks them up
        finally:
            for _, _, job in self.pending.values():
                job.cancel()
            self.pool.shutdown(wait=True)
            for wt, _, _ in list(self.pending.values()):
                self.remove_worktree(wt)

    def report(self, started: float) -> None:
        self.stats["minutes"] = round((time.time() - started) / 60, 1)
        self.stats["brain_calls"] = self.budget["brain_calls"]
        self.stats["brain"] = "local" if self.local else "cloud"
        (self.state / "report.json").write_text(json.dumps(self.stats, indent=1))
        self.log("ORCH", f"done: {json.dumps(self.stats)}")
        if self.stats["tasks"]:              # a plan-only run already notified
            s = self.stats
            self.notify(msg("done", minutes=s["minutes"], tasks=s["tasks"], first_try=s["first_try"], rescues=s["rescues"],
                        failed=s["failed"] or msg("none"), where=msg("local" if self.local else "cloud"),
                        calls=s["brain_calls"]))


PLAN_PROMPT = """You are the architect. Read PROJECT_BRIEF.md.
1. Write PLAN.md: architecture, file layout, key decisions (section "Decisions"), milestones M1..Mn.
2. Write TASKS.md: small tasks in build order, ONE PER LINE, exactly this format:
   - [ ] T01 | M1 | <what to build> | accept: <command that exits 0 only when the task is done>
   Write the accept command bare (no backticks or quotes around it); it runs in cmd.exe from the project root.
   The accept command must be a real check that runs this task's tests, in the project's own stack, e.g.
   `.venv\\Scripts\\python -m pytest tests/test_parser.py -q` (Python) or `npx vitest run tests/car.test.js` (JS).
   Each task's tests are written as part of that task.
   Keep tasks small enough for a smaller model (one function/module + its tests each).
3. Set up the skeleton only: folders, dependencies installed and a passing empty test run, .gitignore.
   Python: `uv venv .venv` + `uv pip install --python .venv\\Scripts\\python.exe pytest ...`.
   JS: package.json + `npm install`. Allowed shell commands: python/uv/pytest, npm install/test/run, npx vitest,
   node, dotnet new/add/restore/build/test/ef/sln and dotnet tool restore (`dotnet tool install` is not
   allowed: for EF, run `dotnet new tool-manifest`, add the dotnet-ef entry to .config/dotnet-tools.json yourself,
   then `dotnet tool restore`), read-only git.
Do NOT implement features. Be concise.
Plan everything the brief puts In scope, including what a player/user sees, hears and feels (visual details, sound,
HUD, feedback, recovery from stuck states), not only logic that unit tests can cover. For such a task use an accept
command that still checks something real (build passes plus a test that the module creates/exports the thing)."""

CRITIQUE_PROMPT = """You are a product critic reviewing PROJECT_BRIEF.md before anything is planned. Read it. Do not write code.
Think about what a typical user of this kind of product expects that the brief does not say: genre conventions
(e.g. a driving game: speedometer, engine sound, wheels, lane markings, minimap, reset when stuck), usability,
feedback, error states, persistence, accessibility, performance feel. Also question items in "Out" that would make
v1 feel empty, and anything In scope that is too big for the stated size.
Write BRIEF_REVIEW.md in {language}, headings included, max 25 lines:
## Unstated expectations
A numbered list: `N. <feature> - suggest: v1 | later - <one-line reason> - cost: small|medium|large`
(at most 10, most valuable first; suggest "v1" only when it is cheap or v1 would feel broken without it).
## Left out of scope
Every item from the brief's "Out" list, one line each, so the user sees what is being dropped.
## Risks / questions
Max 3 lines. Do not edit PROJECT_BRIEF.md.""".replace("{language}", LANGUAGE_NAME)

# Change discipline below: own wording of ideas from multica-ai/andrej-karpathy-skills (Karpathy's notes on LLM coding
# pitfalls) and DietrichGebert/ponytail (MIT, "smallest complete change"), adapted for an unattended worker: there is
# nobody to ask, so assumptions are written down where the reviewer will see them. Added 2026-10-17.
HANDS_PROMPT = """Do task {id}: {desc}
Write the code and its tests for this task only; do not change other tasks' code and do not modify existing tests.

How to change code:
- Smallest complete change: everything the task needs (callers, tests, wiring into the app), nothing it does not -
  no extra features, options, abstractions or "for later" code. If 200 lines could be 50, write 50.
- Surgical: touch only lines this task needs. Do not reformat, rename or "improve" neighbouring code; match the
  style around you. Remove only what your own change made unused.
- Reuse first: a helper already in the project, then the standard library, then an installed dependency. Never add a
  dependency for a few lines.
- Test-first where it fits: for a fix or a rule, write the test that would fail without your change.
- Nobody can answer questions during this run. If the task is ambiguous, choose the reading that fits PLAN.md and
  write it as a one-line `ASSUMPTION:` comment at that spot, so the milestone review sees it.

Work in as few turns as possible:
- PLAN.md, the project's file list and the files this task names are given below - do not read them again. Read only
  files you will edit (the Edit tool needs that) or that are missing below; read several in one turn.
- Your shell is bash: use forward slashes in paths. Allowed commands: the project's python/pytest/uv, dotnet
  build/test/new/add/restore, npm install/test/run, npx vitest, node, read-only git. Anything else is denied by
  design (not a broken shell) - do not retry it, and do not save "the shell is blocked" to memory.
- Write the code and tests, run the accept check once: {accept}
- If it fails, fix and run it again. When it passes, stop - no extra checks, no summary.
{feedback}
{context}"""

VISUAL_REVIEW_PROMPT = """Visual review of milestone {ms}. Screenshots of the running app (named <page>-<width>.png;
390 = phone, 1366 = laptop):
{files}
Automatic page checks found:
{problems}
Read every screenshot with the Read tool (several in one turn) and PROJECT_BRIEF.md (its users and any design/UI
section). Judge the pages as those end users would: readability at phone width, layout and overflow, clipped or
overlapping text, unlabeled charts or numbers, empty or broken states, Turkish text, visual hierarchy, whether the
page's main action is obvious. Real problems only - not taste.
Write VISUAL_REVIEW.md (max 15 lines: page, problem, why it matters). For each real problem, at most {max_tasks},
most serious first, append a fix task to TASKS.md in the same format (next free T number, milestone {ms}) whose accept
command is a real check that fails today (build + a page test for the structural cause, e.g. the chart renders a
legend, no element is wider than the phone screen). Do not fix code yourself."""

EXTEND_PROMPT = """You are the architect. This project already exists and works: read PLAN.md, TASKS.md (all done),
the code and tests. Read {brief} - the brief for the next run.
1. APPEND to PLAN.md a new section for this run (architecture changes, file layout additions, decisions, milestones).
   Do not rewrite or delete existing sections; where an old decision changes, say so in the new section.
2. APPEND new tasks to TASKS.md, continuing the numbering at T{next_t:02d} and the milestones at M{next_ms} (use the
   milestone numbers the brief gives if they start there). Never edit an existing task line. ONE PER LINE, format:
   - [ ] T{next_t:02d} | M{next_ms} | <what to build> | accept: <command that exits 0 only when the task is done>
   Accept commands bare (no backticks), run in cmd.exe from the project root, real checks in the project's stack
   that run this task's tests. Keep tasks small enough for a smaller model (one function/module + its tests each).
   Each milestone ends with a task whose accept runs the whole test suite.
3. Install new dependencies the brief needs (Python: `uv pip install --python .venv\\Scripts\\python.exe ...`, and
   record them in pyproject.toml; .NET: only packages the brief allows). Allowed shell commands: python/uv/pytest,
   npm install/test/run, npx vitest, node, dotnet new/add/restore/build/test/ef/sln, dotnet tool restore,
   read-only git.
Do NOT implement features. Plan everything the brief puts In scope, including what users see (design, states, phone
layout) - not only logic unit tests cover. Be concise."""

RESCUE_PROMPT = """Task {id} ({desc}) failed twice in earlier attempts; start fresh and read the failure carefully. Accept check: {accept}
Last failure:
{feedback}
Fix it so the accept check passes. Do not weaken or edit existing tests. Keep the change minimal."""

REVIEW_PROMPT = """Review milestone {ms}: run `git log --oneline` and `git diff` against the commit before {ms} started,
and compare with PLAN.md and PROJECT_BRIEF.md. Check every `ASSUMPTION:` comment the workers left: a wrong one is
a bug. Write REVIEW.md (bugs, risks, missing tests, max 15 lines).
For each real bug, append a fix task to TASKS.md in the same format (next free T number, same milestone {ms},
with an accept command that fails today). Do not install or change dependencies (node_modules/.venv are shared).
If an existing test encodes the wrong behaviour, name that test file's
path in the fix task text - only then may the fix task edit it. Do not fix code yourself."""


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("project")
    ap.add_argument("--plan-only", action="store_true")
    ap.add_argument("--build-only", action="store_true")
    ap.add_argument("--critique-only", action="store_true", help="write BRIEF_REVIEW.md (one brain call) and stop")
    ap.add_argument("--critique-after", type=int, metavar="SECONDS",
                    help="wait; if .hybrid/brief_answered does not appear, critique and notify via Telegram")
    ap.add_argument("--extend", metavar="BRIEF",
                    help="next run of an existing project: append to PLAN.md/TASKS.md from this brief, then build")
    ap.add_argument("--brain", choices=["cloud", "local"],
                    help="who plans/reviews/rescues: cloud = Claude (default), local = Strata; saved per project")
    a = ap.parse_args()
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

    root = Path(a.project).resolve()
    if not (root / ".git").exists():
        subprocess.run(["git", "init", "-q"], cwd=root)
    run = Run(root, a.brain)
    run.log("ORCH", f"brain: {'local Strata' if run.local else 'cloud Claude'} (panel: {panel_brain()})")
    started = time.time()
    if a.critique_after:
        run.critique_after(a.critique_after)
        return
    if a.critique_only:
        sys.exit(0 if run.critique() else 1)
    if a.extend:
        if not run.extend(a.extend):
            sys.exit(1)
    elif not a.build_only and not run.tasks():
        if not run.plan():
            sys.exit(1)
    if not a.plan_only:
        run.build()
    run.report(started)


if __name__ == "__main__":
    main()
