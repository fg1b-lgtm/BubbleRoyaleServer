// Common/Protocol.h — 서버와 클라이언트가 같이 보는 약속
//
// 이 파일이 갈리면 그게 곧 버그다. 그래서 한 곳에 두고 양쪽이 같이 본다.
//
// 고정 헤더 + 페이로드. 리틀 엔디안.
//   [ uint16 size ][ uint16 id ][ payload ... ]
// size 는 헤더를 포함한 전체 바이트다. 몸통이 없으면 4 다.
#pragma  once

#include <cstdint>

// 서버가 듣는 포트. 양쪽이 같아야 하므로 약속에 포함된다
constexpr unsigned short SERVER_PORT = 9000;

constexpr int HEADER_SIZE = 4;         // size 2 + id 2
constexpr int MAX_PACKET_SIZE = 1024;  // 이보다 크다고 하면 믿을 수 없는 상대다

// 패킷 종류. 숫자로 쓰면 읽는 사람이 모르니 이름을 붙인다
enum PacketId : uint16_t
{
    PKT_ECHO  = 1,
    PKT_MOVE  = 2,   // 클라 -> 서버. 어느 쪽으로 가고 있는지
    PKT_PLACE = 3,   // 클라 -> 서버. 물풍선을 놓겠다
    PKT_EVENT = 4,   // 서버 -> 클라. 화면에 띄울 일이 생겼다
};

// 화면에 띄울 일. SPEC 2.7 "어디서 재미가 나오나" 의 목록이 그대로 여기다.
//
// 왜 서버가 이걸 따로 보내나.
//   EVT_GRAZE 는 클라이언트가 만들어낼 수 없다.
//   몸이 있는 칸은 맞았는데 판정 칸은 안 맞았다는 걸 아는 건 서버뿐이다.
//   게임 필 요구가 패킷을 하나 늘린 경우다.
enum EventType : uint8_t
{
    EVT_GRAZE   = 1,   // 걸치기로 피했다. 이 게임에서 제일 큰 리턴
    EVT_CHAIN   = 2,   // 연쇄 폭발. value 가 몇 번째 단계인지
    EVT_TRAP    = 3,   // 갇혔다
    EVT_BREAK   = 4,   // 스스로 빠져나왔다
    EVT_DEATH   = 5,   // 죽었다
    EVT_ITEM    = 6,   // 아이템을 먹었다. value 가 ItemType
    EVT_BLOCK   = 7,   // 블록이 부서졌다
    EVT_BUBBLE  = 8,   // 물풍선이 놓였다
    EVT_BLAST   = 9,   // 물줄기가 이 칸을 덮었다

    EVT_FLOOD_WARN = 10,   // 이 구역이 곧 잠긴다. value 가 몇 초 뒤인지
    EVT_FLOOD      = 11,   // 이 구역이 잠겼다
    EVT_DROWN      = 12,   // 잠긴 구역 안이다. 카운트다운이 시작됐다
};


// 멤버 사이에 빈칸을 넣지 말라는 뜻.
// 컴퓨터는 4칸 단위 선반에 맞추느라 중간에 빈칸을 넣는데,
// 선을 타고 나가는 바이트에 빈칸이 섞이면 상대가 못 알아본다.
#pragma pack(push, 1)
struct PacketHeader
{
    uint16_t size;
    uint16_t id;
};

// PKT_MOVE 의 몸통.
// 위치가 아니라 "누르고 있는 방향" 을 보낸다.
// 위치를 보내게 하면 클라이언트가 아무 데나 순간이동한다고 우길 수 있다.
// 방향만 받고 실제로 얼마나 갔는지는 서버가 정한다.
struct MoveBody
{
    int8_t dx;   // -1, 0, 1
    int8_t dy;
};

// PKT_EVENT 의 몸통.
// 맵이 45x39 라 좌표가 한 바이트에 들어간다. 자잘한 이벤트가 많이 나가므로 작게 유지한다
struct EventBody
{
    uint8_t type;    // EventType
    uint8_t x;       // 타일 좌표
    uint8_t y;
    uint8_t who;     // 누구 얘기인가. 사람과 상관없으면 0xFF
    uint8_t value;   // 이벤트마다 뜻이 다르다. 연쇄 단계, 아이템 종류 등
};
#pragma pack(pop)

constexpr int MOVE_PACKET_SIZE  = HEADER_SIZE + (int)sizeof(MoveBody);
constexpr int PLACE_PACKET_SIZE = HEADER_SIZE;   // 몸통이 없다. 놓는 자리는 서버가 안다
constexpr int EVENT_PACKET_SIZE = HEADER_SIZE + (int)sizeof(EventBody);
