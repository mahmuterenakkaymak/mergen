# Switches the GPU between three modes. Only one heavy workload owns the 32 GB card at a time.
#
#   agent    - Strata (the Qwen3.8-Flash-Next build chosen in 01-install-strata.ps1) for OpenClaw.
#   creative - Unsloth Studio (Qwen3.8-27B Q4, ~17-18 GB) in WSL + ComfyUI desktop. OpenClaw uses the 27B.
#   free     - everything AI stopped: games, fine-tuning, recording.
#
# Usage:  powershell -ExecutionPolicy Bypass -File switch-mode.ps1 -Mode agent|creative|free|status

param([ValidateSet("agent", "creative", "free", "status")][string]$Mode = "status")

# --- config -----------------------------------------------------------------
$Active          = Get-Content (Join-Path $PSScriptRoot "..\config\active-model.json") -Raw | ConvertFrom-Json   # 01-install-strata.ps1
$StrataDir       = $Active.strata_dir
$StrataRun       = $Active.run_bat
$StrataHealth    = "http://127.0.0.1:8080/health"
$StrataModelRef  = "strata/$($Active.model_name)"

$WslDistro       = "Ubuntu"
$WslUser         = if ($env:MERGEN_WSL_USER) { $env:MERGEN_WSL_USER } else { (wsl.exe -e whoami).Trim() }   # your WSL user
$UnslothModel    = "unsloth/Qwen3.8-27B-GGUF"
$UnslothVariant  = "UD-Q4_K_XL"          # the 4-bit file you use in Unsloth Studio
$UnslothContext  = 65536
$UnslothKeyName  = "openclaw"            # Unsloth reuses the same API key for this label on every run
$UnslothHealth   = "http://127.0.0.1:8888/v1/models"
$UnslothModelRef = "unsloth/qwen3.8-27b"

$ComfyExe        = "$env:LOCALAPPDATA\Programs\ComfyUI\ComfyUI.exe"
$ComfyBase       = "$HOME\Documents\ComfyUI"

$LoadTimeoutS    = 600
# -----------------------------------------------------------------------------
$ErrorActionPreference = "Continue"

function Test-Url($url, $headers = @{}) {
    try { Invoke-WebRequest -UseBasicParsing -TimeoutSec 3 -Headers $headers $url | Out-Null; $true } catch { $false }
}
function Test-StrataLoaded {
    try { (Invoke-WebRequest -UseBasicParsing -TimeoutSec 3 $StrataHealth).Content -match '"loaded": true' } catch { $false }
}
function Wait-Until([scriptblock]$cond, [string]$what) {
    $deadline = (Get-Date).AddSeconds($LoadTimeoutS)
    while ((Get-Date) -lt $deadline) { if (& $cond) { return $true }; Start-Sleep 5 }
    Write-Warning "$what did not come up within $LoadTimeoutS s"; $false
}

function Stop-Strata {
    Get-CimInstance Win32_Process | Where-Object {
        $_.Name -eq 'strata.exe' -or
        ($_.Name -match 'python' -and $_.CommandLine -match 'serve\\server.py') -or
        ($_.Name -eq 'cmd.exe' -and $_.CommandLine -match [regex]::Escape($StrataRun))
    } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
}
function Start-Strata {
    if (Test-StrataLoaded) { Write-Host "Strata already running"; return $true }
    Write-Host "Starting Strata (1-3 min; the PC can stutter while ~55 GB loads)..."
    Start-Process -FilePath "$StrataDir\$StrataRun" -WorkingDirectory $StrataDir
    Wait-Until { Test-StrataLoaded } "Strata"
}

