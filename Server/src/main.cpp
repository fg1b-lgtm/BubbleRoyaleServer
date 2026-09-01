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
#include "Aoi.h"

// 자리가 없어서 못 앉은 사람. 보고는 있고 다음 판에 앉는다.
//
// 소유 스레드 : tick
//   HandleJob 과 틱 루프에서만 만진다. 둘 다 틱 스레드라 자물쇠가 없다.
//
// 판에 자리가 없다고 연결을 끊어버리면 그 사람은 아무것도 못 본다.
// 스냅샷은 어차피 전원에게 나가므로, 안 끊고 두면 관전이 저절로 된다.
static Session* g_viewers[MAX_SESSION];
static int      g_viewer_count = 0;

static void AddViewer(Session* s)
{
    if (g_viewer_count >= MAX_SESSION) {
        return;
    }
    g_viewers[g_viewer_count++] = s;
}

static void RemoveViewer(Session* s)
{
    for (int i = 0; i < g_viewer_count; ++i) {
        if (g_viewers[i] == s) {
            g_viewers[i] = g_viewers[--g_viewer_count];
            return;
        }
    }
}

// 판이 새로 깔렸다. 기다리던 사람부터 앉힌다
static void SeatViewers()
{
    for (int i = 0; i < g_viewer_count; ) {
        int slot = AddPlayer(g_viewers[i]);
        if (slot < 0) {
            ++i;   // 아직도 자리가 없다
            continue;
        }
        printf("[Tick] %s:%d seated as p%d\n", g_viewers[i]->ip, g_viewers[i]->port, slot);
        g_viewers[i] = g_viewers[--g_viewer_count];
    }
}

// 패킷 하나가 한도를 안 넘는지 컴파일할 때 확인한다.
// 넘치면 돌려보기 전에 여기서 막힌다
static_assert(HEADER_SIZE + sizeof(SnapshotHead)
              + PLAYER_MAX * sizeof(PlayerState)
              + MAX_SNAPSHOT_BUBBLE * sizeof(BubbleState) <= MAX_PACKET_SIZE,
              "snapshot packet is too big");
static_assert(HEADER_SIZE + sizeof(MapRowHead) + 2 * MAP_W <= MAX_PACKET_SIZE,
              "map row packet is too big");

// 접속한 사람에게만 보낸다. 판이 어떻게 생겼는지와 게임 상수를 알려준다
static void SendWelcome(Session* s, int slot)
{
    char buf[WELCOME_PACKET_SIZE];

    PacketHeader h;
    h.size = (uint16_t)WELCOME_PACKET_SIZE;
    h.id   = PKT_WELCOME;
    memcpy(buf, &h, HEADER_SIZE);

    WelcomeBody w;
    w.your_id            = (uint8_t)slot;
    w.map_w              = (uint8_t)MAP_W;
    w.map_h              = (uint8_t)MAP_H;
    w.sector_w           = (uint8_t)SECTOR_W;
    w.sector_h           = (uint8_t)SECTOR_H;
    w.tick_rate          = (uint8_t)TICK_RATE;
    w.tile_units         = (uint16_t)TILE_UNITS;
    w.fuse_ticks         = (uint16_t)BUBBLE_FUSE_TICKS;
    w.trap_ticks         = (uint16_t)TRAP_DURATION_TICKS;
    w.flood_escape_ticks = (uint16_t)FLOOD_ESCAPE_TICKS;
    w.blast_ticks        = (uint8_t)BLAST_DURATION_TICKS;
    w.body_num           = (uint8_t)PLAYER_BODY_NUM;
    w.body_den           = (uint8_t)PLAYER_BODY_DEN;
    w.peek_tiles         = (uint8_t)PEEK_TILES;
    w.seed               = g_game.map.seed;

    // 아홉 자리에 어떤 조각이 깔렸는지. 화면이 구역마다 다르게 그리는 데 쓴다
    for (int i = 0; i < SECTOR_SLOTS; ++i) {
        w.sector_kind[i] = g_game.map.sector_template[i];
    }

    memcpy(buf + HEADER_SIZE, &w, sizeof(w));

    SendPacket(s, buf, WELCOME_PACKET_SIZE);

    // 판을 한 줄씩. 한 패킷에 다 담으면 한도를 넘는다
    for (int y = 0; y < MAP_H; ++y) {
        char row[HEADER_SIZE + sizeof(MapRowHead) + 2 * MAP_W];
        int  len = (int)sizeof(row);

        PacketHeader rh;
        rh.size = (uint16_t)len;
        rh.id   = PKT_MAPROW;
        memcpy(row, &rh, HEADER_SIZE);

        row[HEADER_SIZE] = (char)y;

        char* tiles = row + HEADER_SIZE + sizeof(MapRowHead);
        char* items = tiles + MAP_W;

        for (int x = 0; x < MAP_W; ++x) {
            tiles[x] = (char)g_game.map.tile[y][x];
            items[x] = (char)g_game.item[y][x];
        }

        SendPacket(s, row, len);
    }
}

