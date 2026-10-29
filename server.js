require('dotenv').config();
const express  = require('express');
const http     = require('http');
const { Server } = require('socket.io');
const cors     = require('cors');
const path     = require('path');
const { createClient } = require('@supabase/supabase-js');

// ── Supabase ─────────────────────────────────────────────
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

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── Creature definitions (canonical list) ────────────────
const CREATURES = [
  { id: 'c0',  name: 'Lucas da Vucas', rarity: 'common',      attack: 15, defense: 10, speed: 12, hp: 60,  special_ability: 'Starter Boost', color: '#4169E1', spawn_rate: 0 },
  { id: 'c1',  name: 'Blocky Beast',   rarity: 'common',      attack: 10, defense: 10, speed: 10, hp: 50,  special_ability: 'None',          color: '#808080', spawn_rate: 0.40 },
  { id: 'c2',  name: 'Forest Walker',  rarity: 'uncommon',    attack: 15, defense: 12, speed: 15, hp: 60,  special_ability: 'Quick Step',    color: '#90EE90', spawn_rate: 0.25 },
  { id: 'c3',  name: 'Sky Glider',     rarity: 'rare',        attack: 20, defense: 15, speed: 25, hp: 70,  special_ability: 'Flight',        color: '#87CEEB', spawn_rate: 0.15 },
  { id: 'c4',  name: 'Crystal Golem',  rarity: 'epic',        attack: 30, defense: 25, speed: 20, hp: 90,  special_ability: 'Crystal Shield',color: '#9370DB', spawn_rate: 0.08 },
  { id: 'c5',  name: 'Fire Spirit',    rarity: 'legendary',   attack: 40, defense: 30, speed: 35, hp: 120, special_ability: 'Flame Burst',   color: '#FF4500', spawn_rate: 0.05 },
  { id: 'c6',  name: 'Shadow Wraith',  rarity: 'mythic',      attack: 50, defense: 35, speed: 40, hp: 150, special_ability: 'Phase Shift',   color: '#4B0082', spawn_rate: 0.03 },
  { id: 'c7',  name: 'Light Bringer',  rarity: 'divine',      attack: 60, defense: 45, speed: 45, hp: 180, special_ability: 'Holy Light',    color: '#FFD700', spawn_rate: 0.02 },
  { id: 'c8',  name: 'Star Weaver',    rarity: 'celestial',   attack: 70, defense: 55, speed: 50, hp: 220, special_ability: 'Starfall',      color: '#00CED1', spawn_rate: 0.015 },
  { id: 'c9',  name: 'Time Keeper',    rarity: 'eternal',     attack: 85, defense: 65, speed: 60, hp: 280, special_ability: 'Time Warp',     color: '#FF1493', spawn_rate: 0.009 },
  { id: 'c10', name: 'Void Master',    rarity: 'omniversal',  attack:100, defense: 80, speed: 75, hp: 350, special_ability: 'Void Blast',    color: '#FF69B4', spawn_rate: 0.001 }
];

// depth zones: shallow creatures first
const DEPTH_ZONES = [
  { minDepth: 0,    rarities: ['common'] },
  { minDepth: 100,  rarities: ['common','uncommon'] },
  { minDepth: 200,  rarities: ['uncommon','rare'] },
  { minDepth: 350,  rarities: ['rare','epic'] },
  { minDepth: 500,  rarities: ['epic','legendary'] },
  { minDepth: 700,  rarities: ['legendary','mythic'] },
  { minDepth: 900,  rarities: ['mythic','divine'] },
  { minDepth: 1100, rarities: ['divine','celestial'] },
  { minDepth: 1300, rarities: ['celestial','eternal'] },
  { minDepth: 1500, rarities: ['eternal','omniversal'] }
];

// ── In-memory lobby state (no need for DB for lobbies) ───
const MAX_LOBBIES  = 8;
const MAX_PLAYERS  = 20;
const lobbies      = new Map(); // id -> { id, name, players: Map<userId, {socketId,username,x,y}> }

