# Known issues

Problems hit while setting this up on Windows 11, with the cause and the fix.

## 1. Windows commit limit

**Symptom:** Strata logs `WARNING the Windows commit limit is 99.6 GiB (RAM + page file) and 3.2 GiB of it is left`.
It may exit with no message (0xC0000409) under load, even with free RAM.

**Cause:** commit limit = RAM + page file. The system-managed page file was 6 GB.

**Fix:** `Win+R` -> `sysdm.cpl` -> Advanced -> Performance **Settings...** -> Advanced -> Virtual memory **Change...**
-> untick *Automatically manage paging file size for all drives* -> C: -> **Custom size** 65536 / 65536 -> **Set** ->
OK -> restart. Check: `(Get-CimInstance Win32_OperatingSystem).TotalVirtualMemorySize / 1MB` should be ~157.

## 2. OpenClaw 2026.9.9 and newer: state database lock on Windows

**Symptom:** every command that touches state fails with
`OpenClaw state at ...\.openclaw\state\openclaw.sqlite is undergoing offline maintenance; retry when it finishes.`

**Checked:** happens with an empty `~/.openclaw`, inside `doctor --lint`'s own temporary state folder, and with Node
24.15 and 24.21. Process start-time lookup (the usual Windows lock problem) works. Seen on 2026.9.9 and 2026.10.3
(released 2026-10-13).

**Fix:** pin `openclaw@2026.8.35` (the `extended-stable` dist-tag). Retry newer releases with
`npm install -g openclaw@latest --allow-scripts=openclaw` then `openclaw doctor --lint`; if the message is gone,
update the pins in `scripts/02` and `scripts/03`.

## 3. OpenClaw latest needs Node >= 24.16

**Symptom:** `npm install -g openclaw@latest` fails in preinstall: `requires Node >=24.16.0 <25 || >=26.1.0`.

**Fix (nvm-windows):** `nvm install 24` then `nvm use 24.21.0` (the version it printed).

## 4. Low free VRAM

**Symptom:** `WARNING: only 436 MiB of VRAM free at the start of this request`.

**Cause:** the 5090 also drives the display. **Fix:** `--vram-reserve-mib 1500` (in `scripts/01`).

## 5. `cmd /c START-HERE.bat` is "not recognized"

`cmd` here does not search the current folder for programs. Call the script by full path (done in `scripts/01`).

## 6. Gateway Scheduled Task pointing at a deleted Node

**Symptom:** `openclaw gateway status` says the service was installed by an older version; the task runs
`C:\Program Files\nodejs\node.exe`, which no longer exists after moving to nvm.

**Fix:** `openclaw gateway install --force --port 18789` rewrites the task for the current CLI and Node.

## 7. Local memory needs one interactive step

`openclaw configure` has no flag for the managed llama.cpp embedding server. In the wizard, answer **No** to
"download Gemma 4 E4B (about 5.0 GB) plus ..." (that would replace Strata as the chat model) and **Yes** to
"download only the local embedding model". If you said Yes by mistake: Ctrl+C during the download; nothing is
written to the config until it finishes. Delete the leftover `~/.openclaw/models/llama.cpp/*.partial-*` file.

## 8. Incident: the agent moved the whole Documents folder (2026-10-15)

**What happened:** testing the `windows-assistant` skill ("create a folder in Downloads, move it to Documents"), the
agent ran `powershell -Command "... Move-Item $src '%USERPROFILE%\Documents\' ..."`. OpenClaw's exec shell expanded
`$src` to an empty string, so the command became `Move-Item '%USERPROFILE%\Documents\'` with no destination, and
PowerShell moved all of Documents into the agent's working folder `~\.openclaw\workspace\Documents`. Nothing was
deleted; it was restored by renaming the folder back (`restore-documents.ps1`, 58,990 items, counts matched).

**Fixes in the skill:** variables only in `.ps1` files run with `-File`; always both `-Path` and `-Destination` as
full literal paths; never move/rename/delete a top-level user folder; stop and report when a result looks wrong; ask
before every delete and move unless the user named both the exact item and the destination.

**Limit:** OpenClaw 2026.8.35's exec approvals match the program (`powershell.exe`), not the command text, so
"ask only for Move-Item/Remove-Item" cannot be enforced by OpenClaw itself; the rule lives in the skill. Turn on
Windows File History for Documents as a safety net.

## 9. Windows script encoding and line endings

- `.bat`/`.cmd` files with LF line endings misbehave in `cmd` (lines run out of order, `if errorlevel` skipped):
  keep them CRLF.
- Windows PowerShell 5.1 reads UTF-8 files **without BOM** as ANSI (`·` shows as `Â·`): save `.ps1` as UTF-8 with BOM.
- A program started with `-WindowStyle Hidden` also hides its first window (a WinForms form). The mode panel hides its
  own console instead.

## 10. Claude Code login expires

`claude -p` (cloud) failed with `401 OAuth access token has expired`. Run `claude`, then `/login` once.
`claude-local` is not affected (it never talks to Anthropic).

## 11. Voice: Windows audio traps (fixed in voice/)

- **QuadCast 2 gives silence through MME** (the PortAudio default); through WASAPI at 48 kHz it works. The voice app
  opens devices via WASAPI at their native rate and resamples to 16 kHz itself.
- **USB DAC dropped 22,050 Hz audio silently** (Piper's rate): replies are resampled to the device's own rate.
- **WASAPI stream fails in a background thread** (`WdmSyncIoctl ... GLE 0x490`) unless that thread called
  `CoInitializeEx(None, COINIT_MULTITHREADED)`; with STA it records silence. The widget's engine thread does this.
- Devices are pinned in `voice/mergen_voice.py`: `INPUT_DEVICE = "QuadCast"`, `OUTPUT_DEVICE = "USB Audio CODEC"`.
  Check what it uses in `%LOCALAPPDATA%\mergen\voice.log` (`[audio] listening on ...`, `[speak] ... -> ...`).
- Live test 2026-10-15: "Mergen, saat kaç?" -> heard (RMS 0.019), transcribed in 2.6 s, answered in 13 s, 4.9 s of
  speech played on the USB DAC.

## 12. Stale user env vars broke the cloud brain when started from OpenClaw

User-level `ANTHROPIC_BASE_URL=http://localhost:8001`, `CLAUDE_CODE_USE_LOCAL=1`, `CLAUDE_CODE_LOCAL_URL=...` (left
from an old local-proxy setup; nothing listens on 8001). The Claude desktop app overrides them, OpenClaw does not, so
`claude -p` started by MERGEN failed with `ECONNREFUSED` and the plan had 0 tasks. `hybrid_run.py` now strips these
for the brain and sets explicit values for the hands. The same variables also break a plain `claude` in a normal
terminal - remove them from the user environment if that old setup is no longer used.
