// HTTP GET LEVEL FROM index.html
const params = new URLSearchParams(window.location.search);
const LEVEL = 2000;

// FALL SPEED
// Start at half the previous speed: 25 px/sec instead of 50 px/sec.
// After 30 seconds of play, global speed increases 1% every second (compounded).
const BASE_FALL_SPEED_PX_PER_SECOND = 25;
const SPEEDUP_DELAY_SECONDS = 30;
const SPEEDUP_MULTIPLIER_PER_SECOND = 1.01;

// LENGTH-BASED SPEED: 5 characters or less fall at full global speed;
// 22 characters or more fall at half speed. Length includes spaces because
// players must type them. "master data management" is 22 characters.
const FULL_SPEED_WORD_LENGTH = 5;
const HALF_SPEED_WORD_LENGTH = 22;
const MIN_WORD_SPEED_MULTIPLIER = 0.5;

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
const gameWidth = gameContentID.clientWidth;
const gameHeight = gameContentID.clientHeight;
let score = 0;
let gameOver = false;
let arrWords = [];
let arrWordsDiv = [];
let gameStartTime = 0;

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
  gameStartTime = performance.now();
  showLevel();
  setInterval(() => {
    if (!gameOver) {
      drawWord();
    }
  }, currentLevel);
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
  wordDiv.style.zIndex = '1';
  wordDiv.style.left = (Math.random() * (gameWidth - 150)).toString() + 'px';
  arrWordsDiv.push(wordDiv);
  gameContentClass[0].appendChild(wordDiv);

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
  const elapsedSeconds = Math.max(0, (performance.now() - gameStartTime) / 1000);
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
// GET VALUE FROM INPUT
function getWord() {
  let inputValue = inputElementID.value.toLowerCase();
  inputElementID.value = '';
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
  // Start the timer when gameplay starts, not when the script loads.
  let lastUpdateTime = gameStartTime;

  setInterval(() => {
    if (gameOver) return;

    const now = performance.now();
    const elapsedSeconds = Math.floor((now - gameStartTime) / 1000);
    const secondsAtHigherSpeed = Math.max(0, elapsedSeconds - SPEEDUP_DELAY_SECONDS);
    const speedMultiplier = Math.pow(SPEEDUP_MULTIPLIER_PER_SECOND, secondsAtHigherSpeed);

    // Use actual elapsed time, so an occasional delayed timer tick
    // doesn't change the intended falling speed.
    const deltaSeconds = Math.max(0, (now - lastUpdateTime) / 1000);
    lastUpdateTime = now;
    const globalFallDistance = BASE_FALL_SPEED_PX_PER_SECOND * speedMultiplier * deltaSeconds;

    const wordText = document.getElementsByClassName('word');
    for (let i = 0; i < arrWords.length; i++) {
      // Each word has a fixed length-based proportion of the global speed.
      // Keep decimals: parseInt would discard the gradual speed changes.
      const wordFallDistance = globalFallDistance * getWordSpeedMultiplier(arrWords[i]);
      const currentTop = parseFloat(wordText[i].style.top) || 0;
      const newTop = currentTop + wordFallDistance;

      if (newTop + 15 > gameHeight) {
        gameOver = true;
        gameContentID.innerHTML = modalGameOver();
        playSound(gameoverSound, 8, startGameSound);
        gameoverSound.style.zIndex = 1;
        inputElementID.setAttribute('disabled', true);
        break;
      }

      wordText[i].style.top = newTop + 'px';
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
