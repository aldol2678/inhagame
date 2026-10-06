# Player activity audio P0

This bounded P0-B slice connects local player footsteps and committed room doorway
feedback to the existing `worldAudio.playCue` context and master-volume control.
It does not change movement, room ownership, ambient crossfades, time/weather,
asset binding, inventory, rewards, network state, or the database.

## Runtime contract

- `main.js` snapshots the player immediately before the controller update and
  observes its resolved position immediately afterward, before combat knockback
- Input intent is insufficient: a player pushing against a wall remains silent
- Both sides of a footstep sample must be grounded; mounted, swimming, seated,
  input-disabled, movement-locked, transition and unsupported-space states reset
  the contact cycle. Large/invalid frame gaps and discontinuous motion are dropped
- WALK/RUN follows resolved speed. Contact progress is distance-driven and remains
  continuous across rugs, paving and gait changes; no queued catch-up cues
- Only successful `rooms.onChange` enter/exit events produce doorway cues. An
  accepted request, in-flight fade, duplicate notification or rollback does not
- Locked, muted and hidden audio drops new cues. Visibility and pagehide stop
  current short voices; persisted pageshow resets the contact cycle. Final pagehide
  removes the room subscriber, activity listeners, buffers and voice nodes
- At most three activity buffer sources coexist. A new doorway cue can replace
  the oldest footstep. Sources disconnect on natural completion or explicit stop
- `?audioDebug=1` on preview hosts shows the separate activity source count,
  budget, current surface/gait, and emitted step/door counts

## Surface and cue scope

- Outdoor soft: the existing rendered `SITE_FEATURES` lawn polygons
- Outdoor hard: authored road/path strips and their shoulders override lawns;
  other campus surfaces use the hard fallback
- Indoor soft: fixed rugs in the existing Club Room and Personal Room layouts,
  in player-local coordinates
- Indoor hard: other registered room floors
- Door families: dorm entrance glass, personal/club room wood, event threshold

This is a conservative surface projection, not a new collision/material authority.
Continuous campus-coordinate interiors (for example Student Center floors), movable
rugs, special shoe types, wetness, snow and fine stair materials have no extra
classification in this slice. Biryong-region movement and lobby navigation are
outside the slice. Existing rendered ground and movement remain authoritative.

All cues are short, deterministic procedural prototypes. There are no downloaded
or uploaded audio assets. Stride, gain and timbre values are tuning candidates,
not production listening approval or sampled-asset sign-off.

## Verification

```sh
node --test apps/world/tests/player-activity-audio.test.mjs apps/world/tests/world-audio.test.mjs apps/world/tests/room-transition*.test.mjs
node --test apps/world/tests/*.test.mjs
node apps/world/qa.mjs
# Requires the repository's pinned browser dependencies and a permitted Chromium:
EXPECTED_ACTIVITY_AUDIO_HEAD=$(git rev-parse HEAD) node apps/world/tests/browser/player-activity-audio-smoke.mjs
```

The browser fixture at `/tests/browser/player-activity-audio-harness.html` uses
synthetic movement with the actual PlayerController, AudioRuntime, renderer and
lifecycle hooks, without an account or remote writes. Its scripted checks cover
real Web Audio unlock, wall silence, eight surface/gait combinations, mute,
source limits, natural ending, persisted pagehide/pageshow and disposal at desktop
and mobile viewport sizes. Synthetic lifecycle events do not prove a real browser
back/forward-cache restore, OS interruption, or physical-device audio output.

Before listening sign-off, test the real campus and rooms on phone/laptop speakers
and headphones: material contrast, restrained volume, WALK/RUN cadence, room
crossfades, wall holding, jump/landing, mounts, short rug crossings, photo/dialogue
input locks, tab backgrounding, actual back/forward navigation and repeated doors.
Browser scheduling checks alone cannot establish sound quality or blind recognition.

## Hosted acceptance evidence

The scoped `Player activity audio browser QA` workflow checks out the exact PR head,
uses read-only repository permissions and keeps credentials out of the checkout.
It saves source hashes, desktop/mobile reports and screenshots. It also measures
real master-bus output/mute RMS and, where MediaRecorder supports audio/webm,
records a short generated-output demo through MediaStreamDestination. This uses
no microphone, camera, user audio, account, server write or Production service.

The demo labels each surface/gait interval and verifies emitted contact counts,
nonzero rendered signal and source budget, then plays the three doorway families.
A captured signal is evidence of rendering and timing, not a subjective quality
rating or a physical-speaker balance test. The workflow never claims audible PASS.
