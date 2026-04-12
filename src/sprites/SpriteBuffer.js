import * as THREE from 'three'

/**
 * Performance-optimized instanced sprite system.
 * Handles billboarding and UV animation in the shader.
 *
 * Key design notes:
 * - write() reads target.userData.index dynamically, so swapping slots in free()
 *   requires no closure patching — just update the index field.
 * - isDynamic=false buffers skip aIUV upload every frame (static tile sprites).
 * - free() uses O(1) swap-last to reclaim slots without buffer shifting.
 */
export class SpriteBuffer {
  constructor({ maxSprites = 100000, texture, dynamic = true }) {
    this.maxSprites = maxSprites;
    this.texture = texture;
    this.isDynamic = dynamic;
    this.instances = []; // back-references for swap-last free

    this.baseMat = new THREE.MeshBasicMaterial({
      map: texture,
      transparent: false,
      side: THREE.DoubleSide,
      alphaTest: 0.5,
      depthWrite: true,
    });

    this.baseMat.onBeforeCompile = (shader) => {
      // Prepend defines before all #include chunks so uv_pars_* see them
      shader.vertexShader = `
        #define USE_UV
        #define USE_MAP
        attribute vec4 aIPosScale;
        attribute vec4 aIUV;
      ` + shader.vertexShader.replace(
        '#include <begin_vertex>',
        `
          mat4 ivm = viewMatrix;
          ivm[3] = vec4(0.0, 0.0, 0.0, 1.0);
          ivm = transpose(ivm);
          mat4 aInstanceMatrix = mat4(ivm[0], ivm[1], ivm[2], vec4(aIPosScale.xyz, 1.0));
          float scale = aIPosScale.w;
          vec3 transformed = (aInstanceMatrix * vec4(position * scale , 1.0)).xyz;
        `
      ).replace(
        '#include <uv_vertex>',
        `
          vUv = (uv * aIUV.zw) + aIUV.xy;
        `
      );

      shader.fragmentShader = `
        #define USE_UV
        #define USE_MAP
      ` + shader.fragmentShader.replace(
        '#include <map_fragment>',
        `
          #ifdef USE_MAP
            vec4 sampledDiffuseColor = texture2D( map, vUv );
            diffuseColor *= sampledDiffuseColor;
            if ( sampledDiffuseColor.a < 0.5 ) discard;
          #endif
        `
      );
    };

    this.object = new THREE.Group();
    this.spriteMesh = this._buildSpritePool(maxSprites);
    this.object.add(this.spriteMesh);
  }

  _buildSpritePool(maxSprites) {
    const geometry = new THREE.PlaneGeometry(1, 1);
    const p = geometry.attributes.position.array;
    for (let i = 0; i < p.length; i += 3) {
      p[i + 1] += 0.5;  // Anchor at bottom
      p[i + 2] += 0.15; // Slight forward offset to avoid z-fighting
    }

    const instancedGeometry = new THREE.InstancedBufferGeometry();
    instancedGeometry.index = geometry.index;
    for (const name in geometry.attributes) {
      instancedGeometry.setAttribute(name, geometry.attributes[name]);
    }
    instancedGeometry.instanceCount = 0;

    const aIPosScale = new THREE.InstancedBufferAttribute(new Float32Array(maxSprites * 4), 4);
    aIPosScale.setUsage(THREE.DynamicDrawUsage);
    instancedGeometry.setAttribute('aIPosScale', aIPosScale);

    const aIUV = new THREE.InstancedBufferAttribute(new Float32Array(maxSprites * 4), 4);
    aIUV.setUsage(THREE.DynamicDrawUsage);
    instancedGeometry.setAttribute('aIUV', aIUV);

    const isDynamic = this.isDynamic;
    const spriteMesh = new THREE.Mesh(instancedGeometry, this.baseMat);
    spriteMesh.frustumCulled = false;
    spriteMesh.userData = { activeCount: 0, count: 0, uvDirty: false };

    spriteMesh.onBeforeRender = function () {
      const ac = this.userData.activeCount;
      this.geometry.instanceCount = ac;
      if (ac === 0) return;

      // Always upload position/scale (changes every frame for dynamic sprites)
      const pa = this.geometry.attributes.aIPosScale;
      pa.clearUpdateRanges();
      pa.addUpdateRange(0, ac * 4);
      pa.needsUpdate = true;

      // Only upload UV when dirty (static sprites) or every frame (dynamic sprites)
      if (isDynamic || this.userData.uvDirty) {
        const ta = this.geometry.attributes.aIUV;
        ta.clearUpdateRanges();
        ta.addUpdateRange(0, ac * 4);
        ta.needsUpdate = true;
        this.userData.uvDirty = false;
      }
    };

    return spriteMesh;
  }

