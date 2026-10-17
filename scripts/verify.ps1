# End-to-end check: Strata health, OpenClaw gateway, memory index, and one real agent turn.

# --- config -----------------------------------------------------------------
$StrataHealth = "http://127.0.0.1:8080/health"
$AgentPrompt  = "Health check: run 'rg --version' with exec and give its first line, then search memory for 'setup' and say in one sentence whether anything was found."
# -----------------------------------------------------------------------------

Write-Host "== Strata"
try { (Invoke-WebRequest -UseBasicParsing -TimeoutSec 5 $StrataHealth).Content }
catch { Write-Warning "Strata is not running (scripts\start-all.bat)"; exit 1 }

Write-Host "`n== OpenClaw gateway"
openclaw gateway status 2>&1 | Select-String -Pattern "Gateway version|Runtime:|Connectivity probe|Listening"

Write-Host "`n== Memory"
openclaw memory status --agent main 2>&1 | Select-String -Pattern "^Provider|^Indexed|^Embeddings"

Write-Host "`n== GEMINI_API_KEY set: $([bool][Environment]::GetEnvironmentVariable('GEMINI_API_KEY','User'))"

Write-Host "`n== Agent turn through Strata"
$t = Get-Date
openclaw agent --session-id "verify-$(Get-Date -Format yyyyMMddHHmmss)" -m $AgentPrompt
Write-Host ("elapsed: {0:N0} s" -f ((Get-Date) - $t).TotalSeconds)
