"""Speech-to-text CLI for OpenClaw's inbound voice notes (Telegram etc.), fully local on the CPU.

OpenClaw calls it as a tools.media.models entry of type "cli":
    voice\.venv\Scripts\python.exe voice\transcribe_cli.py {{AttachmentPath}}
and expects plain text on stdout and exit code 0. Telegram voice notes are OGG/Opus; faster-whisper decodes them
with its bundled PyAV, so no ffmpeg is needed.
"""
import sys

from faster_whisper import WhisperModel

import voice_lang as L

# --- config -----------------------------------------------------------------
MODEL = "large-v3-turbo"
LANGUAGE = None if L.CODE == "none" else L.T["whisper"]   # None = Whisper detects the language
COMPUTE_TYPE = "int8"
CPU_THREADS = 12
# -----------------------------------------------------------------------------


def main() -> int:
    if len(sys.argv) != 2:
        print("usage: transcribe_cli.py <audio file>", file=sys.stderr)
        return 2
    sys.stdout.reconfigure(encoding="utf-8")
    model = WhisperModel(MODEL, device="cpu", compute_type=COMPUTE_TYPE, cpu_threads=CPU_THREADS)
    segments, _ = model.transcribe(sys.argv[1], language=LANGUAGE, beam_size=5, vad_filter=True,
                                   hotwords="Mergen")
    print(" ".join(s.text.strip() for s in segments).strip())
    return 0


if __name__ == "__main__":
    sys.exit(main())
