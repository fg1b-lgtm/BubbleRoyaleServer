// Bubble Royale — Server
//
// IOCP 서버. 완료 포트 하나, 워커 스레드 여러 개.
// 손님마다 Session 을 하나 만들고, 받은 바이트를 수신 버퍼에 쌓아두다가
// 완전한 패킷이 나올 때마다 잘라서 처리한다.
//
// 흐름
//   main   accept 만 한다. Session 만들어 목록에 넣고 첫 주문 건 다음엔 손 뗀다
//   worker 완료된 것만 집어서 처리하고 다음 주문을 건다
//   둘은 서로 부르지 않는다. 완료 포트를 사이에 두고만 이어져 있다
//
// 파일 나눔
//   ServerConfig.h    서버 운영 값
//   Session.h         Session / IoContext / AddRef / Release
//   SessionManager.h  세션 목록 + 자물쇠 + CloseSession
//   Network.h         PostRecv / StartSend / SendPacket / Broadcast
//   RecvBuffer.h      받은 바이트를 쌓아두는 바구니
//   SendBuffer.h      보낼 것을 쌓아두는 링버퍼
//   여기(main.cpp)    패킷 처리 + 워커 루프 + 시작/종료
//
// 로그 접두어
//   [Server]   서버 전체 얘기
//   [Session]  주소가 붙는 모든 것
#include "Network.h"
#include "GameConstants.h"

// 주문 하나를 처리한다. 이 함수는 틱 스레드에서만 불린다.
static void HandleJob(const Job* j){
    Session* s = j->s;

    switch (j->type) {
        case JobType::Enter:
            printf("[Tick] %s:%d entered\n", s->ip, s->port);
            break;
        case JobType::Leave:
            printf("[Tick] %s:%d left\n", s->ip, s->port);
            break;
        case JobType::Packet: {
            const PacketHeader* h = (const PacketHeader*)j->data;

            switch(h->id){
                case PKT_ECHO:
                    Broadcast(j->data, h->size, nullptr);
                    break;

                default:
                    printf("[Session] %s:%d unknown packet id=%u\n", s->ip, s->port, h->id);
                    CloseSession(s);
                    break;
            }
            break;
        }

    }
}

// 바구니에서 완전한 패킷을 전부 꺼내 처리한다.
// 덜 온 것은 남겨두고, 몰려 온 것은 한 바퀴에 다 꺼낸다.
static void ProcessPackets(Session* s)
{
    while (true) {
        int data = s->recv_buf.DataSize();

        if (data < HEADER_SIZE) {
            break;   // 헤더도 덜 왔다
        }

        PacketHeader* h = (PacketHeader*)s->recv_buf.ReadPtr();

        // 크기가 말이 안 되면 믿을 수 없는 상대다.
        // 이걸 안 하면 오지 않을 바이트를 영원히 기다린다.
        if (h->size < HEADER_SIZE || h->size > MAX_PACKET_SIZE) {
            printf("[Session] %s:%d bad packet size %u\n", s->ip, s->port, h->size);
            CloseSession(s);
            return;
        }

        if (data < h->size) {
            break;   // 몸통이 덜 왔다
        }

        int len = h->size;
        
        if (!PushJob(JobType::Packet, s, (const char*)h, len)){
            printf("[Session] %s:%d job queue full\n", s->ip, s->port);
            CloseSession(s);
            return;
        }

        s->recv_buf.OnRead(len);

        if (s->closing == 1) {
            return;   // HandlePacket 안에서 끊겼으면 더 처리하지 않는다
        }
    }
}

// 완료된 것만 집어서 처리하는 일꾼. 여러 명이 같은 완료 포트를 본다
static DWORD WINAPI WorkerThread(LPVOID param)
{
    HANDLE iocp = (HANDLE)param;

    while (true) {
        DWORD       bytes = 0;
        ULONG_PTR   key = 0;
        OVERLAPPED* ov = nullptr;

        // 완성된 게 나올 때까지 여기서 멈춰 있는다
        BOOL ok = GetQueuedCompletionStatus(iocp, &bytes, &key, &ov, INFINITE);

        // 분기 1. ov 가 없다 = 손님 얘기가 아니라 완료 포트가 닫힌 것. 여기만 Release 를 안 한다
        if (!ok && ov == nullptr) {
            printf("[Server] completion port closed\n");
            break;
        }

        Session*   s  = (Session*)key;    // 누구인지
        IoContext* io = (IoContext*)ov;   // 무슨 일인지 (첫 멤버라 주소가 같다)

        // 분기 2. 강제 종료. 창을 X 로 닫거나 프로세스가 죽으면 여기로 온다 (10053, 10054, 64)
        if (!ok) {
            printf("[Session] %s:%d io failed: %lu\n", s->ip, s->port, GetLastError());
            CloseSession(s);
        }
        else if (io->type == IoType::Recv) {
            // 분기 3. 0바이트 = 손님이 정상적으로 끊었다. 에러가 아니다
            if (bytes == 0) {
                printf("[Session] %s:%d disconnected\n", s->ip, s->port);
                CloseSession(s);
            }
            else {
                s->recv_buf.OnWrite(bytes);   // 바구니에 이만큼 찼다고 알린다
                ProcessPackets(s);
                if (s->closing == 0) {
                    PostRecv(s);              // 받기는 항상 다시 건다
                }
            }
        }
        else {
            // 분기 4. 보내기 완료. 나간 만큼 큐에서 빼고 남았으면 이어서 보낸다
            AcquireSRWLockExclusive(&s->send_lock);
            s->send_buf.OnSent(bytes);
            bool more = s->send_buf.Size() > 0;
            if (!more) {
                s->sending = 0;   // 다 보냈다. 표시를 내린다
            }
            ReleaseSRWLockExclusive(&s->send_lock);

            if (more && s->closing == 0) {
                StartSend(s);
            }
        }

        Release(s);   // 이 주문 하나가 끝났다
    }
    return 0;
}

