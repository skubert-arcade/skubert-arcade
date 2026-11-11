// Skubert Typing Frenzy: 3D model that watches descending words.
// Three.js uses the pinned CDN import map in game.html.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const MODEL_PATH = './models/skubert.glb';
const MODEL_BASE_YAW = 0; // Change to Math.PI if Skubert faces backward.
const TURN_STRENGTH = 0.52; // Radians, ~30 degrees at the far edges.
const SMOOTHING = 5.0; // Higher values mean quicker turns.

const gameArea = document.getElementById('GameContent');
const wrapper = document.getElementById('Wrapper');
const mount = document.getElementById('skubert-viewer');
if (!gameArea || !wrapper || !mount) {
  throw new Error('Missing #GameContent, #Wrapper, or #skubert-viewer.');
}

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100);
camera.position.set(0, 0, 5.0);

const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.setClearColor(0x000000, 0);
mount.appendChild(renderer.domElement);

scene.add(new THREE.HemisphereLight(0xffffff, 0x8091c2, 2.0));
const keyLight = new THREE.DirectionalLight(0xffffff, 2.2);
keyLight.position.set(2, 3, 5);
scene.add(keyLight);

// Rotate a parent group rather than the model meshes or GLB animation bones.
const skubertPivot = new THREE.Group();
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
loader.load(
  MODEL_PATH,
  ({ scene: model }) => {
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
  undefined,
  (error) => {
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
      const progress = THREE.MathUtils.clamp(
        (word.y - area.top) / area.height, 0, 1
      );
      targetYaw = horizontal * TURN_STRENGTH;
      targetPitch = (0.5 - progress) * 0.25;
    }

    skubertPivot.rotation.y = THREE.MathUtils.damp(
      skubertPivot.rotation.y, targetYaw, SMOOTHING, dt
    );
    skubertPivot.rotation.x = THREE.MathUtils.damp(
      skubertPivot.rotation.x, targetPitch, SMOOTHING, dt
    );
  }
  renderer.render(scene, camera);
}
renderer.setAnimationLoop(animate);
