/* ── Catch a Creature — App Controller ──────────────────── */

let session  = null;
let socket   = null;
window.gameInst = null;

// ── Notifications ─────────────────────────────────────────
function notify(message, type = 'info') {
  const el = document.createElement('div');
  el.className  = `notif ${type}`;
  el.textContent = message;
  document.getElementById('notifications').appendChild(el);
  setTimeout(() => el.remove(), 3500);
}
window.notify = notify;

// ── Screen helpers ────────────────────────────────────────
function showScreen(id) {
  ['login-screen','dashboard','game-screen','battle-screen'].forEach(s => {
    document.getElementById(s)?.classList.add('hidden');
  });
  document.getElementById('hud').classList.add('hidden');
  document.getElementById(id)?.classList.remove('hidden');
}
function showModal(id) { document.getElementById(id).classList.remove('hidden'); }
function hideModal(id) { document.getElementById(id).classList.add('hidden'); }

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

    session = { userId: data.userId, username: data.username, isNewUser: data.isNewUser };
    sessionStorage.setItem('cacSession', JSON.stringify(session));
    notify(data.isNewUser ? '🎉 Account created! Welcome!' : `Welcome back, ${data.username}!`, 'success');
    openDashboard();
  } catch { loginError.textContent = 'Server error. Try again.'; }
  finally { loginBtn.disabled = false; loginBtn.textContent = 'Enter World'; }
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
        `${data.totalCaught} in Pen · ${data.battlesWon} Battles Won`;
    // Update pen badge
    refreshPenCount();
  } catch {
    document.getElementById('dash-stats').textContent = 'Could not load stats.';
  }
}
window.openDashboard = openDashboard;

async function refreshPenCount() {
  if (!session) return;
  try {
    const res   = await fetch(`/api/users/${session.userId}/stats`);
    const data  = await res.json();
    const badge = document.getElementById('pen-count-badge');
    if (data.totalCaught > 0) {
      badge.textContent = data.totalCaught;
      badge.classList.remove('hidden');
    } else {
      badge.classList.add('hidden');
    }
  } catch { /* ignore */ }
}
window.refreshPenCount = refreshPenCount;

document.getElementById('btn-logout').addEventListener('click', () => {
  session = null;
  sessionStorage.removeItem('cacSession');
  if (socket) { socket.disconnect(); socket = null; }
  window.gameInst = null;
  showScreen('login-screen');
  notify('Logged out.', 'info');
});

// ── Quick Play ────────────────────────────────────────────
document.getElementById('btn-play').addEventListener('click', () => joinLobby(null));

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
  } catch { notify('Server error joining lobby.', 'error'); }
}

async function startGame(lobbyId, lobbyName) {
  const [crRes, colRes] = await Promise.all([
    fetch('/api/creatures'),
    fetch(`/api/users/${session.userId}/creatures`)
  ]);
  const creatures  = await crRes.json();
  const collection = colRes.ok ? await colRes.json() : [];

  // If collection failed (DB permissions), warn but continue with local starter
  if (!colRes.ok) notify('⚠️ Could not load collection — check DB permissions.', 'error');

  window.gameInst = new Game();
  showScreen('game-screen');
  document.getElementById('hud').classList.remove('hidden');

  if (!socket) socket = io();
  window.gameInst.connectSocket(socket);
  socket.emit('join_lobby', { lobbyId, userId: session.userId, username: session.username });

  window.gameInst.start(session, lobbyId, lobbyName, creatures, collection, session.isNewUser);
  notify(`Joined ${lobbyName}!`, 'success');
}

// ── Server Browser ────────────────────────────────────────
document.getElementById('btn-servers').addEventListener('click', async () => {
  showModal('server-browser'); await loadLobbies();
});
document.getElementById('btn-close-servers').addEventListener('click', () => hideModal('server-browser'));

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

// ── Pen (collection) ──────────────────────────────────────
function openPenModal() { showModal('pen-modal'); loadPen(); }
window.openPenModal = openPenModal;

document.getElementById('btn-pen').addEventListener('click', openPenModal);
document.getElementById('btn-close-pen').addEventListener('click', () => hideModal('pen-modal'));
document.getElementById('rarity-filter').addEventListener('change', () => renderPen());
document.getElementById('search-creatures').addEventListener('input',  () => renderPen());

let _penCreatures = [];

async function loadPen() {
  const grid = document.getElementById('creature-grid');
  grid.innerHTML = '<p style="color:var(--gray);padding:20px;">Loading…</p>';
  try {
    const res = await fetch(`/api/users/${session.userId}/creatures`);
    if (!res.ok) throw new Error();
    _penCreatures = await res.json();
    renderPen();
  } catch {
    grid.innerHTML = '<p style="color:var(--danger);padding:20px;">Failed to load pen. Check DB permissions.</p>';
  }
}

function renderPen() {
  const grid   = document.getElementById('creature-grid');
  const rarity = document.getElementById('rarity-filter').value;
  const search = document.getElementById('search-creatures').value.toLowerCase();

  const filtered = _penCreatures.filter(uc => {
    if (!uc.creature) return false;
    if (rarity !== 'all' && uc.creature.rarity !== rarity) return false;
    if (search && !uc.creature.name.toLowerCase().includes(search)) return false;
    return true;
  });

  if (!filtered.length) {
    grid.innerHTML = `<p style="color:var(--gray);padding:20px 0;">
      ${_penCreatures.length === 0
        ? '🐾 Your pen is empty. Go battle creatures and press "Store in Pen"!'
        : 'No creatures match your filter.'}
    </p>`;
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
      <p style="font-size:11px;margin-top:8px;color:var(--gray)">
        Stored ${new Date(uc.caught_at).toLocaleDateString()}
      </p>`;
    grid.appendChild(card);
  }
}

function rarityColor(r) {
  return { common:'#9ca3af', uncommon:'#10b981', rare:'#3b82f6', epic:'#8b5cf6',
    legendary:'#f59e0b', mythic:'#7c3aed', divine:'#fbbf24', celestial:'#06b6d4',
    eternal:'#ec4899', omniversal:'#f472b6' }[r] || '#fff';
}

// ── Settings ──────────────────────────────────────────────
document.getElementById('btn-settings').addEventListener('click', () => showModal('settings-modal'));
document.getElementById('btn-close-settings').addEventListener('click', () => hideModal('settings-modal'));

// ── Tutorial wiring ───────────────────────────────────────
document.getElementById('tut-next').addEventListener('click', () => {
  window.gameInst?._advanceTutorial();
});
document.getElementById('tut-skip').addEventListener('click', () => {
  if (window.gameInst) {
    window.gameInst.tutorialStep = -1;
    document.getElementById('tutorial-overlay').classList.add('hidden');
  }
});

// ── Session restore ───────────────────────────────────────
(function restore() {
  const saved = sessionStorage.getItem('cacSession');
  if (saved) {
    try {
      const p = JSON.parse(saved);
      if (p.userId && p.username) { session = p; openDashboard(); return; }
    } catch { /**/ }
  }
  showScreen('login-screen');
})();
