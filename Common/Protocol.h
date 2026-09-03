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
    PKT_ECHO     = 1,
    PKT_MOVE     = 2,   // 클라 -> 서버. 어느 쪽으로 가고 있는지
    PKT_PLACE    = 3,   // 클라 -> 서버. 물풍선을 놓겠다
    PKT_EVENT    = 4,   // 서버 -> 클라. 화면에 띄울 일이 생겼다
    PKT_WELCOME  = 5,   // 서버 -> 클라. 접속 직후 한 번. 게임 상수까지 같이 준다
    PKT_MAPROW   = 6,   // 서버 -> 클라. 접속 직후 판을 한 줄씩
    PKT_SNAPSHOT = 7,   // 서버 -> 클라. 매 틱. 누가 어디 있나

    // 클라 -> 서버. 판을 새로 깔고 처음부터 다시.
    //
    // 시험용이다. 아무나 누를 수 있으면 실제 서비스에서는 곤란하다.
    // 지금은 손맛을 보려고 몇 번이고 다시 돌려야 해서 열어둔다.
    // 방과 대기실이 생기면 그쪽으로 옮긴다
    PKT_RESTART  = 8,
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
    EVT_DROP       = 13,   // 부서진 블록에서 아이템이 떨어졌다. value 가 ItemType
    EVT_RING       = 14,   // 최종 구역 안 물이 한 겹 차올랐다. value 가 남은 폭
    EVT_POP        = 15,   // 갇힌 사람을 몸으로 부딪쳐 터뜨렸다. who 가 당한 쪽, value 가 터뜨린 쪽

    // 상자를 밀었다. x,y 가 **밀리기 전** 자리, value 가 방향 (0 오른 1 왼 2 아래 3 위).
    // 새 자리는 화면이 계산한다. 두 칸을 다 보내면 바이트가 두 개 더 든다
    EVT_PUSH       = 16,

    // 바닥의 아이템이 물줄기에 쓸려갔다. x,y 만 쓴다.
    // 먹은 것(EVT_ITEM)과 나눠야 한다 — 먹은 건 누가 가져간 것이고
    // 이건 아무도 못 갖는 것이라, 화면도 소리도 달라야 한다
    EVT_ITEM_GONE  = 17,
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
// PKT_WELCOME 의 몸통. 접속하면 딱 한 번 간다.
//
// 게임 상수를 여기 실어 보낸다. 클라이언트가 상수를 하나도 안 갖게 하려는 것이다.
// 웹 클라는 JavaScript 라 GameConstants.h 를 못 읽는다.
// 그렇다고 같은 숫자를 .js 에 또 적으면, 한쪽만 고쳤을 때 서버와 화면이 갈린다.
// SPEC 1절에 "이 파일이 갈리면 그게 곧 버그다" 라고 적어둔 그 문제다.
// 값을 하나만 두고 접속할 때 넘겨주면 갈릴 수가 없다.
struct WelcomeBody
{
    uint8_t  your_id;
    uint8_t  map_w, map_h;
    uint8_t  sector_w, sector_h;
    uint8_t  tick_rate;
    uint16_t tile_units;           // 타일 하나가 몇 units 인가
    uint16_t fuse_ticks;
    uint16_t trap_ticks;
    uint16_t flood_escape_ticks;
    uint8_t  blast_ticks;
    uint8_t  body_num, body_den;   // 캐릭터 몸 크기. 화면에 실제 크기로 그려야 걸치기가 보인다

    // AOI 가 구역 밖 몇 칸까지 보여주나. 화면이 "내가 아는 데" 를 그리는 데 쓴다
    uint8_t  peek_tiles;

    // 카메라가 구역을 바꾸려면 경계를 몇 칸 넘어야 하나.
    // 0 이면 경계에 서 있을 때 화면이 덜덜 떨린다
    uint8_t  cam_hysteresis;
    uint32_t seed;

