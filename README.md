# Catch a Creature - Complete Game Specification

## Game Overview
A 3D multiplayer creature battle game where players start with a starter creature, explore a forest to fight wild creatures, and collect them in pens. The game features Roblox-style blocky 3D graphics using Three.js.

## Gameplay Loop
1. **Start with Lucas da Vucas** (common starter creature)
2. **Explore the forest** - Go deeper to find rarer creatures
3. **Press E to fight** - Turn-based combat against wild creatures
4. **Win battles** - First battle is guaranteed win
5. **Collect creatures** - Winning gives you the creature (replaces your current one)
6. **Store in pens** - Use "Store in Pen" button to save creatures to your collection
7. **Hold 1 creature** - Only 1 creature can be held in your active inventory at a time

## Technical Stack

### Frontend
- **3D Engine**: Three.js (Roblox-style blocky graphics)
- **Communication**: Socket.io client
- **Styling**: CSS3
- **Build**: No build tool required (vanilla JS)

### Backend
- **Runtime**: Node.js
- **Framework**: Express.js
- **Real-time**: Socket.io
- **Database**: Supabase (PostgreSQL) - optional, in-memory storage for development
- **API**: REST + WebSocket

### File Structure
```
/
├── package.json
├── server.js
├── index.html
├── README.md
├── schema.sql
├── .env
├── .env.example
└── public/
    └── assets/
        ├── style.css
        └── game.js
```

## Core Features

### 1. 3D World System

#### World Layout
- **Lobby Area** (center):
  - **Store for equipment** (top left)
  - **Portal area** (right side)
  - **Training camp** (further right)
  - **7 player bases** (bottom row)
  - **Pathways** connecting all areas

- **Forest Area** (beyond lobby, z < -100):
  - Large 3D environment where creatures spawn
  - Players can walk/move through the forest
  - Deeper areas = rarer creatures
  - Roblox-style blocky graphics (voxel-like aesthetic)
  - Trees, rocks, and terrain

#### Player Movement
- WASD or arrow keys for movement
- Mouse for camera control (first-person)
- Jump mechanic (spacebar)
- Click to lock mouse for camera control

#### Visual Style
- Blocky, low-poly aesthetic similar to Roblox
- Bright, colorful environment
- Clear visual distinction between lobby and forest areas

### 2. Creature System

#### Starter Creature
- **Lucas da Vucas** (common) - Given to all new players
- Stats: 15 ATK, 10 DEF, 12 SPD, 60 HP
- Special Ability: Starter Boost

#### Creature Spawning
- Creatures spawn randomly throughout the forest (z < -100)
- Spawn rate increases based on player proximity
- Different creatures spawn at different depths:
  - Edge of forest: Common, Uncommon
  - Mid forest: Rare, Epic
  - Deep forest: Legendary, Mythic, Divine, Celestial, Eternal, Omniversal

#### Battle System
- **Press E** or click **Fight** to battle wild creatures
- **Turn-based combat**:
  - Your creature attacks first
  - Enemy attacks back
  - Repeat until one creature's HP reaches 0
- **First battle guaranteed win** (enemy only deals 1 damage)
- **Win = Get creature**: Winning battle gives you the creature
- **Lose = Heal**: Losing heals your creature but you don't get the enemy

#### Inventory System
- **Hold 1 creature at a time** in active inventory
- New creature replaces current one after battle
- **Store in Pen** button saves creature to collection
- HUD shows active creature's name and HP

#### Rarity System (10 Tiers)
1. **Common** - 40% spawn rate
2. **Uncommon** - 25% spawn rate
3. **Rare** - 15% spawn rate
4. **Epic** - 8% spawn rate
5. **Legendary** - 5% spawn rate
6. **Mythic** - 3% spawn rate
7. **Divine** - 2% spawn rate
8. **Celestial** - 1.5% spawn rate
9. **Eternal** - 0.9% spawn rate
10. **Omniversal** - 0.1% spawn rate

Each rarity has:
- Unique color scheme (Common = gray, Omniversal = rainbow/glowing)
- Higher base stats (Attack, Defense, Speed, HP)
- Special ability

#### Creature List
1. **Lucas da Vucas** (Common) - Starter creature, 15 ATK, 10 DEF, 12 SPD, 60 HP
2. **Blocky Beast** (Common) - 10 ATK, 10 DEF, 10 SPD, 50 HP
3. **Forest Walker** (Uncommon) - 15 ATK, 12 DEF, 15 SPD, 60 HP
4. **Sky Glider** (Rare) - 20 ATK, 15 DEF, 25 SPD, 70 HP
5. **Crystal Golem** (Epic) - 30 ATK, 25 DEF, 20 SPD, 90 HP
6. **Fire Spirit** (Legendary) - 40 ATK, 30 DEF, 35 SPD, 120 HP
7. **Shadow Wraith** (Mythic) - 50 ATK, 35 DEF, 40 SPD, 150 HP
8. **Light Bringer** (Divine) - 60 ATK, 45 DEF, 45 SPD, 180 HP
9. **Star Weaver** (Celestial) - 70 ATK, 55 DEF, 50 SPD, 220 HP
10. **Time Keeper** (Eternal) - 85 ATK, 65 DEF, 60 SPD, 280 HP
11. **Void Master** (Omniversal) - 100 ATK, 80 DEF, 75 SPD, 350 HP

