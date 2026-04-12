import { Terrain } from '../terrain/Terrain.js';
import { Actor } from './Actor.js';

/**
 * Manages the global simulation of actors across the infinite world.
 * Tracks which actors are in which chunks and handles their migration.
 */
export class WorldSim {
  constructor(terrain, characters, propLib) {
    this.terrain = terrain;
    this.characters = characters;
    this.propLib = propLib;
    this.seaLevel = 15;

    // Map<integer key, Set<Actor>>
    this.simChunks = new Map();

    // Stats for UI
    this.populationSize = 0;
    this.activeActorCount = 0;

    this.criticalActors = new Set();
    
    // Fixed Timestep Simulation
    this.accumulator = 0;
    this.STEP = 1 / 60;
  }

  /**
   * Get or create simulation data for a chunk.
   */
  getChunkState(key, tx, ty) {
    let state = this.simChunks.get(key);
    if (!state) {
      state = {
        key,
        tx, ty,
        actors: new Set(),
        isPopulated: false
      };
      this.simChunks.set(key, state);
    }
    return state;
  }

  /**
   * Spawn actors into a chunk if it's the first time we see it.
   */
  spawnForChunk(chunk, rng) {
    const simState = this.getChunkState(chunk.key, chunk.x, chunk.y);
    if (simState.isPopulated) {
      // Re-visualize existing actors that might have been hibernating
      for (const actor of simState.actors) {
        actor.visualize(this.characters, this.propLib);
      }
      return;
    }

    // First time spawning in this chunk
    const count = 140; // ~5000 total in visible range
    const worldX = chunk.x * this.terrain.chunkScale;
    const worldZ = chunk.y * this.terrain.chunkScale;
    const span = this.terrain.tileRowSize * this.terrain.chunkScale;

    for (let i = 0; i < count; i++) {
      const x = worldX + rng() * span;
      const z = worldZ + rng() * span;
      const y = this.terrain.getHeightAt(x, z);

      if (y < this.seaLevel) continue;

      // Critical mission check: ~1% of population
      const isCritical = rng() < 0.01;
      const actor = new Actor({
        charID: (rng() * 100) | 0,
        sheetName: 'antifarea',
        position: { x, y, z },
        currentChunkKey: chunk.key,
        isCritical: isCritical,
        userScale: isCritical ? 20.0 : 1.0
      });

      simState.actors.add(actor);
      if (isCritical) this.criticalActors.add(actor);
      this.populationSize++;

      // Add visual representation
      actor.visualize(this.characters, this.propLib);
    }

    // Pass 2: Spawn Static Props (Altars on peaks, etc)
    // (Reusing worldX, worldZ, span from above)
    
    // Altars on high ground
    if (rng() < 0.8) { // Increased from 0.3
      for(let i=0; i<2; i++) {
        const x = worldX + rng() * span;
        const z = worldZ + rng() * span;
        const y = this.terrain.getHeightAt(x, z);
        if (y > 25) { // Lowered from 40
          const altar = new Actor({
            visualType: 'mesh',
            modelName: 'altar',
            isStatic: true,
            position: { x, y, z },
            currentChunkKey: chunk.key,
            userScale: 5.0 // Increased from 1.5
          });
          simState.actors.add(altar);
          altar.visualize(this.characters, this.propLib);
          console.log(`[Prop] Spawned Altar at (${x.toFixed(1)}, ${y.toFixed(1)}, ${z.toFixed(1)})`);
        }
      }
    }

    // Graves and Trunks in valleys
    const propCount = (rng() * 10) | 0; // Increased from 5
    for (let i = 0; i < propCount; i++) {
      const x = worldX + rng() * span;
      const z = worldZ + rng() * span;
      const y = this.terrain.getHeightAt(x, z);
      if (y > this.seaLevel && y < 30) {
        const type = rng() < 0.5 ? 'grave' : 'trunk';
        const prop = new Actor({
          visualType: 'mesh',
          modelName: type,
          isStatic: true,
          position: { x, y: y - 0.2, z },
          currentChunkKey: chunk.key,
          userScale: 3.0 // Increased from 1.0
        });
        simState.actors.add(prop);
        prop.visualize(this.characters, this.propLib);
      }
    }

    simState.isPopulated = true;
  }

  /**
   * Hibernate actors in a chunk being evicted from view.
   */
  evictChunk(chunk) {
    const simState = this.simChunks.get(chunk.key);
    if (!simState) return;

    for (const actor of simState.actors) {
      actor.hibernate(this.propLib);
    }
  }

  /**
   * Global update loop for the simulation.
   */
  update(delta, time, camera, rng) {
    // 1. Update the UI count by summing the sizes of all active-chunk actor sets.
    let count = 0;
    for (const [key, chunk] of this.terrain.activeChunks) {
      const state = this.simChunks.get(key);
      if (state) count += state.actors.size;
    }
    this.activeActorCount = count;

    // 2. Consume delta in fixed logical steps
    this.accumulator += delta;

    // To prevent "Spiral of Death" on extremely slow machines, clamp the accumulator
    if (this.accumulator > 0.25) this.accumulator = 0.25;

    while (this.accumulator >= this.STEP) {
      this.accumulator -= this.STEP;

      // Update actors in visible chunks
      for (const [key, chunk] of this.terrain.activeChunks) {
        const simState = this.simChunks.get(key);
        if (!simState) continue;

        for (const actor of simState.actors) {
          const result = actor.update(this.STEP, time, this.terrain, rng, this.seaLevel);
          if (result?.moved) {
            this.handleMigration(actor, result.from, result.to);
          }
          actor.sync();
          if (actor.sprite && actor.sprite.update) actor.sprite.update(camera);
        }
      }

      // Update critical actors
      for (const actor of this.criticalActors) {
        // Optimization: If already updated in the active-chunk loop, skip.
        // We use a local counter or flag for this specific logic step.
        // However, in the 60Hz loop, we just need to avoid double-processing.
        // We'll use a local 'step' identifier or just check visibility.
        if (this.terrain.activeChunks.has(actor.currentChunkKey)) continue;
        const result = actor.update(this.STEP, time, this.terrain, rng, this.seaLevel);
        if (result?.moved) {
          this.handleMigration(actor, result.from, result.to);
        }
        actor.sync();
      }
    }
  }

  /**
   * Move an actor from one chunk's registry to another.
   */
  handleMigration(actor, fromKey, toKey) {
    const fromState = this.simChunks.get(fromKey);
    const toState = this.getChunkState(toKey);

    if (fromState) fromState.actors.delete(actor);
    toState.actors.add(actor);

    // If migrating into a rendered chunk or out of one, update visual state
    const isToVisible = this.terrain.activeChunks.has(toKey);
    const isFromVisible = this.terrain.activeChunks.has(fromKey);

    if (isToVisible && !isFromVisible) {
      actor.visualize(this.characters, this.propLib);
    } else if (!isToVisible && isFromVisible) {
      actor.hibernate(this.propLib);
    }
  }
}
