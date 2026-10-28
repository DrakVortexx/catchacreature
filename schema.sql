-- ══════════════════════════════════════════════════════════
-- Catch a Creature — Full Database Schema (fresh install)
-- Run this once on a brand-new Supabase project.
-- For existing databases, run migrate.sql instead.
-- ══════════════════════════════════════════════════════════

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ── Users ─────────────────────────────────────────────────
CREATE TABLE users (
  id               UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
  username         VARCHAR(50)  UNIQUE NOT NULL,
  password         VARCHAR(255) NOT NULL,
  created_at       TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
  battles_won      INT          DEFAULT 0,
  battles_lost     INT          DEFAULT 0,
  trades_completed INT          DEFAULT 0
);

-- ── User creatures ────────────────────────────────────────
-- creature_id is a short string key (c0–c10) matching the
-- CREATURES array defined in server.js — no separate table needed.
CREATE TABLE user_creatures (
  id           UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id      UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  creature_id  VARCHAR(10)  NOT NULL,
  caught_at    TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
  is_active    BOOLEAN      DEFAULT false,
  current_hp   INT,
  is_tradable  BOOLEAN      DEFAULT true,
  in_battle    BOOLEAN      DEFAULT false
);

-- ── Lobbies ───────────────────────────────────────────────
-- Lobby state is managed in-memory by the server; this table
-- is kept for potential persistence / analytics.
CREATE TABLE lobbies (
  id              UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  name            VARCHAR(50),
  max_players     INT         DEFAULT 20,
  current_players INT         DEFAULT 0,
  created_at      TIMESTAMP   DEFAULT CURRENT_TIMESTAMP,
  status          VARCHAR(20) DEFAULT 'active'
    CHECK (status IN ('active', 'full', 'closed'))
);

-- ── Lobby players ─────────────────────────────────────────
CREATE TABLE lobby_players (
  id         UUID      PRIMARY KEY DEFAULT uuid_generate_v4(),
  lobby_id   UUID      NOT NULL REFERENCES lobbies(id)  ON DELETE CASCADE,
  user_id    UUID      NOT NULL REFERENCES users(id)    ON DELETE CASCADE,
  joined_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  position_x DECIMAL(10,2) DEFAULT 0,
  position_y DECIMAL(10,2) DEFAULT 0,
  UNIQUE(lobby_id, user_id)
);

-- ── Trades ────────────────────────────────────────────────
CREATE TABLE trades (
  id           UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  initiator_id UUID        REFERENCES users(id),
  recipient_id UUID        REFERENCES users(id),
  lobby_id     UUID        REFERENCES lobbies(id),
  status       VARCHAR(20) DEFAULT 'pending'
    CHECK (status IN ('pending', 'accepted', 'declined', 'completed')),
  created_at   TIMESTAMP   DEFAULT CURRENT_TIMESTAMP,
  completed_at TIMESTAMP
);

-- ── Trade items ───────────────────────────────────────────
CREATE TABLE trade_items (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  trade_id         UUID REFERENCES trades(id)         ON DELETE CASCADE,
  user_creature_id UUID REFERENCES user_creatures(id),
  from_user_id     UUID REFERENCES users(id)
);

-- ── Battles ───────────────────────────────────────────────
CREATE TABLE battles (
  id           UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  player1_id   UUID        REFERENCES users(id),
  player2_id   UUID        REFERENCES users(id),
  lobby_id     UUID        REFERENCES lobbies(id),
  winner_id    UUID        REFERENCES users(id),
  status       VARCHAR(20) DEFAULT 'active'
    CHECK (status IN ('active', 'completed')),
  started_at   TIMESTAMP   DEFAULT CURRENT_TIMESTAMP,
  completed_at TIMESTAMP
);

-- ── Battle participants ───────────────────────────────────
CREATE TABLE battle_participants (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  battle_id        UUID REFERENCES battles(id)        ON DELETE CASCADE,
  user_id          UUID REFERENCES users(id),
  user_creature_id UUID REFERENCES user_creatures(id)
);

-- ── Indexes ───────────────────────────────────────────────
CREATE INDEX idx_user_creatures_user_id  ON user_creatures(user_id);
CREATE INDEX idx_user_creatures_active   ON user_creatures(user_id, is_active);
CREATE INDEX idx_lobbies_status          ON lobbies(status);
CREATE INDEX idx_lobby_players_lobby_id  ON lobby_players(lobby_id);
CREATE INDEX idx_lobby_players_user_id   ON lobby_players(user_id);
CREATE INDEX idx_trades_status           ON trades(status);
CREATE INDEX idx_battles_status          ON battles(status);

-- ── Row Level Security (permissive for anon key) ──────────
-- Disable RLS so the server-side anon key can read/write freely.
-- Tighten these policies once you add JWT-based auth.
ALTER TABLE users             DISABLE ROW LEVEL SECURITY;
ALTER TABLE user_creatures    DISABLE ROW LEVEL SECURITY;
ALTER TABLE lobbies           DISABLE ROW LEVEL SECURITY;
ALTER TABLE lobby_players     DISABLE ROW LEVEL SECURITY;
ALTER TABLE trades            DISABLE ROW LEVEL SECURITY;
ALTER TABLE trade_items       DISABLE ROW LEVEL SECURITY;
ALTER TABLE battles           DISABLE ROW LEVEL SECURITY;
ALTER TABLE battle_participants DISABLE ROW LEVEL SECURITY;
