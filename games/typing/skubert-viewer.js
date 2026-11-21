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

// PANGRAM CELEBRATION: brief fireworks burst, then respawn at starting size.
// Uses one short-lived 2D canvas over the existing 3D viewer; the GLB scene,
// renderer, meshes, and animation loop are never destroyed or recreated.
const PANGRAM_FIREWORKS_DURATION_MS = 1280;
const PANGRAM_RESPAWN_DELAY_MS = 930;
const PANGRAM_COLORS = [
  '#ffdf54', '#6be4ff', '#ffffff', '#ff5b80',
  '#99ffcc', '#e4a1ff', '#ff9b4b'
];
const reducedFireworksMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches || false;
let pangramCelebrating = false;
let pangramCelebrationToken = 0;
let lastExplosionFrameId = 0;
let celebrationLayer = null;
let celebrationCtx = null;

function ensureCelebrationCanvas() {
  if (celebrationLayer) return celebrationLayer;
  const layer = document.createElement('canvas');
  layer.className = 'skubert-pangram-fireworks';
  layer.setAttribute('aria-hidden', 'true');
  Object.assign(layer.style, {
    position: 'absolute', inset: '0', width: '100%', height: '100%',
    zIndex: '9', pointerEvents: 'none', display: 'none'
  });
  wrapper.appendChild(layer);
  celebrationLayer = layer;
  celebrationCtx = layer.getContext('2d', { alpha: true });
  return layer;
}

