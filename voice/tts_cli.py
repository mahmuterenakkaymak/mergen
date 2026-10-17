"""Text-to-speech CLI for OpenClaw's tts-local-cli provider (voice replies on Telegram), fully local on the CPU.

OpenClaw runs:  voice\.venv\Scripts\python.exe voice\tts_cli.py {{OutputPath}} {{Text}}
and expects a WAV file at OutputPath; it converts it for the channel (Telegram voice note).
Voice (voice_lang.py): Piper tr_TR dfki (CC BY-NC-SA 4.0 - personal use only) or en_US ljspeech (public-domain data).
"""
import os
import re
import sys
import wave

import numpy as np
from piper import PiperVoice

import voice_lang as L

# --- config -----------------------------------------------------------------
VOICE = L.PIPER_VOICE
MAX_CHARS = 1500                    # long replies: the voice note covers the start, the text has the rest
# -----------------------------------------------------------------------------


def speakable(text: str) -> str:
    """Strip Markdown, code, links and emoji so the voice reads only words (same rules as mergen_voice)."""
    text = re.sub(r"```.*?```", L.T["code_in_message"], text, flags=re.S)
    text = re.sub(r"`([^`]*)`", r"\1", text)
    text = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", text)
    text = re.sub(r"https?://\S+", "link", text)
    text = re.sub(r"[*_#>|]+", " ", text)
    text = re.sub(r"[^\w\s.,;:!?%'()\-/çğıöşüÇĞİÖŞÜ]", " ", text)
    text = re.sub(r"\s+", " ", text).strip()
    if len(text) > MAX_CHARS:
        text = text[:MAX_CHARS].rsplit(".", 1)[0] + L.T["rest_in_message"]
    return text


def main() -> int:
    if len(sys.argv) < 3:
        print("usage: tts_cli.py <output.wav> <text>", file=sys.stderr)
        return 2
    out, text = sys.argv[1], " ".join(sys.argv[2:])
    voice = PiperVoice.load(VOICE)
    audio = np.concatenate([c.audio_float_array for c in voice.synthesize(speakable(text) or L.T["okay"])])
    with wave.open(out, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(voice.config.sample_rate)
        w.writeframes((np.clip(audio, -1, 1) * 32767).astype("<i2").tobytes())
    return 0


if __name__ == "__main__":
    sys.exit(main())