    // 아홉 자리에 어떤 조각이 깔렸나 (SectorTemplates.h 의 번호).
    //
    // 규칙에는 아무 영향이 없다. **화면이 구역마다 다른 데처럼 그리려고** 쓴다.
    // 크아 맵이 빌리지, 캠프, 해변인 것처럼 조각마다 다른 장소로 보이게 한다.
    //
    // 씨앗에서 클라이언트가 다시 뽑게 할 수도 있지만, 그러면 섞는 방식이
    // 서버와 클라 양쪽에 적히게 된다. 한쪽만 고치면 화면과 판이 갈린다.
    // 아홉 바이트 보내는 쪽이 싸다
    uint8_t  sector_kind[9];

    // 아이템 시작값과 상한.
    //
    // 9/2 까지 화면이 이걸 손으로 적어두고 있었다. 물줄기를 `2 + 먹은 수` 로 그렸는데
    // 시작 사거리를 2 에서 1 로 낮춘 뒤로는 **화면이 실제보다 1 크게 말하고 있었다.**
    // 상한도 롤러만 7 로 올렸는데 화면은 넷으로 알고 있었다.
    //
    // README 에 '클라이언트는 게임 상수를 하나도 갖고 있지 않다' 고 써놓고
    // 정작 제일 자주 보는 숫자 셋이 박혀 있었다. 그래서 여기로 옮긴다
    uint8_t  base_bubble;   // 시작 물풍선 수
    uint8_t  base_range;    // 시작 물줄기 사거리
    uint8_t  cap_bubble;    // 물풍선 상한 (시작값 포함)
    uint8_t  cap_range;     // 물줄기 상한 (시작값 포함)
    uint8_t  cap_speed;     // 롤러 상한

    // 이동 규칙. 화면이 **내 캐릭터를 미리 움직이는 데** 쓴다.
    //
    // 9/2 에 재보니 왕복 160ms 에서 키를 누르고 화면이 움직이기까지 217ms 였다.
    // 그만큼 늦으면 조작이 아니라 원격 조종이다.
    // 그래서 화면이 서버와 **같은 계산**을 미리 한 번 돌린다.
    //
    // 같은 답이 나와야 하므로 규칙에 쓰는 수를 전부 보낸다.
    // 화면이 자기 값을 갖고 있으면 언젠가 서버와 갈린다
    uint8_t  move_base;     // 기본 속도 (units/틱)
    uint8_t  move_step;     // 롤러 하나당 더해지는 양
    uint8_t  trap_speed;    // 갇혔을 때의 속도
    uint8_t  lane_snap;     // 좁은 데로 들어갈 때 당기는 비율 (%)

    // 상자가 밀려가는 데 걸리는 틱. 화면이 그 시간 동안 미끄러뜨린다.
    // 여기 안 보내고 화면에 적어두면, 서버 상수를 바꾼 날 그림만 어긋난다
    uint8_t  push_slide;

    // 침수 예고에서 물이 차기까지 몇 초인가.
    // 화면은 이걸로 붉게 뛰는 속도를 정한다 - 남은 시간이 줄수록 빨라진다
    uint8_t  flood_warn_sec;
};

// PKT_MAPROW 의 몸통. 판을 한 줄씩 보낸다.
//
// 45 x 39 를 한 패킷에 담으면 3510 바이트라 MAX_PACKET_SIZE 를 넘는다.
// 한계를 올리는 대신 줄 단위로 쪼갠다. 크기 검사를 느슨하게 만들지 않으려는 것이다.
// 뒤에 tiles[map_w] 와 items[map_w] 가 이어 붙는다
struct MapRowHead
{
    uint8_t y;
};

// PKT_SNAPSHOT 의 몸통 앞부분. 뒤에 사람과 물풍선이 이어 붙는다.
//
// 매 틱 전원에게 나간다. 지금은 거리를 안 본다.
// 9/3 에 AOI 가 걸러낼 대상이 바로 이 패킷이고, 그 전후 숫자가 측정 결과가 된다.
struct SnapshotHead
{
    uint32_t tick;
    uint8_t  sectors[9];      // 구역 상태. SectorState

