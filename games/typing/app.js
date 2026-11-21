// HTTP GET LEVEL FROM index.html
const params = new URLSearchParams(window.location.search);
const LEVEL = 2000;

// FALL SPEED
// Start at half the previous speed: 25 px/sec instead of 50 px/sec.
// After 30 seconds of play, global speed increases 1% every second (compounded).
const BASE_FALL_SPEED_PX_PER_SECOND = 25;
const VIRTUAL_GAME_WIDTH = 600;
const VIRTUAL_GAME_HEIGHT = 600;
const REFERENCE_GAME_HEIGHT_PX = VIRTUAL_GAME_HEIGHT; // fixed game units
const SPEEDUP_DELAY_SECONDS = 30;
const SPEEDUP_MULTIPLIER_PER_SECOND = 1.01;

// LENGTH-BASED SPEED: 5 characters or less fall at full global speed;
// 22 characters or more fall at half speed. Length includes spaces because
// players must type them. "master data management" is 22 characters.
const FULL_SPEED_WORD_LENGTH = 5;
const HALF_SPEED_WORD_LENGTH = 22;
const MIN_WORD_SPEED_MULTIPLIER = 0.5;

// PANGRAM CHALLENGE (edit these constants to tune the feature).
// A new upward-moving pangram appears at 0:30, 1:00, 1:30, ...
// It takes approximately 12 seconds to travel across the game field.
const PANGRAM_INTERVAL_SECONDS = 30;
const PANGRAM_TRAVEL_SECONDS = 12;

// SECRET POWER-UP: type "skubert" once per 60 real-world seconds.
// All existing words (including a pangram) and new spawns pause for 8 seconds.
const FREEZE_COMMAND = 'skubert';
const FREEZE_DURATION_MS = 8000;
const FREEZE_COOLDOWN_MS = 60000;
const PANGRAMS = [
  'the quick brown fox jumps over the lazy dog',
  'sphinx of black quartz judge my vow',
  'pack my box with five dozen liquor jugs',
  'how vexingly quick daft zebras jump',
  'the five boxing wizards jump quickly',
  'jackdaws love my big sphinx of quartz',
];

function getWordSpeedMultiplier(word) {
  const lengthRatio = (word.length - FULL_SPEED_WORD_LENGTH) /
    (HALF_SPEED_WORD_LENGTH - FULL_SPEED_WORD_LENGTH);
  const clampedRatio = Math.max(0, Math.min(1, lengthRatio));
  return 1 - (1 - MIN_WORD_SPEED_MULTIPLIER) * clampedRatio;
}

// DOM ELEMENTS
const buttonElementID = document.getElementById('StartButton');
const gameContentID = document.getElementById('GameContent');
const gameContentClass = document.getElementsByClassName('game-content');
const inputElementID = document.getElementById('InputWord');
const scoreElementID = document.getElementById('Score');
const scoreElementClass = document.getElementsByClassName('score');
const levelElementID = document.getElementById('Level');

// VARIABLES
const currentLevel = LEVEL;
// Logical coordinates never change, even if the window is resized mid-game.
// Only the visual stage is scaled; words retain their exact virtual positions.
const gameWidth = VIRTUAL_GAME_WIDTH;
const gameHeight = VIRTUAL_GAME_HEIGHT;
let virtualStageScale = 1;

