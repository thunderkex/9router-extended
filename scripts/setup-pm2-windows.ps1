# 9Router - Windows PM2 Auto-Start Setup Script
# Run this script in PowerShell to configure 9Router to start automatically on Windows boot via PM2.

Write-Host "==> Checking PM2 prerequisites..." -ForegroundColor Cyan

# Check if PM2 is installed globally
if (-not (Get-Command "pm2" -ErrorAction SilentlyContinue)) {
    Write-Host "==> Installing PM2 globally via npm..." -ForegroundColor Yellow
    npm install -g pm2
}

# Check if pm2-windows-startup is installed
if (-not (Get-Command "pm2-startup" -ErrorAction SilentlyContinue)) {
    Write-Host "==> Installing pm2-windows-startup globally..." -ForegroundColor Yellow
    npm install -g pm2-windows-startup
}

$repoRoot = Split-Path -Parent $PSScriptRoot
$ecosystemPath = Join-Path $repoRoot "ecosystem.config.cjs"

Write-Host "==> Starting 9Router with PM2..." -ForegroundColor Cyan
if (Test-Path $ecosystemPath) {
    pm2 start "$ecosystemPath"
} else {
    pm2 start 9router --name 9router
}

Write-Host "==> Saving PM2 process list..." -ForegroundColor Cyan
pm2 save

Write-Host "==> Registering Windows startup hook..." -ForegroundColor Cyan
try {
    pm2-startup install
} catch {
    Write-Warning "pm2-startup install encountered an issue. Ensure PowerShell is running as Administrator if required."
}

Write-Host "==> 9Router PM2 auto-start successfully configured!" -ForegroundColor Green
Write-Host "    View logs:    pm2 logs 9router"
Write-Host "    Check status: pm2 status"
Write-Host "    Restart:      pm2 restart 9router"
