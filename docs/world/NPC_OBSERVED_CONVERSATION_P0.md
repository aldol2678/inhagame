# NPC 관찰형 자동 대화 P0 — Preview implementation

> **Ported from the private development repository** (`docs/world`, 2026-10-03). Migration versions are mapped to this
> repository's lineage (pre-baseline objects live in `20261001213132_public_baseline.sql`), private pull requests are
> written as `private #N`, and production database state and rollout/rollback procedures are omitted. Status notes
> describe the private development snapshot at the time of writing.

## Scope and activation

Existing P2-B relationship graph, NG1 groups, NG1.5 meeting status and actual purposeful controller positions are read-only inputs. No new society, route, schedule system, NPC pause, network request, DB write, quest, reward or LLM is added. Following the user's timing adjustment, the existing NG1.5 meeting dwell default is 30 seconds (previously 6); travel/assembly budgets and schedule return logic are unchanged.

On localhost / permitted Preview hosts: `/campus/?npcConversation=p0`.
To observe existing NG1.5 meetings too: `/campus/?npcSocial=ng15&npcConversation=p0`.
Ordinary URLs and production remain off. NG1.5 production activation is unchanged.

The present runtime has local NPC interaction ownership, but no authoritative cross-player NPC conversation occupancy input was found. Cross-player exclusion is therefore **unverified**, not implemented by inventing shared social state. This blocks production activation. NG2 remains the owner of shared events; do not label this local renderer a shared conversation.

## Initial policy

- Enter 8m; leave at 12m. Use existing `metersToWorld` (2m/world unit).
- 2–3 visible, stationary ACTING NPCs; pair <=4m or each triple member <=5m from their centroid.
- Same live NG1 group or each pair has dynamic affinity/persistent bond >=12. Structural department/residence affinity alone never establishes eligibility.
- Meeting > strong relationship >=24 > shared department/residence > other already-related co-located group. Similar-distance 2m bands prefer camera direction.
- 40 authored Korean sets: 10 academic, 8 food, 6 plans, 6 department, 6 rest, 4 place. Formal/casual/familiar variants use actual context slots.
- Three lines, 3.2 seconds each = 9.6 seconds. Triple gives each participant a line.
- Existing NG1.5 meeting dwell: **30 seconds**, providing approach and observation time. The timer begins on actual arrival (`MEETING`), not while assembling. Explicit test/caller dwell overrides remain valid. A late arrival by the player can still see the scene end when the original meeting ends; conversations do not extend that timer.
- 60-second player cooldown and 240-second group/combination cooldown after nominal ending. Aborted scenes retain cooldown. Pair keys also cover triples, and last 3 templates per combination plus last global template suppress repetition.
- Session memory only, bounded history. Existing persistent social graph is never written by this feature.
- NPC motion always wins. Leaving ACTING, movement, direct interaction, hidden state, schedule period change, teleport or blocking UI terminates presentation. No resume of a partly seen conversation.
- NPC heading changes only visually, up to 35 degrees per frame toward a participant. Seated heading is preserved; existing idle gestures are reused. Player camera/input never changes.
- One pointer-transparent bubble. Behind-camera/offscreen bubbles and bubbles intersecting selected HUD/nameplate bounds are hidden. Speaker nameplate is suppressed while speaking.

## Authority and blocking integration

`dev-runtime.mjs`: P2-B `describePair`, NG1 `snapshot`, purposeful `status(false)`, current visual position, NG1.5 `MEETING` only. Moving/assembling NPCs cannot qualify on their scheduled destination alone.

`main.js`: InputFocus WORLD_ACTION, HUD COMBAT, lobby/transition, indoor room, MCM UI/dialogue, Full Map. NPC/Main2 dialogue lifecycle cancels P0 before opening direct dialogue. System locks cover registered scripted/cutscene owners. Future unregistered combat/cutscene owners must feed this existing callback.

`class_time` maps to afternoon dialogue vocabulary; no new clock is created. Geography uses the controller's arrived destination (or active physical meeting location), not a synthetic place lookup.

## Verification and remaining acceptance

Run `node --test apps/world/tests/npc-observed-conversation.test.mjs` (automatically discovered by World core CI).
Browser boot smoke enables P0 on its existing NG1.5 page and verifies actual mounting. Its added DOM fixture checks all 360 template/tone/line combinations at Desktop 1280x720, Portrait 390x844 and Landscape 844x390, including bounds, overflow, obstruction suppression and pointer transparency.

The unit fixtures cover six places and five periods. These are not evidence of natural encounters in all six real campus locations. **Natural in-world appearance, actual HUD overlap, comfort of 9.6-second timing, physical mobile and cross-player exclusion remain acceptance work.** Do not declare the user's full P0 done until a natural encounter→observation→resumed schedule→cooldown scene is observed, plus the remaining device/location checks.

Next: preview acceptance and tune density/timing; then resolve cross-player occupancy before production activation. No follow-on P1–P4 scope is included here.
