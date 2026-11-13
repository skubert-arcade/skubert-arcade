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

// GET RANDOM WORD FROM DICTIONARY WITHOUT REPEATS
let unusedWords = [];
let lastSpawnedWord = null;

function generateRandomWord(words) {
  // Refill only after every word has been selected.
  if (unusedWords.length === 0) {
    unusedWords = [...new Set(
      words.map(word => word.toLowerCase().trim())
    )];

    // Fisher-Yates shuffle
    for (let i = unusedWords.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [unusedWords[i], unusedWords[j]] =
        [unusedWords[j], unusedWords[i]];
    }
  }

  // Prefer a word not already on screen,
  // and not the word most recently spawned.
  let index = unusedWords.findLastIndex(
    word =>
      !arrWords.includes(word) &&
      word !== lastSpawnedWord
  );

  // Allow the previous word only if necessary.
  if (index === -1) {
    index = unusedWords.findLastIndex(
      word => !arrWords.includes(word)
    );
  }

  // All remaining words are currently on screen.
  if (index === -1) return null;

  const [word] = unusedWords.splice(index, 1);
  lastSpawnedWord = word;
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
  const gameStartTime = performance.now();
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
