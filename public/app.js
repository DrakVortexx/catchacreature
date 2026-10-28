/* ── Catch a Creature — client app (login / dashboard) ── */

const loginScreen   = document.getElementById('login-screen');
const dashboard     = document.getElementById('dashboard');
const loginForm     = document.getElementById('login-form');
const loginError    = document.getElementById('login-error');
const loginBtn      = document.getElementById('login-btn');
const usernameInput = document.getElementById('username-input');
const passwordInput = document.getElementById('password-input');
const dashUsername  = document.getElementById('dashboard-username');
const dashStats     = document.getElementById('dashboard-stats');
const btnLogout     = document.getElementById('btn-logout');

let session = null; // { userId, username }

// ── Notification helper ──────────────────────────────────
function notify(message, type = 'info') {
  const el = document.createElement('div');
  el.className = `notification ${type}`;
  el.textContent = message;
  document.getElementById('notifications').appendChild(el);
  setTimeout(() => el.remove(), 3500);
}

// ── Screen helpers ───────────────────────────────────────
function showDashboard(userId, username) {
  session = { userId, username };
  loginScreen.classList.add('hidden');
  dashboard.classList.remove('hidden');
  dashUsername.textContent = username;
  loadStats(userId);
}

function showLogin() {
  session = null;
  dashboard.classList.add('hidden');
  loginScreen.classList.remove('hidden');
  loginError.textContent = '';
  loginForm.reset();
}

// ── Load user stats from API ─────────────────────────────
async function loadStats(userId) {
  try {
    const res  = await fetch(`/api/users/${userId}/stats`);
    const data = await res.json();
    if (res.ok) {
      dashStats.textContent =
        `${data.totalCaught} Creatures Caught · ${data.battlesWon} Battles Won`;
    }
  } catch {
    dashStats.textContent = 'Could not load stats';
  }
}

// ── Login / Register ─────────────────────────────────────
loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  loginError.textContent = '';

  const username = usernameInput.value.trim();
  const password = passwordInput.value;

  if (!username || !password) {
    loginError.textContent = 'Please fill in all fields.';
    return;
  }

  loginBtn.disabled = true;
  loginBtn.textContent = 'Signing in…';

  try {
    const res  = await fetch('/api/login', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ username, password })
    });
    const data = await res.json();

    if (!res.ok) {
      loginError.textContent = data.error || 'Login failed.';
      return;
    }

    notify(data.isNewUser ? 'Account created! Welcome!' : `Welcome back, ${data.username}!`, 'success');
    showDashboard(data.userId, data.username);
  } catch {
    loginError.textContent = 'Server error. Please try again.';
  } finally {
    loginBtn.disabled = false;
    loginBtn.textContent = 'Enter World';
  }
});

// ── Logout ───────────────────────────────────────────────
btnLogout.addEventListener('click', () => {
  notify('Logged out.', 'info');
  showLogin();
});

// ── On load: restore session from sessionStorage ─────────
(function restoreSession() {
  const saved = sessionStorage.getItem('cacSession');
  if (saved) {
    try {
      const { userId, username } = JSON.parse(saved);
      if (userId && username) {
        showDashboard(userId, username);
        return;
      }
    } catch { /* ignore */ }
  }
  showLogin();
})();

// Persist session across page refreshes (tab-scoped)
window.addEventListener('beforeunload', () => {
  if (session) sessionStorage.setItem('cacSession', JSON.stringify(session));
  else sessionStorage.removeItem('cacSession');
});
