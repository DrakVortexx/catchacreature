-- Catch a Creature - Complete Database Schema

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Users table
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  username VARCHAR(50) UNIQUE NOT NULL,
  password VARCHAR(255) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  battles_won INT DEFAULT 0,
  battles_lost INT DEFAULT 0,
  trades_completed INT DEFAULT 0
);

-- Creatures table (creature types)
CREATE TABLE creatures (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(100) NOT NULL,
  rarity VARCHAR(20) NOT NULL CHECK (rarity IN ('common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic', 'divine', 'celestial', 'eternal', 'omniversal')),
  attack INT NOT NULL,
  defense INT NOT NULL,
  speed INT NOT NULL,
  hp INT NOT NULL,
  special_ability TEXT,
  model_data JSONB,
  spawn_rate DECIMAL(5,4) NOT NULL
);

-- User creatures (caught creatures)
CREATE TABLE user_creatures (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  creature_id UUID REFERENCES creatures(id),
  caught_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  location_x DECIMAL(10,2),
  location_y DECIMAL(10,2),
  location_z DECIMAL(10,2),
  is_tradable BOOLEAN DEFAULT true,
  in_battle BOOLEAN DEFAULT false
);

-- Lobbies table
CREATE TABLE lobbies (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(50),
  max_players INT DEFAULT 20,
  current_players INT DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'full', 'closed'))
);

-- Lobby players
CREATE TABLE lobby_players (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  lobby_id UUID REFERENCES lobbies(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  position_x DECIMAL(10,2) DEFAULT 0,
  position_y DECIMAL(10,2) DEFAULT 0,
  position_z DECIMAL(10,2) DEFAULT 0,
  UNIQUE(lobby_id, user_id)
);

-- Trades
CREATE TABLE trades (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  initiator_id UUID REFERENCES users(id),
  recipient_id UUID REFERENCES users(id),
  lobby_id UUID REFERENCES lobbies(id),
  status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined', 'completed')),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  completed_at TIMESTAMP
);

-- Trade items
CREATE TABLE trade_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  trade_id UUID REFERENCES trades(id) ON DELETE CASCADE,
  user_creature_id UUID REFERENCES user_creatures(id),
  from_user_id UUID REFERENCES users(id)
);

-- Battles
CREATE TABLE battles (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  player1_id UUID REFERENCES users(id),
  player2_id UUID REFERENCES users(id),
  lobby_id UUID REFERENCES lobbies(id),
  winner_id UUID REFERENCES users(id),
  status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'completed')),
  started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  completed_at TIMESTAMP
);

-- Battle participants
CREATE TABLE battle_participants (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  battle_id UUID REFERENCES battles(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id),
  user_creature_id UUID REFERENCES user_creatures(id)
);

-- Insert placeholder creatures
INSERT INTO creatures (name, rarity, attack, defense, speed, hp, special_ability, model_data, spawn_rate) VALUES
('Blocky Beast', 'common', 10, 10, 10, 50, 'None', '{"color": "#808080", "shape": "box"}', 0.40),
('Forest Walker', 'uncommon', 15, 12, 15, 60, 'Quick Step', '{"color": "#90EE90", "shape": "box"}', 0.25),
('Sky Glider', 'rare', 20, 15, 25, 70, 'Flight', '{"color": "#87CEEB", "shape": "box"}', 0.15),
('Crystal Golem', 'epic', 30, 25, 20, 90, 'Crystal Shield', '{"color": "#9370DB", "shape": "box"}', 0.08),
('Fire Spirit', 'legendary', 40, 30, 35, 120, 'Flame Burst', '{"color": "#FF4500", "shape": "box"}', 0.05),
('Shadow Wraith', 'mythic', 50, 35, 40, 150, 'Phase Shift', '{"color": "#4B0082", "shape": "box"}', 0.03),
('Light Bringer', 'divine', 60, 45, 45, 180, 'Holy Light', '{"color": "#FFD700", "shape": "box"}', 0.02),
('Star Weaver', 'celestial', 70, 55, 50, 220, 'Starfall', '{"color": "#00CED1", "shape": "box"}', 0.015),
('Time Keeper', 'eternal', 85, 65, 60, 280, 'Time Warp', '{"color": "#FF1493", "shape": "box"}', 0.009),
('Void Master', 'omniversal', 100, 80, 75, 350, 'Void Blast', '{"color": "rainbow", "shape": "box"}', 0.001);

-- Create indexes for performance
CREATE INDEX idx_user_creatures_user_id ON user_creatures(user_id);
CREATE INDEX idx_lobbies_status ON lobbies(status);
CREATE INDEX idx_lobby_players_lobby_id ON lobby_players(lobby_id);
CREATE INDEX idx_lobby_players_user_id ON lobby_players(user_id);
CREATE INDEX idx_trades_status ON trades(status);
CREATE INDEX idx_battles_status ON battles(status);
