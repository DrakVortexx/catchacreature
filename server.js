require('dotenv').config();
const express   = require('express');
const http      = require('http');
const { Server } = require('socket.io');
const cors      = require('cors');
const path      = require('path');
const rateLimit = require('express-rate-limit');
const bcrypt    = require('bcrypt');
const SALT_ROUNDS = 12;
const { createClient } = require('@supabase/supabase-js');

// ── Supabase ──────────────────────────────────────────────
if (!process.env.SUPABASE_URL || process.env.SUPABASE_URL === 'your_supabase_project_url') {
  console.error('❌  SUPABASE_URL is not set in .env'); process.exit(1);
}
if (!process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY === 'your_supabase_anon_key') {
  console.error('❌  SUPABASE_ANON_KEY is not set in .env'); process.exit(1);
}
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

const app    = express();
const server = http.createServer(app);
const io     = new Server(server, { cors: { origin: '*' } });
const PORT   = process.env.PORT || 3000;

app.set('trust proxy', true);
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── Rate limiting ─────────────────────────────────────────
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20,                   // 20 attempts per window
  message: { error: 'Too many attempts, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false
});

// ── Input validation helper ───────────────────────────────
function validateCredentials(username, password) {
  if (!username || !password) return 'Username and password are required.';
  if (username.length < 2)    return 'Username must be at least 2 characters.';
  if (username.length > 20)   return 'Username must be 20 characters or less.';
  if (password.length < 4)    return 'Password must be at least 4 characters.';
  if (!/^[a-zA-Z0-9_\-]+$/.test(username)) return 'Username can only contain letters, numbers, _ and -.';
  return null;
}

// ── Creature definitions ──────────────────────────────────
const CREATURES = [
  { id: 'c0',  name: 'Lucas da Vucas', rarity: 'common',     attack: 15, defense: 10, speed: 12, hp: 60,  special_ability: 'Starter Boost', color: '#4169E1', spawn_rate: 0 },
  { id: 'c1',  name: 'Blocky Beast',   rarity: 'common',     attack: 10, defense: 10, speed: 10, hp: 50,  special_ability: 'None',          color: '#808080', spawn_rate: 0.40 },
  { id: 'c2',  name: 'Forest Walker',  rarity: 'uncommon',   attack: 15, defense: 12, speed: 15, hp: 60,  special_ability: 'Quick Step',    color: '#90EE90', spawn_rate: 0.25 },
  { id: 'c3',  name: 'Sky Glider',     rarity: 'rare',       attack: 20, defense: 15, speed: 25, hp: 70,  special_ability: 'Flight',        color: '#87CEEB', spawn_rate: 0.15 },
  { id: 'c4',  name: 'Crystal Golem',  rarity: 'epic',       attack: 30, defense: 25, speed: 20, hp: 90,  special_ability: 'Crystal Shield',color: '#9370DB', spawn_rate: 0.08 },
  { id: 'c5',  name: 'Fire Spirit',    rarity: 'legendary',  attack: 40, defense: 30, speed: 35, hp: 120, special_ability: 'Flame Burst',   color: '#FF4500', spawn_rate: 0.05 },
  { id: 'c6',  name: 'Shadow Wraith',  rarity: 'mythic',     attack: 50, defense: 35, speed: 40, hp: 150, special_ability: 'Phase Shift',   color: '#4B0082', spawn_rate: 0.03 },
  { id: 'c7',  name: 'Light Bringer',  rarity: 'divine',     attack: 60, defense: 45, speed: 45, hp: 180, special_ability: 'Holy Light',    color: '#FFD700', spawn_rate: 0.02 },
  { id: 'c8',  name: 'Star Weaver',    rarity: 'celestial',  attack: 70, defense: 55, speed: 50, hp: 220, special_ability: 'Starfall',      color: '#00CED1', spawn_rate: 0.015 },
  { id: 'c9',  name: 'Time Keeper',    rarity: 'eternal',    attack: 85, defense: 65, speed: 60, hp: 280, special_ability: 'Time Warp',     color: '#FF1493', spawn_rate: 0.009 },
  { id: 'c10', name: 'Void Master',    rarity: 'omniversal', attack:100, defense: 80, speed: 75, hp: 350, special_ability: 'Void Blast',    color: '#FF69B4', spawn_rate: 0.001 }
];

