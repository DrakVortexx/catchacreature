/* ── Catch a Creature — App Controller ──────────────────── */

let session     = null;
let socket      = null;
window.gameInst = null;

// ── Background Music ─────────────────────────────────────
const bgMusic = document.getElementById('bg-music');
let musicVolume = 0.5;

function initBackgroundMusic() {
  if (!bgMusic) return;

  // Set initial volume
  bgMusic.volume = musicVolume;

  // Try to play music (may need user interaction due to browser policies)
  const playMusic = () => {
    bgMusic.play().catch(e => {
      console.log('Autoplay prevented, waiting for user interaction');
    });
  };

  // Play on first user interaction
  document.addEventListener('click', function playOnClick() {
    playMusic();
    document.removeEventListener('click', playOnClick);
  }, { once: true });

  // Also try on keypress
  document.addEventListener('keydown', function playOnKey() {
    playMusic();
    document.removeEventListener('keydown', playOnKey);
  }, { once: true });
}

// Music volume control
document.getElementById('music-volume')?.addEventListener('input', (e) => {
  musicVolume = e.target.value / 100;
  if (bgMusic) bgMusic.volume = musicVolume;
});

// Initialize music on load
initBackgroundMusic();

// ── Notifications ─────────────────────────────────────────
function notify(message, type = 'info') {
  const el = document.createElement('div');
  el.className   = `notif ${type}`;
  el.textContent = message;
  document.getElementById('notifications').appendChild(el);
  setTimeout(() => el.remove(), 3500);
}
window.notify = notify;

// ── Error screen ──────────────────────────────────────────
function showError(msg) {
  document.getElementById('error-msg').textContent = msg;
  showScreen('error-screen');
}
window.showError = showError;

// ── Screen helpers ────────────────────────────────────────
function showScreen(id) {
  ['login-screen','dashboard','game-screen','battle-screen','error-screen']
    .forEach(s => document.getElementById(s)?.classList.add('hidden'));
  document.getElementById('hud').classList.add('hidden');
  document.getElementById(id)?.classList.remove('hidden');
}
function showModal(id)  { document.getElementById(id).classList.remove('hidden'); }
function hideModal(id)  { document.getElementById(id).classList.add('hidden'); }

// ── Single-tab enforcement via localStorage ───────────────
const TAB_KEY = 'cac_active_tab';
const TAB_ID  = Math.random().toString(36).slice(2);
localStorage.setItem(TAB_KEY, TAB_ID);

window.addEventListener('storage', e => {
  if (e.key === TAB_KEY && e.newValue !== TAB_ID && session) {
    // Another tab claimed the session
    socket?.disconnect();
    showError('This account was opened in another tab. Close this tab and use the other one.');
  }
});

// ── Login ─────────────────────────────────────────────────
const loginForm  = document.getElementById('login-form');
const loginError = document.getElementById('login-error');
const loginBtn   = document.getElementById('login-btn');

loginForm.addEventListener('submit', async e => {
  e.preventDefault();
  loginError.textContent = '';
  const username = document.getElementById('username-input').value.trim();
  const password = document.getElementById('password-input').value;
  if (!username || !password) { loginError.textContent = 'Fill in all fields.'; return; }

  loginBtn.disabled = true; loginBtn.textContent = 'Signing in…';
  try {
    const res  = await fetch('/api/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    const data = await res.json();
    if (!res.ok) { loginError.textContent = data.error || 'Login failed.'; return; }

    session = { userId: data.userId, username: data.username };
    localStorage.setItem('cacSession', JSON.stringify(session));
    localStorage.setItem(TAB_KEY, TAB_ID); // claim tab

    const isNew = data.isNewUser;
    session.isNewUser = isNew;
    notify(isNew ? '🎉 Account created! Welcome!' : `Welcome back, ${data.username}!`, 'success');
    openDashboard();
  } catch {
    loginError.textContent = 'Server error. Try again.';
  } finally {
    loginBtn.disabled = false; loginBtn.textContent = 'Enter World';
  }
});

// ── Dashboard ─────────────────────────────────────────────
async function openDashboard() {
  showScreen('dashboard');
  document.getElementById('dash-username').textContent = session.username;
}
window.openDashboard = openDashboard;

async function refreshBaseCount() {
  if (!session) return;
  try {
    const res  = await fetch(`/api/users/${session.userId}/stats`);
    const data = await res.json();
    const badge = document.getElementById('pen-count-badge');
    if (data.totalCaught > 0) {
      badge.textContent = data.totalCaught;
      badge.classList.remove('hidden');
    } else {
      badge.classList.add('hidden');
    }
  } catch { /* ignore */ }
}
window.refreshPenCount = refreshBaseCount; // game.js calls this name

const btnLogout = document.getElementById('btn-logout');
if (btnLogout) {
  btnLogout.addEventListener('click', () => {
    session = null;
    localStorage.removeItem('cacSession');
    socket?.disconnect(); socket = null;
    window.gameInst = null;
    showScreen('login-screen');
    notify('Logged out.', 'info');
  });
}

// ── Quick Play ────────────────────────────────────────────
const btnPlay = document.getElementById('btn-play');
if (btnPlay) btnPlay.addEventListener('click', () => joinLobby(null));

async function joinLobby(lobbyId) {
  if (!session) { notify('Please log in first.', 'error'); return; }
  try {
    const res  = await fetch('/api/lobbies/join', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lobbyId })
    });
    console.log('Lobby join response status:', res.status);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      console.error('Lobby join error response:', data);
      notify(data.error || 'Could not join lobby.', 'error');
      return;
    }
    const data = await res.json();
    console.log('Lobby join success:', data);
    hideModal('server-browser');
    await startGame(data.lobbyId, data.lobbyName);
  } catch (e) {
    console.error('Lobby join error:', e);
    notify('Server error joining lobby.', 'error');
  }
}