function installFixedVirtualPlayfield() {
  const wrapper = document.getElementById('Wrapper');
  const viewer = document.getElementById('skubert-viewer');
  if (!wrapper || !viewer) {
    throw new Error('Typing Frenzy requires #Wrapper and #skubert-viewer.');
  }

  // Upgrade the existing game.html at runtime: no HTML edits required.
  // Keep Skubert a sibling of GameContent, since GameContent is replaced
  // with the Game Over dialog when a falling word reaches the bottom.
  const slot = document.createElement('div');
  slot.id = 'GameSlot';
  const viewport = document.createElement('div');
  viewport.id = 'GameViewport';
  const stage = document.createElement('div');
  stage.id = 'GameStage';
  gameContentID.before(slot);
  slot.appendChild(viewport);
  viewport.appendChild(stage);
  // Dedicated pangram layer for a stationary 2D canvas, rendered BEHIND
  // Skubert. No moving HTML/gradient elements share the WebGL compositor.
  // The existing word layer stays in its original foreground position.
  const pangramLayer = document.createElement('div');
  pangramLayer.id = 'PangramLayer';
  pangramLayer.setAttribute('aria-label', 'Special pangram challenge');
  stage.append(pangramLayer, viewer, gameContentID);

  function fitStage() {
    // Fit both dimensions while preserving the immutable 1:1 game geometry.
    // A resize changes CSS pixels per virtual unit, not time to the bottom.
    const width = Math.max(1, slot.clientWidth);
    const top = slot.getBoundingClientRect().top;
    // Use the layout viewport height. The mobile on-screen keyboard can
    // shrink visualViewport.height while typing; that must not collapse
    // the playfield into unreadably small text mid-round.
    const screenHeight = window.innerHeight;
    const roomBelow = 104; // input field and a little breathing room
    const availableHeight = Math.max(250, screenHeight - top - roomBelow);
    const nextScale = Math.max(0.1, Math.min(
      1.5, width / VIRTUAL_GAME_WIDTH, availableHeight / VIRTUAL_GAME_HEIGHT
    ));
    if (Math.abs(nextScale - virtualStageScale) < 0.0001 && viewport.style.width) return;
    virtualStageScale = nextScale;
    const edge = VIRTUAL_GAME_WIDTH * nextScale;
    viewport.style.width = `${edge}px`;
    viewport.style.height = `${edge}px`;
    stage.style.transform = `scale(${nextScale})`;
  }

  let resizeQueued = false;
  function scheduleFit() {
    if (resizeQueued) return;
    resizeQueued = true;
    requestAnimationFrame(() => { resizeQueued = false; fitStage(); });
  }
  fitStage();
  window.addEventListener('resize', scheduleFit, { passive: true });
  window.visualViewport?.addEventListener('resize', scheduleFit, { passive: true });
  if (window.ResizeObserver) new ResizeObserver(scheduleFit).observe(slot);

  // Observable diagnostic values to verify fair resize behavior in DevTools.
  window.typingVirtualPlayfield = Object.freeze({
    width: VIRTUAL_GAME_WIDTH,
    height: VIRTUAL_GAME_HEIGHT,
    get scale() { return virtualStageScale; }
  });
}
let score = 0;
let gameOver = false;
let arrWords = [];
let arrWordsDiv = [];
let gameStartTime = 0;
let activePangram = null;
let lastPangramInterval = 0;
let lastWordSpawnInterval = 0;
let remainingPangrams = [];
let previousPangram = null;

// Only ACTIVE play time advances falling speed / word phase / pangram schedule.
// Real time still controls the 8-second freeze and 60-second recharge.
let activeElapsedMs = 0;
let lastClockTick = 0;
let freezeUntil = 0;
let lastFreezeActivatedAt = -Infinity;
let freezeStatusEl = null;

function isFreezeActive(now = performance.now()) {
  return !gameOver && now < freezeUntil;
}

function activePlaySeconds() {
  return activeElapsedMs / 1000;
}

function advanceGameClock(now) {
  if (!lastClockTick) { lastClockTick = now; return 0; }
  const previous = lastClockTick;
  lastClockTick = now;
  // If the freeze expires between updates, count only time AFTER expiration.
  const playMs = previous < freezeUntil
    ? Math.max(0, now - Math.max(previous, freezeUntil))
    : Math.max(0, now - previous);
  activeElapsedMs += playMs;
  return playMs / 1000;
}

function installFreezeStatus() {
  if (freezeStatusEl) return;
  const bar = document.querySelector('#Wrapper .container-data');
  if (!bar) return;
  freezeStatusEl = document.createElement('span');
  freezeStatusEl.id = 'SkubertFreezeStatus';
  freezeStatusEl.title = 'Type skubert and press Enter to freeze falling and spawning for 8 seconds. Recharge: 60 seconds.';
  freezeStatusEl.setAttribute('aria-live', 'off');
  bar.appendChild(freezeStatusEl);
  updateFreezeStatus();
}

function updateFreezeStatus(now = performance.now()) {
  if (!freezeStatusEl) return;
  const freezeLeft = Math.max(0, freezeUntil - now);
  const cooldownLeft = Math.max(0, FREEZE_COOLDOWN_MS - (now - lastFreezeActivatedAt));
  const message = gameOver ? '' : freezeLeft > 0
    ? `❄ FROZEN · ${Math.ceil(freezeLeft / 1000)}s`
    : cooldownLeft > 0
      ? `❄ SKUBERT · ${Math.ceil(cooldownLeft / 1000)}s`
      : '❄ TYPE SKUBERT TO FREEZE';
  if (freezeStatusEl.textContent !== message) freezeStatusEl.textContent = message;
  freezeStatusEl.classList.toggle('is-frozen', freezeLeft > 0 && !gameOver);
}

