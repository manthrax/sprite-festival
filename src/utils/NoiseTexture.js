import * as THREE from 'three';
import * as Noise from './Noise.js';

/**
 * Procedural noise texture generator.
 * Used for wave normal perturbation and organic variety.
 */
export class NoiseTexture {
  static create(size = 512) {
    const data = new Uint8Array(size * size);
    
    // Scale for the noise
    const scale = 0.05;
    
    for (let i = 0; i < size; i++) {
      for (let j = 0; j < size; j++) {
        // Calculate simplex noise in [0, 1] range
        const val = (Noise.simplex2(i * scale, j * scale) + 1.0) * 0.5;
        data[i + j * size] = val * 255;
      }
    }

    const texture = new THREE.DataTexture(
      data, 
      size, 
      size, 
      THREE.RedFormat, 
      THREE.UnsignedByteType
    );
    
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.minFilter = texture.magFilter = THREE.LinearFilter;
    texture.needsUpdate = true;
    
    return texture;
  }
}
