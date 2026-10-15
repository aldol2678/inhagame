# INHA WORLD · Social S1-B1 · Expression / Emotes

> **Ported from the private development repository** (`docs/world`, 2026-10-03). Migration versions are mapped to this
> repository's lineage (pre-baseline objects live in `20261001213132_public_baseline.sql`), private pull requests are
> written as `private #N`, and production database state and rollout/rollback procedures are omitted. Status notes
> describe the private development snapshot at the time of writing.

Product: Notion *Social S1 v0.2* §14 (five emotes). Network: Notion *Online Architecture* (action
contract, unchanged tick). Local Chat (S1-B2) is not part of this change.

## Emotes (stable wire IDs)

| ID | Label | Key (menu open) | Duration | Through a jump |
| --- | --- | --- | --- | --- |
| `wave` | 👋 인사 | 1 | 1.6 s | yes |
| `clap` | 👏 박수 | 2 | 1.8 s | yes |
| `laugh` | 😆 웃기 | 3 | 1.7 s | yes |
| `dance` | 💃 춤 | 4 | loops, capped 12 s | no |
| `photo_pose` | 📸 사진 포즈 | 5 | 4 s hold | no |

IDs live in `src/network/protocol.js` (`EMOTE_IDS`); the wire accepts only these five. Never
rename an ID; only append. Timing, cooldown (1 s) and poses live in `src/online/emotes.js`.

## Layers

```
PlayerController (movement authority, unchanged)
   └─ observed by EmoteController (src/online/emotes.js) ── request(id) ──▶ online.reportEmote(id)
          │ { id, elapsedMs }                                              └ NetworkManager.reportEmote
          ▼                                                                   → ActionType.EMOTE { emote }
   character-model.update(…, { emote })  ← composeEmotePose(rest, emoteOffsets(id, t))
RemotePlayerManager (EMOTE action → lastEmote + moved/airborne flags) → sample().emote
   → RemotePlayerView → remote-avatar → same character-model path
```

- The local expression plays immediately; the network is told afterwards and never delays it.
- Emotes are transient actions, not pose state: the 3–4 Hz pose tick is unchanged.
- Poses are a pure function of `(id, elapsed)`, applied on top of a rest pose rebuilt every frame,
  so the character always returns exactly to rest (no transform drift).

## Priority / cancellation

Teleport and lifecycle (zone leave, disconnect) › locomotion (walk, run, jump, mount) › emote.

- Starting requires standing still, grounded and not mounted.
- Movement or mounting cancels any emote; a jump cancels `dance` and `photo_pose`.
- Remote: a pose with walk/run/fly after the emote cancels it; air cancels jump-incompatible
  emotes; teleport clears it; leaving the zone or disconnecting removes the avatar with it.
  Duplicate action packets are dropped by the existing action-id dedupe; reconnect never replays.

## UI

`#emote-toggle` (😀 감정, E) on the right above RUN/JUMP/descend, a five-button row above it,
status line above that. Esc and an outside tap close; digits work only while the menu is open;
typing in fields never triggers emotes. Hidden while mounted. Bottom centre is left free for
S1-B2 chat.

## Nickname authority

The INHAGAME profile (`profiles.nickname`) is the only nickname. The World displays it (local
nameplate and profile panel show the same normalized name other players see) and links to
`/profile/` to change it. The in-World nickname form and its localStorage override
(`inhagame-campus-guest-profile-v1`) were removed; the stored key is no longer read (not deleted).
Guests play offline as `인덕이`, with no network identity and no broadcast.

## Analytics

`emote_used` is deferred: the hub event API (`api/hub-event.js`) and the database constraint both
allowlist event types, so adding it needs an API change and a migration outside this scope.