    uint8_t  phase;           // RoundPhase
    uint16_t phase_ticks;     // 이 단계에 들어온 뒤 지난 틱. 카운트다운을 여기서 그린다
    uint8_t  winner;          // 0xFF = 없음 (무승부이거나 아직 안 끝남)
    uint8_t  round_no;

    // 최종 구역 안에서 좁아지는 안전 사각형. 양끝 포함.
    // ring_x0 이 0xFF 면 아직 안 쓴다
    uint8_t  ring_x0, ring_y0, ring_x1, ring_y1;

    // 살아 있는 사람 수와 누가 살아 있나 (0번이 최하위 비트).
    //
    // AOI 를 켜면 뒤에 붙는 사람 목록이 **내 구역 사람만** 들어온다.
    // 그러면 화면이 "생존 3" 이라고 쓰게 된다. 실제로는 열둘이 남았는데.
    //
    // 생존자 수는 SPEC 4절이 전역이라고 못 박은 것이다. 4바이트뿐이고
    // 초당 30번이라 12만 바이트를 아끼면서 이걸 아끼는 건 앞뒤가 안 맞는다.
    // **AOI 는 크고 잦은 것만 거른다. 작고 중요한 건 그냥 보낸다**
    uint8_t  alive_count;
    uint8_t  alive_mask[3];

    uint8_t  player_count;
    uint8_t  bubble_count;
};

struct PlayerState
{
    uint8_t  id;
    uint16_t x, y;        // units
    uint8_t  jtx, jty;    // 판정 타일. 위치와 다르면 걸치는 중이다
    uint8_t  flags;
    uint8_t  bubble_lv, power_lv, speed_lv;
};

// PlayerState.flags 의 자리
constexpr uint8_t PF_ALIVE    = 1 << 0;
constexpr uint8_t PF_TRAPPED  = 1 << 1;
constexpr uint8_t PF_INVULN   = 1 << 2;
constexpr uint8_t PF_DROWNING = 1 << 3;

// 이번 틱에 실제로 자리가 바뀌었나.
//
// 누르고 있는지가 아니라 **움직였는지**다. 벽에 대고 누르고 있으면 꺼진다.
// 클라이언트가 걷는 그림과 서 있는 그림을 가르는 데 쓴다.
constexpr uint8_t PF_MOVING = 1 << 4;

// 어느 쪽을 보고 있나. 두 칸(5,6번 자리)에 0~3 을 담는다.
//
// 위치 두 개를 빼서 클라이언트가 알아낼 수도 있다. 그런데 서 있으면 위치가 안 변해서
// 마지막으로 보던 쪽을 잃어버린다. 벽에 대고 누르고 있을 때도 마찬가지다.
// 보는 방향은 서버가 이미 알고 있으니 두 칸만 얹어 보낸다. 패킷은 안 커진다.
constexpr uint8_t PF_FACE_SHIFT = 5;
constexpr uint8_t PF_FACE_MASK  = 3 << PF_FACE_SHIFT;

enum FaceDir : uint8_t
{
    FACE_DOWN  = 0,   // 화면 앞쪽. 처음 들어오면 이쪽을 본다
    FACE_LEFT  = 1,
    FACE_RIGHT = 2,
    FACE_UP    = 3,
};

struct BubbleState
{
    uint8_t tx, ty;
    uint8_t fuse;     // 남은 틱. 마지막 0.5초에 맥박이 빨라지는 연출에 쓴다
    uint8_t owner;
};
#pragma pack(pop)

constexpr int MOVE_PACKET_SIZE  = HEADER_SIZE + (int)sizeof(MoveBody);
constexpr int PLACE_PACKET_SIZE = HEADER_SIZE;   // 몸통이 없다. 놓는 자리는 서버가 안다
constexpr int EVENT_PACKET_SIZE = HEADER_SIZE + (int)sizeof(EventBody);
constexpr int WELCOME_PACKET_SIZE = HEADER_SIZE + (int)sizeof(WelcomeBody);

// 스냅샷에 담을 수 있는 물풍선 수. 패킷 한도 안에 들어가야 한다
constexpr int MAX_SNAPSHOT_BUBBLE = 120;