static LONG g_tick_running = 1;   // 0 이 되면 틱 스레드가 나간다

// 게임 스레드. 초당 TICK_RATE 번 돌면서 꽂힌 주문을 가져다 처리한다.
// 게임 상태는 앞으로 전부 이 스레드만 소유한다.
static DWORD WINAPI TickThread(LPVOID)
{
    ULONGLONG start = GetTickCount64();   // 부팅 후 흐른 밀리초
    ULONGLONG tick  = 0;                  // 몇 번째 틱인가

    while (g_tick_running == 1) {
        ++tick;

        // 1) 꽂힌 주문을 통째로 가져온다
        Job* jobs  = nullptr;
        int  count = SwapJobs(&jobs);

        // 2) 순서대로 처리한다. 여긴 나 혼자다
        for (int i = 0; i < count; ++i) {
            HandleJob(&jobs[i]);
            Release(jobs[i].s);   // 꽂을 때 든 참조를 여기서 놓는다
        }

        // 3) 9/1 에 게임 한 틱이 여기 들어간다 (이동, 퓨즈, 폭발, 침수)

        // 4) 다음 틱 시각까지 잔다.
        //    33 을 계속 더해 나가지 않고 시작 시각에서 매번 다시 계산한다.
        //    1000/30 은 33.333 이라 33 으로 더하면 한 틱마다 0.333ms 씩 빨라진다.
        //    1분이면 0.6초, 5분 한 판이면 3초가 어긋난다.
        //    시간을 전부 틱으로 적어놨기 때문에(GameConstants.h) 이게 그대로 게임 시각이 된다.
        //    곱하기를 나누기보다 먼저 하면 오차가 안 쌓인다.
        ULONGLONG target = start + tick * 1000 / TICK_RATE;
        ULONGLONG now    = GetTickCount64();

        if (now < target) {
            Sleep((DWORD)(target - now));
        }
        else if (now - target > 1000) {
            // 1초 넘게 밀렸다. 따라잡으려고 쉬지 않고 돌면 더 밀린다.
            // 따라잡기를 포기하고 시계를 지금으로 맞춘다
            printf("[Server] tick behind %llu ms, resync\n", now - target);
            start = now;
            tick  = 0;
        }
    }

    printf("[Server] tick thread stopped\n");
    return 0;
}


// 워커 정리. 실패 경로에서도 같이 쓴다
static void ShutdownWorkers(HANDLE* workers, int count)
{
    WaitForMultipleObjects(count, workers, TRUE, 1000);
    for (int i = 0; i < count; ++i) {
        CloseHandle(workers[i]);
    }
}

