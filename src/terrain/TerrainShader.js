import * as THREE from 'three'

/**
 * Custom terrain shader for splat mapping and texturing.
 */
export class TerrainShader {
  constructor() {
    const loader = new THREE.TextureLoader();
    const load = (path) => {
      const tex = loader.load(path);
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      return tex;
    };

    const blendMap = load('./assets/terrain/blendmap3.jpg');
    const layers = {
      base: {
        albedo: load('./assets/terrain/t2/desert_sand_dunes_100.jpg'),
        normal: load('./assets/terrain/t2/desert_sand_dunes_100_norm.jpg'),
        repeat: 3,
        name: 'Base'
      },
      grass: {
        albedo: load('./assets/terrain/t2/alpine_grass_rocky.jpg'),
        normal: load('./assets/terrain/t2/alpine_cliff_a_norm.jpg'),
        repeat: 2,
        name: 'Tile1'
      },
      rocky: {
        albedo: load('./assets/terrain/t2/alpine_grass.jpg'),
        normal: load('./assets/terrain/t2/desert_plants_b_norm.jpg'),
        repeat: 2,
        name: 'Tile2'
      },
      snowy: {
        albedo: load('./assets/terrain/t2/alpine_cliff_snow.jpg'),
        normal: load('./assets/terrain/t2/alpine_cliff_a_norm.jpg'),
        repeat: 2,
        name: 'Tile3'
      }
    };

    this.material = new THREE.MeshPhongMaterial({
      shininess: 0.2,
      vertexColors: true,
      map: layers.base.albedo // Triggers USE_UV and vUv in the shader
    });

    this.material.onBeforeCompile = (shader) => {
      shader.uniforms.texBlendMap = { value: blendMap };
      for (const key in layers) {
        const l = layers[key];
        shader.uniforms[`tex${l.name}Color`] = { value: l.albedo };
        shader.uniforms[`tex${l.name}Bump`] = { value: l.normal };
        shader.uniforms[`repeat${l.name}`] = { value: l.repeat };
      }

      shader.vertexShader = '#define USE_UV\n' + shader.vertexShader;
      shader.fragmentShader = '#define USE_UV\n' + this.getFragmentShaderPars() + shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', this.getFragmentShader());
      shader.fragmentShader = shader.fragmentShader.replace('#include <normalmap_pars_fragment>', this.getNormalMapPars());
    };
  }

  getFragmentShaderPars() {
    return `
      //#define USE_MAP
      uniform sampler2D texBlendMap;
      uniform sampler2D texBaseColor;
      uniform sampler2D texTile1Color;
      uniform sampler2D texTile2Color;
      uniform sampler2D texTile3Color;
      uniform float repeatBase;
      uniform float repeatTile1;
      uniform float repeatTile2;
      uniform float repeatTile3;
    `;
  }

  getFragmentShader() {
    return `
    #if defined( USE_UV )
        vec4 edgeBlend = texture2D(texBlendMap, vUv * 1.001);
        vec4 tbBlend = vec4(vColor.rgb, 1.0) - ((vec4(edgeBlend.x, fract(sin(edgeBlend.x)), 0.5 + (edgeBlend.x * -0.5), 1.0) - 0.5) * 0.7);
        
        float tbBaseWeight = 1.0 - max(tbBlend.r, max(tbBlend.g, tbBlend.b));
      vec4 base = tbBaseWeight * texture2D(texBaseColor, vUv * repeatBase);
      vec4 color1 = tbBlend.r * texture2D(texTile1Color, vUv * repeatTile1);
      vec4 color2 = tbBlend.g * texture2D(texTile2Color, vUv * repeatTile2);
      vec4 color3 = tbBlend.b * texture2D(texTile3Color, vUv * repeatTile3);
      
      vec4 combined = (base + color1 + color2 + color3) / (tbBaseWeight + tbBlend.r + tbBlend.g + tbBlend.b);
      diffuseColor = ((combined - 0.5) * 1.1) + 0.2;
      diffuseColor.a = 1.0;
    #else
      diffuseColor=vec4(vColor.rgb, 1.0);
    #endif
    `;
  }

  getNormalMapPars() {
    return `
      #ifdef USE_NORMALMAP
        uniform sampler2D normalMap;
        uniform vec2 normalScale;
        uniform sampler2D texBaseBump;
        uniform sampler2D texTile1Bump;
        uniform sampler2D texTile2Bump;
        uniform sampler2D texTile3Bump;

        vec3 perturbNormal2Arb(vec3 eye_pos, vec3 surf_norm) {
          vec3 q0 = dFdx(eye_pos);
          vec3 q1 = dFdy(eye_pos);
          vec2 st0 = dFdx(vUv.st);
          vec2 st1 = dFdy(vUv.st);
          float scale = sign(st1.t * st0.s - st0.t * st1.s);
          vec3 S = normalize((q0 * st1.t - q1 * st0.t) * scale);
          vec3 T = normalize((-q0 * st1.s + q1 * st0.s) * scale);
          vec3 N = normalize(surf_norm);
          mat3 tsn = mat3(S, T, N);

          vec4 edgeBlend = texture2D(texBlendMap, vUv * 1.001);
          vec4 tbBlend = vec4(vColor, 1.0) - ((vec4(edgeBlend.x, fract(sin(edgeBlend.x)), 0.5 + (edgeBlend.x * -0.5), 1.0) - 0.5) * 0.7);
          float tbBaseWeight = 1.0 - max(tbBlend.r, max(tbBlend.g, tbBlend.b));

          float maxVal = tbBaseWeight;
          int idx = 0;
          if (tbBlend.r > maxVal) { maxVal = tbBlend.r; idx = 1; }
          if (tbBlend.g > maxVal) { maxVal = tbBlend.g; idx = 2; }
          if (tbBlend.b > maxVal) { maxVal = tbBlend.b; idx = 3; }

          vec3 mapN = texture2D(texBaseBump, vUv * repeatBase).xyz * 2.0 - 1.0;
          if (idx == 1) mapN = texture2D(texTile1Bump, vUv * repeatTile1).xyz * 2.0 - 1.0;
          else if (idx == 2) mapN = texture2D(texTile2Bump, vUv * repeatTile2).xyz * 3.0 - 1.0;
          else if (idx == 3) mapN = texture2D(texTile3Bump, vUv * repeatTile3).xyz * 3.0 - 1.0;

          mapN.xy *= normalScale;
          return normalize(tsn * mapN);
        }
      #endif
    `;
  }
}