### 3. Collection System

#### Viewing Collection
- Access collection from main menu
- Grid view of all stored creatures
- Filter by rarity
- Search by name
- View creature stats

#### Creature Details
- Name and rarity
- Stats (Attack, Defense, Speed, HP)
- Special ability
- Catch date and location

### 4. Multiplayer System

#### Lobby System
- **8 rooms maximum** at any time
- Each room supports up to 20 players
- Players can see room list with:
  - Room name/ID
  - Player count
  - Status

#### Joining Lobbies
- **Quick Play**: Click "Play" button to join random partially-full room
- **Server Browser**: Click "Servers" to see all rooms, select specific room

#### Lobby Features
- See other players in same room
- Chat system (text chat)
- Player location in 3D world (see other players moving)

### 5. User Account System

#### Registration/Login
- Simple username (no email required)
- Guest account option
- Starter creature (Lucas da Vucas) given on first login

#### User Profile
- Username
- Total creatures caught
- Collection saved to database (if configured)

### 6. Database Schema (Supabase/PostgreSQL) - Optional

The game currently uses in-memory storage for development. To use Supabase:

#### Tables

**users**
```sql
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  username VARCHAR(50) UNIQUE NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  battles_won INT DEFAULT 0,
  battles_lost INT DEFAULT 0,
  trades_completed INT DEFAULT 0
);
```

**creatures**
```sql
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
```

**user_creatures**
```sql
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
```

**lobbies**
```sql
CREATE TABLE lobbies (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(50),
  max_players INT DEFAULT 20,
  current_players INT DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'full', 'closed'))
);
```

**lobby_players**
```sql
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
```

### 7. API Endpoints (REST)

#### Authentication
- `POST /api/register` - Create new user account
  - Body: `{ username: string }`
  - Response: `{ userId, username }`

- `POST /api/login` - Login existing user
  - Body: `{ username: string }`
  - Response: `{ userId, username }`

#### Creatures
- `GET /api/creatures` - Get all creature types
  - Response: `[{ id, name, rarity, stats, ... }]`

- `GET /api/creatures/:id` - Get specific creature details
  - Response: `{ id, name, rarity, stats, ... }`

- `POST /api/creatures/catch` - Catch/battle a creature
  - Body: `{ userId, creatureId, location: {x, y, z} }`
  - Response: `{ userCreatureId, caughtAt }`

#### User Collection
- `GET /api/users/:userId/creatures` - Get user's creature collection
  - Response: `[{ id, creature: {...}, caughtAt, ... }]`

- `GET /api/users/:userId/stats` - Get user statistics
  - Response: `{ totalCaught, battlesWon, battlesLost, tradesCompleted, ... }`

#### Lobbies
- `GET /api/lobbies` - Get all active lobbies
  - Response: `[{ id, name, currentPlayers, maxPlayers, status }]`

- `POST /api/lobbies/:lobbyId/join` - Join a lobby
  - Body: `{ userId }`
  - Response: `{ success, message }`

- `POST /api/lobbies/:lobbyId/leave` - Leave a lobby
  - Body: `{ userId }`
  - Response: `{ success }`

### 8. Socket.io Events (Real-time)

#### Connection
- `connect` - Client connects to server
- `disconnect` - Client disconnects

#### Lobby Events
- `join_lobby` - Player joins lobby
  - Emit: `{ lobbyId, userId, username }`
  - Broadcast to lobby: `{ type: 'player_joined', user: {...} }`

- `leave_lobby` - Player leaves lobby
  - Emit: `{ lobbyId, userId }`
  - Broadcast to lobby: `{ type: 'player_left', userId }`

- `player_move` - Player moves in 3D world
  - Emit: `{ lobbyId, userId, position: {x, y, z} }`
  - Broadcast to lobby: `{ type: 'player_moved', userId, position }`

- `lobby_chat` - Send chat message
  - Emit: `{ lobbyId, userId, username, message }`
  - Broadcast to lobby: `{ type: 'chat_message', userId, username, message }`

#### Creature Events
- `creature_caught` - Player catches creature
  - Emit: `{ lobbyId, userId, creatureId }`
  - Broadcast to lobby: `{ type: 'creature_caught', userId, creatureId }`

### 9. UI/UX Design

#### Main Menu
- Title: "Catch a Creature"
- Buttons:
  - "Play" (Quick join random lobby)
  - "Servers" (Browse and select lobby)
  - "Collection" (View caught creatures)
  - "Settings" (Audio, graphics, controls)
- Login input for username

#### In-Game HUD
- Top-left: Player info + Active creature info (name, HP)
- Top-right: Lobby info
- Bottom-center: Action bar (Fight, Store in Pen, Menu)
- Bottom-left: Chat box (toggle with Enter key)

