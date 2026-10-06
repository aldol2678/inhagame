# INHA WORLD world-time and night environment contract

Status: runtime contract for the public `aldol2678/inhagame` implementation.

## World-time cadence

The shared world day uses five authoritative periods in this exact order:

1. `morning`
2. `class_time`
3. `lunch`
4. `evening`
5. `night`

Each period lasts **15 real minutes**. One complete INHA WORLD day therefore lasts **75 real minutes**.

The authoritative runtime constants live in:

- `apps/world/npc-factory/npc-world-time-contract.mjs`

The environment mapping is:

- morning → DAY
- class_time → DAY
- lunch → DAY
- evening → SUNSET
- night → NIGHT

## Night visual contract

Night is a dark navy, moonless campus night.

- No directional moonlight is synthesized during `NIGHT`.
- A deterministic star field becomes visible only after the world enters the night portion of the lighting signal.
- Cloud, rain, and snow reduce star visibility.
- Campus roads and pedestrian paths receive persistent lamp props with emissive bulbs.
- Only the nearest lamp bulbs receive real omni lights; the pool is graphics-tier bounded at 3 / 6 / 10 lights for low / medium / high. Selection stays within 68 WU of the player, and each non-shadow omni uses a 16.5 WU range so adjacent 22 WU road-lamp spacing does not collapse into isolated light islands.
- Existing back-gate lamps remain part of the same runtime pool.
- Building windows remain emissive-only but use a denser, brighter night policy so buildings read as occupied without multiplying real light sources.

The runtime exposes status through the existing environment debug surfaces, including `__INHAGAME_SKY__`, `__INHAGAME_NIGHT_LIGHTS__`, and `__INHAGAME_NIGHT_WINDOWS__`.

## Performance rule

Real-time lights are always bounded by graphics tier. Emissive geometry carries the long-distance visual signal; dynamic omni lights are reserved for the player's local neighborhood.
