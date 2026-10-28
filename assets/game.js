import * as THREE from 'three';

// Game State
const gameState = {
  userId: null,
  username: null,
  currentLobby: null,
  creatures: [],
  userCreatures: [],
  socket: null,
  scene: null,
  camera: null,
  renderer: null,
  controls: null,
  player: null,
  creaturesInWorld: [],
  otherPlayers: new Map(),
  isGameRunning: false,
  activeCreature: null, // The creature currently held in inventory
  inBattle: false,
  battleState: null,
  isFirstBattle: true
};

// Rarity colors
const rarityColors = {
  common: 0x808080,
  uncommon: 0x90EE90,
  rare: 0x87CEEB,
  epic: 0x9370DB,
  legendary: 0xFF4500,
  mythic: 0x4B0082,
  divine: 0xFFD700,
  celestial: 0x00CED1,
  eternal: 0xFF1493,
  omniversal: 0xFF69B4
};

// Rarity spawn rates based on depth
const spawnRates = {
  common: 0.40,
  uncommon: 0.25,
  rare: 0.15,
  epic: 0.08,
  legendary: 0.05,
  mythic: 0.03,
  divine: 0.02,
  celestial: 0.015,
  eternal: 0.009,
  omniversal: 0.001
};

// Initialize Three.js
function initThreeJS() {
  const container = document.getElementById('game-container');

  // Scene
  gameState.scene = new THREE.Scene();
  gameState.scene.background = new THREE.Color(0x87CEEB);
  gameState.scene.fog = new THREE.Fog(0x87CEEB, 50, 200);

  // Camera (Third-person)
  gameState.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
  gameState.camera.position.set(0, 5, 10);

  // Renderer
  gameState.renderer = new THREE.WebGLRenderer({ antialias: true });
  gameState.renderer.setSize(window.innerWidth, window.innerHeight);
  gameState.renderer.shadowMap.enabled = true;
  container.appendChild(gameState.renderer.domElement);

  // Lighting
  const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
  gameState.scene.add(ambientLight);

  const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
  directionalLight.position.set(50, 100, 50);
  directionalLight.castShadow = true;
  gameState.scene.add(directionalLight);

  // Ground
  const groundGeometry = new THREE.PlaneGeometry(500, 500);
  const groundMaterial = new THREE.MeshStandardMaterial({ color: 0x228B22 });
  const ground = new THREE.Mesh(groundGeometry, groundMaterial);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  gameState.scene.add(ground);

  // Create lobby layout
  createLobbyLayout();

  // Create forest area (beyond lobby)
  createForest();

  // Player (Roblox-style blocky character)
  gameState.player = new THREE.Group();

  // Body
  const bodyGeometry = new THREE.BoxGeometry(1, 1.5, 0.5);
  const bodyMaterial = new THREE.MeshStandardMaterial({ color: 0x0000FF });
  const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
  body.position.y = 1.5;
  body.castShadow = true;
  gameState.player.add(body);

  // Head
  const headGeometry = new THREE.BoxGeometry(0.8, 0.8, 0.8);
  const headMaterial = new THREE.MeshStandardMaterial({ color: 0xFFCC99 });
  const head = new THREE.Mesh(headGeometry, headMaterial);
  head.position.y = 2.8;
  head.castShadow = true;
  gameState.player.add(head);

  // Arms
  const armGeometry = new THREE.BoxGeometry(0.3, 1, 0.3);
  const armMaterial = new THREE.MeshStandardMaterial({ color: 0x0000FF });
  const leftArm = new THREE.Mesh(armGeometry, armMaterial);
  leftArm.position.set(-0.7, 1.5, 0);
  leftArm.castShadow = true;
  gameState.player.add(leftArm);

  const rightArm = new THREE.Mesh(armGeometry, armMaterial);
  rightArm.position.set(0.7, 1.5, 0);
  rightArm.castShadow = true;
  gameState.player.add(rightArm);

  // Legs
  const legGeometry = new THREE.BoxGeometry(0.3, 1, 0.3);
  const legMaterial = new THREE.MeshStandardMaterial({ color: 0x0000AA });
  const leftLeg = new THREE.Mesh(legGeometry, legMaterial);
  leftLeg.position.set(-0.25, 0.5, 0);
  leftLeg.castShadow = true;
  gameState.player.add(leftLeg);

  const rightLeg = new THREE.Mesh(legGeometry, legMaterial);
  rightLeg.position.set(0.25, 0.5, 0);
  rightLeg.castShadow = true;
  gameState.player.add(rightLeg);

  gameState.player.position.set(0, 0, 0);
  gameState.scene.add(gameState.player);

  // Camera offset for third-person (behind player)
  gameState.cameraOffset = new THREE.Vector3(0, 6, 12);
  gameState.cameraLookAt = new THREE.Vector3();

  // Handle window resize
  window.addEventListener('resize', onWindowResize);

  // Start animation loop
  animate();
}