async function startGame(lobbyId, lobbyName) {
  try {
    console.log('Starting game with lobby:', lobbyId, lobbyName);
    const [crRes, colRes] = await Promise.all([
      fetch('/api/creatures'),
      fetch(`/api/users/${session.userId}/creatures`)
    ]);
    console.log('Creatures response status:', crRes.status);
    console.log('Collection response status:', colRes.status);
    const creatures  = await crRes.json();
    const collection = colRes.ok ? await colRes.json() : [];
    if (!colRes.ok) notify('⚠️ Could not load creatures — check DB permissions.', 'error');

    showScreen('game-screen');
    document.getElementById('hud').classList.remove('hidden');
    window.gameInst = new Game();

    if (!socket || !socket.connected) socket = io();

    // Register session for single-session enforcement server-side
    socket.emit('register_session', { userId: session.userId, username: session.username });

    // Handle being kicked (same account opened elsewhere)
    socket.off('kicked');
    socket.on('kicked', (reason) => {
      window.gameInst?.stop?.();
      socket.disconnect();
      showError(reason || 'You were disconnected because your account was opened elsewhere.');
    });

    window.gameInst.connectSocket(socket);
    socket.emit('join_lobby', { lobbyId, userId: session.userId, username: session.username });
    window.gameInst.start(session, lobbyId, lobbyName, creatures, collection, session.isNewUser);
    notify(`Joined ${lobbyName}!`, 'success');
  } catch (e) {
    console.error('Start game error:', e);
    notify('Error starting game.', 'error');
  }
}

// ── Server Browser ────────────────────────────────────────
const btnServers = document.getElementById('btn-servers');
if (btnServers) {
  btnServers.addEventListener('click', async () => {
    showModal('server-browser'); await loadLobbies();
  });
}
const btnCloseServers = document.getElementById('btn-close-servers');
if (btnCloseServers) btnCloseServers.addEventListener('click', () => hideModal('server-browser'));

async function loadLobbies() {
  const list = document.getElementById('lobby-list');
  list.innerHTML = '<p style="color:var(--gray)">Loading…</p>';
  try {
    const lobbies = await (await fetch('/api/lobbies')).json();
    list.innerHTML = '';
    if (!lobbies.length) { list.innerHTML = '<p style="color:var(--gray)">No servers yet.</p>'; return; }
    for (const l of lobbies) {
      const full = l.currentPlayers >= l.maxPlayers;
      const row  = document.createElement('div');
      row.className = 'lobby-row';
      row.innerHTML = `
        <div class="lobby-row-info">
          <strong>${l.name}</strong>
          <span>${l.currentPlayers} / ${l.maxPlayers} · ${full ? 'Full' : 'Open'}</span>
        </div>
        <button class="lobby-join-btn" ${full ? 'disabled' : ''}>Join</button>`;
      if (!full) row.querySelector('button').addEventListener('click', () => joinLobby(l.id));
      list.appendChild(row);
    }
  } catch { list.innerHTML = '<p style="color:var(--danger)">Failed to load.</p>'; }
}

// ── Base viewer (dashboard) ───────────────────────────────
function openBaseModal() { showModal('pen-modal'); loadBase(); }
window.openPenModal = openBaseModal;

