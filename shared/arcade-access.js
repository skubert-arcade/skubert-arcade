/* Skubert Arcade: casual direct-link access check.
 * This does NOT restrict public GitHub Pages files or prevent bypass in DevTools.
 * Load synchronously at the beginning of every protected HTML page <head>.
 */
(() => {
  'use strict';
  const script = document.currentScript;
  if (!script?.src) return;
  const arcadeHome = new URL('../index.html', script.src);
  let unlocked = false;
  try { unlocked = sessionStorage.getItem('skubertArcadeUnlocked') === 'true'; }
  catch (_) { /* Fail closed if browser storage is unavailable. */ }
  if (unlocked) return;
  const login = new URL(arcadeHome.href);
  // The homepage validates this same-origin return path after unlocking.
  login.searchParams.set('next', location.pathname + location.search + location.hash);
  location.replace(login.href);
})();
