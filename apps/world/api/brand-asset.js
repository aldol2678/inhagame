'use strict';

const SUPABASE_URL = String(process.env.SUPABASE_URL || '').replace(/\/$/, '');
const KEY = String(process.env.SUPABASE_PUBLISHABLE_KEY || '');
const CANONICAL_FUNCTION = 'inhagame-world-brand-assets-v1';
const OPTIMIZED_FUNCTION = 'inhagame-world-brand-assets-optimized-v1';
const ALLOWED = new Set([
  'induck-v3.glb',
  'annyongi-flight-v1.glb',
  'induck-cap-v1.glb',
  'induck-backpack-v1.glb',
  'induck-hoodie-v1.glb'
]);

// Immutable furniture payloads use canonical bytes only; runtime activation is
// separately gated in the code-owned furniture manifest. No private asset bytes here.
const CANONICAL_FURNITURE = new Set([
  'annyongi-character-chair-r2-70ec784f8796.glb',
  'official-rug-replacement-r1-f4ca31569bdf.glb',
  'official-bed-replacement-r2-44d3cdc7870c.glb',
  'induck-character-nightstand-r1-01a2764ecb9c.glb',
  'annyongi-character-bookshelf-r3-05b6fa9c384e.glb'
]);

const FURNITURE_DELIVERY = Object.freeze({
  "annyongi-character-chair-r2-70ec784f8796.glb": {
    "sha256": "70ec784f87966d43ef80ce4a742e9ce43a1a7d40312be00b9a569843edf190b8",
    "bytes": 3243832
  },
  "induck-character-nightstand-r1-01a2764ecb9c.glb": {
    "sha256": "01a2764ecb9c581f033e5fc35e4e97ddd027897865f3057a5948cb3ee1a48b77",
    "bytes": 4818556
  },
  "annyongi-character-bookshelf-r3-05b6fa9c384e.glb": {
    "sha256": "05b6fa9c384e92c62967da51ebad1b29769e0f503670510f060f2965a977f8f9",
    "bytes": 14752504
  },
  "official-rug-replacement-r1-f4ca31569bdf.glb": {
    "sha256": "f4ca31569bdf7e2a1220d290bd00f2d0e32fb99cbb0617aca963fc3834e83828",
    "bytes": 214924
  },
  "official-bed-replacement-r2-44d3cdc7870c.glb": {
    "sha256": "44d3cdc7870cce0b7bce5e1904308e2989eaca242b8800a5c8b2125efffc9d0c",
    "bytes": 187592
  }
});
const FURNITURE_BUCKET = 'inhagame-furniture-private';
function signedFurnitureLocation(location, asset) {
  if (typeof location !== 'string' || location.length > 8192) return null;
  const expected = SUPABASE_URL + '/storage/v1/object/sign/' + FURNITURE_BUCKET + '/' + asset;
  if (!location.startsWith(expected + '?')) return null;
  try {
    const target = new URL(location);
    const parameters = [...target.searchParams];
    if (target.origin !== SUPABASE_URL || target.username || target.password || target.hash
      || target.pathname !== '/storage/v1/object/sign/' + FURNITURE_BUCKET + '/' + asset
      || parameters.length !== 1 || parameters[0][0] !== 'token'
      || !/^[A-Za-z0-9._~-]+$/.test(parameters[0][1])) return null;
    return target.href;
  } catch { return null; }
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=86400, stale-while-revalidate=604800');
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Allow', 'GET, HEAD');
    return res.status(405).end();
  }
  if (!/^https:\/\/[a-z0-9.-]+\.supabase\.co$/i.test(SUPABASE_URL) || !KEY.startsWith('sb_publishable_')) {
    return res.status(503).end();
  }

  const requestUrl = new URL(req.url || '/', 'https://inhagame.invalid');
  const asset = String(requestUrl.searchParams.get('asset') || '');
  const variant = String(requestUrl.searchParams.get('variant') || 'canonical');
  if ((!ALLOWED.has(asset) && !CANONICAL_FURNITURE.has(asset)) || !['canonical', 'optimized'].includes(variant) || (CANONICAL_FURNITURE.has(asset) && variant !== 'canonical')) return res.status(404).end();
  const functionName = variant === 'optimized' ? OPTIMIZED_FUNCTION : CANONICAL_FUNCTION;
  const furniture = FURNITURE_DELIVERY[asset];
  // Signed capabilities must never enter the existing public/stale cache.
  if (furniture) {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('CDN-Cache-Control', 'no-store');
    res.setHeader('Vercel-CDN-Cache-Control', 'no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
  }

  try {
    const upstream = await fetch(
      SUPABASE_URL + '/functions/v1/' + functionName + '?asset=' + encodeURIComponent(asset) + (asset === 'annyongi-flight-v1.glb' ? '&revision=5cc0bc54905da5b87314b81691c229bc583ad1980794239634008cd3f0d834fb' : ''),
      {
        method: req.method,
        ...(furniture ? { redirect: 'manual' } : {}),
        headers: { apikey: KEY },
        signal: AbortSignal.timeout(furniture ? 10000 : (variant === 'optimized' ? 12000 : 5000))
      }
    );
    if (furniture) {
      const location = signedFurnitureLocation(upstream.headers.get('location'), asset);
      if (upstream.status !== 307 || !location
        || upstream.headers.get('x-inhagame-asset-sha256') !== furniture.sha256
        || upstream.headers.get('x-inhagame-output-bytes') !== String(furniture.bytes)) return res.status(502).end();
      res.setHeader('Location', location);
      res.setHeader('X-INHAGAME-Brand-Asset', asset);
      res.setHeader('X-INHAGAME-Brand-Variant', 'canonical');
      res.setHeader('X-INHAGAME-Asset-SHA256', furniture.sha256);
      res.setHeader('X-INHAGAME-Output-Bytes', String(furniture.bytes));
      return res.status(307).end();
    }
    if (!upstream.ok) return res.status(502).end();
    res.setHeader('Content-Type', 'model/gltf-binary');
    res.setHeader('X-INHAGAME-Brand-Asset', asset);
    res.setHeader('X-INHAGAME-Brand-Variant', variant);
    const optimization = upstream.headers.get('x-inhagame-optimization');
    const sourceBytes = upstream.headers.get('x-inhagame-source-bytes');
    const outputBytes = upstream.headers.get('x-inhagame-output-bytes');
    if (optimization) res.setHeader('X-INHAGAME-Optimization', optimization);
    if (sourceBytes) res.setHeader('X-INHAGAME-Source-Bytes', sourceBytes);
    if (outputBytes) res.setHeader('X-INHAGAME-Output-Bytes', outputBytes);
    if (req.method === 'HEAD') return res.status(200).end();

    const bytes = Buffer.from(await upstream.arrayBuffer());
    if (bytes.length < 1024 || bytes.subarray(0, 4).toString('ascii') !== 'glTF') {
      return res.status(502).end();
    }
    return res.status(200).send(bytes);
  } catch {
    return res.status(503).end();
  }
};
