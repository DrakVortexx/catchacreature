/* ── Catch a Creature — 2D Game Engine ─────────────────── */

const RARITY_COLORS = {
  common:     '#9ca3af', uncommon:  '#10b981', rare:      '#3b82f6',
  epic:       '#8b5cf6', legendary: '#f59e0b', mythic:    '#a855f7',
  divine:     '#fbbf24', celestial: '#06b6d4', eternal:   '#ec4899',
  omniversal: '#f472b6'
};

const RARITY_GLOW = {
  common:     null,       uncommon:  '#10b981', rare:      '#3b82f6',
  epic:       '#8b5cf6',  legendary: '#f59e0b', mythic:    '#a855f7',
  divine:     '#fbbf24',  celestial: '#06b6d4', eternal:   '#ec4899',
  omniversal: '#f472b6'
};

const DEPTH_ZONES = [
  { minDepth:    0, rarities: ['common'] },
  { minDepth:  300, rarities: ['common','uncommon'] },
  { minDepth:  600, rarities: ['uncommon','rare'] },
  { minDepth: 1000, rarities: ['rare','epic'] },
  { minDepth: 1400, rarities: ['epic','legendary'] },
  { minDepth: 1900, rarities: ['legendary','mythic'] },
  { minDepth: 2400, rarities: ['mythic','divine'] },
  { minDepth: 3000, rarities: ['divine','celestial'] },
  { minDepth: 3600, rarities: ['celestial','eternal'] },
  { minDepth: 4200, rarities: ['eternal','omniversal'] }
];

const TILE    = 48;
const WORLD_W = 60;
const WORLD_H = 180;
const LOBBY_H = 14;

