import * as THREE from 'three';
import { Engine } from './Engine.js';
import { Terrain } from './terrain/Terrain.js';
import { CharacterSprites } from './sprites/CharacterSprites.js';

/**
 * Seeded LCG random number generator — deterministic, reproducible layout.
 * Same seed = same forest/actor placement every reload.
 */
function makeRng(seed = 0xdeadbeef) {
  let s = seed >>> 0;
  return () => {
    s = Math.imul(s, 1664525) + 1013904223 | 0;
    return (s >>> 0) / 0xffffffff;
  };
}

/**
 * Main application entry point.
 * async so we can await characters.ready before starting the engine,
 * guaranteeing sprite buffers exist on the first terrain chunk callback.
 */
async function startApp() {
  const engine = new Engine();
  const scene = engine.scene;

  // Lights
  const ambientLight = new THREE.AmbientLight(0xffffff, 0.8);
  scene.add(ambientLight);

  const sun = new THREE.DirectionalLight(0xffffff, 1.2);
  sun.position.set(500, 1000, 250);
  sun.castShadow = true;
  sun.shadow.mapSize.width = sun.shadow.mapSize.height = 2048;
  sun.shadow.camera.left = sun.shadow.camera.bottom = -1000;
  sun.shadow.camera.right = sun.shadow.camera.top = 1000;
  scene.add(sun);

  // Terrain
  const terrain = new Terrain(scene, { ntiles: 6 });

  // Wait for all sprite textures to finish loading before proceeding.
  // This guarantees spriteBuffers are fully initialised when the first
  // terrain chunk arrives, so no retry logic is needed in populateChunk.
  const characters = new CharacterSprites(scene);
  await characters.ready;

  const actors = [];

  // Seeded RNGs — separate seeds so tree/actor layouts are independent
  const treeRng = makeRng(0xc0ffee);
  const actorRng = makeRng(0xdeadbeef);

  // Track tree sprites per chunk key so they can be freed on eviction
  const chunkSprites = new Map();

  const populateChunk = (chunk) => {
    const sprites = [];
    chunkSprites.set(chunk.key, sprites);

    const worldX = chunk.x * terrain.chunkScale;
    const worldZ = chunk.y * terrain.chunkScale;
    const span = terrain.tileRowSize * terrain.chunkScale;

    for (let i = 0; i < 2000; i++) {
      const x = worldX + treeRng() * span;
      const z = worldZ + treeRng() * span;
      const y = terrain.getHeightAt(x, z);

      const tree = characters.addSprite('forest', new THREE.Vector3(x, y - 0.5, z), (treeRng() * 16) | 0);
      // Random scale: 0.5–2.5x, with rare 3× big trees
      const s = treeRng() < 0.001 ? 3 : (treeRng() * 2) + 0.5;
      tree.scale.set(s, s, s);
      tree.write();
      sprites.push(tree);
    }
  };

  const evictChunk = (chunk) => {
    const sprites = chunkSprites.get(chunk.key);
    if (sprites) {
      const buf = characters.spriteBuffers.forest;
      if (buf) {
        for (const spr of sprites) buf.free(spr);
      }
      chunkSprites.delete(chunk.key);
    }
  };

  // Spawn actors — safe to call directly since we awaited characters.ready
  for (let i = 0; i < 50000; i++) {
    const x = (actorRng() - 0.5) * 200;
    const z = (actorRng() - 0.5) * 200;
    const y = terrain.getHeightAt(x, z);
    const actor = characters.addSprite('antifarea', new THREE.Vector3(x, y, z), (actorRng() * 100) | 0);
    actor.userData.nextActionTime = 0;
    actor.userData.destination = new THREE.Vector3(x, 0, z);
    actors.push(actor);
  }

  engine.on('update', (delta, time) => {
    const camPos = engine.camera.position;
    terrain.update(camPos, populateChunk, evictChunk);

    // Update actors
    characters.beginUpdate(engine.camera);

    for (const actor of actors) {
      const state = actor.userData;

      // Basic AI: pick a new wander destination periodically
      if (time > state.nextActionTime) {
        state.destination.set(
          actor.position.x + (actorRng() - 0.5) * 100,
          0,
          actor.position.z + (actorRng() - 0.5) * 100
        );
        state.nextActionTime = time + 2 + actorRng() * 3;
      }

      // Move towards destination — use distSq to avoid sqrt when not needed
      const dx = state.destination.x - actor.position.x;
      const dz = state.destination.z - actor.position.z;
      const distSq = dx * dx + dz * dz;
      if (distSq > 1) {
        const invDist = 1.0 / Math.sqrt(distSq);
        const step = 10 * delta;
        state.target.x = actor.position.x + dx * invDist * step;
        state.target.z = actor.position.z + dz * invDist * step;
      } else {
        state.target.x = actor.position.x;
        state.target.z = actor.position.z;
      }
      state.target.y = terrain.getHeightAt(state.target.x, state.target.z);

      if (actor.update) actor.update(engine.camera);
    }

    // Clamp camera above terrain surface
    const floorH = terrain.getHeightAt(camPos.x, camPos.z) + 2;
    if (camPos.y < floorH) {
      const dy = floorH - camPos.y;
      camPos.y = floorH;
      engine.controls.target.y += dy;
    }
  });

  engine.start();
}

startApp();
