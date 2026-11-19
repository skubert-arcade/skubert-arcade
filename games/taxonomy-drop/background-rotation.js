/**
 * Skubert Evolution — sequential, full-scene animated WebP backgrounds.
 * Runs independently of the fixed 1000x1000 physics world.
 * Two <img> layers allow a smooth crossfade; only one next WebP is preloaded.
 */
(() => {
  'use strict';
  const BACKGROUND_FILES = [
    'bear.webp',
    'camera.webp',
    'cheetah.webp',
    'giphy.webp',
    'iguana.webp',
    'koala.webp',
    'littleguy.webp',
    'lizard.webp',
    'monkey.webp',
    'orangutan.webp',
    'shake.webp'
  ];
  // Change this to adjust how long each animation is visible.
  const HOLD_MS = 10000;
  const FADE_MS = 900;
  const frames = [...document.querySelectorAll('.wildlife-frame')];
  if (frames.length !== 2 || !BACKGROUND_FILES.length) return;

  // Preview mode does not change gameplay; it only hides the opaque taxonomy PNG.
  if (new URLSearchParams(location.search).get('bgPreview') === '1') {
    document.documentElement.classList.add('bg-preview');
  }

  // Respect reduced-motion preference: show an unmoving frame and do not cycle.
  const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)');
  if (reduceMotion?.matches) return;

  let front = 0;
  let currentIndex = 0;
  let queuedTimer = 0;
  let fallbackTimer = 0;
  let generation = 0;
  let paused = document.hidden;
  let upcoming = null;
  const files = BACKGROUND_FILES.map(name => `backgrounds/${name}`);

  function readyImage(url) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(url);
      image.onerror = () => reject(new Error(`Failed to load ${url}`));
      image.decoding = 'async';
      image.src = url;
    });
  }

  function preloadUpcoming() {
    if (paused || files.length < 2) return;
    const index = (currentIndex + 1) % files.length;
    if (upcoming?.index === index) return;
    // Keep one (and only one) upcoming animation in the preload queue.
    upcoming = { index, promise: readyImage(files[index]) };
    // Register a rejection handler immediately, including when the page is hidden.
    upcoming.promise.catch(() => {});
  }

  function clearTimers() {
    clearTimeout(queuedTimer);
    clearTimeout(fallbackTimer);
    queuedTimer = fallbackTimer = 0;
  }

  async function showNext() {
    clearTimers();
    if (paused) return;
    const stamp = ++generation;
    // Skip missing assets; after one unsuccessful full round keep the current image.
    for (let attempt = 0; attempt < files.length; attempt++) {
      const index = (currentIndex + 1 + attempt) % files.length;
      const url = files[index];
      try {
        if (upcoming?.index === index) {
          await upcoming.promise;
          upcoming = null;
        } else {
          await readyImage(url);
        }
        if (paused || stamp !== generation) return;
        const incomingIndex = 1 - front;
        const incoming = frames[incomingIndex];
        const outgoing = frames[front];
        incoming.src = url;
        incoming.classList.remove('is-visible');
        // Apply the initial invisible state before triggering the crossfade.
        requestAnimationFrame(() => {
          if (paused || stamp !== generation) return;
          incoming.classList.add('is-visible');
          outgoing.classList.remove('is-visible');
          front = incomingIndex;
          currentIndex = index;
          preloadUpcoming();
          fallbackTimer = setTimeout(() => {
            // Release the previous animated image to avoid accumulating decoders.
            outgoing.removeAttribute('src');
            fallbackTimer = 0;
          }, FADE_MS + 100);
          queuedTimer = setTimeout(showNext, HOLD_MS);
        });
        return;
      } catch (err) {
        console.warn('Skubert Evolution: skipping wildlife background', url, err);
      }
    }
    queuedTimer = setTimeout(showNext, HOLD_MS);
  }

  async function start() {
    const stamp = ++generation;
    // The HTML starts with a still poster. Only attempt one animated image now.
    try {
      await readyImage(files[0]);
      if (paused || stamp !== generation) return;
      frames[0].src = files[0];
      currentIndex = 0;
    } catch (err) {
      console.warn('Skubert Evolution: first wildlife animation unavailable', err);
    }
    if (!paused && stamp === generation) {
      preloadUpcoming();
      queuedTimer = setTimeout(showNext, HOLD_MS);
    }
  }

  document.addEventListener('visibilitychange', () => {
    paused = document.hidden;
    ++generation;
    clearTimers();
    if (!paused) {
      preloadUpcoming();
      queuedTimer = setTimeout(showNext, HOLD_MS);
    }
  });
  start();
})();
