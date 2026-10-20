"""Open a page in a real browser (installed Microsoft Edge, headless), collect its errors, take a screenshot.

Eyes for the pipeline's workers (2026-10-20): a worker without a browser declared a prototype done that threw
`m.makeIdentity is not a function` on load and never drew a frame; jsdom tests also passed a menu that never closed
(strike-arena). The local model reads images (Strata --vision), so the worker can look at the screenshot itself.

  python browser_check.py prototype/index.html                     # a file: its folder is served over HTTP
  python browser_check.py dist --keys "click,key:w:3,key:d:1"       # a folder with index.html
  python browser_check.py http://localhost:5199 --cmd "npm run dev -- --port 5199 --strictPort"
  --keys: comma-separated steps run after the page loads:
      click | click:X:Y | key:<key>:<seconds held> | press:<key> | wait:<seconds>
  The same steps (plus {"click": selector}, {"fill": [selector, text]} and "shot:<name>") drive the user flows of
  .hybrid/visual.json in the milestone visual review (visual.py).
Prints errors and the screenshot path. Exit code 0 = no page errors, 1 = errors, 2 = could not open the page.
"""
import argparse
import datetime as dt
import functools
import http.server
import os
import socket
import subprocess
import sys
import threading
import time
import urllib.request
from pathlib import Path

# --- config -----------------------------------------------------------------
BROWSER_CHANNEL = "msedge"
WIDTH, HEIGHT = 1366, 768
LOAD_WAIT_S = 3.0                    # after "load": let scripts start, WebGL draw its first frames
SERVER_TIMEOUT_S = 120               # --cmd: dev server start
BROWSER_ARGS = ["--ignore-gpu-blocklist", "--enable-unsafe-swiftshader"]   # WebGL also without a GPU context
# -----------------------------------------------------------------------------


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def serve_folder(folder: Path) -> str:
    """Static HTTP server in a thread (file:// breaks ES modules and import maps)."""
    class Quiet(http.server.SimpleHTTPRequestHandler):
        def log_message(self, *a):          # keep the worker's output to the result
            pass
    handler = functools.partial(Quiet, directory=str(folder))
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", free_port()), handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return f"http://127.0.0.1:{srv.server_address[1]}/"


def wait_http(url: str, proc: subprocess.Popen | None) -> bool:
    end = time.time() + SERVER_TIMEOUT_S
    while time.time() < end:
        if proc is not None and proc.poll() is not None:
            return False
        try:
            with urllib.request.urlopen(url, timeout=3):
                return True
        except Exception:  # noqa: BLE001 - not up yet
            time.sleep(1)
    return False


def run_step(page, step, shot=None) -> None:
    """One step: a string like "key:w:3", or {"click": css} / {"fill": [css, text]}. shot(name) takes a screenshot."""
    if isinstance(step, dict):
        if "click" in step:
            page.click(step["click"], timeout=10000)
        elif "fill" in step:
            page.fill(step["fill"][0], step["fill"][1], timeout=10000)
        else:
            raise ValueError(f"unknown step {step}")
    else:
        kind, *args = step.strip().split(":")
        if kind == "click":
            vp = page.viewport_size or {"width": WIDTH, "height": HEIGHT}
            x, y = (float(args[0]), float(args[1])) if len(args) == 2 else (vp["width"] / 2, vp["height"] / 2)
            page.mouse.click(x, y)
        elif kind == "key":
            page.keyboard.down(args[0])
            time.sleep(float(args[1]) if len(args) > 1 else 0.5)
            page.keyboard.up(args[0])
        elif kind == "press":
            page.keyboard.press(args[0])
        elif kind == "wait":
            time.sleep(float(args[0]))
        elif kind == "shot":
            if shot:
                shot(args[0] if args else "step")
        else:
            raise ValueError(f"unknown step '{step}'")
    time.sleep(0.2)


def run_steps(page, steps: str) -> None:
    for step in [s.strip() for s in steps.split(",") if s.strip()]:
        run_step(page, step)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("target", help="URL, an .html file, or a folder with index.html")
    ap.add_argument("--keys", default="", help="steps after load, e.g. 'click,key:w:3,wait:1'")
    ap.add_argument("--cmd", default="", help="start this server first (killed afterwards); target is its URL")
    ap.add_argument("--out", default="", help="screenshot path (default .hybrid/browser/<time>.png)")
    ap.add_argument("--wait", type=float, default=LOAD_WAIT_S)
    a = ap.parse_args()
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

    proc = None
    if a.cmd:
        proc = subprocess.Popen(a.cmd, shell=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                                stdin=subprocess.DEVNULL)
        url = a.target
        if not wait_http(url, proc):
            print(f"COULD NOT OPEN: server did not answer on {url} within {SERVER_TIMEOUT_S}s ({a.cmd})")
            subprocess.run(["taskkill", "/T", "/F", "/PID", str(proc.pid)], capture_output=True)
            return 2
    elif a.target.startswith(("http://", "https://")):
        url = a.target
    else:
        p = Path(a.target).resolve()
        if p.is_dir():
            p = p / "index.html"
        if not p.exists():
            print(f"COULD NOT OPEN: {p} does not exist")
            return 2
        url = serve_folder(p.parent) + p.name

    out = Path(a.out) if a.out else Path(".hybrid") / "browser" / f"{dt.datetime.now():%H%M%S}.png"
    out.parent.mkdir(parents=True, exist_ok=True)
    errors: list[str] = []
    try:
        from playwright.sync_api import sync_playwright
        with sync_playwright() as pw:
            browser = pw.chromium.launch(channel=BROWSER_CHANNEL, headless=True, args=BROWSER_ARGS)
            page = browser.new_page(viewport={"width": WIDTH, "height": HEIGHT})
            page.on("pageerror", lambda e: errors.append(f"uncaught: {e}"))
            page.on("console", lambda m: errors.append(f"console.error: {m.text}") if m.type == "error" else None)
            page.on("response", lambda r: errors.append(f"HTTP {r.status}: {r.url}") if r.status >= 400 else None)
            resp = page.goto(url, timeout=60000, wait_until="load")
            time.sleep(a.wait)
            if a.keys:
                run_steps(page, a.keys)
                time.sleep(0.5)
            title = page.title()
            canvases = page.evaluate("document.querySelectorAll('canvas').length")
            page.screenshot(path=str(out))
            browser.close()
    except Exception as ex:  # noqa: BLE001 - report, do not crash the caller
        print(f"COULD NOT OPEN: {type(ex).__name__}: {str(ex).splitlines()[0][:300]}")
        return 2
    finally:
        if proc is not None:
            subprocess.run(["taskkill", "/T", "/F", "/PID", str(proc.pid)], capture_output=True)

    status = resp.status if resp else "no response"
    print(f"page: {url} (HTTP {status}) title: {title!r} canvases: {canvases}")
    print(f"screenshot: {out.resolve()}   <- open it with the Read tool and look at it")
    # A missing favicon is on nearly every page and is not a bug of the page.
    unique = [e for e in dict.fromkeys(errors) if "favicon" not in e and "status of 404 (File not found)" not in e]
    if unique:
        print(f"ERRORS ({len(unique)}):")
        for e in unique[:20]:
            print("  " + e[:400])
        return 1
    print("no page errors")
    return 0


if __name__ == "__main__":
    sys.exit(main())