function fireworksAtSkubert(token) {
  const layer = ensureCelebrationCanvas();
  if (!celebrationCtx) return;
  const wrapperRect = wrapper.getBoundingClientRect();
  const modelRect = mount.getBoundingClientRect(); // Capture grown size BEFORE resetting it.
  const fieldRect = gameArea.getBoundingClientRect();
  // If Skubert has grown taller than the playfield, burst from the center of
  // the *visible* part of him, not from a point far above the screen.
  const visibleLeft = Math.max(modelRect.left, fieldRect.left);
  const visibleRight = Math.min(modelRect.right, fieldRect.right);
  const visibleTop = Math.max(modelRect.top, fieldRect.top);
  const visibleBottom = Math.min(modelRect.bottom, fieldRect.bottom);
  const rawX = visibleRight > visibleLeft
    ? (visibleLeft + visibleRight) / 2 : modelRect.left + modelRect.width / 2;
  const rawY = visibleBottom > visibleTop
    ? (visibleTop + visibleBottom) / 2 : modelRect.top + modelRect.height / 2;
  const centerX = Math.max(12, Math.min(wrapperRect.width - 12, rawX - wrapperRect.left));
  const centerY = Math.max(12, Math.min(wrapperRect.height - 12, rawY - wrapperRect.top));
  const width = Math.max(1, wrapper.clientWidth);
  const height = Math.max(1, wrapper.clientHeight);
  const dpr = Math.min(window.devicePixelRatio || 1, 1.25);
  layer.width = Math.round(width * dpr);
  layer.height = Math.round(height * dpr);
  layer.style.display = 'block';
  const ctx = celebrationCtx;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const particles = [];
  const sparks = (x, y, count, speedFactor = 1) => {
    for (let i = 0; i < count; i++) {
      const direction = (i / count) * Math.PI * 2 + (Math.random() - 0.5) * 0.21;
      const speed = (105 + Math.random() * 225) * speedFactor;
      const lifetime = 0.65 + Math.random() * 0.55;
      particles.push({
        x, y, prevX: x, prevY: y,
        vx: Math.cos(direction) * speed,
        vy: Math.sin(direction) * speed - 48,
        lifetime, remaining: lifetime,
        radius: 1.8 + Math.random() * 2.4,
        color: PANGRAM_COLORS[i % PANGRAM_COLORS.length]
      });
    }
  };
  sparks(centerX, centerY, reducedFireworksMotion ? 34 : 100);
  const satelliteBursts = [
    { at: 0.22, x: centerX - Math.min(95, width * .12), y: centerY - 47, count: 36 },
    { at: 0.39, x: centerX + Math.min(108, width * .13), y: centerY - 76, count: 36 }
  ];
  if (reducedFireworksMotion) satelliteBursts.length = 0;

  const begun = performance.now();
  let last = begun;
  let frame = 0;
  function render(now) {
    if (token !== pangramCelebrationToken || document.hidden) {
      ctx.clearRect(0, 0, width, height);
      layer.style.display = 'none';
      lastExplosionFrameId = 0;
      return;
    }
    const elapsed = (now - begun) / 1000;
    const dt = Math.min(0.045, Math.max(0, (now - last) / 1000));
    // Leave GPU/CPU headroom for the 3D model and falling words.
    if (now - last < 1000 / 45 && frame > 0) {
      lastExplosionFrameId = requestAnimationFrame(render);
      return;
    }
    last = now;
    frame++;
    ctx.clearRect(0, 0, width, height);

    for (const b of satelliteBursts) {
      if (!b.done && elapsed >= b.at) {
        sparks(b.x, b.y, b.count, .64);
        b.done = true;
      }
    }
    const flash = Math.max(0, 1 - elapsed / .19);
    if (flash > 0) {
      ctx.save();
      const grad = ctx.createRadialGradient(centerX, centerY, 0, centerX, centerY, 64 + 55 * (1 - flash));
      grad.addColorStop(0, `rgba(255,255,255,${.92 * flash})`);
      grad.addColorStop(.4, `rgba(255,214,111,${.46 * flash})`);
      grad.addColorStop(1, 'rgba(255,214,111,0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(centerX, centerY, 120, 0, 2 * Math.PI);
      ctx.fill();
      ctx.restore();
    }

    // Two expanding golden/blue rings, as in the arcade's existing effects.
    for (let i = 0; i < 2; i++) {
      const phase = (elapsed - i * .11) / .58;
      if (phase >= 0 && phase < 1) {
        ctx.globalAlpha = (1 - phase) * .72;
        ctx.strokeStyle = i ? '#6be4ff' : '#ffdf54';
        ctx.lineWidth = (1 - phase) * 5 + .8;
        ctx.beginPath();
        ctx.arc(centerX, centerY, 14 + phase * 170, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.remaining -= dt;
      if (p.remaining <= 0) { particles.splice(i, 1); continue; }
      p.prevX = p.x;
      p.prevY = p.y;
      p.vy += 155 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      const alpha = Math.min(1, p.remaining / Math.min(.38, p.lifetime));
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = p.color;
      ctx.lineWidth = p.radius * 1.15;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(p.x - (p.x - p.prevX) * 3.5, p.y - (p.y - p.prevY) * 3.5);
      ctx.stroke();
      if (i % 5 === 0) {
        ctx.fillStyle = '#fffbe6';
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.radius * .5, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;

    if (elapsed < PANGRAM_FIREWORKS_DURATION_MS / 1000 && (particles.length || elapsed < .65)) {
      lastExplosionFrameId = requestAnimationFrame(render);
    } else {
      ctx.clearRect(0, 0, width, height);
      layer.style.display = 'none';
      lastExplosionFrameId = 0;
    }
  }
  if (lastExplosionFrameId) cancelAnimationFrame(lastExplosionFrameId);
  lastExplosionFrameId = requestAnimationFrame(render);
}

function startPangramCelebration() {
  const token = ++pangramCelebrationToken;
  if (gameFinished || gameArea.querySelector('.modal-gameover')) return;
  fireworksAtSkubert(token); // Snapshot the OLD grown size before shrinking.
  pangramCelebrating = true;
  mount.style.transition = 'none';
  mount.style.opacity = '0';
  lastOpacity = '0';
  updateSkubertGrowth(); // app.js already set skubertGrowthLetters back to zero.

  const delay = reducedFireworksMotion ? 320 : PANGRAM_RESPAWN_DELAY_MS;
  window.setTimeout(() => {
    if (token !== pangramCelebrationToken) return;
    pangramCelebrating = false;
    if (gameFinished || gameArea.querySelector('.modal-gameover')) return;
    // Preserve any ordinary-word growth earned during the fireworks.
    updateSkubertGrowth();
    mount.style.transition = 'opacity 240ms ease-out, transform 180ms ease-out';
    mount.style.opacity = '1';
    lastOpacity = '1';
    if (isLoaded && renderer.domElement.animate && !reducedFireworksMotion) {
      renderer.domElement.animate([
        { transform: 'scale(.77)', opacity: 0 },
        { transform: 'scale(1.07)', opacity: 1, offset: .68 },
        { transform: 'scale(1)', opacity: 1 }
      ], { duration: 370, easing: 'ease-out' });
    }
  }, delay);
}
window.addEventListener('skubert:pangram-fireworks', startPangramCelebration);

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
    if (!pangramCelebrating && !gameFinished) {
      mount.style.opacity = '1';
      lastOpacity = '1';
    }
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
  const opacity = (gameFinished || pangramCelebrating) ? '0' : '1';
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
