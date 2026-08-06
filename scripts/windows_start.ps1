#Requires -Version 5.1
<#
  Starts the full Voyager stack on Windows: Postgres (docker compose), then api/engine/interface
  as background dev processes. Run windows_stop.ps1 to tear everything back down.
#>
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$pidDir = Join-Path $root ".pids"
$logDir = Join-Path $root "logs"
New-Item -ItemType Directory -Force -Path $pidDir, $logDir | Out-Null

Write-Host "==> Starting Postgres (docker compose)..." -ForegroundColor Cyan
docker compose up -d postgres
if ($LASTEXITCODE -ne 0) { throw "docker compose up failed" }

Write-Host "==> Waiting for Postgres to become healthy..." -ForegroundColor Cyan
$deadline = (Get-Date).AddSeconds(60)
while ($true) {
    $status = docker inspect --format "{{.State.Health.Status}}" "$(docker compose ps -q postgres)" 2>$null
    if ($status -eq "healthy") { break }
    if ((Get-Date) -gt $deadline) { throw "Postgres did not become healthy within 60s" }
    Start-Sleep -Seconds 1
}
Write-Host "    Postgres is healthy." -ForegroundColor Green

Write-Host "==> Running migrations..." -ForegroundColor Cyan
npm run migrate
if ($LASTEXITCODE -ne 0) { throw "migrations failed" }

function Start-Service([string]$Name, [string]$Workspace) {
    $log = Join-Path $logDir "$Name.log"
    # "npm" resolves to npm.cmd, which Start-Process can't launch directly (it needs a
    # real Win32 executable, not a shell-dispatched .cmd) — go through cmd.exe /c instead.
    $proc = Start-Process -FilePath "cmd.exe" `
        -ArgumentList "/c", "npm run dev --workspace=$Workspace" `
        -WorkingDirectory $root `
        -RedirectStandardOutput $log `
        -RedirectStandardError "$log.err" `
        -WindowStyle Hidden `
        -PassThru
    Set-Content -Path (Join-Path $pidDir "$Name.pid") -Value $proc.Id
    Write-Host "    $Name started (pid $($proc.Id), log: $log)" -ForegroundColor Green
}

Write-Host "==> Starting api, engine, interface..." -ForegroundColor Cyan
Start-Service -Name "api" -Workspace "api"
Start-Service -Name "engine" -Workspace "engine"
Start-Service -Name "interface" -Workspace "interface"

Write-Host ""
Write-Host "Voyager is starting up:" -ForegroundColor Cyan
Write-Host "  API        http://localhost:3000/api/v1"
Write-Host "  Interface  http://localhost:3001"
Write-Host "  Logs       $logDir"
Write-Host ""
Write-Host "Run scripts\windows_stop.ps1 to stop everything." -ForegroundColor Yellow
