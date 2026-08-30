// Server/src/RecvBuffer.h — 받은 바이트를 쌓아두는 바구니
//
// TCP 는 send 한 번이 recv 한 번이 아니다.
// 덜 온 것은 모아두고, 더 온 것은 남겨둬야 한다.
//
//   [ 처리끝 | 아직 안 읽음 | 빈칸 ]
//              ↑read_pos     ↑write_pos
//
// 진짜 링이 아니라 일자 버퍼에 커서 둘을 두는 방식이다.
// 링이면 헤더 4바이트가 이음매에 걸쳐 갈라지는데,
// 수신은 패킷 경계를 잘라내는 게 일이라 그게 방해가 된다.
#pragma once

#include <cstring>
#include "Protocol.h"

constexpr int RECV_BUFFER_SIZE = MAX_PACKET_SIZE * 4;

//소유 스레드 : worker
struct RecvBuffer
{
    char buf[RECV_BUFFER_SIZE];
    int read_pos = 0;
    int write_pos = 0;

    // ----쓰기 쪽, WSARecv가 담는곳----
    char* WritePtr()    { return buf + write_pos;}
    int WritableSize() { return RECV_BUFFER_SIZE - write_pos; }
    void OnWrite(int n) { write_pos += n; }

    // ----읽기 쪽, 패킷 자르는 곳----
    char* ReadPtr() { return buf + read_pos; }
    int DataSize()  { return write_pos - read_pos; }
    void OnRead(int n)  { read_pos += n; }

    // 다음 WSARecv 전에 부른다, 쓸 자리를 확보한다
    void Clean()
    {
        int left = DataSize();

        if (left == 0){
            // 텅 빈 경우 둘 다 처음으로 되돌린다
            read_pos = 0;
            write_pos = 0;
        }
        else if (WritableSize() < MAX_PACKET_SIZE) {
            // 남은게 있는데 뒤쪽자리가 모자란 경우 앞으로 당긴다
            memmove(buf, buf + read_pos, left);
            read_pos = 0;
            write_pos = left;
        }
    }
};