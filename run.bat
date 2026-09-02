@echo off
setlocal

rem ---------------------------------------------------------------
rem  run.bat - build if needed, start server + bridge, open browser
rem
rem    run.bat                 default round
rem    run.bat fast            flood schedule 10x faster (6 min -> 36 s)
rem    run.bat seed 42         same map every time
rem    run.bat bots 8          fill empty seats with 8 bots
rem    run.bat aoi 0           turn AOI off (for the A/B measurement)
rem
rem  Arguments are passed straight through to Server.exe.
rem
rem  NOTE: keep this file ASCII only. cmd.exe reads .bat in the OEM
rem        codepage (949 on Korean Windows), so UTF-8 Korean text
rem        here breaks parsing. Korean explanation is in README.md.
rem ---------------------------------------------------------------

pushd "%~dp0"

set "EXE=bin\x64\Debug\Server.exe"
set "WEB=http://127.0.0.1:8080"

rem --- a running Server.exe holds the .exe file and the port ---
taskkill /f /im Server.exe >nul 2>&1

rem --- build only when the exe is missing ---
if not exist "%EXE%" (
    echo [run] %EXE% not found. building...
    call :build || goto :fail
)

rem --- node is required for the bridge ---
where node >nul 2>&1
if errorlevel 1 (
    echo [x] node not found. install Node.js, then run this again.
    goto :fail
)

echo [run] starting server  : %EXE% %*
start "BubbleRoyale server" "%EXE%" %*

echo [run] starting bridge  : node web\bridge.js
start "BubbleRoyale bridge" node web\bridge.js

rem give both a moment to bind their ports before the browser asks
ping -n 2 127.0.0.1 >nul

echo [run] opening browser  : %WEB%
start "" "%WEB%"

echo.
echo   Two console windows are now open. Their logs are the server's logs.
echo   Open more browser tabs to add more players.
echo.
echo   Press any key here to shut both down.
pause >nul

taskkill /f /im Server.exe >nul 2>&1
taskkill /f /fi "WINDOWTITLE eq BubbleRoyale bridge*" >nul 2>&1
echo [run] stopped.
popd
exit /b 0

rem ---------------------------------------------------------------
:build
set "VS2022=%ProgramFiles%\Microsoft Visual Studio\2022"
set "MSB="
for %%E in (Community Professional Enterprise BuildTools) do (
    if not defined MSB if exist "%VS2022%\%%E\MSBuild\Current\Bin\MSBuild.exe" (
        set "MSB=%VS2022%\%%E\MSBuild\Current\Bin\MSBuild.exe"
    )
)
if not defined MSB (
    echo [x] MSBuild not found. open BubbleRoyale.sln and build Debug^|x64 once.
    exit /b 1
)
"%MSB%" BubbleRoyale.sln -p:Configuration=Debug -p:Platform=x64 -v:minimal -nologo
if errorlevel 1 exit /b 1
exit /b 0

rem ---------------------------------------------------------------
:fail
echo.
popd
exit /b 1
