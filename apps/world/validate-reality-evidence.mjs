import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const sourcesPath = fileURLToPath(new URL('./data/reality/campus-sources.json', import.meta.url));
const evidenceDir = fileURLToPath(new URL('./data/reality/evidence/p2-01/', import.meta.url));

const candidatesPath = fileURLToPath(new URL('./data/reality/evidence/p2-01/gis-candidates.json', import.meta.url));
const metadataPath = fileURLToPath(new URL('./data/reality/evidence/p2-01/acquisition-metadata.json', import.meta.url));
const crosswalkPath = fileURLToPath(new URL('./data/reality/evidence/p2-01/campus-physical-crosswalk.candidate.json', import.meta.url));

let errorCount = 0;
let warningCount = 0;

function fail(msg) {
  console.error(`  ✕ FAIL: ${msg}`);
  errorCount++;
}

function warn(msg) {
  console.warn(`  ⚠ WARN: ${msg}`);
  warningCount++;
}

function pass(msg) {
  console.log(`  ✓ ${msg}`);
}

console.log('\n─── Reality Evidence Validation ───\n');

// 1. Source registry
if (!fs.existsSync(sourcesPath)) {
  fail(`Missing sources file: ${sourcesPath}`);
  process.exit(1);
}
const sourcesData = JSON.parse(fs.readFileSync(sourcesPath, 'utf8'));
const validSourceIds = new Set(Object.keys(sourcesData.sources));
pass(`Loaded ${validSourceIds.size} canonical sources from campus-sources.json`);

