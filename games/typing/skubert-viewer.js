// Skubert Typing Frenzy: 3D model that watches descending words.
// Three.js uses the pinned CDN import map in game.html.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const MODEL_PATH = './models/skubert.glb';
const MODEL_BASE_YAW = 0; // Change to Math.PI if Skubert faces backward.
const TURN_STRENGTH = 0.52; // Radians, ~30 degrees at the far edges.
const SMOOTHING = 5.0; // Higher values mean quicker turns.
const PITCH_STRENGTH = 1.10; // Radians per full playfield height.
const MAX_UP_TILT = 0.55; // ~32 degrees.
const MAX_DOWN_TILT = 0.38; // ~22 degrees.
const INVERT_PITCH = false; // Set true if the head tilts away from the word.

const gameArea = document.getElementById('GameContent');
const wrapper = document.getElementById('Wrapper');
const mount = document.getElementById('skubert-viewer');
if (!gameArea || !wrapper || !mount) {
  throw new Error('Missing #GameContent, #Wrapper, or #skubert-viewer.');
}

// Enlarge the complete viewer, including its PNG fallback, without changing
// the camera framing or the GLB's head-tracking movement. The model grows by
// 1% of its INITIAL display size for each correctly submitted letter.
// Growth is linear: 20 correct letters = 120% of the initial model size.
mount.style.transformOrigin = 'center bottom';
mount.style.transition = 'transform 180ms ease-out';
function updateSkubertGrowth() {
  const letters = Math.max(0, Number(window.skubertGrowthLetters) || 0);
  const scale = 1 + letters * 0.01;
  mount.style.transform = `scale(${scale})`;
}
window.addEventListener('skubert:word-correct', updateSkubertGrowth);
updateSkubertGrowth();

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100);
camera.position.set(0, 0, 5.0);

const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.setClearColor(0x000000, 0);
mount.appendChild(renderer.domElement);

scene.add(new THREE.HemisphereLight(0xffffff, 0x8091c2, 2.0));
const keyLight = new THREE.DirectionalLight(0xffffff, 2.2);
keyLight.position.set(2, 3, 5);
scene.add(keyLight);

// Rotate a parent group rather than the model meshes or GLB animation bones.
const skubertPivot = new THREE.Group();
skubertPivot.rotation.order = 'YXZ'; // Head-like yaw and pitch.
scene.add(skubertPivot);
let isLoaded = false;

function sizeAndPosition() {
  const area = gameArea.getBoundingClientRect();
  const parent = wrapper.getBoundingClientRect();
  const width = Math.max(112, Math.min(194, area.width * 0.34));
  const height = width;

  mount.style.width = `${width}px`;
  mount.style.height = `${height}px`;
  // Put Skubert at the bottom-center of the falling-word area.
  // Parent is #Wrapper, not #GameContent: the game's game-over code
  // replaces #GameContent.innerHTML, and would destroy an embedded canvas.
  mount.style.left = `${area.left - parent.left + (area.width - width) / 2}px`;
  mount.style.top = `${area.bottom - parent.top - height - 5}px`;

  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height, false);
}

sizeAndPosition();
window.addEventListener('resize', sizeAndPosition);
if (window.ResizeObserver) {
  new ResizeObserver(sizeAndPosition).observe(gameArea);
}

const loader = new GLTFLoader();
console.time('Skubert GLB load and parse');
loader.load(
  MODEL_PATH,
  ({ scene: model }) => {
    console.timeEnd('Skubert GLB load and parse');
    // Center and normalize any reasonable model scale automatically.
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
  },
  (event) => {
    if (event.total) {
      const percent = Math.round(100 * event.loaded / event.total);
      if (percent === 100) console.info('Skubert GLB transfer complete; parsing/render setup may continue.');
    }
  },
  (error) => {
    console.timeEnd('Skubert GLB load and parse');
    console.error('Unable to load Skubert GLB at ' + MODEL_PATH, error);
    console.info('Upload models/skubert.glb next to game.html, then refresh.');
  }
);

const clock = new THREE.Clock();

function findLowestWord() {
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
  return { word: closestToBottom, area };
}

function animate() {
  const dt = Math.min(clock.getDelta(), 0.05);
  const gameFinished = !!gameArea.querySelector('.modal-gameover');
  if (isLoaded) {
    mount.style.opacity = gameFinished ? '0' : '1';
    const { word, area } = findLowestWord();
    let targetYaw = 0;
    let targetPitch = 0;

    if (word && !gameFinished && area.width > 0 && area.height > 0) {
      const horizontal = THREE.MathUtils.clamp(
        (word.x - (area.left + area.width / 2)) / (area.width / 2),
        -1, 1
      );
      // Pitch follows the word relative to Skubert's actual center.
      // Earlier code measured from the playfield midpoint and only moved
      // ~7 degrees, so the up/down motion was very difficult to see.
      const headBounds = mount.getBoundingClientRect();
      const headCenterY = headBounds.top + headBounds.height / 2;
      const verticalOffset = (word.y - headCenterY) / area.height;

      targetYaw = horizontal * TURN_STRENGTH;
      targetPitch = THREE.MathUtils.clamp(
        verticalOffset * PITCH_STRENGTH,
        -MAX_UP_TILT, MAX_DOWN_TILT
      );
      if (INVERT_PITCH) targetPitch = -targetPitch;
    }

    skubertPivot.rotation.y = THREE.MathUtils.damp(
      skubertPivot.rotation.y, targetYaw, SMOOTHING, dt
    );
    skubertPivot.rotation.x = THREE.MathUtils.damp(
      skubertPivot.rotation.x, targetPitch, SMOOTHING, dt
    );
  }
  renderer.render(scene, camera);
  // Switch from the PNG only AFTER rendering a frame containing the GLB.
  // A downloaded model alone is not evidence that it is visible yet.
  if (isLoaded && !mount.classList.contains('model-ready')) {
    mount.classList.add('model-ready');
  }
}
renderer.setAnimationLoop(animate);