function createLobbyLayout() {
  // Store for equipment (top left)
  createStore(-80, 0, -80);

  // Portal area (right side)
  createPortal(80, 0, -50);

  // Training camp (further right)
  createTrainingCamp(120, 0, -50);

  // 7 player bases (bottom)
  for (let i = 0; i < 7; i++) {
    const x = (i - 3) * 25;
    createBase(x, 0, 80);
  }

  // Pathways connecting areas
  createPathways();
}

function createStore(x, y, z) {
  const store = new THREE.Group();

  // Store building
  const buildingGeometry = new THREE.BoxGeometry(20, 10, 15);
  const buildingMaterial = new THREE.MeshStandardMaterial({ color: 0x8B4513 });
  const building = new THREE.Mesh(buildingGeometry, buildingMaterial);
  building.position.y = 5;
  building.castShadow = true;
  store.add(building);

  // Sign
  const signGeometry = new THREE.BoxGeometry(12, 3, 0.5);
  const signMaterial = new THREE.MeshStandardMaterial({ color: 0xFFD700 });
  const sign = new THREE.Mesh(signGeometry, signMaterial);
  sign.position.set(0, 12, 8);
  store.add(sign);

  // Store label
  const labelDiv = document.createElement('div');
  labelDiv.className = 'world-label';
  labelDiv.textContent = 'Store';
  labelDiv.style.position = 'absolute';
  document.body.appendChild(labelDiv);

  store.position.set(x, y, z);
  store.userData.label = 'Store';
  gameState.scene.add(store);
}

function createPortal(x, y, z) {
  const portal = new THREE.Group();

  // Portal frame
  const frameGeometry = new THREE.TorusGeometry(5, 0.5, 16, 100);
  const frameMaterial = new THREE.MeshStandardMaterial({ color: 0x9370DB });
  const frame = new THREE.Mesh(frameGeometry, frameMaterial);
  frame.position.y = 5;
  frame.rotation.y = Math.PI / 2;
  portal.add(frame);

  // Portal center (glowing)
  const centerGeometry = new THREE.CircleGeometry(4.5, 32);
  const centerMaterial = new THREE.MeshBasicMaterial({
    color: 0x00CED1,
    transparent: true,
    opacity: 0.5
  });
  const center = new THREE.Mesh(centerGeometry, centerMaterial);
  center.position.set(0, 5, 0);
  center.rotation.y = Math.PI / 2;
  portal.add(center);

  portal.position.set(x, y, z);
  portal.userData.label = 'Portal';
  gameState.scene.add(portal);
}

function createTrainingCamp(x, y, z) {
  const camp = new THREE.Group();

  // Training area
  const areaGeometry = new THREE.BoxGeometry(30, 1, 30);
  const areaMaterial = new THREE.MeshStandardMaterial({ color: 0xDEB887 });
  const area = new THREE.Mesh(areaGeometry, areaMaterial);
  area.position.y = 0.5;
  camp.add(area);

  // Training dummies
  for (let i = 0; i < 3; i++) {
    const dummyGeometry = new THREE.CylinderGeometry(1, 1, 4, 8);
    const dummyMaterial = new THREE.MeshStandardMaterial({ color: 0x8B4513 });
    const dummy = new THREE.Mesh(dummyGeometry, dummyMaterial);
    dummy.position.set((i - 1) * 8, 2, 0);
    dummy.castShadow = true;
    camp.add(dummy);
  }

  camp.position.set(x, y, z);
  camp.userData.label = 'Training Camp';
  gameState.scene.add(camp);
}

function createBase(x, y, z) {
  const base = new THREE.Group();

  // Base platform
  const platformGeometry = new THREE.BoxGeometry(20, 1, 20);
  const platformMaterial = new THREE.MeshStandardMaterial({ color: 0x696969 });
  const platform = new THREE.Mesh(platformGeometry, platformMaterial);
  platform.position.y = 0.5;
  base.add(platform);

  // Base walls
  const wallMaterial = new THREE.MeshStandardMaterial({ color: 0x808080 });
  const wallHeight = 3;

  // 4 walls
  const walls = [
    { x: 0, z: -10, w: 20, h: 0.5 },
    { x: 0, z: 10, w: 20, h: 0.5 },
    { x: -10, z: 0, w: 0.5, h: 20 },
    { x: 10, z: 0, w: 0.5, h: 20 }
  ];

  walls.forEach(w => {
    const wallGeometry = new THREE.BoxGeometry(w.w, wallHeight, w.h);
    const wall = new THREE.Mesh(wallGeometry, wallMaterial);
    wall.position.set(w.x, wallHeight / 2, w.z);
    wall.castShadow = true;
    base.add(wall);
  });

  // Base center
  const centerGeometry = new THREE.BoxGeometry(5, 2, 5);
  const centerMaterial = new THREE.MeshStandardMaterial({ color: 0x4169E1 });
  const center = new THREE.Mesh(centerGeometry, centerMaterial);
  center.position.y = 2;
  base.add(center);

  base.position.set(x, y, z);
  base.userData.label = 'Base';
  gameState.scene.add(base);
}

