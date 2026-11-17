/* Skubert Arcade shared end-of-game score UI v1.
 * Dependency: shared/leaderboard.js (Cloudflare edition).
 * Usage: const ui=SkubertScoreUI.create(mount,{ game:'rollup' });
 *        ui.show({ score:1234, eligible:true });
 *        ui.reset() when starting/resetting another run.
 * This component never computes the score or decides whether a run is valid.
 */
(function () {
  'use strict';
  const GAME_IDS = new Set(['rollup', 'typing', 'find-skubert']);
  const DEFAULT_LABELS = { rollup:'Roll Up', typing:'Typing Frenzy', 'find-skubert':'Find Skubert' };

  function create(mount, options = {}) {
    if (!(mount instanceof Element)) throw new TypeError('Score UI needs a mount element.');
    const game = options.game;
    if (!GAME_IDS.has(game)) throw new Error('Unknown game identifier for Score UI.');
    const gameLabel = options.gameLabel || DEFAULT_LABELS[game];
    const limit = Math.max(1, Math.min(10, Number(options.previewCount) || 5));
    const scoreVersion = options.scoreVersion || 1;
    const rankingsHref = options.rankingsHref || '../../leaderboards.html';
    const onSaved = typeof options.onSaved === 'function' ? options.onSaved : () => {};
    let version = 0;
    let active = false;
    let eligible = true;
    let saved = false;
    let submitting = false;
    let score = 0;
    let initialsSaved = '';
    let rowsRequest = 0;

    mount.innerHTML = `
      <section class="sk-score" aria-label="Shared arcade score submission">
        <div class="sk-score__eyebrow">SKUBERT ARCADE · ${escapeText(gameLabel)}</div>
        <div class="sk-score__score-caption">YOUR FINAL SCORE</div>
        <div class="sk-score__points" data-role="score">0</div>
        <form class="sk-score__form" data-role="form" novalidate>
          <label class="sk-score__label" data-role="label">Initials <span>(3 letters)</span>
            <input class="sk-score__initials" data-role="initials" name="initials" type="text"
              autocomplete="off" autocapitalize="characters" spellcheck="false"
              minlength="3" maxlength="3" pattern="[A-Za-z]{3}" placeholder="ABC"
              required>
          </label>
          <button class="sk-score__submit" data-role="submit" type="submit">Submit score</button>
        </form>
        <p class="sk-score__status" data-role="status" role="status" aria-live="polite" aria-atomic="true"></p>
        <div class="sk-score__rankings">
          <div class="sk-score__rankings-head"><strong>🏆 Top ${limit} · All players</strong>
            <button type="button" class="sk-score__refresh" data-role="refresh" aria-label="Refresh rankings">↻ Refresh</button>
          </div>
          <div data-role="leaders" class="sk-score__list" aria-live="polite"></div>
          <a data-role="all" class="sk-score__all" href="${escapeAttribute(rankingsHref)}">View all arcade leaderboards →</a>
        </div>
      </section>`;
    const el = role => mount.querySelector(`[data-role="${role}"]`);
    const form = el('form'), input = el('initials'), button = el('submit');
    const status = el('status'), list = el('leaders'), refreshButton = el('refresh');
    const section = mount.querySelector('.sk-score');

    function setStatus(message, tone = '') {
      status.textContent = message;
      status.dataset.tone = tone;
    }
    function refresh() {
      const id = ++rowsRequest;
      list.textContent = 'Loading rankings…';
      refreshButton.disabled = true;
      const api = window.SkubertLeaderboard;
      return Promise.resolve().then(() => {
        if (!api?.getLeaderboard) throw new Error('Leaderboard service unavailable.');
        return api.getLeaderboard(game, limit);
      }).then(scores => {
        if (id !== rowsRequest) return;
        if (!Array.isArray(scores)) throw new Error('Unexpected leaderboard response.');
        const fragment = document.createDocumentFragment();
        let displayed = 0;
        for (const entry of scores) {
          const letters = String(entry?.initials || '').toUpperCase();
          const value = Number(entry?.score);
          if (!/^[A-Z]{3}$/.test(letters) || !Number.isSafeInteger(value) || value < 0) continue;
          displayed += 1;
          const row = document.createElement('div');
          row.className = 'sk-score__row';
          if (saved && initialsSaved === letters && score === value) row.classList.add('sk-score__row--mine');
          const rank = document.createElement('span'); rank.textContent = `#${displayed}`;
          const name = document.createElement('strong'); name.textContent = letters;
          const points = document.createElement('span'); points.textContent = value.toLocaleString();
          row.append(rank, name, points);
          fragment.appendChild(row);
          if (displayed >= limit) break;
        }
        if (!displayed) list.textContent = 'No scores yet. Be the first!';
        else list.replaceChildren(fragment);
      }).catch(error => {
        if (id !== rowsRequest) return;
        console.warn('Skubert score UI: rankings unavailable', error);
        list.textContent = 'Rankings unavailable. You can still submit a score.';
      }).finally(() => { if (id === rowsRequest) refreshButton.disabled = false; });
    }
    function show({ score: newScore, eligible: canSubmit = true, ineligibleMessage } = {}) {
      version++;
      active = true;
      saved = false;
      submitting = false;
      initialsSaved = '';
      score = newScore;
      eligible = !!canSubmit;
      section.hidden = false;
      el('score').textContent = Number.isSafeInteger(score) && score >= 0 ? score.toLocaleString() : '—';
      input.value = '';
      input.disabled = !eligible;
      button.disabled = !eligible;
      button.textContent = 'Submit score';
      form.hidden = !eligible;
      section.dataset.state = eligible ? 'ready' : 'ineligible';
      setStatus(eligible
        ? 'Only initials and your score are shared with the arcade.'
        : (ineligibleMessage || 'This game mode is not eligible for the leaderboard.'), 'neutral');
      void refresh();
      if (eligible) requestAnimationFrame(() => {
        if (active && section.dataset.state === 'ready') input.focus({ preventScroll:true });
      });
    }
    async function submit(event) {
      event.preventDefault();
      if (!active || !eligible || saved || submitting) return;
      const initials = input.value.trim().toUpperCase();
      if (!/^[A-Z]{3}$/.test(initials)) {
        setStatus('Enter exactly three letters (A–Z).', 'error');
        input.focus();
        return;
      }
      if (!Number.isSafeInteger(score) || score < 0) {
        setStatus('This score cannot be submitted.', 'error'); return;
      }
      submitting = true;
      const callVersion = version;
      section.dataset.state = 'saving';
      input.disabled = true;
      button.disabled = true;
      button.textContent = 'Saving…';
      setStatus('Saving and confirming your score…', 'neutral');
      try {
        if (!window.SkubertLeaderboard?.submitScore) throw new Error('Leaderboard service unavailable.');
        const result = await window.SkubertLeaderboard.submitScore(game, initials, score, scoreVersion);
        if (callVersion !== version || !active) return;
        if (!result?.saved) throw new Error('Submission was not confirmed.');
        saved = true;
        initialsSaved = initials;
        section.dataset.state = 'saved';
        form.hidden = true;
        setStatus('✓ Score saved to the shared leaderboard!', 'success');
        try { onSaved({ game, score, initials, result }); }
        catch (error) { console.warn('Skubert score UI: onSaved callback failed', error); }
        void refresh();
      } catch (error) {
        if (callVersion !== version || !active) return;
        console.warn('Skubert score UI: score submission not confirmed', error);
        section.dataset.state = 'error';
        button.textContent = 'Try saving again';
        setStatus('We could not confirm the save. You can retry safely with the same initials and score.', 'error');
      } finally {
        if (callVersion === version) {
          submitting = false;
          if (!saved) { input.disabled = false; button.disabled = false; }
        }
      }
    }
    function reset() {
      version++;
      rowsRequest++;
      active = false;
      eligible = false;
      saved = false;
      submitting = false;
      section.dataset.state = 'idle';
      section.hidden = true;
      form.hidden = false;
      input.disabled = false;
      button.disabled = false;
    }
    function destroy() { reset(); form.removeEventListener('submit', submit); input.removeEventListener('input', onInput); refreshButton.removeEventListener('click', refresh); mount.replaceChildren(); }
    function onInput() {
      const cleaned = input.value.replace(/[^a-z]/gi, '').toUpperCase().slice(0,3);
      if (input.value !== cleaned) input.value = cleaned;
      if (section.dataset.state === 'error') {
        section.dataset.state = 'ready';
        button.textContent = 'Submit score';
        setStatus('Ready to submit.', 'neutral');
      }
    }
    form.addEventListener('submit', submit);
    input.addEventListener('input', onInput);
    refreshButton.addEventListener('click', refresh);
    reset();
    return Object.freeze({ show, reset, refresh, destroy });
  }
  function escapeText(value) { return String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
  function escapeAttribute(value) { return escapeText(value); }
  window.SkubertScoreUI = Object.freeze({create});
})();
