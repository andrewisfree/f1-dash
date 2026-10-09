@echo off
title F1 Dashboard - Avvio
chcp 65001 >nul 2>&1

echo.
echo  ╔══════════════════════════════╗
echo  ║   F1 DASHBOARD - Avvio...   ║
echo  ╚══════════════════════════════╝
echo.

:: Vai alla directory del progetto
cd /d "D:\PyProg\f1-dash"

:: Avvia i servizi backend con Docker
echo [1/3] Avvio servizi backend (API + Realtime)...
docker compose up -d api realtime
if errorlevel 1 (
    echo ERRORE: Docker non disponibile o compose fallito.
    echo Assicurati che Docker Desktop sia in esecuzione.
    pause
    exit /b 1
)

echo.
echo [2/3] Avvio frontend...
start "F1 Dashboard - Frontend" /min cmd /k "cd /d D:\PyProg\f1-dash\dashboard && "C:\Program Files\nodejs\node.exe" node_modules\next\dist\bin\next dev -H 0.0.0.0"

echo.
echo [3/3] Apertura browser tra 12 secondi...
timeout /t 12 /nobreak >nul
start http://localhost:3000

echo.
echo  ╔══════════════════════════════════╗
echo  ║  F1 Dashboard in esecuzione!    ║
echo  ║  http://localhost:3000          ║
echo  ╚══════════════════════════════════╝
echo.
echo Questa finestra puo' essere chiusa.
timeout /t 5 /nobreak >nul
