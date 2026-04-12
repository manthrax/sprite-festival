import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

/**
 * Manages loading and caching of GLTF props for the world.
 */
export class PropLibrary {
  constructor() {
    this.loader = new GLTFLoader();
    this.cache = new Map();
    this.ready = null;
    
    // Define the subset of models we want to use
    this.modelsToLoad = [
      { name: 'altar', path: './assets/gltf/altarStone.glb' },
      { name: 'trunk', path: './assets/gltf/trunk.glb' },
      { name: 'grave', path: './assets/gltf/grave.glb' },
      { name: 'books', path: './assets/gltf/books.glb' },
      { name: 'pumpkin', path: './assets/gltf/pumpkin.glb' },
      { name: 'coffin', path: './assets/gltf/coffin.glb' }
    ];
  }

  /**
   * Initialize and load all registered models into the cache.
   */
  async load() {
    if (this.ready) return this.ready;

    const promises = this.modelsToLoad.map(m => {
      return new Promise((resolve, reject) => {
        this.loader.load(m.path, (gltf) => {
          // Pre-process the model (traversal for shadows, etc)
          gltf.scene.traverse(node => {
            if (node.isMesh) {
              node.castShadow = true;
              node.receiveShadow = true;
            }
          });
          this.cache.set(m.name, gltf.scene);
          resolve();
        }, undefined, reject);
      });
    });

    this.ready = Promise.all(promises).then(() => {
      console.log('PropLibrary: All models loaded successfully.', Array.from(this.cache.keys()));
    });
    return this.ready;
  }

  /**
   * Create a cloned instance of a cached model.
   */
  createProp(name) {
    const original = this.cache.get(name);
    if (!original) {
      console.warn(`Prop ${name} not found in library.`);
      return null;
    }
    const clone = original.clone();
    return clone;
  }
}
