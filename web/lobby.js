// web/lobby.js — 게임 시작 전 로비와 개인 설정
// 설정은 서버 게임 상태와 분리한다. 나중에 스킨/장식/감정표현을 추가해도
// Profile.appearance 아래에 항목을 붙이면 되도록 한 덩어리로 보관한다.

const Profile = {
  defaults: {
    name: '플레이어',
    character: 0,
    keys: {
      up: 'w', down: 's', left: 'a', right: 'd', place: ' ',
    },
    appearance: { color: 'default', accessory: 'none' },
  },
  load() {
      try {
        const saved = JSON.parse(localStorage.getItem('bubble-royale-profile'));
        return Object.assign({}, this.defaults, saved, {
          keys: Object.assign({}, this.defaults.keys, saved && saved.keys),
          appearance: Object.assign({}, this.defaults.appearance, saved && saved.appearance),
        });
      } catch (_) { return JSON.parse(JSON.stringify(this.defaults)); }
    },
    save(value) { localStorage.setItem('bubble-royale-profile', JSON.stringify(value)); },
  };

  const Lobby = (() => {
    const profile = Profile.load();
    const state = { mode: 'bot', room: '', started: false };
    let waitingForKey = null;

    const $ = (id) => document.getElementById(id);
    const show = (id, on) => { const el = $(id); if (el) el.hidden = !on; };

    function setStatus(text, bad = false) {
      const el = $('lobbyStatus');
      if (el) { el.textContent = text; el.className = bad ? 'lobby-status bad' : 'lobby-status'; }
    }

    function selectMode(mode) {
      state.mode = mode;
      document.querySelectorAll('[data-mode]').forEach((el) => {
        el.classList.toggle('selected', el.dataset.mode === mode);
      });
      show('roomPanel', mode === 'pvp');
      setStatus(mode === 'bot' ? '혼자 바로 시작합니다. 빈자리는 봇이 채웁니다.' : '방을 만들거나 초대 코드를 입력하세요.');
    }

    function makeRoomCode() {
      const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
      let code = '';
      for (let i = 0; i < 6; ++i) code += chars[Math.floor(Math.random() * chars.length)];
      return code;
    }

  function openProfile() {
    $('profileName').value = profile.name;
    $('characterSelect').value = String(profile.character);
    Object.keys(profile.keys).forEach((key) => {
      const el = document.querySelector(`[data-key-value="${key}"]`);
      if (el) el.textContent = profile.keys[key] === String.fromCharCode(32)
        ? 'Space' : profile.keys[key].toUpperCase();
    });
    show('profileModal', true);
  }

    function saveProfile() {
      const name = $('profileName').value.trim();
      profile.name = name || '플레이어';
      profile.character = Number($('characterSelect').value) || 0;
      Profile.save(profile);
      show('profileModal', false);
      setStatus('개인 설정을 저장했습니다.');
    }

    function captureKey(button) {
      waitingForKey = button.dataset.key;
      button.textContent = '입력 대기…';
      setStatus('새 키를 눌러 주세요. Esc는 취소합니다.');
    }

    function onKey(event) {
        if (!waitingForKey) return;
        event.preventDefault();
        if (event.key === 'Escape') { waitingForKey = null; openProfile(); return; }
        const value = event.code === 'Space' ? String.fromCharCode(32) : event.key.toLowerCase();
        profile.keys[waitingForKey] = value;
        waitingForKey = null;
        openProfile();
      }

function start() {
  if (state.mode === 'pvp') {
    const code = $('roomCode').value.trim().toUpperCase();
    if (!code) { setStatus('방을 만들거나 방 코드를 입력하세요.', true); return; }
    state.room = code;
    setStatus(`방 ${code}에 입장합니다. 현재 서버는 공용 전장 모드입니다.`);
  }
  state.started = true;
  document.body.classList.add('game-started');
  show('lobby', false);
  // game.js가 읽을 수 있는 선택 정보. 서버 방 매칭을 붙일 때 이 값만
  // 브리지 요청의 room/mode 필드로 넘기면 된다.
  window.BubbleSession = { mode: state.mode, room: state.room, profile };
}

function bind() {
  document.querySelectorAll('[data-mode]').forEach((el) => el.addEventListener('click', () => selectMode(el.dataset.mode)));
  $('createRoom').addEventListener('click', () => { $('roomCode').value = makeRoomCode(); setStatus('방 코드가 만들어졌습니다. 친구에게 공유하세요.'); });
  $('startGame').addEventListener('click', start);
  $('profileOpen').addEventListener('click', openProfile);
  $('profileClose').addEventListener('click', () => show('profileModal', false));
  $('profileSave').addEventListener('click', saveProfile);
  document.querySelectorAll('[data-key]').forEach((el) => el.addEventListener('click', () => captureKey(el)));
  addEventListener('keydown', onKey, true);
  selectMode('bot');
}

return { bind, profile };
}) ();

addEventListener('DOMContentLoaded', () => Lobby.bind());