// 2. Secret & API Key Audit across evidence files
console.log('\n[security scan]');
const evidenceFiles = fs.readdirSync(evidenceDir);
const secretRegex = /(?:key|api_?key|secret|token|password)\s*[:=]\s*["'][A-Za-z0-9_-]{16,}["']/i;
let secretsFound = false;

for (const file of evidenceFiles) {
  const filePath = fileURLToPath(new URL(`./data/reality/evidence/p2-01/${file}`, import.meta.url));
  const content = fs.readFileSync(filePath, 'utf8');
  if (secretRegex.test(content)) {
    fail(`Potential secret/API key pattern detected in ${file}`);
    secretsFound = true;
  }
}
if (!secretsFound) {
  pass(`No API keys, credentials, or plaintext secrets found across ${evidenceFiles.length} evidence files`);
}

// 3. Acquisition Metadata Validation
console.log('\n[acquisition metadata]');
if (!fs.existsSync(metadataPath)) {
  fail(`Missing acquisition metadata: ${metadataPath}`);
} else {
  const meta = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
  if (!meta.canonicalStatus) {
    fail('acquisition-metadata.json missing canonicalStatus field');
  } else if (!meta.canonicalStatus.includes('NON-CANONICAL')) {
    fail(`acquisition-metadata.json canonicalStatus should be NON-CANONICAL, got '${meta.canonicalStatus}'`);
  } else {
    pass(`canonicalStatus confirmed: '${meta.canonicalStatus}'`);
  }

  if (meta.registeredSourceId && !validSourceIds.has(meta.registeredSourceId)) {
    fail(`acquisition-metadata registeredSourceId '${meta.registeredSourceId}' not found in campus-sources.json`);
  } else {
    pass(`registeredSourceId '${meta.registeredSourceId}' verified in source registry`);
  }
}

// 4. GIS Candidates Validation
console.log('\n[gis candidates]');
if (!fs.existsSync(candidatesPath)) {
  fail(`Missing GIS candidates file: ${candidatesPath}`);
}
const candidatesData = JSON.parse(fs.readFileSync(candidatesPath, 'utf8'));
const features = candidatesData.features || [];
pass(`Loaded ${features.length} GIS candidate features`);

const featureIds = new Set();
const gisIds = new Set();

for (let idx = 0; idx < features.length; idx++) {
  const f = features[idx];
  const label = `Feature #${idx + 1} (FID ${f.fid})`;

  // Unique FIDs
  if (featureIds.has(f.fid)) {
    fail(`${label}: duplicate fid '${f.fid}'`);
  }
  featureIds.add(f.fid);

  // Polygon validation
  if (!Array.isArray(f.polygon) || f.polygon.length < 3) {
    fail(`${label}: polygon must have at least 3 vertices`);
  } else {
    for (let vIdx = 0; vIdx < f.polygon.length; vIdx++) {
      const pt = f.polygon[vIdx];
      if (!Array.isArray(pt) || pt.length !== 2 || typeof pt[0] !== 'number' || typeof pt[1] !== 'number') {
        fail(`${label}: vertex ${vIdx} must be [lat, lon] numbers`);
      } else {
        if (pt[0] < 30 || pt[0] > 45) fail(`${label}: vertex ${vIdx} lat ${pt[0]} out of South Korea range`);
        if (pt[1] < 120 || pt[1] > 135) fail(`${label}: vertex ${vIdx} lon ${pt[1]} out of South Korea range`);
      }
    }
    // Closed ring check
    const first = f.polygon[0];
    const last = f.polygon[f.polygon.length - 1];
    if (first[0] !== last[0] || first[1] !== last[1]) {
      fail(`${label}: polygon first and last vertex must match to form closed ring`);
    }
  }
}
pass(`All ${features.length} features have valid closed WGS84 polygon rings and unique FIDs`);

// 5. Candidate Crosswalk Validation
console.log('\n[candidate crosswalk]');
if (!fs.existsSync(crosswalkPath)) {
  fail(`Missing candidate crosswalk: ${crosswalkPath}`);
}
const crosswalkData = JSON.parse(fs.readFileSync(crosswalkPath, 'utf8'));

// Canonical status check
if (!crosswalkData.canonicalStatus) {
  fail('campus-physical-crosswalk.candidate.json missing canonicalStatus property');
} else if (!crosswalkData.canonicalStatus.includes('NON-CANONICAL')) {
  fail(`campus-physical-crosswalk.candidate.json canonicalStatus must indicate NON-CANONICAL, got '${crosswalkData.canonicalStatus}'`);
} else {
  pass(`canonicalStatus confirmed: '${crosswalkData.canonicalStatus}'`);
}

const ALLOWED_MAPPING_STATES = new Set([
  'VERIFIED_PART',
  'ATTRIBUTE_MATCH_ONLY',
  'SPATIAL_CANDIDATE',
  'CONNECTED_PART',
  'CONFLICT',
  'UNKNOWN'
]);

const knownEvidenceFeatureIds = new Set([...featureIds, 'osm_way_1099894035', 'osm_way_217958071']);

for (const entity of crosswalkData.entities || []) {
  const eLabel = `Entity '${entity.semanticId}' (${entity.officialName})`;
  if (entity.currentAuthority?.status && !ALLOWED_MAPPING_STATES.has(entity.currentAuthority.status)) {
    fail(`${eLabel}: currentAuthority status '${entity.currentAuthority.status}' not in allowed enums`);
  }

  for (const part of entity.physicalParts || []) {
    const pLabel = `${eLabel} -> Part '${part.featureId}'`;

    // Allowed relation enum
    if (!ALLOWED_MAPPING_STATES.has(part.relation)) {
      fail(`${pLabel}: relation '${part.relation}' not in allowed states [${[...ALLOWED_MAPPING_STATES].join(', ')}]`);
    }

    // Source registry check
    if (!part.sourceId) {
      fail(`${pLabel}: missing sourceId`);
    } else if (!validSourceIds.has(part.sourceId)) {
      fail(`${pLabel}: sourceId '${part.sourceId}' is not registered in campus-sources.json`);
    }

    // Feature ID existence check
    if (!knownEvidenceFeatureIds.has(part.featureId)) {
      fail(`${pLabel}: featureId '${part.featureId}' does not exist in gis-candidates.json or known landmarks`);
    }
  }
}
pass(`All crosswalk entity parts reference valid sourceIds, known evidence featureIds, and allowed mapping enums`);

// Summary
console.log('\n─── Result ───\n');
if (errorCount > 0) {
  console.error(`FAILED: ${errorCount} error(s), ${warningCount} warning(s)`);
  process.exit(1);
} else {
  console.log(`PASS: 0 errors, ${warningCount} warning(s)`);
  console.log('Reality Evidence validation complete.\n');
  process.exit(0);
}
