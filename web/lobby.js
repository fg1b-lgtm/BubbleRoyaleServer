// web/lobby.js — 서버에 붙기 전 시작 화면과 로컬 조작 설정
//
// 캐릭터와 키는 이 브라우저에 저장한다. 방은 bridge.js 가 별도 서버로 만들고,
// 시작 버튼을 누른 뒤에만 game.js의 연결을 연다.

const Profile = {
  defaults: {
    character: 0,
    keys: { up: 'w', down: 's', left: 'a', right: 'd', place: ' ' },
    audio: { music: 0.42, sfx: 0.85 },
  },

  copy(value) {
    const rawKeys = Object.assign({}, this.defaults.keys, value && value.keys);
    const arrowNames = {
      arrowup: 'ArrowUp', arrowdown: 'ArrowDown',
      arrowleft: 'ArrowLeft', arrowright: 'ArrowRight',
    };
    const keys = {};
    const used = new Set();

    Object.keys(this.defaults.keys).forEach((action) => {
      const raw = typeof rawKeys[action] === 'string' ? rawKeys[action] : this.defaults.keys[action];
      const folded = raw.toLowerCase();
      let key = arrowNames[folded] || (raw.length === 1 ? folded : raw);
      if (key === 'space' || key === 'spacebar') key = ' ';

      // 예전 설정의 중복키나 게임 공통키(R/M)는 안전한 기본값으로 되돌린다.
      if (!key || key === 'r' || key === 'm' || used.has(key)) {
        const fallback = this.defaults.keys[action];
        key = used.has(fallback)
          ? Object.values(this.defaults.keys).find((candidate) => !used.has(candidate))
          : fallback;
      }
      keys[action] = key;
      used.add(key);
    });

    const character = Number(value && value.character);
    // Number(null) 은 NaN 이 아니라 0 이다. raw 가 없어서 null 로 들어온 것과
    // 사용자가 진짜 0(음소거)으로 저장한 것을 여기서 구분 안 하면, 처음 켠
    // 사람은 이 함수가 "없음"을 0으로 착각해서 두 소리가 다 무음으로 시작한다
    const clampVolume = (raw, fallback) => {
      if (raw === null || raw === undefined) return fallback;
      const n = Number(raw);
      return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : fallback;
    };
    const rawAudio = value && value.audio;
    return {
      character: Number.isInteger(character) ? ((character % 8) + 8) % 8 : 0,
      keys,
      audio: {
        music: clampVolume(rawAudio && rawAudio.music, this.defaults.audio.music),
        sfx: clampVolume(rawAudio && rawAudio.sfx, this.defaults.audio.sfx),
      },
    };
  },

  load() {
    try {
      return this.copy(JSON.parse(localStorage.getItem('bubble-royale-profile')));
    } catch (_) {
      return this.copy(this.defaults);
    }
  },

  save(value) {
    localStorage.setItem('bubble-royale-profile', JSON.stringify(value));
  },
};

