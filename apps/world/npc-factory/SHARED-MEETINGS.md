# Shared meeting scenes

Production and `npcSync=ng2` use revision `ng2-meetings-v2`. All clients derive the same group, paths, meeting poses, template, speaker and line from `/api/world-time`. Arrival or rendering frame rate never starts an event. A late observer sees the current line.

The existing NG1 model replays 120 ticks against the existing P2-B seed graph with storage disabled. Its active groups and remembered meeting venues supply the schedule. This is a bounded, revisioned seed snapshot, not a persistent server social simulation. Player-specific learned relationships cannot fork the shared scene.

Eligible existing members walk to a remembered venue, or a feasible current group-member destination when the remembered venue cannot be reached safely. Classes, transfers, protected quest NPCs and unavailable activities are excluded. Two or three participants stand apart, face the group, stay for 60 seconds, then walk back. A route must fit 90 seconds each way and finish within its existing 15-minute schedule period. Feasible meetings repeat after 300 seconds with another template. Existing 40 authored context templates supply three 3.6-second lines, beginning 15 seconds after everyone arrives.

Observation is per viewer: 8m entry, 12m exit, one scene, 60-second overall cooldown, session-only seen-event memory. Menus, cutscenes, direct dialogue and teleport suppress presentation without cancelling the shared event. Same-place-zone Realtime presence carries only a sanitized NPC ID and a 10-second expiry while a player talks directly to an NPC; refresh is bounded to once per five seconds. Other viewers suppress that scene. This is best-effort visual suppression, not a server NPC lock; it does not grant rewards or change access controls.

Campus road slots are separated after road projection without modulo reuse. NPC IDs determine slot ordering. Overlapping screen-space nameplates are culled, keeping the selected/nearest labels. Existing residence facade rows are preserved.

Validation: `node apps/world/tests/npc-shared-campus.test.mjs` checks all five periods, two independent NG1 replays, same event/text, walking continuity, safe paths, separated resting positions, meeting duration, repeat variation and schedule return. `node apps/world/tests/npc-shared-observer.test.mjs` checks observation and fake-transport talk presence. The existing two-page browser smoke covers real runtime boot, walking, clock skew and reload. Physical two-device simultaneous viewing and mobile portrait/landscape visual acceptance remain post-deployment QA.
