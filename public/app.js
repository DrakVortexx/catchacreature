/* ── Catch a Creature — App Controller ──────────────────── */

let session  = null;  // { userId, username }
let socket   = null;
let gameInst = null;

// ── Notification ─────────────────────────────────────────
function notify(message, type = 'info') {
  const el  = document.createElement('div');
  el.className = `notif ${type}`;
  el.textContent = message;
  document.getElementById('notifications').appendChild(el);
  setTimeout(() => el.remove(), 3500);
}
window.notify = notify;

// ── Screen helpers ────────────────────────────────────────
function showScreen(id) {
  const screens = ['login-screen','dashboard','game-screen','battle-screen'];
  screens.forEach(s => {
    const el = document.getElementById(s);
    if (el) el.classList.add('hidden');
  });
  document.getElementById('hud').classList.add('hidden');
  const target = document.getElementById(id);
  if (target) target.classList.remove('hidden');
}

function showModal(id) {
  document.getElementById(id).classList.remove('hidden');
}
function hideModal(id) {
  document.getElementById(id).classList.add('hidden');
}

// ── Login ─────────────────────────────────────────────────
const loginForm   = document.getElementById('login-form');
const loginError  = document.getElementById('login-error');
const loginBtn    = document.getElementById('login-btn');

loginForm.addEventListener('submit', async e => {
  e.preventDefault();
  loginError.textContent = '';
  const username = document.getElementById('username-input').value.trim();
  const password = document.getElementById('password-input').value;
  if (!username || !password) { loginError.textContent = 'Fill in all fields.'; return; }

  loginBtn.disabled    = true;
  loginBtn.textContent = 'Signing in…';

  try {
    const res  = await fetch('/api/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    const data = await res.json();
    if (!res.ok) { loginError.textContent = data.error || 'Login failed.'; return; }

    session = { userId: data.userId, username: data.username };
    sessionStorage.setItem('cacSession', JSON.stringify(session));
    notify(data.isNewUser ? 'Account created! Welcome!' : `Welcome back, ${data.username}!`, 'success');
    openDashboard();
  } catch {
    loginError.textContent = 'Server error. Try again.';
  } finally {
    loginBtn.disabled    = false;
    loginBtn.textContent = 'Enter World';
  }
});

// ── Dashboard ─────────────────────────────────────────────
async function openDashboard() {
  showScreen('dashboard');
  document.getElementById('dash-username').textContent = session.username;
  document.getElementById('dash-stats').textContent    = 'Loading…';
  try {
    const res  = await fetch(`/api/users/${session.userId}/stats`);
    const data = await res.json();
    if (res.ok)
      document.getElementById('dash-stats').textContent =
        `${data.totalCaught} Creatures Caught · ${data.battlesWon} Battles Won`;
  } catch {
    document.getElementById('dash-stats').textContent = 'Could not load stats.';
  }
}

document.getElementById('btn-logout').addEventListener('click', () => {
  session = null;
  sessionStorage.removeItem('cacSession');
  if (socket) { socket.disconnect(); socket = null; }
  showScreen('login-screen');
  notify('Logged out.', 'info');
});

// ── Quick Play ────────────────────────────────────────────
document.getElementById('btn-play').addEventListener('click', async () => {
  await joinLobby(null);
});

async function joinLobby(lobbyId) {
  try {
    const res  = await fetch('/api/lobbies/join', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lobbyId })
    });
    const data = await res.json();
    if (!res.ok) { notify(data.error || 'Could not join lobby.', 'error'); return; }

    hideModal('server-browser');
    await startGame(data.lobbyId, data.lobbyName);
  } catch {
    notify('Server error joining lobby.', 'error');
  }
}

async function startGame(lobbyId, lobbyName) {
  // fetch creatures catalogue + user collection
  const [crRes, colRes] = await Promise.all([
    fetch('/api/creatures'),
    fetch(`/api/users/${session.userId}/creatures`)
  ]);
  const creatures  = await crRes.json();
  const collection = await colRes.json();

  // init game
  if (!gameInst) gameInst = new Game();
  showScreen('game-screen');
  document.getElementById('hud').classList.remove('hidden');

  // connect socket
  if (!socket) socket = io();
  gameInst.connectSocket(socket);
  socket.emit('join_lobby', { lobbyId, userId: session.userId, username: session.username });

  gameInst.start(session, lobbyId, lobbyName, creatures, collection);
  notify(`Joined ${lobbyName}!`, 'success');
}

