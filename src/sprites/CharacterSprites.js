import * as THREE from 'three'
import { SpriteBuffer } from './SpriteBuffer.js';

/**
 * Manages character sprites, animation sequences, and orientation logic.
 */
export class CharacterSprites {
  constructor(scene) {
    this.scene = scene;
    this.spriteSheets = {};
    this.spriteBuffers = {};

    this.camRight = new THREE.Vector3();
    this.camLook = new THREE.Vector3();
    this.v0 = new THREE.Vector3();

    this.ready = new Promise(resolve => {
      this.defineSprites();
      this.init(resolve);
    });
  }

  beginUpdate(camera) {
    const me = camera.matrixWorld.elements;
    this.camRight.set(me[0], me[1], me[2]);
    this.camLook.set(me[8], me[9], me[10]);
  }

  getDirCardinal(worldDir) {
    const dotX = this.camRight.dot(worldDir);
    const dotZ = this.camLook.dot(worldDir);
    if (Math.abs(dotZ) > Math.abs(dotX)) return dotZ < 0 ? 2 : 0;
    return dotX < 0 ? 3 : 1;
  }

  init(onReady) {
    let pending = Object.keys(this.spriteSheets).length;
    const loader = new THREE.TextureLoader();

    for (const name in this.spriteSheets) {
      const sheet = this.spriteSheets[name];
      sheet.texture = loader.load(sheet.imagePath, (tex) => {
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
        tex.magFilter = THREE.NearestFilter;
        if (sheet.flipY === false) tex.flipY = false;

        this.spriteBuffers[name] = new SpriteBuffer({
          texture: tex,
          maxSprites: sheet.maxSprites || 100000,
          dynamic: sheet.dynamic !== false
        });
        this.scene.add(this.spriteBuffers[name].object);

        if (--pending === 0 && onReady) onReady();
      }, undefined, (err) => {
        console.error(`Error loading texture ${name}:`, err);
      });
    }
  }

  defineSprites() {
    this.spriteSheets.antifarea = {
      imagePath: 'terrain-grid/assets/sprites/antifarea_chars_2hqx.png',
      maxSprites: 50000,
      dynamic: true,
      actionSequences: {
        run: [0, 1, 2, 1],
        stand: [8],
        attack: [3, 4, 5, 6],
        attack1: [7, 8, 9, 10, 11]
      },
      frameOffset: { x: 18 / 1024, y: 20 / 1024 },
      characterSequences: [],
      characterScales: [{ x: 3, y: 3.5 }],
      marginY: 0.239,
      moveMultiplier: 100,
      logic: 'cardinal'
    };

    // Pre-calculate character sequences for antifarea
    const af = this.spriteSheets.antifarea;
    for (let ty = 0; ty < 13; ty++) {
      for (let tx = 0; tx < 4; tx++) {
        af.characterSequences.push({ x: tx * 12, y: ty * 3 });
      }
    }

    this.spriteSheets.forest = {
      imagePath: 'terrain-grid/assets/sprites/miniforest_2hqx.png',
      maxSprites: 500000,
      dynamic: false,
      tiles: [],
      characterScales: [{ x: 3, y: 3.5 }],
      characterSequences: [],
      frameOffset: { x: 32 / 196, y: 32 / 128 },
      marginY: 0.0,
      flipY: false,
    };

    this.pushTiles('forest', 12, 4, 2, 6);
    this.pushTiles('forest', 12, 4, 24, 31);
    this.pushTiles('forest', 6, 2, 3, 4, 6);
    this.pushTiles('forest', 6, 1, 4, 6, 6);
  }

  pushTiles(name, width, height, start, end, scale) {
    const sheet = this.spriteSheets[name];
    const tx = 1 / width;
    const ty = 1 / height;
    const step = end > start ? 1 : -1;

    for (let i = start; i !== end; i += step) {
      const mtx = i % width;
      const mty = (i / width) | 0;
      sheet.tiles.push({
        tl: new THREE.Vector2(tx * mtx, ty * mty + ty),
        br: new THREE.Vector2(tx * mtx + tx, ty * mty),
        scale
      });
      sheet.characterSequences.push({ x: mtx, y: mty });
    }
  }

  addSprite(sheetName, position, charID = 0) {
    const sheet = this.spriteSheets[sheetName];
    const buffer = this.spriteBuffers[sheetName];

    const spr = {
      position: new THREE.Vector3().copy(position),
      scale: new THREE.Vector3(1, 1, 1),
      userData: {
        offset: new THREE.Vector2(),
        repeat: new THREE.Vector2(),
        template: sheet,
        facing: new THREE.Vector3(-1, 0, 0),
        target: new THREE.Vector3().copy(position),
        frameNumber: 0,
        velocity: 0,
        moveSpeed: 0
      }
    };

    buffer.allocate(spr);

    const cid = charID % sheet.characterSequences.length;
    spr.userData.charOrigin = sheet.characterSequences[cid];
    spr.userData.charScale = sheet.characterScales[0];
    spr.scale.set(spr.userData.charScale.x, spr.userData.charScale.y, spr.userData.charScale.x);

    if (sheet.tiles?.length) spr.userData.tile = sheet.tiles[cid];

    spr.userData.repeat.copy(sheet.frameOffset);

    spr.update = (camera) => {
      const state = spr.userData;
      this.v0.copy(state.target).sub(spr.position);
      spr.position.copy(state.target);
      this.v0.y = 0;
      state.velocity = this.v0.length() / 60;
      if (state.velocity > 0.0001) state.facing.copy(this.v0);
      state.moveSpeed = state.velocity * (sheet.moveMultiplier || 1);

      this.applyLogic(spr, camera);
      spr.write();
    };

    // Static sprites (tiles, no logic) don't need per-frame updates
    if (!sheet.logic) {
      spr.update = null;
      spr.write();
    }

    return spr;
  }

  applyLogic(spr, camera) {
    const state = spr.userData;
    const sheet = state.template;
    if (!sheet.logic) return;

    if (sheet.logic === 'cardinal') {
      const dir = this.getDirCardinal(state.facing);
      state.frameNumber += state.actionSpeed || state.moveSpeed;

      let flip = false;
      let row = 0;
      if (dir === 0) row = 0;
      else if (dir === 1) row = 1;
      else if (dir === 2) row = 2;
      else { row = 1; flip = true; }

      spr.scale.x = state.charScale.x;
      state.offset.y = (row + state.charOrigin.y) * sheet.frameOffset.y + sheet.marginY;

      let seq = sheet.actionSequences.stand;
      if (state.velocity > 0.001) seq = sheet.actionSequences.run;
      if (state.action) seq = sheet.actionSequences[state.action];

      const frm = (state.frameNumber | 0) % seq.length;
      state.offset.x = sheet.frameOffset.x * (seq[frm] + state.charOrigin.x);
      if (flip) state.offset.x += sheet.frameOffset.x;
      state.repeat.x = (flip ? -1 : 1) * sheet.frameOffset.x;
    }
  }
}
