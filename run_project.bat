@echo off
title Ada's AI Natural Language Translator

echo ==========================================
echo   Ada's AI Natural Language Translator
echo ==========================================
echo.
echo Starting backend server...
echo.

set "ROOT=%~dp0"

start "Ada AI NLT Backend" powershell.exe -NoExit -Command "Set-Location -LiteralPath '%ROOT%server'; npm.cmd run dev"

echo Waiting for backend...
timeout /t 3 /nobreak >nul

echo Opening translator website...
start "" "%ROOT%index.html"

echo.
echo Ada's AI NLT has started.
echo Backend: http://localhost:3001
echo.

exit