@echo off
for /f "delims=" %%i in ('npm root -g') do set NODE_PATH=%%i
cd /d "%~dp0"
node server.js
