const SUPABASE_URL = process.env.SUPABASE_URL || 'http://127.0.0.1:54321';
const SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY || 'sb_publishable_PUBLIC_PLACEHOLDER';
const FLAG = 'asset_glb_canary_v1';

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader('CDN-Cache-Control', 'no-store');
  res.setHeader('Vercel-CDN-Cache-Control', 'no-store');
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).end();
  }

  try {
    const url = SUPABASE_URL + '/rest/v1/world_runtime_flags?flag=eq.' +
      encodeURIComponent(FLAG) + '&select=enabled&limit=1';
    const upstream = await fetch(url, {
      method: 'GET',
      headers: { apikey: SUPABASE_PUBLISHABLE_KEY },
      signal: AbortSignal.timeout(1200)
    });
    if (!upstream.ok) return res.status(503).end();
    const rows = await upstream.json();
    if (!Array.isArray(rows) || rows.length !== 1 || typeof rows[0]?.enabled !== 'boolean')
      return res.status(503).end();
    if (rows[0].enabled !== true) return res.status(404).end();
    return res.status(200).json({ enabled: true });
  } catch {
    return res.status(503).end();
  }
};
