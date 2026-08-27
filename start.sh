#!/bin/bash
# RailSeat Finder BD - Bash Startup Script

cd "$(dirname "$0")"

echo "======================================================"
echo "  Bangladesh Railway Seat Availability Dashboard"
echo "  Starting RailSeat Finder BD Server..."
echo "======================================================"

if ! command -v node &> /dev/null; then
    echo "[ERROR] Node.js is not installed or not in PATH."
    echo "Please install Node.js from https://nodejs.org/"
    exit 1
fi

if [ ! -d "node_modules" ]; then
    echo "[INFO] Installing required dependencies..."
    npm install
fi

echo "[INFO] Opening http://localhost:3000 in your browser..."
if command -v start &> /dev/null; then
    start "http://localhost:3000"
elif command -v xdg-open &> /dev/null; then
    xdg-open "http://localhost:3000" &> /dev/null &
elif command -v open &> /dev/null; then
    open "http://localhost:3000"
fi

npm start
