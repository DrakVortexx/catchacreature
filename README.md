# Catch a Creature

A 2D multiplayer creature-catching game. Explore a forest, battle wild creatures, catch them, and store them in your base.

## Stack

- **Frontend**: Vanilla JS, Canvas 2D
- **Backend**: Node.js + Express + Socket.io
- **Database**: Supabase (PostgreSQL)

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment

Copy `.env.example` to `.env` and fill in your Supabase credentials:

```bash
cp .env.example .env
```

Get your credentials from [supabase.com](https://supabase.com) → your project → **Settings → API**.

### 3. Set up the database

In your Supabase project, go to **SQL Editor** and run one of:

- **Fresh install**: paste and run `schema.sql`
- **Existing database**: paste and run `migrate.sql`

Then run this to disable Row Level Security (required for the anon key to work):

```sql
ALTER TABLE users             DISABLE ROW LEVEL SECURITY;
ALTER TABLE user_creatures    DISABLE ROW LEVEL SECURITY;
```

### 4. Start the server

```bash
npm start
```

Open `http://localhost:3000`.

## How to play

- **WASD / Arrow Keys** — move
- **Walk north (up)** — enter the forest to find creatures
- **Press E or click Fight** — battle the nearest creature
- **Take Creature** — hold it after winning (replaces your current one)
- **Walk to the base row** (bottom of lobby) — "Store in Base" button activates
- **Depth** — the further north you go, the rarer the creatures

## Rarity tiers

Common → Uncommon → Rare → Epic → Legendary → Mythic → Divine → Celestial → Eternal → Omniversal

## Notes

- Passwords are stored in plain text. Add bcrypt before a public launch.
- Sessions persist via localStorage. Logging in from a second tab/browser kicks the first session.
- Rate limiting is active on login/register: 20 attempts per 15 minutes.
