/* Skubert Arcade shared scoreboard — Cloudflare Worker JSON API.
 * Same public interface as the previous Google JSONP helper:
 *   SkubertLeaderboard.getLeaderboard(game, limit)
 *   SkubertLeaderboard.submitScore(game, initials, score, scoreVersion)
 */
(function () {
  'use strict';
  // Replace only this address with your deployed Worker HTTPS URL.
  const API_URL = 'https://skubert-arcade-api.ajones14test.workers.dev';
  const TIMEOUT_MS = 20000;
  const GAMES = new Set(['rollup', 'typing', 'find-skubert', 'taxonomy-drop']);
  const pending = new Map(); // Reuse UUID for retry after an uncertain POST.

  function endpoint(path) {
    if (!/^https:\/\/[^/]+\.workers\.dev$/.test(API_URL)) {
      throw new Error('Configure API_URL with your Cloudflare Worker URL.');
    }
    return API_URL + path;
  }
  async function getJSON(path, options = {}) {
    const response = await fetch(endpoint(path), {
      ...options,
      headers: { ...(options.headers || {}), 'Accept': 'application/json' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: options.cache || 'no-store',
    });
    let data;
    try { data = await response.json(); }
    catch { throw new Error(`Leaderboard API returned HTTP ${response.status} without JSON.`); }
    if (!response.ok || !data || !data.ok) {
      throw new Error(data?.error || `Leaderboard API returned HTTP ${response.status}.`);
    }
    return data;
  }
  function validateGame(game) {
    if (!GAMES.has(game)) throw new Error('Unknown game.');
  }
  async function getLeaderboard(game, limit = 10) {
    validateGame(game);
    if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw new Error('Limit must be from 1 to 50.');
    const result = await getJSON(`/api/leaderboard?game=${encodeURIComponent(game)}&limit=${limit}`);
    if (!Array.isArray(result.scores)) throw new Error('Unexpected leaderboard response.');
    return result.scores;
  }
  async function submitScore(game, initials, score, scoreVersion = 1) {
    validateGame(game);
    initials = String(initials).trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(initials)) throw new Error('Enter exactly three initials (A–Z).');
    if (!Number.isSafeInteger(score) || score < 0) throw new Error('Invalid score.');
    if (scoreVersion !== 1) throw new Error('Unsupported scoring version.');
    const key = JSON.stringify([game, initials, score, scoreVersion]);
    const submissionId = pending.get(key) || crypto.randomUUID();
    pending.set(key, submissionId);
    try {
      const result = await getJSON('/api/score', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ game, initials, score, scoreVersion, submissionId }),
      });
      if (!result.saved) throw new Error('Submission not confirmed.');
      pending.delete(key);
      return { saved: true, submissionId, duplicate: !!result.duplicate };
    } catch (error) {
      // If the POST response failed after Google saved, check the receipt first.
      try {
        const receipt = await getJSON(`/api/receipt?game=${encodeURIComponent(game)}&submissionId=${encodeURIComponent(submissionId)}`);
        if (receipt.saved) {
          pending.delete(key);
          return { saved: true, submissionId, recovered: true };
        }
      } catch (_) {
        // Unknown result: leave the UUID in memory so retry is idempotent.
      }
      throw error;
    }
  }
  window.SkubertLeaderboard = Object.freeze({ getLeaderboard, submitScore });
})();
