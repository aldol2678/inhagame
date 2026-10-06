# Housing S1-D2 · Personal Room Session + Friend Visits (current-main rebuild)

> **Ported from the private development repository** (`docs/world`, 2026-10-03). Migration versions are mapped to this
> repository's lineage (pre-baseline objects live in `20261001213132_public_baseline.sql`), private pull requests are
> written as `private #N`, and production database state and rollout/rollback procedures are omitted. Status notes
> describe the private development snapshot at the time of writing.

Canonical: Notion *Social S1-D 제1생활관 Personal Room v0.1* §7 S1-D2, §9 Privacy, §10 친구 방 방문.
Baseline audit: [HOUSING_H0_BASELINE_AUDIT.md](HOUSING_H0_BASELINE_AUDIT.md). Rebuilt by hand on
`main@56d3a735`; nothing from private #198 / private #201 is merged.

## 1. Authority

| Question | Owner | Where |
|---|---|---|
| Which room is mine? | Room Authority | `get_or_create_my_personal_room_v1()` (D1.3, unchanged) |
| May this account be in room R now? | Room Authority | `private.world_room_access_v1(viewer, room)` → `OWNER / VISITOR / PRIVATE / DENIED` |
| Friend visit resolve | Room + Social | `resolve_friend_personal_room_v1(owner)` |
| Join / 15 s revalidation | Room | `check_world_room_access_v1(room)` (never raises for a denial) |
| Realtime channel `world:room:<uuid>` | Realtime RLS | `can_access_world_room_realtime_v1(topic)` inside the existing two policies |
| Privacy | Owner only | `set_my_personal_room_visibility_v1('private' \| 'friends')` |

A non-owner needs: permanent non-banned account, non-banned owner, accepted friendship, no block in
either direction, and a `friends` room. Unknown rooms and strangers both get `DENIED`, so a UUID is
neither a key nor an existence oracle. `PUBLIC` stays out of scope (table CHECK unchanged).

The Realtime installer keeps the guest campus rule of the baseline guest Realtime policy byte-for-byte and adds only
`or (select public.can_access_world_room_realtime_v1((select realtime.topic())))`.

## 2. Runtime

```
Campus / Dorm Lobby ──[🏠 방 방문] Player Card · Friends panel
   └─ resolve_friend_personal_room_v1 ─→ ROOM_PERSONAL_BASIC (visitor metadata)
Dorm Lobby ──[내 방 들어가기] get_or_create_my_personal_room_v1 ─→ ROOM_PERSONAL_BASIC (owner metadata)

rooms.onChange(metadata) → roomSession.enter()
   check_world_room_access_v1 → SupabaseRealtimeTransport(topicFor: world:room:<uuid>)
   → NetworkManager (pose / interpolation / emote / equipment) → RemotePlayerView under the room scene
every 15 s, on reconnect, on any relationship change: check again → denied ⇒ stop + rooms.exit → Dorm Lobby
leave room → Dorm Lobby return anchor (campus Presence stays paused) → lobby exit → DORM_1_CAMPUS_RETURN
```

- `rooms/room-session.js` — session lifecycle, revalidation, owner-absent state, leak-free stop.
- `rooms/friend-room-visit.js` — resolver client + controller (campus or Dorm Lobby only; not mounted,
  not from another interior, not from the lobby shell, not mid-transition).
- `rooms/room-transition.js` — `enterNestedFromCampus` (parent = Dorm Lobby, so leaving never lands at
  an arbitrary campus point).
- `rooms/room-hud.js` — owner: `🏠 내 방 · N명 · [👥 친구 공개 | 🔒 비공개] · [나가기]`; visitor:
  `🏠 <owner>의 방 · 방문 중 · 편집 불가 · (주인 부재) · [나가기]`.
- Emotes route to the room channel while a session is active; the campus session is paused.
- Logout / account switch: the session stops (IDENTITY) and the player is returned to the lobby.

Out of scope here (seams only): room chat, owner kick, PUBLIC rooms, furniture (H2).

## 3. Verification (this branch)

| Gate | Result |
|---|---|
| World Node tests | 1238 / 1238 (21 new in `room-session.test.mjs`) |
| `apps/world/qa.mjs` | PASS |
| Browser `housing-smoke.mjs` (desktop 1280 + phone 360, 3 cycles each, Room HUD layout) | PASS |
| Disposable Supabase from zero + `82_world_personal_room_session.test.sql` | PASS (D1 + D2 + Realtime RLS stand-in) |
| Full pgTAP suite | Same 7 pre-existing failures as pure `main` (10, 61, 65, 72, 73, 79, grants `touch_world_online_session_v2`); none from D2 |

## 4. Production rollout

`[REDACTED: production rollout and rollback procedure — maintained privately]`

## 5. Live QA checklist (two accounts A = owner, B = friend)

- [ ] A: Campus → 제1생활관 → 로비 → 내 방; HUD `내 방 · 1명 · 👥 친구 공개`.
- [ ] B: Player Card / Friends → 🏠 방 방문 → A's room; both HUDs show 2명; poses interpolate; emotes visible.
- [ ] A leaves → B's HUD shows `주인 부재`; B stays.
- [ ] A → 🔒 비공개: B returns to the Dorm Lobby within 15 s with the PRIVATE message.
- [ ] B visit again → `친구가 방을 비공개로 해 두었어요.`; A → 친구 공개 → visit works.
- [ ] A blocks B / unfriends B → B evicted (immediately on B's side if B made the change).
- [ ] B: logout inside A's room → lobby, no room channel left (`__INHAGAME_P0__.getStatus().personalRoom.sessionStats.liveChannels === 0`).
- [ ] Airplane mode 20 s inside a room → DEGRADED → back ONLINE, access re-checked.
- [ ] Guest: no 🏠 방 방문, lobby `내 방` shows the login hint.
- [ ] Campus Presence: while A/B are in the room, a third account on AREA_DORM_SOUTH sees neither.
- [ ] Repeat 10× enter/leave: `sessionStats.liveChannels` 0 outside, avatars 0.
- [ ] PC + phone 360 px: HUD clear of top bar, Mini-map, action buttons.

