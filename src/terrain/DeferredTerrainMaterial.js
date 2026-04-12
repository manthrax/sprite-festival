import * as THREE from 'three';

/**
 * Fullscreen deferred material for terrain compositing.
 * Reconstructs world space from depth to sample and blend 5 terrain textures.
 * Writes to gl_FragDepth to allow forward-rendered objects to Z-test correctly.
 */
export class DeferredTerrainMaterial extends THREE.ShaderMaterial {
  constructor(params = {}) {
    const { layers, depthTexture, weightsTexture } = params;

    super({
      uniforms: {
        tDepth: { value: depthTexture },
        tWeights: { value: weightsTexture },
        tMisc: { value: params.miscTexture },
        invViewProj: { value: new THREE.Matrix4() },
        uCameraPos: { value: new THREE.Vector3() },
        uWorldRadius: { value: 1900.0 },
        // Terrain Textures
        texBaseColor: { value: layers.base.albedo },
        texGrassColor: { value: layers.grass.albedo },
        texRockColor: { value: layers.rocky.albedo },
        texSnowColor: { value: layers.snowy.albedo },
        texSandColor: { value: layers.sand.albedo },
        repeatBase: { value: layers.base.repeat },
        repeatGrass: { value: layers.grass.repeat },
        repeatRock: { value: layers.rocky.repeat },
        repeatSnow: { value: layers.snowy.repeat },
        repeatSand: { value: layers.sand.repeat },
        uDebugMode: { value: 0 }
      },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        precision highp float;
        out vec4 pc_fragColor;
        varying vec2 vUv;
        uniform sampler2D tDepth;
        uniform sampler2D tWeights;
        uniform sampler2D tMisc;
        uniform mat4 invViewProj;
        uniform vec3 uCameraPos;
        uniform float uWorldRadius;
        uniform int uDebugMode;

        uniform sampler2D texBaseColor;
        uniform sampler2D texGrassColor;
        uniform sampler2D texRockColor;
        uniform sampler2D texSnowColor;
        uniform sampler2D texSandColor;
        uniform float repeatBase;
        uniform float repeatGrass;
        uniform float repeatRock;
        uniform float repeatSnow;
        uniform float repeatSand;

        void main() {
          // DEBUG MODE 1: PURE MAGENTA (Verifies pass orchestration)
          if (uDebugMode == 1) { pc_fragColor = vec4(1.0, 0.0, 1.0, 1.0); return; }

          float depth = texture2D(tDepth, vUv).r;
          //if (depth > 0.9999) discard; // Empty space -> Sky
          
          // DEBUG MODE 3: DEPTH BUFFER
          if (uDebugMode == 3) { pc_fragColor = vec4(vec3(depth), 1.0); return; }

          // Reconstruct World Position
          vec4 ndc = vec4(vUv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
          vec4 wp = invViewProj * ndc;
          vec3 vWorldPos = wp.xyz / wp.w;


          if (distance(vWorldPos.xz, uCameraPos.xz) > uWorldRadius) 
          {
            discard;
          }
          // Normal from G-Buffer
          vec3 normal = texture2D(tMisc, vUv).rgb * 2.0 - 1.0;
          normal = normalize(normal);

          // Splat Weights from G-Buffer
          vec4 v_weights = texture2D(tWeights, vUv);
          float v_baseWeight = max(0.0, 1.0 - (v_weights.r + v_weights.g + v_weights.b + v_weights.a));
          
          const float v_sharpness = 8.0;
          v_weights = pow(v_weights, vec4(v_sharpness));
          v_baseWeight = pow(v_baseWeight, v_sharpness);
     
          float v_total = v_weights.r + v_weights.g + v_weights.b + v_weights.a + v_baseWeight;
          v_weights /= v_total;
          v_baseWeight /= v_total;

          // UV calculation based on world pos (XZ)
          vec2 worldUV = vWorldPos.xz;

          vec4 texBase = texture2D(texBaseColor, worldUV * 0.04 * repeatBase);
          vec4 texGrass = texture2D(texGrassColor, worldUV * 0.04 * repeatGrass);
          vec4 texRock = texture2D(texRockColor, worldUV * 0.04 * repeatRock);
          vec4 texSnow = texture2D(texSnowColor, worldUV * 0.04 * repeatSnow);
          vec4 texSand = texture2D(texSandColor, worldUV * 0.04 * repeatSand);
          
          vec4 finalColor = texBase * v_baseWeight + 
                            texRock * v_weights.r +
                            texGrass * v_weights.g + 
                            texSnow * v_weights.b +
                            texSand * v_weights.a;
          
          // Basic Lighting
          vec3 sunDir = normalize(vec3(500.0, 1000.0, 250.0));
          float dotNL = max(0.0, dot(normal, sunDir));
          vec3 ambient = vec3(0.15);
          vec3 lightColor = vec3(1.2, 1.15, 1.0);
          vec3 diffuse = lightColor * dotNL;
          
          pc_fragColor = vec4(finalColor.rgb * (ambient + diffuse), 1.0);
          gl_FragDepth = depth;


          //debug grid
//vec2 grid = fract(vWorldPos.xz/200.);
//pc_fragColor = max(pc_fragColor,vec4(vec3(step(.995,max(grid.x,grid.y))),0.));
        }
      `
    });

    this.glslVersion = THREE.GLSL3;
  }
}
