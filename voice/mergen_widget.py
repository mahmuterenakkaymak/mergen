"""MERGEN voice widget: a small always-on-top pill that shows the voice state and turns listening on/off.

    left click      listening on / off            (also Ctrl+Alt+M from anywhere)
    drag            move it (position is remembered)
    right click     last exchange, open log folder, quit

The voice engine (mergen_voice.listen) runs in a background thread. Run without a console:
    voice\.venv\Scripts\pythonw.exe voice\mergen_widget.py        (voice\mergen-voice.bat does this)
"""
import json
import os
import sys
import threading
import tkinter as tk
from tkinter import messagebox

# --- config -----------------------------------------------------------------
TOGGLE_HOTKEY = "ctrl+alt+m"
STATE_DIR = os.path.join(os.environ.get("LOCALAPPDATA", os.path.expanduser("~")), "mergen")
LOG_FILE = os.path.join(STATE_DIR, "voice.log")
SETTINGS_FILE = os.path.join(STATE_DIR, "widget.json")
WIDTH, HEIGHT = 210, 44
COLORS = {                       # state -> dot colour; the labels come from voice_lang.py
    "loading":   "#64748B",
    "listening": "#22C55E",
    "heard":     "#38BDF8",
    "thinking":  "#F59E0B",
    "speaking":  "#A855F7",
    "off":       "#475569",
    "error":     "#EF4444",
}
BG, FG, MUTED = "#111827", "#E5E7EB", "#9CA3AF"
# -----------------------------------------------------------------------------

os.makedirs(STATE_DIR, exist_ok=True)
# pythonw has no console: send all prints and errors to the log file.
_log = open(LOG_FILE, "a", encoding="utf-8", buffering=1)
sys.stdout = sys.stderr = _log

import keyboard                  # noqa: E402  (after the stdout redirect: libraries may print on import)
import mergen_voice as engine    # noqa: E402
from voice_lang import T         # noqa: E402


