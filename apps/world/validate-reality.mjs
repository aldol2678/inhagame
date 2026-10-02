/**
 * Reality Base validation — checks campus-buildings.json, campus-landmarks.json,
 * and campus-sources.json for internal consistency, provenance integrity, and
 * data quality rules.
 *
 * Run from apps/world:  node validate-reality.mjs
 */
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const reality = (name) =>
  resolve(__dirname, "data", "reality", name);

/* ---------- helpers ---------- */

let errors = 0;
let warnings = 0;

function fail(msg) {
  console.error(`  ✗ ${msg}`);
  errors++;
}
function warn(msg) {
  console.warn(`  ⚠ ${msg}`);
  warnings++;
}
function pass(msg) {
  console.log(`  ✓ ${msg}`);
}

function loadJSON(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    fail(`Cannot load ${path}: ${e.message}`);
    return null;
  }
}

/* ---------- load ---------- */

console.log("\n─── Reality Base Validation ───\n");

console.log("[sources]");
const sourcesData = loadJSON(reality("campus-sources.json"));
const sources = sourcesData?.sources ?? {};
const sourceIds = new Set(Object.keys(sources));

if (sourcesData) {
  if (!sourcesData.schemaVersion) fail("Missing schemaVersion");
  const count = sourceIds.size;
  if (count === 0) fail("No sources defined");
  else pass(`${count} sources loaded`);

  for (const [id, src] of Object.entries(sources)) {
    if (!src.url) fail(`Source '${id}' missing url`);
    if (src.reliability == null) fail(`Source '${id}' missing reliability`);
    if (![1, 2, 3].includes(src.reliability))
      fail(`Source '${id}' reliability must be 1, 2, or 3`);
  }
}

/* ---------- provenance-tracked fields ---------- */

const CAMPUS_TRACKED = new Map([
  ["officialName", "officialName"],
  ["address", "address"],
  ["postalCode", "postalCode"],
]);

const BUILDING_TRACKED = new Map([
  ["officialName", "officialName"],
  ["officialNameEn", "officialNameEn"],
  ["buildingNumber", "buildingNumber"],
  ["lat", "position"], // checked jointly
  ["lon", "position"],
  ["footprintWidth_m", "footprint"],
  ["footprintDepth_m", "footprint"],
  ["height_m", "height"],
  ["floors", "floors"],
  ["yearBuilt", "yearBuilt"],
  ["totalFloorArea_sqm", "totalFloorArea"],
  ["purpose", "purpose"],
]);

const LANDMARK_TRACKED = new Map([
  ["officialName", "officialName"],
  ["officialNameEn", "officialNameEn"],
  ["lat", "position"],
  ["lon", "position"],
  ["width_m", "width"],
  ["length_m", "length"],
  ["polygon", "polygon"],
  ["polygonArea_sqm", "polygonArea"],
  ["polygonBounds", "polygonBounds"],
]);