// 매 틱. 누가 어디 있고 물풍선이 어디 있나.
//
// **구역마다 한 번 만들어서 그 구역 사람들에게 돌려 쓴다.**
// 같은 구역에 있으면 똑같은 것을 보기 때문이다. 사람마다 만들면 24번,
// 구역마다 만들면 최대 9번(+관전 1번)이다.
//
// 무엇을 담나 (SPEC 4절)
//   사람      그 구역에 있는 사람만.       크고 잦아서 여기가 제일 크게 줄어든다
//   물풍선    구역 + 가장자리 밖 세 칸.    넘어가자마자 죽으면 억울하다
//
// watch 가 -1 이면 관전자다. 죽은 사람과 자리 없는 사람. 전부 보여준다
static int BuildSnapshot(char* buf, int watch)
{
    int pos = HEADER_SIZE + (int)sizeof(SnapshotHead);

    SnapshotHead sh;
    sh.tick = (uint32_t)g_game.tick;
    for (int i = 0; i < 9; ++i) {
        sh.sectors[i] = g_game.sector_state[i / SECTOR_COLS][i % SECTOR_COLS];
    }
    sh.phase       = g_game.phase;
    sh.phase_ticks = (uint16_t)(g_game.phase_ticks > 65535 ? 65535 : g_game.phase_ticks);
    sh.winner      = (uint8_t)(g_game.winner < 0 ? 0xFF : g_game.winner);
    sh.round_no    = (uint8_t)(g_game.round_no & 0xFF);

    if (g_game.ring_on) {
        sh.ring_x0 = (uint8_t)g_game.ring_x0;
        sh.ring_y0 = (uint8_t)g_game.ring_y0;
        sh.ring_x1 = (uint8_t)g_game.ring_x1;
        sh.ring_y1 = (uint8_t)g_game.ring_y1;
    }
    else {
        sh.ring_x0 = 0xFF;   // 아직 안 쓴다
        sh.ring_y0 = 0xFF;
        sh.ring_x1 = 0xFF;
        sh.ring_y1 = 0xFF;
    }

    // 생존자는 전역이다. 내가 못 보는 데서 죽어도 숫자는 맞아야 한다
    sh.alive_count  = (uint8_t)AliveCount();
    sh.alive_mask[0] = 0;
    sh.alive_mask[1] = 0;
    sh.alive_mask[2] = 0;
    for (int i = 0; i < PLAYER_MAX; ++i) {
        if (Occupied(g_game.players[i]) && g_game.players[i].alive) {
            sh.alive_mask[i >> 3] |= (uint8_t)(1 << (i & 7));
        }
    }

    sh.player_count = 0;
    sh.bubble_count = 0;

    for (int i = 0; i < PLAYER_MAX; ++i) {
        const Player& p = g_game.players[i];
        if (!Occupied(p)) {
            continue;   // 빈 자리. 봇은 세션이 없어도 나간다
        }

        // 사람 위치는 그 구역만. AOI 의 주 대상이다
        if (g_aoi_on && watch >= 0 && !VisibleTo(watch, p.judge_tx, p.judge_ty, 0)) {
            continue;
        }

        PlayerState ps;
        ps.id    = (uint8_t)i;
        ps.x     = (uint16_t)p.px;
        ps.y     = (uint16_t)p.py;
        ps.jtx   = (uint8_t)p.judge_tx;
        ps.jty   = (uint8_t)p.judge_ty;
        ps.flags = 0;
        if (p.alive)            ps.flags |= PF_ALIVE;
        if (p.trap_ticks   > 0) ps.flags |= PF_TRAPPED;
        if (p.invuln_ticks > 0) ps.flags |= PF_INVULN;
        if (p.flood_ticks  > 0) ps.flags |= PF_DROWNING;
        if (p.moving)           ps.flags |= PF_MOVING;
        ps.flags |= (uint8_t)((p.face & 3) << PF_FACE_SHIFT);
        ps.bubble_lv = (uint8_t)p.bubble_lv;
        ps.power_lv  = (uint8_t)p.power_lv;
        ps.speed_lv  = (uint8_t)p.speed_lv;

        memcpy(buf + pos, &ps, sizeof(ps));
        pos += (int)sizeof(ps);
        ++sh.player_count;
    }

    for (int i = 0; i < MAX_BUBBLE && sh.bubble_count < MAX_SNAPSHOT_BUBBLE; ++i) {
        const Bubble& b = g_game.bubbles[i];
        if (!b.used) {
            continue;
        }
        // 물풍선은 가장자리 밖 세 칸까지 보여준다
        if (g_aoi_on && watch >= 0 && !VisibleTo(watch, b.tx, b.ty, PEEK_TILES)) {
            continue;
        }

        BubbleState bs;
        bs.tx    = (uint8_t)b.tx;
        bs.ty    = (uint8_t)b.ty;
        bs.fuse  = (uint8_t)(b.fuse < 0 ? 0 : (b.fuse > 255 ? 255 : b.fuse));
        bs.owner = (uint8_t)(b.owner < 0 ? 0xFF : b.owner);

        memcpy(buf + pos, &bs, sizeof(bs));
        pos += (int)sizeof(bs);
        ++sh.bubble_count;
    }

    PacketHeader h;
    h.size = (uint16_t)pos;
    h.id   = PKT_SNAPSHOT;
    memcpy(buf, &h, HEADER_SIZE);
    memcpy(buf + HEADER_SIZE, &sh, sizeof(sh));

    ++g_net.builds;
    return pos;
}

