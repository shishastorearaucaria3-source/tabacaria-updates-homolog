@echo off
setlocal EnableExtensions
rem ============================================================
rem  Assina o aplicativo e o instalador com um certificado PFX.
rem
rem  Uso:
rem    scripts\assinar.cmd C:\caminho\certificado.pfx [senha]
rem
rem  Depois de assinar, o Windows/SmartScreen reconhece o
rem  "editor" e para de mostrar "arquivo não é seguro".
rem ============================================================
if "%~1"=="" goto uso

set "WIN_CSC_LINK=%~f1"
set "WIN_CSC_KEY_PASSWORD=%~2"

echo Assinando aplicativo e instalador com %WIN_CSC_LINK% ...
call npm.cmd run package
if errorlevel 1 goto erro
call npm.cmd run package:setup
if errorlevel 1 goto erro

echo.
echo Assinatura aplicada. Conferindo:
powershell -NoProfile -Command "Get-AuthenticodeSignature 'dist-final\Sistema Loja Tabacaria Setup 1.0.0.exe' | Format-List Status, @{n='Editor';e={$_.SignerCertificate.Subject}}"
powershell -NoProfile -Command "Get-AuthenticodeSignature 'dist-setup\NossoSistema-Setup.exe' | Format-List Status, @{n='Editor';e={$_.SignerCertificate.Subject}}"
goto fim

:uso
echo Uso: scripts\assinar.cmd C:\caminho\certificado.pfx [senha]
goto fim
:erro
echo Falha ao gerar os instaladores. Verifique a mensagem acima.
:fim
endlocal