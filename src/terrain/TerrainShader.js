import * as THREE from 'three'

/**
 * Custom terrain shader for splat mapping and texturing.
 */
export class TerrainShader {
  constructor() {
    const loader = new THREE.TextureLoader();
    const load = (path, colorSpace = THREE.NoColorSpace) => {
      const tex = loader.load(path);
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      tex.colorSpace = colorSpace;
      return tex;
    };

    const sRGB = THREE.SRGBColorSpace;
    const Linear = THREE.NoColorSpace;

    const layers = {
      base: {
        albedo: load('./assets/terrain/tex_moonforrest_soil.jpg', sRGB),
        normal: load('./assets/terrain/tex_moonforrest_soil_n.jpg', Linear),
        repeat: 1.4,
        name: 'Base'
      },
      grass: {
        albedo: load('./assets/terrain/tex_moonforrest_green.jpg', sRGB),
        normal: load('./assets/terrain/tex_moonforrest_green_n.jpg', Linear),
        repeat: 1.4,
        name: 'Grass'
      },
      rocky: {
        albedo: load('./assets/terrain/tex_moonforrest_rock.jpg', sRGB),
        normal: load('./assets/terrain/tex_moonforrest_rock_n.jpg', Linear),
        repeat: 1.3,
        name: 'Rock'
      },
      snowy: {
        albedo: load('./assets/terrain/tex_moonforrest_snow.jpg', sRGB),
        normal: load('./assets/terrain/tex_moonforrest_snow_n.jpg', Linear),
        repeat: 1.2,
        name: 'Snow'
      },
      sand: {
        albedo: load('./assets/terrain/t2/desert_sand_dunes_100.jpg', sRGB),
        normal: load('./assets/terrain/t2/desert_sand_dunes_100_norm.jpg', Linear),
        repeat: 2.0,
        name: 'Sand'
      }
    };

    this.material = new THREE.MeshPhongMaterial({
      shininess: 0.1,
      vertexColors: false,
      map: layers.base.albedo,
      normalMap: layers.base.normal, // Force normal-map pipeline assembly
      normalScale: new THREE.Vector2(1, 1)
    });

    this.material.onBeforeCompile = (shader) => {
      for (const key in layers) {
        const l = layers[key];
        shader.uniforms[`tex${l.name}Color`] = { value: l.albedo };
        shader.uniforms[`tex${l.name}Bump`] = { value: l.normal };
        shader.uniforms[`repeat${l.name}`] = { value: l.repeat };
      }

      // 1. Inject custom attributes and varying into Vertex Shader
      shader.vertexShader = `
        attribute vec4 splatWeights;
        varying vec4 vSplatWeights;
        varying vec3 vWorldPos;
        #define USE_UV
        ${shader.vertexShader}
      `.replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
         vSplatWeights = splatWeights;
         vWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;`
      );

      // 2. Fragment Shader Parsing
      shader.fragmentShader = '#define USE_UV\n' + this.getFragmentShaderPars() + shader.fragmentShader;

      // 3. Hook into the fragment shader
      shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', '');
      shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', this.getFragmentShader());
      shader.fragmentShader = shader.fragmentShader.replace('#include <normalmap_pars_fragment>',
        '#include <normalmap_pars_fragment>\n' + this.getNormalMapPars());
      
      shader.uniforms.uCameraPos = { value: new THREE.Vector3() };
      shader.uniforms.uWorldRadius = { value: 2000.0 };
      this.material.userData.shader = shader;
    };
  }

  getFragmentShaderPars() {
    return `
      varying vec4 vSplatWeights;
      varying vec3 vWorldPos;
      uniform vec3 uCameraPos;
      uniform float uWorldRadius;
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
    `;
  }

  getFragmentShader() {
    return `
    #if defined( USE_UV )
      // Circular Discard to avoid tile pop
      float distToCam = distance(vWorldPos.xz, uCameraPos.xz);
      if (distToCam > uWorldRadius) discard;

      vec4 v_weights = vSplatWeights;
      float v_baseWeight = max(0.0, 1.0 - (v_weights.r + v_weights.g + v_weights.b + v_weights.a));
      
      const float v_sharpness = 8.0;
      v_weights = pow(v_weights, vec4(v_sharpness));
      v_baseWeight = pow(v_baseWeight, v_sharpness);
 
      float v_total = v_weights.r + v_weights.g + v_weights.b + v_weights.a + v_baseWeight;
      v_weights /= v_total;
      v_baseWeight /= v_total;
 
      vec4 texBase = texture2D(texBaseColor, vUv * repeatBase);
      vec4 texGrass = texture2D(texGrassColor, vUv * repeatGrass);
      vec4 texRock = texture2D(texRockColor, vUv * repeatRock);
      vec4 texSnow = texture2D(texSnowColor, vUv * repeatSnow);
      vec4 texSand = texture2D(texSandColor, vUv * repeatSand);
      
      diffuseColor = texBase * v_baseWeight + 
                     texRock * v_weights.r +
                     texGrass * v_weights.g + 
                     texSnow * v_weights.b +
                     texSand * v_weights.a;
      
      diffuseColor.a = 1.0;
    #else
      diffuseColor=vec4(vSplatWeights.rgb, 1.0);
    #endif
    `;
  }

  getNormalMapPars() {
    return `
      #ifdef USE_NORMALMAP
        uniform sampler2D texBaseBump;
        uniform sampler2D texGrassBump;
        uniform sampler2D texRockBump;
        uniform sampler2D texSnowBump;
        uniform sampler2D texSandBump;
 
        vec3 perturbNormal2Arb(vec3 eye_pos, vec3 surf_norm, vec2 normalScale, vec2 uv) {
          vec3 q0 = dFdx(eye_pos);
          vec3 q1 = dFdy(eye_pos);
          vec2 st0 = dFdx(uv.st);
          vec2 st1 = dFdy(uv.st);
          float scale = sign(st1.t * st0.s - st0.t * st1.s);
          vec3 S = normalize((q0 * st1.t - q1 * st0.t) * scale);
          vec3 T = normalize((-q0 * st1.s + q1 * st0.s) * scale);
          vec3 N = surf_norm; 
          mat3 tsn = mat3(S, T, N);
 
          vec4 weights = vSplatWeights;
          float baseWeight = max(0.0, 1.0 - (weights.r + weights.g + weights.b + weights.a));
          
          const float sharpness = 8.0;
          weights = pow(weights, vec4(sharpness));
          baseWeight = pow(baseWeight, sharpness);
 
          float total = weights.r + weights.g + weights.b + weights.a + baseWeight;
          weights /= total;
          baseWeight /= total;
 
          vec3 nBase = texture2D(texBaseBump, uv * repeatBase).xyz * 2.0 - 1.0;
          vec3 nGrass = texture2D(texGrassBump, uv * repeatGrass).xyz * 2.0 - 1.0;
          vec3 nRock = texture2D(texRockBump, uv * repeatRock).xyz * 2.0 - 1.0;
          vec3 nSnow = texture2D(texSnowBump, uv * repeatSnow).xyz * 2.0 - 1.0;
          vec3 nSand = texture2D(texSandBump, uv * repeatSand).xyz * 2.0 - 1.0;
 
          vec3 mapN = nBase * baseWeight + 
                      nRock * weights.r +
                      nGrass * weights.g + 
                      nSnow * weights.b +
                      nSand * weights.a;
 
          mapN.xy *= normalScale;
          return normalize(tsn * mapN);
        }
      #endif
    `;
  }
}


