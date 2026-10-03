const SUPABASE_URL = process.env.SUPABASE_URL || 'http://127.0.0.1:54321';
const KEY = process.env.SUPABASE_PUBLISHABLE_KEY || 'sb_publishable_PUBLIC_PLACEHOLDER';
// Same host input as the build (INHAGAME_PUBLIC_HOST_*); fails closed when Production has none.
const { runtimeOriginTargets } = require('../scripts/public-hosts.cjs');
const ORIGINS = runtimeOriginTargets(process.env);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EVENTS = new Set(['game_landing', 'game_play_start', 'game_load_error',
  'game_first_result', 'game_first_clear', 'game_retry', 'classic_ranked_start']);
module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const origin = req.headers.origin;
  const target = ORIGINS[origin];
  if (!target) return res.status(403).end();
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).end();
  let body = req.body;
  if (Buffer.isBuffer(body)) body = body.toString('utf8');
  if (typeof body === 'string') {
    if (body.length > 512) return res.status(413).end();
    try { body = JSON.parse(body); } catch { return res.status(400).end(); }
  }
  if (!body || typeof body !== 'object' || !UUID.test(body.event_id) ||
      !UUID.test(body.entry_id) || !EVENTS.has(body.event_type) || body.target !== target)
    return res.status(400).end();
  try {
    const upstream = await fetch(SUPABASE_URL + '/rest/v1/rpc/log_inhagame_game_entry_v1', {
      method: 'POST',
      headers: { apikey: KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        p_event_id: body.event_id, p_entry_id: body.entry_id,
        p_event_type: body.event_type, p_target: target
      }),
      signal: AbortSignal.timeout(4000)
    });
    if (!upstream.ok) return res.status(502).end();
    const accepted = await upstream.json();
    return res.status(accepted === true ? 204 : 409).end();
  } catch { return res.status(503).end(); }
};