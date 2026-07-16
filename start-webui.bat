@echo off
cd /d "%~dp0"
if not exist "web\node_modules" (
  echo Installing web dependencies...
  pushd web
  call npm install
  popd
)
cd host
if not exist node_modules call npm install
node src/index.js
