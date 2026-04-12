import * as THREE from 'three';
import * as Noise from '../utils/Noise.js';
import { TerrainShader } from './TerrainShader.js';

/**
 * Infinite chunk-based procedural terrain.
 */
export class Terrain {
  constructor(scene, options = {}) {
    this.scene = scene;
    this.ntiles = options.ntiles || 5;
    this.tileRowSize = options.tileRowSize || 64;
    this.chunkScale = options.chunkScale || 5;
    this.max_row = 32000;

    this.activeChunks = new Map();
    this.chunkRequests = [];
    this.lastCoord = { x: null, y: null };

    this.terrainShader = new TerrainShader().material;

    // Reusable vectors for performance
    this.v0 = new THREE.Vector3();
    this.v1 = new THREE.Vector3();
    this.v2 = new THREE.Vector3();
    this.v3 = new THREE.Vector3();
    this.v4 = new THREE.Vector3();
    this.v5 = new THREE.Vector3();
    this.v6 = new THREE.Vector3();
    this.v7 = new THREE.Vector3();

    this.terrainParams = [0.001, 10, 0.01, 5, 0.03, 2, 0.1, 1];
    this.colorParams = [0.03, 1];
  }

  getNoiseY(x, z) {
    let y = 0;
    for (let i = 0; i < this.terrainParams.length; i += 2) {
      y += Noise.simplex2(x * this.terrainParams[i], z * this.terrainParams[i]) * this.terrainParams[i + 1];
    }
    return y;
  }

  getNoiseColor(x, z, target) {
    const y = this.getNoiseY(x, z);

    // Simple slope calculation by sampling neighbors
    const eps = 0.1;
    const yNR = this.getNoiseY(x + eps, z);
    const yNF = this.getNoiseY(x, z + eps);
    const slope = Math.sqrt(Math.pow(yNR - y, 2) + Math.pow(yNF - y, 2)) / eps;

    /** Helper for smooth transitions: returns 0-1 range */
    const blend = (val, start, end) => {
      if (val < start) return 0;
      if (val > end) return 1;
      return (val - start) / (end - start);
    };

    // Correct for world-space scaling
    const worldY = y * this.chunkScale;

    // Add noise-based fuzzing to the height boundaries (±2.0 units)
    const fuzz = (Noise.simplex2(x * 0.1, z * 0.1) * 2.0);
    const fy = worldY + fuzz;

    let rock = 0, grass = 0, snow = 0, sand = 0;

    // 1. Rock / Cliffs (Slope based)
    // Steep slopes always show rock/cliffs
    if (slope > 0.6) {
      rock = blend(slope, 0.6, 0.9);
    }

    // 2. Sand (Shoreline)
    // Centered at 15.0. Fades in/out around that point.
    if (fy > -100 && fy < 17.5) {
      // Triangle weighting for the beach belt
      sand = 1.0 - Math.abs(fy - 15.0) / 2.5;
      sand = Math.max(0, sand);
    }

    // 3. Grass (The main landmass)
    if (fy > 16.0) {
      grass = blend(fy, 16.0, 18.0);

      // Thin the grass out at high altitudes for alpine rock/snow
      if (fy > 35.0) {
        grass *= (1.0 - blend(fy, 35.0, 45.0));
      }
    }

    // 4. Snow (High caps)
    if (fy > 45.0) {
      snow = blend(fy, 45.0, 55.0);
    }

    // target stores (rock, grass, snow, sand) mapped to (x, y, z, w)
    target.set(rock, grass, snow, sand);
    return target;
  }

  /** Pack chunk grid coordinates into a single integer Map key. Supports ±32767. */
  static chunkKey(tx, ty) {
    return ((tx + 0x8000) & 0xFFFF) * 65536 + ((ty + 0x8000) & 0xFFFF);
  }

  generateChunkData(ux, uy) {
    const size = this.tileRowSize;
    const rowsz = size + 3;
    const totalVertices = rowsz * rowsz;

    const positions = new Float32Array(totalVertices * 3);
    const colors = new Float32Array(totalVertices * 4);
    const uvs = new Float32Array(totalVertices * 2);

    let vIdx = 0;
    let cIdx = 0;
    let uvIdx = 0;

    const v4 = new THREE.Vector4();

    for (let x = ux - 1; x < ux + size + 2; x++) {
      for (let y = uy - 1; y < uy + size + 2; y++) {
        const py = this.getNoiseY(x, y);
        positions[vIdx] = x * this.chunkScale;
        positions[vIdx + 1] = py * this.chunkScale;
        positions[vIdx + 2] = y * this.chunkScale;

        this.getNoiseColor(x, y, v4);
        colors[cIdx] = v4.x;
        colors[cIdx + 1] = v4.y;
        colors[cIdx + 2] = v4.z;
        colors[cIdx + 3] = v4.w;

        uvs[uvIdx] = x * 0.1;
        uvs[uvIdx + 1] = y * 0.1;

        vIdx += 3;
        cIdx += 4;
        uvIdx += 2;
      }
    }

    const indices = [];
    const trimmedIndices = [];

    // Full index
    for (let x = 0; x < size + 2; x++) {
      for (let y = 0; y < size + 2; y++) {
        const i0 = x + y * rowsz;
        const i1 = (x + 1) + y * rowsz;
        const i2 = (x + 1) + (y + 1) * rowsz;
        const i3 = x + (y + 1) * rowsz;
        indices.push(i0, i1, i2, i2, i3, i0);
      }
    }

    // Trimmed index (for high quality normals/no edge artifacts)
    for (let x = 1; x < size + 1; x++) {
      for (let y = 1; y < size + 1; y++) {
        const i0 = x + y * rowsz;
        const i1 = (x + 1) + y * rowsz;
        const i2 = (x + 1) + (y + 1) * rowsz;
        const i3 = x + (y + 1) * rowsz;
        trimmedIndices.push(i0, i1, i2, i2, i3, i0);
      }
    }

    return { positions, colors, uvs, indices, trimmedIndices };
  }