static void SendSnapshot()
{
    if (g_game.player_count == 0) {
        return;
    }

    char buf[MAX_PACKET_SIZE];

    if (!g_aoi_on) {
        int len = BuildSnapshot(buf, -1);
        SendToAll(buf, len);
        return;
    }

    // 어느 구역에 사람이 앉아 있는지 먼저 센다.
    // 아무도 안 보는 구역은 만들 이유가 없다. 아홉 구역에 두 명이면 두 번만 만든다
    bool need[SECTOR_SLOTS] = {};
    bool need_watcher = false;

    for (int i = 0; i < PLAYER_MAX; ++i) {
        if (g_game.players[i].s == nullptr) continue;
        int w = WatchSectorOf(i);
        if (w < 0) need_watcher = true;
        else       need[w] = true;
    }

    for (int sct = 0; sct < SECTOR_SLOTS; ++sct) {
        if (!need[sct]) continue;
        int len = BuildSnapshot(buf, sct);
        SendToSector(sct, buf, len);
    }

    // 관전자. 죽은 사람과 자리 없는 사람은 판 전체를 본다
    if (need_watcher) {
        int len = BuildSnapshot(buf, -1);
        SendToSector(-1, buf, len);
    }
}

// 이번 틱에 생긴 일을 내보낸다.
//
// 지금은 거리를 안 본다. 9/3 에 AOI 를 붙이면 여기서 걸러진다.
// 이벤트마다 갈 데가 다르다. 그 표가 Aoi.h 의 RouteEvent 다 (SPEC 4절).
// 폭발 한 번에 EVT_BLAST 가 사거리만큼 나가므로 여기가 두 번째로 큰 줄기다.
static void FlushEvents()
{
    for (int i = 0; i < g_game.event_count; ++i) {
        const GameEvent& e = g_game.events[i];

        char buf[EVENT_PACKET_SIZE];

        PacketHeader h;
        h.size = (uint16_t)EVENT_PACKET_SIZE;
        h.id   = PKT_EVENT;
        memcpy(buf, &h, HEADER_SIZE);

        EventBody b;
        b.type  = e.type;
        b.x     = e.x;
        b.y     = e.y;
        b.who   = e.who;
        b.value = e.value;
        memcpy(buf + HEADER_SIZE, &b, sizeof(b));

        RouteEvent(e.type, e.x, e.y, e.who, buf, EVENT_PACKET_SIZE);

        // 클라이언트가 아직 없어서 로그가 유일한 화면이다.
        // EVT_BLAST 는 한 번에 스무 줄씩 나와서 읽을 수 없으므로 뺀다
        switch (e.type) {
        case EVT_GRAZE:  printf("[Game] GRAZE      p%u at (%u,%u)\n", e.who, e.x, e.y); break;
        case EVT_CHAIN:  printf("[Game] CHAIN x%u   at (%u,%u)\n", e.value, e.x, e.y); break;
        case EVT_TRAP:   printf("[Game] TRAPPED    p%u at (%u,%u)\n", e.who, e.x, e.y); break;
        case EVT_BREAK:  printf("[Game] BREAK OUT  p%u at (%u,%u)\n", e.who, e.x, e.y); break;
        case EVT_DEATH:  printf("[Game] DEAD       p%u at (%u,%u)\n", e.who, e.x, e.y); break;
        case EVT_ITEM:   printf("[Game] ITEM %u     p%u at (%u,%u)\n", e.value, e.who, e.x, e.y); break;
        case EVT_BUBBLE: printf("[Game] BUBBLE     p%u at (%u,%u) range %u\n", e.who, e.x, e.y, e.value); break;
        case EVT_FLOOD_WARN: printf("[Game] FLOOD IN %u  sector %u\n", e.value, e.x); break;
        case EVT_FLOOD:      printf("[Game] FLOODED    sector %u\n", e.x); break;
        case EVT_RING:       printf("[Game] WATER RISING  safe area %u wide\n", e.value); break;
        case EVT_DROWN:      printf("[Game] DROWNING   p%u at (%u,%u) %u sec\n", e.who, e.x, e.y, e.value); break;
        default: break;
        }
    }

    // 내보냈으니 비운다.
    // 비우는 걸 GameTick 앞쪽에서 하면, 그보다 앞 단계인 주문 처리에서 생긴 일
    // (물풍선 설치)이 나가기 전에 지워진다
    g_game.event_count = 0;
}

