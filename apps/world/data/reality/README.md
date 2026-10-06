# Reality Base — Canonical Campus Data

**Status:** P1 initial dataset  
**Coordinate datum:** WGS84  
**All dimensions:** real-world metres  
**Accuracy date:** 2026-09-25

## Files

| File | Contents |
|---|---|
| `campus-sources.json` | Source registry with URLs, reliability ratings, and access dates |
| `campus-buildings.json` | Campus metadata and all 25 buildings/facilities from the official Inha campus map |
| `campus-landmarks.json` | Named campus landmarks (gates, plazas, monuments, natural features) |

## Principles

1. **Real-world units only.** Coordinates are WGS84 lat/lon. Physical dimensions
   are in metres. These files contain **no game engine world units**.
   Conversion to PlayCanvas world coordinates happens at runtime
   via `campus-layout.js` → `geoToWorld()` or a future coordinate adapter.

2. **No invented data.** If a value is unknown, it is `null`.
   We do not fabricate footprints, heights, floor counts, or coordinates
   to make the dataset look complete.

3. **Provenance is mandatory.** Every non-null factual value
   (`officialName`, `address`, `postalCode`, `buildingNumber`, `lat`/`lon`,
   `floors`, `yearBuilt`, `totalFloorArea_sqm`, `purpose`, etc.)
   must have a corresponding entry in the `provenance` object with:
   - `accuracy`: `"verified"`, `"derived"`, or `"estimated"`
   - `sourceId`: a key that exists in `campus-sources.json`
   - `method` (required when `accuracy === "derived"`): deterministic derivation method
   - `note` (optional): additional context

4. **Accuracy rules.**
   - `"verified"`: the exact value is explicitly present in the cited source (requires source reliability ≥ 2).
     Paraphrases or functional interpretations must not be marked verified.
   - `"derived"`: calculated deterministically from verified source data (requires source reliability ≥ 2 and explicit `method`).
     Example: building centroid coordinates computed from an OSM polygon (`method: "polygon-centroid"`).
   - `"estimated"`: approximate, interpretive, or implied value (may cite lower-reliability sources such as community wikis, or indicate implied function from official names).
   - Null fields have no provenance entry — they are simply unknown.

5. **Notes semantics (Non-Canonical Policy).**
   - `notes` fields are explicitly **NON-CANONICAL contextual and editorial commentary**.
   - `notes` may contain observations, historical context, or human-readable background.
   - `notes` **MUST NOT** be consumed by runtime code, validation scripts, or authoritative decisions.
   - All canonical facts come strictly from structured fields with provenance.
   - Contextual notes must not contain standalone numeric or identity claims that could be mistaken for canonical data.

6. **Source reliability scale** (in `campus-sources.json`):
   - **3** — Authoritative primary/official source: Inha University official records and authoritative government/public registries (e.g. AURUM, National Spatial Information)
   - **2** — Reliable secondary / editorial GIS / partner documentation (e.g. crowdsourced GIS with editorial review like OSM, established map services, partner universities)
   - **1** — Community / user-generated content (wikis, blogs)

## Validation

Run from the `apps/world` directory:

```bash
node validate-reality.mjs
```

The script checks:
- Campus-level metadata has full provenance matching reliability criteria
- No duplicate building/landmark IDs
- No duplicate building numbers
- Valid lat/lon ranges when present
- Valid polygon geometry when present (array of ≥3 coordinate pairs forming a closed ring)
- Every non-null provenance-tracked field has a provenance entry
- Every provenance entry has valid `accuracy` (`verified`, `derived`, `estimated`) and `sourceId`
- Derived entries include a `method` property and source reliability ≥ 2
- Verified entries require source reliability ≥ 2
- Every `sourceId` references a source in `campus-sources.json`

## Adding Data

When adding a new building or correcting a value:

1. Add or update the entry in the appropriate JSON file.
2. Set the value. If you are unsure, set it to `null`.
3. Add a provenance entry with accuracy and sourceId (and method if derived).
4. If the source is new, add it to `campus-sources.json` first.
5. Run `node validate-reality.mjs` to check consistency.
6. Run `node qa.mjs` to verify existing gameplay is unaffected.

## Relationship to Current Gameplay Code

These data files are **passive reference data**. The current `campus-layout.js`
hardcodes its own `LANDMARKS`, `OBSTACLES`, and `TOUR_STOPS` independently.

In a future phase, `campus-layout.js` (or a new adapter module) will read
from these files and convert WGS84 → world coordinates at runtime. Until
that migration happens, changes here do not affect gameplay.

## 7. Semantic ↔ Physical Crosswalk & Promotion Rules

Campus semantic entities (official building names, numbered "호관", and named plazas) do not necessarily map 1:1 to cadastral land parcels or individual government GIS building polygons. A single campus building may comprise multiple registered structural dongs (e.g. `5-1동`, `5-5동`), or contiguous wings may be merged in GIS data.

Candidate crosswalk relationships are tracked in `evidence/` under `canonicalStatus: "CANDIDATE / NON-CANONICAL"`.

### Mapping States

- `VERIFIED_PART` — Conclusively verified physical building or wing belonging to the semantic entity.
- `ATTRIBUTE_MATCH_ONLY` — Attribute alignment (e.g., matching completion date or total area) without confirmed spatial/footprint identity. Not eligible for footprint canonicalization.
- `SPATIAL_CANDIDATE` — Geospatially plausible candidate requiring additional architectural or cadastral corroboration.
- `CONNECTED_PART` — Structurally connected wing or compound mass physically abutting the space.
- `CONFLICT` — Contradictory evidence between official records, cadastral registers, or spatial surveys.
- `UNKNOWN` — Unidentified or unclassified structure.

### Canonical Promotion Rules

To promote a physical mapping or footprint into the canonical Reality Base, at least one of the following criteria must be satisfied:

1. **Rule A (Cadastral Dong Identity):** The authoritative government building register (`건물동명칭`) explicitly and unambiguously identifies the semantic building (e.g. `7동 (7호관 학생회관)`).
2. **Rule B (Multi-Source Corroboration):** Multiple independent authoritative sources (reliability ≥ 2) independently identify and delineate the same physical feature.
3. **Rule C (Spatial & Geometric Alignment):** Official campus survey geometry and government GIS feature boundaries align without contradiction.

> [!IMPORTANT]
> **Attribute matches alone are strictly insufficient for canonical footprint promotion.** A matching completion date or gross floor area without spatial confirmation remains classified as `ATTRIBUTE_MATCH_ONLY`.

## License Note

Position data sourced from OpenStreetMap is used under the
[Open Database License (ODbL)](https://www.openstreetmap.org/copyright).
© OpenStreetMap contributors.
Government building GIS OpenAPI service sourced from the Ministry of Land, Infrastructure and Transport (국토교통부) via Public Data Portal (이용허락범위 제한 없음), with shapefile distribution under Open Government License Korea Type 1 (공공누리 제1유형: 출처표시).

