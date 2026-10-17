# Starts (or creates) the local SearXNG container used by OpenClaw's deep research.
# Loopback only; restarts by itself whenever Docker Desktop runs.

# --- config -----------------------------------------------------------------
$Name      = "searxng"
$Image     = "searxng/searxng:latest"
$Port      = 8890
$ConfigDir = Resolve-Path (Join-Path $PSScriptRoot "..\services\searxng")
# -----------------------------------------------------------------------------

docker info *> $null
if ($LASTEXITCODE -ne 0) {
    Write-Host "Starting Docker Desktop..."
    Start-Process "C:\Program Files\Docker\Docker\Docker Desktop.exe"
    for ($i = 0; $i -lt 60; $i++) { docker info *> $null; if ($LASTEXITCODE -eq 0) { break }; Start-Sleep 3 }
}

$exists = docker ps -a --filter "name=^$Name$" --format "{{.Names}}"
if ($exists) {
    docker start $Name | Out-Null
} else {
    # Random per-container secret: never stored in the repo.
    $secret = -join ((48..57) + (97..102) | Get-Random -Count 64 | ForEach-Object { [char]$_ })
    docker run -d --name $Name --restart unless-stopped `
        -p "127.0.0.1:${Port}:8080" `
        -v "${ConfigDir}:/etc/searxng" `
        -e "SEARXNG_SECRET=$secret" -e "SEARXNG_BASE_URL=http://127.0.0.1:$Port/" `
        $Image | Out-Null
}

for ($i = 0; $i -lt 30; $i++) {
    try { $r = Invoke-RestMethod -TimeoutSec 3 "http://127.0.0.1:$Port/search?q=test&format=json"; Write-Host "SearXNG ready on http://127.0.0.1:$Port ($($r.results.Count) results for 'test')"; exit 0 }
    catch { Start-Sleep 2 }
}
Write-Warning "SearXNG did not answer on port $Port. Check: docker logs $Name"
exit 1
