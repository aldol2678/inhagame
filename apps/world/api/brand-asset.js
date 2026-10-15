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

  try {
    const upstream = await fetch(
      SUPABASE_URL + '/functions/v1/' + functionName + '?asset=' + encodeURIComponent(asset) + (asset === 'annyongi-flight-v1.glb' ? '&revision=5cc0bc54905da5b87314b81691c229bc583ad1980794239634008cd3f0d834fb' : ''),
      {
        method: req.method,
        headers: { apikey: KEY },
        signal: AbortSignal.timeout(variant === 'optimized' ? 12000 : 5000)
      }
    );
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
