import * as THREE from 'three';

/**
 * High-performance Water layer that follows the camera.
 * Uses the requested 10x10 subdivision on a very large plane.
 */
export class Water {
  constructor(scene, options = {}) {
    this.scene = scene;
    this.level = options.level !== undefined ? options.level : 15;
    
    // 5000x5000 plane with 10x10 subdivisions as requested
    const geometry = new THREE.PlaneGeometry(5000, 5000, 10, 10);
    geometry.rotateX(-Math.PI / 2);

    this.material = new THREE.MeshStandardMaterial({
      color: 0x0044ff,
      transparent: true,
      opacity: 0.7,
      roughness: 0.1,
      metalness: 0.2,
    });

    // Premium visual enhancements via custom shader hooks
    this.material.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = { value: 0 };
      shader.uniforms.tDepth = { value: null };
      shader.uniforms.cameraNear = { value: 0.1 };
      shader.uniforms.cameraFar = { value: 5000 };
      shader.uniforms.resolution = { value: new THREE.Vector2(window.innerWidth, window.innerHeight) };
      shader.uniforms.uWorldRadius = { value: 2000.0 };
      shader.uniforms.uCameraPos = { value: new THREE.Vector3() };

      this.material.userData.shader = shader;

      shader.vertexShader = `
        varying vec3 vWorldPos;
        varying vec4 vScreenPos;
      ` + shader.vertexShader.replace(
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
        uniform float cameraNear;
        uniform float cameraFar;
        uniform vec2 resolution;
        uniform float uWorldRadius;
        uniform vec3 uCameraPos;
        varying vec3 vWorldPos;
        varying vec4 vScreenPos;

        // Simple hash-based noise for more organic waves
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
          w += sin(p.x * 0.05 + time * 1.5) * 0.5;
          w += sin(p.y * 0.05 + time * 1.3) * 0.5;
          w += noise(p * 0.1 + time * 0.5) * 0.3;
          w += noise(p * 0.02 - time * 0.2) * 0.6;
          return w * 0.4 + 0.5;
        }

        float readDepth(float fragCoordZ) {
          return fragCoordZ;
        }

        float getLinearDepth(float fragCoordZ) {
          float z = fragCoordZ * 2.0 - 1.0;
          return (2.0 * cameraNear * cameraFar) / (cameraFar + cameraNear - z * (cameraFar - cameraNear));
        }

      ` + shader.fragmentShader.replace(
        '#include <map_fragment>',
        `
          #include <map_fragment>
          
          // 1. Circular Discard
          float distToCam = distance(vWorldPos.xz, uCameraPos.xz);
          if (distToCam > uWorldRadius) discard;

          vec2 screenUV = gl_FragCoord.xy / resolution;
          float sceneDepthRaw = texture2D(tDepth, screenUV).r;
          
          // Depth fading for shoreline
          // We compare the linearized scene depth with the fragment depth
          float sceneDepth = getLinearDepth(sceneDepthRaw);
          float fragmentDepth = getLinearDepth(gl_FragCoord.z);
          float depthDiff = sceneDepth - fragmentDepth;

          vec2 p = vWorldPos.xz;
          float wave = getWaves(p, uTime);
          
          vec3 deepColor = vec3(0.0, 0.1, 0.3);
          vec3 shallowColor = vec3(0.1, 0.6, 0.82);
          
          float foam = smoothstep(2.0, 0.0, depthDiff);
          
          vec3 color = mix(deepColor, shallowColor, wave);
          color = mix(color, vec3(0.8, 0.9, 1.0), foam * 0.6 * (0.5 + wave * 0.5));
          
          // Add extra detail/sparkle logic
          float sparkle = pow(max(0.0, wave - 0.8), 3.0) * 8.0;
          color += vec3(sparkle * 0.5, sparkle * 0.8, sparkle);

          diffuseColor.rgb = color;
          
          // Fade alpha in shallows
          diffuseColor.a = mix(0.7, 0.0, foam);
          
          // Fade out towards the edges of the circular world
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

  update(camera, time, depthTexture) {
    const viewerPos = camera.position;

    // Recenter vertically and horizontally to follow camera
    this.mesh.position.x = viewerPos.x;
    this.mesh.position.z = viewerPos.z;
    
    // Update shader uniforms
    if (this.material.userData.shader) {
      const u = this.material.userData.shader.uniforms;
      u.uTime.value = time;
      u.tDepth.value = depthTexture;
      u.cameraNear.value = camera.near;
      u.cameraFar.value = camera.far;
      u.uCameraPos.value.copy(camera.position);
      u.resolution.value.set(window.innerWidth, window.innerHeight);
    }
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.material.dispose();
    this.scene.remove(this.mesh);
  }
}
