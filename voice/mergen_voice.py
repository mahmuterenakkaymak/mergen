"""MERGEN voice: talk to OpenClaw in Turkish; the reply is printed and spoken.

Two ways to talk (both active at the same time):
  - push-to-talk: hold F9, speak, release;
  - wake word: say "Mergen, ..." - the mic listens continuously, a small Whisper model checks each utterance for
    the name, and only then the large model transcribes it. "Mergen" alone -> it answers "Efendim" and takes the
    next sentence as the command.

Speech-to-text (faster-whisper) and text-to-speech (Piper) run locally on the CPU - no VRAM, no audio leaves the PC.
The Turkish Piper voice (dfki) is CC BY-NC-SA 4.0: personal use only, not for monetized videos.

Run:  voice\.venv\Scripts\python.exe voice\mergen_voice.py      (or voice\mergen-voice.bat)
"""
import collections
import difflib
import os
import queue
import re
import subprocess
import sys
import time

import keyboard
import numpy as np
import sounddevice as sd
from faster_whisper import WhisperModel
from piper import PiperVoice

# --- config -----------------------------------------------------------------
HOTKEY = "f9"                       # hold to talk
WAKE_WORD = True                    # also listen for "Mergen, ..." (mic always on, all local)
WAKE_NAME = "mergen"
WAKE_SIMILARITY = 0.7               # fuzzy match for Whisper spellings like "Mercen", "Merken", "Bergen"
WAKE_POSITION = 3                   # the name may be one of the first 3 words ("hey Mergen", noise + "Mergen")
WAKE_MODEL = "small"                # fast model that only looks for the name (~480 MB; "base" missed it often)
FOLLOWUP_S = 8                      # after "Mergen" alone: seconds to wait for the command
LONE_NAME_S = 1.2                   # utterances shorter than this that start with the name = "Mergen" alone
LANGUAGE = "tr"
MODEL = "large-v3-turbo"            # transcribes the actual command (~1.6 GB)
COMPUTE_TYPE = "int8"
CPU_THREADS = 12                    # 16 cores: leave 4 for Strata and the desktop
SAMPLE_RATE = 16000
BLOCK_S = 0.05                      # 50 ms audio blocks
INPUT_DEVICE = "QuadCast"           # part of the mic's name; None = Windows default
OUTPUT_DEVICE = "USB Audio CODEC"   # part of the speakers' name; None = Windows default
# Devices are opened through WASAPI at their own sample rate: on this PC the QuadCast delivers only silence through
# the old MME API, and the USB DAC drops audio that isn't at 44.1/48 kHz.
START_RMS = None                    # speech energy threshold; None = calibrate from 1 s of room noise at start
MIN_START_RMS = 0.008               # floor for the calibrated threshold. QuadCast: room noise 0.001-0.005,
                                    # speech 0.013-0.03 (its noise gate makes calibration read ~0, so the floor rules)
MAX_START_RMS = 0.02                # cap: normal speech on the QuadCast is ~0.013-0.03
CALIBRATE_FACTOR = 6                # threshold = this x the median 50 ms of room noise
MAX_WORDS_PER_S = 5                 # more than this = Whisper hallucination ("Mergen Mergen Mergen ...")
SILENCE_END_S = 1.0                 # this much quiet ends an utterance (0.6 split "Mergen, <pause> komut" in two)
PREROLL_S = 0.4                     # audio kept from before speech started, so the first syllable isn't cut
MIN_SECONDS = 0.4                   # ignore clicks and short noises
MAX_UTTERANCE_S = 20
SESSION_ID = "mergen-voice"         # one OpenClaw session, so follow-up commands keep context
OPENCLAW = "openclaw.cmd" if sys.platform == "win32" else "openclaw"
AGENT_TIMEOUT_S = 900
SPEAK = True                        # read replies aloud
VOICE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "models", "tr_TR-dfki-medium.onnx")
SPEAK_MAX_CHARS = 700               # long replies: speak the start, the full text stays on screen
# -----------------------------------------------------------------------------

blocks: "queue.Queue[np.ndarray]" = queue.Queue()
muted = False                       # True while MERGEN speaks or thinks, so it doesn't hear itself
enabled = True                      # the widget / Ctrl+Alt+M turns listening off and on
threshold = MIN_START_RMS           # set by calibrate() when listening starts
status_cb = None                    # called with "dinliyor" | "duydum" | "düşünüyor" | "konuşuyor" | "kapalı"
last_exchange = ("", "")            # (what the user said, what MERGEN answered)


