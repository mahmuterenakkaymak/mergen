# Installs Strata and a Qwen3.8-Flash-Next build of your choice, configured for this stack.
# Safe to re-run: Strata's setup resumes downloads and keeps existing model files.
#
#   .\scripts\01-install-strata.ps1                 # arrow-key menu (pick for your RAM preselected) + download prompt
#   .\scripts\01-install-strata.ps1 -Model IQ3_S    # no questions
#   .\scripts\01-install-strata.ps1 -Model UD-IQ4_XS -SkipSetup   # register a build that is already installed
#
# To switch models later: run this again with another -Model, then .\scripts\03-configure-openclaw.ps1.
param([string]$Model = "", [switch]$SkipSetup, [string]$StrataDir = "$HOME\Strata")

# --- config -----------------------------------------------------------------
# $StrataDir (parameter above): model files go to <parent>\Strata-data
$StrataRepo    = "https://github.com/Niko1221/Strata.git"
$Context       = 262144                          # 131072 if you want the faster-to-fill 128K
$VramReserve   = 1500                            # MiB left free for the desktop (when the GPU drives a display)
$ConvCacheMiB  = 4096                            # keeps several agent conversations warm (8192 if RAM allows)
# -----------------------------------------------------------------------------
$ErrorActionPreference = "Stop"

# Every Qwen3.8-Flash-Next build Strata's setup offers (docs/MODELS.md in the Strata repo).
# MinRamGB is RAM + VRAM the build needs; Unsloth's builds read the experts that do not fit from the SSD.
$Catalog = @(
    [pscustomobject]@{ Model = "Q2_0";          Family = "qwen";    MinRamGB = 38; Note = "fastest, good quality" }
    [pscustomobject]@{ Model = "IQ2_XS";        Family = "qwen";    MinRamGB = 40; Note = "fast, better quality (Strata's pick for 48-64 GB)" }
    [pscustomobject]@{ Model = "IQ3_XXS";       Family = "qwen";    MinRamGB = 47; Note = "slower, great quality" }
    [pscustomobject]@{ Model = "IQ3_S";         Family = "qwen";    MinRamGB = 55; Note = "slowest 3-bit, matches the full model on published tests" }
    [pscustomobject]@{ Model = "UD-IQ4_XS";     Family = "unsloth"; MinRamGB = 80; DownloadGB = 94;  Note = "~4-bit, 94 GB download (this repo's tested setup)" }
    [pscustomobject]@{ Model = "UD-Q4_K_XL";    Family = "unsloth"; MinRamGB = 64; DownloadGB = 111; Note = "EXPERIMENTAL: 111 GB, NVIDIA + NVMe only, experts streamed from SSD" }
    [pscustomobject]@{ Model = "SWIFT-Q2_0";    Family = "swift";   MinRamGB = 38; Note = "Swift 1.5 fine-tune, thinks shorter" }
    [pscustomobject]@{ Model = "SWIFT-IQ2_XS";  Family = "swift";   MinRamGB = 40; Note = "Swift 1.5 fine-tune, thinks shorter" }
    [pscustomobject]@{ Model = "SWIFT-IQ3_XXS"; Family = "swift";   MinRamGB = 47; Note = "Swift 1.5 fine-tune, thinks shorter" }
    [pscustomobject]@{ Model = "CODER";         Family = "coder";   MinRamGB = 32; Note = "IQ1_M, best at code, weaker elsewhere; fits 32 GB" }
)

