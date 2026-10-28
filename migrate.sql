-- ══════════════════════════════════════════════════════════
-- Catch a Creature — Migration Script
-- Run this if you already have the old schema and need to
-- upgrade to the current version. Safe to run multiple times
-- (uses IF NOT EXISTS / IF EXISTS guards throughout).
-- ══════════════════════════════════════════════════════════

-- ── 1. Enable UUID extension (idempotent) ─────────────────
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ── 2. users — add missing columns ───────────────────────
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS battles_won      INT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS battles_lost     INT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS trades_completed INT DEFAULT 0;

-- ── 3. user_creatures — rebuild for new schema ────────────
-- The old table used creature_id UUID (FK to a creatures
-- table). The new schema uses creature_id VARCHAR(10) (c0–c10)
-- with no separate creatures table.
--
-- Step A: drop old FK constraint if it exists
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'user_creatures'
      AND constraint_type = 'FOREIGN KEY'
      AND constraint_name LIKE '%creature_id%'
  ) THEN
    ALTER TABLE user_creatures
      DROP CONSTRAINT IF EXISTS user_creatures_creature_id_fkey;
  END IF;
END $$;

-- Step B: change creature_id column type to VARCHAR(10)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'user_creatures' AND column_name = 'creature_id'
  ) THEN
    ALTER TABLE user_creatures
      ALTER COLUMN creature_id TYPE VARCHAR(10) USING creature_id::text;
  END IF;
END $$;

-- Step C: add new columns
ALTER TABLE user_creatures
  ADD COLUMN IF NOT EXISTS is_active   BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS current_hp  INT;

-- Step D: drop old location columns (no longer used)
ALTER TABLE user_creatures
  DROP COLUMN IF EXISTS location_x,
  DROP COLUMN IF EXISTS location_y,
  DROP COLUMN IF EXISTS location_z;

-- ── 4. Drop old creatures table (types are now in server.js) ─
DROP TABLE IF EXISTS battle_participants CASCADE;
DROP TABLE IF EXISTS battles            CASCADE;
DROP TABLE IF EXISTS trade_items        CASCADE;
DROP TABLE IF EXISTS trades             CASCADE;
DROP TABLE IF EXISTS lobby_players      CASCADE;
DROP TABLE IF EXISTS lobbies            CASCADE;
DROP TABLE IF EXISTS creatures          CASCADE;

-- ── 5. Recreate dependent tables with updated schema ──────

CREATE TABLE IF NOT EXISTS lobbies (
  id              UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  name            VARCHAR(50),
  max_players     INT         DEFAULT 20,
  current_players INT         DEFAULT 0,
  created_at      TIMESTAMP   DEFAULT CURRENT_TIMESTAMP,
  status          VARCHAR(20) DEFAULT 'active'
    CHECK (status IN ('active', 'full', 'closed'))
);

CREATE TABLE IF NOT EXISTS lobby_players (
  id         UUID      PRIMARY KEY DEFAULT uuid_generate_v4(),
  lobby_id   UUID      NOT NULL REFERENCES lobbies(id)  ON DELETE CASCADE,
  user_id    UUID      NOT NULL REFERENCES users(id)    ON DELETE CASCADE,
  joined_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  position_x DECIMAL(10,2) DEFAULT 0,
  position_y DECIMAL(10,2) DEFAULT 0,
  UNIQUE(lobby_id, user_id)
);

CREATE TABLE IF NOT EXISTS trades (
  id           UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  initiator_id UUID        REFERENCES users(id),
  recipient_id UUID        REFERENCES users(id),
  lobby_id     UUID        REFERENCES lobbies(id),
  status       VARCHAR(20) DEFAULT 'pending'
    CHECK (status IN ('pending', 'accepted', 'declined', 'completed')),
  created_at   TIMESTAMP   DEFAULT CURRENT_TIMESTAMP,
  completed_at TIMESTAMP
);

CREATE TABLE IF NOT EXISTS trade_items (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  trade_id         UUID REFERENCES trades(id)         ON DELETE CASCADE,
  user_creature_id UUID REFERENCES user_creatures(id),
  from_user_id     UUID REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS battles (
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

CREATE TABLE IF NOT EXISTS battle_participants (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  battle_id        UUID REFERENCES battles(id)        ON DELETE CASCADE,
  user_id          UUID REFERENCES users(id),
  user_creature_id UUID REFERENCES user_creatures(id)
);

-- ── 6. Indexes ────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_user_creatures_user_id ON user_creatures(user_id);
CREATE INDEX IF NOT EXISTS idx_user_creatures_active  ON user_creatures(user_id, is_active);
CREATE INDEX IF NOT EXISTS idx_lobbies_status         ON lobbies(status);
CREATE INDEX IF NOT EXISTS idx_lobby_players_lobby_id ON lobby_players(lobby_id);
CREATE INDEX IF NOT EXISTS idx_lobby_players_user_id  ON lobby_players(user_id);
CREATE INDEX IF NOT EXISTS idx_trades_status          ON trades(status);
CREATE INDEX IF NOT EXISTS idx_battles_status         ON battles(status);

-- ── 7. Disable RLS on all tables ──────────────────────────
ALTER TABLE users               DISABLE ROW LEVEL SECURITY;
ALTER TABLE user_creatures      DISABLE ROW LEVEL SECURITY;
ALTER TABLE lobbies             DISABLE ROW LEVEL SECURITY;
ALTER TABLE lobby_players       DISABLE ROW LEVEL SECURITY;
ALTER TABLE trades              DISABLE ROW LEVEL SECURITY;
ALTER TABLE trade_items         DISABLE ROW LEVEL SECURITY;
ALTER TABLE battles             DISABLE ROW LEVEL SECURITY;
ALTER TABLE battle_participants DISABLE ROW LEVEL SECURITY;