function createPathways() {
  const pathMaterial = new THREE.MeshStandardMaterial({ color: 0xD2B48C });

  // Path from center to store
  const path1 = new THREE.Mesh(
    new THREE.PlaneGeometry(5, 100),
    pathMaterial
  );
  path1.rotation.x = -Math.PI / 2;
  path1.position.set(-40, 0.02, -40);
  gameState.scene.add(path1);

  // Path from center to portal
  const path2 = new THREE.Mesh(
    new THREE.PlaneGeometry(5, 80),
    pathMaterial
  );
  path2.rotation.x = -Math.PI / 2;
  path2.position.set(40, 0.02, -25);
  gameState.scene.add(path2);

  // Path from center to bases
  const path3 = new THREE.Mesh(
    new THREE.PlaneGeometry(5, 80),
    pathMaterial
  );
  path3.rotation.x = -Math.PI / 2;
  path3.position.set(0, 0.02, 40);
  gameState.scene.add(path3);

  // Cross path connecting portal to training
  const path4 = new THREE.Mesh(
    new THREE.PlaneGeometry(50, 5),
    pathMaterial
  );
  path4.rotation.x = -Math.PI / 2;
  path4.position.set(100, 0.02, -50);
  gameState.scene.add(path4);
}

function createForest() {
  // Create trees throughout the forest area (beyond lobby)
  for (let i = 0; i < 300; i++) {
    const x = (Math.random() - 0.5) * 400;
    const z = (Math.random() - 0.5) * 400 - 150; // Forest starts at z = -150

    // Keep forest away from lobby areas
    if (z > -100) continue;

    createTree(x, z);
  }

  // Add rocks
  for (let i = 0; i < 80; i++) {
    const x = (Math.random() - 0.5) * 400;
    const z = (Math.random() - 0.5) * 400 - 150;
    if (z > -100) continue;
    createRock(x, z);
  }
}

function createTree(x, z) {
  const tree = new THREE.Group();

  // Trunk
  const trunkGeometry = new THREE.CylinderGeometry(0.5, 0.7, 4, 8);
  const trunkMaterial = new THREE.MeshStandardMaterial({ color: 0x8B4513 });
  const trunk = new THREE.Mesh(trunkGeometry, trunkMaterial);
  trunk.position.y = 2;
  trunk.castShadow = true;
  tree.add(trunk);

  // Foliage (blocky style)
  const foliageGeometry = new THREE.BoxGeometry(3, 4, 3);
  const foliageMaterial = new THREE.MeshStandardMaterial({ color: 0x228B22 });
  const foliage = new THREE.Mesh(foliageGeometry, foliageMaterial);
  foliage.position.y = 6;
  foliage.castShadow = true;
  tree.add(foliage);

  tree.position.set(x, 0, z);
  gameState.scene.add(tree);
}

function createRock(x, z) {
  const rockGeometry = new THREE.DodecahedronGeometry(Math.random() * 1.5 + 0.5);
  const rockMaterial = new THREE.MeshStandardMaterial({ color: 0x696969 });
  const rock = new THREE.Mesh(rockGeometry, rockMaterial);
  rock.position.set(x, 0.5, z);
  rock.rotation.set(Math.random(), Math.random(), Math.random());
  rock.castShadow = true;
  gameState.scene.add(rock);
}

function onWindowResize() {
  gameState.camera.aspect = window.innerWidth / window.innerHeight;
  gameState.camera.updateProjectionMatrix();
  gameState.renderer.setSize(window.innerWidth, window.innerHeight);
}

// Player movement
const moveState = {
  forward: false,
  backward: false,
  left: false,
  right: false,
  jump: false
};

const velocity = new THREE.Vector3();
const direction = new THREE.Vector3();

// Camera rotation
let isRightMouseDown = false;
let cameraRotationX = 0;
let cameraRotationY = 0;

