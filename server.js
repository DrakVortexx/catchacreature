require('dotenv').config();
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

const PORT = process.env.PORT || 3000;

// In-memory storage (for development without Supabase)
const db = {
  users: new Map(),
  creatures: [],
  userCreatures: new Map(),
  lobbies: new Map(),
  lobbyPlayers: new Map(),
  trades: new Map(),
  battles: new Map()
};

// Initialize placeholder creatures
db.creatures = [
  { id: '0', name: 'Lucas da Vucas', rarity: 'common', attack: 15, defense: 10, speed: 12, hp: 60, special_ability: 'Starter Boost', model_data: { color: '#4169E1', shape: 'box' }, spawn_rate: 0 },
  { id: '1', name: 'Blocky Beast', rarity: 'common', attack: 10, defense: 10, speed: 10, hp: 50, special_ability: 'None', model_data: { color: '#808080', shape: 'box' }, spawn_rate: 0.40 },
  { id: '2', name: 'Forest Walker', rarity: 'uncommon', attack: 15, defense: 12, speed: 15, hp: 60, special_ability: 'Quick Step', model_data: { color: '#90EE90', shape: 'box' }, spawn_rate: 0.25 },
  { id: '3', name: 'Sky Glider', rarity: 'rare', attack: 20, defense: 15, speed: 25, hp: 70, special_ability: 'Flight', model_data: { color: '#87CEEB', shape: 'box' }, spawn_rate: 0.15 },
  { id: '4', name: 'Crystal Golem', rarity: 'epic', attack: 30, defense: 25, speed: 20, hp: 90, special_ability: 'Crystal Shield', model_data: { color: '#9370DB', shape: 'box' }, spawn_rate: 0.08 },
  { id: '5', name: 'Fire Spirit', rarity: 'legendary', attack: 40, defense: 30, speed: 35, hp: 120, special_ability: 'Flame Burst', model_data: { color: '#FF4500', shape: 'box' }, spawn_rate: 0.05 },
  { id: '6', name: 'Shadow Wraith', rarity: 'mythic', attack: 50, defense: 35, speed: 40, hp: 150, special_ability: 'Phase Shift', model_data: { color: '#4B0082', shape: 'box' }, spawn_rate: 0.03 },
  { id: '7', name: 'Light Bringer', rarity: 'divine', attack: 60, defense: 45, speed: 45, hp: 180, special_ability: 'Holy Light', model_data: { color: '#FFD700', shape: 'box' }, spawn_rate: 0.02 },
  { id: '8', name: 'Star Weaver', rarity: 'celestial', attack: 70, defense: 55, speed: 50, hp: 220, special_ability: 'Starfall', model_data: { color: '#00CED1', shape: 'box' }, spawn_rate: 0.015 },
  { id: '9', name: 'Time Keeper', rarity: 'eternal', attack: 85, defense: 65, speed: 60, hp: 280, special_ability: 'Time Warp', model_data: { color: '#FF1493', shape: 'box' }, spawn_rate: 0.009 },
  { id: '10', name: 'Void Master', rarity: 'omniversal', attack: 100, defense: 80, speed: 75, hp: 350, special_ability: 'Void Blast', model_data: { color: 'rainbow', shape: 'box' }, spawn_rate: 0.001 }
];

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/assets', express.static(path.join(__dirname, 'assets')));

// In-memory lobby management (8 rooms max)
const MAX_LOBBIES = 8;

// Initialize lobbies
for (let i = 0; i < MAX_LOBBIES; i++) {
  const lobbyId = `lobby-${i + 1}`;
  db.lobbies.set(lobbyId, {
    id: lobbyId,
    name: `Lobby ${i + 1}`,
    max_players: 20,
    current_players: 0,
    status: 'active',
    players: new Map()
  });
}

// API Routes

