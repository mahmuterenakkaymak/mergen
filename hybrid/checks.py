"""Whole-project checks at the end of every milestone and of the run - the gap behind town-driving-game-v3
(2026-10-20): every task ran only its own tests, so a later fix (T78 moved the camera's aim) left 3 older tests red
for 50 tasks unnoticed, and a producer/consumer mismatch (traffic cars without lean fields -> NaN -> invisible car
bodies) passed every unit test. Nothing here is game specific: any project gets its full suites, plus smoke runs of
the real program if the plan wrote them.

.hybrid/checks.json (written by the plan; optional - without it the suites are detected from the stack):
{
  "suite": ["npx vitest run", ".venv\\Scripts\\python -m pytest -q"],   # every test suite of the project
  "smoke": ["node scripts/smoke.js"]      # end-to-end runs of the real program (a CLI on sample input, the API
}                                         # started and called, the import job on a fixture file), exit 0 = works
"""
import json
import subprocess
from pathlib import Path

# --- config ----------------------------------------------------------------
CHECK_TIMEOUT_S = 1200              # one suite or smoke command
OUTPUT_TAIL_CHARS = 2500            # per failing command, for the reviewer
# ---------------------------------------------------------------------------


def detect_suites(root: Path) -> list[str]:
    out = []
    pkg = root / "package.json"
    if pkg.exists():
        text = pkg.read_text(encoding="utf-8", errors="replace")
        if "vitest" in text:
            out.append("npx vitest run")
        elif '"test"' in json.dumps(json.loads(text).get("scripts", {})):
            out.append("npm test --silent")
    if (root / ".venv").is_dir() and ((root / "tests").is_dir() or (root / "pytest.ini").exists()
                                      or (root / "pyproject.toml").exists()):
        out.append(r".venv\Scripts\python -m pytest -q")
    if list(root.glob("*.sln")) or list(root.glob("*.slnx")):
        out.append("dotnet test --nologo")
    return out


def commands(root: Path) -> list[tuple[str, str]]:
    f = root / ".hybrid" / "checks.json"
    cfg = json.loads(f.read_text(encoding="utf-8")) if f.exists() else {}
    suites = cfg.get("suite") or detect_suites(root)
    return [("suite", c) for c in suites] + [("smoke", c) for c in cfg.get("smoke", [])]


def run(root: Path) -> tuple[int, list[dict]]:
    """Returns (number of commands run, failures). Never raises."""
    cmds = commands(root)
    failures = []
    for kind, cmd in cmds:
        try:
            r = subprocess.run(cmd, cwd=root, shell=True, capture_output=True, text=True, encoding="utf-8",
                               errors="replace", timeout=CHECK_TIMEOUT_S)
            ok, out = r.returncode == 0, (r.stdout or "") + (r.stderr or "")
        except subprocess.TimeoutExpired:
            ok, out = False, f"timed out after {CHECK_TIMEOUT_S}s"
        if not ok:
            failures.append({"kind": kind, "cmd": cmd, "out": out[-OUTPUT_TAIL_CHARS:]})
    return len(cmds), failures


def report(failures: list[dict]) -> str:
    return "\n\n".join(f"[{f['kind']}] {f['cmd']}\n{f['out']}" for f in failures)
