@echo off
setlocal
title RailSeat Finder BD - Bangladesh Railway Seat Availability Dashboard
cd /d "%~dp0"

:: Ensure standard Node.js directories are in PATH
set "PATH=C:\Program Files\nodejs;C:\Program Files (x86)\nodejs;%LOCALAPPDATA%\Programs\nodejs;%APPDATA%\npm;%PATH%"

echo ======================================================
echo   Bangladesh Railway Seat Availability Dashboard
echo   Starting RailSeat Finder BD Server...
echo ======================================================
echo.

:: 1. Verify Node.js is installed
where node >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Node.js was not found in your PATH.
    echo Please install Node.js LTS from https://nodejs.org
    echo Once installed, restart this file.
    echo.
    pause
    exit /b 1
)

:: 2. Install dependencies if node_modules is missing
if not exist "node_modules\" (
    echo [INFO] First time setup: Installing npm packages...
    call npm install
    if errorlevel 1 (
        echo [ERROR] npm install encountered an error.
        pause
        exit /b 1
    )
    echo [INFO] Dependencies installed successfully.
    echo.
)

:: 3. Free port 3000 if previously occupied by dead process
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":3000" ^| findstr "LISTENING"') do (
    taskkill /f /pid %%a >nul 2>&1
)

:: 4. Start Node server directly (server automatically opens single browser tab)
echo [INFO] Starting Node.js backend server...
echo [INFO] Dashboard opening at http://localhost:3000
echo [INFO] To stop the server, press Ctrl + C in this terminal window.
echo.

node server.js

if errorlevel 1 (
    echo.
    echo [ERROR] Node.js server closed with error code %errorlevel%.
    pause
)