function setupControls() {
  document.addEventListener('keydown', (event) => {
    switch (event.code) {
      case 'ArrowUp':
      case 'KeyW':
        moveState.forward = true;
        break;
      case 'ArrowLeft':
      case 'KeyA':
        moveState.left = true;
        break;
      case 'ArrowDown':
      case 'KeyS':
        moveState.backward = true;
        break;
      case 'ArrowRight':
      case 'KeyD':
        moveState.right = true;
        break;
      case 'Space':
        if (gameState.player.position.y <= 0) {
          velocity.y = 10;
        }
        break;
      case 'KeyE':
        tryCatchCreature();
        break;
      case 'Enter':
        const chatInput = document.getElementById('chat-input');
        if (chatInput === document.activeElement) {
          sendChatMessage();
        } else {
          chatInput.focus();
        }
        break;
    }
  });

  document.addEventListener('keyup', (event) => {
    switch (event.code) {
      case 'ArrowUp':
      case 'KeyW':
        moveState.forward = false;
        break;
      case 'ArrowLeft':
      case 'KeyA':
        moveState.left = false;
        break;
      case 'ArrowDown':
      case 'KeyS':
        moveState.backward = false;
        break;
      case 'ArrowRight':
      case 'KeyD':
        moveState.right = false;
        break;
    }
  });

  // Right-click to look around
  document.addEventListener('mousedown', (event) => {
    if (event.button === 2) {
      isRightMouseDown = true;
    }
  });

  document.addEventListener('mouseup', (event) => {
    if (event.button === 2) {
      isRightMouseDown = false;
    }
  });

  document.addEventListener('mousemove', (event) => {
    if (isRightMouseDown && gameState.isGameRunning) {
      cameraRotationY -= event.movementX * 0.002;
      cameraRotationX -= event.movementY * 0.002;
      cameraRotationX = Math.max(-Math.PI / 3, Math.min(Math.PI / 3, cameraRotationX));
    }
  });

  // Prevent context menu on right-click
  document.addEventListener('contextmenu', (event) => {
    event.preventDefault();
  });
}

function updatePlayerMovement(delta) {
  if (!gameState.isGameRunning) return;

  velocity.x -= velocity.x * 10.0 * delta;
  velocity.z -= velocity.z * 10.0 * delta;
  velocity.y -= 9.8 * 2.0 * delta;

  direction.z = Number(moveState.forward) - Number(moveState.backward);
  direction.x = Number(moveState.right) - Number(moveState.left);
  direction.normalize();

  if (moveState.forward || moveState.backward) {
    velocity.z -= direction.z * 100.0 * delta;
  }
  if (moveState.left || moveState.right) {
    velocity.x -= direction.x * 100.0 * delta;
  }

  // Rotate player to face camera direction
  gameState.player.rotation.y = cameraRotationY;

  // Calculate movement direction based on player's facing direction
  const moveX = (moveState.right ? 1 : 0) - (moveState.left ? 1 : 0);
  const moveZ = (moveState.backward ? 1 : 0) - (moveState.forward ? 1 : 0);

  if (moveX !== 0 || moveZ !== 0) {
    const moveAngle = Math.atan2(moveX, moveZ);
    const finalAngle = gameState.player.rotation.y + moveAngle;

    const speed = 10;
    gameState.player.position.x += Math.sin(finalAngle) * speed * delta;
    gameState.player.position.z += Math.cos(finalAngle) * speed * delta;
  }

  gameState.player.position.y = Math.max(1, gameState.player.position.y + velocity.y * delta);

  if (gameState.player.position.y <= 1) {
    velocity.y = 0;
    gameState.player.position.y = 1;
  }

  // Update camera to follow player
  const cameraOffsetX = Math.sin(cameraRotationY) * gameState.cameraOffset.z;
  const cameraOffsetZ = Math.cos(cameraRotationY) * gameState.cameraOffset.z;

  gameState.camera.position.x = gameState.player.position.x - cameraOffsetX;
  gameState.camera.position.z = gameState.player.position.z - cameraOffsetZ;
  gameState.camera.position.y = gameState.player.position.y + gameState.cameraOffset.x;

  // Camera looks at player with vertical offset
  gameState.cameraLookAt.copy(gameState.player.position);
  gameState.cameraLookAt.y += 2;
  gameState.camera.lookAt(gameState.cameraLookAt);

  // Send position to server
  if (gameState.socket && gameState.currentLobby) {
    gameState.socket.emit('player_move', {
      lobbyId: gameState.currentLobby,
      userId: gameState.userId,
      position: {
        x: gameState.player.position.x,
        y: gameState.player.position.y,
        z: gameState.player.position.z
      }
    });
  }
}

