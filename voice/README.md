# Voice

**MERGEN Voice** (`mergen-voice.bat`, also started by `MERGEN-START.bat`) opens a small always-on-top widget
(bottom-right, no console). The dot shows the state: green listening, grey off, amber thinking, purple speaking.
Click it or press **Ctrl+Alt+M** to turn listening on/off; drag to move; right-click for the last exchange, the log
folder (`%LOCALAPPDATA%\mergen\voice.log`) and quit.

Two ways to talk while it is on:

- **Wake word:** say **"Mergen, <komut>"** in one sentence. A `small` Whisper model (biased toward the name) checks each
  utterance in ~0.8 s; a hit is confirmed by `large-v3-turbo` without the bias, which also transcribes the command.
  "Mergen" alone -> it answers "Efendim?" and takes the next sentence. A lone short "Mergen" is less reliable than
  "Mergen, ..." in one sentence.
- **Push-to-talk:** hold **F9**, speak, release.

The reply is printed and read aloud with Piper's Turkish `dfki` voice (Markdown, code and emoji stripped; F9
interrupts). The mic is muted while MERGEN thinks and speaks. Everything runs on the CPU, no audio leaves the PC, and
speech that is not addressed to MERGEN is never written to the log.

## Setup

```powershell
uv venv voice\.venv --python 3.11
uv pip install --python voice\.venv\Scripts\python.exe -r voice\requirements.txt
```

Then put `tr_TR-dfki-medium.onnx` and `tr_TR-dfki-medium.onnx.json` from
[rhasspy/piper-voices](https://huggingface.co/rhasspy/piper-voices) (`tr/tr_TR/dfki/medium`) in `voice\models`.

## Tuning (top of `mergen_voice.py`)

| Setting | What |
|---|---|
| `INPUT_DEVICE` / `OUTPUT_DEVICE` | part of your mic's / speakers' name (set to your devices; `None` = Windows default), matched on WASAPI - MME delivered silence from a USB mic |
| `WAKE_WORD` | `True` = also listen for "Mergen, ..."; `False` = F9 only |
| `MIN_START_RMS` / `MAX_START_RMS` | bounds of the auto-calibrated speech threshold; raise in a noisy room |
| `SILENCE_END_S` | pause that ends an utterance |
| `HOTKEY` | push-to-talk key |

## Licenses

faster-whisper and the Whisper weights are MIT. The `tr_TR-dfki` Piper voice is **CC BY-NC-SA 4.0**: personal use is
fine, monetized content is not.

`transcribe_cli.py` turns chat voice notes (Telegram) into text for OpenClaw; `tts_cli.py` writes Piper WAVs for
OpenClaw's local TTS.
