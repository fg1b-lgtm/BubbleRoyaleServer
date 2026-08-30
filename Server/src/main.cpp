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
// 여러 스레드가 같이 만지는 건 세션 목록 하나뿐이다.
// 나머지는 세션당 하나씩이라 자물쇠가 필요 없다.
#include <winsock2.h>
#include <WS2tcpip.h>
#include <cstdio>
#include "RecvBuffer.h"   // Protocol.h 는 이 안에서 딸려온다
#include "SendBuffer.h"

constexpr unsigned short SERVER_PORT = 9000;
constexpr int WORKER_COUNT = 4;    // 워커 스레드 수. 코어 수 정도면 된다
constexpr int MAX_SESSION = 256;   // 동시 접속 상한. 목록 배열 크기다

// 주문 종류. 완료가 픽업대에 섞여 올라오니까 이걸로 구분한다
enum class IoType {Recv, Send};

// 주문표 주문이 들어올때 생기고 끝났을때 사라짐
// OS가 여기다 직접 씀 그래서 주문 끝날때까지 살아있어야함
struct IoContext {
    OVERLAPPED overlapped;  //반드시 첫번째 IoContext랑 주소가 같아야 ov를 되돌릴수 있음
    IoType type;            //받는주문인지 보내는주문인지 완료가 섞여 오니까 구분용
    WSABUF wsabuf;
};

//손님이 들어올떄 생성 나갈때 사라짐
//소유 스레드
//  main   accept 하고 만듬 첫 주문 건 다음엔 안 건드림
//  worker 완료 받은 뒤부터 소유 ref_count 0되면 지움
struct Session {
    SOCKET sock;
    LONG ref_count; // 주문카운트 주문 걸면 +1 완료되면 -1 0되면 닫고 지움
    LONG closing;   // 손님이 있는가 나갔는가 확인 팻말, 나가면 1
                    // 1이면 새 주문을 안 검
                    // 안 막으면 계속 새로 걸려서 ref_count가 영영 0이 안됨
    char ip[INET_ADDRSTRLEN];
    unsigned short port;
    IoContext recv_io;
    RecvBuffer recv_buf;

    IoContext send_io;
    SendBuffer send_buf;
    SRWLOCK send_lock;
    LONG sending;
};

// 접속 중인 세션 목록. 이 서버에서 여러 스레드가 같이 만지는 유일한 공유물이다
// 넣기는 main, 빼기와 읽기는 worker. 반드시 g_session_lock 을 잡고 만진다
Session* g_sessions[MAX_SESSION] = {};
SRWLOCK g_session_lock;   // 읽기는 여럿이 동시에, 쓰기는 혼자만

// 목록에 넣는다. 자리가 없으면 false. 넣고 빼는 건 쓰기 자물쇠
static bool AddSession(Session* s){
    AcquireSRWLockExclusive(&g_session_lock);
    
    bool ok = false;
    for (int i = 0; i < MAX_SESSION; ++i){
        if (g_sessions[i] == nullptr){
            g_sessions[i] = s;
            ok = true;
            break;
        }
    }

    ReleaseSRWLockExclusive(&g_session_lock);
    return ok;
}

// 목록에서 뺀다. 여기서 빠져야 아무도 못 꺼내고 지울 수 있게 된다
static void RemoveSession(Session* s){
    AcquireSRWLockExclusive(&g_session_lock);

    for ( int i = 0; i < MAX_SESSION; ++i){
        if(g_sessions[i] == s){
            g_sessions[i] = nullptr;
            break;
        }
    }

    ReleaseSRWLockExclusive(&g_session_lock);
}

// 붙잡는다. 주문을 걸기 전이나 목록에서 꺼내 쓰기 전에 부른다
static void AddRef(Session* s){
    InterlockedIncrement(&s -> ref_count);
}

// 놓는다. 마지막 하나가 놓으면 그때 소켓 닫고 지운다
static void Release(Session* s){
    if (InterlockedDecrement(&s->ref_count) == 0) {
        printf("[Server]  %s:%d fully closed\n", s->ip, s->port);
        closesocket(s->sock);
        delete s;
    }
}

