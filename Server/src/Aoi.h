// Server/src/Aoi.h — 누구에게 무엇을 보낼 것인가
//
// ── 왜 이게 이 프로젝트의 핵심인가 ──────────────────────────
//
// 이 게임은 걸치기가 핵심 조작이라 위치를 **연속값**으로 들고 있어야 한다.
// 연속값이면 매 틱 보내야 한다. 타일 단위였으면 칸이 바뀔 때만 보내면 된다.
//
// 그래서 게임 디자인 하나가 서버에 요구를 만들었다.
//   "걸치기가 재밌다" -> "위치가 연속이어야 한다" -> "매 틱 전송" -> "AOI 가 필수"
//
// SPEC 1절이 말하는 "게임 디자인 결정이 서버 설계 요구로 번역되는 과정" 이 이것이다.
//
// ── 셀을 왜 맵 조각과 같게 잡았나 ───────────────────────────
//
// AOI 셀 = 맵 조각 = 15x13 = 카메라 한 화면.
//
// 셀을 따로 잡으면 **보내는 것과 보이는 것이 어긋난다.**
//   셀이 화면보다 작으면 화면 끝에 있는 사람이 안 보인다. 그건 버그로 보인다
//   셀이 화면보다 크면 안 보이는 것까지 보내는 것이라 아낀 게 없다
// 같게 잡으면 "화면에 보일 것만 보낸다" 가 그대로 규칙이 된다.
//
// ── 무엇을 거르고 무엇을 안 거르나 (SPEC 4절) ───────────────
//
//   사람 위치     지금 구역만          매 틱.  크고 잦다. **이게 주 대상이다**
//   물풍선·물줄기 구역 + 가장자리 3칸  이벤트. 위험은 넘어가기 전에 보여야 한다
//   지형 파괴     구역 + 가장자리 3칸  이벤트. 흐리게 보이는 데와 안 맞으면 어색하다
//   아이템        지금 구역만          이벤트. 파밍 정보 우위를 안 준다
//   침수·킬피드   전역                 작고 드물다. **거르는 게 오히려 낭비다**
//
// **AOI 는 대역폭 최적화지 게임 규칙이 아니다.**
// 작고 드물게 바뀌는 것은 그냥 전원에게 보내는 게 맞다. 크고 잦은 것만 거른다.
//
// ── 왜 사람마다가 아니라 구역마다 만드나 ───────────────────
//
// 사람마다 스냅샷을 만들면 24번 만든다. 그런데 **같은 구역에 있는 사람은
// 똑같은 것을 본다.** 그래서 구역마다 한 번, 최대 9번만 만들고 돌려 쓴다.
//
// 이게 AOI 의 진짜 비용 구조다. 대역폭을 줄이는 대신 CPU 를 쓴다.
// 9번이면 싸고 24번이면 비싸다. 셀을 화면과 같게 잡은 덕에 9번으로 끝난다.
//
// 소유 스레드 : tick
#pragma once

#include "Network.h"
#include "Bot.h"

// 켜고 끌 수 있어야 한다. 안 그러면 **전후를 잴 수가 없다.**
// SPEC 9.1 의 표가 이 스위치 하나로 채워진다 (Server.exe aoi 0)
inline bool g_aoi_on = true;

// 얼마나 오갔나. 초당 한 번 찍어서 전후를 비교한다
struct NetStat
{
    long long packets;
    long long bytes;
    long long builds;    // 스냅샷을 몇 번 만들었나. AOI 의 CPU 비용이 여기 있다
};
inline NetStat g_net = {};

inline int SectorOf(int tx, int ty)
{
    int sx = tx / SECTOR_W;
    int sy = ty / SECTOR_H;
    if (sx > SECTOR_COLS - 1) sx = SECTOR_COLS - 1;
    if (sy > SECTOR_ROWS - 1) sy = SECTOR_ROWS - 1;
    if (sx < 0) sx = 0;
    if (sy < 0) sy = 0;
    return sy * SECTOR_COLS + sx;
}

// 구역 s 를 보고 있는 사람에게 이 칸이 보이나.
//
// margin 이 0 이면 그 구역 안만. 3 이면 가장자리 밖 세 칸까지.
// 물풍선을 3칸까지 보여주는 이유는 **구역을 넘어가자마자 죽으면 억울하기 때문**이다.
// 위험은 넘어가기 전에 보여야 한다
inline bool VisibleTo(int sector, int tx, int ty, int margin)
{
    int sx = (sector % SECTOR_COLS) * SECTOR_W;
    int sy = (sector / SECTOR_COLS) * SECTOR_H;

    return tx >= sx - margin && tx < sx + SECTOR_W + margin
        && ty >= sy - margin && ty < sy + SECTOR_H + margin;
}

