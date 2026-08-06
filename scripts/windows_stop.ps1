#Requires -Version 5.1
<#
  Stops everything started by windows_start.ps1: the api/engine/interface dev processes
  (by PID file), then the Postgres container (stopped, not removed — data is preserved).
#>
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
$pidDir = Join-Path $root ".pids"

# windows_start.ps1 launches each service as cmd.exe -> npm.cmd -> node (npm-cli) -> the
# real tsx/next process — several hops deep. Stopping just the recorded pid leaves the
# real server running, so walk the whole descendant tree and kill it bottom-up.
function Stop-ProcessTree([int]$RootId) {
    $all = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue
    $children = @($all | Where-Object { $_.ParentProcessId -eq $RootId })
    foreach ($child in $children) {
        Stop-ProcessTree -RootId $child.ProcessId
    }
    Stop-Process -Id $RootId -Force -ErrorAction SilentlyContinue
}

foreach ($name in @("api", "engine", "interface")) {
    $pidFile = Join-Path $pidDir "${name}.pid"
    if (-not (Test-Path $pidFile)) {
        Write-Host "    ${name}: no pid file, skipping" -ForegroundColor DarkGray
        continue
    }
    $procId = Get-Content $pidFile
    $proc = Get-Process -Id $procId -ErrorAction SilentlyContinue
    if ($proc) {
        Stop-ProcessTree -RootId $procId
        Write-Host "    ${name}: stopped (pid $procId and its child processes)" -ForegroundColor Green
    } else {
        Write-Host "    ${name}: process $procId already exited" -ForegroundColor DarkGray
    }
    Remove-Item $pidFile -Force
}

Write-Host "==> Stopping Postgres (container preserved, data intact)..." -ForegroundColor Cyan
docker compose stop postgres

Write-Host "Voyager stack stopped." -ForegroundColor Cyan
