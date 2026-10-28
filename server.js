require('dotenv').config();
const express  = require('express');
const http     = require('http');
const cors     = require('cors');
const path     = require('path');
const { createClient } = require('@supabase/supabase-js');

// ── Supabase ─────────────────────────────────────────────
if (!process.env.SUPABASE_URL || process.env.SUPABASE_URL === 'your_supabase_project_url') {
  console.error('❌  SUPABASE_URL is not set in .env');
  process.exit(1);
}
if (!process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY === 'your_supabase_anon_key') {
  console.error('❌  SUPABASE_ANON_KEY is not set in .env');
  process.exit(1);
}

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

const app    = express();
const server = http.createServer(app);
const PORT   = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Serve the public folder (index.html + app.js + assets/)
app.use(express.static(path.join(__dirname, 'public')));

// ── API: Register ────────────────────────────────────────
app.post('/api/register', async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required.' });
  }

  try {
    // Check for existing username
    const { data: existing } = await supabase
      .from('users')
      .select('id')
      .eq('username', username)
      .maybeSingle();

    if (existing) {
      return res.status(400).json({ error: 'Username already taken.' });
    }

    const { data: user, error } = await supabase
      .from('users')
      .insert({ username, password })   // hash passwords in production!
      .select('id, username')
      .single();

    if (error) throw error;

    res.json({ userId: user.id, username: user.username, isNewUser: true });
  } catch (err) {
    console.error('Register error:', err.message);
    res.status(500).json({ error: 'Registration failed.' });
  }
});

// ── API: Login (auto-registers if username is new) ───────
app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required.' });
  }

  try {
    const { data: user } = await supabase
      .from('users')
      .select('id, username, password')
      .eq('username', username)
      .maybeSingle();

    // Auto-register if the account does not exist yet
    if (!user) {
      const { data: newUser, error } = await supabase
        .from('users')
        .insert({ username, password })
        .select('id, username')
        .single();

      if (error) throw error;
      return res.json({ userId: newUser.id, username: newUser.username, isNewUser: true });
    }

    // Verify password
    if (user.password !== password) {
      return res.status(401).json({ error: 'Incorrect password.' });
    }

    res.json({ userId: user.id, username: user.username, isNewUser: false });
  } catch (err) {
    console.error('Login error:', err.message);
    res.status(500).json({ error: 'Login failed.' });
  }
});

// ── API: User stats ──────────────────────────────────────
app.get('/api/users/:userId/stats', async (req, res) => {
  const { userId } = req.params;

  try {
    const { data: user, error: userErr } = await supabase
      .from('users')
      .select('battles_won, battles_lost, trades_completed')
      .eq('id', userId)
      .single();

    if (userErr || !user) return res.status(404).json({ error: 'User not found.' });

    const { count } = await supabase
      .from('user_creatures')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId);

    res.json({
      totalCaught:       count || 0,
      battlesWon:        user.battles_won,
      battlesLost:       user.battles_lost,
      tradesCompleted:   user.trades_completed
    });
  } catch (err) {
    console.error('Stats error:', err.message);
    res.status(500).json({ error: 'Could not load stats.' });
  }
});

// ── API: Get all creatures ───────────────────────────────
app.get('/api/creatures', async (req, res) => {
  try {
    const { data, error } = await supabase.from('creatures').select('*');
    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── API: Get user's caught creatures ─────────────────────
app.get('/api/users/:userId/creatures', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('user_creatures')
      .select('*, creature:creatures(*)')
      .eq('user_id', req.params.userId);

    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Fallback: serve index.html for any unknown route ─────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