def load_settings() -> dict:
    try:
        with open(SETTINGS_FILE, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return {}


def save_settings(data: dict) -> None:
    try:
        with open(SETTINGS_FILE, "w", encoding="utf-8") as f:
            json.dump(data, f)
    except OSError:
        pass


class Widget:
    def __init__(self) -> None:
        self.settings = load_settings()
        self.root = tk.Tk()
        self.root.overrideredirect(True)                  # no title bar
        self.root.attributes("-topmost", True)
        self.root.attributes("-alpha", 0.94)
        self.root.configure(bg="#010101")
        self.root.attributes("-transparentcolor", "#010101")   # rounded corners: paint outside the pill invisible
        x, y = self.settings.get("x"), self.settings.get("y")
        if x is None:
            x = self.root.winfo_screenwidth() - WIDTH - 24
            y = self.root.winfo_screenheight() - HEIGHT - 72  # above the taskbar
        self.root.geometry(f"{WIDTH}x{HEIGHT}+{x}+{y}")

        self.canvas = tk.Canvas(self.root, width=WIDTH, height=HEIGHT, bg="#010101", highlightthickness=0, bd=0)
        self.canvas.pack()
        r = HEIGHT // 2
        self.canvas.create_oval(0, 0, HEIGHT, HEIGHT, fill=BG, outline=BG)
        self.canvas.create_oval(WIDTH - HEIGHT, 0, WIDTH, HEIGHT, fill=BG, outline=BG)
        self.canvas.create_rectangle(r, 0, WIDTH - r, HEIGHT, fill=BG, outline=BG)
        self.dot = self.canvas.create_oval(14, r - 6, 26, r + 6, fill=COLORS["loading"], outline="")
        # Tk 8.6 on Windows can't draw characters outside the BMP (the 🏹 emoji), so plain text here.
        self.canvas.create_text(36, r - 7, text="MERGEN", anchor="w", fill=FG, font=("Segoe UI Semibold", 10))
        self.label = self.canvas.create_text(36, r + 9, text=T["states"]["loading"], anchor="w", fill=MUTED,
                                             font=("Segoe UI", 9))

        self.menu = tk.Menu(self.root, tearoff=0)
        self.menu.add_command(label=f"{T['menu_toggle']}  (Ctrl+Alt+M)", command=self.toggle)
        self.menu.add_command(label=T["menu_last"], command=self.show_last)
        self.menu.add_command(label=T["menu_log"], command=lambda: os.startfile(STATE_DIR))
        self.menu.add_separator()
        self.menu.add_command(label=T["menu_quit"], command=self.quit)

        self.canvas.bind("<ButtonPress-1>", self.on_press)
        self.canvas.bind("<B1-Motion>", self.on_drag)
        self.canvas.bind("<ButtonRelease-1>", self.on_release)
        self.canvas.bind("<Button-3>", lambda e: self.menu.tk_popup(e.x_root, e.y_root))
        self.drag = None
        self.ready = False

        engine.enabled = self.settings.get("enabled", True)
        engine.status_cb = lambda s: self.root.after(0, self.show, s)
        keyboard.add_hotkey(TOGGLE_HOTKEY, lambda: self.root.after(0, self.toggle))
        threading.Thread(target=self.run_engine, daemon=True).start()

    # --- engine -------------------------------------------------------------------
    def run_engine(self) -> None:
        # WASAPI streams can only start in a thread that initialized COM as multi-threaded (MTA). Without it the
        # QuadCast fails with "WdmSyncIoctl ... GLE 0x490"; with STA it delivers silence. Measured 2026-10-15.
        if sys.platform == "win32":
            import ctypes
            ctypes.windll.ole32.CoInitializeEx(None, 0)  # COINIT_MULTITHREADED
        try:
            models = engine.load_models()
            self.ready = True
            engine.listen(*models)
        except Exception as e:                            # surface any crash in the widget, details in the log
            import traceback
            traceback.print_exc()
            self.root.after(0, self.show, "error")
            print(f"engine stopped: {e!r}", flush=True)

    # --- ui -----------------------------------------------------------------------------
    def show(self, state: str) -> None:
        color, text = COLORS.get(state, MUTED), T["states"].get(state, state)
        self.canvas.itemconfigure(self.dot, fill=color)
        self.canvas.itemconfigure(self.label, text=text)

    def toggle(self) -> None:
        if not self.ready:
            return
        engine.set_enabled(not engine.enabled)
        self.settings["enabled"] = engine.enabled
        save_settings(self.settings)

    def show_last(self) -> None:
        said, reply = engine.last_exchange
        messagebox.showinfo(T["last_title"],
                            f"{T['you']}: {said or '-'}\n\nMERGEN: {reply or '-'}", parent=self.root)

    def on_press(self, e) -> None:
        self.drag = (e.x_root, e.y_root, self.root.winfo_x(), self.root.winfo_y(), False)

    def on_drag(self, e) -> None:
        if not self.drag:
            return
        sx, sy, wx, wy, _ = self.drag
        dx, dy = e.x_root - sx, e.y_root - sy
        if abs(dx) + abs(dy) > 4:
            self.drag = (sx, sy, wx, wy, True)
            self.root.geometry(f"+{wx + dx}+{wy + dy}")

    def on_release(self, e) -> None:
        moved = self.drag and self.drag[4]
        self.drag = None
        if moved:
            self.settings["x"], self.settings["y"] = self.root.winfo_x(), self.root.winfo_y()
            save_settings(self.settings)
        else:
            self.toggle()                                 # a click, not a drag

    def quit(self) -> None:
        engine.set_enabled(False)
        self.root.destroy()
        os._exit(0)                                       # the audio thread is a daemon; leave now

    def run(self) -> None:
        self.root.mainloop()


if __name__ == "__main__":
    print("--- MERGEN widget start ---", flush=True)
    Widget().run()