const btnPen = document.getElementById('btn-pen');
if (btnPen) btnPen.addEventListener('click', openBaseModal);
const btnClosePen = document.getElementById('btn-close-pen');
if (btnClosePen) btnClosePen.addEventListener('click', () => hideModal('pen-modal'));
const rarityFilter = document.getElementById('rarity-filter');
if (rarityFilter) rarityFilter.addEventListener('change', () => renderBase());
const searchCreatures = document.getElementById('search-creatures');
if (searchCreatures) searchCreatures.addEventListener('input',  () => renderBase());

let _baseCreatures = [];

async function loadBase() {
  const grid = document.getElementById('creature-grid');
  grid.innerHTML = '<p style="color:var(--gray);padding:20px;">Loading…</p>';
  try {
    const res = await fetch(`/api/users/${session.userId}/creatures`);
    if (!res.ok) throw new Error();
    _baseCreatures = await res.json();
    renderBase();
  } catch {
    grid.innerHTML = '<p style="color:var(--danger);padding:20px;">Failed to load. Check DB permissions.</p>';
  }
}

function renderBase() {
  const grid   = document.getElementById('creature-grid');
  const rarity = document.getElementById('rarity-filter').value;
  const search = document.getElementById('search-creatures').value.toLowerCase();

  const filtered = _baseCreatures.filter(uc => {
    if (!uc.creature) return false;
    if (rarity !== 'all' && uc.creature.rarity !== rarity) return false;
    if (search && !uc.creature.name.toLowerCase().includes(search)) return false;
    return true;
  });

  if (!filtered.length) {
    grid.innerHTML = `<p style="color:var(--gray);padding:20px 0;">${
      _baseCreatures.length === 0
        ? '🏠 Your base is empty. Go catch creatures and walk to your base to store them!'
        : 'No creatures match your filter.'
    }</p>`;
    return;
  }

  grid.innerHTML = '';
  for (const uc of filtered) {
    const c = uc.creature;
    const card = document.createElement('div');
    card.className = `creature-card ${c.rarity}`;
    card.innerHTML = `
      <div class="creature-card-name">${c.name}</div>
      <div class="creature-card-rarity" style="color:${rarityColor(c.rarity)}">${c.rarity}</div>
      <p>ATK ${c.attack} · DEF ${c.defense} · SPD ${c.speed}</p>
      <p>HP ${c.hp}</p>
      <p style="margin-top:6px;color:var(--accent);font-size:12px;">✨ ${c.special_ability}</p>
      <p style="font-size:11px;margin-top:8px;color:var(--gray)">Stored ${new Date(uc.caught_at).toLocaleDateString()}</p>`;
    grid.appendChild(card);
  }
}

function rarityColor(r) {
  return { common:'#9ca3af', uncommon:'#10b981', rare:'#3b82f6', epic:'#8b5cf6',
    legendary:'#f59e0b', mythic:'#7c3aed', divine:'#fbbf24', celestial:'#06b6d4',
    eternal:'#ec4899', omniversal:'#f472b6' }[r] || '#fff';
}

// ── Settings ──────────────────────────────────────────────
const btnSettings = document.getElementById('btn-settings');
if (btnSettings) btnSettings.addEventListener('click', () => showModal('settings-modal'));
const btnCloseSettings = document.getElementById('btn-close-settings');
if (btnCloseSettings) btnCloseSettings.addEventListener('click', () => hideModal('settings-modal'));

// ── Creature GUI ─────────────────────────────────────────
const btnCloseCreatureGui = document.getElementById('btn-close-creature-gui');
if (btnCloseCreatureGui) btnCloseCreatureGui.addEventListener('click', () => hideModal('creature-gui-modal'));
const btnDepositCreature = document.getElementById('btn-deposit-creature');
if (btnDepositCreature) {
  btnDepositCreature.addEventListener('click', () => {
    if (window.gameInst) window.gameInst._depositFromGUI();
  });
}

function openCreatureGUI() {
  showModal('creature-gui-modal');
  if (window.gameInst) window.gameInst._loadCreatureGUI();
}
window.openCreatureGUI = openCreatureGUI;

// ── Tutorial wiring ───────────────────────────────────────
const tutNext = document.getElementById('tut-next');
if (tutNext) tutNext.addEventListener('click', () => window.gameInst?._advanceTutorial());

// ── Error screen retry ────────────────────────────────────
document.getElementById('btn-error-retry')?.addEventListener('click', () => {
  showScreen('login-screen');
});

// ── Session restore from localStorage ────────────────────
(function restore() {
  const saved = localStorage.getItem('cacSession');
  if (saved) {
    try {
      const p = JSON.parse(saved);
      if (p.userId && p.username) {
        session = p;
        openDashboard();
        return;
      }
    } catch { /**/ }
  }
  showScreen('login-screen');
})();
