import * as THREE from 'three';
import { Terrain } from '../terrain/Terrain.js';

/**
 * An Actor represents a persistent entity in the simulation.
 * It is decoupled from its visual "sprite" representation.
 */
export class Actor {
  constructor(options = {}) {
    this.charID = options.charID || 0;
    this.sheetName = options.sheetName || 'antifarea';
    this.position = new THREE.Vector3().copy(options.position || new THREE.Vector3());
    this.isCritical = options.isCritical || false;
    this.userScale = options.userScale || 1.0;
    
    this.currentChunkKey = options.currentChunkKey || 0;
    this.homeChunkKey = this.currentChunkKey;

    // AI / Simulation state
    this.userData = {
      destination: new THREE.Vector3().copy(this.position),
      target: new THREE.Vector3().copy(this.position),
      nextActionTime: 0,
    };

    // Rendering reference (null when hibernating/off-screen)
    this.sprite = null;
    this.mesh = null;
    
    this.visualType = options.visualType || 'sprite'; // 'sprite' or 'mesh'
    this.modelName = options.modelName || null;
    this.isStatic = options.isStatic || false;
  }

  /**
   * Update actor logic (movement, AI). 
   * Runs even when off-screen (if critical or within sim radius).
   */
  update(delta, time, terrain, rng, seaLevel = -999) {
    if (this.isStatic) return null;
    
    const state = this.userData;

    // Pick new wander destination
    if (time > state.nextActionTime) {
      state.destination.set(
        this.position.x + (rng() - 0.5) * 100,
        0,
        this.position.z + (rng() - 0.5) * 100
      );
      state.nextActionTime = time + 2 + rng() * 3;
    }

    // Move towards destination
    const dx = state.destination.x - this.position.x;
    const dz = state.destination.z - this.position.z;
    const distSq = dx * dx + dz * dz;

    if (distSq > 1) {
      const invDist = 1.0 / Math.sqrt(distSq);
      const step = 10 * delta;
      state.target.x = this.position.x + dx * invDist * step;
      state.target.z = this.position.z + dz * invDist * step;
    } else {
      state.target.x = this.position.x;
      state.target.z = this.position.z;
    }

    state.target.y = terrain.getHeightAt(state.target.x, state.target.z);

    // Water avoidance logic
    if (state.target.y < seaLevel) {
      // 1. Restore position to previous dry frame
      state.target.copy(this.position);
      
      // 2. Reverse direction relative to current position
      // Calculation: new_dest = current_pos - (dest - current_pos)
      state.destination.x = this.position.x - (state.destination.x - this.position.x);
      state.destination.z = this.position.z - (state.destination.z - this.position.z);
      
      // 3. Force AI delay to prevent rapid oscillation
      state.nextActionTime = time + 1.0;
    }

    // After moving, check if we crossed a chunk boundary
    const tileSpan = terrain.tileRowSize * terrain.chunkScale;
    const tx = Math.floor(state.target.x / tileSpan);
    const ty = Math.floor(state.target.z / tileSpan);
    const newKey = Terrain.chunkKey(tx, ty);

    // Smoothly follow target (or jump for now to keep simple)
    this.position.copy(state.target);

    if (newKey !== this.currentChunkKey) {
      const oldKey = this.currentChunkKey;
      this.currentChunkKey = newKey;
      // Signal to simulation that we moved
      return { moved: true, from: oldKey, to: newKey };
    }

    return null;
  }

  /**
   * Attach a visual representation (sprite or mesh).
   */
  visualize(characters, propLib) {
    if (this.sprite || this.mesh) return; // Already visible

    if (this.visualType === 'sprite') {
      this.sprite = characters.addSprite(this.sheetName, this.position, this.charID);
      this.sprite.userData.target.copy(this.userData.target);
      this.sprite.scale.multiplyScalar(this.userScale);
      this.sprite.write();
    } else if (this.visualType === 'mesh' && propLib) {
      this.mesh = propLib.createProp(this.modelName);
      if (this.mesh) {
        this.mesh.position.copy(this.position);
        this.mesh.scale.multiplyScalar(this.userScale);
        propLib.scene.add(this.mesh);
      }
    }
  }

  /**
   * Release the visual slot.
   */
  hibernate(propLib) {
    if (this.sprite) {
      const buffer = this.sprite.userData.spriteBuffer;
      if (buffer) buffer.free(this.sprite);
      this.sprite = null;
    }
    
    if (this.mesh && propLib) {
      propLib.scene.remove(this.mesh);
      this.mesh = null;
    }
  }

  /**
   * Sync logical position to the sprite representation (if visible).
   */
  sync() {
    if (this.sprite) {
      this.sprite.userData.target.copy(this.position);
      // Sprite.update in CharacterSprites will handle the final write() and orientation
    }
  }
}