// Creature spawning
function spawnCreature() {
  if (!gameState.isGameRunning) return;

  // Only spawn in forest area (z < -100)
  if (gameState.player.position.z > -100) return;

  // Calculate depth based on z position (deeper = more negative z)
  const depth = Math.abs(gameState.player.position.z + 150);
  const maxDepth = 250;

  // Adjust spawn rates based on depth
  let adjustedRates = { ...spawnRates };
  if (depth > 50) {
    adjustedRates.common *= 0.5;
    adjustedRates.uncommon *= 0.8;
    adjustedRates.rare *= 1.2;
  }
  if (depth > 100) {
    adjustedRates.epic *= 1.5;
    adjustedRates.legendary *= 2;
  }
  if (depth > 150) {
    adjustedRates.mythic *= 2;
    adjustedRates.divine *= 3;
  }
  if (depth > 180) {
    adjustedRates.celestial *= 3;
    adjustedRates.eternal *= 5;
    adjustedRates.omniversal *= 10;
  }

  // Normalize rates
  const totalRate = Object.values(adjustedRates).reduce((a, b) => a + b, 0);
  for (const rarity in adjustedRates) {
    adjustedRates[rarity] /= totalRate;
  }

  // Select rarity based on adjusted rates
  const random = Math.random();
  let cumulative = 0;
  let selectedRarity = 'common';
  for (const rarity in adjustedRates) {
    cumulative += adjustedRates[rarity];
    if (random <= cumulative) {
      selectedRarity = rarity;
      break;
    }
  }

  // Get creature of selected rarity
  const creaturesOfRarity = gameState.creatures.filter(c => c.rarity === selectedRarity);
  if (creaturesOfRarity.length === 0) return;

  const creatureType = creaturesOfRarity[Math.floor(Math.random() * creaturesOfRarity.length)];

  // Spawn creature near player
  const spawnDistance = 20 + Math.random() * 30;
  const angle = Math.random() * Math.PI * 2;
  const spawnX = gameState.player.position.x + Math.cos(angle) * spawnDistance;
  const spawnZ = gameState.player.position.z + Math.sin(angle) * spawnDistance;

  // Create 3D creature
  const creatureMesh = createCreatureMesh(creatureType);
  creatureMesh.position.set(spawnX, 1, spawnZ);
  creatureMesh.userData = { ...creatureType, id: Date.now() };

  gameState.scene.add(creatureMesh);
  gameState.creaturesInWorld.push(creatureMesh);

  // Remove creature after 30 seconds if not caught
  setTimeout(() => {
    if (gameState.creaturesInWorld.includes(creatureMesh)) {
      gameState.scene.remove(creatureMesh);
      const index = gameState.creaturesInWorld.indexOf(creatureMesh);
      gameState.creaturesInWorld.splice(index, 1);
    }
  }, 30000);
}

function createCreatureMesh(creatureData) {
  const group = new THREE.Group();

  const color = rarityColors[creatureData.rarity] || 0x808080;
  const geometry = new THREE.BoxGeometry(1.5, 1.5, 1.5);
  const material = new THREE.MeshStandardMaterial({ color });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.y = 0.75;
  mesh.castShadow = true;
  group.add(mesh);

  // Add glow effect for rare+ creatures
  if (['legendary', 'mythic', 'divine', 'celestial', 'eternal', 'omniversal'].includes(creatureData.rarity)) {
    const glowGeometry = new THREE.BoxGeometry(2, 2, 2);
    const glowMaterial = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.3
    });
    const glow = new THREE.Mesh(glowGeometry, glowMaterial);
    glow.position.y = 0.75;
    group.add(glow);
  }

  return group;
}

function tryCatchCreature() {
  if (!gameState.isGameRunning) return;

  // Find nearest creature
  let nearestCreature = null;
  let nearestDistance = Infinity;

  gameState.creaturesInWorld.forEach(creature => {
    const distance = gameState.player.position.distanceTo(creature.position);
    if (distance < nearestDistance && distance < 5) {
      nearestDistance = distance;
      nearestCreature = creature;
    }
  });

  if (nearestCreature) {
    startBattle(nearestCreature);
  }
}

function startBattle(creatureMesh) {
  const creatureData = creatureMesh.userData;

  // Initialize battle state
  gameState.inBattle = true;
  gameState.battleState = {
    enemyCreature: {
      ...creatureData,
      currentHp: creatureData.hp
    },
    playerCreature: {
      ...gameState.activeCreature,
      currentHp: gameState.activeCreature.currentHp
    },
    turn: 'player',
    battleMesh: creatureMesh
  };

  // Show battle UI
  showBattleUI();
}

function showBattleUI() {
  const battle = gameState.battleState;

  document.getElementById('player1-creatures').innerHTML = `
    <h3>${battle.playerCreature.name}</h3>
    <p>HP: ${battle.playerCreature.currentHp}/${battle.playerCreature.hp}</p>
    <p>Attack: ${battle.playerCreature.attack}</p>
    <p>Defense: ${battle.playerCreature.defense}</p>
  `;

  document.getElementById('player2-creatures').innerHTML = `
    <h3>${battle.enemyCreature.name}</h3>
    <p>HP: ${battle.enemyCreature.currentHp}/${battle.enemyCreature.hp}</p>
    <p>Attack: ${battle.enemyCreature.attack}</p>
    <p>Defense: ${battle.enemyCreature.defense}</p>
  `;

  showScreen('battle-ui');
}

async function performAttack() {
  if (!gameState.inBattle || gameState.battleState.turn !== 'player') return;

  const battle = gameState.battleState;

  // Player attacks
  const damage = Math.max(1, battle.playerCreature.attack - battle.enemyCreature.defense / 2);
  battle.enemyCreature.currentHp = Math.max(0, battle.enemyCreature.currentHp - damage);

  showNotification(`${battle.playerCreature.name} dealt ${Math.floor(damage)} damage!`, 'info');
  updateBattleUI();

  // Check if enemy defeated
  if (battle.enemyCreature.currentHp <= 0) {
    await winBattle();
    return;
  }

  // Enemy's turn
  battle.turn = 'enemy';
  setTimeout(() => {
    if (gameState.inBattle) {
      enemyAttack();
    }
  }, 1000);
}

