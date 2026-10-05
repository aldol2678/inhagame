'use strict';

const SUPABASE_URL = String(process.env.SUPABASE_URL || '').replace(/\/$/, '');
const KEY = String(process.env.SUPABASE_PUBLISHABLE_KEY || '');
const FUNCTION = 'inhagame-induck-brand-v1';

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=86400, stale-while-revalidate=604800');
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Allow', 'GET, HEAD');
    return res.status(405).end();
  }
  if (!/^https:\/\/[a-z0-9.-]+\.supabase\.co$/i.test(SUPABASE_URL) || !KEY.startsWith('sb_publishable_')) {
    return res.status(503).end();
  }
  try {
    const upstream = await fetch(SUPABASE_URL + '/functions/v1/' + FUNCTION, {
      method: req.method,
      headers: { apikey: KEY },
      signal: AbortSignal.timeout(4000)
    });
    if (!upstream.ok) return res.status(502).end();
    res.setHeader('Content-Type', 'model/gltf-binary');
    res.setHeader('X-INHAGAME-Asset', 'induck-brand-v1');
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