function Stop-Unsloth {
    # The studio and its llama-server child run inside WSL.
    wsl -d $WslDistro -u $WslUser -- bash -lc "pkill -f 'unsloth studio' ; pkill -f 'unsloth run' ; pkill -f llama-server ; true" 2>$null
}
function Start-Unsloth {
    $key = [Environment]::GetEnvironmentVariable("UNSLOTH_API_KEY", "User")
    if (-not $key) {
        Write-Warning ("UNSLOTH_API_KEY is not set. Run once in WSL:  unsloth studio run --model $UnslothModel " +
            "--gguf-variant $UnslothVariant --api-key-name $UnslothKeyName   then copy the printed key into: " +
            '[Environment]::SetEnvironmentVariable("UNSLOTH_API_KEY", "<key>", "User")  and run this mode again.')
        return $false
    }
    if (Test-Url $UnslothHealth @{ Authorization = "Bearer $key" }) { Write-Host "Unsloth Studio already running"; return $true }
    Write-Host "Starting Unsloth Studio with $UnslothModel ($UnslothVariant) in WSL..."
    $cmd = "unsloth studio run --model $UnslothModel --gguf-variant $UnslothVariant --max-seq-length $UnslothContext --api-key-name $UnslothKeyName"
    Start-Process -FilePath "wsl.exe" -ArgumentList "-d", $WslDistro, "-u", $WslUser, "--", "bash", "-lc", "`"$cmd`""
    Wait-Until { Test-Url $UnslothHealth @{ Authorization = "Bearer $key" } } "Unsloth Studio"
}

function Stop-Comfy {
    Get-CimInstance Win32_Process | Where-Object {
        $_.Name -eq 'ComfyUI.exe' -or ($_.Name -match 'python' -and $_.CommandLine -match [regex]::Escape($ComfyBase))
    } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
}
function Start-Comfy {
    if (Get-Process ComfyUI -ErrorAction SilentlyContinue) { Write-Host "ComfyUI already running"; return }
    Write-Host "Starting ComfyUI desktop..."
    Start-Process -FilePath $ComfyExe
}

function Ensure-UnslothProvider {
    # Added only when the key exists: an unresolved env SecretRef makes every openclaw command fail.
    $null = openclaw config get models.providers.unsloth 2>$null
    if ($LASTEXITCODE -eq 0) { return }
    $json = '{"baseUrl":"http://127.0.0.1:8888/v1","api":"openai-completions",' +
            '"apiKey":{"source":"env","provider":"default","id":"UNSLOTH_API_KEY"},"timeoutSeconds":900,' +
            '"models":[{"id":"qwen3.8-27b","name":"Unsloth Qwen3.8 27B (Q4)","contextWindow":' + $UnslothContext +
            ',"maxTokens":8192,"reasoning":true,"input":["text","image"],' +
            '"cost":{"input":0,"output":0,"cacheRead":0,"cacheWrite":0}}]}'
    openclaw config set models.providers.unsloth --strict-json $json | Out-Null
}
function Set-OpenClawModel($ref) {
    openclaw models set $ref | Out-Null
    openclaw gateway restart | Out-Null
    Write-Host "OpenClaw default model: $ref"
}

function Show-Status {
    $gpu = nvidia-smi --query-gpu=memory.used,memory.total --format=csv,noheader 2>$null
    $key = [Environment]::GetEnvironmentVariable("UNSLOTH_API_KEY", "User")
    [pscustomobject]@{
        Strata   = if (Test-StrataLoaded) { "running" } else { "stopped" }
        Unsloth  = if ($key -and (Test-Url $UnslothHealth @{ Authorization = "Bearer $key" })) { "running" } else { "stopped" }
        ComfyUI  = if (Get-Process ComfyUI -ErrorAction SilentlyContinue) { "running" } else { "stopped" }
        VRAM     = $gpu
        OpenClaw = (openclaw config get agents.defaults.model.primary 2>$null) -replace '"', ''
    } | Format-List
}

switch ($Mode) {
    "agent" {
        Stop-Comfy; Stop-Unsloth
        if (Start-Strata) { Set-OpenClawModel $StrataModelRef }
    }
    "creative" {
        Stop-Strata; Start-Sleep 3
        if (Start-Unsloth) { Ensure-UnslothProvider; Set-OpenClawModel $UnslothModelRef }
        Start-Comfy
    }
    "free" {
        Stop-Strata; Stop-Comfy; Stop-Unsloth
        Write-Host "GPU is free."
    }
}
Show-Status
