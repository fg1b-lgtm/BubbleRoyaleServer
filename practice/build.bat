@echo off
setlocal

rem ---------------------------------------------------------------
rem  practice folder - single file compiler
rem    usage : build.bat d11-echo\server.cpp
rem    output: practice\bin\server.exe
rem
rem  NOTE 1: keep this file ASCII only.
rem          cmd.exe reads .bat in the OEM codepage (949 on Korean
rem          Windows), so UTF-8 Korean text here breaks parsing.
rem          Korean explanation lives in practice\README.md instead.
rem  NOTE 2: %ProgramFiles(x86)% is avoided on purpose - the ")"
rem          inside it terminates if/for blocks early in cmd.
rem ---------------------------------------------------------------

if "%~1"=="" (
    echo Usage: build.bat ^<file.cpp^>
    echo    ex: build.bat d11-echo\server.cpp
    exit /b 1
)

pushd "%~dp0"

if not exist "%~1" (
    echo [x] No such file: %~1
    popd
    exit /b 1
)

rem --- locate vcvars64.bat (VS2022, any edition) ---
set "VS2022=%ProgramFiles%\Microsoft Visual Studio\2022"
set "VCVARS="
if exist "%VS2022%\Community\VC\Auxiliary\Build\vcvars64.bat"    set "VCVARS=%VS2022%\Community\VC\Auxiliary\Build\vcvars64.bat"
if not defined VCVARS if exist "%VS2022%\Professional\VC\Auxiliary\Build\vcvars64.bat" set "VCVARS=%VS2022%\Professional\VC\Auxiliary\Build\vcvars64.bat"
if not defined VCVARS if exist "%VS2022%\Enterprise\VC\Auxiliary\Build\vcvars64.bat"   set "VCVARS=%VS2022%\Enterprise\VC\Auxiliary\Build\vcvars64.bat"
if not defined VCVARS if exist "%VS2022%\BuildTools\VC\Auxiliary\Build\vcvars64.bat"   set "VCVARS=%VS2022%\BuildTools\VC\Auxiliary\Build\vcvars64.bat"

if not defined VCVARS (
    echo [x] vcvars64.bat not found under:
    echo     %VS2022%
    echo     Install "Desktop development with C++" in Visual Studio Installer.
    popd
    exit /b 1
)

rem vcvars64 prints a harmless vswhere warning on some setups; hide both streams.
rem errorlevel below still catches a real failure.
call "%VCVARS%" >nul 2>&1
if errorlevel 1 (
    echo [x] vcvars64 failed.
    popd
    exit /b 1
)

if not exist "bin" mkdir "bin"

echo.
echo === compiling %~1 ===
echo.

cl /nologo /W4 /std:c++17 /utf-8 /EHsc /Zi /I"%~dp0..\Common" /D_CONSOLE /DWIN32_LEAN_AND_MEAN /DNOMINMAX "%~1" /Fe:"bin\%~n1.exe" /Fo:"bin\%~n1.obj" /Fd:"bin\%~n1.pdb" /link ws2_32.lib mswsock.lib

if errorlevel 1 (
    echo.
    echo [x] BUILD FAILED
    echo     Errors are expected. The error list is the map of what
    echo     you have not learned yet. Look at the original file only
    echo     for the lines that failed - not the whole thing.
    popd
    exit /b 1
)

echo.
echo [o] OK -^> practice\bin\%~n1.exe
popd
exit /b 0