function enemyAttack() {
  const battle = gameState.battleState;

  // First battle: guaranteed to win (enemy does minimal damage)
  let damage;
  if (gameState.isFirstBattle) {
    damage = 1;
  } else {
    damage = Math.max(1, battle.enemyCreature.attack - battle.playerCreature.defense / 2);
  }

  battle.playerCreature.currentHp = Math.max(0, battle.playerCreature.currentHp - damage);

  showNotification(`${battle.enemyCreature.name} dealt ${Math.floor(damage)} damage!`, 'info');
  updateBattleUI();

  // Check if player defeated
  if (battle.playerCreature.currentHp <= 0) {
    loseBattle();
    return;
  }

  // Player's turn
  battle.turn = 'player';
}

async function winBattle() {
  const battle = gameState.battleState;

  // Remove creature from world
  gameState.scene.remove(battle.battleMesh);
  const index = gameState.creaturesInWorld.indexOf(battle.battleMesh);
  if (index > -1) {
    gameState.creaturesInWorld.splice(index, 1);
  }

  // Add creature to player's inventory (replace current)
  gameState.activeCreature = {
    ...battle.enemyCreature,
    currentHp: battle.enemyCreature.hp
  };

  // Save to server
  await fetch('/api/creatures/catch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      userId: gameState.userId,
      creatureId: battle.enemyCreature.id,
      location: {
        x: battle.battleMesh.position.x,
        y: battle.battleMesh.position.y,
        z: battle.battleMesh.position.z
      }
    })
  });

  gameState.isFirstBattle = false;
  endBattle();
  showNotification(`You won! You now have ${battle.enemyCreature.name}!`, 'success');
}

function loseBattle() {
  // Player's creature faints, heal it
  gameState.battleState.playerCreature.currentHp = gameState.battleState.playerCreature.hp;
  gameState.activeCreature.currentHp = gameState.activeCreature.hp;

  endBattle();
  showNotification('Your creature fainted! It has been healed.', 'error');
}

function endBattle() {
  gameState.inBattle = false;
  gameState.battleState = null;

  showScreen('game-hud');
  document.getElementById('game-hud').classList.remove('hidden');
}

function updateBattleUI() {
  const battle = gameState.battleState;

  document.getElementById('player1-creatures').innerHTML = `
    <h3>${battle.playerCreature.name}</h3>
    <p>HP: ${battle.playerCreature.currentHp}/${battle.playerCreature.hp}</p>
    <p>Attack: ${battle.playerCreature.attack}</p>
    <p>Defense: ${battle.playerCreature.defense}</p>
  `;

  document.getElementById('player2-creatures').innerHTML = `
    <h3>${battle.enemyCreature.name}</h3>
    <p>HP: ${battle.enemyCreature.currentHp}/${battle.enemyCreature.hp}</p>
    <p>Attack: ${battle.enemyCreature.attack}</p>
    <p>Defense: ${battle.enemyCreature.defense}</p>
  `;
}

// Animation loop
let lastTime = performance.now();
let spawnTimer = 0;

function animate() {
  requestAnimationFrame(animate);

  const time = performance.now();
  const delta = (time - lastTime) / 1000;
  lastTime = time;

  updatePlayerMovement(delta);

  // Spawn creatures periodically
  spawnTimer += delta;
  if (spawnTimer > 3 && gameState.creaturesInWorld.length < 20) {
    spawnCreature();
    spawnTimer = 0;
  }

  // Update other players
  gameState.otherPlayers.forEach((playerData, userId) => {
    if (playerData.mesh) {
      playerData.mesh.position.set(
        playerData.position.x,
        playerData.position.y,
        playerData.position.z
      );
    }
  });

  gameState.renderer.render(gameState.scene, gameState.camera);
}

// API Functions
async function login(username, password) {
  try {
    const response = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });

    const data = await response.json();
    if (response.ok) {
      gameState.userId = data.userId;
      gameState.username = data.username;

      // Give player Lucas da Vucas as starter (only if first time)
      if (data.isNewUser) {
        const starterCreature = gameState.creatures.find(c => c.id === '0');
        if (starterCreature) {
          gameState.activeCreature = {
            ...starterCreature,
            currentHp: starterCreature.hp,
            userCreatureId: `uc-${Date.now()}`
          };

          // Save to server
          await fetch('/api/creatures/catch', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              userId: gameState.userId,
              creatureId: '0',
              location: { x: 0, y: 0, z: 0 }
            })
          });
        }
      }

      return data;
    } else {
      showNotification(data.error || 'Login failed', 'error');
      return null;
    }
  } catch (error) {
    console.error('Login error:', error);
    showNotification('Login failed', 'error');
    return null;
  }
}

