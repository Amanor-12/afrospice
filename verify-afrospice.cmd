@echo off
set ROOT=%~dp0

cd /d %ROOT%
call npm.cmd run verify:release
