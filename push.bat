@echo off
title Git Push DaradorIA
cd /d "%~dp0"
echo ======================================================
echo Subiendo cambios a https://github.com/darador/DaradorIA
echo ======================================================
echo.
git push -u origin main
echo.
echo ======================================================
if %ERRORLEVEL% EQU 0 (
    echo Subida completada con exito! Vercel se actualizara en breve.
) else (
    echo Hubo un error al subir. Si te pide login, completa la autorizacion en la ventana emergente.
)
echo ======================================================
echo.
pause
