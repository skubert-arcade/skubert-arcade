# Phase 1 validation and deployment status

This release modifies the previous single-player Option A archive only. The goal of Phase 1 is
non-throwing disabled-network hooks and exception-safe worker audio batching. **MPQ imports,
MPQ compression, save files, and bundled Diablo WASM are unchanged**; MPQ removal is Phase 2.

## Changes

- Connection requests made through `DApi.use_websocket(true)` never open a browser network transport.
  Instead, a single asynchronous `_SNet_WebsocketStatus(1)` result is sent to WASM, matching the
  former WebSocket adapter's connection-failure status. Repeated calls during one attempt are
  coalesced, and close/quiesce can cancel a queued status notification.
- `DApi.websocket_closed()` returns the original no-connection value of `false` before an attempt
  and `true` during an attempted (but never connected) session.
- Expected multiplayer failure handling is isolated from React's fatal error UI. Unexpected
  failures during the WASM status notification are logged rather than posted as fatal errors.
- The outermost `invoke_api()` call clears its audio batch in `finally`, even on WASM exceptions.
  Partial audio batches from failed calls are dropped; subsequent calls can start a new batch.

## Validation performed while packaging

- TypeScript syntax parsing: **passed** for 98 TS/TSX files (no syntax diagnostics).
- Isolated worker execution using a TypeScript-transpiled worker and mocked WASM: **passed**.
  Scenarios: worker initialization, disabled network status notification, duplicate requests,
  request cancellation, close/quiesce behavior, unexpected status-handler exception isolation,
  failed render audio cleanup, subsequent successful audio batch.
- Original ZIP comparison: only `src/modules/engine/adapters/game.worker.ts`, the matching
  `game.worker.test.ts`, this verification document, and `SINGLE_PLAYER_CHANGES.md` changed.
  All source-controlled WASM, JSCC, and MPQ files remain byte-identical.

## Verification not completed

A complete `npm ci`, `npm run lint`, `npm run test`, `npm run build`, and browser gameplay test
could **not** be completed in this environment: the offline npm cache did not contain
`yallist@3.1.1`, an online install attempt failed in npm, and the global TypeScript version
could not type-check this project's TypeScript 7 / ES2025 configuration. The isolated worker
check is **not** a substitute for running the real compiled Diablo WASM and game menus.

## Before deployment

From a clean extraction of this ZIP, run:

```sh
npm ci
npm run lint
npm run test
npm run build
npm run preview
```

In a real browser, verify single-player launch, input, audio, save/load and exit, then select
*Multi Player* once on each available engine variant and ensure the UI remains responsive and
returns to a usable menu. Confirm DevTools Network shows no PeerJS or WebSocket game
connections. Check PWA cache updates and preserve existing IndexedDB saves.

**Do not deploy as production-tested until those integration checks pass.**
