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

    // inventory system
    this.inventory      = [
      { id: 'wooden_sword', name: 'Wooden Sword', icon: '🗡️', type: 'weapon' },
      { id: 'bat', name: 'Bat', icon: '🏏', type: 'weapon' },
      null, null, null
    ];
    this.activeSlot     = 0; // 0-indexed
    this.money          = 0;
    this.moneyTimer     = 0;
    this.lastMoneySave  = 0; // Track when money was last saved to server

    // freeze mechanic
    this.frozenPlayers  = new Map(); // userId -> freezeEndTime
    this.frozenUntil    = 0; // when the current player is frozen until

    // tutorial state
    this.tutorialStep   = -1; // -1 = not shown, 0..N = active
    this.tutorialDone   = false;

    // dropped creatures on ground
    this.droppedCreatures = [];

    const rng = mulberry32(42);
    this.tiles = this._generateWorld(rng);
    this._offscreen    = this._buildOffscreen();
    this._minimapCache = this._buildMinimapCache(); // pre-rendered static minimap layer

    this._bindInputs();
  }

  // ── World generation ──────────────────────────────────────
  // Layout matches wireframe: forest fills the top of the world,
  // wavy grass border separates it from the lobby, bases are at the bottom.
  // Player STARTS in the lobby (south) and walks NORTH into the forest.
  _generateWorld(rng) {
    const tiles = Array.from({ length: WORLD_H }, () => new Uint8Array(WORLD_W));
    // 0=grass, 1=dirt path, 2=tree, 3=stone floor, 5=dense grass, 6=flowers
    // No tile-4 water blocking — border is purely visual

    const FOREST_END = WORLD_H - LOBBY_H; // lobby occupies the BOTTOM rows

    // ── Forest (top) ─────────────────────────────────
    for (let y = 0; y < FOREST_END; y++) {
      for (let x = 0; x < WORLD_W; x++) {
        if (tiles[y][x] !== 0) continue;
        const r = rng();
        if      (r < 0.20) tiles[y][x] = 2; // tree
        else if (r < 0.28) tiles[y][x] = 5; // dense grass
        else if (r < 0.32) tiles[y][x] = 6; // flowers
      }
    }

    // Main vertical path through forest (centre)
    const mx = Math.floor(WORLD_W / 2);
    for (let y = 0; y < FOREST_END; y++) {
      tiles[y][mx]   = 1;
      tiles[y][mx+1] = 1;
    }

    // Horizontal branch paths every 20 tiles in forest
    for (let py = 10; py < FOREST_END - 5; py += 20) {
      for (let x = 0; x < WORLD_W; x++) tiles[py][x] = 1;
    }

    // ── Lobby (bottom) ────────────────────────────────
    for (let y = FOREST_END; y < WORLD_H; y++)
      for (let x = 0; x < WORLD_W; x++)
        tiles[y][x] = 3;

    // 7 player pens at the very bottom - fenced areas
    for (let i = 0; i < 7; i++) {
      const bx = 2 + i * 8;
      const by = WORLD_H - 4;
      // Floor
      this._fillTiles(tiles, bx, by, 6, 4, 3);
      // Fence (trees as fence posts) - left and right
      for (let fy = by; fy < by + 4; fy++) {
        tiles[fy][bx] = 2;      // left fence
        tiles[fy][bx + 5] = 2;  // right fence
      }
      // Fence - top
      for (let fx = bx; fx < bx + 6; fx++) {
        tiles[by][fx] = 2;
      }
      // Gate (bottom center) - leave 2 tiles open
      tiles[by + 3][bx + 2] = 0; // gate left
      tiles[by + 3][bx + 3] = 0; // gate right
    }

    // Lobby structures
    this._fillTiles(tiles, 2, FOREST_END + 2, 7, 5, 3);           // Store
    this._fillTiles(tiles, WORLD_W-10, FOREST_END + 2, 7, 7, 3);  // Portal
    this._fillTiles(tiles, WORLD_W-10, FOREST_END + 10, 7, 3, 3); // Training

    return tiles;
  }

  _fillTiles(tiles, x, y, w, h, val) {
    for (let dy = 0; dy < h; dy++)
      for (let dx = 0; dx < w; dx++)
        if (y+dy < WORLD_H && x+dx < WORLD_W) tiles[y+dy][x+dx] = val;
  }

  // Pre-render static tile layer to offscreen canvas (called once)
  _buildOffscreen() {
    const oc  = document.createElement('canvas');
    oc.width  = WORLD_W * TILE;
    oc.height = WORLD_H * TILE;
    const ctx = oc.getContext('2d');
    const rng = mulberry32(99);
    const FOREST_END = WORLD_H - LOBBY_H;

    for (let ty = 0; ty < WORLD_H; ty++) {
      for (let tx = 0; tx < WORLD_W; tx++) {
        const t  = this.tiles[ty][tx];
        const px = tx * TILE, py = ty * TILE;

        if      (t === 0) { ctx.fillStyle = rng() < 0.15 ? '#3d8b47' : '#4a9e52'; }
        else if (t === 1) { ctx.fillStyle = rng() < 0.2  ? '#b0916e' : '#c4a882'; }
        else if (t === 2) { ctx.fillStyle = '#3a7a40'; }
        else if (t === 3) { ctx.fillStyle = rng() < 0.1  ? '#636e7a' : '#6b7685'; }
        else if (t === 5) { ctx.fillStyle = '#3a7a40'; }
        else if (t === 6) { ctx.fillStyle = '#4a9e52'; }
        else              { ctx.fillStyle = '#4a9e52'; }
        ctx.fillRect(px, py, TILE, TILE);

        if (t === 1) {
          ctx.fillStyle = 'rgba(255,255,255,0.06)';
          ctx.fillRect(px, py, TILE, 2);
        }
        if (t === 3) {
          ctx.strokeStyle = 'rgba(0,0,0,0.18)'; ctx.lineWidth = 1;
          ctx.strokeRect(px+0.5, py+0.5, TILE-1, TILE-1);
          ctx.fillStyle = 'rgba(255,255,255,0.04)';
          ctx.fillRect(px+1, py+1, TILE/2-2, TILE/2-2);
        }
        if (t === 5) {
          ctx.fillStyle = '#2a6b30';
          for (let i = 0; i < 4; i++) ctx.fillRect(px+6+i*10, py+20+(i%2)*8, 3, 10);
        }
        if (t === 6) {
          const fc = ['#ff6b8a','#ffd166','#a8d8ff','#c3ff8a'];
          for (let i = 0; i < 3; i++) {
            ctx.fillStyle = fc[(tx*3+ty+i) % fc.length];
            ctx.beginPath(); ctx.arc(px+10+i*14, py+24+((i+tx)%2)*8, 4, 0, Math.PI*2); ctx.fill();
          }
        }
        if (t === 2) {
          ctx.fillStyle = 'rgba(0,0,0,0.2)';
          ctx.beginPath(); ctx.ellipse(px+TILE/2+4, py+TILE-6, 14, 6, 0, 0, Math.PI*2); ctx.fill();
          ctx.fillStyle = '#6b3a1f';
          ctx.fillRect(px+TILE/2-5, py+TILE-20, 10, 20);
          ctx.fillStyle = '#1d5c25';
          ctx.beginPath(); ctx.arc(px+TILE/2, py+TILE-28, 18, 0, Math.PI*2); ctx.fill();
          ctx.fillStyle = '#267a30';
          ctx.beginPath(); ctx.arc(px+TILE/2-4, py+TILE-34, 14, 0, Math.PI*2); ctx.fill();
          ctx.fillStyle = '#2e9438';
          ctx.beginPath(); ctx.arc(px+TILE/2+2, py+TILE-38, 11, 0, Math.PI*2); ctx.fill();
          ctx.fillStyle = 'rgba(255,255,255,0.08)';
          ctx.beginPath(); ctx.arc(px+TILE/2-6, py+TILE-42, 6, 0, Math.PI*2); ctx.fill();
        }
      }
    }

    // Depth fog — darkens further from lobby (ty=0 is deepest forest)
    for (let ty = 0; ty < FOREST_END; ty++) {
      const depth = (FOREST_END - ty) / FOREST_END;
      const alpha = Math.min(0.55, depth * 0.65);
      ctx.fillStyle = `rgba(0,8,4,${alpha})`;
      ctx.fillRect(0, ty * TILE, WORLD_W * TILE, TILE);
    }

    // Wavy grass border between forest and lobby
    const borderY = FOREST_END * TILE;
    ctx.fillStyle = '#2d5a20';
    ctx.beginPath();
    ctx.moveTo(0, borderY);
    // Wavy top edge of the border strip
    const steps = WORLD_W * TILE;
    for (let x = 0; x <= steps; x += 8) {
      const wave = Math.sin(x * 0.018) * 12 + Math.sin(x * 0.042 + 1) * 6;
      ctx.lineTo(x, borderY - 18 + wave);
    }
    ctx.lineTo(WORLD_W * TILE, borderY + 30);
    ctx.lineTo(0, borderY + 30);
    ctx.closePath();
    ctx.fill();

    // Lighter grass highlight on the wavy edge
    ctx.fillStyle = '#3a7a30';
    ctx.beginPath();
    ctx.moveTo(0, borderY);
    for (let x = 0; x <= steps; x += 8) {
      const wave = Math.sin(x * 0.018) * 12 + Math.sin(x * 0.042 + 1) * 6;
      ctx.lineTo(x, borderY - 16 + wave);
    }
    for (let x = steps; x >= 0; x -= 8) {
      const wave = Math.sin(x * 0.018) * 12 + Math.sin(x * 0.042 + 1) * 6;
      ctx.lineTo(x, borderY - 10 + wave);
    }
    ctx.closePath();
    ctx.fill();

    // Base dividers — vertical lines between the 7 bases
    for (let i = 1; i < 7; i++) {
      const bx = (2 + i * 8) * TILE;
      ctx.strokeStyle = 'rgba(0,0,0,0.35)';
      ctx.lineWidth   = 2;
      ctx.beginPath();
      ctx.moveTo(bx, (WORLD_H - 4) * TILE);
      ctx.lineTo(bx, WORLD_H * TILE);
      ctx.stroke();
    }

    // Pen labels
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.font      = 'bold 14px "Segoe UI"';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    for (let i = 0; i < 7; i++) {
      const bx = (2 + i * 8) * TILE + 6;
      const by = (WORLD_H - 4) * TILE + 8;
      ctx.fillText('pen', bx, by);
    }

    return oc;
  }

  // Pre-render minimap static layer (paths + zones) — called once, huge perf gain
  _buildMinimapCache() {
    const mm  = this.minimap;
    const oc  = document.createElement('canvas');
    oc.width  = mm.width;
    oc.height = mm.height;
    const mc  = oc.getContext('2d');
    const sw  = mm.width  / (WORLD_W * TILE);
    const sh  = mm.height / (WORLD_H * TILE);
    const FOREST_END = WORLD_H - LOBBY_H;

    // Forest
    mc.fillStyle = '#1a4a1a';
    mc.fillRect(0, 0, mm.width, FOREST_END * TILE * sh);
    // Lobby
    mc.fillStyle = '#374151';
    mc.fillRect(0, FOREST_END * TILE * sh, mm.width, mm.height);
    // Border
    mc.fillStyle = '#2d5a20';
    mc.fillRect(0, (FOREST_END - 1) * TILE * sh, mm.width, 3);

    // Paths
    mc.fillStyle = '#c4a882';
    for (let ty = 0; ty < WORLD_H; ty++)
      for (let tx = 0; tx < WORLD_W; tx++)
        if (this.tiles[ty][tx] === 1)
          mc.fillRect(tx*TILE*sw, ty*TILE*sh, Math.max(1, TILE*sw), Math.max(1, TILE*sh));

    return oc;
  }

  // ── Input ─────────────────────────────────────────────────
  _bindInputs() {
    window.addEventListener('keydown', e => {
      this.keys[e.key.toLowerCase()] = true;
      if (e.key.toLowerCase() === 'e') {
        // Check if near base first
        const FOREST_END = WORLD_H - LOBBY_H;
        const inLobby    = this.player.y / TILE > FOREST_END;
        const nearBase   = inLobby && this.player.y / TILE > (WORLD_H - 6);
        if (nearBase && this.myCreature) {
          this._openCreatureGUI();
        } else if (this.tutorialStep === -1) {
          this._tryFight();
        }
      }
      if (e.key === 'Enter') {
        const ci = document.getElementById('chat-input');
        if (ci && document.activeElement !== ci) { ci.focus(); e.preventDefault(); }
      }
    });
    window.addEventListener('keyup', e => { this.keys[e.key.toLowerCase()] = false; });

    const btnFight = document.getElementById('btn-fight');
    if (btnFight) {
      btnFight.addEventListener('click', () => {
        if (this.tutorialStep >= 0) this._advanceTutorial();
        else this._tryFight();
      });
    }
    const btnStorePen = document.getElementById('btn-store-pen');
    if (btnStorePen) {
      btnStorePen.addEventListener('click', () => this._storeInBase());
    }
    const btnMenu = document.getElementById('btn-menu');
    if (btnMenu) {
      btnMenu.addEventListener('click', () => this.stop());
    }

    const chatInput = document.getElementById('chat-input');
    if (chatInput) {
      chatInput.addEventListener('keydown', e => {
        if (e.key === 'Enter') {
          const msg = e.target.value.trim();
          if (msg && this.socket) { this.socket.emit('lobby_chat', { message: msg }); }
          e.target.value = '';
          e.target.blur();
          e.preventDefault();
        }
        if (e.key === 'Escape') e.target.blur();
      });
    }

    // Hotbar slot switching with number keys
    window.addEventListener('keydown', e => {
      if (e.key >= '1' && e.key <= '5') {
        this.activeSlot = parseInt(e.key) - 1;
        this._updateNewHUD();
      }
    });

    // Mouse click for bat weapon
    this.canvas.addEventListener('mousedown', e => {
      if (e.button === 0) { // Left click
        this._handleLeftClick(e);
      }
    });
  }

  _tryFight() {
    if (!this.isRunning || !this.nearbyCreature) return;
    this._startBattle(this.nearbyCreature);
  }

  _openCreatureGUI() {
    window.openCreatureGUI();
  }

  async _loadCreatureGUI() {
    const equippedDiv = document.getElementById('gui-equipped-info');
    const baseDiv = document.getElementById('gui-base-creatures');
    const btnDeposit = document.getElementById('btn-deposit-creature');

    // Show equipped creature
    if (this.myCreature && equippedDiv) {
      const c = this.myCreature;
      equippedDiv.innerHTML = `
        <div style="font-size:16px;font-weight:700;color:${RARITY_COLORS[c.rarity]};margin-bottom:8px;">${c.name}</div>
        <div style="font-size:12px;color:var(--gray);margin-bottom:4px;">${c.rarity.charAt(0).toUpperCase() + c.rarity.slice(1)}</div>
        <div style="font-size:11px;color:var(--light);">ATK ${c.attack} · DEF ${c.defense} · SPD ${c.speed}</div>
        <div style="font-size:11px;color:var(--light);">HP ${c.hp}</div>
      `;
    } else if (equippedDiv) {
      equippedDiv.innerHTML = '<p style="color:var(--gray);font-size:13px;">No creature equipped</p>';
    }
    if (btnDeposit) btnDeposit.disabled = !this.myCreature;

    // Show base creatures (all non-equipped creatures)
    if (!baseDiv) return;
    const baseCreatures = this.collection.filter(uc => uc.creature && !uc.is_active);
    if (baseCreatures.length === 0) {
      baseDiv.innerHTML = '<p style="color:var(--gray);font-size:13px;">No creatures in base</p>';
    } else {
      baseDiv.innerHTML = '';
      baseCreatures.forEach(uc => {
        const c = uc.creature;
        const btn = document.createElement('button');
        btn.className = 'btn-secondary';
        btn.style.cssText = 'width:100%;margin-bottom:8px;padding:10px;text-align:left;';
        btn.innerHTML = `
          <div style="font-size:14px;font-weight:700;color:${RARITY_COLORS[c.rarity]};">${c.name}</div>
          <div style="font-size:11px;color:var(--gray);">${c.rarity} · ATK ${c.attack} · HP ${c.hp}</div>
        `;
        btn.addEventListener('click', () => this._equipCreature(uc));
        baseDiv.appendChild(btn);
      });
    }
  }

  async _depositFromGUI() {
    if (!this.myCreature || this._depositing) return;
    this._depositing = true;
    const btnDeposit = document.getElementById('btn-deposit-creature');
    if (btnDeposit) btnDeposit.disabled = true;

    const creatureToDeposit = this.myCreature;
    try {
      const res = await fetch('/api/creatures/store', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: this.session.userId, creatureId: creatureToDeposit.id })
      });
      if (!res.ok) throw new Error();
      const data = await res.json();

      // Add to collection locally
      this.collection.push({
        id: data.userCreatureId,
        creature_id: creatureToDeposit.id,
        creature: creatureToDeposit,
        is_active: false,
        current_hp: creatureToDeposit.hp,
        caught_at: new Date().toISOString()
      });

      this.myCreature = null;
      this._updateHUD();
      this._updateNewHUD();
      window.notify(`${creatureToDeposit.name} stored in your base! 🏠`, 'success');
      this._spawnParticles(this.player.x, this.player.y, RARITY_COLORS[creatureToDeposit.rarity]);
      if (this.socket) this.socket.emit('creature_stored', { creatureId: creatureToDeposit.id });
      window.refreshPenCount && window.refreshPenCount();

      // Reload GUI
      this._loadCreatureGUI();
    } catch (e) {
      console.error('Deposit error:', e);
      window.notify('Failed to deposit creature.', 'error');
    } finally {
      this._depositing = false;
      if (btnDeposit) btnDeposit.disabled = !this.myCreature;
    }
  }

  async _equipCreature(userCreature) {
    try {
      // Update is_active status via API
      const res = await fetch(`/api/users/${this.session.userId}/creatures/${userCreature.id}/equip`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      if (!res.ok) throw new Error();

      // Update local state
      const oldEquipped = this.collection.find(uc => uc.is_active);
      if (oldEquipped) oldEquipped.is_active = false;
      userCreature.is_active = true;

      // Set as equipped
      this.myCreature = { ...userCreature.creature, currentHp: userCreature.current_hp || userCreature.creature.hp };
      this._updateHUD();
      this._updateNewHUD();

      window.notify(`Equipped ${this.myCreature.name}!`, 'success');
      this._spawnParticles(this.player.x, this.player.y, RARITY_COLORS[this.myCreature.rarity]);

      // Reload GUI
      this._loadCreatureGUI();
    } catch (e) {
      console.error('Equip error:', e);
      window.notify('Failed to equip creature.', 'error');
    }
  }

  _handleLeftClick(e) {
    const activeItem = this.inventory[this.activeSlot];
    if (!activeItem || activeItem.id !== 'bat') return;

    // Check if clicking on another player
    const rect = this.canvas.getBoundingClientRect();
    const clickX = e.clientX - rect.left + this.camera.x;
    const clickY = e.clientY - rect.top + this.camera.y;

    for (const [userId, player] of this.otherPlayers) {
      const playerX = player.x;
      const playerY = player.y;
      const dist = Math.hypot(clickX - playerX, clickY - playerY);

      if (dist < 60) { // Within range
        // Freeze the player for 3 seconds
        const freezeEndTime = performance.now() + 3000;
        this.frozenPlayers.set(userId, freezeEndTime);

        // Notify both players
        window.notify(`You hit ${player.username} with a bat! They're frozen for 3 seconds.`, 'success');
        if (this.socket) {
          this.socket.emit('player_frozen', { targetUserId: userId, duration: 3000 });
        }
        break;
      }
    }
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

    // Spawn in lobby (bottom of world)
    const FOREST_END = WORLD_H - LOBBY_H;
    this.player.x = WORLD_W / 2 * TILE;
    this.player.y = (FOREST_END + 7) * TILE;

    // Find active creature — deduplicated: take first is_active, or first in collection
    const active = collection.find(uc => uc.is_active) || collection[0];
    if (active && active.creature) {
      this.myCreature = { ...active.creature, currentHp: active.current_hp ?? active.creature.hp };
    } else {
      const lucas = creatures.find(c => c.id === 'c0');
      if (lucas) this.myCreature = { ...lucas, currentHp: lucas.hp };
    }

    // Load money from session if available
    if (session.money) {
      this.money = session.money;
    }

    this._spawnWorldCreatures();
    this._updateHUD();
    this._updateNewHUD();

    const hudUsername = document.getElementById('hud-username');
    const hudLobbyName = document.getElementById('hud-lobby-name');
    if (hudUsername) hudUsername.textContent   = session.username;
    if (hudLobbyName) hudLobbyName.textContent = lobbyName;

    this.lastTime = performance.now();
    requestAnimationFrame(t => this._loop(t));

    // Tutorial: show only if not completed before
    const tutorialCompleted = localStorage.getItem('cac_tutorial_completed');
    if (!tutorialCompleted && isNewUser) {
      setTimeout(() => this._showTutorial(), 800);
    }
  }

  stop() {
    this.isRunning = false;
    if (this.socket) this.socket.emit('leave_lobby');
    const gameScreen = document.getElementById('game-screen');
    const hud = document.getElementById('hud');
    if (gameScreen) gameScreen.classList.add('hidden');
    if (hud) hud.classList.add('hidden');
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
      localStorage.setItem('cac_tutorial_completed', 'true');
      const tutorialOverlay = document.getElementById('tutorial-overlay');
      if (tutorialOverlay) tutorialOverlay.classList.add('hidden');
    } else {
      this._renderTutorial();
    }
  }

  _tutorialSteps() {
    return [
      { title: '👋 Welcome!',
        body:  `You are <b>${this.session.username}</b>!<br><br>Your starter creature is <b style="color:#4169E1">Lucas da Vucas</b>.<br>It's in your active slot, ready to battle.` },
      { title: '🕹️ Moving Around',
        body:  'Use <b>WASD</b> or <b>Arrow Keys</b> to move.<br><br>You start in the <b>Lobby</b> at the bottom. Walk <b>north (up)</b> to enter the forest and find wild creatures.' },
      { title: '⚔️ Battling Creatures',
        body:  'Walk up to a glowing creature in the forest.<br><br>Press <b>E</b> or click <b>Fight</b> to start a turn-based battle.<br><br>Your first battle is <b>guaranteed to win!</b>' },
      { title: '🎒 Catching & Base',
        body:  'After winning a battle, click <b>"Take Creature"</b> to hold it.<br><br>You can only hold <b>1 creature</b> at a time.<br><br>Walk back to the <b>bottom of the lobby</b> to reach your base, then click <b>"Store in Base"</b>.' },
      { title: '🏠 Your Base',
        body:  'Your <b>base</b> is at the very bottom of the lobby — those are the 7 labelled sections.<br><br>Walk to the bottom row and the <b>"Store in Base"</b> button will activate.<br><br>View your stored creatures from the <b>dashboard</b>.' },
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

    const tutTitle = document.getElementById('tut-title');
    const tutBody = document.getElementById('tut-body');
    const tutStep = document.getElementById('tut-step');
    const tutNext = document.getElementById('tut-next');

    if (tutTitle) tutTitle.textContent = step.title;
    if (tutBody) tutBody.innerHTML    = step.body;
    if (tutStep) tutStep.textContent  = `${this.tutorialStep + 1} / ${total}`;
    if (tutNext) tutNext.textContent  =
      this.tutorialStep === total - 1 ? 'Let\'s Go! 🎮' : 'Next →';

    if (ov) ov.classList.remove('hidden');
  }

  // ── Spawn world creatures ─────────────────────────────────
  _spawnWorldCreatures() {
    this.worldCreatures = [];
    const rng = mulberry32(Date.now() & 0xFFFF);
    const spawnables = this.creatures.filter(c => c.spawn_rate > 0);
    const FOREST_END = WORLD_H - LOBBY_H;
    const count = 80 + Math.floor(rng() * 40);

    for (let i = 0; i < count; i++) {
      const ty = Math.floor(rng() * (FOREST_END - 2));
      const tx = Math.floor(rng() * WORLD_W);
      const t  = this.tiles[ty][tx];
      if (t === 2 || t === 1) continue; // skip trees and paths

      // Depth: deeper = further from lobby = smaller ty (higher up)
      // depth 0 at FOREST_END-1 (just inside forest), max at ty=0
      const depth = (FOREST_END - 1 - ty) * TILE;
      const zone  = [...DEPTH_ZONES].reverse().find(z => depth >= z.minDepth) || DEPTH_ZONES[0];
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
    // Check if player is frozen
    if (this.frozenUntil > performance.now()) {
      // Player is frozen, skip movement
      // Still update camera and other things
      this.camera.x = Math.max(0, Math.min(WORLD_W*TILE - this.canvas.width,  this.player.x - this.canvas.width/2));
      this.camera.y = Math.max(0, Math.min(WORLD_H*TILE - this.canvas.height, this.player.y - this.canvas.height/2));
      this._updateGameLogic(dt, ts);
      return;
    }

    // Block movement during tutorial or chat
    const chatInput = document.getElementById('chat-input');
    const blocking = this.tutorialStep >= 0 ||
      (chatInput && document.activeElement === chatInput);

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

    this._updateGameLogic(dt, ts);
  }

  _updateGameLogic(dt, ts) {
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

    // Money generation based on creature rarity
    this.moneyTimer += dt;
    if (this.moneyTimer >= 1.0) { // Every second
      this.moneyTimer = 0;
      if (this.myCreature) {
        const rarityRates = {
          'common': 1,
          'uncommon': 5,
          'rare': 25,
          'epic': 100,
          'legendary': 500,
          'mythic': 2500,
          'divine': 10000,
          'celestial': 50000,
          'eternal': 250000,
          'omniversal': 5000000
        };
        const rate = rarityRates[this.myCreature.rarity] || 1;
        this.money += rate;
        this._updateNewHUD();
      }
    }

    // Save money to server every 10 seconds
    this.lastMoneySave = (this.lastMoneySave || 0) + dt;
    if (this.lastMoneySave >= 10 && this.money > 0 && this.session) {
      this.lastMoneySave = 0;
      fetch(`/api/users/${this.session.userId}/money`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ money: this.money })
      }).catch(e => console.log('Money save failed:', e));
    }

    // Nearest creature detection
    this.nearbyCreature = null;
    let minD = 72;
    for (const wc of this.worldCreatures) {
      if (wc.dead) continue;
      const d = Math.hypot(wc.x - this.player.x, wc.y - this.player.y);
      if (d < minD) { minD = d; this.nearbyCreature = wc; }
    }
    const btnFight = document.getElementById('btn-fight');
    if (btnFight) btnFight.disabled = !this.nearbyCreature || !this.myCreature;

    // Base proximity — player is near their base if in lobby zone near bottom
    const FOREST_END = WORLD_H - LOBBY_H;
    const inLobby    = this.player.y / TILE > FOREST_END;
    const nearBase   = inLobby && this.player.y / TILE > (WORLD_H - 6);
    const btnStorePen = document.getElementById('btn-store-pen');
    if (btnStorePen) {
      btnStorePen.disabled = !this.myCreature || !nearBase;
      btnStorePen.title    = nearBase
        ? 'Open your base (or press E)'
        : 'Walk to your base (bottom of lobby) to open';
    }

    const depth = Math.max(0, Math.floor((FOREST_END - this.player.y / TILE) * 5));
    const hudDepth = document.getElementById('hud-depth');
    if (hudDepth) {
      hudDepth.textContent = nearBase
        ? '🏠 At your base (Press E)'
        : depth > 0 ? `Depth: ${depth}m` : 'Lobby';
    }
  }

  _walkable(wx, wy) {
    const tx = Math.floor(wx / TILE), ty = Math.floor(wy / TILE);
    if (tx < 0 || tx >= WORLD_W || ty < 0 || ty >= WORLD_H) return false;
    return this.tiles[ty][tx] !== 2; // only trees block
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

    // Wavy border animated shimmer
    const FEROW = (WORLD_H - LOBBY_H);
    const bY = FEROW * TILE;
    if (bY - 30 < this.camera.y + this.canvas.height && bY + 30 > this.camera.y) {
      ctx.fillStyle = `rgba(60,140,40,${0.08 + Math.sin(ts * 0.002) * 0.04})`;
      ctx.fillRect(0, bY - 28, WORLD_W * TILE, 56);
    }

    // Zone depth overlay — forest gets darker the further north you go
    const FOREST_END_ROW = WORLD_H - LOBBY_H;
    const playerDepth = Math.max(0, 1 - (this.player.y / TILE) / FOREST_END_ROW);
    if (playerDepth > 0.3) {
      ctx.fillStyle = `rgba(0,0,20,${Math.sin(ts * 0.001) * 0.04 * playerDepth})`;
      ctx.fillRect(this.camera.x, this.camera.y, this.canvas.width, this.canvas.height);
    }

    // Structure signs
    const FE = WORLD_H - LOBBY_H;
    this._drawSign(ctx, 5 * TILE,              (FE + 4) * TILE, '🏪', 'Store');
    this._drawSign(ctx, (WORLD_W - 6) * TILE,  (FE + 5) * TILE, '🌀', 'Portal');
    this._drawSign(ctx, (WORLD_W - 6) * TILE,  (FE + 11) * TILE, '⚔️', 'Training');
    this._drawSign(ctx, Math.floor(WORLD_W/2) * TILE, (FE - 3) * TILE, '🌲', '← Forest');
    this._drawSign(ctx, Math.floor(WORLD_W/2) * TILE, (FE + 2) * TILE, '👆', 'Go North');

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

      // Nearby creature: Enhanced glow + particles
      if (glow && isNear) {
        const pulse = 0.6 + Math.sin(ts * 0.005 + wc.bobOffset) * 0.4;
        
        // Large pulsing glow
        ctx.shadowColor = glow;
        ctx.shadowBlur  = 32 * pulse;
        
        // Multiple glow rings
        ctx.strokeStyle = glow;
        ctx.globalAlpha = 0.3;
        ctx.lineWidth = 2;
        for (let i = 1; i <= 3; i++) {
          ctx.beginPath();
          ctx.arc(cx, cy, 25 + i * 6, 0, Math.PI * 2);
          ctx.stroke();
        }
        ctx.globalAlpha = 1;
      } else if (glow) {
        // Subtle glow for non-near creatures
        ctx.shadowColor = glow;
        ctx.shadowBlur  = 12;
      }

      this._drawCreatureSprite(ctx, cx, cy, wc.type.rarity, col, ts + wc.bobOffset * 1000);
      ctx.shadowBlur = 0;

      // Name tag with rarity and money info
      const rarityRates = {
        'common': 1, 'uncommon': 5, 'rare': 25, 'epic': 100, 'legendary': 500,
        'mythic': 2500, 'divine': 10000, 'celestial': 50000, 'eternal': 250000, 'omniversal': 5000000
      };
      const poe = rarityRates[wc.type.rarity] || 1;
      
      ctx.font = 'bold 11px "Segoe UI"';
      const nameWidth = ctx.measureText(wc.type.name).width;
      ctx.font = '9px "Segoe UI"';
      const rarityText = `${wc.type.rarity} · $${poe}/s`;
      const rarityWidth = ctx.measureText(rarityText).width;
      const maxWidth = Math.max(nameWidth, rarityWidth) + 12;
      
      ctx.fillStyle = 'rgba(0,0,0,0.8)';
      ctx.beginPath();
      ctx.roundRect(cx - maxWidth/2, cy - 48, maxWidth, 26, 4);
      ctx.fill();
      
      // Name tag border
      ctx.strokeStyle = col;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.roundRect(cx - maxWidth/2, cy - 48, maxWidth, 26, 4);
      ctx.stroke();
      
      ctx.fillStyle = '#fff';
      ctx.textAlign  = 'center';
      ctx.textBaseline = 'top';
      ctx.font = 'bold 11px "Segoe UI"';
      ctx.fillText(wc.type.name, cx, cy - 46);
      
      ctx.fillStyle = col;
      ctx.font = '9px "Segoe UI"';
      ctx.fillText(rarityText, cx, cy - 34);

      // Selection ring with animation
      if (isNear) {
        ctx.strokeStyle = '#fff';
        ctx.lineWidth   = 3;
        ctx.setLineDash([8, 5]);
        ctx.lineDashOffset = -ts * 0.04;
        ctx.globalAlpha = 0.8;
        ctx.beginPath();
        ctx.arc(cx, cy, 24, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = 1;
        ctx.setLineDash([]);
      }

      ctx.restore();
    }

    // Other players
    for (const [, op] of this.otherPlayers) {
      ctx.save();
      ctx.shadowColor = '#f59e0b';
      ctx.shadowBlur  = 12;
      
      // Body
      const otherGrad = ctx.createLinearGradient(op.x-13, op.y-10, op.x+13, op.y+12);
      otherGrad.addColorStop(0, '#fcd34d');
      otherGrad.addColorStop(1, '#f59e0b');
      ctx.fillStyle = otherGrad;
      ctx.beginPath();
      ctx.roundRect(op.x-13, op.y-10, 26, 22, 5);
      ctx.fill();
      
      // Head
      ctx.fillStyle = '#fef3c7';
      ctx.beginPath();
      ctx.arc(op.x, op.y-16, 9, 0, Math.PI*2);
      ctx.fill();
      
      // Hat
      ctx.fillStyle = '#d97706';
      ctx.fillRect(op.x-10, op.y-24, 20, 4);
      ctx.fillRect(op.x-7, op.y-30, 14, 6);
      
      // Hat shine
      ctx.fillStyle = 'rgba(255,255,255,0.3)';
      ctx.fillRect(op.x-7, op.y-30, 14, 2);
      
      // Eyes
      ctx.fillStyle = '#111';
      ctx.beginPath(); ctx.arc(op.x-3, op.y-17, 1.5, 0, Math.PI*2); ctx.fill();
      ctx.beginPath(); ctx.arc(op.x+3, op.y-17, 1.5, 0, Math.PI*2); ctx.fill();
      
      ctx.restore();
      
      // Name label
      ctx.fillStyle = 'rgba(0,0,0,0.7)';
      ctx.beginPath();
      ctx.roundRect(op.x-30, op.y-28, 60, 14, 4);
      ctx.fill();
      
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 10px "Segoe UI"';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(op.username.substring(0, 10).toUpperCase(), op.x, op.y - 21);
    }

    // Player character
    this._drawPlayer(ctx, this.player.x, this.player.y, ts);

    // Draw creatures in base pen
    this._drawBaseCreatures(ctx, ts);

    // Draw dropped creatures on ground
    this._drawDroppedCreatures(ctx, ts);

    // "Press E" prompt with animation
    if (this.nearbyCreature) {
      const px = this.player.x, py = this.player.y;
      const pulse = 0.7 + Math.sin(ts * 0.006) * 0.3;
      
      // Pulsing glow background
      ctx.fillStyle = `rgba(253, 230, 138, ${pulse * 0.3})`;
      ctx.shadowColor = '#fde68a';
      ctx.shadowBlur = 15 * pulse;
      ctx.beginPath();
      ctx.roundRect(px - 60, py - 65, 120, 30, 8);
      ctx.fill();
      
      // Border
      ctx.strokeStyle = '#fde68a';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.roundRect(px - 60, py - 65, 120, 30, 8);
      ctx.stroke();
      
      // Icon
      ctx.font = '18px Arial';
      ctx.fillStyle = '#fbbf24';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('⚔', px - 30, py - 50);
      
      // Text
      ctx.font = 'bold 13px "Segoe UI"';
      ctx.fillStyle = '#fff';
      ctx.fillText('Press E to Fight!', px + 15, py - 50);
      
      ctx.shadowBlur = 0;
    }

    ctx.restore();

    this._drawMinimap();
  }

  _drawCreatureSprite(ctx, cx, cy, rarity, col, ts) {
    ctx.save();
    
    // Add pulse glow based on rarity
    const pulse = 0.3 + Math.sin(ts * 0.003) * 0.2;
    const shadowBlur = (rarity === 'omniversal' ? 20 : rarity === 'eternal' ? 16 : rarity === 'celestial' ? 14 : 8) * pulse;
    ctx.shadowColor = col;
    ctx.shadowBlur = shadowBlur;
    
    // Each rarity gets a distinct, more detailed sprite
    switch (rarity) {
      case 'common': { // Cute blocky critter
        // Body with shading
        ctx.fillStyle = col;
        ctx.beginPath();
        ctx.roundRect(cx-13, cy-13, 26, 26, 5);
        ctx.fill();
        
        // Darker shade on bottom
        ctx.fillStyle = this._darkenColor(col, 0.3);
        ctx.beginPath();
        ctx.roundRect(cx-13, cy+8, 26, 5, 2);
        ctx.fill();
        
        // Highlight on top
        ctx.fillStyle = this._lightenColor(col, 0.3);
        ctx.beginPath();
        ctx.roundRect(cx-13, cy-13, 26, 4, 2);
        ctx.fill();
        break;
      }
      case 'uncommon': { // Smooth sphere with shine
        ctx.fillStyle = col;
        ctx.beginPath();
        ctx.arc(cx, cy, 13, 0, Math.PI*2);
        ctx.fill();
        
        // Shading gradient
        const g1 = ctx.createRadialGradient(cx-3, cy-5, 0, cx, cy, 13);
        g1.addColorStop(0, this._lightenColor(col, 0.4));
        g1.addColorStop(1, this._darkenColor(col, 0.4));
        ctx.fillStyle = g1;
        ctx.beginPath();
        ctx.arc(cx, cy, 13, 0, Math.PI*2);
        ctx.fill();
        break;
      }
      case 'rare': { // Diamond with facets
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(Math.sin(ts * 0.002) * 0.3);
        
        ctx.fillStyle = col;
        ctx.beginPath();
        ctx.moveTo(0, -15);
        ctx.lineTo(15, 0);
        ctx.lineTo(0, 15);
        ctx.lineTo(-15, 0);
        ctx.closePath();
        ctx.fill();
        
        // Facet lines
        ctx.strokeStyle = this._lightenColor(col, 0.4);
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(0, -15);
        ctx.lineTo(0, 15);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(-15, 0);
        ctx.lineTo(15, 0);
        ctx.stroke();
        
        ctx.restore();
        break;
      }
      case 'epic': { // Multi-pointed star with rotation
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(ts * 0.005);
        
        ctx.fillStyle = col;
        this._drawStar(ctx, 0, 0, 5, 15, 8);
        
        // Inner bright core
        ctx.fillStyle = this._lightenColor(col, 0.5);
        ctx.beginPath();
        ctx.arc(0, 0, 5, 0, Math.PI*2);
        ctx.fill();
        
        ctx.restore();
        break;
      }
      case 'legendary': { // Flame creature
        // Base body
        ctx.fillStyle = col;
        ctx.beginPath();
        ctx.moveTo(cx, cy-18);
        ctx.quadraticCurveTo(cx+18, cy-2, cx+12, cy+14);
        ctx.quadraticCurveTo(cx, cy+8, cx-12, cy+14);
        ctx.quadraticCurveTo(cx-18, cy-2, cx, cy-18);
        ctx.fill();
        
        // Flame highlights
        ctx.fillStyle = this._lightenColor(col, 0.5);
        ctx.beginPath();
        ctx.moveTo(cx-5, cy-10);
        ctx.quadraticCurveTo(cx-8, cy, cx-5, cy+8);
        ctx.quadraticCurveTo(cx-2, cy+2, cx-5, cy-10);
        ctx.fill();
        
        // Inner flame
        ctx.fillStyle = '#ffff00';
        ctx.globalAlpha = 0.6;
        ctx.beginPath();
        ctx.arc(cx, cy-5, 6, 0, Math.PI*2);
        ctx.fill();
        ctx.globalAlpha = 1;
        break;
      }
      case 'mythic': { // Ghostly ethereal form
        // Outer aura
        ctx.fillStyle = this._lightenColor(col, 0.5);
        ctx.globalAlpha = 0.4;
        ctx.beginPath();
        ctx.arc(cx, cy, 16, 0, Math.PI*2);
        ctx.fill();
        ctx.globalAlpha = 1;
        
        // Body
        ctx.fillStyle = col;
        ctx.beginPath();
        ctx.arc(cx, cy, 13, 0, Math.PI*2);
        ctx.fill();
        
        // Spooky void on side
        ctx.fillStyle = '#1a1a2e';
        ctx.beginPath();
        ctx.arc(cx+6, cy-3, 10, 0, Math.PI*2);
        ctx.fill();
        
        // Highlight
        ctx.fillStyle = this._lightenColor(col, 0.6);
        ctx.beginPath();
        ctx.arc(cx-7, cy-8, 4, 0, Math.PI*2);
        ctx.fill();
        break;
      }
      case 'divine': { // Holy 8-pointed radiance
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(ts * 0.003);
        
        // Glow halo
        ctx.fillStyle = this._lightenColor(col, 0.6);
        ctx.globalAlpha = 0.5;
        ctx.beginPath();
        ctx.arc(0, 0, 18, 0, Math.PI*2);
        ctx.fill();
        ctx.globalAlpha = 1;
        
        // Main body
        ctx.fillStyle = col;
        this._drawStar(ctx, 0, 0, 8, 16, 9);
        
        // Bright core
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(0, 0, 6, 0, Math.PI*2);
        ctx.fill();
        
        ctx.restore();
        break;
      }
      case 'celestial': { // Cosmic body with ring
        // Outer ring (orbit)
        ctx.strokeStyle = col;
        ctx.lineWidth = 2;
        ctx.globalAlpha = 0.6;
        ctx.beginPath();
        ctx.arc(cx, cy, 16, 0, Math.PI*2);
        ctx.stroke();
        ctx.globalAlpha = 1;
        
        // Middle sphere
        ctx.fillStyle = col;
        ctx.beginPath();
        ctx.arc(cx, cy, 11, 0, Math.PI*2);
        ctx.fill();
        
        // Gradient effect
        const gCelest = ctx.createRadialGradient(cx-2, cy-2, 0, cx, cy, 11);
        gCelest.addColorStop(0, this._lightenColor(col, 0.3));
        gCelest.addColorStop(1, this._darkenColor(col, 0.3));
        ctx.fillStyle = gCelest;
        ctx.beginPath();
        ctx.arc(cx, cy, 11, 0, Math.PI*2);
        ctx.fill();
        
        // Core
        ctx.fillStyle = this._lightenColor(col, 0.7);
        ctx.beginPath();
        ctx.arc(cx, cy, 5, 0, Math.PI*2);
        ctx.fill();
        break;
      }
      case 'eternal': { // Dark powerful force
        // Outer dark aura
        ctx.fillStyle = this._darkenColor(col, 0.4);
        ctx.beginPath();
        ctx.arc(cx, cy, 17, 0, Math.PI*2);
        ctx.fill();
        
        // Main body
        ctx.fillStyle = col;
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(ts * 0.004);
        this._drawStar(ctx, 0, 0, 4, 16, 6);
        ctx.restore();
        
        // Energy lines
        ctx.strokeStyle = this._lightenColor(col, 0.6);
        ctx.lineWidth = 1;
        for (let i = 0; i < 4; i++) {
          const angle = (i * Math.PI / 2) + (ts * 0.003);
          ctx.beginPath();
          ctx.moveTo(cx, cy);
          ctx.lineTo(cx + Math.cos(angle) * 14, cy + Math.sin(angle) * 14);
          ctx.stroke();
        }
        break;
      }
      case 'omniversal': { // Rainbow reality-bending creature
        const hue = (ts * 0.08) % 360;
        
        // Outer rotating rainbow ring
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(ts * 0.006);
        
        ctx.strokeStyle = `hsl(${hue}, 100%, 60%)`;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(0, 0, 17, 0, Math.PI*2);
        ctx.stroke();
        
        ctx.strokeStyle = `hsl(${(hue+120)%360}, 100%, 60%)`;
        ctx.beginPath();
        ctx.arc(0, 0, 14, 0, Math.PI*2);
        ctx.stroke();
        
        ctx.strokeStyle = `hsl(${(hue+240)%360}, 100%, 60%)`;
        ctx.beginPath();
        ctx.arc(0, 0, 11, 0, Math.PI*2);
        ctx.stroke();
        
        // Main body - rainbow gradient
        const gr = ctx.createRadialGradient(0, 0, 0, 0, 0, 16);
        gr.addColorStop(0, `hsl(${hue}, 100%, 70%)`);
        gr.addColorStop(0.5, `hsl(${(hue+120)%360}, 100%, 60%)`);
        gr.addColorStop(1, `hsl(${(hue+240)%360}, 100%, 50%)`);
        ctx.fillStyle = gr;
        this._drawStar(ctx, 0, 0, 6, 16, 9);
        
        // Bright core
        ctx.fillStyle = '#ffffff';
        ctx.globalAlpha = 0.8;
        ctx.beginPath();
        ctx.arc(0, 0, 7, 0, Math.PI*2);
        ctx.fill();
        ctx.globalAlpha = 1;
        
        ctx.restore();
        break;
      }
    }

    // Expressive eyes (all creatures)
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
    
    // Blink animation
    const blinkCycle = Math.sin(ts * 0.004) * 0.5 + 0.5;
    const eyeHeight = 3.5 * (1 - Math.abs(blinkCycle - 0.5) * 2);
    
    // Left eye white
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.ellipse(cx-5, cy-3, 3.5, Math.max(0.5, eyeHeight), 0, 0, Math.PI*2);
    ctx.fill();
    
    // Right eye white
    ctx.beginPath();
    ctx.ellipse(cx+5, cy-3, 3.5, Math.max(0.5, eyeHeight), 0, 0, Math.PI*2);
    ctx.fill();
    
    // Pupils
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.arc(cx-5, cy-3, 2.2, 0, Math.PI*2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(cx+5, cy-3, 2.2, 0, Math.PI*2);
    ctx.fill();
    
    // Eye shine/reflection
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(cx-3.8, cy-4.5, 1, 0, Math.PI*2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(cx+6.2, cy-4.5, 1, 0, Math.PI*2);
    ctx.fill();
    
    ctx.restore();
  }

  // Helper: Darken a color
  _darkenColor(color, amount) {
    const c = parseInt(color.slice(1), 16);
    const r = Math.max(0, (c >> 16) - Math.floor(50 * amount));
    const g = Math.max(0, ((c >> 8) & 0xff) - Math.floor(50 * amount));
    const b = Math.max(0, (c & 0xff) - Math.floor(50 * amount));
    return '#' + ((r << 16) | (g << 8) | b).toString(16).padStart(6, '0');
  }

  // Helper: Lighten a color
  _lightenColor(color, amount) {
    const c = parseInt(color.slice(1), 16);
    const r = Math.min(255, (c >> 16) + Math.floor(80 * amount));
    const g = Math.min(255, ((c >> 8) & 0xff) + Math.floor(80 * amount));
    const b = Math.min(255, (c & 0xff) + Math.floor(80 * amount));
    return '#' + ((r << 16) | (g << 8) | b).toString(16).padStart(6, '0');
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
    
    // Strong glow effect
    ctx.shadowColor = '#6366f1';
    ctx.shadowBlur = 20;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 2;

    // ── Body with gradient ──
    const bodyGrad = ctx.createLinearGradient(px-13, py-11, px+13, py+13);
    bodyGrad.addColorStop(0, '#7c7ef9');
    bodyGrad.addColorStop(0.5, '#6366f1');
    bodyGrad.addColorStop(1, '#5152d4');
    ctx.fillStyle = bodyGrad;
    ctx.beginPath();
    ctx.roundRect(px-13, py-11, 26, 24, 6);
    ctx.fill();
    
    // Body outline
    ctx.strokeStyle = '#4f46e5';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.roundRect(px-13, py-11, 26, 24, 6);
    ctx.stroke();

    // ── Head with gradient ──
    const headGrad = ctx.createRadialGradient(px-2, py-20, 3, px, py-18, 10);
    headGrad.addColorStop(0, '#fdd76a');
    headGrad.addColorStop(0.7, '#fbbf24');
    headGrad.addColorStop(1, '#f59e0b');
    ctx.fillStyle = headGrad;
    ctx.beginPath();
    ctx.arc(px, py-18, 10, 0, Math.PI*2);
    ctx.fill();
    
    // Head shadow
    ctx.fillStyle = 'rgba(0,0,0,0.15)';
    ctx.beginPath();
    ctx.arc(px+2, py-16, 10, 0, Math.PI*2);
    ctx.fill();

    // ── Hat ──
    ctx.fillStyle = '#4f46e5';
    ctx.fillRect(px-11, py-27, 22, 5);
    
    // Hat gradient
    const hatGrad = ctx.createLinearGradient(px-11, py-27, px+11, py-22);
    hatGrad.addColorStop(0, '#6366f1');
    hatGrad.addColorStop(1, '#312e81');
    ctx.fillStyle = hatGrad;
    ctx.fillRect(px-8, py-34, 16, 8);
    
    // Hat shine
    ctx.fillStyle = 'rgba(255,255,255,0.3)';
    ctx.fillRect(px-8, py-34, 16, 2);

    // ── Eyes ──
    // Left eye
    ctx.fillStyle = '#111';
    ctx.beginPath();
    ctx.arc(px-4, py-19, 2.5, 0, Math.PI*2);
    ctx.fill();
    
    // Right eye
    ctx.beginPath();
    ctx.arc(px+4, py-19, 2.5, 0, Math.PI*2);
    ctx.fill();
    
    // Eye shine
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(px-3, py-20, 1, 0, Math.PI*2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(px+5, py-20, 1, 0, Math.PI*2);
    ctx.fill();

    // ── Smile ──
    ctx.strokeStyle = '#111';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(px, py-16, 3, 0, Math.PI);
    ctx.stroke();

    // ── Arms ──
    const armBob = Math.sin(ts * 0.012) * 2;
    
    // Left arm
    ctx.fillStyle = '#fbbf24';
    ctx.beginPath();
    ctx.roundRect(px-16, py-8 + armBob, 5, 12, 2);
    ctx.fill();
    
    // Right arm
    ctx.beginPath();
    ctx.roundRect(px+11, py-8 - armBob, 5, 12, 2);
    ctx.fill();

    // ── Legs (animated walk) ──
    const walk = Math.sin(ts * 0.01) * 5;
    
    // Left leg
    ctx.fillStyle = '#312e81';
    ctx.beginPath();
    ctx.roundRect(px-9, py+13, 7, 10 + walk, 3);
    ctx.fill();
    
    // Right leg
    ctx.beginPath();
    ctx.roundRect(px+2, py+13, 7, 10 - walk, 3);
    ctx.fill();
    
    // Leg shine
    ctx.fillStyle = 'rgba(255,255,255,0.1)';
    ctx.beginPath();
    ctx.roundRect(px-9, py+13, 2, 10 + walk, 2);
    ctx.fill();
    ctx.beginPath();
    ctx.roundRect(px+2, py+13, 2, 10 - walk, 2);
    ctx.fill();

    ctx.shadowBlur = 0;
    ctx.restore();

    // ── Player name label ──
    ctx.fillStyle = 'rgba(0,0,0,0.7)';
    ctx.beginPath();
    ctx.roundRect(px-35, py-42, 70, 16, 5);
    ctx.fill();
    
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 12px "Segoe UI"';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText((this.session?.username?.substring(0, 10) || 'YOU').toUpperCase(), px, py - 34);
  }

  _drawSign(ctx, x, y, icon, label) {
    ctx.save();
    
    // Sign post (pole)
    ctx.fillStyle = '#8b7355';
    ctx.fillRect(x - 4, y + 12, 8, 20);
    
    // Shadow on pole
    ctx.fillStyle = 'rgba(0,0,0,0.2)';
    ctx.fillRect(x - 2, y + 12, 2, 20);
    
    // Sign board with gradient
    const signGrad = ctx.createLinearGradient(x - 36, y - 14, x + 36, y + 10);
    signGrad.addColorStop(0, '#8b7765');
    signGrad.addColorStop(1, '#6b5b52');
    ctx.fillStyle = signGrad;
    ctx.beginPath();
    ctx.roundRect(x - 36, y - 14, 72, 24, 6);
    ctx.fill();
    
    // Sign border
    ctx.strokeStyle = '#4b3b32';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(x - 36, y - 14, 72, 24, 6);
    ctx.stroke();
    
    // Sign shine
    ctx.fillStyle = 'rgba(255,255,255,0.15)';
    ctx.beginPath();
    ctx.roundRect(x - 36, y - 14, 72, 6, 6);
    ctx.fill();
    
    // Text background
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath();
    ctx.roundRect(x - 32, y - 10, 64, 16, 4);
    ctx.fill();
    
    // Text
    ctx.font      = 'bold 14px "Segoe UI"';
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    
    // Split into icon and label
    ctx.font = '16px Arial';
    ctx.fillText(icon, x - 12, y - 2);
    ctx.font = 'bold 11px "Segoe UI"';
    ctx.fillText(label, x + 14, y - 2);
    
    ctx.restore();
  }

  _drawBaseCreatures(ctx, ts) {
    // Only draw if player is near their base
    const FOREST_END = WORLD_H - LOBBY_H;
    const inLobby    = this.player.y / TILE > FOREST_END;
    const nearBase   = inLobby && this.player.y / TILE > (WORLD_H - 6);

    if (!nearBase || this.collection.length === 0) return;

    // Calculate player's base pen based on x position
    const penIndex = Math.floor((this.player.x / TILE - 2) / 8);
    if (penIndex < 0 || penIndex >= 7) return;

    // Get creatures stored in this player's base (all collection creatures)
    const penCreatures = this.collection.filter(uc => uc.creature && !uc.is_active);

    if (penCreatures.length === 0) return;

    // Draw creatures in the pen area
    const baseX = (2 + penIndex * 8) * TILE;
    const baseY = (WORLD_H - 4) * TILE;

    // Draw owner name at top of base
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.65)';
    ctx.beginPath();
    ctx.roundRect(baseX + TILE/2 - 50, baseY - 30, 100, 18, 4);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 11px "Segoe UI"';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const ownerName = this.session?.username?.substring(0, 12) || 'Base';
    ctx.fillText(`${ownerName}'s Base`, baseX + TILE/2, baseY - 21);
    ctx.restore();

    ctx.save();
    penCreatures.forEach((uc, i) => {
      const c = uc.creature;
      // Position creatures in a grid within the pen
      const gridCol = i % 3;
      const row = Math.floor(i / 3);
      const cx = baseX + TILE + gridCol * TILE * 1.5;
      const cy = baseY + TILE + row * TILE * 1.5;

      // Bob animation
      const bob = Math.sin(ts * 0.003 + i) * 3;

      // Draw creature sprite
      const col = RARITY_COLORS[c.rarity] || '#fff';
      this._drawCreatureSprite(ctx, cx, cy + bob, c.rarity, col, ts);

      // Draw creature info below (name, rarity, money/poe)
      const rarityRates = {
        'common': 1, 'uncommon': 5, 'rare': 25, 'epic': 100, 'legendary': 500,
        'mythic': 2500, 'divine': 10000, 'celestial': 50000, 'eternal': 250000, 'omniversal': 5000000
      };
      const poe = rarityRates[c.rarity] || 1;

      ctx.fillStyle = '#fff';
      ctx.font = 'bold 9px "Segoe UI"';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillText(c.name.substring(0, 8), cx, cy + 20);

      ctx.font = '8px "Segoe UI"';
      ctx.fillStyle = RARITY_COLORS[c.rarity] || '#fff';
      ctx.fillText(c.rarity.substring(0, 6), cx, cy + 30);

      ctx.fillStyle = '#fbbf24';
      ctx.fillText(`$${poe}/s`, cx, cy + 39);
    });
    ctx.restore();
  }

  _drawDroppedCreatures(ctx, ts) {
    if (!this.droppedCreatures || this.droppedCreatures.length === 0) return;

    this.droppedCreatures.forEach((dc, i) => {
      const c = dc.creature;
      const bob = Math.sin(ts * 0.003 + i) * 3;
      const col = RARITY_COLORS[c.rarity] || '#fff';

      ctx.save();
      ctx.globalAlpha = 0.8;

      // Draw creature sprite
      this._drawCreatureSprite(ctx, dc.x, dc.y + bob, c.rarity, col, ts);

      // Glow effect
      ctx.shadowColor = col;
      ctx.shadowBlur = 10;
      ctx.strokeStyle = col;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(dc.x, dc.y + bob, 20, 0, Math.PI * 2);
      ctx.stroke();

      // Name tag
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 10px "Segoe UI"';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillText(c.name.substring(0, 10), dc.x, dc.y + bob + 25);

      ctx.restore();
    });
  }

  _drawMinimap() {
    const mm = this.minimap, mc = this.mmCtx;
    const sw = mm.width  / (WORLD_W * TILE), sh = mm.height / (WORLD_H * TILE);

    // Blit pre-rendered static layer (paths + zones)
    mc.drawImage(this._minimapCache, 0, 0);

    // Dynamic: creatures
    for (const wc of this.worldCreatures) {
      if (wc.dead) continue;
      mc.fillStyle = RARITY_COLORS[wc.type.rarity];
      mc.fillRect(wc.x*sw-1, wc.y*sh-1, 3, 3);
    }

    // Other players
    mc.fillStyle = '#f59e0b';
    for (const [, op] of this.otherPlayers)
      mc.fillRect(op.x*sw-2, op.y*sh-2, 4, 4);

    // Player dot
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
    const hudCreatureName = document.getElementById('hud-creature-name');
    const hudHpBar = document.getElementById('hud-hp-bar');
    const hudHpText = document.getElementById('hud-hp-text');
    const btnStorePen = document.getElementById('btn-store-pen');
    const hudPlayerCount = document.getElementById('hud-player-count');

    if (c) {
      if (hudCreatureName) hudCreatureName.textContent = c.name;
      const pct = Math.max(0, c.currentHp / c.hp * 100);
      if (hudHpBar) {
        hudHpBar.style.width      = pct + '%';
        hudHpBar.style.background = pct > 50 ? '#10b981' : pct > 25 ? '#f59e0b' : '#ef4444';
      }
      if (hudHpText) hudHpText.textContent = `HP: ${c.currentHp} / ${c.hp}`;
      if (btnStorePen) btnStorePen.disabled  = false;
    } else {
      if (hudCreatureName) hudCreatureName.textContent = 'No creature';
      if (hudHpBar) hudHpBar.style.width = '0%';
      if (hudHpText) hudHpText.textContent = '';
      if (btnStorePen) btnStorePen.disabled  = true;
    }
    if (hudPlayerCount) {
      hudPlayerCount.textContent = `${this.otherPlayers.size + 1} / 8 players`;
    }
  }

  _updateNewHUD() {
    // Update money display
    const hudMoney = document.getElementById('hud-money');
    if (hudMoney) hudMoney.textContent = `Money $${this.money}`;

    // Update hotbar
    for (let i = 0; i < 5; i++) {
      const slot = document.querySelector(`.hotbar-slot[data-slot="${i + 1}"]`);
      if (!slot) continue;
      const item = this.inventory[i];
      const iconEl = slot.querySelector('.hotbar-slot-icon');
      if (item) {
        iconEl.textContent = item.icon;
      } else {
        iconEl.textContent = '';
      }
      slot.classList.toggle('active', i === this.activeSlot);
    }

    // Update equipped creature display
    const c = this.myCreature;
    const hudEquippedName = document.getElementById('hud-equipped-name');
    const hudEquippedStats = document.getElementById('hud-equipped-stats');
    if (c) {
      if (hudEquippedName) hudEquippedName.textContent = c.name;
      if (hudEquippedStats) hudEquippedStats.textContent =
        `ATK: ${c.attack} | DEF: ${c.defense} | SPD: ${c.speed}`;
    } else {
      if (hudEquippedName) hudEquippedName.textContent = 'No creature';
      if (hudEquippedStats) hudEquippedStats.textContent = '—';
    }
  }

  // ── Store in base ─────────────────────────────────────────
  async _storeInBase() {
    if (!this.myCreature || this._storingPen) return;
    this._storingPen = true;
    const btnStorePen = document.getElementById('btn-store-pen');
    if (btnStorePen) btnStorePen.disabled = true;

    const creatureToStore = this.myCreature;
    try {
      const res = await fetch('/api/creatures/store', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: this.session.userId, creatureId: creatureToStore.id })
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Failed');

      // Record the win
      fetch('/api/battles/win', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: this.session.userId })
      }).catch(() => {});

      this.myCreature = null;
      this._updateHUD();
      window.notify(`${creatureToStore.name} stored in your base! 🏠`, 'success');
      this._spawnParticles(this.player.x, this.player.y, RARITY_COLORS[creatureToStore.rarity]);
      if (this.socket) this.socket.emit('creature_stored', { creatureId: creatureToStore.id });
      window.refreshPenCount && window.refreshPenCount();
    } catch (e) {
      window.notify(`Failed to store: ${e.message}`, 'error');
    } finally {
      this._storingPen = false;
      if (btnStorePen) btnStorePen.disabled = !this.myCreature;
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
    if (this.isFirstBattle) {
      this._log(`Your first battle is guaranteed! 🎁`, 'good');
    }

    const battleScreen = document.getElementById('battle-screen');
    const btnAttack = document.getElementById('btn-attack');
    const btnRun = document.getElementById('btn-run');

    if (battleScreen) battleScreen.classList.remove('hidden');
    if (btnAttack) {
      btnAttack.disabled = false;
      btnAttack.onclick  = () => this._doAttack();
    }
    if (btnRun) {
      btnRun.textContent = 'Run Away';
      btnRun.onclick     = () => this._doRun();
    }
  }

  _setBattleUI(p, e) {
    const setR = (id, pct) => {
      const el = document.getElementById(id);
      if (el) {
        el.style.width      = pct + '%';
        el.style.background = pct > 50 ? '#10b981' : pct > 25 ? '#f59e0b' : '#ef4444';
      }
    };

    const bpName = document.getElementById('bp-name');
    const bpHp = document.getElementById('bp-hp');
    const bpStats = document.getElementById('bp-stats');
    const beName = document.getElementById('be-name');
    const beHp = document.getElementById('be-hp');
    const beStats = document.getElementById('be-stats');

    if (bpName) bpName.textContent  = p.name;
    if (bpHp) bpHp.textContent    = `HP: ${p.currentHp} / ${p.hp}`;
    if (bpStats) bpStats.innerHTML   = `ATK ${p.attack} · DEF ${p.defense} · SPD ${p.speed}<br><em>${p.special_ability}</em>`;
    setR('bp-hp-bar', p.currentHp / p.hp * 100);

    if (beName) beName.textContent  = e.name;
    if (beHp) beHp.textContent    = `HP: ${e.currentHp} / ${e.hp}`;
    if (beStats) beStats.innerHTML   = `ATK ${e.attack} · DEF ${e.defense} · SPD ${e.speed}<br><em>${e.special_ability}</em>`;
    setR('be-hp-bar', e.currentHp / e.hp * 100);

    // Creature color badges
    const bpCol = RARITY_COLORS[p.rarity] || '#fff';
    const beCol = RARITY_COLORS[e.rarity] || '#fff';
    if (bpName) bpName.style.color = bpCol;
    if (beName) beName.style.color = beCol;
  }

  _log(msg, cls) {
    const p = document.createElement('p');
    if (cls) p.className = cls;
    p.textContent = msg;
    const log = document.getElementById('battle-log');
    if (log) {
      log.appendChild(p);
      log.scrollTop = log.scrollHeight;
    }
  }
  _clearLog() {
    const log = document.getElementById('battle-log');
    if (log) log.innerHTML = '';
  }

  _doAttack() {
    if (this._battleOver) return;
    const btnAttack = document.getElementById('btn-attack');
    if (btnAttack) btnAttack.disabled = true;
    const pl = this.myCreature, en = this._currentEnemy;

    const pdmg = Math.max(1, pl.attack - Math.floor(en.defense*0.4) + Math.floor(Math.random()*6));
    en.currentHp = Math.max(0, en.currentHp - pdmg);
    this._log(`${pl.name} attacks for ${pdmg} damage!`, 'good');

    const setR = (id, pct) => {
      const el = document.getElementById(id);
      if (el) {
        el.style.width = Math.max(0,pct) + '%';
        el.style.background = pct > 50 ? '#10b981' : pct > 25 ? '#f59e0b' : '#ef4444';
      }
    };
    setR('be-hp-bar', en.currentHp / en.hp * 100);
    const beHp = document.getElementById('be-hp');
    if (beHp) beHp.textContent = `HP: ${en.currentHp} / ${en.hp}`;

    if (en.currentHp <= 0) { this._log(`${en.name} fainted! You win! 🎉`, 'good'); this._winBattle(); return; }

    const edmg = this._firstTurn ? 1
      : Math.max(1, en.attack - Math.floor(pl.defense*0.4) + Math.floor(Math.random()*6));
    this._firstTurn    = false;
    this.isFirstBattle = false;

    pl.currentHp = Math.max(0, pl.currentHp - edmg);
    this._log(`${en.name} attacks for ${edmg} damage!`, 'bad');
    setR('bp-hp-bar', pl.currentHp / pl.hp * 100);
    const bpHp = document.getElementById('bp-hp');
    if (bpHp) bpHp.textContent = `HP: ${pl.currentHp} / ${pl.hp}`;
    this._updateHUD();

    if (pl.currentHp <= 0) { this._log(`${pl.name} fainted! You lose.`, 'bad'); this._loseBattle(); return; }
    if (btnAttack) btnAttack.disabled = false;
  }

  _doRun() { this._endBattle(); window.notify('Got away safely!', 'info'); }

  _dropCreatureOnGround(creature) {
    // Spawn a dropped creature item at player's position
    this.droppedCreatures = this.droppedCreatures || [];
    this.droppedCreatures.push({
      creature: creature,
      x: this.player.x,
      y: this.player.y,
      spawnedAt: Date.now()
    });
    // Remove after 5 minutes
    setTimeout(() => {
      this.droppedCreatures = this.droppedCreatures.filter(dc => dc !== this.droppedCreatures[this.droppedCreatures.length - 1]);
    }, 300000);
  }

  _winBattle() {
    this._battleOver = true;
    const btnAttack = document.getElementById('btn-attack');
    const btnRun = document.getElementById('btn-run');
    if (btnAttack) btnAttack.disabled = true;
    if (btnRun) {
      btnRun.textContent = '✅ Take Creature';
      btnRun.onclick = () => {
        const prev = this.myCreature?.name;
        // Drop previous creature on the ground if exists
        if (this.myCreature) {
          this._dropCreatureOnGround(this.myCreature);
        }
        this.myCreature = { ...this._currentEnemy, currentHp: this._currentEnemy.currentHp };
        if (this._currentWC) this._currentWC.dead = true;
        this._spawnParticles(this.player.x, this.player.y, RARITY_COLORS[this.myCreature.rarity]);
        window.notify(`Caught ${this.myCreature.name}!${prev ? ` Dropped ${prev} on the ground.` : ''} Walk to your base to store it!`, 'success');
        this._updateHUD();
        this._endBattle();
      };
    }
  }

  _loseBattle() {
    this._battleOver = true;
    this.myCreature.currentHp = this.myCreature.hp;
    this._updateHUD();
    const btnAttack = document.getElementById('btn-attack');
    const btnRun = document.getElementById('btn-run');
    if (btnAttack) btnAttack.disabled = true;
    if (btnRun) {
      btnRun.textContent = 'Continue';
      btnRun.onclick = () => this._endBattle();
    }
    window.notify('Defeated! Your creature was healed.', 'info');
  }

  _endBattle() {
    this._battleOver = true;
    const battleScreen = document.getElementById('battle-screen');
    if (battleScreen) battleScreen.classList.add('hidden');
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
    socket.on('creature_stored_broadcast', ({ username, creatureId }) => {
      const c = this.creatures.find(cr => cr.id === creatureId);
      if (c) this._addChat(`🏠 ${username} stored ${c.name} in their base!`);
    });
    socket.on('player_frozen', ({ duration }) => {
      this.frozenUntil = performance.now() + duration;
      window.notify(`You've been frozen for ${duration/1000} seconds!`, 'error');
    });
  }

  _addChat(msg) {
    const el = document.createElement('div'); 
    el.textContent = msg;  // Using textContent prevents XSS
    const box = document.getElementById('chat-messages');
    if (box) {
      box.appendChild(el);
      box.scrollTop = box.scrollHeight;
    }
  }
}

window.Game = Game;
