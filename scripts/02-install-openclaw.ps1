# Installs a pinned OpenClaw, runs non-interactive onboarding against Strata and installs
# the gateway as a Scheduled Task (loopback only, token auth).

# --- config -----------------------------------------------------------------
$OpenClawVersion = "2026.8.35"   # 2026.9.9 and 2026.10.3 fail on this PC, see docs/known-issues.md
$MinNode         = [version]"24.16.0"
$StrataBaseUrl   = "http://127.0.0.1:8080/v1"
$StrataModelId   = (Get-Content (Join-Path $PSScriptRoot "..\config\active-model.json") -Raw | ConvertFrom-Json).model_name   # from 01-install-strata.ps1
$GatewayPort     = 18789
# -----------------------------------------------------------------------------
$ErrorActionPreference = "Stop"

# Node: newer OpenClaw releases refuse to install below 24.16.
$nodeVersion = [version]((node -v).TrimStart("v"))
if ($nodeVersion -lt $MinNode) {
    throw "Node $nodeVersion is too old. With nvm-windows: nvm install 24 ; nvm use <that version>"
}

npm install -g "openclaw@$OpenClawVersion" --allow-scripts=openclaw
if ($LASTEXITCODE -ne 0) { throw "npm install failed" }

# Strata must answer before onboarding runs its health check.
try { Invoke-WebRequest -UseBasicParsing -TimeoutSec 5 "$($StrataBaseUrl -replace '/v1$','')/health" | Out-Null }
catch { throw "Strata is not running. Start it with scripts\start-all.bat first." }

# --accept-risk acknowledges that the agent gets shell and file access as your user.
openclaw onboard --non-interactive --accept-risk --mode local `
    --auth-choice custom-api-key --custom-provider-id strata `
    --custom-base-url $StrataBaseUrl --custom-model-id $StrataModelId `
    --custom-compatibility openai --custom-text-input --custom-api-key strata-local `
    --gateway-bind loopback --gateway-auth token --gateway-port $GatewayPort --tailscale off `
    --install-daemon --skip-channels --skip-search --skip-skills --skip-ui --suppress-gateway-token-output
if ($LASTEXITCODE -ne 0) { throw "openclaw onboard failed" }

Write-Host "`nOpenClaw $OpenClawVersion is installed. Next: scripts\03-configure-openclaw.ps1"