$ramGB = [math]::Round((Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory / 1GB)
$recommended = if ($ramGB -ge 90) { "UD-IQ4_XS" } elseif ($ramGB -ge 44) { "IQ2_XS" } else { "CODER" }

. (Join-Path $PSScriptRoot "menu.ps1")

$menuUsed = -not $Model
if ($menuUsed) {
    $rows = foreach ($c in $Catalog) {
        $mark = if ($c.Model -eq $recommended) { "  <- recommended" } elseif ($c.MinRamGB -gt $ramGB) { "  (needs $($c.MinRamGB) GB)" } else { "" }
        "{0,-14} {1,-8} {2}{3}" -f $c.Model, $c.Family, $c.Note, $mark
    }
    $dim = @(for ($i = 0; $i -lt $Catalog.Count; $i++) { if ($Catalog[$i].MinRamGB -gt $ramGB) { $i } })
    $i = Select-MenuItem "Qwen3.8-Flash-Next builds Strata can run (your RAM: $ramGB GB):" $rows ([array]::IndexOf($Catalog.Model, $recommended)) $dim
    if ($i -lt 0) { Write-Host "Cancelled, nothing installed."; exit 1 }
    $Model = $Catalog[$i].Model
}
# Invariant case: on a Turkish Windows "iq4".ToUpper() is "İQ4" (dotted I) and "IQ4".ToLower() is "ıq4".
$pick = $Catalog | Where-Object { $_.Model -eq $Model.ToUpperInvariant() } | Select-Object -First 1
if (-not $pick) { throw "Unknown model '$Model'. Choose one of: $($Catalog.Model -join ', ')" }
if ($pick.MinRamGB -gt $ramGB) {
    Write-Warning "$($pick.Model) needs about $($pick.MinRamGB) GB of RAM + VRAM and this PC has $ramGB GB of RAM: it may load very slowly or not at all."
}
# Strata's --model value: swift sizes drop the SWIFT- prefix; the Coder has a single size (setup picks it)
$strataModel = switch ($pick.Family) { "swift" { $pick.Model -replace '^SWIFT-', '' } "coder" { "" } default { $pick.Model } }
Write-Host "`nBuild: $($pick.Model) ($($pick.Family)), $($Context / 1024)K context"

if (-not $SkipSetup -and $menuUsed) {
    # Strata's docs give 94 / 111 GB for the Unsloth builds and ~70 GB for its own; files already there are kept.
    $size = if ($pick.DownloadGB) { "$($pick.DownloadGB) GB" } else { "up to ~70 GB" }
    $dataDir = Join-Path (Split-Path ([IO.Path]::GetFullPath($StrataDir)) -Parent) "Strata-data"
    $drive = [IO.DriveInfo]::new([IO.Path]::GetPathRoot($dataDir))
    $freeGB = [math]::Floor($drive.AvailableFreeSpace / 1GB)
    Write-Host "Download: $size into $dataDir ($($drive.Name) has $freeGB GB free). Resumable; files already there are kept."
    if (-not (Confirm-Step "Start the download?")) { Write-Host "Cancelled, nothing installed."; exit 1 }
}

if (-not $SkipSetup) {
    if (-not (Test-Path $StrataDir)) {
        git clone $StrataRepo $StrataDir
    }
    # Strata's own installer. Call it by full path: cmd does not search the current folder here.
    # Note: setup rewrites the run config (it keeps a .bak); the engine args below are re-applied after it.
    $modelArg = if ($strataModel) { "--model $strataModel" } else { "" }
    & cmd /c "`"$StrataDir\START-HERE.bat`" --setup --yes --family $($pick.Family) $modelArg --context $Context --vram-reserve-mib $VramReserve --no-start"
    if ($LASTEXITCODE -ne 0) { throw "Strata setup failed (exit $LASTEXITCODE). Rerun this script; it resumes." }
}

# The run config setup just wrote: strata-<family>-<model>.json (newest one for this family).
$config = Get-ChildItem $StrataDir -Filter "strata-$($pick.Family)-*.json" |
    Where-Object { -not $strataModel -or $_.Name -like "*-$($strataModel.ToLowerInvariant()).json" } |
    Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $config) { throw "Run config not found in $StrataDir" }

# Setup has no flag for the conversation cache, so add it to the run config's engine args, and read back the
# model name Strata will serve plus its log.
$python = if (Test-Path "$StrataDir\.venv\Scripts\python.exe") { "$StrataDir\.venv\Scripts\python.exe" } else { "python" }
$info = & $python -I -c @"
import json, sys
p = sys.argv[1]; mib = sys.argv[2]
c = json.load(open(p))
a = c['args']
if '--conversation-cache-mib' in a:
    a[a.index('--conversation-cache-mib') + 1] = mib
else:
    a += ['--conversation-cache-mib', mib]
json.dump(c, open(p, 'w'), indent=1)
print(json.dumps({'model_name': c['model_name'], 'log': c['log']}))
"@ $config.FullName $ConvCacheMiB | ConvertFrom-Json

$runBat = "run-" + ($config.BaseName -replace '^strata-', '') + ".bat"
if (-not (Test-Path "$StrataDir\$runBat")) { throw "Launcher $runBat not found in $StrataDir" }

# The active model, read by switch-mode.ps1, start-all.bat, MERGEN-START.bat and 02/03-configure.
[ordered]@{
    family = $pick.Family; model = $pick.Model; strata_dir = $StrataDir; run_bat = $runBat
    model_name = $info.model_name; log = $info.log; context = $Context
} | ConvertTo-Json | Set-Content (Join-Path $PSScriptRoot "..\config\active-model.json") -Encoding UTF8
@(
    "@rem written by 01-install-strata.ps1 - the active Strata model"
    "set `"STRATA_DIR=$StrataDir`""
    "set `"STRATA_RUN=$runBat`""
    "set `"STRATA_LOG=$($info.log)`""
    "set `"STRATA_MODEL=$($info.model_name)`""
) | Set-Content (Join-Path $PSScriptRoot "..\config\active-model.cmd") -Encoding ASCII

Write-Host "`nStrata is installed: $($info.model_name)"
Write-Host "Next: .\scripts\02-install-openclaw.ps1 (first install) or .\scripts\03-configure-openclaw.ps1 (model switch)"