function tryActivateSkubertFreeze() {
  if (gameOver) return;
  const now = performance.now();
  // Account for the final fraction of active time BEFORE starting the pause.
  advanceGameClock(now);
  if (now - lastFreezeActivatedAt >= FREEZE_COOLDOWN_MS) {
    lastFreezeActivatedAt = now;
    freezeUntil = now + FREEZE_DURATION_MS;
  }
  // The command is consumed even while recharging; it is never a missed word.
  updateFreezeStatus(now);
}

// SOUNDS
const startGameSound = document.getElementById('StartGameSound');
const gameoverSound = document.getElementById('GameoverSound');
const pointSound = document.getElementById('PointSound');
const notPointSound = document.getElementById('NotPointSound');

// DEFAULT VOLUME (was too high)
startGameSound.style.zIndex = 1;
startGameSound.volume = 0.5;
gameoverSound.volume = 0.5;
pointSound.volume = 0.2;

// DICTIONARY WORDS
const DICTIONARY = [
  'assortment',
  'attribute',
  'casepack',
  'dimensions',
  'enrichment',
  'governance',
  'gtin',
  'hierarchy',
  'lifecycle',
  'manufacturer part number',
  'master data management',
  'metadata',
  'normalization',
  'packsize',
  'palletization',
  'sku',
  'syndication',
  'taxonomy',
  'unit of measure',
  'universal product code',
  'uom',
  'upc',
  'validation',
  'variant',
  'cvl',
  'controlled vocabulary list',
  'fieldset',
  'identifier',
  'barcode',
  'manufacturer',
  'brand',
  'category',
  'specification',
  'technical data sheet',
  'safety data sheet',
  'schema',
  'ontology',
  'enumeration',
  'ingestion',
  'extraction',
  'reconciliation',
  'provenance',
  'canonical',
  'uuid',
  'aggregation',
  'classification',
  'harmonization',
  'disambiguation',
  'discoverability',
  'searchability',
  'faceting',
  'indexing',
  'tokenization',
  'fuzzy',
  'matching',
  'verification',
  'integration',
  'interopability',
  'granularity',
  'master data',
  'product family',
  'product line',
  'parent child',
  'bundle',
  'kit',
  'component',
  'accessory',
  'compatibility',
  'alternates',
  'substitutes',
  'crossreference',
  'segmentation',
  'partition',
  'relationship',
  'linkage',
  'dependency',
  'inheritance',
];

// GAME START
function init() {
  installFixedVirtualPlayfield();
  installPangramStyles();
  installFreezeStatus();
  // Suppress field history, autofill suggestions, and text corrections.
  // The HTML input should also have autocomplete="off" as defense in depth.
  inputElementID.autocomplete = 'off';
  inputElementID.setAttribute('autocorrect', 'off');
  inputElementID.setAttribute('autocapitalize', 'off');
  inputElementID.spellcheck = false;
  if (inputElementID.form) inputElementID.form.autocomplete = 'off';
  gameStartTime = performance.now();
  lastClockTick = gameStartTime;
  showLevel();
  // Word spawning is driven by ACTIVE gameplay time, just like movement and
  // pangrams. Freezing pauses the remaining time until the next spawn.
  updateWordPosition();
}

// CREATE WORD, STORES IT IN AN ARRAY & GET POSITION WHERE IT STARTS TO FALLLS
function drawWord() {
  const word = generateRandomWord(DICTIONARY);

  // If all remaining unused words are on screen, skip this spawn.
  if (word === null) return;

  arrWords.push(word);
  let wordDiv = document.createElement('div');
  const paragraph = document.createElement('p');
  paragraph.textContent = word;
  wordDiv.appendChild(paragraph);
  wordDiv.classList.add('word');
  wordDiv.style.top = '-2px';
  wordDiv._fallY = -2; // visual top, maintained in JS (no per-frame layout read)
  wordDiv.style.zIndex = '1';
  arrWordsDiv.push(wordDiv);
  gameContentClass[0].appendChild(wordDiv);
  // Measure the actual word, not a hard-coded 150px approximation.
  // This keeps long terms and newly spawned words on-screen at narrow widths.
  const maxLeft = Math.max(4, gameWidth - wordDiv.offsetWidth - 4);
  wordDiv.style.left = (4 + Math.random() * Math.max(0, maxLeft - 4)) + 'px';

  // Read the current CSS blue BEFORE replacing the falling block's background.
  // This keeps the lettering in the same blue as the previous block design.
  const previousBackgroundColor = window.getComputedStyle(wordDiv).backgroundColor;
  const wordBlue = (previousBackgroundColor === 'transparent' ||
    previousBackgroundColor === 'rgba(0, 0, 0, 0)')
    ? '#0032b1' // Fallback if the existing stylesheet has no solid blue.
    : previousBackgroundColor;
  wordDiv.style.setProperty('background', '#ffffff', 'important');
  wordDiv.style.setProperty('color', wordBlue, 'important');
  paragraph.style.setProperty('color', wordBlue, 'important');
}

