// Server/src/ServerConfig.h — 서버만 쓰는 설정
//
// 게임 규칙 상수는 Common/GameConstants.h 에 있다. 여기는 서버 운영 값만 둔다.
#pragma once

constexpr int WORKER_COUNT = 4;    // 워커 스레드 수. 코어 수 정도면 된다
constexpr int MAX_SESSION  = 256;  // 동시 접속 상한. 세션 목록 배열 크기다