// ── Lobby state ───────────────────────────────────────────
const MAX_LOBBIES = 8;
const MAX_PLAYERS = 8;
const lobbies = new Map();

function getOrCreateLobby(preferredId) {
  if (preferredId && lobbies.has(preferredId)) {
    const l = lobbies.get(preferredId);
    if (l.players.size < MAX_PLAYERS) return l;
  }
  for (const [, l] of lobbies) {
    if (l.players.size < MAX_PLAYERS) return l;
  }
  if (lobbies.size < MAX_LOBBIES) {
    const id   = `lobby-${lobbies.size + 1}`;
    const newL = { id, name: `Lobby ${lobbies.size + 1}`, players: new Map() };
    lobbies.set(id, newL);
    return newL;
  }
  return null;
}
getOrCreateLobby();

// ── Single-session tracking: userId -> socketId ───────────
const activeSessions = new Map();

// ── API: Register ─────────────────────────────────────────
app.post('/api/register', authLimiter, async (req, res) => {
  const { username, password } = req.body;
  const err = validateCredentials(username, password);
  if (err) return res.status(400).json({ error: err });
  try {
    const { data: existing } = await supabase.from('users').select('id').eq('username', username).maybeSingle();
    if (existing) return res.status(400).json({ error: 'Username already taken.' });
    const hash = await bcrypt.hash(password, SALT_ROUNDS);
    const { data: user, error } = await supabase.from('users').insert({ username, password: hash }).select('id,username').single();
    if (error) throw error;
    res.json({ userId: user.id, username: user.username, isNewUser: true });
  } catch (e) {
    console.error('Register:', e.message);
    res.status(500).json({ error: 'Registration failed.' });
  }
});

// ── API: Login ────────────────────────────────────────────
app.post('/api/login', authLimiter, async (req, res) => {
  const { username, password } = req.body;
  const err = validateCredentials(username, password);
  if (err) return res.status(400).json({ error: err });
  try {
    const { data: user } = await supabase.from('users').select('id,username,password,money').eq('username', username).maybeSingle();

    if (!user) {
      // Auto-register with hashed password
      const hash = await bcrypt.hash(password, SALT_ROUNDS);
      const { data: newUser, error } = await supabase.from('users').insert({ username, password: hash, money: 0 }).select('id,username,money').single();
      if (error) throw error;
      await giveStarterCreature(newUser.id);
      return res.json({ userId: newUser.id, username: newUser.username, money: newUser.money || 0, isNewUser: true });
    }

    // Check password — supports both bcrypt hashes and legacy plain-text
    const storedPw  = user.password || '';
    const isHashed  = storedPw.startsWith('$2');
    let   valid     = false;

    if (isHashed) {
      valid = await bcrypt.compare(password, storedPw);
    } else {
      // Legacy plain-text match
      valid = storedPw === password;
      if (valid) {
        // Silently upgrade to hashed password
        const hash = await bcrypt.hash(password, SALT_ROUNDS);
        await supabase.from('users').update({ password: hash }).eq('id', user.id);
      }
    }

    if (!valid) return res.status(401).json({ error: 'Incorrect password.' });

    // Kick any existing session for this user
    const oldSocketId = activeSessions.get(user.id);
    if (oldSocketId) {
      const oldSocket = io.sockets.sockets.get(oldSocketId);
      if (oldSocket) oldSocket.emit('kicked', 'Your account was opened in another tab or browser.');
    }

    res.json({ userId: user.id, username: user.username, money: user.money || 0, isNewUser: false });
  } catch (e) {
    console.error('Login:', e.message);
    res.status(500).json({ error: 'Login failed.' });
  }
});

async function giveStarterCreature(userId) {
  try {
    const { count } = await supabase.from('user_creatures')
      .select('id', { count: 'exact', head: true }).eq('user_id', userId);
    if (count && count > 0) return;
    await supabase.from('user_creatures').insert({
      user_id: userId, creature_id: 'c0', is_active: true, current_hp: 60
    });
  } catch (e) {
    console.error('Starter creature error:', e.message);
  }
}

