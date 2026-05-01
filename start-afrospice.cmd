@echo off
set ROOT=%~dp0

start "AfroSpice Workspace" cmd /k "cd /d %ROOT% && node scripts\dev-workspace.js"

echo AfroSpice workspace is starting in a new window.
echo Backend health: http://localhost:5000/api/system/health
echo Frontend app:  http://localhost:5173
