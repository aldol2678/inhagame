# INHA WORLD world-time and night environment contract

Status: runtime contract for the public `aldol2678/inhagame` implementation.

## Authoritative world cadence

The shared NPC/gameplay day keeps five authoritative periods in this exact order:

1. `morning`
2. `class_time`
3. `lunch`
4. `evening`
5. `night`

Each period lasts **15 real minutes**. One complete INHA WORLD day therefore remains **75 real minutes**.

The authoritative gameplay constants live in:

- `apps/world/npc-factory/npc-world-time-contract.mjs`

Visual sky state must not change this cadence.

## Visual time phases

Environment rendering subdivides the same 75-minute clock without changing NPC schedules:

| Cycle minute | Visual phase | Lighting state |
| ---: | --- | --- |
| 0-4 | dawn | DAWN |
| 4-15 | morning | DAY |
| 15-40 | day | DAY |
| 40-50 | afternoon | DAY |
| 50-54 | golden hour | GOLDEN_HOUR |
| 54-58 | sunset | SUNSET |
| 58-60 | dusk | DUSK |
| 60-75 | night | NIGHT |

The previous behavior that rendered all 15 minutes of `evening` as SUNSET is retired. The strongest sunset state now lasts four real minutes.

## Celestial motion

The server-anchored shared clock drives the celestial pose continuously.

- 0..60 real cycle minutes model approximately 06:00..18:00 solar time.
- 60..75 real cycle minutes compress approximately 18:00..06:00.
- The sun rises in the east, reaches its highest point around cycle minute 30, and reaches the western horizon at cycle minute 60.
- The visible moon follows the opposite sky direction from the sun and becomes readable as artificial-light/night factor rises.
- The moon is **visual only**. It does not create directional moonlight and must not brighten the campus or cast moon shadows.
- The existing local street/building lighting system remains authoritative for night readability.

## Time-aware weather

Production weather is selected deterministically from the same shared world schedule. All clients observing the same authoritative slot and offset must resolve the same weather.

Base weather differs by gameplay period:

- morning: increased fog share
- class/lunch: higher clear-weather share
- evening: mostly clear/cloudy
- night: increased cloudy/fog share

Rain is **not** a whole 15-minute weather state. Each authoritative period independently decides whether a short rain event occurs.

- rain-event start time is deterministic-random within the 15-minute period
- rain duration is deterministic-random between **3 and 7 real minutes**
- at least one minute is reserved before rain and one minute after rain
- the minute before rain resolves to `CLOUDY` as a lead-in
- the minute after rain resolves to `CLOUDY` as a trail-out
- outside that event window the period returns to its deterministic base weather
- event incidence is calibrated so expected total rain-time stays close to the previous whole-period targets: about 5% morning, 12% class time, 10% lunch, 12% evening, and 14% night

Because event timing is derived from the shared server slot, reloads and separate clients do not reroll the current rain window.

Automatic rotation currently includes `CLEAR`, `CLOUDY`, `FOG`, and short `RAIN` events.

`SNOW` is intentionally excluded from automatic time-based selection until a seasonal authority owns winter activation. Existing manual/winter snow systems remain intact.

## Night visual contract

Night remains a dark navy campus environment.

- No directional moonlight is synthesized during `NIGHT`.
- A deterministic star field becomes visible only after the world enters the night portion of the lighting signal.
- Cloud, rain, and snow reduce star and moon visibility.
- Campus roads and pedestrian paths receive persistent lamp props with emissive bulbs.
- Only the nearest lamp bulbs receive real omni lights; the pool is graphics-tier bounded at 3 / 6 / 10 lights for low / medium / high. Selection stays within 68 WU of the player, and each non-shadow omni uses a 16.5 WU range so adjacent 22 WU road-lamp spacing does not collapse into isolated light islands.
- Existing back-gate lamps remain part of the same runtime pool.
- Building windows remain emissive-only but use a denser, brighter night policy so buildings read as occupied without multiplying real light sources.

The runtime exposes status through the existing environment debug surfaces, including `__INHAGAME_WORLD_TIME__`, `__INHAGAME_SKY__`, `__INHAGAME_NIGHT_LIGHTS__`, and `__INHAGAME_NIGHT_WINDOWS__`.

## Performance rule

Real-time lights are always bounded by graphics tier. Emissive geometry carries the long-distance visual signal; dynamic omni lights are reserved for the player's local neighborhood. The visual moon adds geometry only and does not add a real-time light.