// 순서: 완료 포트 만들고 -> 워커 띄우고 -> listen 열고 -> accept 만 반복
int main()
{
    // 로그를 모아뒀다가 한꺼번에 내보내지 않고 바로 찍게 한다.
    // 서버가 강제 종료되면 모아둔 로그가 통째로 날아간다.
    // 서버 로그는 사고 직전이 제일 중요하다.
    setvbuf(stdout, nullptr, _IONBF, 0);

    InitSessionManager();
    InitJobQueue();

    WSADATA wsa;
    int rc = WSAStartup(MAKEWORD(2, 2), &wsa);
    if (rc != 0) {
        // WSAStartup 만은 반환값 자체가 에러 코드다. WSAGetLastError 를 쓸 수 없다
        printf("[Server] WSAStartup failed: %d\n", rc);
        return 1;
    }

    HANDLE iocp = CreateIoCompletionPort(INVALID_HANDLE_VALUE, nullptr, 0, 0);
    if (iocp == nullptr) {
        printf("[Server] CreateIoCompletionPort failed: %lu\n", GetLastError());
        WSACleanup();
        return 1;
    }

    HANDLE workers[WORKER_COUNT];
    for (int i = 0; i < WORKER_COUNT; ++i) {
        workers[i] = CreateThread(nullptr, 0, WorkerThread, iocp, 0, nullptr);
        if (workers[i] == nullptr) {
            printf("[Server] CreateThread failed: %lu\n", GetLastError());
            CloseHandle(iocp);
            WSACleanup();
            return 1;
        }
    }
    printf("[Server] %d workers started\n", WORKER_COUNT);

    SOCKET listen_sock = socket(AF_INET, SOCK_STREAM, IPPROTO_TCP);
    if (listen_sock == INVALID_SOCKET) {
        printf("[Server] socket failed: %d\n", WSAGetLastError());
        CloseHandle(iocp);
        ShutdownWorkers(workers, WORKER_COUNT);
        WSACleanup();
        return 1;
    }

    sockaddr_in server_addr = {};
    server_addr.sin_family = AF_INET;
    server_addr.sin_port = htons(SERVER_PORT);
    server_addr.sin_addr.s_addr = htonl(INADDR_ANY);

    if (bind(listen_sock, (sockaddr*)&server_addr, sizeof(server_addr)) == SOCKET_ERROR) {
        // 10048(WSAEADDRINUSE) = 그 포트를 이미 누가 쓰고 있다
        printf("[Server] bind failed: %d\n", WSAGetLastError());
        closesocket(listen_sock);
        CloseHandle(iocp);
        ShutdownWorkers(workers, WORKER_COUNT);
        WSACleanup();
        return 1;
    }

    if (listen(listen_sock, SOMAXCONN) == SOCKET_ERROR) {
        printf("[Server] listen failed: %d\n", WSAGetLastError());
        closesocket(listen_sock);
        CloseHandle(iocp);
        ShutdownWorkers(workers, WORKER_COUNT);
        WSACleanup();
        return 1;
    }

    printf("[Server] listening on port %d\n", SERVER_PORT);

    HANDLE tick_thread = CreateThread(nullptr, 0, TickThread, nullptr, 0, nullptr);
    if (tick_thread == nullptr) {
        printf("[Server] tick CreateThread failed: %lu\n", GetLastError());
        closesocket(listen_sock);
        CloseHandle(iocp);
        ShutdownWorkers(workers, WORKER_COUNT);
        WSACleanup();
        return 1;
    }
    printf("[Server] tick thread started (%d Hz)\n", TICK_RATE);


    while (true) {
        sockaddr_in client_addr = {};
        int client_addr_len = sizeof(client_addr);

        SOCKET client_sock = accept(listen_sock, (sockaddr*)&client_addr, &client_addr_len);
        if (client_sock == INVALID_SOCKET) {
            printf("[Server] accept failed: %d\n", WSAGetLastError());
            break;
        }

        Session* s = new Session();
        s->sock = client_sock;
        // 참조를 둘 든다.
        // 하나는 목록이 드는 것이고, 하나는 main 이 세팅하는 동안 드는 것이다.
        // AddSession 을 지나는 순간부터 다른 워커가 목록에서 이 세션을 꺼내 쓸 수 있고,
        // 거기서 CloseSession 이 불리면 목록 참조가 풀린다.
        // main 이 자기 참조를 안 들면, 아직 세팅 중인 세션이 지워질 수 있다.
        s->ref_count = 2;
        s->closing = 0;
        s->sending = 0;
        InitializeSRWLock(&s->send_lock);
        inet_ntop(AF_INET, &client_addr.sin_addr, s->ip, sizeof(s->ip));
        s->port = ntohs(client_addr.sin_port);

        if (!AddSession(s)) {
            printf("[Server] session list full\n");
            closesocket(client_sock);
            delete s;
            continue;
        }

        if (CreateIoCompletionPort((HANDLE)client_sock, iocp, (ULONG_PTR)s, 0) == nullptr) {
            printf("[Server] associate failed: %lu\n", GetLastError());
            CloseSession(s);   // 목록 참조를 놓는다
            Release(s);        // main 참조를 놓는다
            continue;
        }

        printf("[Session] %s:%d connected\n", s->ip, s->port);

        // 들어왔다는 걸 틱 스레드에 알린다. 첫 주문보다 먼저다
        PushJob(JobType::Enter, s, nullptr, 0);


        // 첫 주문. 이 줄을 지나면 s 의 주인은 worker 다.
        // 실패하면 PostRecv 안의 Release 가 이미 참조를 내렸으므로 CloseSession 으로만 정리한다
        if (!PostRecv(s)) {
            printf("[Server] first PostRecv failed\n");
            CloseSession(s);
        }

        Release(s);   // main 은 세팅을 끝냈다. 자기 참조를 놓는다
    }

    closesocket(listen_sock);
    InterlockedExchange(&g_tick_running, 0);   // 나가라고 알린다
    WaitForSingleObject(tick_thread, 2000);    // 나갈 때까지 기다린다
    CloseHandle(tick_thread);
    CloseHandle(iocp);
    ShutdownWorkers(workers, WORKER_COUNT);
    WSACleanup();
    return 0;
}