// LENGTH-WEIGHTED WORD SELECTION WITH INDEPENDENT NO-REPEAT POOLS
// Character counts INCLUDE spaces (they must be typed).
// The buckets are DISJOINT. This means exhausting the 3-8 character pool
// refills only that pool; it never waits for the longer-word pools.
const WORD_LENGTH_BUCKET_DEFINITIONS = [
  { label: '3-8', min: 3, max: 8 },
  { label: '9-12', min: 9, max: 12 },
  { label: '13-18', min: 13, max: 18 },
  { label: '19+', min: 19, max: Infinity },
];

// The preference windows can cross fixed bucket boundaries. For example,
// 5-12 draws eligible terms from both the 3-8 and the 9-12 buckets.
const WORD_SELECTION_PHASES = [
  { startSeconds: 0,  min: 0, max: 5 },     // 0-15 seconds
  { startSeconds: 15, min: 3, max: 8 },    // 15-30 seconds
  { startSeconds: 30, min: 8, max: 12 },    // 30-60 seconds
  { startSeconds: 60, min: 0, max: Infinity }, // 60+ seconds: no length preference
];

// Four of every five successful spawns are from the preferred window;
// the fifth is from OUTSIDE that window. The order is shuffled every five.
// This is 80% exactly over complete five-spawn cycles (when words are available).
const PREFERRED_SPAWNS_PER_CYCLE = 4;
const SELECTION_CYCLE_SIZE = 5;

function shuffleInPlace(items) {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}

function createWordLengthBuckets(words) {
  const allUniqueWords = [...new Set(
    words.map(word => word.toLowerCase().trim()).filter(Boolean)
  )];
  return WORD_LENGTH_BUCKET_DEFINITIONS.map(definition => {
    const all = allUniqueWords.filter(word =>
      word.length >= definition.min && word.length <= definition.max
    );
    return { ...definition, all, unused: shuffleInPlace([...all]) };
  });
}

const wordLengthBuckets = createWordLengthBuckets(DICTIONARY);
let lastSpawnedWord = null;
let currentSelectionPhaseIndex = -1;
let selectionCycle = [];

function getSelectionPhaseIndex(elapsedSeconds) {
  for (let i = WORD_SELECTION_PHASES.length - 1; i >= 0; i--) {
    if (elapsedSeconds >= WORD_SELECTION_PHASES[i].startSeconds) return i;
  }
  return 0;
}

// The queue for each fixed length bucket is only replenished when empty.
function refillExhaustedBuckets() {
  for (const bucket of wordLengthBuckets) {
    if (bucket.unused.length === 0) {
      bucket.unused = shuffleInPlace([...bucket.all]);
    }
  }
}

// Choose uniformly from currently unused, eligible terms in the requested
// length window, respecting words already on screen. The most recently
// spawned word is excluded where another eligible term is available.
function drawUnusedWordInWindow(minLength, maxLength, insideWindow) {
  refillExhaustedBuckets();
  const possible = [];
  for (const bucket of wordLengthBuckets) {
    for (const word of bucket.unused) {
      const inside = word.length >= minLength && word.length <= maxLength;
      if (inside === insideWindow && !arrWords.includes(word)) {
        possible.push({ bucket, word });
      }
    }
  }
  if (possible.length === 0) return null;

  const notRecent = possible.filter(candidate => candidate.word !== lastSpawnedWord);
  const available = notRecent.length ? notRecent : possible;
  const selected = available[Math.floor(Math.random() * available.length)];
  selected.bucket.unused.splice(selected.bucket.unused.indexOf(selected.word), 1);
  lastSpawnedWord = selected.word;
  return selected.word;
}

