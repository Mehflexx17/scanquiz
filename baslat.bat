@echo off
title ScanQuiz Yerel Sunucu
echo ===================================================
echo     ScanQuiz - Yerel Test Baslatici
echo ===================================================
echo Yerel HTTP sunucusu baslatiliyor (Port: 3000)...
echo.
start http://localhost:3000/tahta.html
start http://localhost:3000/host.html
python -m http.server 3000
pause