// ── Server Browser ────────────────────────────────────────
document.getElementById('btn-servers').addEventListener('click', async () => {
  showModal('server-browser');
  await loadLobbies();
});
document.getElementById('btn-close-servers').addEventListener('click', () => hideModal('server-browser'));

async function loadLobbies() {
  const list = document.getElementById('lobby-list');
  list.innerHTML = '<p style="color:var(--gray)">Loading…</p>';
  try {
    const res     = await fetch('/api/lobbies');
    const lobbies = await res.json();
    list.innerHTML = '';

    if (!lobbies.length) {
      list.innerHTML = '<p style="color:var(--gray)">No servers found.</p>';
      return;
    }

    for (const l of lobbies) {
      const row  = document.createElement('div');
      row.className = 'lobby-row';
      const full = l.currentPlayers >= l.maxPlayers;
      row.innerHTML = `
        <div class="lobby-row-info">
          <strong>${l.name}</strong>
          <span>${l.currentPlayers} / ${l.maxPlayers} players · ${full ? 'Full' : 'Open'}</span>
        </div>
        <button class="lobby-join-btn" ${full ? 'disabled' : ''}>Join</button>`;
      if (!full) row.querySelector('button').addEventListener('click', () => joinLobby(l.id));
      list.appendChild(row);
    }
  } catch {
    list.innerHTML = '<p style="color:var(--danger)">Failed to load servers.</p>';
  }
}

// ── Collection ────────────────────────────────────────────
document.getElementById('btn-collection').addEventListener('click', async () => {
  showModal('collection-modal');
  await loadCollection();
});
document.getElementById('btn-close-collection').addEventListener('click', () => hideModal('collection-modal'));

document.getElementById('rarity-filter').addEventListener('change', () => renderGrid());
document.getElementById('search-creatures').addEventListener('input', () => renderGrid());

let _allCreatures = [];

async function loadCollection() {
  const grid = document.getElementById('creature-grid');
  grid.innerHTML = '<p style="color:var(--gray)">Loading…</p>';
  try {
    const res  = await fetch(`/api/users/${session.userId}/creatures`);
    _allCreatures = await res.json();
    renderGrid();
  } catch {
    grid.innerHTML = '<p style="color:var(--danger)">Failed to load collection.</p>';
  }
}

function renderGrid() {
  const grid    = document.getElementById('creature-grid');
  const rarity  = document.getElementById('rarity-filter').value;
  const search  = document.getElementById('search-creatures').value.toLowerCase();

  const filtered = _allCreatures.filter(uc => {
    if (!uc.creature) return false;
    if (rarity !== 'all' && uc.creature.rarity !== rarity) return false;
    if (search && !uc.creature.name.toLowerCase().includes(search)) return false;
    return true;
  });

  if (!filtered.length) {
    grid.innerHTML = '<p style="color:var(--gray)">No creatures found.</p>';
    return;
  }

  grid.innerHTML = '';
  for (const uc of filtered) {
    const c    = uc.creature;
    const card = document.createElement('div');
    card.className = `creature-card ${c.rarity}`;
    card.innerHTML = `
      <div class="creature-card-name">${c.name}</div>
      <div class="creature-card-rarity" style="color:${rarityColor(c.rarity)}">${c.rarity}</div>
      <p>ATK ${c.attack} · DEF ${c.defense} · SPD ${c.speed}</p>
      <p>HP ${c.hp}</p>
      <p style="margin-top:6px;color:var(--accent)">${c.special_ability}</p>
      <p style="font-size:11px;margin-top:8px;color:var(--gray)">Caught ${new Date(uc.caught_at).toLocaleDateString()}</p>`;
    grid.appendChild(card);
  }
}

function rarityColor(r) {
  const map = { common:'#9ca3af',uncommon:'#10b981',rare:'#3b82f6',epic:'#8b5cf6',
    legendary:'#f59e0b',mythic:'#7c3aed',divine:'#fbbf24',celestial:'#06b6d4',
    eternal:'#ec4899',omniversal:'#f472b6' };
  return map[r] || '#fff';
}

// ── Settings ──────────────────────────────────────────────
document.getElementById('btn-settings').addEventListener('click', () => showModal('settings-modal'));
document.getElementById('btn-close-settings').addEventListener('click', () => hideModal('settings-modal'));

// ── Session restore ───────────────────────────────────────
(function restore() {
  const saved = sessionStorage.getItem('cacSession');
  if (saved) {
    try {
      const parsed = JSON.parse(saved);
      if (parsed.userId && parsed.username) {
        session = parsed;
        openDashboard();
        return;
      }
    } catch { /**/ }
  }
  showScreen('login-screen');
})();