function generateRandomWord() {
  const elapsedSeconds = activePlaySeconds();
  const phaseIndex = getSelectionPhaseIndex(elapsedSeconds);
  const phase = WORD_SELECTION_PHASES[phaseIndex];

  // Reset the 4-in-5 preference schedule when entering a new time window.
  if (phaseIndex !== currentSelectionPhaseIndex) {
    currentSelectionPhaseIndex = phaseIndex;
    selectionCycle = [];
  }

  // After 60 seconds there is no preference: all lengths are eligible,
  // but the four independent no-repeat buckets still cycle separately.
  if (phaseIndex === WORD_SELECTION_PHASES.length - 1) {
    return drawUnusedWordInWindow(phase.min, phase.max, true);
  }

  if (selectionCycle.length === 0) {
    selectionCycle = shuffleInPlace([
      ...Array(PREFERRED_SPAWNS_PER_CYCLE).fill(true),
      ...Array(SELECTION_CYCLE_SIZE - PREFERRED_SPAWNS_PER_CYCLE).fill(false),
    ]);
  }

  const wantPreferred = selectionCycle[selectionCycle.length - 1];
  let word = drawUnusedWordInWindow(phase.min, phase.max, wantPreferred);

  // Exception: if every unused matching word is currently on screen, or
  // the matching subset of a bucket is exhausted, allow the opposite range.
  // This prevents stalls without resetting a partially used length bucket.
  if (word === null) {
    word = drawUnusedWordInWindow(phase.min, phase.max, !wantPreferred);
  }
  if (word !== null) selectionCycle.pop();
  return word;
}
// PANGRAM CHALLENGE — independent of the normal falling-word dictionary.
function installPangramStyles() {
  if (document.getElementById('pangram-challenge-styles')) return;
  const style = document.createElement('style');
  style.id = 'pangram-challenge-styles';
  style.textContent = `
    /* Stationary 2D pangram canvas, clipped to fixed 600x600 virtual bounds. */
    #GameStage #PangramLayer {
      position: absolute;
      inset: 0;
      width: 600px;
      height: 600px;
      overflow: hidden;
      box-sizing: border-box;
      pointer-events: none;
      isolation: isolate;
      contain: layout paint;
      z-index: 0;
    }
    #GameStage #skubert-viewer { z-index: 1 !important; }
    #GameStage #GameContent { z-index: 2 !important; }
    #Wrapper #SkubertFreezeStatus {
      font: 700 11px/1.2 system-ui, sans-serif;
      letter-spacing: .06em;
      color: #b5eaff;
      padding: 6px 10px;
      border-radius: 10px;
      border: 1px solid rgba(150, 215, 255, .22);
      background: rgba(23, 50, 83, .56);
      white-space: nowrap;
    }
    #Wrapper #SkubertFreezeStatus.is-frozen {
      background: rgba(69, 160, 230, .36);
      border-color: rgba(158, 234, 255, .85);
      color: white;
    }
    @media (max-width: 520px) {
      #Wrapper #SkubertFreezeStatus { font-size: 9px; padding: 5px 6px; }
    }
    /* One stationary 600x600 canvas; no animated DOM element or gradient
       compositing next to the transparent 3D viewer. */
    #PangramLayer canvas.pangram-paint-canvas {
      position: absolute;
      inset: 0;
      width: 600px;
      height: 600px;
      display: block;
      pointer-events: none;
    }
    #GameContent .pangram-all-clear {
      position: absolute;
      left: 50%;
      top: 43%;
      transform: translate(-50%, -50%);
      padding: 12px 18px;
      max-width: calc(100% - 16px);
      border-radius: 14px;
      background: rgba(255, 255, 255, .95);
      border: 1px solid rgba(110, 132, 201, .35);
      box-shadow: 0 4px 20px rgba(82, 88, 150, .17);
      color: #5f639f;
      font: 800 23px/1.25 system-ui, sans-serif;
      text-align: center;
      white-space: normal;
      pointer-events: none;
      z-index: 14;
      animation: pangram-clear-pop 1.15s ease-out both;
    }
    @keyframes pangram-clear-pop {
      0% { opacity: 0; transform: translate(-50%, -43%) scale(.92); }
      16% { opacity: 1; transform: translate(-50%, -50%) scale(1.04); }
      72% { opacity: 1; transform: translate(-50%, -50%) scale(1); }
      100% { opacity: 0; transform: translate(-50%, -60%) scale(1); }
    }
    @media (prefers-reduced-motion: reduce) {
      #PangramLayer .pangram-special .pangram-text,
      #GameContent .pangram-all-clear { animation: none; }
    }
  `;
  document.head.appendChild(style);
}

