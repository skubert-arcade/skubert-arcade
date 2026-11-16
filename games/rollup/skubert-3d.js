// Skubert Weball 3D renderer — direction tracking + actual distance-based rolling.
// Reuses the same optimized GLB already uploaded for Typing Frenzy.
// If the CDN or GLB cannot load, the lightweight image placeholder stays visible.
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
const MAX_BANK = 0.13;      // Gentle directional lean; separate from full 3D rolling.

// INTRO MOTION — subtle 3D movement while waiting on the Drop In screen.
// Angular values are radians. Adjust these to make Skubert more/less expressive.
const INTRO_YAW = 0.16;       // ~9 degrees side-to-side
const INTRO_PITCH = 0.10;     // ~6 degrees nod up/down
const INTRO_BANK = 0.055;     // ~3 degrees gentle head tilt
const INTRO_MOTION_SECONDS = 4.8; // One leisurely side-to-side cycle
const INTRO_RESPONSE = 5.0;  // Smooth transition into and out of idle movement

// ROLL SETTINGS — change these values to customize the physical feel.
const ROLL_STRENGTH = 0.80;  // 1 = physically proportionate rolling, 0.5 = slower spin, 0 = off.
const ROLL_RADIUS_FACTOR = 0.48; // Effective ball radius as a fraction of avatar width.
const MAX_ROLL_STEP = 0.75; // Clamp sudden large wheel-scroll jumps (~43 degrees/frame).
const RENDER_MAX_FPS = 30;  // Limits GPU work on a ~550k-triangle GLB.
const MODEL_BUFFER_SIZE = 448; // Stable render target; avoids GPU reallocations on every pickup.