// 영업 종료 팻말을 건다. 문을 잠그지는 않는다
// 걸린 주문이 아직 있을 수 있어서, 지우는 건 ref_count 가 0 이 될 때 Release 가 한다
static void CloseSession(Session* s)
{
    if (InterlockedExchange(&s->closing, 1)== 1){
        return;
    }
    printf("[Server]  %s:%d closing\n", s->ip, s->port);
    
    RemoveSession(s);
    shutdown(s->sock, SD_BOTH);
    Release(s);
}

// 받는주문
static bool PostRecv(Session* s)
{
    s->recv_buf.Clean();   // 쓸 자리부터 확보한다

    ZeroMemory(&s->recv_io.overlapped, sizeof(OVERLAPPED));
    s->recv_io.type = IoType::Recv;
    s->recv_io.wsabuf.buf = s->recv_buf.WritePtr();      // 바구니 빈 자리를 가리킨다
    s->recv_io.wsabuf.len = s->recv_buf.WritableSize();  // 담을 수 있는 만큼


    AddRef(s);   //걸기 전에 올림 걸고 나서 올리면 그 사이에 완료돼서 Release가 먼저 될수 있음

    DWORD flags = 0;
    DWORD recived = 0;
    int rc = WSARecv(s->sock, &s->recv_io.wsabuf, 1, &recived, &flags, &s->recv_io.overlapped, nullptr);  

    if (rc == SOCKET_ERROR) {
        // WSA_IO_PENDING은 실패가 아니라 진행중임 비동기라 이게 정상
        int err = WSAGetLastError();
        if (err != WSA_IO_PENDING) {
            printf("[Server]  %s:%d WSARecv faild: %d\n", s->ip, s->port, err);
            Release(s);   //주문이 안 걸렸으니 올린거 도로 내림
            return false;
        }
    }
    return true;

}

static void StartSend(Session* s){
    AcquireSRWLockExclusive(&s->send_lock);
    char* ptr = s->send_buf.PeekPtr();
    int len = s->send_buf.PeekSize();
    ReleaseSRWLockExclusive(&s->send_lock);

    ZeroMemory(&s->send_io.overlapped, sizeof(OVERLAPPED));
    s->send_io.type = IoType::Send;
    s->send_io.wsabuf.buf = ptr;
    s->send_io.wsabuf.len = len;

    AddRef(s);

    DWORD sent = 0;
    int rc = WSASend(s->sock, &s->send_io.wsabuf, 1, &sent, 0, &s->send_io.overlapped, nullptr);

    if (rc == SOCKET_ERROR) {
        int err = WSAGetLastError();
        if (err != WSA_IO_PENDING) {
            printf("[SERVER] %s:%d WSASend failed: %d\n", s->ip, s->port, err);
            Release(s);
            CloseSession(s);
        }
    }
}

static void SendPacket(Session* s, const char* data, int len){
    if ( s-> closing ==1 ){
        return;
    }

    bool need_start = false;
    
    AcquireSRWLockExclusive(&s->send_lock);
    bool pushed = s->send_buf.Push(data, len);
    if (pushed && s->sending == 0){
        s->sending = 1;     // 내가 시작한다고 표시
        need_start = true;
    }
    ReleaseSRWLockExclusive(&s->send_lock);

    if (!pushed){
        // 안받아가서 쌓이기만 한것들 처리
        printf("[Server] %s:%d send buffer full\n", s->ip, s->port);
        CloseSession(s);
        return;
    }

    if (need_start){
        StartSend(s);
    }
}

// 접속 중인 모두에게 뿌린다. except는 제외
static void Broadcast(const char* data, int len, Session* except){
    Session* targets[MAX_SESSION];
    int count = 0;

    AcquireSRWLockShared(&g_session_lock);  //읽기 자물쇠
    for (int i = 0; i < MAX_SESSION; ++i){
        Session* t = g_sessions[i];
        if (t == nullptr) continue;
        if (t == except) continue;
        if (t->closing == 1) continue;

        AddRef(t);     //락 안에서 붙잡는다.
        targets[count++] = t;
    }
    ReleaseSRWLockShared(&g_session_lock);

    // 락 밖에서 보낸다
    for (int i = 0; i < count; ++i){
        SendPacket(targets[i], data, len);
        Release(targets[i]);        // 다 썼으니 놓는다
    }
}

