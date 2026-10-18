"""Screenshots of the running app for the milestone review - the pipeline's blind spot until 2026-10-18: tests were
green but nobody looked at the pages (a 48-task web app shipped a plain Bootstrap admin table).

The project describes how to start and log in to its app in .hybrid/visual.json; this module starts it, takes a
full-page screenshot of every listed page at every width with the installed Microsoft Edge (Playwright, no browser
download) and reports page problems (HTTP errors, console errors, horizontal scroll at phone width).

.hybrid/visual.json:
{
  "start": "powershell -NoProfile -ExecutionPolicy Bypass -File scripts/demo.ps1 -NoBrowser -Port 5099",
  "base_url": "http://localhost:5099",
  "ready_path": "/health",
  "milestones": ["M4", "M9"],            # optional; default: every milestone
  "widths": [390, 1366],                 # optional
  "login": {"path": "/Login", "user_field": "#Username", "password_field": "#Password",
            "submit": "button[type=submit]", "password_env": "APP_DEMO_PASSWORD"},   # optional
  "pages": [{"name": "index", "path": "/"}, {"name": "student", "path": "/Student/1", "user": "ogrenci1"}]
}
"""
import json
import os
import subprocess
import time
import urllib.request
from pathlib import Path

# --- config ----------------------------------------------------------------
BROWSER_CHANNEL = "msedge"          # installed Edge; Playwright downloads nothing
READY_TIMEOUT_S = 180               # first start may build the app and generate data
PAGE_TIMEOUT_MS = 30000
VIEW_HEIGHT = 900
DEFAULT_WIDTHS = [390, 1366]        # phone, laptop
# ---------------------------------------------------------------------------


def load_config(root: Path) -> dict | None:
    f = root / ".hybrid" / "visual.json"
    return json.loads(f.read_text(encoding="utf-8")) if f.exists() else None


def wanted(cfg: dict | None, ms: str) -> bool:
    return bool(cfg) and ("milestones" not in cfg or ms in cfg["milestones"])


def _wait_ready(url: str, proc: subprocess.Popen) -> bool:
    end = time.time() + READY_TIMEOUT_S
    while time.time() < end:
        if proc.poll() is not None:
            return False
        try:
            with urllib.request.urlopen(url, timeout=3) as r:
                if r.status < 500:
                    return True
        except Exception:  # noqa: BLE001 - not up yet
            pass
        time.sleep(2)
    return False


def _stop(proc: subprocess.Popen) -> None:
    # The start command spawns a tree (powershell -> dotnet run -> app); kill all of it.
    subprocess.run(["taskkill", "/T", "/F", "/PID", str(proc.pid)], capture_output=True)


def take_screens(root: Path, cfg: dict, out_dir: Path) -> tuple[list[Path], list[str]]:
    """Returns (png files, problems). Problems include a failed start; never raises."""
    from playwright.sync_api import sync_playwright   # imported here: projects without visual.json need no Playwright

    out_dir.mkdir(parents=True, exist_ok=True)
    for old in out_dir.glob("*.png"):
        old.unlink()
    pngs, problems = [], []
    base = cfg["base_url"].rstrip("/")
    proc = subprocess.Popen(cfg["start"], cwd=root, shell=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                            stdin=subprocess.DEVNULL)
    try:
        if not _wait_ready(base + cfg.get("ready_path", "/"), proc):
            return [], [f"app did not start within {READY_TIMEOUT_S}s: {cfg['start']}"]
        login = cfg.get("login")
        with sync_playwright() as pw:
            browser = pw.chromium.launch(channel=BROWSER_CHANNEL, headless=True)
            try:
                for width in cfg.get("widths", DEFAULT_WIDTHS):
                    for page_cfg in cfg["pages"]:
                        name = f"{page_cfg['name']}-{width}"
                        ctx = browser.new_context(viewport={"width": width, "height": VIEW_HEIGHT}, locale="tr-TR")
                        page = ctx.new_page()
                        errors: list[str] = []
                        page.on("console", lambda m, e=errors: e.append(m.text) if m.type == "error" else None)
                        page.on("pageerror", lambda ex, e=errors: e.append(str(ex)))
                        try:
                            if login and page_cfg.get("user"):
                                page.goto(base + login["path"], timeout=PAGE_TIMEOUT_MS)
                                page.fill(login["user_field"], page_cfg["user"])
                                page.fill(login["password_field"], os.environ.get(login.get("password_env", ""), ""))
                                page.click(login["submit"])
                                page.wait_for_load_state("networkidle", timeout=PAGE_TIMEOUT_MS)
                            resp = page.goto(base + page_cfg["path"], timeout=PAGE_TIMEOUT_MS)
                            page.wait_for_load_state("networkidle", timeout=PAGE_TIMEOUT_MS)
                            if resp is None or resp.status >= 400:
                                problems.append(f"{name}: HTTP {resp.status if resp else 'no response'}")
                            overflow = page.evaluate("document.documentElement.scrollWidth - window.innerWidth")
                            if overflow > 1:
                                problems.append(f"{name}: horizontal scroll ({overflow}px wider than the screen)")
                            png = out_dir / f"{name}.png"
                            page.screenshot(path=str(png), full_page=True)
                            pngs.append(png)
                        except Exception as ex:  # noqa: BLE001 - one broken page must not stop the others
                            problems.append(f"{name}: {type(ex).__name__}: {str(ex).splitlines()[0][:200]}")
                        problems += [f"{name}: console error: {e[:200]}" for e in errors]
                        ctx.close()
            finally:
                browser.close()
    finally:
        _stop(proc)
    return pngs, problems