// Seeded RNG for deterministic world gen
function mulberry32(seed) {
  return function() {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

class Game {
  constructor() {
    this.canvas  = document.getElementById('game-canvas');
    this.ctx     = this.canvas.getContext('2d');
    this.minimap = document.getElementById('minimap');
    this.mmCtx   = this.minimap.getContext('2d');

    this.player = { x: WORLD_W / 2 * TILE, y: 7 * TILE, w: 26, h: 26, speed: 220 };

    this.session        = null;
    this.socket         = null;
    this.lobbyId        = null;
    this.lobbyName      = '';
    this.otherPlayers   = new Map();
    this.creatures      = [];
    this.myCreature     = null;
    this.worldCreatures = [];
    this.nearbyCreature = null;
    this.collection     = [];
    this.isRunning      = false;
    this.lastTime       = 0;
    this.keys           = {};
    this.isFirstBattle  = true;
    this.camera         = { x: 0, y: 0 };
    this.particles      = [];

    // tutorial state
    this.tutorialStep   = -1; // -1 = not shown, 0..N = active
    this.tutorialDone   = false;

    const rng = mulberry32(42);
    this.tiles = this._generateWorld(rng);
    this._offscreen = this._buildOffscreen();

    this._bindInputs();
  }

  // ── World generation ──────────────────────────────────────
  _generateWorld(rng) {
    const tiles = Array.from({ length: WORLD_H }, () => new Uint8Array(WORLD_W));
    // 0=grass, 1=dirt path, 2=tree, 3=stone floor, 4=water, 5=dense grass, 6=flowers

    // Lobby stone floor
    for (let y = 0; y < LOBBY_H; y++)
      for (let x = 0; x < WORLD_W; x++)
        tiles[y][x] = 3;

    // Border water row
    for (let x = 0; x < WORLD_W; x++) { tiles[LOBBY_H][x] = 4; }

    // Main vertical path through forest
    const mx = Math.floor(WORLD_W / 2);
    for (let y = LOBBY_H + 1; y < WORLD_H; y++) {
      tiles[y][mx]   = 1;
      tiles[y][mx+1] = 1;
    }

    // Horizontal branch paths every 20 tiles
    for (let py = LOBBY_H + 10; py < WORLD_H - 5; py += 20) {
      for (let x = 0; x < WORLD_W; x++) tiles[py][x] = 1;
    }

    // Forest tiles
    for (let y = LOBBY_H + 1; y < WORLD_H; y++) {
      for (let x = 0; x < WORLD_W; x++) {
        if (tiles[y][x] !== 0) continue;
        const r = rng();
        if      (r < 0.18) tiles[y][x] = 2; // tree
        else if (r < 0.26) tiles[y][x] = 5; // dense grass
        else if (r < 0.30) tiles[y][x] = 6; // flowers
      }
    }

    // Lobby structures (cleared stone)
    this._fillTiles(tiles, 2, 2, 7, 5, 3);           // Store
    this._fillTiles(tiles, WORLD_W-10, 2, 7, 7, 3);  // Portal
    this._fillTiles(tiles, WORLD_W-10, 10, 7, 3, 3); // Training
    for (let i = 0; i < 7; i++)
      this._fillTiles(tiles, 2 + i*8, LOBBY_H-4, 6, 3, 3); // Bases

    return tiles;
  }

  _fillTiles(tiles, x, y, w, h, val) {
    for (let dy = 0; dy < h; dy++)
      for (let dx = 0; dx < w; dx++)
        if (y+dy < WORLD_H && x+dx < WORLD_W) tiles[y+dy][x+dx] = val;
  }

  // Pre-render static tile layer to offscreen canvas for perf
  _buildOffscreen() {
    const oc  = document.createElement('canvas');
    oc.width  = WORLD_W * TILE;
    oc.height = WORLD_H * TILE;
    const ctx = oc.getContext('2d');
    const rng = mulberry32(99); // different seed for visual variation

    for (let ty = 0; ty < WORLD_H; ty++) {
      for (let tx = 0; tx < WORLD_W; tx++) {
        const t  = this.tiles[ty][tx];
        const px = tx * TILE, py = ty * TILE;

        // Base fill
        if      (t === 0) { ctx.fillStyle = rng() < 0.15 ? '#3d8b47' : '#4a9e52'; }
        else if (t === 1) { ctx.fillStyle = rng() < 0.2  ? '#b0916e' : '#c4a882'; }
        else if (t === 2) { ctx.fillStyle = '#3a7a40'; } // under tree
        else if (t === 3) { ctx.fillStyle = rng() < 0.1  ? '#636e7a' : '#6b7685'; }
        else if (t === 4) { ctx.fillStyle = '#1e4fa3'; }
        else if (t === 5) { ctx.fillStyle = '#3a7a40'; }
        else if (t === 6) { ctx.fillStyle = '#4a9e52'; }
        ctx.fillRect(px, py, TILE, TILE);

        // Tile-specific detail
        if (t === 1) { // path edge highlight
          ctx.fillStyle = 'rgba(255,255,255,0.06)';
          ctx.fillRect(px, py, TILE, 2);
        }
        if (t === 3) { // stone tile grout lines
          ctx.strokeStyle = 'rgba(0,0,0,0.18)';
          ctx.lineWidth   = 1;
          ctx.strokeRect(px+0.5, py+0.5, TILE-1, TILE-1);
          ctx.fillStyle = 'rgba(255,255,255,0.04)';
          ctx.fillRect(px+1, py+1, TILE/2-2, TILE/2-2);
        }
        if (t === 4) { // water shimmer
          ctx.fillStyle = 'rgba(100,180,255,0.25)';
          ctx.fillRect(px + TILE*0.1, py + TILE*0.3, TILE*0.8, TILE*0.15);
        }
        if (t === 5) { // dense grass tufts
          ctx.fillStyle = '#2a6b30';
          for (let i = 0; i < 4; i++) {
            const gx = px + 6 + i*10, gy = py + 20 + (i%2)*8;
            ctx.fillRect(gx, gy, 3, 10);
          }
        }
        if (t === 6) { // flowers
          const fc = ['#ff6b8a','#ffd166','#a8d8ff','#c3ff8a'];
          for (let i = 0; i < 3; i++) {
            ctx.fillStyle = fc[(tx*3+ty+i) % fc.length];
            ctx.beginPath();
            ctx.arc(px+10+i*14, py+24+((i+tx)%2)*8, 4, 0, Math.PI*2);
            ctx.fill();
          }
        }

        // Trees drawn on top
        if (t === 2) {
          // Shadow
          ctx.fillStyle = 'rgba(0,0,0,0.2)';
          ctx.beginPath();
          ctx.ellipse(px+TILE/2+4, py+TILE-6, 14, 6, 0, 0, Math.PI*2);
          ctx.fill();
          // Trunk
          ctx.fillStyle = '#6b3a1f';
          ctx.fillRect(px+TILE/2-5, py+TILE-20, 10, 20);
          // Canopy layers
          ctx.fillStyle = '#1d5c25';
          ctx.beginPath();
          ctx.arc(px+TILE/2, py+TILE-28, 18, 0, Math.PI*2);
          ctx.fill();
          ctx.fillStyle = '#267a30';
          ctx.beginPath();
          ctx.arc(px+TILE/2-4, py+TILE-34, 14, 0, Math.PI*2);
          ctx.fill();
          ctx.fillStyle = '#2e9438';
          ctx.beginPath();
          ctx.arc(px+TILE/2+2, py+TILE-38, 11, 0, Math.PI*2);
          ctx.fill();
          // Highlight
          ctx.fillStyle = 'rgba(255,255,255,0.08)';
          ctx.beginPath();
          ctx.arc(px+TILE/2-6, py+TILE-42, 6, 0, Math.PI*2);
          ctx.fill();
        }
      }
    }

    // Zone depth fog — lobby is bright, deep forest is dark
    for (let ty = LOBBY_H + 1; ty < WORLD_H; ty++) {
      const depth  = (ty - LOBBY_H) / (WORLD_H - LOBBY_H);
      const alpha  = Math.min(0.55, depth * 0.7);
      ctx.fillStyle = `rgba(0,10,5,${alpha})`;
      ctx.fillRect(0, ty * TILE, WORLD_W * TILE, TILE);
    }

    return oc;
  }

  // ── Input ─────────────────────────────────────────────────
  _bindInputs() {
    window.addEventListener('keydown', e => {
      this.keys[e.key.toLowerCase()] = true;
      if (e.key.toLowerCase() === 'e' && this.tutorialStep === -1) this._tryFight();
      if (e.key === 'Enter') {
        const ci = document.getElementById('chat-input');
        if (document.activeElement !== ci) { ci.focus(); e.preventDefault(); }
      }
    });
    window.addEventListener('keyup', e => { this.keys[e.key.toLowerCase()] = false; });

    document.getElementById('chat-input').addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        const msg = e.target.value.trim();
        if (msg && this.socket) { this.socket.emit('lobby_chat', { message: msg }); }
        e.target.value = '';
        e.target.blur();
        e.preventDefault();
      }
      if (e.key === 'Escape') e.target.blur();
    });

    document.getElementById('btn-fight').addEventListener('click', () => {
      if (this.tutorialStep >= 0) this._advanceTutorial();
      else this._tryFight();
    });
    document.getElementById('btn-store-pen').addEventListener('click', () => this._storePen());
    document.getElementById('btn-menu').addEventListener('click', () => this.stop());
    document.getElementById('btn-view-pen').addEventListener('click', () => window.openPenModal());
  }

  _tryFight() {
    if (!this.isRunning || !this.nearbyCreature) return;
    this._startBattle(this.nearbyCreature);
  }

  // ── Start ─────────────────────────────────────────────────
  start(session, lobbyId, lobbyName, creatures, collection, isNewUser) {
    this.session    = session;
    this.lobbyId    = lobbyId;
    this.lobbyName  = lobbyName;
    this.creatures  = creatures;
    this.collection = collection;
    this.isRunning  = true;

    this._resize();
    window.addEventListener('resize', () => this._resize());

    // Find active creature — fallback to Lucas da Vucas if collection empty
    const active = collection.find(uc => uc.is_active) || collection[0];
    if (active && active.creature) {
      this.myCreature = { ...active.creature, currentHp: active.current_hp ?? active.creature.hp };
    } else {
      // Local fallback starter so the game is still playable
      const lucas = creatures.find(c => c.id === 'c0');
      if (lucas) this.myCreature = { ...lucas, currentHp: lucas.hp };
    }

    this._spawnWorldCreatures();
    this._updateHUD();

    document.getElementById('hud-username').textContent   = session.username;
    document.getElementById('hud-lobby-name').textContent = lobbyName;

    this.lastTime = performance.now();
    requestAnimationFrame(t => this._loop(t));

    // Show tutorial for new users
    if (isNewUser) {
      setTimeout(() => this._showTutorial(), 600);
    }
  }

  stop() {
    this.isRunning = false;
    if (this.socket) this.socket.emit('leave_lobby');
    document.getElementById('game-screen').classList.add('hidden');
    document.getElementById('hud').classList.add('hidden');
    // Re-create game instance next time so world is fresh
    window.gameInst = null;
    window.openDashboard();
  }

  _resize() {
    this.canvas.width  = window.innerWidth;
    this.canvas.height = window.innerHeight;
  }

  // ── Tutorial ──────────────────────────────────────────────
  _showTutorial() {
    this.tutorialStep = 0;
    this._renderTutorial();
  }

  _advanceTutorial() {
    this.tutorialStep++;
    const steps = this._tutorialSteps();
    if (this.tutorialStep >= steps.length) {
      this.tutorialStep  = -1;
      this.tutorialDone  = true;
      document.getElementById('tutorial-overlay').classList.add('hidden');
    } else {
      this._renderTutorial();
    }
  }

  _tutorialSteps() {
    return [
      { title: '👋 Welcome!',
        body:  `You are <b>${this.session.username}</b>!<br><br>Your starter creature is <b style="color:#4169E1">Lucas da Vucas</b>.<br>It's in your active slot, ready to battle.` },
      { title: '🕹️ Moving Around',
        body:  'Use <b>WASD</b> or <b>Arrow Keys</b> to move.<br><br>The <b>Lobby</b> is at the top. Head <b>south</b> into the forest to find wild creatures.' },
      { title: '⚔️ Battling Creatures',
        body:  'Walk up to a glowing creature in the forest.<br><br>Press <b>E</b> or click <b>Fight</b> to start a turn-based battle.<br><br>Your first battle is <b>guaranteed to win!</b>' },
      { title: '🎒 Catching & Pen',
        body:  'After winning a battle, click <b>"Take Creature"</b> to hold it.<br><br>You can only hold <b>1 creature</b> at a time.<br><br>Click <b>"Store in Pen"</b> to save it to your permanent collection.' },
      { title: '📦 Your Pen',
        body:  'Your <b>Pen</b> stores all collected creatures permanently.<br><br>Click the <b>🐾 Pen</b> button in the HUD (or from the dashboard) to view them anytime.<br><br>Filter by rarity, search by name.' },
      { title: '🌲 Forest Depth',
        body:  'The deeper into the forest you go, the <b>rarer</b> the creatures.<br><br><span style="color:#808080">■ Common</span> → surface<br><span style="color:#10b981">■ Uncommon</span> → deeper<br><span style="color:#f59e0b">■ Legendary</span> → very deep<br><span style="color:#f472b6">■ Omniversal</span> → extreme depth' },
      { title: '✅ You\'re Ready!',
        body:  'Good luck, Trainer!<br><br>Press <b>Enter</b> to chat with other players.<br>Click <b>Menu</b> to return to the dashboard.<br><br>Go catch \'em all!' }
    ];
  }

  _renderTutorial() {
    const steps = this._tutorialSteps();
    const step  = steps[this.tutorialStep];
    const ov    = document.getElementById('tutorial-overlay');
    const total = steps.length;

    document.getElementById('tut-title').textContent = step.title;
    document.getElementById('tut-body').innerHTML    = step.body;
    document.getElementById('tut-step').textContent  = `${this.tutorialStep + 1} / ${total}`;
    document.getElementById('tut-next').textContent  =
      this.tutorialStep === total - 1 ? 'Let\'s Go! 🎮' : 'Next →';

    ov.classList.remove('hidden');
  }

  // ── Spawn world creatures ─────────────────────────────────
  _spawnWorldCreatures() {
    this.worldCreatures = [];
    const rng = mulberry32(Date.now() & 0xFFFF);
    const spawnables = this.creatures.filter(c => c.spawn_rate > 0);
    const count = 80 + Math.floor(rng() * 40);

    for (let i = 0; i < count; i++) {
      const ty = LOBBY_H + 2 + Math.floor(rng() * (WORLD_H - LOBBY_H - 4));
      const tx = Math.floor(rng() * WORLD_W);
      const t  = this.tiles[ty][tx];
      if (t === 2 || t === 1 || t === 4) continue;

      const depth    = (ty - LOBBY_H) * TILE;
      const zone     = [...DEPTH_ZONES].reverse().find(z => depth >= z.minDepth) || DEPTH_ZONES[0];
      const eligible = spawnables.filter(c => zone.rarities.includes(c.rarity));
      if (!eligible.length) continue;

      const total = eligible.reduce((s, c) => s + c.spawn_rate, 0);
      let r = rng() * total, picked = eligible[0];
      for (const c of eligible) { r -= c.spawn_rate; if (r <= 0) { picked = c; break; } }

      this.worldCreatures.push({
        type: picked, x: tx*TILE + TILE/2, y: ty*TILE + TILE/2,
        bobOffset: rng() * Math.PI * 2, dead: false,
        wander: { dx: 0, dy: 0, timer: rng() * 2 }
      });
    }
  }

  // ── Main loop ─────────────────────────────────────────────
  _loop(ts) {
    if (!this.isRunning) return;
    const dt = Math.min((ts - this.lastTime) / 1000, 0.08);
    this.lastTime = ts;
    this._update(dt, ts);
    this._draw(ts);
    requestAnimationFrame(t => this._loop(t));
  }

  _update(dt, ts) {
    // Block movement during tutorial or chat
    const blocking = this.tutorialStep >= 0 ||
      document.activeElement === document.getElementById('chat-input');

    if (!blocking) {
      let dx = 0, dy = 0;
      if (this.keys['w'] || this.keys['arrowup'])    dy -= 1;
      if (this.keys['s'] || this.keys['arrowdown'])  dy += 1;
      if (this.keys['a'] || this.keys['arrowleft'])  dx -= 1;
      if (this.keys['d'] || this.keys['arrowright']) dx += 1;
      if (dx && dy) { dx *= 0.707; dy *= 0.707; }

      const nx = this.player.x + dx * this.player.speed * dt;
      const ny = this.player.y + dy * this.player.speed * dt;
      const h  = this.player.w / 2 - 2;

      if (this._walkable(nx - h, this.player.y) && this._walkable(nx + h, this.player.y))
        this.player.x = Math.max(h, Math.min(WORLD_W*TILE - h, nx));
      if (this._walkable(this.player.x, ny - h) && this._walkable(this.player.x, ny + h))
        this.player.y = Math.max(h, Math.min(WORLD_H*TILE - h, ny));
    }

    // Camera
    this.camera.x = Math.max(0, Math.min(WORLD_W*TILE - this.canvas.width,  this.player.x - this.canvas.width/2));
    this.camera.y = Math.max(0, Math.min(WORLD_H*TILE - this.canvas.height, this.player.y - this.canvas.height/2));

    // Emit movement
    if (!this._lastEmit || Date.now() - this._lastEmit > 50) {
      if (this.socket) this.socket.emit('player_move', { x: this.player.x, y: this.player.y });
      this._lastEmit = Date.now();
    }

    // Creature wander
    for (const wc of this.worldCreatures) {
      if (wc.dead) continue;
      wc.wander.timer -= dt;
      if (wc.wander.timer <= 0) {
        const a = Math.random() * Math.PI * 2;
        wc.wander.dx = Math.cos(a) * 20;
        wc.wander.dy = Math.sin(a) * 20;
        wc.wander.timer = 1.5 + Math.random() * 2;
      }
      const nx = wc.x + wc.wander.dx * dt;
      const ny = wc.y + wc.wander.dy * dt;
      if (this._walkable(nx, wc.y)) wc.x = nx;
      if (this._walkable(wc.x, ny)) wc.y = ny;
    }

    // Particles
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.x += p.vx * dt; p.y += p.vy * dt; p.life -= dt;
      p.vy += 40 * dt;
      if (p.life <= 0) this.particles.splice(i, 1);
    }

    // Nearest creature detection
    this.nearbyCreature = null;
    let minD = 72;
    for (const wc of this.worldCreatures) {
      if (wc.dead) continue;
      const d = Math.hypot(wc.x - this.player.x, wc.y - this.player.y);
      if (d < minD) { minD = d; this.nearbyCreature = wc; }
    }
    document.getElementById('btn-fight').disabled = !this.nearbyCreature || !this.myCreature;

    const depth = Math.max(0, Math.floor(((this.player.y / TILE) - LOBBY_H) * 5));
    document.getElementById('hud-depth').textContent = `Depth: ${depth}m`;
  }

  _walkable(wx, wy) {
    const tx = Math.floor(wx / TILE), ty = Math.floor(wy / TILE);
    if (tx < 0 || tx >= WORLD_W || ty < 0 || ty >= WORLD_H) return false;
    const t = this.tiles[ty][tx];
    return t !== 2 && t !== 4;
  }

  // ── Draw ──────────────────────────────────────────────────
  _draw(ts) {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.save();
    ctx.translate(-this.camera.x, -this.camera.y);

    // Static tile layer from offscreen
    ctx.drawImage(this._offscreen, this.camera.x, this.camera.y,
      this.canvas.width, this.canvas.height,
      this.camera.x, this.camera.y,
      this.canvas.width, this.canvas.height);

    // Animated water ripple over water tiles
    const t4startY = LOBBY_H * TILE, t4endY = (LOBBY_H + 1) * TILE;
    if (t4startY < this.camera.y + this.canvas.height && t4endY > this.camera.y) {
      ctx.fillStyle = `rgba(100,200,255,${0.12 + Math.sin(ts * 0.003) * 0.06})`;
      ctx.fillRect(0, t4startY, WORLD_W * TILE, TILE);
    }

    // Zone depth overlay pulsing (subtle breathing effect in deep forest)
    const playerDepth = Math.max(0, (this.player.y / TILE - LOBBY_H) / (WORLD_H - LOBBY_H));
    if (playerDepth > 0.3) {
      ctx.fillStyle = `rgba(0,0,20,${Math.sin(ts * 0.001) * 0.04 * playerDepth})`;
      ctx.fillRect(this.camera.x, this.camera.y, this.canvas.width, this.canvas.height);
    }

    // Structure signs
    this._drawSign(ctx, 5 * TILE, 4 * TILE, '🏪', 'Store');
    this._drawSign(ctx, (WORLD_W - 6) * TILE, 5 * TILE, '🌀', 'Portal');
    this._drawSign(ctx, (WORLD_W - 6) * TILE, 11 * TILE, '⚔️', 'Training');
    this._drawSign(ctx, Math.floor(WORLD_W/2) * TILE, (LOBBY_H - 2) * TILE, '🌲', 'Forest →');

    // Particles
    for (const p of this.particles) {
      ctx.globalAlpha = Math.max(0, p.life / p.maxLife);
      ctx.fillStyle   = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // Wild creatures
    for (const wc of this.worldCreatures) {
      if (wc.dead) continue;
      const bob      = Math.sin(ts * 0.0025 + wc.bobOffset) * 3;
      const isNear   = wc === this.nearbyCreature;
      const glow     = RARITY_GLOW[wc.type.rarity];
      const col      = RARITY_COLORS[wc.type.rarity];
      const cx = wc.x, cy = wc.y + bob;

      ctx.save();

      // Glow halo for rare+
      if (glow) {
        const pulse = 0.5 + Math.sin(ts * 0.004 + wc.bobOffset) * 0.5;
        ctx.shadowColor = glow;
        ctx.shadowBlur  = isNear ? 30 + pulse * 10 : 12 + pulse * 6;
      }

      this._drawCreatureSprite(ctx, cx, cy, wc.type.rarity, col, ts + wc.bobOffset * 1000);
      ctx.shadowBlur = 0;

      // Name tag
      ctx.font = 'bold 11px "Segoe UI"';
      const tw = ctx.measureText(wc.type.name).width;
      ctx.fillStyle = 'rgba(0,0,0,0.65)';
      ctx.beginPath();
      ctx.roundRect(cx - tw/2 - 6, cy - 38, tw + 12, 17, 4);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.textAlign  = 'center';
      ctx.textBaseline = 'top';
      ctx.fillText(wc.type.name, cx, cy - 36);

      // Rarity dot
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.arc(cx + tw/2 + 1, cy - 30, 3, 0, Math.PI*2);
      ctx.fill();

      // Selection ring
      if (isNear) {
        ctx.strokeStyle = '#fff';
        ctx.lineWidth   = 2;
        ctx.setLineDash([5, 4]);
        ctx.lineDashOffset = -ts * 0.03;
        ctx.beginPath();
        ctx.arc(cx, cy, 22, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      ctx.restore();
    }

    // Other players
    for (const [, op] of this.otherPlayers) {
      ctx.save();
      ctx.shadowColor = '#f59e0b';
      ctx.shadowBlur  = 10;
      ctx.fillStyle   = '#f59e0b';
      ctx.beginPath();
      ctx.roundRect(op.x - 13, op.y - 13, 26, 26, 6);
      ctx.fill();
      ctx.shadowBlur = 0;
      // hat
      ctx.fillStyle = '#d97706';
      ctx.fillRect(op.x - 10, op.y - 17, 20, 5);
      ctx.fillRect(op.x - 7, op.y - 22, 14, 6);
      ctx.restore();
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 10px "Segoe UI"';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.fillText(op.username.substring(0, 10), op.x, op.y - 20);
    }

    // Player character
    this._drawPlayer(ctx, this.player.x, this.player.y, ts);

    // "Press E" prompt
    if (this.nearbyCreature) {
      const px = this.player.x, py = this.player.y;
      ctx.fillStyle = 'rgba(0,0,0,0.8)';
      ctx.beginPath();
      ctx.roundRect(px - 56, py - 58, 112, 22, 6);
      ctx.fill();
      ctx.fillStyle   = '#fde68a';
      ctx.font        = 'bold 13px "Segoe UI"';
      ctx.textAlign   = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('⚔ Press E to Fight!', px, py - 47);
    }

    ctx.restore();

    this._drawMinimap();
  }

  _drawCreatureSprite(ctx, cx, cy, rarity, col, ts) {
    ctx.fillStyle = col;
    // Each rarity gets a distinct silhouette
    switch (rarity) {
      case 'common': // chunky square
        ctx.beginPath();
        ctx.roundRect(cx-13, cy-13, 26, 26, 4);
        ctx.fill();
        break;
      case 'uncommon': // rounded
        ctx.beginPath();
        ctx.arc(cx, cy, 13, 0, Math.PI*2);
        ctx.fill();
        break;
      case 'rare': // diamond
        ctx.save(); ctx.translate(cx, cy); ctx.rotate(Math.PI/4);
        ctx.beginPath(); ctx.roundRect(-10,-10,20,20,3); ctx.fill();
        ctx.restore();
        break;
      case 'epic': // star-ish pentagon
        this._drawStar(ctx, cx, cy, 5, 14, 7);
        break;
      case 'legendary': // flame-like
        ctx.beginPath();
        ctx.moveTo(cx, cy-16); ctx.quadraticCurveTo(cx+16, cy-6, cx+10, cy+12);
        ctx.quadraticCurveTo(cx, cy+6, cx-10, cy+12);
        ctx.quadraticCurveTo(cx-16, cy-6, cx, cy-16);
        ctx.fill();
        break;
      case 'mythic': // crescent / ghost
        ctx.beginPath(); ctx.arc(cx, cy, 14, 0, Math.PI*2); ctx.fill();
        ctx.fillStyle = '#1a1a2e';
        ctx.beginPath(); ctx.arc(cx+5, cy-3, 11, 0, Math.PI*2); ctx.fill();
        ctx.fillStyle = col;
        break;
      case 'divine': // eight-pointed star
        this._drawStar(ctx, cx, cy, 8, 15, 7);
        break;
      case 'celestial': // ring + core
        ctx.beginPath(); ctx.arc(cx, cy, 14, 0, Math.PI*2); ctx.fill();
        ctx.fillStyle = 'rgba(0,0,0,0.4)';
        ctx.beginPath(); ctx.arc(cx, cy, 8, 0, Math.PI*2); ctx.fill();
        ctx.fillStyle = col;
        ctx.beginPath(); ctx.arc(cx, cy, 4, 0, Math.PI*2); ctx.fill();
        break;
      case 'eternal': // cross / X
        this._drawStar(ctx, cx, cy, 4, 16, 5);
        break;
      case 'omniversal': { // rainbow swirl
        const gr = ctx.createRadialGradient(cx, cy, 0, cx, cy, 16);
        const hue = (ts * 0.05) % 360;
        gr.addColorStop(0,   `hsl(${hue},100%,80%)`);
        gr.addColorStop(0.5, `hsl(${(hue+120)%360},100%,60%)`);
        gr.addColorStop(1,   `hsl(${(hue+240)%360},100%,50%)`);
        ctx.fillStyle = gr;
        this._drawStar(ctx, cx, cy, 6, 16, 8);
        ctx.fillStyle = col;
        break;
      }
    }

    // Eyes (all creatures)
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.ellipse(cx-5, cy-3, 3, 3.5, 0, 0, Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(cx+5, cy-3, 3, 3.5, 0, 0, Math.PI*2); ctx.fill();
    ctx.fillStyle = '#111';
    ctx.beginPath(); ctx.arc(cx-4.5, cy-3, 1.8, 0, Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.arc(cx+5.5, cy-3, 1.8, 0, Math.PI*2); ctx.fill();
    // Shine
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(cx-3.8, cy-4, 0.8, 0, Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.arc(cx+6.2, cy-4, 0.8, 0, Math.PI*2); ctx.fill();
  }

  _drawStar(ctx, cx, cy, points, outer, inner) {
    ctx.beginPath();
    for (let i = 0; i < points * 2; i++) {
      const r   = i % 2 === 0 ? outer : inner;
      const ang = (i * Math.PI / points) - Math.PI / 2;
      i === 0 ? ctx.moveTo(cx + r*Math.cos(ang), cy + r*Math.sin(ang))
              : ctx.lineTo(cx + r*Math.cos(ang), cy + r*Math.sin(ang));
    }
    ctx.closePath(); ctx.fill();
  }

  _drawPlayer(ctx, px, py, ts) {
    ctx.save();
    ctx.shadowColor = '#6366f1';
    ctx.shadowBlur  = 16;

    // Body
    ctx.fillStyle = '#6366f1';
    ctx.beginPath();
    ctx.roundRect(px-13, py-11, 26, 24, 5);
    ctx.fill();

    // Head
    ctx.fillStyle = '#fbbf24';
    ctx.beginPath();
    ctx.arc(px, py-18, 10, 0, Math.PI*2);
    ctx.fill();

    // Hat
    ctx.fillStyle = '#4f46e5';
    ctx.fillRect(px-11, py-27, 22, 5);
    ctx.fillRect(px-8, py-34, 16, 8);

    // Eyes
    ctx.fillStyle = '#111';
    ctx.beginPath(); ctx.arc(px-4, py-19, 2, 0, Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.arc(px+4, py-19, 2, 0, Math.PI*2); ctx.fill();

    // Legs (animated walk)
    const walk = Math.sin(ts * 0.01) * 4;
    ctx.fillStyle = '#4f46e5';
    ctx.fillRect(px-9, py+13, 8, 8 + walk);
    ctx.fillRect(px+1,  py+13, 8, 8 - walk);

    ctx.shadowBlur = 0;
    ctx.restore();

    // Name
    ctx.fillStyle   = '#fff';
    ctx.font        = 'bold 11px "Segoe UI"';
    ctx.textAlign   = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillText(this.session?.username?.substring(0,10) || 'YOU', px, py - 37);
  }

  _drawSign(ctx, x, y, icon, label) {
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.beginPath();
    ctx.roundRect(x - 36, y - 14, 72, 24, 6);
    ctx.fill();
    ctx.font      = '13px "Segoe UI"';
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`${icon} ${label}`, x, y - 2);
    ctx.restore();
  }

  _drawMinimap() {
    const mm = this.minimap, mc = this.mmCtx;
    const sw = mm.width / (WORLD_W * TILE), sh = mm.height / (WORLD_H * TILE);

    // Background
    mc.fillStyle = '#0a1628'; mc.fillRect(0, 0, mm.width, mm.height);
    mc.fillStyle = '#4a9e52';
    mc.fillRect(0, LOBBY_H*TILE*sh, mm.width, mm.height - LOBBY_H*TILE*sh);
    mc.fillStyle = '#5a6475';
    mc.fillRect(0, 0, mm.width, LOBBY_H*TILE*sh);

    // Water line
    mc.fillStyle = '#1e4fa3';
    mc.fillRect(0, LOBBY_H*TILE*sh, mm.width, 2);

    // Paths
    mc.fillStyle = '#c4a882';
    for (let ty = 0; ty < WORLD_H; ty++)
      for (let tx = 0; tx < WORLD_W; tx++)
        if (this.tiles[ty][tx] === 1) {
          mc.fillRect(tx*TILE*sw, ty*TILE*sh, Math.max(1, TILE*sw), Math.max(1, TILE*sh));
        }

    // Creatures
    for (const wc of this.worldCreatures) {
      if (wc.dead) continue;
      mc.fillStyle = RARITY_COLORS[wc.type.rarity];
      mc.fillRect(wc.x*sw-1, wc.y*sh-1, 3, 3);
    }

    // Other players
    mc.fillStyle = '#f59e0b';
    for (const [, op] of this.otherPlayers)
      mc.fillRect(op.x*sw-2, op.y*sh-2, 4, 4);

    // Player
    mc.fillStyle = '#6366f1';
    mc.shadowColor = '#6366f1'; mc.shadowBlur = 4;
    mc.fillRect(this.player.x*sw-3, this.player.y*sh-3, 6, 6);
    mc.shadowBlur = 0;

    // Viewport rect
    mc.strokeStyle = 'rgba(255,255,255,0.4)'; mc.lineWidth = 1;
    mc.strokeRect(this.camera.x*sw, this.camera.y*sh,
      this.canvas.width*sw, this.canvas.height*sh);
  }

  // ── HUD ───────────────────────────────────────────────────
  _updateHUD() {
    const c = this.myCreature;
    if (c) {
      document.getElementById('hud-creature-name').textContent = c.name;
      const pct = Math.max(0, c.currentHp / c.hp * 100);
      const bar = document.getElementById('hud-hp-bar');
      bar.style.width      = pct + '%';
      bar.style.background = pct > 50 ? '#10b981' : pct > 25 ? '#f59e0b' : '#ef4444';
      document.getElementById('hud-hp-text').textContent = `HP: ${c.currentHp} / ${c.hp}`;
      document.getElementById('btn-store-pen').disabled  = false;
    } else {
      document.getElementById('hud-creature-name').textContent = 'No creature';
      document.getElementById('hud-hp-bar').style.width = '0%';
      document.getElementById('hud-hp-text').textContent = '';
      document.getElementById('btn-store-pen').disabled  = true;
    }
    document.getElementById('hud-player-count').textContent =
      `${this.otherPlayers.size + 1} / 20 players`;
  }

  // ── Pen / Store ───────────────────────────────────────────
  async _storePen() {
    if (!this.myCreature) return;
    try {
      const res = await fetch('/api/creatures/catch', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: this.session.userId, creatureId: this.myCreature.id })
      });
      if (!res.ok) throw new Error();
      window.notify(`${this.myCreature.name} stored in your pen!`, 'success');
      if (this.socket) this.socket.emit('creature_caught', { creatureId: this.myCreature.id });
      this._spawnParticles(this.player.x, this.player.y, RARITY_COLORS[this.myCreature.rarity]);
      // refresh pen count
      window.refreshPenCount && window.refreshPenCount();
    } catch {
      window.notify('Failed to store creature. Check DB permissions.', 'error');
    }
  }

  _spawnParticles(x, y, color) {
    for (let i = 0; i < 18; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 60 + Math.random() * 120;
      this.particles.push({
        x, y, vx: Math.cos(angle)*speed, vy: Math.sin(angle)*speed - 40,
        r: 3 + Math.random()*4, color, life: 0.6 + Math.random()*0.4,
        maxLife: 1
      });
    }
  }

  // ── Battle ────────────────────────────────────────────────
  _startBattle(wc) {
    if (!this.myCreature) { window.notify('No creature! Check your pen.', 'error'); return; }
    const enemy = { ...wc.type, currentHp: wc.type.hp };
    this._currentEnemy   = enemy;
    this._currentWC      = wc;
    this._firstTurn      = this.isFirstBattle;
    this._battleOver     = false;
    this.isRunning       = false;

    this._setBattleUI(this.myCreature, enemy);
    this._clearLog();
    this._log(`A wild ${enemy.name} appeared!`);

    document.getElementById('battle-screen').classList.remove('hidden');
    document.getElementById('btn-attack').disabled = false;
    document.getElementById('btn-run').textContent = 'Run Away';
    document.getElementById('btn-attack').onclick  = () => this._doAttack();
    document.getElementById('btn-run').onclick     = () => this._doRun();
  }

  _setBattleUI(p, e) {
    const setR = (id, pct) => {
      const el = document.getElementById(id);
      el.style.width      = pct + '%';
      el.style.background = pct > 50 ? '#10b981' : pct > 25 ? '#f59e0b' : '#ef4444';
    };
    document.getElementById('bp-name').textContent  = p.name;
    document.getElementById('bp-hp').textContent    = `HP: ${p.currentHp} / ${p.hp}`;
    document.getElementById('bp-stats').innerHTML   = `ATK ${p.attack} · DEF ${p.defense} · SPD ${p.speed}<br><em>${p.special_ability}</em>`;
    setR('bp-hp-bar', p.currentHp / p.hp * 100);

    document.getElementById('be-name').textContent  = e.name;
    document.getElementById('be-hp').textContent    = `HP: ${e.currentHp} / ${e.hp}`;
    document.getElementById('be-stats').innerHTML   = `ATK ${e.attack} · DEF ${e.defense} · SPD ${e.speed}<br><em>${e.special_ability}</em>`;
    setR('be-hp-bar', e.currentHp / e.hp * 100);

    // Creature color badges
    const bpCol = RARITY_COLORS[p.rarity] || '#fff';
    const beCol = RARITY_COLORS[e.rarity] || '#fff';
    document.getElementById('bp-name').style.color = bpCol;
    document.getElementById('be-name').style.color = beCol;
  }

  _log(msg, cls) {
    const p = document.createElement('p');
    if (cls) p.className = cls;
    p.textContent = msg;
    const log = document.getElementById('battle-log');
    log.appendChild(p);
    log.scrollTop = log.scrollHeight;
  }
  _clearLog() { document.getElementById('battle-log').innerHTML = ''; }

  _doAttack() {
    if (this._battleOver) return;
    document.getElementById('btn-attack').disabled = true;
    const pl = this.myCreature, en = this._currentEnemy;

    const pdmg = Math.max(1, pl.attack - Math.floor(en.defense*0.4) + Math.floor(Math.random()*6));
    en.currentHp = Math.max(0, en.currentHp - pdmg);
    this._log(`${pl.name} attacks for ${pdmg} damage!`, 'good');

    const setR = (id, pct) => {
      const el = document.getElementById(id);
      el.style.width = Math.max(0,pct) + '%';
      el.style.background = pct > 50 ? '#10b981' : pct > 25 ? '#f59e0b' : '#ef4444';
    };
    setR('be-hp-bar', en.currentHp / en.hp * 100);
    document.getElementById('be-hp').textContent = `HP: ${en.currentHp} / ${en.hp}`;

    if (en.currentHp <= 0) { this._log(`${en.name} fainted! You win! 🎉`, 'good'); this._winBattle(); return; }

    const edmg = this._firstTurn ? 1
      : Math.max(1, en.attack - Math.floor(pl.defense*0.4) + Math.floor(Math.random()*6));
    this._firstTurn    = false;
    this.isFirstBattle = false;

    pl.currentHp = Math.max(0, pl.currentHp - edmg);
    this._log(`${en.name} attacks for ${edmg} damage!`, 'bad');
    setR('bp-hp-bar', pl.currentHp / pl.hp * 100);
    document.getElementById('bp-hp').textContent = `HP: ${pl.currentHp} / ${pl.hp}`;
    this._updateHUD();

    if (pl.currentHp <= 0) { this._log(`${pl.name} fainted! You lose.`, 'bad'); this._loseBattle(); return; }
    document.getElementById('btn-attack').disabled = false;
  }

  _doRun() { this._endBattle(); window.notify('Got away safely!', 'info'); }

  _winBattle() {
    this._battleOver = true;
    document.getElementById('btn-attack').disabled = true;
    document.getElementById('btn-run').textContent = '✅ Take Creature';
    document.getElementById('btn-run').onclick = () => {
      const prev = this.myCreature?.name;
      this.myCreature = { ...this._currentEnemy, currentHp: this._currentEnemy.currentHp };
      if (this._currentWC) this._currentWC.dead = true;
      this._spawnParticles(this.player.x, this.player.y, RARITY_COLORS[this.myCreature.rarity]);
      window.notify(`Caught ${this.myCreature.name}!${prev ? ` Replaced ${prev}.` : ''}`, 'success');
      this._updateHUD();
      this._endBattle();
    };
  }

  _loseBattle() {
    this._battleOver = true;
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
    this.isRunning = true;
    this.lastTime  = performance.now();
    requestAnimationFrame(t => this._loop(t));
  }

  // ── Socket ────────────────────────────────────────────────
  connectSocket(socket) {
    this.socket = socket;
    socket.on('lobby_state', ({ lobbyId, lobbyName, players }) => {
      this.lobbyId = lobbyId; this.lobbyName = lobbyName;
      this.otherPlayers.clear();
      players.forEach(p => this.otherPlayers.set(p.userId, p));
      this._updateHUD();
    });
    socket.on('player_joined', ({ userId, username, x, y }) => {
      this.otherPlayers.set(userId, { userId, username, x, y });
      this._updateHUD(); this._addChat(`⚡ ${username} joined`);
    });
    socket.on('player_left', ({ userId }) => {
      const p = this.otherPlayers.get(userId);
      if (p) this._addChat(`👋 ${p.username} left`);
      this.otherPlayers.delete(userId); this._updateHUD();
    });
    socket.on('player_moved', ({ userId, x, y }) => {
      const p = this.otherPlayers.get(userId); if (p) { p.x = x; p.y = y; }
    });
    socket.on('chat_message', ({ username, message }) => this._addChat(`${username}: ${message}`));
    socket.on('creature_caught_broadcast', ({ username, creatureId }) => {
      const c = this.creatures.find(cr => cr.id === creatureId);
      if (c) this._addChat(`🎉 ${username} caught ${c.name}!`);
    });
  }

  _addChat(msg) {
    const el = document.createElement('div'); el.textContent = msg;
    const box = document.getElementById('chat-messages');
    box.appendChild(el); box.scrollTop = box.scrollHeight;
  }
}

window.Game = Game;