async function loadCreatures() {
  try {
    const response = await fetch('/api/creatures');
    const data = await response.json();
    gameState.creatures = data;
    return data;
  } catch (error) {
    console.error('Error loading creatures:', error);
    return [];
  }
}

async function loadUserCreatures() {
  if (!gameState.userId) return;

  try {
    const response = await fetch(`/api/users/${gameState.userId}/creatures`);
    const data = await response.json();
    gameState.userCreatures = data;
    return data;
  } catch (error) {
    console.error('Error loading user creatures:', error);
    return [];
  }
}

async function loadLobbies() {
  try {
    const response = await fetch('/api/lobbies');
    const data = await response.json();
    return data;
  } catch (error) {
    console.error('Error loading lobbies:', error);
    return [];
  }
}

async function joinLobby(lobbyId) {
  try {
    const response = await fetch(`/api/lobbies/${lobbyId}/join`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: gameState.userId })
    });

    if (response.ok) {
      const data = await response.json();
      gameState.currentLobby = data.lobbyId || lobbyId;
      return true;
    }
    return false;
  } catch (error) {
    console.error('Error joining lobby:', error);
    return false;
  }
}

async function handleJoinLobby(lobbyId) {
  const success = await joinLobby(lobbyId);
  if (success) {
    gameState.socket.emit('join_lobby', {
      lobbyId: gameState.currentLobby,
      userId: gameState.userId,
      username: gameState.username
    });
    showScreen('game-hud');
    updateActiveCreatureInfo();
  } else {
    showNotification('Failed to join lobby', 'error');
  }
}

// Socket.io
function setupSocket() {
  gameState.socket = io();

  gameState.socket.on('connect', () => {
    console.log('Connected to server');
  });

  gameState.socket.on('player_joined', (data) => {
    console.log('Player joined:', data);
    // Create other player mesh
    const playerGeometry = new THREE.BoxGeometry(1, 2, 1);
    const playerMaterial = new THREE.MeshStandardMaterial({ color: 0xFF0000 });
    const playerMesh = new THREE.Mesh(playerGeometry, playerMaterial);
    playerMesh.position.y = 1;
    gameState.scene.add(playerMesh);

    gameState.otherPlayers.set(data.userId, {
      username: data.username,
      mesh: playerMesh,
      position: { x: 0, y: 1, z: 0 }
    });
  });

  gameState.socket.on('player_left', (data) => {
    console.log('Player left:', data);
    const playerData = gameState.otherPlayers.get(data.userId);
    if (playerData && playerData.mesh) {
      gameState.scene.remove(playerData.mesh);
    }
    gameState.otherPlayers.delete(data.userId);
  });

  gameState.socket.on('player_moved', (data) => {
    const playerData = gameState.otherPlayers.get(data.userId);
    if (playerData) {
      playerData.position = data.position;
    }
  });

  gameState.socket.on('chat_message', (data) => {
    addChatMessage(data.username, data.message);
  });

  gameState.socket.on('creature_caught', (data) => {
    console.log('Creature caught by another player:', data);
  });

  gameState.socket.on('trade_request', (data) => {
    showNotification('Trade request received!', 'info');
  });

  gameState.socket.on('battle_challenge', (data) => {
    showNotification('Battle challenge received!', 'info');
  });
}

// UI Functions
function showScreen(screenId) {
  document.querySelectorAll('.screen').forEach(screen => screen.classList.add('hidden'));
  document.getElementById(screenId).classList.remove('hidden');
}

function showNotification(message, type = 'info') {
  const notifications = document.getElementById('notifications');
  const notification = document.createElement('div');
  notification.className = `notification ${type}`;
  notification.textContent = message;
  notifications.appendChild(notification);

  setTimeout(() => {
    notification.remove();
  }, 3000);
}