// ── API: Creatures ────────────────────────────────────────
app.get('/api/creatures', (req, res) => res.json(CREATURES));

// ── API: Store creature in base ───────────────────────────
app.post('/api/creatures/store', async (req, res) => {
  const { userId, creatureId } = req.body;
  if (!userId || !creatureId) return res.status(400).json({ error: 'Missing fields.' });
  const creature = CREATURES.find(c => c.id === creatureId);
  if (!creature) return res.status(404).json({ error: 'Creature not found.' });
  try {
    const { data, error } = await supabase.from('user_creatures')
      .insert({ user_id: userId, creature_id: creatureId, is_active: false, current_hp: creature.hp })
      .select('id').single();
    if (error) throw error;
    res.json({ userCreatureId: data.id, creature });
  } catch (e) {
    console.error('Store:', e.message);
    res.status(500).json({ error: 'Could not store creature.' });
  }
});

// ── API: Record battle win ────────────────────────────────
app.post('/api/battles/win', async (req, res) => {
  const { userId } = req.body;
  if (!userId) return res.status(400).json({ error: 'Missing userId.' });
  try {
    const { data: u } = await supabase.from('users').select('battles_won').eq('id', userId).single();
    if (u) await supabase.from('users').update({ battles_won: (u.battles_won || 0) + 1 }).eq('id', userId);
    res.json({ ok: true });
  } catch (e) {
    console.error('Battle win:', e.message);
    res.status(500).json({ error: 'Could not record win.' });
  }
});

// ── API: User stats ───────────────────────────────────────
app.get('/api/users/:userId/stats', async (req, res) => {
  try {
    const { data: user, error } = await supabase.from('users')
      .select('battles_won,battles_lost,trades_completed').eq('id', req.params.userId).single();
    if (error || !user) return res.status(404).json({ error: 'User not found.' });
    const { count } = await supabase.from('user_creatures')
      .select('id', { count: 'exact', head: true }).eq('user_id', req.params.userId);
    res.json({ totalCaught: count || 0, battlesWon: user.battles_won, battlesLost: user.battles_lost, tradesCompleted: user.trades_completed });
  } catch (e) {
    console.error('Stats:', e.message);
    res.status(500).json({ error: 'Could not load stats.' });
  }
});

// ── API: User creatures ───────────────────────────────────
app.get('/api/users/:userId/creatures', async (req, res) => {
  try {
    const { data, error } = await supabase.from('user_creatures')
      .select('*').eq('user_id', req.params.userId).order('caught_at', { ascending: false });
    if (error) throw error;
    const enriched = data.map(uc => ({ ...uc, creature: CREATURES.find(c => c.id === uc.creature_id) || null }));
    res.json(enriched);
  } catch (e) {
    console.error('User creatures:', e.message);
    res.status(500).json({ error: 'Could not load creatures.' });
  }
});

// ── API: Equip creature ───────────────────────────────────
app.post('/api/users/:userId/creatures/:userCreatureId/equip', async (req, res) => {
  try {
    const { userId, userCreatureId } = req.params;

    // Set all creatures for this user to is_active = false
    await supabase.from('user_creatures')
      .update({ is_active: false })
      .eq('user_id', userId);

    // Set the selected creature to is_active = true
    const { data, error } = await supabase.from('user_creatures')
      .update({ is_active: true })
      .eq('id', userCreatureId)
      .eq('user_id', userId)
      .select()
      .single();

    if (error) throw error;
    res.json({ ok: true });
  } catch (e) {
    console.error('Equip creature:', e.message);
    res.status(500).json({ error: 'Could not equip creature.' });
  }
});

// ── API: Save player money ────────────────────────────────
app.post('/api/users/:userId/money', async (req, res) => {
  try {
    const { userId } = req.params;
    const { money } = req.body;
    if (money === undefined) return res.status(400).json({ error: 'Missing money value.' });
    
    const { error } = await supabase.from('users')
      .update({ money: Math.floor(money) })
      .eq('id', userId);
    
    if (error) throw error;
    res.json({ ok: true });
  } catch (e) {
    console.error('Save money:', e.message);
    res.status(500).json({ error: 'Could not save money.' });
  }
});