// 바구니에서 완전한 패킷을 전부 꺼내서 처리
static void ProcessPackets(Session* s){
    while (true){
        int data = s->recv_buf.DataSize();
        // 헤더가 덜 왔다 
        if (data < HEADER_SIZE){
            break;
        }

        PacketHeader* h = (PacketHeader*)s->recv_buf.ReadPtr();

        if (h->size < HEADER_SIZE || h->size > MAX_PACKET_SIZE){
            printf("[Worker] %s:%d bad packet size %u\n", s->ip, s->port, h->size);
            CloseSession(s);
            return;
        }
        
        // 몸통이 덜 왔다
        if ( data < h->size){
            break;
        }

        int len = h->size;
        printf("[Worker] %s:%d packet id=%u size=%d\n", s->ip, s->port, h->id, len);

        Broadcast(s->recv_buf.ReadPtr(), len, nullptr);

        s->recv_buf.OnRead(len);
    }
}

// 주문확인하고 전달하고 안내하는 홀 직원
static DWORD WINAPI WorkerThread(LPVOID param){
    HANDLE iocp = (HANDLE)param;

    while (true){
        DWORD bytes= 0;
        ULONG_PTR key = 0;
        OVERLAPPED* ov = nullptr;

        //완성된거 나올때까지 여기서 멈춰있음
        BOOL ok = GetQueuedCompletionStatus(iocp, &bytes, (PULONG_PTR)&key, (LPOVERLAPPED*)&ov, INFINITE);

        //분기1 ov가 없음 = 손님 얘기가 아니라 픽업대가 닫힌거 여기만 Release 안함
        if (!ok && ov == nullptr){
            printf("[Worker] complition port closed\n");
            break;
        }

        Session* s = (Session*) key;     //누구인지
        IoContext* io = (IoContext*)ov;  //무슨 일인지

        //분기2 강제 종료 창 X로 닫음 프로세스 죽음 64 10054 같은거

        if (!ok) {
            printf("[Worker] %s:%d io faild: %lu\n", s->ip, s->port, GetLastError());
            CloseSession(s);
        }
        else if (io->type == IoType::Recv){
            //분기3 0바이트 = 손님이 정상적으로 끊음 에러 아님
            if (bytes == 0){
                printf("[Worker] %s:%d disconnected\n", s->ip, s->port);
                CloseSession(s);
            }
            //받은 게 있음 그대로 되돌려 보냄
            else {
                s->recv_buf.OnWrite(bytes);     // 바구니에 이만큼 찼다고 알림
                ProcessPackets(s);
                if (s->closing == 0){
                    PostRecv(s);        // 받기는 항상 다시 걸기
                }
            }
        }
        //분기4 보내기 완료, 나간 만큼 큐에서 빼고 남았으면 이어서 보내기
        else {
            bool more = false;
            AcquireSRWLockExclusive(&s->send_lock);
            s->send_buf.OnSent(bytes);
            more = s->send_buf.Size() > 0;
            if (!more){
                s->sending = 0;     //다 보냈다.
            }
            ReleaseSRWLockExclusive(&s->send_lock);

            if(more && s->closing == 0){
                StartSend(s);
            }
        }
        Release(s);   //이 주문 하나 끝남 손님 한명 나간거
    }
    return 0;
}

