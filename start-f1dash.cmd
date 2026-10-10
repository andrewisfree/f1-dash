@echo off
title F1 Dashboard - Avvio

echo.
echo  ================================
echo    F1 DASHBOARD - Avvio...
echo  ================================
echo.

:: Vai alla directory del progetto
cd /d "D:\PyProg\f1-dash"

:: Avvia i servizi backend con Docker
echo [1/3] Avvio servizi backend - API e Realtime...
docker compose up -d api realtime
if errorlevel 1 (
    echo ERRORE: Docker non disponibile o compose fallito.
    echo Assicurati che Docker Desktop sia in esecuzione.
    pause
    exit /b 1
)

:: Il container web occupa la porta 3000 usata dal frontend qui sotto
docker compose stop web >nul 2>&1

echo.
echo [2/3] Avvio frontend...
start "F1 Dashboard - Frontend" /min cmd /k "cd /d D:\PyProg\f1-dash\dashboard && "C:\Program Files\nodejs\node.exe" node_modules\next\dist\bin\next dev -H 0.0.0.0"

echo.
echo [3/3] Apertura browser tra 12 secondi...
timeout /t 12 /nobreak >nul
start http://localhost:3000

echo.
echo  ====================================
echo    F1 Dashboard in esecuzione!
echo    PC:        http://localhost:3000
echo    Cellulare: http://192.168.188.150:3000
echo  ====================================
echo.
echo Questa finestra puo' essere chiusa.
timeout /t 5 /nobreak >nul
