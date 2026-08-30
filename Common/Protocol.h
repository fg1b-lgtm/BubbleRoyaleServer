// Common/Protocol.h — 서버와 클라이언트가 같이 보는 약속
//
// 이 파일이 갈리면 그게 곧 버그다. 그래서 한 곳에 두고 양쪽이 같이 본다.
//
// 고정 헤더 + 페이로드. 리틀 엔디안.
//   [ uint16 size ][ uint16 id ][ payload ... ]
// size 는 헤더를 포함한 전체 바이트다. 몸통이 없으면 4 다.
#pragma  once

#include <cstdint>

constexpr int HEADER_SIZE = 4;         // size 2 + id 2
constexpr int MAX_PACKET_SIZE = 1024;  // 이보다 크다고 하면 믿을 수 없는 상대다

// 패킷 종류. 숫자로 쓰면 읽는 사람이 모르니 이름을 붙인다
enum PacketId : uint16_t
{
    PKT_ECHO = 1,
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
#pragma pack(pop)
