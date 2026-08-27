# RailSeat Finder BD - PowerShell Launcher
$Host.UI.RawUI.WindowTitle = "RailSeat Finder BD - Seat Availability Dashboard"
Set-Location -Path $PSScriptRoot

Write-Host "======================================================" -ForegroundColor Cyan
Write-Host "  Bangladesh Railway Seat Availability Dashboard" -ForegroundColor Green
Write-Host "  Starting RailSeat Finder BD Server..." -ForegroundColor Yellow
Write-Host "======================================================" -ForegroundColor Cyan
Write-Host ""

# 1. Check Node.js
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Host "[ERROR] Node.js is not installed or not found in PATH." -ForegroundColor Red
    Write-Host "Please download & install Node.js from: https://nodejs.org/" -ForegroundColor Yellow
    Read-Host "Press Enter to exit..."
    exit 1
}

# 2. Check dependencies
if (-not (Test-Path -Path "$PSScriptRoot\node_modules")) {
    Write-Host "[INFO] Installing npm dependencies..." -ForegroundColor Cyan
    npm install
}

# 3. Start Node Server directly (server.js automatically launches browser on startup)
Write-Host "[INFO] Starting server at http://localhost:3000..." -ForegroundColor Green
Write-Host "[INFO] Dashboard opening automatically in your browser." -ForegroundColor Cyan
Write-Host "[INFO] Press Ctrl + C in this window to stop the server." -ForegroundColor Gray
Write-Host ""

node server.js
