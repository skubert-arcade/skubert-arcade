// Skubert Typing Frenzy 3D viewer — reduced layout and GPU overhead.
// Preserves head-tracking behavior and 1% original-size growth per letter.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const MODEL_PATH = './models/skubert.glb';
const MODEL_BASE_YAW = 0;
const TURN_STRENGTH = 0.52;
const SMOOTHING = 5.0;
const PITCH_STRENGTH = 1.10;
const MAX_UP_TILT = 0.55;
const MAX_DOWN_TILT = 0.38;
const INVERT_PITCH = false;

// Performance settings. Tune these first if needed.
const MAX_RENDER_EDGE_PX = 1024;          // Before: 1536
const MAX_NATIVE_PIXEL_RATIO = 2;
const RENDER_FPS = 45;                    // Before: display refresh rate (often 60)
const WORD_TRACK_INTERVAL_MS = 75;       // Before: every rendered frame
const RESOLUTION_STEP_PX = 96;           // Reduce render-target reallocations

const gameArea = document.getElementById('GameContent');
const wrapper = document.getElementById('Wrapper');
const mount = document.getElementById('skubert-viewer');
if (!gameArea || !wrapper || !mount) {
  throw new Error('Missing #GameContent, #Wrapper, or #skubert-viewer.');
}

let skubertDisplayScale = 1;
let viewerWidth = 194;
let viewerHeight = 194;
let lastBackingWidth = -1;
let lastBackingHeight = -1;
let lastScale = -1;
let lastOpacity = '';
mount.style.transformOrigin = 'center bottom';
mount.style.transition = 'opacity 0.2s ease, transform 180ms ease-out';

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100);
camera.position.set(0, 0, 5.0);
const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.setClearColor(0x000000, 0);
mount.appendChild(renderer.domElement);
scene.add(new THREE.HemisphereLight(0xffffff, 0x8091c2, 2.0));
const keyLight = new THREE.DirectionalLight(0xffffff, 2.2);
keyLight.position.set(2, 3, 5);
scene.add(keyLight);
const skubertPivot = new THREE.Group();
skubertPivot.rotation.order = 'YXZ';
scene.add(skubertPivot);
let isLoaded = false;

function updateRenderResolution() {
  // Increase detail as Skubert grows, in quantized increments, capped at 1024.
  // Avoid reallocating the WebGL canvas after EVERY correctly typed word.
  const nativeDpr = Math.min(MAX_NATIVE_PIXEL_RATIO, Math.max(1, window.devicePixelRatio || 1));
  const wantedEdge = Math.max(viewerWidth, viewerHeight) * nativeDpr * skubertDisplayScale;
  const backingEdge = Math.min(MAX_RENDER_EDGE_PX, Math.ceil(wantedEdge / RESOLUTION_STEP_PX) * RESOLUTION_STEP_PX);
  const maxDimension = Math.max(viewerWidth, viewerHeight);
  const nextRatio = backingEdge / maxDimension;
  const nextWidth = Math.round(viewerWidth * nextRatio);
  const nextHeight = Math.round(viewerHeight * nextRatio);
  if (lastBackingWidth === nextWidth && lastBackingHeight === nextHeight) return;
  lastBackingWidth = nextWidth;
  lastBackingHeight = nextHeight;
  renderer.setPixelRatio(nextRatio);
  renderer.setSize(viewerWidth, viewerHeight, false);
}

function updateSkubertGrowth() {
  const letters = Math.max(0, Number(window.skubertGrowthLetters) || 0);
  skubertDisplayScale = 1 + letters * 0.01;
  if (skubertDisplayScale !== lastScale) {
    mount.style.transform = `scale(${skubertDisplayScale})`;
    lastScale = skubertDisplayScale;
    updateRenderResolution();
  }
}

function sizeAndPosition() {
  const area = gameArea.getBoundingClientRect();
  const parent = wrapper.getBoundingClientRect();
  const width = Math.max(112, Math.min(194, area.width * 0.34));
  const height = width;
  viewerWidth = width;
  viewerHeight = height;
  mount.style.width = `${width}px`;
  mount.style.height = `${height}px`;
  mount.style.left = `${area.left - parent.left + (area.width - width) / 2}px`;
  mount.style.top = `${area.bottom - parent.top - height - 5}px`;
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  updateRenderResolution();
}
sizeAndPosition();
window.addEventListener('resize', sizeAndPosition);
if (window.ResizeObserver) new ResizeObserver(sizeAndPosition).observe(gameArea);
window.addEventListener('skubert:word-correct', updateSkubertGrowth);
updateSkubertGrowth();