function addChatMessage(username, message) {
  const chatMessages = document.getElementById('chat-messages');
  const messageDiv = document.createElement('div');
  messageDiv.textContent = `${username}: ${message}`;
  chatMessages.appendChild(messageDiv);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

function updateActiveCreatureInfo() {
  const infoDiv = document.getElementById('active-creature-info');
  if (gameState.activeCreature) {
    infoDiv.innerHTML = `
      <p style="color: #FFD700; margin-top: 10px;">Active Creature:</p>
      <p>${gameState.activeCreature.name}</p>
      <p>HP: ${gameState.activeCreature.currentHp}/${gameState.activeCreature.hp}</p>
    `;
  } else {
    infoDiv.innerHTML = '<p style="color: #FFD700; margin-top: 10px;">No active creature</p>';
  }
}

function storeCreatureInPen() {
  if (!gameState.activeCreature) {
    showNotification('No creature to store!', 'error');
    return;
  }

  // Store the creature (already saved to server when caught)
  // Clear active creature
  gameState.activeCreature = null;
  updateActiveCreatureInfo();
  showNotification('Creature stored in pen!', 'success');
}

function sendChatMessage() {
  const chatInput = document.getElementById('chat-input');
  const message = chatInput.value.trim();

  if (message && gameState.socket && gameState.currentLobby) {
    gameState.socket.emit('lobby_chat', {
      lobbyId: gameState.currentLobby,
      userId: gameState.userId,
      username: gameState.username,
      message
    });
    chatInput.value = '';
  }
}

async function renderLobbyList() {
  const lobbies = await loadLobbies();
  const lobbyList = document.getElementById('lobby-list');
  lobbyList.innerHTML = '';

  lobbies.forEach(lobby => {
    const lobbyDiv = document.createElement('div');
    lobbyDiv.className = 'lobby-item';
    lobbyDiv.innerHTML = `
      <span>${lobby.name}</span>
      <span>${lobby.current_players}/${lobby.max_players}</span>
      <button class="join-lobby-btn" data-lobby-id="${lobby.id}">Join</button>
    `;
    lobbyList.appendChild(lobbyDiv);
  });

  // Add event listeners to join buttons
  document.querySelectorAll('.join-lobby-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const lobbyId = btn.dataset.lobbyId;
      await handleJoinLobby(lobbyId);
    });
  });
}

async function renderCollection() {
  const creatures = await loadUserCreatures();
  const creatureGrid = document.getElementById('creature-grid');
  creatureGrid.innerHTML = '';

  creatures.forEach(userCreature => {
    const creature = userCreature.creature;
    const creatureDiv = document.createElement('div');
    creatureDiv.className = `creature-card ${creature.rarity}`;
    creatureDiv.innerHTML = `
      <h3>${creature.name}</h3>
      <p class="rarity">${creature.rarity}</p>
      <p>Attack: ${creature.attack}</p>
      <p>Defense: ${creature.defense}</p>
      <p>Speed: ${creature.speed}</p>
      <p>HP: ${creature.hp}</p>
    `;
    creatureGrid.appendChild(creatureDiv);
  });
}

// Initialize game
async function init() {
  initThreeJS();
  setupControls();
  setupSocket();

  await loadCreatures();

  // Setup UI event listeners
  document.getElementById('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = document.getElementById('username-input').value.trim();
    const password = document.getElementById('password-input').value.trim();
    if (username && password) {
      const result = await login(username, password);
      if (result) {
        showScreen('dashboard');
        document.getElementById('dashboard-username').textContent = username;
        await loadUserCreatures();
        const creatures = await loadUserCreatures();
        document.getElementById('dashboard-stats').textContent = `${creatures.length} Creatures Collected`;
        showNotification(`Welcome, ${username}!`, 'success');
      }
    }
  });

  document.getElementById('btn-play').addEventListener('click', async () => {
    if (!gameState.userId) {
      showNotification('Please login first!', 'error');
      return;
    }

    // Quick join - find available lobby
    const lobbies = await loadLobbies();
    const availableLobby = lobbies.find(l => l.current_players < l.max_players);

    if (availableLobby) {
      await handleJoinLobby(availableLobby.id);
    } else {
      showNotification('No available lobbies', 'error');
    }
  });

  document.getElementById('btn-servers').addEventListener('click', () => {
    renderLobbyList();
    showScreen('server-browser');
  });

  document.getElementById('btn-collection').addEventListener('click', async () => {
    await renderCollection();
    showScreen('collection-view');
  });

  document.getElementById('btn-settings').addEventListener('click', () => {
    showScreen('settings');
  });

  document.getElementById('btn-close-servers').addEventListener('click', () => {
    showScreen('dashboard');
  });

  document.getElementById('btn-close-collection').addEventListener('click', () => {
    showScreen('dashboard');
  });

  document.getElementById('btn-close-settings').addEventListener('click', () => {
    showScreen('dashboard');
  });

  document.getElementById('btn-logout').addEventListener('click', () => {
    gameState.userId = null;
    gameState.username = null;
    gameState.activeCreature = null;
    showScreen('login-screen');
    document.getElementById('username-input').value = '';
    document.getElementById('password-input').value = '';
  });

  document.getElementById('btn-menu').addEventListener('click', () => {
    document.getElementById('game-hud').classList.add('hidden');
    showScreen('dashboard');
  });

  document.getElementById('btn-catch').addEventListener('click', () => {
    tryCatchCreature();
  });

  document.getElementById('btn-store').addEventListener('click', () => {
    storeCreatureInPen();
  });

  document.getElementById('btn-attack').addEventListener('click', () => {
    performAttack();
  });

  document.getElementById('btn-exit-battle').addEventListener('click', () => {
    if (gameState.inBattle) {
      loseBattle(); // Forfeit battle
    }
  });
}

// Start the game
init();