def find_device(part: str | None, kind: str) -> int:
    """WASAPI device index whose name contains `part` (or the WASAPI default device)."""
    channels = "max_input_channels" if kind == "input" else "max_output_channels"
    wasapi = next((i for i, h in enumerate(sd.query_hostapis()) if h["name"] == "Windows WASAPI"), None)
    if part:
        for i, d in enumerate(sd.query_devices()):
            if d[channels] > 0 and d["hostapi"] == wasapi and part.lower() in d["name"].lower():
                return i
        print(f"[audio] no WASAPI {kind} device matching '{part}', using the default", flush=True)
    key = "default_input_device" if kind == "input" else "default_output_device"
    if wasapi is not None and sd.query_hostapis(wasapi)[key] >= 0:
        return sd.query_hostapis(wasapi)[key]
    return sd.default.device[0 if kind == "input" else 1]


def to_16k(x: np.ndarray, rate: int) -> np.ndarray:
    """Resample mono float audio to 16 kHz (Whisper's rate)."""
    if rate == SAMPLE_RATE:
        return x
    n = int(round(len(x) * SAMPLE_RATE / rate))
    return np.interp(np.linspace(0, len(x) - 1, n), np.arange(len(x)), x).astype("float32")


def set_status(state: str) -> None:
    if status_cb:
        status_cb(state)


def set_enabled(on: bool) -> None:
    global enabled
    enabled = on
    drain()
    if not on:
        sd.stop()                                             # stop talking too
    set_status("dinliyor" if on else "kapalı")


mic_rate = SAMPLE_RATE              # the mic's own rate; blocks are resampled to 16 kHz as they arrive


def on_audio(data, frames, t, status) -> None:
    if enabled and not muted:
        blocks.put(to_16k(data[:, 0].copy(), mic_rate))


def drain() -> None:
    while not blocks.empty():
        blocks.get_nowait()


def transcribe(model: WhisperModel, audio: np.ndarray, beam: int = 5, bias: bool = False) -> str:
    # bias=True nudges Whisper toward the name: catches "Mergen" reliably, but also turns "Meryem" into "Mergen".
    # So the wake check is biased (sensitive) and the confirmation is unbiased (strict).
    extra = {"hotwords": "Mergen", "initial_prompt": "Mergen,"} if bias else {}
    # vad_filter=False: we already cut utterances ourselves, and Whisper's VAD deleted short clips like a lone
    # "Mergen" (1.1 s, clearly audible) entirely.
    segments, _ = model.transcribe(audio, language=LANGUAGE, beam_size=beam, vad_filter=False,
                                   condition_on_previous_text=False, **extra)
    text = " ".join(s.text.strip() for s in segments).strip()
    return text if plausible(text, len(audio) / SAMPLE_RATE) else ""


def plausible(text: str, seconds: float) -> bool:
    """Reject Whisper hallucinations on noise: too many words for the audio, or a word repeated 3+ times in a row."""
    words = re.findall(r"[\wçğıöşüÇĞİÖŞÜ]+", text.lower())
    if not words:
        return True
    if len(words) > max(3, seconds * MAX_WORDS_PER_S):
        return False
    return not any(words[i] == words[i + 1] == words[i + 2] for i in range(len(words) - 2))


def strip_wake(text: str) -> str | None:
    """If the name (fuzzy) is among the first WAKE_POSITION words, return what follows it (may be ''); else None.
    Not only the first word: a filler ("hey", "şey") or a noise fragment often lands before it."""
    for i, m in enumerate(re.finditer(r"[\wçğıöşüÇĞİÖŞÜ]+", text)):
        if i >= WAKE_POSITION:
            return None
        word = m.group().lower().replace("ı", "i")
        if difflib.SequenceMatcher(None, word, WAKE_NAME).ratio() >= WAKE_SIMILARITY:
            return re.sub(r"^\W*", "", text[m.end():]).strip()
    return None


def next_utterance(timeout_s: float | None = None) -> tuple[np.ndarray, bool]:
    """Wait for speech (or F9) and return (audio, was_push_to_talk). Empty audio on timeout."""
    started, quiet, buf = False, 0.0, []
    preroll: "collections.deque[np.ndarray]" = collections.deque(maxlen=int(PREROLL_S / BLOCK_S))
    deadline = time.time() + timeout_s if timeout_s else None
    while True:
        if enabled and keyboard.is_pressed(HOTKEY):           # push-to-talk wins
            drain()
            buf = []
            while keyboard.is_pressed(HOTKEY):
                buf.append(blocks.get())
            return (np.concatenate(buf) if buf else np.zeros(0, "float32")), True
        try:
            b = blocks.get(timeout=0.1)
        except queue.Empty:
            if deadline and not started and time.time() > deadline:
                return np.zeros(0, "float32"), False
            continue
        loud = float(np.sqrt(np.mean(b * b))) > threshold
        if not started:
            if loud:
                started, buf = True, [*preroll, b]           # keep the quiet first syllable ("M...")
            else:
                preroll.append(b)
            if not started and deadline and time.time() > deadline:
                return np.zeros(0, "float32"), False
            continue
        buf.append(b)
        quiet = 0.0 if loud else quiet + BLOCK_S
        if quiet >= SILENCE_END_S or len(buf) * BLOCK_S >= MAX_UTTERANCE_S:
            return np.concatenate(buf), False


