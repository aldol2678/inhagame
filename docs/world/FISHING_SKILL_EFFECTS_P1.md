# Fishing Life Skill Effects P1

This slice is the first real consumer of the Life Skill Tree. It activates only the two Fishing
nodes whose gameplay surfaces already exist in the authoritative Fishing resolver.

## Active nodes

| Node | Rank | Server effect |
|---|---:|---|
| `life.node.fishing.steady_hands` | 1–3 | +250 ms HOOK response window per rank |
| `life.node.fishing.fish_sense` | 1–3 | -250 ms minimum and maximum bite wait per rank |

The current production-candidate base policy is 3–9 seconds to bite and a 1.5 second HOOK window.
At rank 3 / rank 3 that becomes 2.25–8.25 seconds and a 2.25 second HOOK window. These numbers are
candidate balance, not a permanent promise.

## Authority contract

The browser never sends a rank, modifier, wait time or response window. At `world_fishing_start_v1`:

1. the trusted server verifies the account and start request;
2. the DB reads the player's current Fishing tree epoch;
3. `world_fishing_skill_effects_v1` derives the two ranks and bounded modifiers;
4. `world_fishing_apply_skill_effects_v1` applies them to the operator-owned base policy;
5. the existing policy validator re-validates the effective policy;
6. that effective policy and the private effect snapshot are frozen into the attempt.

A tree reset after the cast does not rewrite that attempt. The next cast uses the new epoch. Exact
start retries return the original frozen attempt, so idempotency semantics are unchanged.

`world_fishing_project_v1` keeps both the policy and the effect snapshot private. The client receives
only the already-required timestamps such as `biteAtMs` and `hookDeadlineMs`.

## Deferred nodes

The remaining Fishing nodes stay `COMING_SOON` because activating them now would sell SP for an
effect that does not exist:

- `baitcraft`: needs a real bait recipe / inventory consumer.
- `rare_fish_sense`: needs a multi-species rarity roll and rare-fish catalog.
- `boat_fishing`: needs an eligible boat / water-source activity surface.
- `deep_sea_fishing`: depends on the rare-fish and boat/deep-water surfaces.

They should be activated only in the migration that introduces their authoritative consumer.

## Verification

- Registry unit tests require exactly the two implemented nodes to be ACTIVE.
- The existing tree pgTAP contract is updated to the same baseline.
- `99_world_fishing_skill_effects_p1.test.sql` proves rank derivation, candidate timing math,
  forged-effect rejection, private projection, and reset-epoch behavior.
- Fishing F3's trusted-position and spot-lease contract is unchanged.
- Production HTTP exposure remains independently gated by `WORLD_FISHING_API_ENABLED=1`.