#### Battle Screen
- Your creature stats (name, HP, Attack, Defense)
- Enemy creature stats (name, HP, Attack, Defense)
- Attack button
- Run Away button

#### Collection Screen
- Grid view of creatures
- Filter by rarity
- Search bar
- Creature cards with stats

#### Settings Screen
- Audio volume sliders
- Graphics quality (Low, Medium, High)

### 10. Setup Instructions

#### Prerequisites
- Node.js (v16 or higher)
- Supabase account (free tier) - optional for development

#### Installation (In-Memory Mode - No Database)
1. Clone or create project directory
2. Run `npm install` to install dependencies:
   - express
   - socket.io
   - cors
   - dotenv

3. Start server:
   ```bash
   npm start
   ```

4. Open browser to `http://localhost:3000`

**Note**: In-memory mode doesn't require any database setup. Data is lost when server restarts.

#### Installation (With Supabase Database)

##### Step 1: Create Supabase Project
1. Go to https://supabase.com
2. Sign up for a free account
3. Click "New Project"
4. Enter project name (e.g., "catch-a-creature")
5. Enter database password (save this!)
6. Choose a region (closest to you)
7. Click "Create new project"
8. Wait for project to be set up (1-2 minutes)

##### Step 2: Get API Credentials
1. Go to your Supabase project dashboard
2. Click on "Settings" (left sidebar)
3. Click on "API"
4. Copy the **Project URL** (looks like: https://xyz.supabase.co)
5. Copy the **anon public** key (looks like: eyJhbGciOiJIUzI1NiIsInR5cCI6...)

##### Step 3: Set Up Database Tables
1. In Supabase dashboard, click on "SQL Editor" (left sidebar)
2. Click "New Query"
3. Copy the contents of `schema.sql` from this project
4. Paste it into the SQL Editor
5. Click "Run" to execute the schema
6. Verify all tables were created successfully

##### Step 4: Configure Environment Variables
1. Create a `.env` file in the project root (if it doesn't exist)
2. Add your Supabase credentials:
   ```
   PORT=3000
   SUPABASE_URL=https://your-project-id.supabase.co
   SUPABASE_ANON_KEY=your-anon-key-here
   ```
3. Replace the values with your actual credentials from Step 2

##### Step 5: Update Server Code
The server code is already set up to use Supabase when the environment variables are configured. No code changes needed.

##### Step 6: Start Server
```bash
npm start
```

##### Step 7: Test
1. Open browser to `http://localhost:3000`
2. Enter a username and login
3. You should receive Lucas da Vucas as your starter creature
4. All data will now persist in Supabase

#### Environment Variables
Create `.env` file:
```
PORT=3000
SUPABASE_URL=your_supabase_project_url
SUPABASE_ANON_KEY=your_supabase_anon_key
```

### 11. Testing Checklist

#### Core Features
- [ ] Player can move in 3D world
- [ ] Lucas da Vucas given as starter
- [ ] Creatures spawn in forest
- [ ] Player can fight creatures (E key)
- [ ] Turn-based combat works
- [ ] First battle guaranteed win
- [ ] Winning gives creature
- [ ] Store in pen works
- [ ] Only 1 creature held at a time
- [ ] Rarity system works correctly
- [ ] Deeper forest has rarer creatures

#### Multiplayer
- [ ] Player can join lobby
- [ ] Player can see other players
- [ ] Player movement syncs across clients
- [ ] Chat works
- [ ] 8 room limit enforced

#### Collection
- [ ] Collection view shows all creatures
- [ ] Filter by rarity works
- [ ] Search works
- [ ] Creature details display correctly

### 12. Future Enhancements (Not Implemented Yet)

- Trading system between players
- PvP battles
- Creature breeding
- More creature types
- Achievement system
- Leaderboards
- Daily challenges
- Creature evolution
- Custom creature creator
- Marketplace
- Guilds/clans
- Special events
- Seasonal creatures
- Mobile app version
- VR support

### 13. Known Issues/Edge Cases

- In-memory mode: Data lost on server restart
- Need to add proper validation for Supabase mode
- Handle network disconnections gracefully
- Add anti-cheat measures for multiplayer

---

## Summary for AI Implementation

This is a complete specification for a 3D multiplayer creature battle game. Key points:

1. **Use Three.js** for Roblox-style 3D graphics
2. **Battle system**: Press E to fight, turn-based combat, win to get creature
3. **Starter creature**: Lucas da Vucas (common)
4. **Inventory**: Hold 1 creature at a time, store in pens
5. **Supabase**: Optional database (in-memory storage works for development)
6. **Socket.io**: Real-time multiplayer
7. **8-room lobby system** with quick play and server browser
8. **10 rarity tiers** from Common to Omniversal
9. **Complete database schema** provided
10. **Full API endpoints** documented
11. **Socket.io events** specified

Build in phases, starting with core 3D mechanics, then multiplayer, then database integration.