def speakable(text: str) -> str:
    """Strip Markdown, code and links so the voice reads only words."""
    text = re.sub(r"```.*?```", " (kod ekranda) ", text, flags=re.S)
    text = re.sub(r"`([^`]*)`", r"\1", text)
    text = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", text)          # [label](url) -> label
    text = re.sub(r"https?://\S+", "link", text)
    text = re.sub(r"[*_#>|]+", " ", text)
    text = re.sub(r"[^\w\s.,;:!?%'()\-/çğıöşüÇĞİÖŞÜ]", " ", text)   # emoji and symbols
    text = re.sub(r"\s+", " ", text).strip()
    if len(text) > SPEAK_MAX_CHARS:
        text = text[:SPEAK_MAX_CHARS].rsplit(".", 1)[0] + ". Devamı ekranda."
    return text


def speak(voice: "PiperVoice | None", text: str) -> None:
    """Play the reply with the mic muted; holding F9 interrupts it."""
    global muted
    if not voice or not text:
        return
    chunks = [c.audio_float_array for c in voice.synthesize(speakable(text))]
    if not chunks:
        return
    audio = np.concatenate(chunks)
    seconds = len(audio) / voice.config.sample_rate
    out = find_device(OUTPUT_DEVICE, "output")
    info = sd.query_devices(out)
    # Piper speaks at 22,050 Hz; many USB devices only take 44.1/48 kHz and silently drop other rates.
    rate = int(info["default_samplerate"])
    if rate != voice.config.sample_rate:
        x = np.linspace(0, len(audio) - 1, int(len(audio) * rate / voice.config.sample_rate))
        audio = np.interp(x, np.arange(len(audio)), audio).astype("float32")
    print(f"[speak] {seconds:.1f}s audio -> '{info['name']}' at {rate} Hz", flush=True)
    muted = True
    result = "done"
    try:
        sd.play(audio, rate, device=out)
        end = time.time() + seconds
        while time.time() < end:
            if keyboard.is_pressed(HOTKEY) or not enabled:
                result = "interrupted (F9 or turned off)"
                break
            time.sleep(0.05)
        sd.stop()
        time.sleep(0.2)                                       # let the room echo die down
    except Exception as e:                                    # never let a playback error kill the voice loop
        result = f"error: {e!r}"
    finally:
        drain()
        muted = False
        print(f"[speak] {result}", flush=True)


def ask_openclaw(text: str) -> str:
    global muted
    muted = True                                              # don't collect audio while waiting
    try:
        result = subprocess.run(
            [OPENCLAW, "agent", "--session-id", SESSION_ID, "-m", text],
            capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=AGENT_TIMEOUT_S,
        )
    finally:
        drain()
        muted = False
    reply = result.stdout.strip()
    if result.returncode != 0 and not reply:
        reply = f"[OpenClaw error] {result.stderr.strip()[-500:]}"
    return reply


def handle(command: str, model_time: float, seconds: float, voice) -> None:
    global last_exchange
    print(f"Sen ({seconds:.1f} sn, yazıya çevirme {model_time:.1f} sn): {command}", flush=True)
    set_status("düşünüyor")
    t0 = time.time()
    reply = ask_openclaw(command)
    print(f"MERGEN ({time.time() - t0:.0f} sn): {reply}\n", flush=True)
    last_exchange = (command, reply)
    if enabled:                                               # turned off while thinking -> stay quiet
        set_status("konuşuyor")
        speak(voice, reply)
    set_status("dinliyor" if enabled else "kapalı")


def load_models():
    print(f"Loading speech models on the CPU ('{MODEL}'" + (f" + '{WAKE_MODEL}'" if WAKE_WORD else "") + ")...", flush=True)
    model = WhisperModel(MODEL, device="cpu", compute_type=COMPUTE_TYPE, cpu_threads=CPU_THREADS)
    wake = WhisperModel(WAKE_MODEL, device="cpu", compute_type=COMPUTE_TYPE, cpu_threads=4) if WAKE_WORD else None
    voice = PiperVoice.load(VOICE) if SPEAK else None
    return model, wake, voice


