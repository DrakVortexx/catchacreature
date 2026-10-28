/* ── Catch a Creature — 2D Game Engine ─────────────────── */

const RARITY_COLORS = {
  common:     '#808080', uncommon:  '#10b981', rare:      '#3b82f6',
  epic:       '#8b5cf6', legendary: '#f59e0b', mythic:    '#7c3aed',
  divine:     '#fbbf24', celestial: '#06b6d4', eternal:   '#ec4899',
  omniversal: '#f472b6'
};

const DEPTH_ZONES = [
  { minDepth:    0, rarities: ['common'] },
  { minDepth:  100, rarities: ['common','uncommon'] },
  { minDepth:  200, rarities: ['uncommon','rare'] },
  { minDepth:  350, rarities: ['rare','epic'] },
  { minDepth:  500, rarities: ['epic','legendary'] },
  { minDepth:  700, rarities: ['legendary','mythic'] },
  { minDepth:  900, rarities: ['mythic','divine'] },
  { minDepth: 1100, rarities: ['divine','celestial'] },
  { minDepth: 1300, rarities: ['celestial','eternal'] },
  { minDepth: 1500, rarities: ['eternal','omniversal'] }
];

// World constants
const TILE      = 40;   // px per tile
const WORLD_W   = 80;   // tiles wide
const WORLD_H   = 200;  // tiles tall (lobby top, forest grows down)
const LOBBY_H   = 15;   // tiles for lobby zone

class Game {
  constructor() {
    this.canvas   = document.getElementById('game-canvas');
    this.ctx      = this.canvas.getContext('2d');
    this.minimap  = document.getElementById('minimap');
    this.mmCtx    = this.minimap.getContext('2d');

    // player
    this.player = { x: WORLD_W/2 * TILE, y: 8 * TILE, w: 28, h: 28,
                    vx: 0, vy: 0, speed: 200 }; // px/sec

    // game state
    this.session       = null;   // { userId, username }
    this.socket        = null;
    this.lobbyId       = null;
    this.lobbyName     = '';
    this.otherPlayers  = new Map();
    this.creatures     = [];       // creature type catalogue from server
    this.myCreature    = null;     // { ...creature, currentHp }
    this.worldCreatures= [];       // spawned wild creatures in world
    this.nearbyCreature= null;     // closest wild creature within range
    this.collection    = [];       // user_creatures from DB
    this.isRunning     = false;
    this.lastTime      = 0;
    this.keys          = {};
    this.isFirstBattle = true;
    this.camera        = { x: 0, y: 0 };

    // world tiles: 0=grass, 1=path, 2=tree, 3=lobby-floor, 4=water
    this.tiles = this._generateWorld();

    this._bindInputs();
  }

  // ── World generation ────────────────────────────────────
  _generateWorld() {
    const tiles = Array.from({ length: WORLD_H }, () => new Array(WORLD_W).fill(0));

    // Lobby zone — paved floor
    for (let y = 0; y < LOBBY_H; y++)
      for (let x = 0; x < WORLD_W; x++)
        tiles[y][x] = 3;

    // Horizontal path splitting lobby / forest
    for (let x = 0; x < WORLD_W; x++) tiles[LOBBY_H][x] = 1;

    // Vertical main path through forest
    const mx = Math.floor(WORLD_W / 2);
    for (let y = LOBBY_H; y < WORLD_H; y++) { tiles[y][mx] = 1; tiles[y][mx+1] = 1; }

    // Trees scattered in forest
    for (let y = LOBBY_H + 1; y < WORLD_H; y++) {
      for (let x = 0; x < WORLD_W; x++) {
        if (tiles[y][x] === 1) continue;
        const rnd = Math.random();
        if (rnd < 0.22) tiles[y][x] = 2;
      }
    }

    // Lobby buildings (simple rectangular markers)
    // Store (top-left area)
    this._fillRect(tiles, 2, 2, 8, 5, 3);
    // Portal (right side)
    this._fillRect(tiles, WORLD_W - 12, 2, 8, 8, 3);
    // Training camp
    this._fillRect(tiles, WORLD_W - 12, 10, 8, 4, 3);
    // Player bases (bottom row of lobby)
    for (let i = 0; i < 7; i++) this._fillRect(tiles, 2 + i * 10, LOBBY_H - 4, 8, 3, 3);

    return tiles;
  }

