# Option A: multiplayer transport removal

Implemented for this copy of the Diablo Web source archive. The bundled `.wasm` and `.jscc` binaries are unchanged.

## Removed

- WebRTC PeerJS code, browser signaling, and WebSocket transport adapters under `src/modules/network/`
- `peerjs` dependency (including its lockfile entries)
- Main-thread multiplayer packet bridge, queue, and periodic flush
- Worker-side socket creation and outgoing/incoming packet forwarding
- Worker `packet` and `packetBatch` message types and validators
- `VITE_WS_URL` configuration (including CI build env), URL resolver, and PeerJS-specific Vite chunk
- Multiplayer setup instructions in the in-app guide
- Obsolete multiplayer wire-protocol fixtures and their dependent test

## Compatibility hooks intentionally retained

The precompiled Diablo WebAssembly engine depends on the existing `DApi` networking callbacks.
`DApi.use_websocket(true)` does **not** throw or open a socket. It schedules one asynchronous
`_SNet_WebsocketStatus(1)` rejection per connection attempt, matching the prior WebSocket
adapter's failure status (rather than reporting a fatal React error). A request closed before
its rejection is canceled. `DApi.websocket_closed()` matches the original no-socket state
(`false`) until an attempt is made; `DApi.websocket_send(...)` discards all outgoing packets.
`_SNet_InitWebsocket()` remains called during engine initialization for ABI compatibility.

## Phase 1: crash-resilience corrections

- Replaced the previously throwing `use_websocket(true)` hook with an asynchronous, non-throwing
  failure notification. Unexpected failures while signaling the disabled feature are logged,
  without replacing the game canvas with the global error UI.
- Wrapped WASM audio batching in `try/finally`, discarding partial batches on failure and clearing
  internal state before transferring finished batches. This prevents an exception from leaving
  subsequent audio events trapped in an unfinished batch.
- Added worker regression tests for closed-state semantics, duplicate and canceled connection
  requests, recoverable signaling exceptions, and audio recovery after a WASM exception.
- No MPQ load, compressed archive, IndexedDB, save-file, or bundled WASM changes in Phase 1.


## What this does **not** do

- Alter the in-engine *Multi Player* menu: its rendering lives inside the compiled binaries.
- Disable ordinary web requests for game assets, updates, documentation, or bug-report links.
- Independently verify the content or provenance of the bundled game binaries.
- Address non-multiplayer security findings from the original review (for example, MPQ save limits).

## Verification

On a machine with the dependencies available, run:

```sh
npm ci
npm run lint
npm run test
npm run build
npm run preview
```

Confirm normal single-player startup/save/load in both demo and full-game modes.
Confirm the browser does **not** connect to `0.peerjs.com`, any multiplayer signaling endpoint,
or any game WebSocket URL. Verify PWA update behavior with old caches and multiple tabs.

The existing IndexedDB data epochs are unchanged to avoid deleting saved games. Existing clients should
close their running game and update the installed PWA; old cached builds are not modified in place.

## Phase 1 limitations

These are TypeScript-layer safeguards. The in-engine multiplayer menu still exists, and the
compiled WASM engines have not been rebuilt or gameplay-tested. Confirm that choosing the
multiplayer menu returns safely to the title screen in both engine variants before production.
Do not interpret the worker mock tests as proof of real Diablo WASM behavior.