const Lobby = (() => {
  const CHARACTER_NAMES = ['고양이', '강아지', '토끼', '곰', '여우', '판다', '개구리', '병아리'];
  const RESERVED_KEYS = new Set(['r', 'm']);
  const profile = Profile.load();
  let draft = Profile.copy(profile);
  let waitingForKey = null;
  let started = false;
  let lastFocus = null;

  const $ = (id) => document.getElementById(id);
  const show = (id, on) => { const el = $(id); if (el) el.hidden = !on; };

  function normalizeKey(event) {
    if (event.code === 'Space') return ' ';
    return event.key.length === 1 ? event.key.toLowerCase() : event.key;
  }

  function keyLabel(value) {
    const names = {
      ' ': 'Space', ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
    };
    return names[value] || String(value).toUpperCase();
  }

  function setStatus(text, bad = false) {
    const el = $('lobbyStatus');
    if (!el) return;
    el.textContent = text;
    el.className = bad ? 'lobby-status bad' : 'lobby-status';
  }

  function fillCharacters() {
    const select = $('characterSelect');
    if (!select || select.options.length) return;
    CHARACTER_NAMES.forEach((name, i) => {
      const option = document.createElement('option');
      option.value = String(i);
      option.textContent = name;
      select.appendChild(option);
    });
  }

  function renderKeys() {
    document.querySelectorAll('[data-key-value]').forEach((el) => {
      el.textContent = keyLabel(draft.keys[el.dataset.keyValue]);
    });
    document.querySelectorAll('[data-key]').forEach((el) => {
      const listening = el.dataset.key === waitingForKey;
      el.classList.toggle('listening', listening);
      if (listening) el.querySelector('b').textContent = '입력…';
    });
  }

  function updateHeaderHints() {
    const order = ['up', 'left', 'down', 'right'];
    const move = $('moveKeys');
    const place = $('placeKey');
    if (move) move.textContent = order.map((key) => keyLabel(profile.keys[key])).join(' ');
    if (place) place.textContent = keyLabel(profile.keys.place);
  }

  function setSoundVolumes(audio) {
    if (typeof Sound !== 'undefined' && Sound.setVolumes) {
      Sound.setVolumes(audio.music, audio.sfx);
    }
  }

  function showVolume(id, outputId, value) {
    const input = $(id);
    const output = $(outputId);
    if (input) input.value = String(Math.round(value * 100));
    if (output) output.textContent = Math.round(value * 100) + '%';
  }

  function previewVolumes() {
    draft.audio.music = (Number($('musicVolume').value) || 0) / 100;
    draft.audio.sfx = (Number($('sfxVolume').value) || 0) / 100;
    showVolume('musicVolume', 'musicVolumeValue', draft.audio.music);
    showVolume('sfxVolume', 'sfxVolumeValue', draft.audio.sfx);
    setSoundVolumes(draft.audio);
  }

  function openProfile() {
    lastFocus = document.activeElement;
    draft = Profile.copy(profile);
    waitingForKey = null;
    fillCharacters();
    $('characterSelect').value = String(((draft.character % CHARACTER_NAMES.length) + CHARACTER_NAMES.length) % CHARACTER_NAMES.length);
    showVolume('musicVolume', 'musicVolumeValue', draft.audio.music);
    showVolume('sfxVolume', 'sfxVolumeValue', draft.audio.sfx);
    renderKeys();
    show('profileModal', true);
    $('characterSelect').focus();
  }

  function closeProfile() {
    waitingForKey = null;
    // 미리 듣던 값은 취소하면 저장된 값으로 되돌린다.
    setSoundVolumes(profile.audio);
    show('profileModal', false);
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }

  function saveProfile() {
    draft.character = Number($('characterSelect').value) || 0;
    profile.character = draft.character;
    profile.keys = Object.assign({}, draft.keys);
    profile.audio = Object.assign({}, draft.audio);
    Profile.save(profile);
    setSoundVolumes(profile.audio);
    updateHeaderHints();
    closeProfile();
    setStatus('게임 설정을 저장했습니다.');
  }

  function captureKey(button) {
    waitingForKey = button.dataset.key;
    renderKeys();
    setStatus('새 키를 누르세요. Esc를 누르면 취소됩니다.');
  }

  function showingProfile() {
    const modal = $('profileModal');
    return modal && !modal.hidden;
  }

  function onKey(event) {
    if (!waitingForKey) {
      if (!showingProfile() || event.key !== 'Escape') return;
      event.preventDefault();
      closeProfile();
      return;
    }

    event.preventDefault();
    if (event.key === 'Escape') {
      waitingForKey = null;
      renderKeys();
      setStatus('키 변경을 취소했습니다.');
      return;
    }

    const value = normalizeKey(event);
    if (RESERVED_KEYS.has(value)) {
      setStatus('R과 M은 게임 공통 기능에 사용 중입니다.', true);
      return;
    }

    const duplicate = Object.keys(draft.keys).find((key) => key !== waitingForKey && draft.keys[key] === value);
    if (duplicate) {
      setStatus('이미 다른 동작에 쓰는 키입니다.', true);
      return;
    }

    draft.keys[waitingForKey] = value;
    waitingForKey = null;
    renderKeys();
    setStatus('키를 바꿨습니다. 저장을 누르면 적용됩니다.');
  }

  function enterGame(roomCode = '', roomCapacity = 24) {
    if (started) return;
    started = true;
    const code = String(roomCode).toUpperCase();
    window.BubbleSession = {
      profile,
      roomCode: code,
      capacity: Math.max(2, Math.min(24, Number(roomCapacity) || 24)),
      wsPath: code ? '/ws?room=' + encodeURIComponent(code) : '/ws',
    };
    const roomChip = $('roomChip');
    if (roomChip) roomChip.hidden = !code;
    if (code && $('roomCode')) $('roomCode').textContent = code + ' · ' + window.BubbleSession.capacity + '명';
    updateHeaderHints();
    document.body.classList.add('game-started');
    show('lobby', false);
    if (typeof window.startBubbleGame === 'function') {
      window.startBubbleGame();
    }
  }

  function roomCode(value) {
    return String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
  }

  function roomBusy(on) {
    ['createRoom', 'joinRoom', 'startGame'].forEach((id) => {
      const el = $(id);
      if (el) el.disabled = on;
    });
  }

  async function roomRequest(url, options) {
    const response = await fetch(url, options);
    let body = {};
    try { body = await response.json(); } catch (_) {}
    if (!response.ok) throw new Error(body.error || '방 서버가 응답하지 않습니다.');
    return body;
  }

  async function createRoom() {
    if (started) return;
    const capacity = Number($('roomCapacity').value) || 8;
    const bots = $('roomUseBots').checked ? (Number($('roomBots').value) || 1) : 0;
    roomBusy(true);
    setStatus('방을 만드는 중…');
    try {
      const room = await roomRequest('/api/rooms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ capacity, bots }),
      });
      setStatus(room.code + ' 방을 만들었습니다. 입장하는 중…');
      enterGame(room.code, room.capacity);
    }
    catch (error) {
      setStatus(error.message, true);
      roomBusy(false);
    }
  }

  async function joinRoom() {
    if (started) return;
    const input = $('roomCodeInput');
    const code = roomCode(input.value);
    input.value = code;
    if (code.length !== 6) {
      setStatus('방 코드 6자리를 입력하세요.', true);
      input.focus();
      return;
    }

    roomBusy(true);
    setStatus(code + ' 방을 찾는 중…');
    try {
      const room = await roomRequest('/api/rooms/' + encodeURIComponent(code));
      enterGame(code, room.capacity);
    }
    catch (error) {
      setStatus(error.message, true);
      roomBusy(false);
      input.focus();
    }
  }

  function bind() {
    fillCharacters();
    updateHeaderHints();
    setSoundVolumes(profile.audio);
    const syncRoomBots = () => {
      const capacity = Number($('roomCapacity').value) || 8;
      const select = $('roomBots');
      const previous = Number(select.value) || Math.min(3, capacity - 1);
      select.textContent = '';
      for (let n = 1; n < capacity; ++n) {
        const option = document.createElement('option');
        option.value = String(n);
        option.textContent = n + '명';
        if (n === Math.min(previous, capacity - 1)) option.selected = true;
        select.appendChild(option);
      }
      const useBots = $('roomUseBots').checked;
      select.disabled = !useBots;
      $('roomBotWrap').classList.toggle('disabled', !useBots);
    };
    $('roomCapacity').addEventListener('change', syncRoomBots);
    $('roomUseBots').addEventListener('change', syncRoomBots);
    syncRoomBots();
    $('startGame').addEventListener('click', () => enterGame());
    $('createRoom').addEventListener('click', createRoom);
    $('joinRoom').addEventListener('click', joinRoom);
    $('roomCodeInput').addEventListener('input', (event) => {
      event.target.value = roomCode(event.target.value);
    });
    $('roomCodeInput').addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        joinRoom();
      }
    });
    $('profileOpen').addEventListener('click', openProfile);
    $('profileGameOpen').addEventListener('click', openProfile);
    $('profileClose').addEventListener('click', closeProfile);
    $('profileSave').addEventListener('click', saveProfile);
    $('musicVolume').addEventListener('input', previewVolumes);
    $('sfxVolume').addEventListener('input', previewVolumes);
    document.querySelectorAll('[data-key]').forEach((el) => {
      el.addEventListener('click', () => captureKey(el));
    });
    $('profileModal').addEventListener('click', (event) => {
      if (event.target === $('profileModal')) closeProfile();
    });
    addEventListener('keydown', onKey, true);
  }

  return { bind, profile, enterGame };
})();

addEventListener('DOMContentLoaded', () => Lobby.bind());