function nextPangram() {
  if (remainingPangrams.length === 0) {
    remainingPangrams = shuffleInPlace([...PANGRAMS]);
    if (remainingPangrams.length > 1 && remainingPangrams[remainingPangrams.length - 1] === previousPangram) {
      [remainingPangrams[0], remainingPangrams[remainingPangrams.length - 1]] =
        [remainingPangrams[remainingPangrams.length - 1], remainingPangrams[0]];
    }
  }
  const phrase = remainingPangrams.pop();
  previousPangram = phrase;
  return phrase;
}

// Draw the pangram into a FIXED 2D canvas, instead of scrolling an HTML
// card through the same compositing tree as Skubert's transparent WebGL canvas.
// This is deliberately a different rendering path for diagnosing the cutout
// artifacts. It does not change the phrase-selection, timings, or scoring.
const PANGRAM_FONT = '800 22px system-ui, sans-serif';
const PANGRAM_LABEL_FONT = '700 10px system-ui, sans-serif';
const PANGRAM_CANVAS_EDGE = VIRTUAL_GAME_WIDTH;
const PANGRAM_CARD_MAX_WIDTH = 570;
const PANGRAM_CARD_HPAD = 14;
const PANGRAM_LINE_HEIGHT = 29;
const PANGRAM_DRAW_ENABLED = new URLSearchParams(window.location.search).get('pangramGraphics') !== 'off';

