/* Skubert Arcade — browser helper for Google Apps Script leaderboard.
 * Load as <script src="../../shared/leaderboard.js"></script> from a game folder.
 */
(function () {
  'use strict';

  // REPLACE with the deployed Apps Script WEB APP /exec URL (not /dev).
  const API_URL = 'const API_URL = "https://skubert-arcade-api.ajones14test.workers.dev";';
  const TIMEOUT_MS = 10000;

  function endpoint() {
    if (!/^https:\/\/script\.google\.com\/macros\/s\/[^/]+\/exec$/.test(API_URL)) {
      throw new Error('Configure API_URL in shared/leaderboard.js first.');
    }
    return API_URL;
  }

  function jsonp(parameters) {
    return new Promise((resolve, reject) => {
      const name = '__skubertCb_' + crypto.randomUUID().replace(/-/g, '');
      const url = new URL(endpoint());
      Object.entries(parameters).forEach(([key, val]) => url.searchParams.set(key, String(val)));
      url.searchParams.set('prefix', name);
      // Discourage stale cached responses when confirming a new submission.
      url.searchParams.set('_', String(Date.now()));
      const script = document.createElement('script');
      let settled = false;
      let timer;
      function done(err, data) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        script.remove();
        delete window[name];
        if (err) reject(err); else resolve(data);
      }
      window[name] = data => done(null, data);
      script.onerror = () => done(new Error('Could not read leaderboard.'));
      timer = setTimeout(() => done(new Error('Leaderboard request timed out.')), TIMEOUT_MS);
      script.async = true;
      script.src = url.toString();
      document.head.appendChild(script);
    });
  }

  async function getLeaderboard(game, limit = 10) {
    const response = await jsonp({ action: 'leaderboard', game, limit });
    if (!response || !response.ok) throw new Error(response?.error || 'Could not load leaderboard.');
    return response.scores;
  }

  async function submitScore(game, initials, score, scoreVersion = 1) {
    initials = String(initials).toUpperCase().trim();
    if (!/^[A-Z]{3}$/.test(initials)) throw new Error('Enter exactly three letters.');
    if (!Number.isSafeInteger(score) || score < 0) throw new Error('Invalid score.');
    const submissionId = crypto.randomUUID();
    // Apps Script ContentService is not a conventional cross-origin JSON API.
    // 'no-cors' lets a simple POST reach doPost, but the response is OPAQUE:
    // NEVER interpret fetch resolving as proof that the score was stored.
    await fetch(endpoint(), {
      method: 'POST',
      credentials: "omit", // Prevents Chrome from sending the user's Google profile cookies
      redirect: "follow",   // Follows Google's 302 redirect to ://googleusercontent.com cleanly
      mode: 'no-cors',
      headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
      body: JSON.stringify({ game, initials, score, scoreVersion, submissionId })
    });
    // Confirm separately using the read-only JSONP receipt endpoint.
    for (const delay of [600, 1200, 2000, 3500]) {
      await new Promise(resolve => setTimeout(resolve, delay));
      try {
        const receipt = await jsonp({ action: 'receipt', game, submissionId });
        if (receipt?.ok && receipt.saved) return { saved: true, submissionId };
        if (receipt && !receipt.ok) throw new Error(receipt.error || 'Receipt rejected.');
      } catch (error) {
        // A transient failed read is not proof that the submission failed.
        console.warn('Score confirmation pending:', error);
      }
    }
    throw new Error('Could not confirm the score. It may have been saved. Check the Sheet before retrying.');
  }

  window.SkubertLeaderboard = Object.freeze({ getLeaderboard, submitScore });
})();