const avatar = document.getElementById('avatar');
const inner = avatar?.querySelector('.avatar-inner');
const fallback = inner?.querySelector('.skubert-fallback') || inner?.querySelector('svg');
if (!avatar || !inner || !fallback) {
  console.warn('Skubert 3D: expected #avatar > .avatar-inner > .skubert-fallback; leaving 2D mascot.');
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
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.25));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.domElement.className = 'skubert-webgl';
  renderer.domElement.setAttribute('aria-hidden','true');
  inner.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100);
  camera.position.set(0, 0, 5);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x8ba3b6, 1.2));
  const key = new THREE.DirectionalLight(0xffffff, 1.6);
  key.position.set(2, 4, 5);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xc8dfff, 0.35);
  fill.position.set(-3, -1, 1);
  scene.add(fill);

  // Parent quaternion accumulates a real, unbounded 3D roll. Its axis is
  // perpendicular to travel across the webpage, not merely a small face tilt.
  const rollingPivot = new THREE.Group();
  scene.add(rollingPivot);
  const facingPivot = new THREE.Group();
  facingPivot.rotation.order='YXZ';
  rollingPivot.add(facingPivot);
  const rollAxis = new THREE.Vector3();
  const rollStep = new THREE.Quaternion();

  let loaded = false;
  let previousX = null;
  let previousY = null;
  let previousScene = null;
  let previousScrollNode = null;
  let previousScrollTop = 0;
  let previousTime = performance.now();
  let previousRender = 0;
  let bufferReady=false;
  let yaw=0,pitch=0,bank=0;
  const introMotionStart = performance.now();

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
    facingPivot.add(base);
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
    // A canvas resize allocates a new GPU drawing buffer. Previously this ran
    // after *every pickup* as Skubert's diameter grew, causing blank frames
    // and stutter. Keep one stable square buffer and scale its DOM canvas using
    // the existing .skubert-webgl {width:100%;height:100%} CSS.
    if(bufferReady)return;
    bufferReady=true;
    camera.aspect=1;
    camera.updateProjectionMatrix();
    renderer.setSize(MODEL_BUFFER_SIZE,MODEL_BUFFER_SIZE,false);
  }

  function articleScroller(game) {
    if (!game) return null;
    // Both saved levels use a same-origin iframe.
    const frame = document.getElementById('levelSnapshot');
    try {
      const doc = frame?.contentDocument;
      if (doc?.body) return doc.scrollingElement || doc.documentElement || doc.body;
    } catch (_) { /* Cross-origin frame: omit scroll tracking safely. */ }
    return null;
  }

  function animate(now) {
    const dt = Math.min(0.06, Math.max(0.001, (now-previousTime)/1000));
    previousTime=now;
    const game=window.skubertWeballState;
    if (game && loaded) {
      resizeToAvatar();
      const playing = game.status === 'playing';
      const sceneChanged = previousScene !== game.scene;
      previousScene = game.scene;

      // Track actual page scrolling as traveled distance too. At the screen
      // edge, Skubert's x/y stop changing while the article travels beneath.
      const scrollNode = articleScroller(game);
      const scrollTop = scrollNode ? scrollNode.scrollTop : 0;
      if (scrollNode !== previousScrollNode || sceneChanged) {
        previousScrollTop = scrollTop;
        previousScrollNode = scrollNode;
      }
      const scrollDelta = playing ? scrollTop-previousScrollTop : 0;
      previousScrollTop = scrollTop;

      if (previousX === null || previousY === null || !playing || sceneChanged) {
        previousX = game.x;
        previousY = game.y;
      }
      const dx = playing ? game.x-previousX : 0;
      // Page moves upward when scrolling down: relative to its surface,
      // Skubert is rolling downward even if his screen position is fixed.
      const dy = playing ? game.y-previousY+scrollDelta : 0;
      previousX=game.x;
      previousY=game.y;

      const distance = Math.hypot(dx,dy);
      if (playing && distance > 0.01 && ROLL_STRENGTH > 0) {
        // Screen y points DOWN, Three.js y points UP. Rolling axis is the
        // cross product of travel direction and the surface normal (+Z).
        // Thus moving right turns around -Y; moving down turns around -X.
        rollAxis.set(-dy, -dx, 0).multiplyScalar(1/distance);
        const radius = Math.max(22, avatar.clientWidth * ROLL_RADIUS_FACTOR);
        const angle = Math.min(MAX_ROLL_STEP, distance/radius * ROLL_STRENGTH);
        rollStep.setFromAxisAngle(rollAxis,angle);
        // Premultiply means the rolling axis stays aligned to the webpage,
        // regardless of the model's accumulated orientation.
        rollingPivot.quaternion.premultiply(rollStep).normalize();
      }

      // The GLB is already loaded on the intro screen. Gently turn and nod its
      // actual 3D geometry, independently of the existing CSS up/down bob.
      // Suspend the idle motion during the 360-degree launch windup, so it
      // doesn't appear to add another unexpected spin.
      const introActive = game.status === 'intro' && avatar.classList.contains('drop-ready');
      const windup = avatar.classList.contains('launch-windup');
      const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
      let targetYaw, targetPitch, targetBank;
      if (introActive && !windup && !reduceMotion) {
        const phase = (now - introMotionStart) * (2 * Math.PI / (INTRO_MOTION_SECONDS * 1000));
        targetYaw = INTRO_YAW * Math.sin(phase);
        targetPitch = INTRO_PITCH * Math.sin(phase * 0.67 + 0.8);
        targetBank = INTRO_BANK * Math.sin(phase + 1.1);
      } else if (playing) {
        // Existing motion-driven 3D facing during gameplay remains unchanged.
        targetYaw = THREE.MathUtils.clamp(-dx * 0.065, -MAX_YAW, MAX_YAW);
        targetPitch = THREE.MathUtils.clamp(-dy * 0.045, -MAX_PITCH, MAX_PITCH);
        targetBank = THREE.MathUtils.clamp(-dx * 0.022, -MAX_BANK, MAX_BANK);
      } else {
        targetYaw = targetPitch = targetBank = 0;
      }
      const response = introActive ? INTRO_RESPONSE : TURN_RESPONSE;
      yaw = THREE.MathUtils.damp(yaw, targetYaw, response, dt);
      pitch = THREE.MathUtils.damp(pitch, targetPitch, response, dt);
      bank = THREE.MathUtils.damp(bank, targetBank, response, dt);
      facingPivot.rotation.set(pitch, yaw, bank, 'YXZ');

      // IMPORTANT: keep drawing while the intro is open. The old condition
      // skipped every frame when .drop-ready was present, so the loaded GLB
      // looked like a still image sliding around with the CSS animation.
      if (now - previousRender >= 1000 / RENDER_MAX_FPS) {
        renderer.render(scene, camera);
        previousRender = now;
      }
    }
    requestAnimationFrame(animate);
  }
  requestAnimationFrame(animate);
}
