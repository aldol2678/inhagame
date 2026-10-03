# INHA WORLD · Social S1-B2 · Local Chat

> **Ported from the private development repository** (`docs/world`, 2026-10-03). Migration versions are mapped to this
> repository's lineage (pre-baseline objects live in `20261001213132_public_baseline.sql`), private pull requests are
> written as `private #N`, and production database state and rollout/rollback procedures are omitted. Status notes
> describe the private development snapshot at the time of writing.

Product: Notion *Social S1 v0.2* §13 (local chat). Network: Notion *Online Architecture* (place-zone
channels, transient actions). Emotes (S1-B1) and sit are separate.

## Contract

| Item | Value | Where |
| --- | --- | --- |
| Wire event | `ActionType.CHAT` = `"chat"`, payload `{ text, x, y, z }` | `src/network/protocol.js` |
| Channel | current place-zone channel `world:campus:<AREA_ID>` (never C04, RC_*, view distance) | existing transport |
| Text | NFC, controls/bidi/zero-width stripped (ZWJ kept), whitespace collapsed, trimmed, non-empty, ≤ 120 code points | `normalizeChatText` |
| Radius | 15 m, inclusive (`<=`), 3D, receiver now vs sender at send time; 1 world unit = 2 m | `local-chat.js` |
| Bubble | 4 s; a newer message replaces the bubble | `CHAT_BUBBLE_MS` |
| Feed | in memory, 30 entries, 5 shown; cleared on zone change, sign-out, session end | `CHAT_FEED_LIMIT` |
| Rate limit | 3 sent / 5 s (client) | `CHAT_RATE_LIMIT_*` |
| Repeats | same normalized text at most 2× per 10 s | `CHAT_REPEAT_*` |

The payload carries no name. Receivers accept only already-normalized text and finite
coordinates; unknown fields are dropped. Action-id dedupe drops duplicate packets.

## Trust boundary (honest)

- **Delivery vs presentation:** everyone in the same Place Zone receives the broadcast. The 15 m
  radius is a client presentation/proximity filter in S1-B2, not network-level geographic privacy.
- **Identity:** the shown name is the Presence display name (INHAGAME `profiles.nickname`) of the
  sending session. Realtime does not authenticate the session id inside a broadcast, so a modified
  client could impersonate another *present* session. Unknown sessions are dropped. This is a
  social client feature, not a secure chat server.
- **Spam controls** (rate limit, repeats, moderation hook) are client-side UX mitigation, not a
  security boundary against custom clients.

## Moderation

No project-owned profanity list, block list or report contract exists in the repository. S1-B2
ships a moderation hook (`check(text)`, `isBlocked(userId)`) that passes everything by default.
**Before broad public rollout:** an approved filter source, block and report are required
(Social S1 §13 safety requirements); these belong with S1-C.

## UI

- 💬 채팅 button bottom centre (between the joystick and the RUN/JUMP/emote column); Enter opens,
  Enter sends (not during IME composition), Esc closes. A sent message closes the input and returns
  keys to the game.
- The input is a real `<input>`: PlayerController, the V camera toggle and emote shortcuts already
  ignore keys typed into it; opening chat releases held movement keys and closes the emote menu.
- Feed above the input (pointer-transparent), hint line between them; lifts above the on-screen
  keyboard (`--keyboard-inset`). Bubbles over remote avatars and over the own nameplate (hidden in
  first person; the feed shows it). All text via `textContent`.
- Guests: button shown disabled with a login hint; no chat identity, no broadcast.

## Failure

Not ONLINE (or the zone not synced yet): sending returns `offline` and the message is dropped —
nothing is queued, nothing is replayed after reconnect. World play is unaffected.

## Not included

No persistence (no table, archive or localStorage), no friends/follow/rooms/pets, no DM, no server
proximity filtering or AOI. `chat_sent` / `emote_used` analytics are deferred: the hub event API and
a database constraint allowlist event types, so both need one API + migration patch (never with
message text, nickname or email).