function wrapPangramLines(ctx, phrase, maxWidth) {
  ctx.font = PANGRAM_FONT;
  const words = phrase.split(/\s+/);
  const lines = [];
  let current = '';
  for (const word of words) {
    const candidate = current ? current + ' ' + word : word;
    if (current && ctx.measureText(candidate).width > maxWidth) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines;
}

function spawnPangram() {
  if (gameOver || activePangram || isFreezeActive()) return;
  const phrase = nextPangram();
  const element = document.createElement('canvas');
  element.className = 'pangram-paint-canvas';
  element.width = PANGRAM_CANVAS_EDGE;
  element.height = VIRTUAL_GAME_HEIGHT;
  element.setAttribute('aria-label', 'Pangram challenge: ' + phrase);
  document.getElementById('PangramLayer').appendChild(element);
  const ctx = element.getContext('2d', { alpha: true });
  if (!ctx) { element.remove(); return; }
  const lines = wrapPangramLines(ctx, phrase, PANGRAM_CARD_MAX_WIDTH - 2 * PANGRAM_CARD_HPAD);
  const cardHeight = 31 + lines.length * PANGRAM_LINE_HEIGHT + 15;
  // Preserve the previous center alignment, white translucent card and subtle
  // multicolored letters, without CSS background-clip or animated elements.
  const top = Math.max(0, gameHeight - cardHeight - 4);
  activePangram = {
    phrase, element, ctx, lines, top, height: cardHeight,
    elapsedTravelSeconds: 0
  };
  positionPangram();
}

function paintRoundedRect(ctx, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + width - r, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + r);
  ctx.lineTo(x + width, y + height - r);
  ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  ctx.lineTo(x + r, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function positionPangram() {
  if (!activePangram) return;
  const p = activePangram;
  const traveled = gameHeight * Math.min(1, p.elapsedTravelSeconds / PANGRAM_TRAVEL_SECONDS);
  p.top = Math.max(0, gameHeight - p.height - 4) - traveled;
  // Nothing in the DOM moves. Only the pixels inside a fixed-size 2D canvas
  // are repainted. The canvas itself is beneath Skubert in stacking order.
  const ctx = p.ctx;
  ctx.clearRect(0, 0, VIRTUAL_GAME_WIDTH, VIRTUAL_GAME_HEIGHT);
  if (!PANGRAM_DRAW_ENABLED) return; // optional diagnostic ?pangramGraphics=off
  const w = PANGRAM_CARD_MAX_WIDTH, x = (VIRTUAL_GAME_WIDTH - w) / 2;
  const y = p.top;
  if (y > VIRTUAL_GAME_HEIGHT || y + p.height < 0) return;
  ctx.save();
  ctx.shadowBlur = 16;
  ctx.shadowColor = 'rgba(68, 80, 144, .12)';
  ctx.shadowOffsetY = 3;
  paintRoundedRect(ctx, x, y, w, p.height, 13);
  ctx.fillStyle = 'rgba(255,255,255,.91)';
  ctx.fill();
  ctx.restore();
  paintRoundedRect(ctx, x, y, w, p.height, 13);
  ctx.lineWidth = 1;
  ctx.strokeStyle = 'rgba(116,130,188,.38)';
  ctx.stroke();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.font = PANGRAM_LABEL_FONT;
  ctx.fillStyle = '#6a738c';
  ctx.fillText('PANGRAM · TYPE TO CLEAR THE BOARD', VIRTUAL_GAME_WIDTH / 2, y + 21);
  ctx.font = PANGRAM_FONT;
  const gradient = ctx.createLinearGradient(x + 28, 0, x + w - 28, 0);
  for (const [position, color] of [
    [0,'#8c64b6'], [.21,'#5f83c0'], [.44,'#4d9ca2'],
    [.66,'#ac9159'], [.85,'#b67c9f'], [1,'#8c64b6']
  ]) gradient.addColorStop(position, color);
  ctx.fillStyle = gradient;
  p.lines.forEach((line, index) => {
    ctx.fillText(line, VIRTUAL_GAME_WIDTH / 2, y + 56 + index * PANGRAM_LINE_HEIGHT);
  });
}

function showPangramClear(wordsCleared, points) {
  const message = document.createElement('div');
  message.className = 'pangram-all-clear';
  message.textContent = `PANGRAM! ALL CLEAR · ${wordsCleared} words · +${points}`;
  message.setAttribute('role', 'status');
  gameContentID.appendChild(message);
  setTimeout(() => message.remove(), 1200);
}

function completePangram() {
  if (!activePangram || gameOver) return;
  const pangram = activePangram;
  activePangram = null;
  pangram.element.remove();

  // Take a snapshot, then remove every active regular word from both arrays
  // and the DOM. This prevents the falling-word loop from seeing stale nodes.
  const clearedWords = arrWords.splice(0);
  const clearedNodes = arrWordsDiv.splice(0);
  for (const node of clearedNodes) node.remove();

  // Score the pangram AND all visible words, with no Skubert growth.
  // The reward is points and an ALL CLEAR, not a size increase. Only normal
  // manually typed words send skubert:word-correct and increment growth.
  const gainedPoints = pangram.phrase.length +
    clearedWords.reduce((sum, word) => sum + word.length, 0);
  score += gainedPoints;
  scoreElementID.innerHTML = `<p>Score ${score}</p>`;
  playSound(pointSound, 0, notPointSound);
  showPangramClear(clearedWords.length, gainedPoints);

  // Pangram reward: a fireworks explosion, followed by Skubert respawning at
  // his ORIGINAL starting size. Keep the score and word-selection state.
  // Any normal words typed *after* the burst can begin growing him again.
  const previousGrowthLetters = Math.max(0, Number(window.skubertGrowthLetters) || 0);
  window.skubertGrowthLetters = 0;
  window.dispatchEvent(new CustomEvent('skubert:pangram-fireworks', {
    detail: { previousGrowthLetters, resetGrowthLetters: 0,
              clearedWords: clearedWords.length, points: gainedPoints }
  }));
}

// GET VALUE FROM INPUT
function getWord() {
  let inputValue = inputElementID.value.toLowerCase();
  inputElementID.value = '';
  if (inputValue.trim() === FREEZE_COMMAND) {
    tryActivateSkubertFreeze();
    return;
  }
  // Matching the special phrase accepts accidental extra spaces, but the
  // ordinary word-matching rules remain unchanged.
  if (activePangram && inputValue.trim().replace(/\s+/g, ' ') === activePangram.phrase) {
    completePangram();
    return;
  }
  if (arrWords.includes(inputValue)) {
    updateScore(inputValue);

    // Grow Skubert by 1% of its original size per successfully typed LETTER.
    // Spaces are not letters. The viewer reads this total even if the GLB
    // has not finished loading when the word is submitted.
    const correctLetters = (inputValue.match(/[a-z]/g) || []).length;
    window.skubertGrowthLetters = (window.skubertGrowthLetters || 0) + correctLetters;
    window.dispatchEvent(new CustomEvent('skubert:word-correct', {
      detail: { word: inputValue, letters: correctLetters,
                totalLetters: window.skubertGrowthLetters }
    }));

    let indexWord = arrWords.indexOf(inputValue);
    let wordDivIndex = arrWordsDiv[indexWord];
    arrWords.splice(indexWord, 1);
    arrWordsDiv.splice(indexWord, 1);
    wordDivIndex.parentNode.removeChild(wordDivIndex);
    playSound(pointSound, 0, notPointSound);
  } else {
    playSound(notPointSound, 0, pointSound);
  }
}

// FALLING WORD LOGIC + GAMEOVER
function updateWordPosition() {
  setInterval(() => {
    if (gameOver) return;

    const now = performance.now();
    const deltaSeconds = advanceGameClock(now);
    updateFreezeStatus(now);
    // No motion, no new pangrams, and no normal word spawns while frozen.
    if (isFreezeActive(now)) return;
    const elapsedSeconds = Math.floor(activePlaySeconds());
    // Exactly one spawn on each new 2-second ACTIVE-time boundary, with no
    // backlog when paused or when a throttled browser timer wakes up late.
    const elapsedSpawnIntervals = Math.floor(activeElapsedMs / currentLevel);
    if (elapsedSpawnIntervals > lastWordSpawnInterval) {
      lastWordSpawnInterval = elapsedSpawnIntervals;
      drawWord();
    }
    // Schedule by actual game elapsed time (0:30, 1:00, 1:30, ...),
    // rather than starting a drifting independent timer.
    const elapsedPangramIntervals = Math.floor(elapsedSeconds / PANGRAM_INTERVAL_SECONDS);
    if (elapsedPangramIntervals > lastPangramInterval) {
      lastPangramInterval = elapsedPangramIntervals;
      spawnPangram();
    }
    const secondsAtHigherSpeed = Math.max(0, elapsedSeconds - SPEEDUP_DELAY_SECONDS);
    const speedMultiplier = Math.pow(SPEEDUP_MULTIPLIER_PER_SECOND, secondsAtHigherSpeed);

    // Use actual elapsed time, so an occasional delayed timer tick
    // doesn't change the intended falling speed.
    // The gameplay clock has already excluded any frozen portion of the tick.
    // Fixed distance per second in virtual pixels, independent of any resize.
    const globalFallDistance = BASE_FALL_SPEED_PX_PER_SECOND *
      speedMultiplier * deltaSeconds;

    for (let i = 0; i < arrWords.length; i++) {
      const wordNode = arrWordsDiv[i];
      const wordFallDistance = globalFallDistance * getWordSpeedMultiplier(arrWords[i]);
      const newTop = wordNode._fallY + wordFallDistance;

      // Same game-over threshold as before, using JS coordinates.
      if (newTop + 15 > gameHeight) {
        gameOver = true;
        updateFreezeStatus(now);
        gameContentID.classList.add('sk-typing-ended');
        if (activePangram) {
          activePangram.element.remove();
          activePangram = null;
        }
        gameContentID.innerHTML = modalGameOver();
        playSound(gameoverSound, 8, startGameSound);
        gameoverSound.style.zIndex = 1;
        inputElementID.setAttribute('disabled', true);
        break;
      }

      wordNode._fallY = newTop;
      // CSS transform moves the word without changing its layout box.
      // Its visual top remains exactly newTop (original CSS top is -2px).
      wordNode.style.transform = `translate3d(0, ${newTop + 2}px, 0)`;
    }

    // A missed pangram simply exits the top; ordinary falling words still
    // determine game over. Its speed is independent of the falling speedup.
    if (!gameOver && activePangram) {
      // Travel time is measured in ACTIVE seconds only. A Skubert freeze
      // suspends the existing pangram in place and never jumps on unfreeze.
      activePangram.elapsedTravelSeconds += deltaSeconds;
      positionPangram();
      if (activePangram.top + activePangram.height < 0) {
        activePangram.element.remove();
        activePangram = null;
      }
    }
  }, 20);
}

// UPDATE SCORE
function updateScore(completedWord) {
  score += completedWord.length;
  scoreElementID.innerHTML = `<p>Score ${score}</p>`;
}

// HELPERS
// PLAY SOUND
function playSound(sound, time, stopSound) {
  let playPromise = sound.play();

  if (playPromise !== undefined) {
    playPromise
      .then(() => {
        stopSound.pause();
        sound.pause();
        stopSound.currentTime = 0;
      })
      .then(() => {
        sound.currentTime = time;
      })
      .then(() => {
        sound.play();
      });
  }
}

// SHOWS CURRENT PLAYING LEVEL
function showLevel() {
  levelElementID.textContent = "Level: STANDARD";
}

// GAMEOVER MODAL
function modalGameOver() {
  return `
    <div class="modal-gameover col-8">
      <h1> Game Over </h2>
      <h2> Score: ${score} </h2>
      <button id="Restart" class="my-2 btn-modal">
        <a href="game.html">
          <h6>Restart</h6>
        </a>
      </button>
      <button id="Menu" class="my-2 btn-modal">
        <a href="index.html">
          <h6>Back to menu</h6>
        </a>
      </button>
    </div>
  `;
}

init();