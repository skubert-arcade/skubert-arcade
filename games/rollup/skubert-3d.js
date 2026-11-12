// Optional Three.js Skubert mascot for Skubert Weball v4.
// Reuses the same optimized GLB already uploaded for Typing Frenzy.
// If the CDN or GLB cannot load, the original 2D avatar stays visible.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// To use a separate copy in this game's models/ folder instead, change to
// const MODEL_PATH = './models/skubert.glb';
const MODEL_PATH = '../typing/models/skubert.glb';
const MODEL_BASE_YAW = 0;    // Use Math.PI if the face points backward.
const MODEL_SCALE = 2.7;     // Visible height in scene units; camera is at z=5.
const TURN_RESPONSE = 5.5;   // Higher = more responsive turning.
const MAX_YAW = 0.42;       // Head turns as it travels horizontally.
const MAX_PITCH = 0.30;     // Tilts slightly when moving vertically.
const MAX_ROLL = 0.13;      // Subtle side tilt while moving.
const RENDER_MAX_FPS = 30;  // Limits GPU work on a 500k-triangle GLB.

const avatar = document.getElementById('avatar');
const inner = avatar?.querySelector('.avatar-inner');
const fallback = inner?.querySelector('svg');
if (!avatar || !inner || !fallback) {
  console.warn('Skubert 3D: expected #avatar > .avatar-inner > svg; leaving 2D mascot.');
} else {
  start3D();
}

function start3D() {
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'default' });
  } catch (error) {
    console.warn('Skubert 3D: WebGL unavailable; keeping 2D mascot.', error);
    return;
  }
  renderer.setClearColor(0x000000, 0);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.25;
  renderer.domElement.className = 'skubert-webgl';
  renderer.domElement.setAttribute('aria-hidden','true');
  inner.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100);
  camera.position.set(0, 0, 5);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x8ba3b6, 2.3));
  const key = new THREE.DirectionalLight(0xffffff, 2.5);
  key.position.set(2, 4, 5);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xc8dfff, 0.8);
  fill.position.set(-3, -1, 1);
  scene.add(fill);

  const pivot = new THREE.Group();
  pivot.rotation.order='YXZ';
  scene.add(pivot);
  let loaded = false;
  let previousX = null;
  let previousY = null;
  let previousTime = performance.now();
  let previousRender = 0;
  let lastW=0,lastH=0;
  let yaw=0,pitch=0,roll=0;

  const loader = new GLTFLoader();
  console.time('Skubert Weball GLB load');
  loader.load(MODEL_PATH, ({scene: model})=>{
    console.timeEnd('Skubert Weball GLB load');
    const bounds = new THREE.Box3().setFromObject(model);
    if (bounds.isEmpty()) { console.warn('Skubert 3D: empty GLB geometry.'); return; }
    const dimensions = bounds.getSize(new THREE.Vector3());
    const center = bounds.getCenter(new THREE.Vector3());
    const maxDim = Math.max(dimensions.x, dimensions.y, dimensions.z);
    if (!Number.isFinite(maxDim) || maxDim <= 0) return;
    model.position.sub(center); // rotate around actual head center, not original GLB origin
    const base = new THREE.Group();
    base.scale.setScalar(MODEL_SCALE/maxDim);
    base.rotation.y = MODEL_BASE_YAW;
    base.add(model);
    pivot.add(base);
    loaded = true;
    resizeToAvatar();
    renderer.render(scene, camera); // prevent a black/empty first frame
    avatar.classList.add('has-3d');
    console.info('Skubert 3D ready; 2D mascot hidden.');
  }, undefined, error => {
    console.timeEnd('Skubert Weball GLB load');
    console.warn(`Skubert 3D: couldn't load ${MODEL_PATH}. Keeping 2D mascot.`,error);
  });

  function resizeToAvatar() {
    // Avatar changes dimensions as the player collects items and levels up.
    const width=Math.max(1,Math.round(inner.clientWidth));
    const height=Math.max(1,Math.round(inner.clientHeight));
    if (width===lastW && height===lastH) return;
    lastW=width;lastH=height;
    camera.aspect=width/height;
    camera.updateProjectionMatrix();
    renderer.setSize(width,height,false);
  }
  window.addEventListener('resize', resizeToAvatar);

  function animate(now) {
    const dt = Math.min(0.06, Math.max(0.001, (now-previousTime)/1000));
    previousTime=now;
    const game=window.skubertWeballState;
    if (game && loaded) {
      resizeToAvatar();
      if (previousX===null || previousY===null || game.status!=='playing') {
        previousX=game.x;previousY=game.y;
      }
      const dx=game.status==='playing'?game.x-previousX:0;
      const dy=game.status==='playing'?game.y-previousY:0;
      previousX=game.x;previousY=game.y;
      // Relative movement drives head tracking. Keep the face mostly forward.
      const targetYaw=THREE.MathUtils.clamp(-dx*0.065,-MAX_YAW,MAX_YAW);
      const targetPitch=THREE.MathUtils.clamp(-dy*0.045,-MAX_PITCH,MAX_PITCH);
      const targetRoll=THREE.MathUtils.clamp(-dx*0.022,-MAX_ROLL,MAX_ROLL);
      yaw=THREE.MathUtils.damp(yaw,targetYaw,TURN_RESPONSE,dt);
      pitch=THREE.MathUtils.damp(pitch,targetPitch,TURN_RESPONSE,dt);
      roll=THREE.MathUtils.damp(roll,targetRoll,TURN_RESPONSE,dt);
      pivot.rotation.set(pitch,yaw,roll,'YXZ');
      if (now-previousRender >= 1000/RENDER_MAX_FPS) {
        renderer.render(scene,camera);
        previousRender=now;
      }
    }
    requestAnimationFrame(animate);
  }
  requestAnimationFrame(animate);
}
