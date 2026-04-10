import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

/**
 * Core engine class. Handles scene, renderer, camera and main loop.
 */
class GradientSky {
  constructor(scene) {
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');
    const grad = ctx.createLinearGradient(0, 0, 0, 64);
    grad.addColorStop(0, 'rgba(0,127,181,1)');
    grad.addColorStop(0.14, 'rgba(5,193,255,1)');
    grad.addColorStop(0.5, 'rgba(255,219,181,1)');
    grad.addColorStop(0.68, 'rgba(140,72,0,1)');
    grad.addColorStop(0.9, 'rgba(64,32,0,1)');
    grad.addColorStop(1, 'rgba(64,32,0,1)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 64, 64);
    const texture = new THREE.CanvasTexture(canvas);
    scene.background = texture;
  }
}

export class Engine {
  constructor(container = document.body) {
    this.container = window.app;//container;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(110, window.innerWidth / window.innerHeight, 0.1, 5000);

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      logarithmicDepthBuffer: true
    });
    // this.renderer.setClearColor(0x87CEEB); // Sky blue
    new GradientSky(this.scene);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.container.appendChild(this.renderer.domElement);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.maxPolarAngle = Math.PI / 2.1;
    this.controls.minDistance = 10;
    this.controls.maxDistance = 1000;

    this.camera.position.set(100, 100, 100);
    this.controls.target.set(0, 0, 0);

    this.listeners = new Map();
    this._setupWindowEvents();

    this.clock = new THREE.Timer();
    this.animate = this.animate.bind(this);
  }

  _setupWindowEvents() {
    window.addEventListener('resize', () => {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(window.innerWidth, window.innerHeight);
    });
  }

  on(event, callback) {
    if (!this.listeners.has(event)) this.listeners.set(event, []);
    this.listeners.get(event).push(callback);
  }

  emit(event, ...args) {
    const callbacks = this.listeners.get(event);
    if (callbacks) callbacks.forEach(cb => cb(...args));
  }

  start() {
    this.renderer.setAnimationLoop(this.animate);
  }

  animate() {
    this.clock.update();
    const delta = this.clock.getDelta();
    const time = this.clock.getElapsed();

    this.emit('update', delta, time);
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }
}