const loader = new GLTFLoader();
console.time('Skubert GLB load and parse');
loader.load(
  MODEL_PATH,
  ({ scene: model }) => {
    console.timeEnd('Skubert GLB load and parse');
    const bounds = new THREE.Box3().setFromObject(model);
    if (bounds.isEmpty()) {
      console.warn('Skubert GLB did not contain visible geometry.');
      return;
    }
    const size = bounds.getSize(new THREE.Vector3());
    const center = bounds.getCenter(new THREE.Vector3());
    const maxDimension = Math.max(size.x, size.y, size.z);
    model.position.sub(center);
    const baseGroup = new THREE.Group();
    baseGroup.scale.setScalar(2.7 / maxDimension);
    baseGroup.rotation.y = MODEL_BASE_YAW;
    baseGroup.add(model);
    skubertPivot.add(baseGroup);
    isLoaded = true;
    mount.style.opacity = '1';
    lastOpacity = '1';
  },
  (event) => {
    if (event.total && event.loaded === event.total) {
      console.info('Skubert GLB transfer complete; parsing/render setup may continue.');
    }
  },
  (error) => {
    console.timeEnd('Skubert GLB load and parse');
    console.error('Unable to load Skubert GLB at ' + MODEL_PATH, error);
    console.info('Upload models/skubert.glb next to game.html, then refresh.');
  }
);

let previousFrame = 0;
let previousTrack = -Infinity;
let cachedWord = null;
let cachedArea = null;
let cachedHeadY = 0;
let gameFinished = false;

function trackLowestWord() {
  // Do fewer bounding-rectangle reads than render calls (reduces layout pressure).
  const area = gameArea.getBoundingClientRect();
  let closestToBottom = null;
  let greatestY = -Infinity;
  for (const word of gameArea.querySelectorAll('.word')) {
    const rect = word.getBoundingClientRect();
    if (!rect.width || !rect.height) continue;
    const midY = rect.top + rect.height / 2;
    if (midY > greatestY && midY <= area.bottom) {
      greatestY = midY;
      closestToBottom = { x: rect.left + rect.width / 2, y: midY };
    }
  }
  cachedWord = closestToBottom;
  cachedArea = area;
  const headBounds = mount.getBoundingClientRect();
  cachedHeadY = headBounds.top + headBounds.height / 2;
  gameFinished = !!gameArea.querySelector('.modal-gameover');
}

function animate(now) {
  if (!previousFrame) previousFrame = now;
  if (now - previousFrame < 1000 / RENDER_FPS) return;
  const dt = Math.min((now - previousFrame) / 1000, 0.05);
  previousFrame = now;

  // Keep viewer quiet until its mesh is available. The GLB loads asynchronously.
  if (!isLoaded || document.hidden) return;
  if (now - previousTrack >= WORD_TRACK_INTERVAL_MS || !cachedArea) {
    trackLowestWord();
    previousTrack = now;
  }
  const opacity = gameFinished ? '0' : '1';
  if (opacity !== lastOpacity) {
    mount.style.opacity = opacity;
    lastOpacity = opacity;
  }
  if (gameFinished) return;

  let targetYaw = 0;
  let targetPitch = 0;
  if (cachedWord && cachedArea.width > 0 && cachedArea.height > 0) {
    const horizontal = THREE.MathUtils.clamp(
      (cachedWord.x - (cachedArea.left + cachedArea.width / 2)) / (cachedArea.width / 2),
      -1, 1
    );
    const verticalOffset = (cachedWord.y - cachedHeadY) / cachedArea.height;
    targetYaw = horizontal * TURN_STRENGTH;
    targetPitch = THREE.MathUtils.clamp(verticalOffset * PITCH_STRENGTH, -MAX_UP_TILT, MAX_DOWN_TILT);
    if (INVERT_PITCH) targetPitch = -targetPitch;
  }
  skubertPivot.rotation.y = THREE.MathUtils.damp(skubertPivot.rotation.y, targetYaw, SMOOTHING, dt);
  skubertPivot.rotation.x = THREE.MathUtils.damp(skubertPivot.rotation.x, targetPitch, SMOOTHING, dt);
  renderer.render(scene, camera);
  if (!mount.classList.contains('model-ready')) mount.classList.add('model-ready');
}
renderer.setAnimationLoop(animate);
