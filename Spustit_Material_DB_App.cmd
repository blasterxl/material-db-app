@echo off
cd /d "%~dp0material-db-app"
set "NODE_EXE=node"
where node >nul 2>nul
if errorlevel 1 set "NODE_EXE=C:\Users\dtp1.FC\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"

if not exist "%NODE_EXE%" if not "%NODE_EXE%"=="node" (
  echo Node.js sa nenasiel ani v Codex runtime.
  echo Skontroluj cestu: %NODE_EXE%
  pause
  exit /b 1
)

set "MATERIAL_DB_PYTHON_EXE=C:\Users\dtp1.FC\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe"

start "" "http://localhost:4177/"
"%NODE_EXE%" server.js
pause
