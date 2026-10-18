# Opens a NEW MERGEN chat session in the OpenClaw Control UI (default browser).
# New dashboard chats use the key agent:main:dashboard:<guid>; `openclaw dashboard --json` supplies a fresh,
# short-lived sign-in fragment so the page works even in a browser that was never paired.
# Exit code 1 when the gateway is not running.

# --- config -----------------------------------------------------------------
$OpenClawEntry = Join-Path (Split-Path (Get-Command openclaw).Source) "node_modules\openclaw\openclaw.mjs"   # node + entry: openclaw.cmd mangles args
$GatewayUrl    = "http://127.0.0.1:18789/"
$Agent         = "main"
# -----------------------------------------------------------------------------

try { Invoke-WebRequest -UseBasicParsing -TimeoutSec 3 $GatewayUrl | Out-Null }
catch { if ($null -eq $_.Exception.Response) { Write-Output "gateway not running"; exit 1 } }

$session = "agent:${Agent}:dashboard:$([guid]::NewGuid())"
$url = "${GatewayUrl}chat?session=$([uri]::EscapeDataString($session))"
try {
    $info = & node $OpenClawEntry dashboard --no-open --json 2>$null | ConvertFrom-Json
    if ($info.browserUrl -match "#(.+)$") { $url += "#" + $Matches[1] }   # one-time sign-in, never logged
} catch {}
Start-Process $url
Write-Output "opened $session"
