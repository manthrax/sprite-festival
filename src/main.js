import * as THREE from 'three';
import { Engine } from './Engine.js';
import { Terrain } from './terrain/Terrain.js';
import { CharacterSprites } from './sprites/CharacterSprites.js';
import { Water } from './terrain/Water.js';
import { WorldSim } from './world/WorldSim.js';
import { PropLibrary } from './world/PropLibrary.js';
import { DeferredTerrainMaterial } from './terrain/DeferredTerrainMaterial.js';
import { NoiseTexture } from './utils/NoiseTexture.js';
import { TerrainGBufferMaterial } from './terrain/TerrainGBufferMaterial.js';

/**
 * Seeded LCG random number generator — deterministic, reproducible layout.
 */
function makeRng(seed = 0xdeadbeef) {
    let s = seed >>> 0;
    return () => {
        s = Math.imul(s, 1664525) + 1013904223 | 0;
        return (s >>> 0) / 0xffffffff;
    };
}

/**
 * Main application entry point.
 */
async function startApp() {
    const engine = new Engine();
    const scene = engine.scene;

    // Lights
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.8);
    scene.add(ambientLight);

    const sun = new THREE.DirectionalLight(0xffffff, 1.2);
    sun.position.set(500, 1000, 250);
    sun.castShadow = true;
    sun.shadow.mapSize.width = sun.shadow.mapSize.height = 2048;
    sun.shadow.camera.left = sun.shadow.camera.bottom = -1000;
    sun.shadow.camera.right = sun.shadow.camera.top = 1000;
    sun.layers.enable(2); // Enable for water
    scene.add(sun);

    // Components
    const terrain = new Terrain(scene, { ntiles: 6 });
    const characters = new CharacterSprites(scene);
    const propLib = new PropLibrary();
    propLib.scene = scene; // Hook to main scene

    await Promise.all([characters.ready, propLib.load()]);

    const SEA_LEVEL = 15;

    // World Simulation
    const worldSim = new WorldSim(terrain, characters, propLib);
    worldSim.seaLevel = SEA_LEVEL;

    const water = new Water(scene, { level: SEA_LEVEL });
    const noiseTexture = NoiseTexture.create();

    // Advanced Deferred Pipeline Setup
    const terrainGBufferMaterial = new TerrainGBufferMaterial();
    const deferredMaterial = new DeferredTerrainMaterial({
        layers: terrain.terrainShader.layers,
        depthTexture: engine.gBuffer.depthTexture,
        weightsTexture: engine.gBuffer.textures[0],
        miscTexture: engine.gBuffer.textures[1]
    });
    const screenQuadMesh = new THREE.Mesh(engine.screenQuad, deferredMaterial);
    screenQuadMesh.frustumCulled = false;
    screenQuadMesh.position.z = -0.5;
    deferredMaterial.uniforms.uDebugMode.value = 1;

    // Final Presentation Pass (Copy offscreen buffer to screen)
    const finalMaterial = new THREE.ShaderMaterial({
        uniforms: {
            tColor: { value: engine.sceneColorTarget.texture },
            tDepth: { value: engine.sceneColorTarget.depthTexture }
        },
        vertexShader: `
            varying vec2 vUv;
            void main() {
                vUv = uv;
                gl_Position = vec4(position.xyz, 1.0);
            }
        `,
        fragmentShader: `
            uniform sampler2D tColor;
            uniform sampler2D tDepth;
            varying vec2 vUv;
            void main() {
                vec4 col = texture2D(tColor, vUv);
                float dep = texture2D(tDepth, vUv).r;
                gl_FragColor = col;
                gl_FragDepth = dep;
            }
        `,
        transparent: false,
        depthTest: true,
        depthWrite: true
    });
    const finalMesh = new THREE.Mesh(engine.screenQuad, finalMaterial);
    finalMesh.frustumCulled = false;
    finalMesh.position.z = -0.5;

    // 3D Sky Sphere (Clips the world to a nice circular horizon)
    const skyGeo = new THREE.SphereGeometry(deferredMaterial.uniforms.uWorldRadius.value, 32, 32);
    const skyMat = new THREE.MeshBasicMaterial({
        map: engine.sky.texture,
        side: THREE.BackSide,
        depthWrite: false
    });
    const skySphere = new THREE.Mesh(skyGeo, skyMat);
    scene.add(skySphere);

    const sceneOrtho = new THREE.Scene();
    sceneOrtho.add(screenQuadMesh);
    sceneOrtho.add(finalMesh);

    // Global RNG for non-deterministic bits (like destination picking)
    const aiRng = makeRng(Date.now());

    // Track tree sprites per chunk key (still handled locally for simplicity)
    const chunkTrees = new Map();

    let lastUiUpdate = 0;

    // Input & Camera Physics
    const keys = { w: false, a: false, s: false, d: false, q: false, e: false };
    const camVel = new THREE.Vector3();
    const camForward = new THREE.Vector3();
    const camRight = new THREE.Vector3();
    const UP = new THREE.Vector3(0, 1, 0);

    engine.on('keydown', (e) => {
        const k = e.key.toLowerCase();
        if (k in keys) keys[k] = true;
    });
    engine.on('keyup', (e) => {
        const k = e.key.toLowerCase();
        if (k in keys) keys[k] = false;
    });

    const populateChunk = (chunk) => {
        // 1. Populate Trees (Deterministic)
        const treeRng = makeRng(Terrain.chunkKey(chunk.x, chunk.y) + 1);
        const trees = [];
        chunkTrees.set(chunk.key, trees);

        const worldX = chunk.x * terrain.chunkScale;
        const worldZ = chunk.y * terrain.chunkScale;
        const span = terrain.tileRowSize * terrain.chunkScale;

        for (let i = 0; i < 2000; i++) {
            const x = worldX + treeRng() * span;
            const z = worldZ + treeRng() * span;
            const y = terrain.getHeightAt(x, z);

            // Natural distribution: densest between 25 and 45 (treeline)
            let density = 0;
            if (y > SEA_LEVEL) {
                if (y < 25) density = (y - SEA_LEVEL) / 10;
                else if (y < 45) density = 1.0;
                else if (y < 60) density = 1.0 - (y - 45) / 15;
                else density = 0.05;
            }

            if (treeRng() > density) continue;

            const tree = characters.addSprite('forest', new THREE.Vector3(x, y - 0.5, z), (treeRng() * 16) | 0);
            const s = treeRng() < 0.001 ? 3 : (treeRng() * 2) + 0.5;
            tree.scale.set(s, s, s);
            tree.write();
            trees.push(tree);
        }

        // 2. Populate/Awaken Actors (Deterministic spawn / Progressive sim)
        const actorRng = makeRng(Terrain.chunkKey(chunk.x, chunk.y) + 2);
        worldSim.spawnForChunk(chunk, actorRng);
    };

    const evictChunk = (chunk) => {
        // 1. Evict Trees
        const trees = chunkTrees.get(chunk.key);
        if (trees) {
            const buf = characters.spriteBuffers.forest;
            if (buf) for (const t of trees) buf.free(t);
            chunkTrees.delete(chunk.key);
        }

        // 2. Hibernate Actors
        worldSim.evictChunk(chunk);
    };

    engine.on('update', (delta, time) => {
        const { camera, controls } = engine;
        const camPos = camera.position;

        // 1. Camera Movement (WASDQE)
        const accel = 1500 * delta;
        const friction = 0.92;

        camera.getWorldDirection(camForward);
        camForward.y = 0;
        camForward.normalize();
        camRight.crossVectors(camForward, UP).normalize();

        if (keys.w) camVel.addScaledVector(camForward, accel);
        if (keys.s) camVel.addScaledVector(camForward, -accel);
        if (keys.a) camVel.addScaledVector(camRight, -accel);
        if (keys.d) camVel.addScaledVector(camRight, accel);
        if (keys.q) camVel.addScaledVector(UP, accel);
        if (keys.e) camVel.addScaledVector(UP, -accel);

        camVel.multiplyScalar(friction);

        // Apply velocity to both camera and orbit target to maintain relative orientation
        const moveStep = camVel.clone().multiplyScalar(delta);
        camera.position.add(moveStep);
        controls.target.add(moveStep);

        // 2. Terrain & Chunk Lifecycle
        terrain.update(camPos, populateChunk, evictChunk);

        // 3. Simulation & Sprite Updates
        characters.beginUpdate(camera);
        worldSim.update(delta, time, camera, aiRng);

        // 4. Clamp camera above terrain
        const floorH = terrain.getHeightAt(camPos.x, camPos.z) + 2;
        if (camPos.y < floorH) {
            const dy = floorH - camPos.y;
            camPos.y = floorH;
            controls.target.y += dy;
        }
        // Prevent camera from getting too close to target to avoid jitter
        if (controls.target.distanceTo(camera.position) < 5)
            controls.target.sub(camera.position).setLength(5).add(camera.position);
    });

    // --- LAYER ASSIGNMENTS ---
    // Terrain isolated on Layer 10
    terrain.activeChunks.forEach(chunk => {
        if (chunk.mesh) chunk.mesh.layers.set(10);
    });
    // Water isolated on Layer 2
    water.mesh.layers.set(2);
    // NPCs and Props remain on Layer 0 (default)

    // --- CUSTOM PIPELINE ---
    engine.setRenderCallback((delta, time) => {
        const { renderer, scene, camera, screenCamera, gBuffer, sceneColorTarget } = engine;

        // 0. Break Feedback
        water.material.userData.shader && (water.material.userData.shader.uniforms.tSceneColor.value = null);

        // 1. G-BUFFER CAPTURE (Terrain)
        const prevBg = scene.background;
        scene.background = null;

        terrain.activeChunks.forEach(chunk => {
            if (chunk.mesh) chunk.mesh.layers.set(10);
            if (chunk.mesh) chunk.mesh.material = terrainGBufferMaterial;
        });

        camera.layers.set(10);
        renderer.setRenderTarget(gBuffer);
        renderer.clear();
        renderer.render(scene, camera);

        // Revert Terrain
        terrain.activeChunks.forEach(chunk => {
            if (chunk.mesh) chunk.mesh.material = terrain.terrainShader;
        });

        // 2. WORLD BEAUTY PASS (Composite into sceneColorTarget)
        renderer.setRenderTarget(sceneColorTarget);
        renderer.clear();

        // Sky sphere follows camera
        skySphere.position.copy(camera.position);

        // Backdrop state
        screenQuadMesh.visible = true;
        finalMesh.visible = false;

        // A: Full Terrain Composite (Deferred Terrain)
        const invViewProj = deferredMaterial.uniforms.invViewProj.value;
        invViewProj.copy(camera.matrixWorld).multiply(camera.projectionMatrixInverse);
        deferredMaterial.uniforms.uCameraPos.value.copy(camera.position);
        deferredMaterial.uniforms.uDebugMode.value = 0;

        renderer.render(sceneOrtho, screenCamera);

        // B: Actors & Sky Sphere (Forward, Layer 0)
        camera.layers.set(0);
        renderer.render(scene, camera);

        // 3. WATER PASS (Transparency & Refraction)
        water.update(renderer, camera, time, sceneColorTarget.depthTexture, sceneColorTarget.texture, noiseTexture);

        // 4. FINAL PRESENTATION
        renderer.setRenderTarget(null);
        renderer.clear();

        // A: Combined backdrop (Back to screen)
        screenQuadMesh.visible = false;
        finalMesh.visible = true;
        renderer.render(sceneOrtho, screenCamera);

        // B: Water on top
        camera.layers.set(2);
        renderer.render(scene, camera);

        // Restore
        scene.background = prevBg;
        camera.layers.enableAll();

        // Throttled UI Updates
        if (time - lastUiUpdate > 0.25) {
            lastUiUpdate = time;
            const statsEl = document.getElementById('stats');
            if (statsEl) {
                const camPos = camera.position;
                statsEl.innerHTML = `
          <div class="stat-row">
            <span class="stat-label">Camera Pos</span>
            <span class="stat-value">
              ${camPos.x.toFixed(1)}, ${camPos.y.toFixed(1)}, ${camPos.z.toFixed(1)}
            </span>
          </div>
          <div class="stat-row">
            <span class="stat-label">Active Tiles</span>
            <span class="stat-value">${terrain.activeChunks.size}</span>
          </div>
          <div class="stat-row">
            <span class="stat-label">Active NPCs</span>
            <span class="stat-value">${worldSim.activeActorCount.toLocaleString()}</span>
          </div>
          <div class="stat-row">
            <span class="stat-label">Total Population</span>
            <span class="stat-value">${worldSim.populationSize.toLocaleString()}</span>
          </div>
          <div class="stat-row">
            <span class="stat-label">Hero Units</span>
            <span class="stat-value">${worldSim.criticalActors.size.toLocaleString()}</span>
          </div>
        `;
            }
        }
    });

    engine.start();
}

startApp();