// Register
app.post('/api/register', (req, res) => {
  try {
    const { username, password } = req.body;

    // Check if username already exists
    for (const [id, u] of db.users) {
      if (u.username === username) {
        return res.status(400).json({ error: 'Username already exists' });
      }
    }

    const userId = `user-${Date.now()}`;
    db.users.set(userId, {
      id: userId,
      username,
      password, // In production, hash this!
      created_at: new Date(),
      battles_won: 0,
      battles_lost: 0,
      trades_completed: 0
    });
    res.json({ userId, username, isNewUser: true });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Login
app.post('/api/login', (req, res) => {
  try {
    const { username, password } = req.body;
    let user = null;

    for (const [id, u] of db.users) {
      if (u.username === username) {
        user = u;
        break;
      }
    }

    if (!user) {
      // Auto-register if user doesn't exist
      const userId = `user-${Date.now()}`;
      user = {
        id: userId,
        username,
        password,
        created_at: new Date(),
        battles_won: 0,
        battles_lost: 0,
        trades_completed: 0
      };
      db.users.set(userId, user);
      return res.json({ userId: user.id, username: user.username, isNewUser: true });
    }

    // Check password
    if (user.password !== password) {
      return res.status(401).json({ error: 'Incorrect password' });
    }

    res.json({ userId: user.id, username: user.username, isNewUser: false });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Get all creatures
app.get('/api/creatures', (req, res) => {
  res.json(db.creatures);
});

// Get specific creature
app.get('/api/creatures/:id', (req, res) => {
  const creature = db.creatures.find(c => c.id === req.params.id);
  if (creature) {
    res.json(creature);
  } else {
    res.status(404).json({ error: 'Creature not found' });
  }
});

// Catch creature
app.post('/api/creatures/catch', (req, res) => {
  try {
    const { userId, creatureId, location } = req.body;
    const creature = db.creatures.find(c => c.id === creatureId);

    if (!creature) {
      return res.status(404).json({ error: 'Creature not found' });
    }

    const userCreatureId = `uc-${Date.now()}`;
    const userCreature = {
      id: userCreatureId,
      user_id: userId,
      creature_id: creatureId,
      creature: creature,
      caught_at: new Date(),
      location_x: location.x,
      location_y: location.y,
      location_z: location.z,
      is_tradable: true,
      in_battle: false
    };

    if (!db.userCreatures.has(userId)) {
      db.userCreatures.set(userId, []);
    }
    db.userCreatures.get(userId).push(userCreature);

    res.json(userCreature);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Get user's creatures
app.get('/api/users/:userId/creatures', (req, res) => {
  const userCreatures = db.userCreatures.get(req.params.userId) || [];
  res.json(userCreatures);
});

// Get user stats
app.get('/api/users/:userId/stats', (req, res) => {
  const user = db.users.get(req.params.userId);
  const userCreatures = db.userCreatures.get(req.params.userId) || [];

  if (user) {
    res.json({
      totalCaught: userCreatures.length,
      battlesWon: user.battles_won,
      battlesLost: user.battles_lost,
      tradesCompleted: user.trades_completed
    });
  } else {
    res.status(404).json({ error: 'User not found' });
  }
});

// Get all lobbies
app.get('/api/lobbies', (req, res) => {
  const lobbiesArray = Array.from(db.lobbies.values()).map(lobby => ({
    id: lobby.id,
    name: lobby.name,
    max_players: lobby.max_players,
    current_players: lobby.current_players,
    status: lobby.status
  }));
  res.json(lobbiesArray);
});

// Join lobby
app.post('/api/lobbies/:lobbyId/join', (req, res) => {
  try {
    const { userId } = req.body;
    const lobbyId = req.params.lobbyId;

    const lobby = db.lobbies.get(lobbyId);
    if (!lobby || lobby.current_players >= lobby.max_players) {
      return res.status(400).json({ error: 'Lobby full or not found' });
    }

    lobby.players.set(userId, { socketId: null, username: null });
    lobby.current_players++;

    res.json({ success: true });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Leave lobby
app.post('/api/lobbies/:lobbyId/leave', (req, res) => {
  try {
    const { userId } = req.body;
    const lobbyId = req.params.lobbyId;

    const lobby = db.lobbies.get(lobbyId);
    if (lobby) {
      lobby.players.delete(userId);
      lobby.current_players = Math.max(0, lobby.current_players - 1);
    }

    res.json({ success: true });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Trade request
app.post('/api/trades/request', (req, res) => {
  try {
    const { initiatorId, recipientId, lobbyId } = req.body;
    const tradeId = `trade-${Date.now()}`;
    db.trades.set(tradeId, {
      id: tradeId,
      initiator_id: initiatorId,
      recipient_id: recipientId,
      lobby_id: lobbyId,
      status: 'pending',
      created_at: new Date()
    });
    res.json({ tradeId });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Accept trade
app.post('/api/trades/:tradeId/accept', (req, res) => {
  try {
    const { userId } = req.body;
    const trade = db.trades.get(req.params.tradeId);
    if (trade && trade.recipient_id === userId) {
      trade.status = 'accepted';
      res.json({ success: true });
    } else {
      res.status(400).json({ error: 'Trade not found' });
    }
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Decline trade
app.post('/api/trades/:tradeId/decline', (req, res) => {
  try {
    const { userId } = req.body;
    const trade = db.trades.get(req.params.tradeId);
    if (trade && trade.recipient_id === userId) {
      trade.status = 'declined';
      res.json({ success: true });
    } else {
      res.status(400).json({ error: 'Trade not found' });
    }
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Complete trade
app.post('/api/trades/:tradeId/complete', (req, res) => {
  try {
    const trade = db.trades.get(req.params.tradeId);
    if (trade) {
      trade.status = 'completed';
      trade.completed_at = new Date();
      res.json({ success: true });
    } else {
      res.status(400).json({ error: 'Trade not found' });
    }
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Battle challenge
app.post('/api/battles/challenge', (req, res) => {
  try {
    const { challengerId, challengedId, lobbyId } = req.body;
    const battleId = `battle-${Date.now()}`;
    db.battles.set(battleId, {
      id: battleId,
      player1_id: challengerId,
      player2_id: challengedId,
      lobby_id: lobbyId,
      status: 'active',
      started_at: new Date()
    });
    res.json({ battleId });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Accept battle
app.post('/api/battles/:battleId/accept', (req, res) => {
  try {
    const { userId } = req.body;
    const battle = db.battles.get(req.params.battleId);
    if (battle && battle.player2_id === userId) {
      battle.status = 'active';
      battle.started_at = new Date();
      res.json({ success: true });
    } else {
      res.status(400).json({ error: 'Battle not found' });
    }
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Socket.io Connection
io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  socket.on('join_lobby', ({ lobbyId, userId, username }) => {
    socket.join(lobbyId);
    const lobby = db.lobbies.get(lobbyId);
    if (lobby) {
      const player = lobby.players.get(userId);
      if (player) {
        player.socketId = socket.id;
        player.username = username;
      }
      io.to(lobbyId).emit('player_joined', { userId, username });
    }
  });

  socket.on('leave_lobby', ({ lobbyId, userId }) => {
    socket.leave(lobbyId);
    const lobby = db.lobbies.get(lobbyId);
    if (lobby) {
      lobby.players.delete(userId);
      io.to(lobbyId).emit('player_left', { userId });
    }
  });

  socket.on('player_move', ({ lobbyId, userId, position }) => {
    const lobby = db.lobbies.get(lobbyId);
    if (lobby) {
      const player = lobby.players.get(userId);
      if (player) {
        player.position = position;
      }
      socket.to(lobbyId).emit('player_moved', { userId, position });
    }
  });

  socket.on('lobby_chat', ({ lobbyId, userId, username, message }) => {
    io.to(lobbyId).emit('chat_message', { userId, username, message });
  });

  socket.on('creature_caught', ({ lobbyId, userId, creatureId }) => {
    io.to(lobbyId).emit('creature_caught', { userId, creatureId });
  });

  socket.on('trade_request', ({ initiatorId, recipientId, lobbyId }) => {
    const lobby = db.lobbies.get(lobbyId);
    if (lobby) {
      const recipient = lobby.players.get(recipientId);
      if (recipient && recipient.socketId) {
        io.to(recipient.socketId).emit('trade_request', { initiatorId, lobbyId });
      }
    }
  });

  socket.on('battle_challenge', ({ challengerId, challengedId, lobbyId }) => {
    const lobby = db.lobbies.get(lobbyId);
    if (lobby) {
      const challenged = lobby.players.get(challengedId);
      if (challenged && challenged.socketId) {
        io.to(challenged.socketId).emit('battle_challenge', { challengerId, lobbyId });
      }
    }
  });

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
  });
});

// Serve index.html for root
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

server.listen(PORT, () => {
  console.log(`Game server running on port ${PORT}`);
});
