// Server/src/SendBuffer.h — 보낼 것을 쌓아두는 링버퍼
//
// 브로드캐스트를 붙이면 한 세션에 보낼 것이 여러 개 동시에 생긴다.
// 상자가 하나뿐이면 아직 보내는 중인 자리를 덮어쓰므로 쌓아둘 곳이 필요하다.
//
// 수신과 달리 여기는 진짜 링이다.
// 보낼 때는 경계를 읽을 일이 없고 순서대로 흘려보내기만 하면 되므로,
// 이음매에서 갈라져도 두 조각으로 나눠 두 번 보내면 그만이다.
//
//   head = 다음에 보낼 위치 / tail = 다음에 쌓을 위치 / size = 쌓여 있는 양
#pragma once

#include <cstring>
#include <algorithm>
#include "Protocol.h"

constexpr int SEND_BUFFER_SIZE = MAX_PACKET_SIZE * 16;

// 소유 스레드 : 없음. 여러 워커가 같이 만진다
struct SendBuffer{
    char buf[SEND_BUFFER_SIZE];
    int head = 0;
    int tail = 0;
    int size = 0;

    // head와 tail이 같을때 비었는지 찼는지 구분을 못하기 때문에 size를 따로 센다
    int Size() { return size; }
    int Free() { return SEND_BUFFER_SIZE - size; }
    
    // 뒤에 쌓는다. 자리가 모자라면 false
    bool Push(const char* data, int len){
        if (len > Free()){
            return false;
        }

        // 끝까지 몇칸 남았는지 보고, 넘치면 나눠 넣는다.
        int first = std::min(len, SEND_BUFFER_SIZE - tail);
        memcpy(buf + tail, data, first);

        if ( len > first) {
            memcpy(buf, data + first, len - first); 
        }

        tail = (tail + len) % SEND_BUFFER_SIZE;
        size += len;
        return true;
    }
    
    // 지금 한번에 보낼 수 있는 연속 구간을 알려준다
    char* PeekPtr() { return buf + head; }
    int PeekSize() { return std::min(size, SEND_BUFFER_SIZE - head);}

    // 실제로 n 바이트가 나갔다고 알린다.
    void OnSent(int n)
    {
        head = (head + n) % SEND_BUFFER_SIZE;
        size -= n;
    }
};