// 이 세션이 보고 있는 구역. 죽었거나 자리가 없으면 -1 (전부 본다)
inline int WatchSectorOf(int slot)
{
    if (slot < 0 || slot >= PLAYER_MAX) {
        return -1;
    }
    const Player& p = g_game.players[slot];
    if (!p.alive) {
        return -1;   // 죽은 사람은 관전이다. 다 보여준다
    }
    return SectorOf(p.judge_tx, p.judge_ty);
}

// 한 구역에 앉아 있는 사람들에게 보낸다.
//
// Broadcast 와 같은 방식으로 참조를 올려두고 자물쇠 밖에서 보낸다.
// 자물쇠를 쥔 채로 보내면 그동안 아무도 접속을 못 한다
inline void SendToSector(int sector, const char* data, int len)
{
    Session* targets[PLAYER_MAX];
    int count = 0;

    for (int i = 0; i < PLAYER_MAX; ++i) {
        const Player& p = g_game.players[i];
        if (p.s == nullptr) continue;
        if (p.s->closing == 1) continue;

        int watch = WatchSectorOf(i);
        if (sector >= 0 && watch != sector) continue;
        if (sector < 0  && watch >= 0)      continue;   // 관전자 묶음

        AddRef(p.s);
        targets[count++] = p.s;
    }

    for (int i = 0; i < count; ++i) {
        SendPacket(targets[i], data, len);
        g_net.packets += 1;
        g_net.bytes   += len;
        Release(targets[i]);
    }
}

// 이 칸이 보이는 사람에게만 보낸다. 이벤트용.
//
// 이벤트는 구역마다 만들어 돌려 쓸 수가 없다. 어차피 몸통이 5바이트라
// 만드는 값이 안 든다. 스냅샷과 달리 그냥 사람마다 판단한다
inline void SendToWatchers(int tx, int ty, int margin, const char* data, int len)
{
    Session* targets[PLAYER_MAX];
    int count = 0;

    for (int i = 0; i < PLAYER_MAX; ++i) {
        const Player& p = g_game.players[i];
        if (p.s == nullptr) continue;
        if (p.s->closing == 1) continue;

        int watch = WatchSectorOf(i);
        if (watch >= 0 && !VisibleTo(watch, tx, ty, margin)) continue;

        AddRef(p.s);
        targets[count++] = p.s;
    }

    for (int i = 0; i < count; ++i) {
        SendPacket(targets[i], data, len);
        g_net.packets += 1;
        g_net.bytes   += len;
        Release(targets[i]);
    }
}

// 한 사람에게만. 익사 카운트다운처럼 본인만 알면 되는 것
inline void SendToOne(int slot, const char* data, int len)
{
    if (slot < 0 || slot >= PLAYER_MAX) return;
    Session* s = g_game.players[slot].s;
    if (s == nullptr || s->closing == 1) return;

    AddRef(s);
    SendPacket(s, data, len);
    g_net.packets += 1;
    g_net.bytes   += len;
    Release(s);
}

// 전원에게. 침수와 킬 피드처럼 작고 드문 것
inline void SendToAll(const char* data, int len)
{
    Session* targets[MAX_SESSION];
    int count = 0;

    AcquireSRWLockShared(&g_session_lock);
    for (int i = 0; i < MAX_SESSION; ++i) {
        Session* t = g_sessions[i];
        if (t == nullptr || t->closing == 1) continue;
        AddRef(t);
        targets[count++] = t;
    }
    ReleaseSRWLockShared(&g_session_lock);

    for (int i = 0; i < count; ++i) {
        SendPacket(targets[i], data, len);
        g_net.packets += 1;
        g_net.bytes   += len;
        Release(targets[i]);
    }
}

// 이벤트 하나를 정책대로 보낸다.
//
// **이 표가 SPEC 4절 그대로다.** 표를 코드로 옮긴 것이 이 switch 하나다
inline void RouteEvent(uint8_t type, int x, int y, int who, const char* data, int len)
{
    if (!g_aoi_on) {
        SendToAll(data, len);
        return;
    }

    switch (type) {
        // 전역. 작고 드물다. 거르는 게 오히려 낭비다.
        // 킬 피드는 **전원이 봐야 판이 어떻게 돌아가는지 안다**
        case EVT_FLOOD_WARN:
        case EVT_FLOOD:
        case EVT_RING:
        case EVT_POP:
            SendToAll(data, len);
            return;

        // 본인만. 내가 물에 빠졌다는 걸 남이 알 이유가 없다
        case EVT_DROWN:
            SendToOne(who, data, len);
            return;

        // 위험과 지형은 가장자리 밖 세 칸까지.
        // 구역을 넘어가자마자 죽으면 그건 실력이 아니라 정보가 없어서 죽은 것이다
        case EVT_BUBBLE:
        case EVT_BLAST:
        case EVT_CHAIN:
        case EVT_BLOCK:
        case EVT_PUSH:
            SendToWatchers(x, y, PEEK_TILES, data, len);
            return;

        // 나머지는 그 구역만. 아이템 위치를 남이 알면 파밍 정보 우위가 생긴다
        default:
            SendToWatchers(x, y, 0, data, len);
            return;
    }
}