function getOrCreateLobby(preferredId) {
  if (preferredId && lobbies.has(preferredId)) {
    const l = lobbies.get(preferredId);
    if (l.players.size < MAX_PLAYERS) return l;
  }
  // find a non-full lobby
  for (const [, l] of lobbies) {
    if (l.players.size < MAX_PLAYERS) return l;
  }
  // create new if under limit
  if (lobbies.size < MAX_LOBBIES) {
    const id   = `lobby-${lobbies.size + 1}`;
    const newL = { id, name: `Lobby ${lobbies.size + 1}`, players: new Map() };
    lobbies.set(id, newL);
    return newL;
  }
  return null; // all full
}

// seed first lobby
getOrCreateLobby();

// ── API: Register ────────────────────────────────────────
app.post('/api/register', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username and password required.' });
  try {
    const { data: existing } = await supabase.from('users').select('id').eq('username', username).maybeSingle();
    if (existing) return res.status(400).json({ error: 'Username already taken.' });

    const { data: user, error } = await supabase.from('users').insert({ username, password }).select('id,username').single();
    if (error) throw error;
    res.json({ userId: user.id, username: user.username, isNewUser: true });
  } catch (err) {
    console.error('Register:', err.message);
    res.status(500).json({ error: 'Registration failed.' });
  }
});

// ── API: Login ───────────────────────────────────────────
app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username and password required.' });
  try {
    const { data: user } = await supabase.from('users').select('id,username,password').eq('username', username).maybeSingle();

    if (!user) {
      // auto-register
      const { data: newUser, error } = await supabase.from('users').insert({ username, password }).select('id,username').single();
      if (error) throw error;
      // give starter creature
      await giveStarterCreature(newUser.id);
      return res.json({ userId: newUser.id, username: newUser.username, isNewUser: true });
    }

    if (user.password !== password) return res.status(401).json({ error: 'Incorrect password.' });
    res.json({ userId: user.id, username: user.username, isNewUser: false });
  } catch (err) {
    console.error('Login:', err.message);
    res.status(500).json({ error: 'Login failed.' });
  }
});

async function giveStarterCreature(userId) {
  try {
    // Guard: only give starter if user has no creatures yet
    const { count } = await supabase
      .from('user_creatures')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId);
    if (count && count > 0) return; // already has creatures

    await supabase.from('user_creatures').insert({
      user_id:     userId,
      creature_id: 'c0',
      is_active:   true,
      current_hp:  60
    });
  } catch (e) {
    console.error('Starter creature error:', e.message);
  }
}

// ── API: Get all creature types ──────────────────────────
app.get('/api/creatures', (req, res) => res.json(CREATURES));

// ── API: Catch a creature ────────────────────────────────
app.post('/api/creatures/catch', async (req, res) => {
  const { userId, creatureId } = req.body;
  const creature = CREATURES.find(c => c.id === creatureId);
  if (!creature) return res.status(404).json({ error: 'Creature not found.' });
  try {
    const { data, error } = await supabase.from('user_creatures')
      .insert({ user_id: userId, creature_id: creatureId, is_active: false, current_hp: creature.hp })
      .select('id').single();
    if (error) throw error;

    // increment battles_won using plain update
    const { data: currentUser } = await supabase
      .from('users').select('battles_won').eq('id', userId).single();
    if (currentUser) {
      await supabase.from('users')
        .update({ battles_won: (currentUser.battles_won || 0) + 1 })
        .eq('id', userId);
    }

    res.json({ userCreatureId: data.id, creature });
  } catch (err) {
    console.error('Catch:', err.message);
    res.status(500).json({ error: 'Could not save creature.' });
  }
});

// ── API: User stats ──────────────────────────────────────
app.get('/api/users/:userId/stats', async (req, res) => {
  try {
    const { data: user, error } = await supabase.from('users')
      .select('battles_won,battles_lost,trades_completed').eq('id', req.params.userId).single();
    if (error || !user) return res.status(404).json({ error: 'User not found.' });

    const { count } = await supabase.from('user_creatures')
      .select('id', { count: 'exact', head: true }).eq('user_id', req.params.userId);

    res.json({ totalCaught: count || 0, battlesWon: user.battles_won, battlesLost: user.battles_lost, tradesCompleted: user.trades_completed });
  } catch (err) {
    console.error('Stats:', err.message);
    res.status(500).json({ error: 'Could not load stats.' });
  }
});

