@echo off
chcp 65001 >nul
title SAU FBE LaTeX (AyakaLeaf)
cd /d "%~dp0"
"app\node\node.exe" "app\baslat.mjs"
set KOD=%ERRORLEVEL%
echo.
pause
exit /b %KOD%