  _fillRect(tiles, x, y, w, h, val) {
    for (let dy = 0; dy < h; dy++)
      for (let dx = 0; dx < w; dx++)
        if (y+dy < WORLD_H && x+dx < WORLD_W) tiles[y+dy][x+dx] = val;
  }

  // ── Input ────────────────────────────────────────────────
  _bindInputs() {
    window.addEventListener('keydown', e => {
      this.keys[e.key.toLowerCase()] = true;
      if (e.key.toLowerCase() === 'e') this._tryFight();
      if (e.key === 'Enter') {
        const ci = document.getElementById('chat-input');
        if (document.activeElement !== ci) { ci.focus(); e.preventDefault(); }
      }
    });
    window.addEventListener('keyup', e => { this.keys[e.key.toLowerCase()] = false; });

    document.getElementById('chat-input').addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        const msg = e.target.value.trim();
        if (msg && this.socket) {
          this.socket.emit('lobby_chat', { message: msg });
          e.target.value = '';
        }
        e.target.blur();
        e.preventDefault();
      }
      if (e.key === 'Escape') { e.target.blur(); }
    });

    document.getElementById('btn-fight').addEventListener('click', () => this._tryFight());
    document.getElementById('btn-store-pen').addEventListener('click', () => this._storePen());
    document.getElementById('btn-menu').addEventListener('click', () => this.stop());
  }

  _tryFight() {
    if (!this.isRunning || !this.nearbyCreature) return;
    this._startBattle(this.nearbyCreature);
  }

  // ── Start game ───────────────────────────────────────────
  start(session, lobbyId, lobbyName, creatures, collection) {
    this.session    = session;
    this.lobbyId    = lobbyId;
    this.lobbyName  = lobbyName;
    this.creatures  = creatures;
    this.collection = collection;
    this.isRunning  = true;

    this._resize();
    window.addEventListener('resize', () => this._resize());

    // Set active creature from collection (is_active=true) or first one
    const active = collection.find(uc => uc.is_active) || collection[0];
    if (active && active.creature) {
      this.myCreature = { ...active.creature, currentHp: active.current_hp ?? active.creature.hp };
    }

    // Spawn world creatures
    this._spawnWorldCreatures();

    // HUD
    this._updateHUD();
    document.getElementById('hud-username').textContent = session.username;
    document.getElementById('hud-lobby-name').textContent = lobbyName;

    this.lastTime = performance.now();
    requestAnimationFrame(t => this._loop(t));
  }

  stop() {
    this.isRunning = false;
    if (this.socket) this.socket.emit('leave_lobby');
    document.getElementById('game-screen').classList.add('hidden');
    document.getElementById('hud').classList.add('hidden');
    document.getElementById('dashboard').classList.remove('hidden');
  }

  _resize() {
    this.canvas.width  = window.innerWidth;
    this.canvas.height = window.innerHeight;
  }

  // ── Spawn wild creatures ─────────────────────────────────
  _spawnWorldCreatures() {
    this.worldCreatures = [];
    const spawnableTypes = this.creatures.filter(c => c.spawn_rate > 0);
    const count = 60 + Math.floor(Math.random() * 40);

    for (let i = 0; i < count; i++) {
      // random position in forest
      const ty = LOBBY_H + 2 + Math.floor(Math.random() * (WORLD_H - LOBBY_H - 3));
      const tx = Math.floor(Math.random() * WORLD_W);
      if (this.tiles[ty][tx] === 2) continue; // skip trees

      const depth     = (ty - LOBBY_H) * TILE;
      const zone      = [...DEPTH_ZONES].reverse().find(z => depth >= z.minDepth) || DEPTH_ZONES[0];
      const eligible  = spawnableTypes.filter(c => zone.rarities.includes(c.rarity));
      if (!eligible.length) continue;

      // weighted pick by spawn_rate
      const total = eligible.reduce((s, c) => s + c.spawn_rate, 0);
      let rnd = Math.random() * total, picked = eligible[0];
      for (const c of eligible) { rnd -= c.spawn_rate; if (rnd <= 0) { picked = c; break; } }

      this.worldCreatures.push({
        type: picked,
        x: tx * TILE + TILE / 2,
        y: ty * TILE + TILE / 2,
        hp: picked.hp,
        bobOffset: Math.random() * Math.PI * 2,
        dead: false
      });
    }
  }

  // ── Main loop ────────────────────────────────────────────
  _loop(timestamp) {
    if (!this.isRunning) return;
    const dt = Math.min((timestamp - this.lastTime) / 1000, 0.1);
    this.lastTime = timestamp;

    this._update(dt);
    this._draw(timestamp);
    requestAnimationFrame(t => this._loop(t));
  }

  _update(dt) {
    if (document.activeElement === document.getElementById('chat-input')) return;

    // Movement
    let dx = 0, dy = 0;
    if (this.keys['w'] || this.keys['arrowup'])    dy -= 1;
    if (this.keys['s'] || this.keys['arrowdown'])  dy += 1;
    if (this.keys['a'] || this.keys['arrowleft'])  dx -= 1;
    if (this.keys['d'] || this.keys['arrowright']) dx += 1;

    if (dx !== 0 && dy !== 0) { dx *= 0.707; dy *= 0.707; }

    const nx = this.player.x + dx * this.player.speed * dt;
    const ny = this.player.y + dy * this.player.speed * dt;

    // Collision check
    const half = this.player.w / 2;
    const corners = [
      [nx - half, ny - half], [nx + half, ny - half],
      [nx - half, ny + half], [nx + half, ny + half]
    ];
    const canMoveX = corners.every(([cx, cy]) => this._tileFree(cx, this.player.y));
    const canMoveY = corners.every(([cx, cy]) => this._tileFree(this.player.x, cy));

    if (canMoveX) this.player.x = Math.max(half, Math.min(WORLD_W * TILE - half, nx));
    if (canMoveY) this.player.y = Math.max(half, Math.min(WORLD_H * TILE - half, ny));

    // Camera follows player
    this.camera.x = this.player.x - this.canvas.width  / 2;
    this.camera.y = this.player.y - this.canvas.height / 2;
    this.camera.x = Math.max(0, Math.min(WORLD_W * TILE - this.canvas.width,  this.camera.x));
    this.camera.y = Math.max(0, Math.min(WORLD_H * TILE - this.canvas.height, this.camera.y));

    // Emit movement (throttle to ~20/s)
    if (!this._lastEmit || Date.now() - this._lastEmit > 50) {
      if (this.socket) this.socket.emit('player_move', { x: this.player.x, y: this.player.y });
      this._lastEmit = Date.now();
    }

    // Find nearest creature
    this.nearbyCreature = null;
    let minDist = 80;
    for (const wc of this.worldCreatures) {
      if (wc.dead) continue;
      const d = Math.hypot(wc.x - this.player.x, wc.y - this.player.y);
      if (d < minDist) { minDist = d; this.nearbyCreature = wc; }
    }
    document.getElementById('btn-fight').disabled = !this.nearbyCreature || !this.myCreature;

    // Depth display
    const depth = Math.max(0, Math.floor((this.player.y / TILE - LOBBY_H) * TILE / 10));
    document.getElementById('hud-depth').textContent = `Depth: ${depth}`;
  }

  _tileFree(wx, wy) {
    const tx = Math.floor(wx / TILE), ty = Math.floor(wy / TILE);
    if (tx < 0 || tx >= WORLD_W || ty < 0 || ty >= WORLD_H) return false;
    return this.tiles[ty][tx] !== 2; // trees block
  }

  // ── Draw ─────────────────────────────────────────────────
  _draw(timestamp) {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.save();
    ctx.translate(-this.camera.x, -this.camera.y);

    // Tiles
    const startTX = Math.max(0, Math.floor(this.camera.x / TILE));
    const endTX   = Math.min(WORLD_W, Math.ceil((this.camera.x + this.canvas.width)  / TILE) + 1);
    const startTY = Math.max(0, Math.floor(this.camera.y / TILE));
    const endTY   = Math.min(WORLD_H, Math.ceil((this.camera.y + this.canvas.height) / TILE) + 1);

    const tileColors = { 0:'#3a7d44', 1:'#b8a88a', 2:'#2d5a27', 3:'#6b7280', 4:'#2563eb' };

    for (let ty = startTY; ty < endTY; ty++) {
      for (let tx = startTX; tx < endTX; tx++) {
        const t = this.tiles[ty][tx];
        ctx.fillStyle = tileColors[t] || '#3a7d44';
        ctx.fillRect(tx * TILE, ty * TILE, TILE, TILE);

        // Grid lines (subtle)
        ctx.strokeStyle = 'rgba(0,0,0,0.08)';
        ctx.strokeRect(tx * TILE, ty * TILE, TILE, TILE);

        // Tree trunk+foliage
        if (t === 2) {
          ctx.fillStyle = '#5c3a1e';
          ctx.fillRect(tx*TILE+14, ty*TILE+22, 12, 18);
          ctx.fillStyle = '#1a5c2a';
          ctx.beginPath();
          ctx.arc(tx*TILE+TILE/2, ty*TILE+18, 18, 0, Math.PI*2);
          ctx.fill();
        }

        // Lobby building highlights
        if (t === 3) {
          ctx.fillStyle = 'rgba(255,255,255,0.04)';
          ctx.fillRect(tx*TILE, ty*TILE, TILE, TILE);
        }
      }
    }

    // Lobby zone label
    ctx.font = 'bold 22px Segoe UI';
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.textAlign = 'center';
    ctx.fillText('LOBBY', WORLD_W/2 * TILE, 6 * TILE);
    ctx.fillText('FOREST', WORLD_W/2 * TILE, (LOBBY_H + 4) * TILE);

    // Structure labels
    ctx.font = 'bold 13px Segoe UI';
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.fillText('🏪 Store', 6 * TILE, 4 * TILE);
    ctx.fillText('🌀 Portal', (WORLD_W - 8) * TILE, 6 * TILE);
    ctx.fillText('⚔️ Training', (WORLD_W - 8) * TILE, 12 * TILE);

    // Wild creatures
    for (const wc of this.worldCreatures) {
      if (wc.dead) continue;
      const bob = Math.sin(timestamp * 0.002 + wc.bobOffset) * 3;
      const isNearby = wc === this.nearbyCreature;

      ctx.save();
      if (isNearby) {
        ctx.shadowColor = RARITY_COLORS[wc.type.rarity] || '#fff';
        ctx.shadowBlur  = 16;
      }

      // Body
      ctx.fillStyle = RARITY_COLORS[wc.type.rarity] || '#fff';
      ctx.beginPath();
      ctx.roundRect(wc.x - 14, wc.y - 14 + bob, 28, 28, 6);
      ctx.fill();

      // Eyes
      ctx.fillStyle = '#fff';
      ctx.fillRect(wc.x - 8, wc.y - 6 + bob, 5, 5);
      ctx.fillRect(wc.x + 3, wc.y - 6 + bob, 5, 5);
      ctx.fillStyle = '#000';
      ctx.fillRect(wc.x - 7, wc.y - 5 + bob, 3, 3);
      ctx.fillRect(wc.x + 4, wc.y - 5 + bob, 3, 3);

      // Name label
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      const nameW = ctx.measureText(wc.type.name).width + 10;
      ctx.fillRect(wc.x - nameW/2, wc.y - 28 + bob, nameW, 16);
      ctx.fillStyle = '#fff';
      ctx.font = '11px Segoe UI';
      ctx.textAlign = 'center';
      ctx.fillText(wc.type.name, wc.x, wc.y - 16 + bob);

      if (isNearby) {
        ctx.strokeStyle = '#fff';
        ctx.lineWidth   = 2;
        ctx.setLineDash([4, 4]);
        ctx.strokeRect(wc.x - 18, wc.y - 18 + bob, 36, 36);
        ctx.setLineDash([]);
      }
      ctx.restore();
    }

    // Other players
    for (const [uid, op] of this.otherPlayers) {
      ctx.fillStyle = '#f59e0b';
      ctx.beginPath();
      ctx.roundRect(op.x - 12, op.y - 12, 24, 24, 5);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.font = '11px Segoe UI';
      ctx.textAlign = 'center';
      ctx.fillText(op.username, op.x, op.y - 16);
    }

    // Player
    ctx.fillStyle = '#6366f1';
    ctx.shadowColor = '#6366f1';
    ctx.shadowBlur  = 12;
    ctx.beginPath();
    ctx.roundRect(this.player.x - 14, this.player.y - 14, 28, 28, 6);
    ctx.fill();
    ctx.shadowBlur = 0;

    ctx.fillStyle = '#fff';
    ctx.font = 'bold 11px Segoe UI';
    ctx.textAlign = 'center';
    ctx.fillText('YOU', this.player.x, this.player.y - 18);

    // "Press E" prompt
    if (this.nearbyCreature) {
      ctx.fillStyle = 'rgba(0,0,0,0.75)';
      ctx.fillRect(this.player.x - 50, this.player.y - 52, 100, 22);
      ctx.fillStyle = '#fff';
      ctx.font      = 'bold 13px Segoe UI';
      ctx.fillText('Press E to fight!', this.player.x, this.player.y - 35);
    }

    ctx.restore();

    // Minimap
    this._drawMinimap();
  }

  _drawMinimap() {
    const mm = this.minimap, mc = this.mmCtx;
    const scaleX = mm.width  / (WORLD_W * TILE);
    const scaleY = mm.height / (WORLD_H * TILE);

    mc.fillStyle = '#0f0d24';
    mc.fillRect(0, 0, mm.width, mm.height);

    // Forest green
    mc.fillStyle = '#1a4a1a';
    mc.fillRect(0, LOBBY_H * TILE * scaleY, mm.width, mm.height);

    // Lobby
    mc.fillStyle = '#374151';
    mc.fillRect(0, 0, mm.width, LOBBY_H * TILE * scaleY);

    // Player dot
    mc.fillStyle = '#6366f1';
    mc.fillRect(this.player.x * scaleX - 2, this.player.y * scaleY - 2, 5, 5);

    // Other players
    mc.fillStyle = '#f59e0b';
    for (const [, op] of this.otherPlayers)
      mc.fillRect(op.x * scaleX - 1, op.y * scaleY - 1, 3, 3);

    // Creatures
    for (const wc of this.worldCreatures) {
      if (wc.dead) continue;
      mc.fillStyle = RARITY_COLORS[wc.type.rarity] || '#fff';
      mc.fillRect(wc.x * scaleX - 1, wc.y * scaleY - 1, 2, 2);
    }

    // Camera rect
    mc.strokeStyle = 'rgba(255,255,255,0.3)';
    mc.lineWidth   = 1;
    mc.strokeRect(
      this.camera.x * scaleX, this.camera.y * scaleY,
      this.canvas.width  * scaleX, this.canvas.height * scaleY
    );
  }

  // ── HUD update ───────────────────────────────────────────
  _updateHUD() {
    const c = this.myCreature;
    if (c) {
      document.getElementById('hud-creature-name').textContent = c.name;
      const pct = Math.max(0, c.currentHp / c.hp * 100);
      document.getElementById('hud-hp-bar').style.width   = pct + '%';
      document.getElementById('hud-hp-bar').style.background =
        pct > 50 ? 'var(--success)' : pct > 25 ? 'var(--accent)' : 'var(--danger)';
      document.getElementById('hud-hp-text').textContent = `HP: ${c.currentHp} / ${c.hp}`;
      document.getElementById('btn-store-pen').disabled  = false;
    } else {
      document.getElementById('hud-creature-name').textContent = 'No creature';
      document.getElementById('hud-hp-bar').style.width   = '0%';
      document.getElementById('hud-hp-text').textContent = '';
      document.getElementById('btn-store-pen').disabled  = true;
    }

    const count = this.lobbyId
      ? (this.otherPlayers.size + 1) : 0;
    document.getElementById('hud-player-count').textContent = `${count} / 20 players`;
  }

  // ── Store in pen ─────────────────────────────────────────
  async _storePen() {
    if (!this.myCreature) return;
    try {
      await fetch('/api/creatures/catch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: this.session.userId, creatureId: this.myCreature.id })
      });
      window.notify(`${this.myCreature.name} stored in your collection!`, 'success');
      if (this.socket) this.socket.emit('creature_caught', { creatureId: this.myCreature.id });
    } catch {
      window.notify('Failed to store creature.', 'error');
    }
  }

  // ── Battle ───────────────────────────────────────────────
  _startBattle(worldCreature) {
    if (!this.myCreature) {
      window.notify('You have no creature to battle with!', 'error');
      return;
    }

    const enemy = { ...worldCreature.type, currentHp: worldCreature.type.hp };
    this._currentEnemy      = enemy;
    this._currentWC         = worldCreature;
    this._battleFirstTurn   = this.isFirstBattle;
    this._battleOver        = false;
    this.isRunning          = false; // pause world

    // populate battle UI
    this._setBattleUI(this.myCreature, enemy);
    this._clearBattleLog();
    this._battleLog('A wild ' + enemy.name + ' appeared!', '');

    document.getElementById('battle-screen').classList.remove('hidden');
    document.getElementById('btn-attack').disabled = false;
    document.getElementById('btn-run').disabled    = false;

    document.getElementById('btn-attack').onclick = () => this._doAttack();
    document.getElementById('btn-run').onclick    = () => this._doRun();
  }

  _setBattleUI(player, enemy) {
    document.getElementById('bp-name').textContent  = player.name;
    document.getElementById('bp-hp').textContent    = `HP: ${player.currentHp} / ${player.hp}`;
    document.getElementById('bp-stats').innerHTML   =
      `ATK ${player.attack} · DEF ${player.defense} · SPD ${player.speed}<br>${player.special_ability}`;
    document.getElementById('bp-hp-bar').style.width =
      (player.currentHp / player.hp * 100) + '%';

    document.getElementById('be-name').textContent  = enemy.name;
    document.getElementById('be-hp').textContent    = `HP: ${enemy.currentHp} / ${enemy.hp}`;
    document.getElementById('be-stats').innerHTML   =
      `ATK ${enemy.attack} · DEF ${enemy.defense} · SPD ${enemy.speed}<br>${enemy.special_ability}`;
    document.getElementById('be-hp-bar').style.width =
      (enemy.currentHp / enemy.hp * 100) + '%';
  }

  _battleLog(msg, cls) {
    const p = document.createElement('p');
    if (cls) p.className = cls;
    p.textContent = msg;
    const log = document.getElementById('battle-log');
    log.appendChild(p);
    log.scrollTop = log.scrollHeight;
  }

  _clearBattleLog() {
    document.getElementById('battle-log').innerHTML = '';
  }

  _doAttack() {
    if (this._battleOver) return;
    document.getElementById('btn-attack').disabled = true;

    const player = this.myCreature;
    const enemy  = this._currentEnemy;

    // Player attacks
    const playerDmg = Math.max(1, player.attack - Math.floor(enemy.defense * 0.4)
      + Math.floor(Math.random() * 5));
    enemy.currentHp = Math.max(0, enemy.currentHp - playerDmg);
    this._battleLog(`${player.name} deals ${playerDmg} damage!`, 'good');
    document.getElementById('be-hp').textContent    = `HP: ${enemy.currentHp} / ${enemy.hp}`;
    document.getElementById('be-hp-bar').style.width = (enemy.currentHp / enemy.hp * 100) + '%';

    if (enemy.currentHp <= 0) {
      this._battleLog(`${enemy.name} fainted! You win!`, 'good');
      this._battleWin();
      return;
    }

    // Enemy attacks back
    const enemyAtk  = this._battleFirstTurn ? 1 :
      Math.max(1, enemy.attack - Math.floor(player.defense * 0.4) + Math.floor(Math.random() * 5));
    this._battleFirstTurn = false;
    this.isFirstBattle    = false;

    player.currentHp = Math.max(0, player.currentHp - enemyAtk);
    this._battleLog(`${enemy.name} deals ${enemyAtk} damage!`, 'bad');
    document.getElementById('bp-hp').textContent    = `HP: ${player.currentHp} / ${player.hp}`;
    document.getElementById('bp-hp-bar').style.width = (player.currentHp / player.hp * 100) + '%';
    this._updateHUD();

    if (player.currentHp <= 0) {
      this._battleLog(`${player.name} fainted! You lose!`, 'bad');
      this._battleLose();
      return;
    }

    document.getElementById('btn-attack').disabled = false;
  }

  _doRun() {
    this._endBattle();
    window.notify('You ran away!', 'info');
  }

  _battleWin() {
    this._battleOver = true;
    document.getElementById('btn-attack').disabled = true;
    document.getElementById('btn-run').textContent  = 'Take Creature';
    document.getElementById('btn-run').onclick = () => this._takeCreature();
  }

  _takeCreature() {
    const prev = this.myCreature ? this.myCreature.name : null;
    this.myCreature  = { ...this._currentEnemy, currentHp: this._currentEnemy.currentHp };
    if (this._currentWC) this._currentWC.dead = true;
    window.notify(`You caught ${this.myCreature.name}!${prev ? ` (replaced ${prev})` : ''}`, 'success');
    this._updateHUD();
    this._endBattle();
  }

  _battleLose() {
    this._battleOver = true;
    // Heal player creature
    this.myCreature.currentHp = this.myCreature.hp;
    this._updateHUD();
    document.getElementById('btn-attack').disabled = true;
    document.getElementById('btn-run').textContent = 'Continue';
    document.getElementById('btn-run').onclick = () => this._endBattle();
    window.notify('Defeated! Your creature was healed.', 'info');
  }

  _endBattle() {
    this._battleOver = true;
    document.getElementById('battle-screen').classList.add('hidden');
    document.getElementById('btn-run').textContent = 'Run Away';
    this.isRunning = true;
    this.lastTime  = performance.now();
    requestAnimationFrame(t => this._loop(t));
  }

  // ── Socket setup ─────────────────────────────────────────
  connectSocket(socket) {
    this.socket = socket;

    socket.on('lobby_state', ({ lobbyId, lobbyName, players }) => {
      this.lobbyId   = lobbyId;
      this.lobbyName = lobbyName;
      this.otherPlayers.clear();
      for (const p of players) this.otherPlayers.set(p.userId, p);
      this._updateHUD();
    });

    socket.on('player_joined', ({ userId, username, x, y }) => {
      this.otherPlayers.set(userId, { userId, username, x, y });
      this._updateHUD();
      this._addChat(`⚡ ${username} joined the lobby`);
    });

    socket.on('player_left', ({ userId }) => {
      const p = this.otherPlayers.get(userId);
      if (p) this._addChat(`👋 ${p.username} left`);
      this.otherPlayers.delete(userId);
      this._updateHUD();
    });

    socket.on('player_moved', ({ userId, x, y }) => {
      const p = this.otherPlayers.get(userId);
      if (p) { p.x = x; p.y = y; }
    });

    socket.on('chat_message', ({ username, message }) => {
      this._addChat(`${username}: ${message}`);
    });

    socket.on('creature_caught_broadcast', ({ username, creatureId }) => {
      const c = this.creatures.find(cr => cr.id === creatureId);
      if (c) this._addChat(`🎉 ${username} caught ${c.name}!`);
    });
  }

  _addChat(msg) {
    const el = document.createElement('div');
    el.textContent = msg;
    const box = document.getElementById('chat-messages');
    box.appendChild(el);
    box.scrollTop = box.scrollHeight;
  }
}

// expose globally
window.Game = Game;