// ── API: User's creature collection ──────────────────────
app.get('/api/users/:userId/creatures', async (req, res) => {
  try {
    const { data, error } = await supabase.from('user_creatures')
      .select('*').eq('user_id', req.params.userId).order('caught_at', { ascending: false });
    if (error) throw error;

    // attach full creature data
    const enriched = data.map(uc => ({
      ...uc,
      creature: CREATURES.find(c => c.id === uc.creature_id) || null
    }));
    res.json(enriched);
  } catch (err) {
    console.error('User creatures:', err.message);
    res.status(500).json({ error: 'Could not load collection.' });
  }
});

// ── API: Lobbies ─────────────────────────────────────────
app.get('/api/lobbies', (req, res) => {
  const list = Array.from(lobbies.values()).map(l => ({
    id: l.id, name: l.name,
    currentPlayers: l.players.size,
    maxPlayers: MAX_PLAYERS,
    status: l.players.size >= MAX_PLAYERS ? 'full' : 'active'
  }));
  res.json(list);
});

app.post('/api/lobbies/join', (req, res) => {
  const { lobbyId } = req.body;
  const lobby = getOrCreateLobby(lobbyId);
  if (!lobby) return res.status(503).json({ error: 'All lobbies are full.' });
  res.json({ lobbyId: lobby.id, lobbyName: lobby.name });
});

// ── Socket.io ────────────────────────────────────────────
io.on('connection', (socket) => {
  let currentLobby = null;
  let currentUser  = null;

  socket.on('join_lobby', ({ lobbyId, userId, username }) => {
    const lobby = getOrCreateLobby(lobbyId);
    if (!lobby) { socket.emit('error', 'All lobbies full'); return; }

    currentLobby = lobby;
    currentUser  = { userId, username };

    // leave previous rooms
    socket.rooms.forEach(r => { if (r !== socket.id) socket.leave(r); });
    socket.join(lobby.id);

    lobby.players.set(userId, { socketId: socket.id, username, x: 400, y: 300 });

    // send current players to the joiner
    const others = [];
    for (const [uid, p] of lobby.players) {
      if (uid !== userId) others.push({ userId: uid, username: p.username, x: p.x, y: p.y });
    }
    socket.emit('lobby_state', { lobbyId: lobby.id, lobbyName: lobby.name, players: others });
    socket.to(lobby.id).emit('player_joined', { userId, username, x: 400, y: 300 });
  });

  socket.on('player_move', ({ x, y }) => {
    if (!currentLobby || !currentUser) return;
    const p = currentLobby.players.get(currentUser.userId);
    if (p) { p.x = x; p.y = y; }
    socket.to(currentLobby.id).emit('player_moved', { userId: currentUser.userId, x, y });
  });

  socket.on('lobby_chat', ({ message }) => {
    if (!currentLobby || !currentUser) return;
    io.to(currentLobby.id).emit('chat_message', {
      userId: currentUser.userId,
      username: currentUser.username,
      message
    });
  });

  socket.on('creature_caught', ({ creatureId }) => {
    if (!currentLobby || !currentUser) return;
    socket.to(currentLobby.id).emit('creature_caught_broadcast', {
      userId: currentUser.userId,
      username: currentUser.username,
      creatureId
    });
  });

  socket.on('leave_lobby', () => cleanup());

  socket.on('disconnect', () => cleanup());

  function cleanup() {
    if (currentLobby && currentUser) {
      currentLobby.players.delete(currentUser.userId);
      socket.to(currentLobby.id).emit('player_left', { userId: currentUser.userId });
    }
    currentLobby = null;
    currentUser  = null;
  }
});

// ── Fallback ─────────────────────────────────────────────
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

server.listen(PORT, () => console.log(`✅  Server running on http://localhost:${PORT}`));
