#!/bin/sh
# practice folder - single file compiler (macOS / Linux)
#
#   usage : ./build.sh 2026-08-31-jobqueue/jobqueue.cpp
#   output: practice/bin/jobqueue
#
# The Windows twin of this script is build.bat.
# Keep the two in sync: same warning level, same C++ standard,
# same include paths.
#
# NOTE: socket practice files (d9-session, d10-iocp, d10-select,
#       d11-echo) are Windows only. IOCP has no macOS equivalent,
#       so do not try to build them here. Portable ones are listed
#       in README.md.
set -e

if [ -z "$1" ]; then
    echo "Usage: ./build.sh <file.cpp>"
    echo "   ex: ./build.sh 2026-08-31-jobqueue/jobqueue.cpp"
    exit 1
fi

DIR=$(cd "$(dirname "$0")" && pwd)
cd "$DIR"

if [ ! -f "$1" ]; then
    echo "[x] No such file: $1"
    exit 1
fi

if command -v clang++ >/dev/null 2>&1; then
    CXX=clang++
elif command -v g++ >/dev/null 2>&1; then
    CXX=g++
else
    echo "[x] No C++ compiler found."
    echo "    macOS: run  xcode-select --install"
    exit 1
fi

mkdir -p bin

NAME=$(basename "$1" .cpp)

echo
echo "=== compiling $1 with $CXX ==="
echo

if ! "$CXX" -std=c++17 -Wall -Wextra -g \
        -I"$DIR/../Common" -I"$DIR" \
        "$1" -o "bin/$NAME" -lpthread
then
    echo
    echo "[x] BUILD FAILED"
    echo "    Errors are expected. The error list is the map of what"
    echo "    you have not learned yet. Look at the original file only"
    echo "    for the lines that failed - not the whole thing."
    exit 1
fi

echo
echo "[o] OK -> practice/bin/$NAME"