function validateProvenance(entry, trackedFields, label) {
  const prov = entry.provenance ?? {};
  const neededKeys = new Set();

  for (const [field, provKey] of trackedFields) {
    if (entry[field] != null) {
      neededKeys.add(provKey);
    }
  }

  // Check: every needed key has provenance
  for (const key of neededKeys) {
    if (!prov[key]) {
      fail(`${label}: field '${key}' has a non-null value but no provenance entry`);
    }
  }

  // Check lat/lon pairing
  if ((entry.lat != null) !== (entry.lon != null)) {
    fail(`${label}: lat and lon must both be present or both null`);
  }

  // Check lat/lon validity
  if (entry.lat != null) {
    if (entry.lat < -90 || entry.lat > 90) fail(`${label}: lat ${entry.lat} out of range [-90, 90]`);
    if (entry.lon < -180 || entry.lon > 180) fail(`${label}: lon ${entry.lon} out of range [-180, 180]`);
  }

  // Check polygon validity if present
  if (entry.polygon != null) {
    if (!Array.isArray(entry.polygon) || entry.polygon.length < 3) {
      fail(`${label}: polygon must be an array of at least 3 coordinate pairs`);
    } else {
      for (let i = 0; i < entry.polygon.length; i++) {
        const pt = entry.polygon[i];
        if (!Array.isArray(pt) || pt.length !== 2 || typeof pt[0] !== "number" || typeof pt[1] !== "number") {
          fail(`${label}: polygon vertex ${i} must be [lat, lon] numbers`);
        } else {
          if (pt[0] < -90 || pt[0] > 90) fail(`${label}: polygon vertex ${i} lat ${pt[0]} out of range`);
          if (pt[1] < -180 || pt[1] > 180) fail(`${label}: polygon vertex ${i} lon ${pt[1]} out of range`);
        }
      }
      const first = entry.polygon[0];
      const last = entry.polygon[entry.polygon.length - 1];
      if (first && last && (first[0] !== last[0] || first[1] !== last[1])) {
        fail(`${label}: polygon first and last vertex must be identical to form a closed ring`);
      }
    }
  }

  // Check each provenance entry
  for (const [key, p] of Object.entries(prov)) {
    if (!p.accuracy) {
      fail(`${label}: provenance '${key}' missing accuracy`);
    } else if (!["verified", "derived", "estimated"].includes(p.accuracy)) {
      fail(`${label}: provenance '${key}' accuracy must be 'verified', 'derived', or 'estimated', got '${p.accuracy}'`);
    }

    if (!p.sourceId) {
      fail(`${label}: provenance '${key}' missing sourceId`);
    } else if (!sourceIds.has(p.sourceId)) {
      fail(`${label}: provenance '${key}' references unknown source '${p.sourceId}'`);
    } else {
      const srcReliability = sources[p.sourceId]?.reliability ?? 0;
      if (p.accuracy === "derived") {
        if (!p.method) {
          fail(`${label}: provenance '${key}' marked derived but missing required 'method' property`);
        }
        if (srcReliability < 2) {
          fail(`${label}: provenance '${key}' marked derived but source '${p.sourceId}' has reliability ${srcReliability} (must be ≥ 2)`);
        }
      } else if (p.accuracy === "verified") {
        if (srcReliability < 2) {
          fail(`${label}: provenance '${key}' marked verified but source '${p.sourceId}' has reliability ${srcReliability} (must be ≥ 2)`);
        }
      }
    }
  }
}

/* ---------- campus & buildings ---------- */

const buildingsData = loadJSON(reality("campus-buildings.json"));
const campus = buildingsData?.campus ?? null;
const buildings = buildingsData?.buildings ?? [];

console.log("\n[campus metadata]");
if (!campus) {
  fail("Missing campus metadata in campus-buildings.json");
} else {
  pass("Campus metadata present");
  validateProvenance(campus, CAMPUS_TRACKED, "campus");
}

console.log("\n[buildings]");
if (buildingsData) {
  if (!buildingsData.schemaVersion) fail("Missing schemaVersion");
  if (buildings.length === 0) fail("No buildings defined");
  else pass(`${buildings.length} buildings loaded`);

  // Duplicate IDs
  const ids = buildings.map((b) => b.id);
  const dupeIds = ids.filter((id, i) => ids.indexOf(id) !== i);
  if (dupeIds.length) fail(`Duplicate building IDs: ${[...new Set(dupeIds)].join(", ")}`);
  else pass("No duplicate IDs");

  // Duplicate building numbers
  const nums = buildings.map((b) => b.buildingNumber).filter(Boolean);
  const dupeNums = nums.filter((n, i) => nums.indexOf(n) !== i);
  if (dupeNums.length) fail(`Duplicate building numbers: ${[...new Set(dupeNums)].join(", ")}`);
  else pass("No duplicate building numbers");

  // Per-building checks
  for (const b of buildings) {
    if (!b.id) { fail("Building missing id"); continue; }
    if (!b.type) fail(`${b.id}: missing type`);
    validateProvenance(b, BUILDING_TRACKED, b.id);
  }
}

/* ---------- landmarks ---------- */

console.log("\n[landmarks]");
const landmarksData = loadJSON(reality("campus-landmarks.json"));
const landmarks = landmarksData?.landmarks ?? [];

if (landmarksData) {
  if (!landmarksData.schemaVersion) fail("Missing schemaVersion");
  if (landmarks.length === 0) fail("No landmarks defined");
  else pass(`${landmarks.length} landmarks loaded`);

  // Duplicate IDs
  const ids = landmarks.map((l) => l.id);
  const dupeIds = ids.filter((id, i) => ids.indexOf(id) !== i);
  if (dupeIds.length) fail(`Duplicate landmark IDs: ${[...new Set(dupeIds)].join(", ")}`);
  else pass("No duplicate IDs");

  // Cross-check: no landmark ID clashes with building ID
  const buildingIds = new Set(buildings.map((b) => b.id));
  for (const l of landmarks) {
    if (buildingIds.has(l.id)) fail(`Landmark '${l.id}' clashes with a building ID`);
  }

  // Per-landmark checks
  for (const l of landmarks) {
    if (!l.id) { fail("Landmark missing id"); continue; }
    if (!l.type) fail(`${l.id}: missing type`);
    validateProvenance(l, LANDMARK_TRACKED, l.id);
  }
}