// ── API: Lobbies ──────────────────────────────────────────
app.get('/api/lobbies', (req, res) => {
  res.json(Array.from(lobbies.values()).map(l => ({
    id: l.id, name: l.name,
    currentPlayers: l.players.size, maxPlayers: MAX_PLAYERS,
    status: l.players.size >= MAX_PLAYERS ? 'full' : 'active'
  })));
});

app.post('/api/lobbies/join', (req, res) => {
  console.log('Lobby join request:', req.body);
  const lobby = getOrCreateLobby(req.body.lobbyId);
  if (!lobby) return res.status(503).json({ error: 'All lobbies are full.' });
  console.log('Lobby found:', lobby.id, lobby.name);
  res.json({ lobbyId: lobby.id, lobbyName: lobby.name });
});

// ── Socket.io ─────────────────────────────────────────────
io.on('connection', (socket) => {
  let currentLobby = null;
  let currentUser  = null;

  socket.on('register_session', ({ userId, username }) => {
    // Kick old socket for this user if there is one
    const oldId = activeSessions.get(userId);
    if (oldId && oldId !== socket.id) {
      const oldSock = io.sockets.sockets.get(oldId);
      if (oldSock) {
        oldSock.emit('kicked', 'Your account was opened somewhere else.');
        oldSock.disconnect(true);
      }
    }
    activeSessions.set(userId, socket.id);
    currentUser = { userId, username };
  });

  socket.on('join_lobby', ({ lobbyId, userId, username }) => {
    const lobby = getOrCreateLobby(lobbyId);
    if (!lobby) { socket.emit('error', 'All lobbies full'); return; }
    currentLobby = lobby;
    if (!currentUser) currentUser = { userId, username };

    socket.rooms.forEach(r => { if (r !== socket.id) socket.leave(r); });
    socket.join(lobby.id);
    lobby.players.set(userId, { socketId: socket.id, username, x: 0, y: 0 });

    const others = [];
    for (const [uid, p] of lobby.players)
      if (uid !== userId) others.push({ userId: uid, username: p.username, x: p.x, y: p.y });

    socket.emit('lobby_state', { lobbyId: lobby.id, lobbyName: lobby.name, players: others });
    socket.to(lobby.id).emit('player_joined', { userId, username, x: 0, y: 0 });
  });

  socket.on('player_move', ({ x, y }) => {
    if (!currentLobby || !currentUser) return;
    const p = currentLobby.players.get(currentUser.userId);
    if (p) { p.x = x; p.y = y; }
    socket.to(currentLobby.id).emit('player_moved', { userId: currentUser.userId, x, y });
  });

  socket.on('lobby_chat', ({ message }) => {
    if (!currentLobby || !currentUser) return;
    const clean = String(message).substring(0, 200);
    io.to(currentLobby.id).emit('chat_message', { userId: currentUser.userId, username: currentUser.username, message: clean });
  });

  socket.on('creature_stored', ({ creatureId }) => {
    if (!currentLobby || !currentUser) return;
    socket.to(currentLobby.id).emit('creature_stored_broadcast', {
      userId: currentUser.userId, username: currentUser.username, creatureId
    });
  });

  socket.on('player_frozen', ({ targetUserId, duration }) => {
    if (!currentLobby || !currentUser) return;
    const targetPlayer = currentLobby.players.get(targetUserId);
    if (targetPlayer) {
      const targetSocket = io.sockets.sockets.get(targetPlayer.socketId);
      if (targetSocket) {
        targetSocket.emit('player_frozen', { duration });
      }
    }
  });

  socket.on('leave_lobby', () => cleanup());
  socket.on('disconnect', () => {
    if (currentUser) activeSessions.delete(currentUser.userId);
    cleanup();
  });

  function cleanup() {
    if (currentLobby && currentUser) {
      currentLobby.players.delete(currentUser.userId);
      socket.to(currentLobby.id).emit('player_left', { userId: currentUser.userId });
    }
    currentLobby = null; currentUser = null;
  }
});

// ── Fallback ──────────────────────────────────────────────
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

server.listen(PORT, () => console.log(`✅  Server running on http://localhost:${PORT}`));