// 순서: 픽업대 만들고 -> 워커 띄우고 -> listen 열고 -> accept 만 반복
int main(){
    // 로그를 모아뒀다가 한꺼번에 내보내지 않고 바로 찍게 한다.
    // 화면에 직접 띄울 때는 상관없지만, 파일로 넘기거나 서버가 강제 종료되면
    // 모아둔 로그가 통째로 날아간다. 서버 로그는 사고 직전이 제일 중요하다.
    setvbuf(stdout, nullptr, _IONBF, 0);

    InitializeSRWLock(&g_session_lock);

    WSADATA wsa;
    int rc = WSAStartup(MAKEWORD(2,2), &wsa);
    if(rc != 0){
        printf("[Server] WSAStartup faild: %d\n", rc);
        return 1;

    }
    HANDLE iocp = CreateIoCompletionPort(INVALID_HANDLE_VALUE, nullptr, 0,0);
    if (iocp == nullptr){
        printf("[Server] CreateIoCompletionPort faild: %lu\n", GetLastError());
        WSACleanup();
        return 1;
    }

    HANDLE workers[WORKER_COUNT];
    for (int i = 0; i < WORKER_COUNT; ++i){
        workers[i] = CreateThread(nullptr, 0, WorkerThread, iocp, 0, nullptr);
        if (workers[i] == nullptr){
            printf("[Server] CreateThread faild: %lu\n", GetLastError());
            CloseHandle(iocp);
            WSACleanup();
            return 1;
        }
    }
    printf("[Server] %d workers started\n", WORKER_COUNT);
    

    SOCKET listen_sock = socket(AF_INET, SOCK_STREAM, IPPROTO_TCP);
    if (listen_sock == INVALID_SOCKET) {
        printf("[Server] socket faild: %d\n", WSAGetLastError());
        CloseHandle(iocp);
        WaitForMultipleObjects(WORKER_COUNT, workers, TRUE, 1000);
        for(int i = 0; i < WORKER_COUNT; i++){
            CloseHandle(workers[i]);
        }
        WSACleanup();
        return 1; 
    }

    sockaddr_in server_addr = {};
    server_addr.sin_family = AF_INET;
    server_addr.sin_port = htons(SERVER_PORT);
    server_addr.sin_addr.s_addr = htonl(INADDR_ANY);

    if (bind(listen_sock, (sockaddr*)&server_addr, sizeof(server_addr)) == SOCKET_ERROR) {
        printf("[Server] bind faild: %d\n", WSAGetLastError());
        closesocket(listen_sock);
        WSACleanup();
        return 1;
    }

    if (listen(listen_sock, SOMAXCONN) == SOCKET_ERROR) {
        printf("[Server] listen faild: %d\n", WSAGetLastError());
        closesocket(listen_sock);
        WSACleanup();
        return 1;
    }
    printf("[Server] listening on port %d (IOCP + session)\n", SERVER_PORT);

    while (true) {
        sockaddr_in client_addr = {};
        int client_addr_len = sizeof(client_addr);
        SOCKET client_sock = accept(listen_sock, (sockaddr*)&client_addr, &client_addr_len);
        if (client_sock == INVALID_SOCKET) {
            printf("[Server] accept faild: %d\n", WSAGetLastError());
            break;
        }

        Session* s = new Session();
        s->sock = client_sock;
        s->ref_count = 1;
        s->closing = 0;
        s->sending = 0;
        InitializeSRWLock(&s->send_lock);
        inet_ntop(AF_INET, &client_addr.sin_addr, s->ip, sizeof(s->ip));
        s->port = ntohs(client_addr.sin_port);

        if(!AddSession(s)){
            printf("[Server] session list full\n");
            closesocket(client_sock);
            delete s;
            continue;
        }

        if (CreateIoCompletionPort((HANDLE)client_sock, iocp, (ULONG_PTR)s, 0) == nullptr) {
            printf("[Server] associate faild: %lu\n", GetLastError());
            CloseSession(s);
            continue;
        }

        printf("[Session] %s:%d connected\n", s->ip, s->port);

        //첫 주문 여기 지나면 s의 주인은 worker
        //실패하면 PostRecv 안의 Release가 이미 닫고 지웠음 여기서 또 하면 이중해제
        if (!PostRecv(s)) {
            printf("[Server] first PostRecv faild\n");
            CloseSession(s);
        }
    }

    closesocket(listen_sock);
    CloseHandle(iocp);
    WaitForMultipleObjects(WORKER_COUNT, workers, TRUE, 1000);
        for(int i = 0; i < WORKER_COUNT; i++){
            CloseHandle(workers[i]);
        }
    WSACleanup();
    return 0;
}