  /**
   * Allocate a slot for a sprite target. Assigns target.write() and target.userData.index.
   * write() reads the index dynamically so it remains correct after free()/swap.
   */
  allocate(target) {
    const userData = this.spriteMesh.userData;
    if (userData.count >= this.maxSprites) {
      target.write = () => { };
      return;
    }

    const idx = userData.count++;
    userData.activeCount++;
    this.instances[idx] = target;

    target.userData.index = idx;
    target.userData.spriteBuffer = this;

    target.write = () => {
      // Read index dynamically — stays valid after swap-last in free()
      const i = target.userData.index * 4;
      const p = this.spriteMesh.geometry.attributes.aIPosScale.array;
      const t = this.spriteMesh.geometry.attributes.aIUV.array;

      p[i + 0] = target.position.x;
      p[i + 1] = target.position.y;
      p[i + 2] = target.position.z;
      p[i + 3] = target.scale.x;

      const tile = target.userData.tile;
      if (tile) {
        if (tile.scale) p[i + 3] *= tile.scale;
        t[i + 0] = tile.tl.x;
        t[i + 1] = tile.tl.y;
        t[i + 2] = tile.br.x - tile.tl.x;
        t[i + 3] = tile.br.y - tile.tl.y;
      } else {
        t[i + 0] = target.userData.offset.x;
        t[i + 1] = target.userData.offset.y;
        t[i + 2] = target.userData.repeat.x;
        t[i + 3] = target.userData.repeat.y;
      }
      // Always mark UV dirty — static sprites write once, dynamic write every frame
      this.spriteMesh.userData.uvDirty = true;
    };
  }

  /**
   * Free a sprite. O(1) — swaps the freed slot with the last active slot,
   * then decrements count. The swapped sprite's write() automatically uses
   * its new index since it reads target.userData.index dynamically.
   */
  free(target) {
    const idx = target.userData.index;
    if (idx === undefined || idx < 0) return;

    const ud = this.spriteMesh.userData;
    const lastIdx = ud.activeCount - 1;
    ud.activeCount--;
    ud.count--;

    if (idx !== lastIdx && lastIdx >= 0) {
      // Copy last slot's buffer data into the freed slot
      const p = this.spriteMesh.geometry.attributes.aIPosScale.array;
      const t = this.spriteMesh.geometry.attributes.aIUV.array;
      const dst = idx * 4, src = lastIdx * 4;
      p[dst] = p[src]; p[dst + 1] = p[src + 1]; p[dst + 2] = p[src + 2]; p[dst + 3] = p[src + 3];
      t[dst] = t[src]; t[dst + 1] = t[src + 1]; t[dst + 2] = t[src + 2]; t[dst + 3] = t[src + 3];

      // Redirect the swapped sprite to its new slot index
      const swapped = this.instances[lastIdx];
      if (swapped) {
        swapped.userData.index = idx;
        this.instances[idx] = swapped;
      }
    }

    this.instances[lastIdx] = null;
    target.userData.index = -1;
    target.write = () => { };
    this.spriteMesh.userData.uvDirty = true;
  }

  /** Dispose GPU resources and remove from scene. */
  dispose() {
    this.spriteMesh.geometry.dispose();
    this.baseMat.dispose();
    if (this.object.parent) this.object.parent.remove(this.object);
  }
}