  createChunk(x, y) {
    const data = this.generateChunkData(x, y);
    const geom = new THREE.BufferGeometry();

    geom.setAttribute('position', new THREE.BufferAttribute(data.positions, 3));
    geom.setAttribute('splatWeights', new THREE.BufferAttribute(data.colors, 4));
    geom.setAttribute('uv', new THREE.BufferAttribute(data.uvs, 2));

    // Compute normals using the full set of vertices first
    geom.setIndex(data.indices);
    geom.computeVertexNormals();

    // Then set the trimmed index for final rendering
    geom.setIndex(data.trimmedIndices);
    geom.computeBoundingSphere();

    const mesh = new THREE.Mesh(geom, this.terrainShader);
    mesh.receiveShadow = true;
    mesh.castShadow = true;
    mesh.layers.set(10); // Isolated Layer for G-Buffer pass

    this.scene.add(mesh);

    // Pre-compute per-chunk constants used by getHeightAt every frame
    const rowsz = this.tileRowSize + 3;
    const startIdx = (1 * rowsz + 1) * 3;
    return {
      mesh,
      x, y,
      rowsz,
      ax: data.positions[startIdx],     // world x of anchor vertex (1,1)
      az: data.positions[startIdx + 2], // world z of anchor vertex (1,1)
      positions: data.positions,
    };
  }

  update(viewerPos, onChunkAdded, onChunkRemoved) {
    const tx = Math.floor(viewerPos.x / (this.tileRowSize * this.chunkScale));
    const ty = Math.floor(viewerPos.z / (this.tileRowSize * this.chunkScale));

    if (tx !== this.lastCoord.x || ty !== this.lastCoord.y) {
      this.lastCoord.x = tx;
      this.lastCoord.y = ty;

      // Evict chunks that have scrolled out of range
      const evictRadius = this.ntiles + 1;
      for (const [key, chunk] of this.activeChunks) {
        if (Math.abs(chunk.wx - tx) > evictRadius || Math.abs(chunk.wy - ty) > evictRadius) {
          if (chunk.mesh) {
            chunk.mesh.geometry.dispose();
            this.scene.remove(chunk.mesh);
          }
          // Also cancel any pending request for this chunk
          this.chunkRequests = this.chunkRequests.filter(r => r.key !== key);
          this.activeChunks.delete(key);
          if (onChunkRemoved) onChunkRemoved(chunk);
        }
      }

      // Queue new chunks within range
      for (let x = -this.ntiles; x < this.ntiles; x++) {
        for (let y = -this.ntiles; y < this.ntiles; y++) {
          const wx = x + tx;
          const wy = y + ty;
          const key = Terrain.chunkKey(wx, wy);
          if (!this.activeChunks.has(key)) {
            const chunkInfo = { wx, wy, key };
            this.activeChunks.set(key, chunkInfo);
            this.chunkRequests.push(chunkInfo);
          }
        }
      }
    }

    // Process one chunk request per frame to avoid stutters
    if (this.chunkRequests.length > 0) {
      const ck = this.chunkRequests.shift();
      // Skip if evicted while waiting
      if (this.activeChunks.has(ck.key)) {
        const chunk = this.createChunk(ck.wx * this.tileRowSize, ck.wy * this.tileRowSize);
        Object.assign(ck, chunk);
        if (onChunkAdded) onChunkAdded(ck);
      }
    }
  }

  getHeightAt(x, z) {
    const tileSpan = this.tileRowSize * this.chunkScale;
    const tx = Math.floor(x / tileSpan);
    const ty = Math.floor(z / tileSpan);

    // Single-entry chunk cache — avoids string alloc + Map lookup for most calls
    // (actors/camera rarely cross chunk boundaries between consecutive frames)
    let chunk = this._cachedChunk;
    if (!chunk || chunk._tx !== tx || chunk._ty !== ty) {
      const key = Terrain.chunkKey(tx, ty);
      chunk = this.activeChunks.get(key);
      if (chunk) { chunk._tx = tx; chunk._ty = ty; }
      this._cachedChunk = chunk;
    }
    if (!chunk || !chunk.positions) return 0;

    const { rowsz, ax, az, positions: p } = chunk;

    // Local fractional position within the chunk grid
    const rx = (x - ax) / this.chunkScale;
    const ry = (z - az) / this.chunkScale;
    const fx = Math.floor(rx);
    const fy = Math.floor(ry);
    const cx = rx - fx;
    const cy = ry - fy;

    // Vertex indices — outer loop=x, inner loop=y in generateChunkData
    const vi = (fx + 1) * rowsz + (fy + 1);

    // Read only the Y (height) component — no Vector3 allocation needed
    const h00 = p[vi * 3 + 1];
    const h01 = p[(vi + 1) * 3 + 1];
    const h10 = p[(vi + rowsz) * 3 + 1];
    const h11 = p[(vi + rowsz + 1) * 3 + 1];

    // Bilinear interpolation (inlined, no THREE.MathUtils overhead)
    const h0 = h00 + (h10 - h00) * cx;
    const h1 = h01 + (h11 - h01) * cx;
    return h0 + (h1 - h0) * cy;
  }
}
