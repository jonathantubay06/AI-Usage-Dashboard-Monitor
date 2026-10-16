# Starts AI Token Monitor hidden (if not already running) and opens it in the browser.
# Usage: powershell -File scripts\start.ps1 [-Lan] [-NoBrowser]   (-NoBrowser is used by the logon task)
param([switch]$Lan, [switch]$NoBrowser)
$root = Split-Path $PSScriptRoot -Parent
$port = 7788
$up = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
if (-not $up) {
    $nodeArgs = @("src/server.js")
    if ($Lan) { $nodeArgs += "--lan" }
    $log = Join-Path $root "data\server.log"
    New-Item -ItemType Directory -Force (Join-Path $root "data") | Out-Null
    Start-Process node -ArgumentList $nodeArgs -WorkingDirectory $root -WindowStyle Hidden -RedirectStandardOutput $log -RedirectStandardError "$log.err"
    for ($i = 0; $i -lt 60; $i++) {
        Start-Sleep -Milliseconds 500
        if (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue) { break }
    }
}
if (-not $NoBrowser) { Start-Process "http://127.0.0.1:$port" }
