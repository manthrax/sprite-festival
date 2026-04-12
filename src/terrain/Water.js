import * as THREE from 'three';

/**
 * High-performance Water layer that follows the camera.
 * Uses the requested 10x10 subdivision on a very large plane.
 */
export class Water {
  constructor(scene, options = {}) {
    this.scene = scene;
    this.level = options.level !== undefined ? options.level : 15;

    // 5000x5000 plane with 100x100 subdivisions for visible wave geometry
    const geometry = new THREE.PlaneGeometry(5000, 5000, 100, 100);
    geometry.rotateX(-Math.PI / 2);

    this.material = new THREE.MeshStandardMaterial({
      color: 0x0044ff,
      transparent: true,
      opacity: 0.8,
      roughness: 0.75,
      metalness: 0.3,
    });

    // Premium visual enhancements via custom shader hooks
    this.material.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = { value: 0 };
      shader.uniforms.tDepth = { value: null };
      shader.uniforms.tSceneColor = { value: null };
      shader.uniforms.tNoise = { value: null };
      shader.uniforms.cameraNear = { value: 0.1 };
      shader.uniforms.cameraFar = { value: 5000 };
      shader.uniforms.resolution = { value: new THREE.Vector2(window.innerWidth, window.innerHeight) };
      shader.uniforms.uWorldRadius = { value: 2000.0 };
      shader.uniforms.uCameraPos = { value: new THREE.Vector3() };
      shader.uniforms.uRefractionStrength = { value: 0.05 };

      this.material.userData.shader = shader;

      shader.vertexShader = `
        uniform float uTime;
        varying vec3 vWorldPos;
        varying vec4 vScreenPos;
        
        float getVertexWave(vec2 p, float time) {
          float w = sin(p.x * 0.04 + time * 1.2) * 0.8;
          w += sin(p.y * 0.03 + time * 1.5) * 0.8;
          return w;
        }
      ` + shader.vertexShader.replace(
        '#include <begin_vertex>',
        `
          #include <begin_vertex>
          vec3 wPos = (modelMatrix * vec4(position, 1.0)).xyz;
          transformed.y += getVertexWave(wPos.xz, uTime);
        `
      ).replace(
        '#include <worldpos_vertex>',
        `
          #include <worldpos_vertex>
          vWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
          vScreenPos = projectionMatrix * modelViewMatrix * vec4(transformed, 1.0);
        `
      );

      shader.fragmentShader = `
        uniform float uTime;
        uniform sampler2D tDepth;
        uniform sampler2D tSceneColor;
        uniform sampler2D tNoise;
        uniform float cameraNear;
        uniform float cameraFar;
        uniform vec2 resolution;
        uniform float uWorldRadius;
        uniform vec3 uCameraPos;
        uniform float uRefractionStrength;
        varying vec3 vWorldPos;
        varying vec4 vScreenPos;

        float hash(vec2 p) {
          return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
        }

        float noise(vec2 p) {
          vec2 i = floor(p);
          vec2 f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          float a = hash(i);
          float b = hash(i + vec2(1.0, 0.0));
          float c = hash(i + vec2(0.0, 1.0));
          float d = hash(i + vec2(1.0, 1.0));
          return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
        }

        float getWaves(vec2 p, float time) {
          float w = 0.0;
          w += sin(p.x * 0.1 + time * 1.5) * 0.5;
          w += sin(p.y * 0.1 + time * 1.3) * 0.5;
          w += noise(p * 0.2 + time * 0.5) * 0.3;
          w += noise(p * 0.05 - time * 0.2) * 0.6;
          
          float n = texture2D(tNoise, p * 0.05 + time * 0.02).r;
          w += n * 0.4;
          
          return w * 0.4 + 0.5;
        }

        float getLinearDepth(float fragCoordZ) {
          float z = fragCoordZ * 2.0 - 1.0;
          return (2.0 * cameraNear * cameraFar) / (cameraFar + cameraNear - z * (cameraFar - cameraNear));
        }

      ` + shader.fragmentShader.replace(
        '#include <map_fragment>',
        `
          #include <map_fragment>
          
          float distToCam = distance(vWorldPos.xz, uCameraPos.xz);
          if (distToCam > uWorldRadius) discard;

          vec2 screenUV = gl_FragCoord.xy / resolution;
          float sceneDepthRaw = texture2D(tDepth, screenUV).r;
          
          float sceneDepth = getLinearDepth(sceneDepthRaw);
          float fragmentDepth = getLinearDepth(gl_FragCoord.z);
          float depthDiff = sceneDepth - fragmentDepth;

          vec2 p = vWorldPos.xz;
          float wave = getWaves(p, uTime);
          
          // --- Refraction Logic ---
          float e = 0.1;
          float w1 = getWaves(p + vec2(e, 0.0), uTime);
          float w2 = getWaves(p + vec2(0.0, e), uTime);
          vec3 waveNormal = normalize(vec3(w1 - wave, 1.0, w2 - wave));
          
          vec2 refractUV = screenUV + waveNormal.xz * uRefractionStrength * (1.0 - smoothstep(0.0, 2.0, depthDiff));
          vec3 underwaterColor = texture2D(tSceneColor, refractUV).rgb;
          
          vec3 deepColor = vec3(0.0, 0.2, 0.5);
          vec3 shallowColor = vec3(0.2, 0.7, 0.9);
          
          float foam = smoothstep(1.5, 0.0, depthDiff);
          
          vec3 color = mix(deepColor, shallowColor, wave);
          color = mix(color, vec3(0.9, 1.0, 1.0), foam * 0.8 * (0.5 + wave * 0.5));
          
          float sparkle = pow(max(0.0, wave - 0.7), 4.0) * 12.0;
          color += vec3(sparkle * 0.4, sparkle * 0.7, sparkle);

          diffuseColor.rgb = mix(underwaterColor * 0.7 + color * 0.3, color, smoothstep(0.0, 5.0, depthDiff));
          diffuseColor.a = mix(0.85, 0.2, foam);
          
          float edgeFade = smoothstep(uWorldRadius, uWorldRadius * 0.8, distToCam);
          diffuseColor.a *= edgeFade;
        `
      );
    };

    this.mesh = new THREE.Mesh(geometry, this.material);
    this.mesh.position.y = this.level;
    this.mesh.frustumCulled = false; // Always visible since it moves with us

    this.scene.add(this.mesh);
  }

  update(renderer, camera, time, depthTexture, sceneColor, noiseTexture) {
    const viewerPos = camera.position;

    // Recenter vertically and horizontally to follow camera
    this.mesh.position.x = viewerPos.x;
    this.mesh.position.z = viewerPos.z;

    // Update shader uniforms
    if (this.material.userData.shader) {
      const u = this.material.userData.shader.uniforms;
      u.uTime.value = time;
      u.tDepth.value = depthTexture;
      u.tSceneColor.value = sceneColor;
      u.tNoise.value = noiseTexture;
      u.cameraNear.value = camera.near;
      u.cameraFar.value = camera.far;
      u.uCameraPos.value.copy(camera.position);
      const pixelRatio = renderer.getPixelRatio();
      u.resolution.value.set(
        window.innerWidth * pixelRatio,
        window.innerHeight * pixelRatio
      );
    }
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.material.dispose();
    this.scene.remove(this.mesh);
  }
}