def main() -> None:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")   # Turkish text even when output is piped
    model, wake, voice = load_models()
    how = f"[{HOTKEY.upper()}] basılı tut" + (' ya da "Mergen, ..." de' if WAKE_WORD else "")
    print(f"\nMERGEN dinliyor: {how}. Çıkış: Ctrl+C\n", flush=True)
    listen(model, wake, voice)


def calibrate(device, rate: int) -> float:
    """Threshold from 1 s of room noise, so quiet and loud mics both work."""
    if START_RMS:
        return START_RMS
    a = sd.rec(rate, samplerate=rate, channels=1, dtype="float32", device=device)
    sd.wait()
    a = to_16k(a[:, 0], rate)
    b = a[: len(a) // 800 * 800].reshape(-1, 800)
    noise = float(np.median(np.sqrt((b * b).mean(axis=1))))   # median: someone talking during the second
    if noise < 0.0002:                                         # must not push the threshold up (it hit 0.43)
        print("[audio] note: the mic reads ~0 in silence (noise gate) - the floor threshold is used", flush=True)
    return min(MAX_START_RMS, max(MIN_START_RMS, noise * CALIBRATE_FACTOR))


def listen(model, wake, voice) -> None:
    """The listening loop; runs forever (the widget runs it in a background thread)."""
    global threshold, mic_rate
    mic = find_device(INPUT_DEVICE, "input")
    info = sd.query_devices(mic)
    mic_rate = int(info["default_samplerate"])
    threshold = calibrate(mic, mic_rate)
    print(f"[audio] listening on '{info['name']}' ({mic_rate} Hz, WASAPI), speech threshold RMS {threshold:.4f}",
          flush=True)
    set_status("dinliyor" if enabled else "kapalı")
    with sd.InputStream(samplerate=mic_rate, channels=1, dtype="float32", device=mic,
                        blocksize=int(mic_rate * BLOCK_S), callback=on_audio):
        while True:
            audio, ptt = next_utterance()
            seconds = len(audio) / SAMPLE_RATE
            if seconds < MIN_SECONDS or not enabled:
                continue
            level = float(np.sqrt(np.mean(audio * audio)))
            print(f"[audio] utterance {seconds:.1f}s, RMS {level:.4f}{' (F9)' if ptt else ''}", flush=True)

            if ptt:
                set_status("duydum")
                t0 = time.time()
                text = transcribe(model, audio)
                if text:
                    handle(text, time.time() - t0, seconds, voice)
                else:
                    print("(anlaşılamadı)", flush=True)
                    set_status("dinliyor")
                continue

            if not wake:
                continue
            # Stage 1 (cheap, sensitive): small model, biased toward the name.
            heard = transcribe(wake, audio, beam=1, bias=True)
            hit = strip_wake(heard) is not None
            # Privacy: speech that was not addressed to MERGEN is never written anywhere - only that it was ignored.
            print(f"[wake] stage 1: {('hit: ' + repr(heard)) if hit else 'ignored (not addressed to MERGEN)'}",
                  flush=True)
            if not hit:
                continue
            set_status("duydum")
            t0 = time.time()
            if seconds < LONE_NAME_S:
                # A lone short "Mergen": the unbiased big model misses it about half the time, and a false hit
                # here only costs an "Efendim?", so stage 1 is enough.
                command = ""
            else:
                # Stage 2 (strict): big model, unbiased, also gives the accurate command text.
                full = transcribe(model, audio)
                command = strip_wake(full)
                print(f"[wake] stage 2: {('command: ' + repr(full)) if command is not None else 'rejected'}",
                      flush=True)
                if command is None:                            # e.g. "Meryem ..." - not for us
                    set_status("dinliyor")
                    continue
            if not command:                                    # just "Mergen" -> wait for the command
                print("MERGEN: Efendim?", flush=True)
                speak(voice, "Efendim?")
                set_status("dinliyor")
                follow, _ = next_utterance(timeout_s=FOLLOWUP_S)
                if len(follow) / SAMPLE_RATE < MIN_SECONDS:
                    continue
                set_status("duydum")
                t0, seconds = time.time(), len(follow) / SAMPLE_RATE
                command = transcribe(model, follow)
                if not command:
                    set_status("dinliyor")
                    continue
            handle(command, time.time() - t0, seconds, voice)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\nGörüşürüz.")
