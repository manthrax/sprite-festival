import * as THREE from 'three';

/**
 * Specialized G-Buffer material for terrain.
 * Outputs raw splat weights to target 0 and misc meta to target 1.
 * Explicitly uses WebGL2 layout locations for modern MRT compatibility.
 */
export class TerrainGBufferMaterial extends THREE.ShaderMaterial {
  constructor() {
    super({
      uniforms: {
        uCameraPos: { value: new THREE.Vector3() },
        uWorldRadius: { value: 2000.0 }
      },
      vertexShader: `
        attribute vec4 splatWeights;
        varying vec4 vSplatWeights;
        varying vec3 vWorldPos;
        varying vec3 vNormal;
        void main() {
          vSplatWeights = splatWeights;
          vec4 worldPos = modelMatrix * vec4(position, 1.0);
          vWorldPos = worldPos.xyz;
          vNormal = normalize(mat3(modelMatrix) * normal);
          gl_Position = projectionMatrix * viewMatrix * worldPos;
        }
      `,
      fragmentShader: `
        precision highp float;
        
        layout(location = 0) out vec4 out_Weights;
        layout(location = 1) out vec4 out_Misc;
        
        varying vec4 vSplatWeights;
        varying vec3 vWorldPos;
        varying vec3 vNormal;
        uniform vec3 uCameraPos;
        uniform float uWorldRadius;

        void main() {
          // float distToCam = distance(vWorldPos.xz, uCameraPos.xz);
          // if (distToCam > uWorldRadius) discard;

          out_Weights = vSplatWeights;
          out_Misc = vec4(vNormal * 0.5 + 0.5, 1.0);
        }
      `
    });
    
    // Explicitly tell Three.js this is a GLSL 3.0 shader
    this.glslVersion = THREE.GLSL3;
  }
}