// 주문 하나를 처리한다. 이 함수는 틱 스레드에서만 불린다.
static void HandleJob(const Job* j){
    Session* s = j->s;

    switch (j->type) {
        case JobType::Enter: {
            // 판에 앉힌다. 이건 틱 스레드에서만 부른다. 그래서 g_game 에 자물쇠가 없다
            // 자리가 봇으로 차 있으면 봇을 하나 빼고 사람을 앉힌다.
            // 사람이 봇보다 우선이다
            int slot = AddPlayer(s);
            if (slot < 0 && DropOneBot()) {
                slot = AddPlayer(s);
            }
            if (slot < 0) {
                // 끊지 않는다. 보고 있다가 다음 판에 앉는다
                printf("[Tick] %s:%d board is full — spectating\n", s->ip, s->port);
                AddViewer(s);
                SendWelcome(s, 0xFF);
                break;
            }
            Player& p = g_game.players[slot];
            printf("[Tick] %s:%d entered as p%d at tile (%d,%d)\n",
                   s->ip, s->port, slot, p.judge_tx, p.judge_ty);

            // 봇만 돌고 있던 판이면 사람이 오는 순간 새로 시작한다.
            //
            // "판이 도는 중에 들어오면 그 판은 관전" 은 사람들 사이의 규칙이다 (SPEC 2.1).
            // 남들이 파밍한 판에 빈손으로 끼워 넣으면 억울하니까 그렇게 정했다.
            // 그런데 상대가 전부 봇이면 억울할 사람이 없다.
            // 이 규칙을 그대로 두면 링크를 연 사람이 봇 경기를 최대 5분 구경하게 된다.
            //
            // 판을 다시 깔면 map_changed 가 서고, 틱 루프가 전원에게 WELCOME 을 다시 보낸다
            if (HumanCount() == 1 && g_game.phase != ROUND_WAITING) {
                printf("[Tick] first human joined a bot-only round — restarting\n");
                RestartGame();
                break;
            }

            // 판이 어떻게 생겼는지는 접속한 사람에게만 보낸다.
            //
            // 이 틱에 판이 새로 깔릴 예정이면 여기서 안 보낸다.
            // 틱 끝에서 map_changed 를 보고 전원에게 다시 보내므로 두 번 가게 된다.
            // 판 39줄이 두 번 가는 것이라 그냥 낭비가 아니다
            if (!g_game.map_changed) {
                SendWelcome(s, slot);
            }
            break;
        }
        case JobType::Leave:
            RemovePlayer(s);
            RemoveViewer(s);
            printf("[Tick] %s:%d left\n", s->ip, s->port);
            break;
        case JobType::Packet: {
            const PacketHeader* h = (const PacketHeader*)j->data;

            switch(h->id){
                case PKT_ECHO:
                    Broadcast(j->data, h->size, nullptr);
                    break;

                case PKT_MOVE: {
                    // 크기를 먼저 본다. 몸통이 모자라면 없는 바이트를 읽게 된다
                    if (h->size != MOVE_PACKET_SIZE) {
                        printf("[Session] %s:%d bad move size %u\n", s->ip, s->port, h->size);
                        CloseSession(s);
                        break;
                    }
                    const MoveBody* mb = (const MoveBody*)(j->data + HEADER_SIZE);
                    SetInput(s, mb->dx, mb->dy);
                    break;
                }

                case PKT_RESTART: {
                    // 시험용. 기다리지 않고 지금 다음 판으로 넘어간다.
                    // 판이 바뀐 건 map_changed 를 보고 틱 루프가 알려준다
                    printf("[Server] restart by %s:%d\n", s->ip, s->port);
                    RestartGame();
                    break;
                }

                case PKT_PLACE: {
                    // 어디에 놓을지는 안 받는다. 서버가 아는 자리에만 놓는다.
                    // 좌표를 받으면 맵 반대편에도 놓겠다고 우길 수 있다
                    int slot = FindPlayer(s);
                    if (slot >= 0) {
                        PlaceBubble(slot);
                    }
                    break;
                }

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

        // 1) 꽂힌 주문을 통째로 가져온다. 통이 둘이다
        Job*     jobs  = nullptr;
        LifeJob* lives = nullptr;
        int      lcount = 0;
        int      count  = SwapJobs(&jobs, &lives, &lcount);

        // 2) 입·퇴장을 먼저 처리한다.
        //
        //    입장이 그 사람 패킷보다 먼저여야 한다. 안 그러면 자리도 없는데
        //    이동 주문이 먼저 와서 그냥 버려진다.
        //    퇴장이 남은 패킷보다 먼저 처리되는 건 괜찮다. 자리가 이미 비어서 무시된다
        Job tmp;
        for (int i = 0; i < lcount; ++i) {
            tmp.type = lives[i].type;
            tmp.s    = lives[i].s;
            tmp.len  = 0;
            HandleJob(&tmp);
            Release(lives[i].s);
        }

        // 3) 그다음 패킷. 여긴 나 혼자다
        for (int i = 0; i < count; ++i) {
            HandleJob(&jobs[i]);
            Release(jobs[i].s);   // 꽂을 때 든 참조를 여기서 놓는다
        }

        // 4) 게임 한 틱. 여기서 만지는 것은 전부 이 스레드 것이라 자물쇠가 없다
        uint8_t phase_before = g_game.phase;

        // 봇은 입력원이다. 사람이 보낸 주문을 처리한 다음, 게임을 돌리기 전에 둔다.
        //
        // GameTick 안에서 안 부르는 이유는 Bot.h 가 GameTick.h 를 쓰기 때문이다.
        // 안에서 부르면 서로가 서로를 필요로 하게 된다
        if (g_bot_target > 0 && g_game.phase == ROUND_WAITING) {
            FillBots(g_bot_target);
        }
        BotThinkAll();

        GameTick();

        // 판이 새로 깔렸으면 전원에게 판을 다시 보낸다.
        // 게임 코드는 소켓을 모르므로 깃발만 세우고 여기서 처리한다
        if (g_game.map_changed) {
            g_game.map_changed = false;

            SeatViewers();   // 자리를 못 잡고 보고 있던 사람부터 앉힌다

            for (int i = 0; i < PLAYER_MAX; ++i) {
                if (g_game.players[i].s != nullptr) {
                    SendWelcome(g_game.players[i].s, i);
                }
            }
            for (int i = 0; i < g_viewer_count; ++i) {
                SendWelcome(g_viewers[i], 0xFF);
            }
        }

        if (g_game.phase != phase_before) {
            static const char* kName[4] = { "WAITING", "COUNTDOWN", "PLAYING", "OVER" };
            printf("[Round %d] %s -> %s (%d players)\n",
                   g_game.round_no, kName[phase_before], kName[g_game.phase],
                   g_game.player_count);

            if (g_game.phase == ROUND_OVER) {
                if (g_game.winner >= 0) {
                    printf("[Round %d] WINNER p%d\n", g_game.round_no, g_game.winner);
                }
                else {
                    printf("[Round %d] DRAW\n", g_game.round_no);
                }
            }
        }

        SendSnapshot();   // 위치가 먼저다. 이벤트는 그 위치에서 일어난 일이다
        FlushEvents();

        // 1초에 한 번, 얼마나 오갔는지 찍는다.
        //
        // AOI 를 켜고 끈 두 줄을 나란히 놓는 것이 SPEC 9.1 의 표다.
        // "줄었을 것이다" 가 아니라 **얼마나 줄었는지**를 말할 수 있어야 한다.
        //
        // builds 도 같이 찍는다. AOI 는 공짜가 아니라 대역폭을 CPU 로 바꾸는 것이라,
        // 무엇을 얼마에 샀는지가 같이 보여야 한다
        if (tick % TICK_RATE == 0) {
            int humans = HumanCount();
            if (humans > 0) {
                printf("[Net] aoi=%d players=%d(+%d bots)  %lld pkt/s  %lld B/s  "
                       "builds %lld/s  dropped pkt %lld life %lld\n",
                       g_aoi_on ? 1 : 0, humans, BotCount(),
                       g_net.packets, g_net.bytes, g_net.builds,
                       g_job_dropped, g_life_dropped);
            }
            g_net.packets = 0;
            g_net.bytes   = 0;
            g_net.builds  = 0;
        }

        // 1초에 한 번 판 상태를 찍는다. 매 틱 찍으면 로그를 읽을 수 없다.
        // 클라이언트가 없어서 지금은 이게 유일한 화면이다
        // 사람이 많으면 초당 24줄이 쏟아져서 읽을 수 없다.
        // 손으로 확인할 때(두세 명)만 찍는다
        if (g_game.player_count > 0 && g_game.player_count <= 4
            && g_game.phase == ROUND_PLAYING && tick % TICK_RATE == 0) {
            for (int i = 0; i < PLAYER_MAX; ++i) {
                Player& p = g_game.players[i];
                if (!Occupied(p)) {
                    continue;
                }

                int bx = p.px / TILE_UNITS;
                int by = p.py / TILE_UNITS;
                bool straddle = (bx != p.judge_tx) || (by != p.judge_ty);

                printf("[Tick] p%d pos=(%d,%d) tile=(%d,%d) judge=(%d,%d)%s\n",
                       i, p.px, p.py, bx, by, p.judge_tx, p.judge_ty,
                       straddle ? "  <-- 걸침" : "");
            }
        }

        //    4) 다음 틱 시각까지 잔다.
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
// Server.exe            SPEC 그대로. 침수가 6분에 걸쳐 진행된다
// Server.exe fast       침수 일정만 10배로 당긴다. 손맛 볼 때 6분을 기다릴 수는 없다
// Server.exe bots 0     봇을 안 채운다. 사람끼리만 하고 싶을 때
// Server.exe bots 24    자리를 꽉 채운다
// Server.exe aoi 0      AOI 를 끄고 전원에게 다 보낸다. **전후를 재려고 남겨둔 스위치다**
int main(int argc, char** argv)
{
    // 로그를 모아뒀다가 한꺼번에 내보내지 않고 바로 찍게 한다.
    // 서버가 강제 종료되면 모아둔 로그가 통째로 날아간다.
    // 서버 로그는 사고 직전이 제일 중요하다.
    setvbuf(stdout, nullptr, _IONBF, 0);

    InitSessionManager();
    InitJobQueue();

    // 판을 깐다. 씨앗을 로그에 찍어두면 같은 판을 다시 만들 수 있다.
    // 이상한 일이 생겼을 때 그 판을 그대로 재현하는 게 제일 빠른 길이다
    unsigned int map_seed   = 1234;
    int          flood_scale = 1;

    for (int i = 1; i < argc; ++i) {
        if (argv[i][0] == 'f') {
            flood_scale = 10;
        }
        else if (argv[i][0] == 'a' && i + 1 < argc) {
            g_aoi_on = (atoi(argv[++i]) != 0);
        }
        else if (argv[i][0] == 'b' && i + 1 < argc) {
            g_bot_target = atoi(argv[++i]);
            if (g_bot_target < 0)          g_bot_target = 0;
            if (g_bot_target > PLAYER_MAX) g_bot_target = PLAYER_MAX;
        }
    }

    InitGame(map_seed, flood_scale);
    printf("[Server] map %dx%d generated (seed %u, %d spawns)\n",
           MAP_W, MAP_H, map_seed, g_game.map.spawn_count);
    printf("[Server] flood x%d, first warning at %d s\n",
           flood_scale, g_game.flood_warn[0] / TICK_RATE);
    printf("[Server] round starts with %d players, %d s countdown\n",
           ROUND_MIN_PLAYERS, ROUND_COUNTDOWN_TICKS / TICK_RATE);
    printf("[Server] bots fill up to %d (Server.exe bots N to change)\n", g_bot_target);

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
