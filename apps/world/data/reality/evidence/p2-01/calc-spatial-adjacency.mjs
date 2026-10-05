import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const landmarksPath = fileURLToPath(new URL('../../campus-landmarks.json', import.meta.url));
const candidatesPath = fileURLToPath(new URL('./gis-candidates.json', import.meta.url));

const landmarksData = JSON.parse(fs.readFileSync(landmarksPath, 'utf8'));
const agora = landmarksData.landmarks.find(l => l.id === 'lmk_agora_plaza');
const agoraPoly = agora.polygon;

const candidatesData = JSON.parse(fs.readFileSync(candidatesPath, 'utf8'));

// WGS84 metric conversion around latitude 37.44928°
const LAT_M = 110985.0; // metres per degree latitude
const LON_M = 111320.0 * Math.cos(37.44928 * Math.PI / 180); // metres per degree longitude (~88383.8m)

function toMetres(lat, lon) {
  return [lon * LON_M, lat * LAT_M];
}

function distPointSegment(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(px - x1, py - y1);
  let t = ((px - x1) * dx + (py - y1) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const projX = x1 + t * dx;
  const projY = y1 + t * dy;
  return Math.hypot(px - projX, py - projY);
}

// Line segment intersection test
function segmentsIntersect(a1, a2, b1, b2) {
  function ccw(p1, p2, p3) {
    return (p3[1] - p1[1]) * (p2[0] - p1[0]) > (p2[1] - p1[1]) * (p3[0] - p1[0]);
  }
  return (ccw(a1, b1, b2) !== ccw(a2, b1, b2)) && (ccw(a1, a2, b1) !== ccw(a1, a2, b2));
}

// Point in polygon test
function pointInPoly(pt, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0], yi = poly[i][1];
    const xj = poly[j][0], yj = poly[j][1];
    const intersect = ((yi > pt[1]) !== (yj > pt[1])) &&
      (pt[0] < (xj - xi) * (pt[1] - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

function computeSpatialRelation(polyA_geo, polyB_geo) {
  const a = polyA_geo.map(([lat, lon]) => toMetres(lat, lon));
  const b = polyB_geo.map(([lat, lon]) => toMetres(lat, lon));

  let nearestVertexDist = Infinity;
  let minDistance = Infinity;
  let touchingOrIntersecting = false;

  // Vertex to vertex
  for (const pa of a) {
    for (const pb of b) {
      const d = Math.hypot(pa[0] - pb[0], pa[1] - pb[1]);
      if (d < nearestVertexDist) nearestVertexDist = d;
    }
  }

  // Segment to segment intersection
  for (let i = 0; i < a.length - 1; i++) {
    for (let j = 0; j < b.length - 1; j++) {
      if (segmentsIntersect(a[i], a[i+1], b[j], b[j+1])) {
        touchingOrIntersecting = true;
        minDistance = 0;
      }
    }
  }

  // Point to segment distances
  if (!touchingOrIntersecting) {
    for (const pb of b) {
      for (let i = 0; i < a.length - 1; i++) {
        const d = distPointSegment(pb[0], pb[1], a[i][0], a[i][1], a[i+1][0], a[i+1][1]);
        if (d < minDistance) minDistance = d;
      }
    }
    for (const pa of a) {
      for (let j = 0; j < b.length - 1; j++) {
        const d = distPointSegment(pa[0], pa[1], b[j][0], b[j][1], b[j+1][0], b[j+1][1]);
        if (d < minDistance) minDistance = d;
      }
    }
  }

  // Determine relative cardinal side
  // Agora center in metres
  let sumAx = 0, sumAy = 0;
  for (const pa of a) { sumAx += pa[0]; sumAy += pa[1]; }
  const centerA = [sumAx / a.length, sumAy / a.length];

  // Polygon B center in metres
  let sumBx = 0, sumBy = 0;
  for (const pb of b) { sumBx += pb[0]; sumBy += pb[1]; }
  const centerB = [sumBx / b.length, sumBy / b.length];

  const dx = centerB[0] - centerA[0];
  const dy = centerB[1] - centerA[1];

  let sides = [];
  if (dy > 5) sides.push('North');
  else if (dy < -5) sides.push('South');
  if (dx > 5) sides.push('East');
  else if (dx < -5) sides.push('West');
  const side = sides.length > 0 ? sides.join('-') : 'Center';

  return {
    minDistance,
    nearestVertexDist,
    touchingOrIntersecting,
    dx,
    dy,
    side
  };
}

console.log('=== CALCULATING PRECISE SPATIAL ADJACENCY TO AGORA PLAZA ===\n');

const featureResults = [];

candidatesData.features.forEach((f, idx) => {
  const rel = computeSpatialRelation(agoraPoly, f.polygon);
  featureResults.push({
    index: idx + 1,
    feature: f,
    ...rel
  });
});

featureResults.sort((a, b) => a.minDistance - b.minDistance);

console.log(`Total candidate features analyzed: ${featureResults.length}\n`);

const within20m = featureResults.filter(r => r.minDistance <= 20.0);
console.log(`=== FEATURES WITHIN 20 METRES OF AGORA PLAZA (${within20m.length} found) ===\n`);

within20m.forEach(r => {
  const f = r.feature;
  console.log(`----------------------------------------------------------------`);
  console.log(`Feature Index: #${r.index}`);
  console.log(`FID: ${f.fid}`);
  console.log(`GIS ID: ${f.gisId}`);
  console.log(`PNU: ${f.pnu || f.regPnu || '2817710300103840014'}`);
  console.log(`Registered Dong: ${f.regDong || '(None)'}`);
  console.log(`Registered Title: ${f.regTitle || '(None)'}`);
  console.log(`Footprint Area: ${f.bldgAr} m²`);
  console.log(`Total Gross Area: ${f.totAr} m²`);
  console.log(`Floors: Ground ${f.floorsGround || f.regGroundFloors || '-'}, Underground ${f.floorsUnderground || f.regUndergroundFloors || '-'}`);
  console.log(`Approval Date: ${f.regApprovalDate || f.useConfmDe || '-'}`);
  console.log(`Min Distance to Agora: ${r.minDistance.toFixed(2)} metres`);
  console.log(`Nearest Vertex Distance: ${r.nearestVertexDist.toFixed(2)} metres`);
  console.log(`Touching / Intersecting: ${r.touchingOrIntersecting}`);
  console.log(`Relative Cardinal Side: ${r.side} (dx=${r.dx.toFixed(1)}m, dy=${r.dy.toFixed(1)}m)`);
  console.log(`Vertex Count: ${f.vertexCount}`);
  console.log(`Polygon Vertices (first 5):`, JSON.stringify(f.polygon.slice(0, 5)));
  console.log(`----------------------------------------------------------------\n`);
});

const within100m = featureResults.filter(r => r.minDistance > 20.0 && r.minDistance <= 100.0);
console.log(`=== FEATURES BETWEEN 20m AND 100m (${within100m.length} found) ===\n`);
within100m.forEach(r => {
  const f = r.feature;
  console.log(`Index #${r.index} | FID: ${f.fid.slice(-8)} | Dong: ${f.regDong || '-'} | MinDist: ${r.minDistance.toFixed(2)}m | Side: ${r.side} | Area: ${f.bldgAr}m²`);
});
