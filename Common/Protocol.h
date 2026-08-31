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
    PKT_ECHO = 1,
    PKT_MOVE = 2,   // 클라 -> 서버. 어느 쪽으로 가고 있는지
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
#pragma pack(pop)

constexpr int MOVE_PACKET_SIZE = HEADER_SIZE + (int)sizeof(MoveBody);