/* ---------- statistics ---------- */

console.log("\n─── Statistics ───\n");

// Campus
const campusFields = campus ? Object.keys(campus.provenance ?? {}).length : 0;
console.log(`Campus metadata: ${campusFields} canonical fields verified`);

// Buildings
const bldgWithPos = buildings.filter((b) => b.lat != null).length;
const bldgWithFloors = buildings.filter((b) => b.floors != null).length;
const bldgWithYear = buildings.filter((b) => b.yearBuilt != null).length;
const bldgWithArea = buildings.filter((b) => b.totalFloorArea_sqm != null).length;
const bldgWithHeight = buildings.filter((b) => b.height_m != null).length;
const bldgWithFootprint = buildings.filter((b) => b.footprintWidth_m != null).length;
const bldgWithPurpose = buildings.filter((b) => b.purpose != null).length;
const bldgNums = buildings.map((b) => b.buildingNumber).filter(Boolean);

console.log(`Buildings: ${buildings.length}`);
console.log(`  buildingNumber:        ${bldgNums.length} verified (${bldgNums.join(", ")}), ${buildings.length - bldgNums.length} none/unknown`);
console.log(`  position (lat/lon):    ${bldgWithPos} defined, ${buildings.length - bldgWithPos} unknown`);
console.log(`  purpose:               ${bldgWithPurpose} verified/estimated, ${buildings.length - bldgWithPurpose} unknown`);
console.log(`  floors:                ${bldgWithFloors} provided (estimated), ${buildings.length - bldgWithFloors} unknown`);
console.log(`  yearBuilt:             ${bldgWithYear} verified, ${buildings.length - bldgWithYear} unknown`);
console.log(`  totalFloorArea_sqm:    ${bldgWithArea} verified, ${buildings.length - bldgWithArea} unknown`);
console.log(`  height_m:              ${bldgWithHeight} provided, ${buildings.length - bldgWithHeight} unknown`);
console.log(`  footprint:             ${bldgWithFootprint} provided, ${buildings.length - bldgWithFootprint} unknown`);

// Landmarks
const lmkWithPos = landmarks.filter((l) => l.lat != null).length;
const lmkWithPoly = landmarks.filter((l) => l.polygon != null).length;
console.log(`\nLandmarks: ${landmarks.length}`);
console.log(`  position (lat/lon):    ${lmkWithPos} defined, ${landmarks.length - lmkWithPos} unknown`);
console.log(`  polygon:               ${lmkWithPoly} defined, ${landmarks.length - lmkWithPoly} unknown`);

// Accuracy summary (including campus metadata)
let verifiedCount = 0;
let derivedCount = 0;
let estimatedCount = 0;
const allEntries = [
  ...(campus ? [campus] : []),
  ...buildings,
  ...landmarks
];
for (const entry of allEntries) {
  for (const p of Object.values(entry.provenance ?? {})) {
    if (p.accuracy === "verified") verifiedCount++;
    if (p.accuracy === "derived") derivedCount++;
    if (p.accuracy === "estimated") estimatedCount++;
  }
}
console.log(`\nProvenance entries: ${verifiedCount + derivedCount + estimatedCount}`);
console.log(`  verified:  ${verifiedCount}`);
console.log(`  derived:   ${derivedCount}`);
console.log(`  estimated: ${estimatedCount}`);

// Source usage
const sourceUsage = {};
for (const entry of allEntries) {
  for (const p of Object.values(entry.provenance ?? {})) {
    if (p.sourceId) sourceUsage[p.sourceId] = (sourceUsage[p.sourceId] || 0) + 1;
  }
}
console.log(`\nSource usage:`);
for (const [id, count] of Object.entries(sourceUsage).sort((a, b) => b[1] - a[1])) {
  const src = sources[id];
  const rel = src ? ` (reliability ${src.reliability})` : " (UNKNOWN)";
  console.log(`  ${id}: ${count} references${rel}`);
}

/* ---------- result ---------- */

console.log(`\n─── Result ───\n`);
if (errors > 0) {
  console.error(`FAIL: ${errors} error(s), ${warnings} warning(s)`);
  process.exit(1);
} else {
  console.log(`PASS: 0 errors, ${warnings} warning(s)`);
  console.log("Reality Base validation complete.\n");
}
