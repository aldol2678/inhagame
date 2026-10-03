const SUPABASE_URL = process.env.SUPABASE_URL || 'http://127.0.0.1:54321';
const SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY || 'sb_publishable_PUBLIC_PLACEHOLDER';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SOURCES = new Set(['direct', 'everytime', 'internal', 'external', 'unknown']);
const CAMPAIGN = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const EVENTS = new Set([
  'hub_visit', 'hub_panel_view', 'hub_game_click', 'campus_entry_click',
  'campus_boot_ready', 'campus_boot_error', 'campus_zone_enter', 'hub_card_impression',
  'profile_view', 'profile_edit_open', 'profile_edit_save', 'profile_game_click',
  'first_session_start', 'first_goal_seen', 'first_move', 'first_zone_arrival', 'first_npc_interaction',
  'quest_started', 'first_player_encounter', 'first_activity_start', 'first_activity_complete',
  'first_reward', 'reward_seen', 'growth_seen', 'core_loop_complete', 'next_goal_seen',
  'core15_complete', 'world_return', 'next_discovery_click',
  'asset_canary_selected', 'asset_canary_active', 'asset_canary_rollback', 'asset_canary_failure'
]);
module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).end();
  const origin = req.headers.origin;
  const host = req.headers.host;
  if (origin) {
    try { if (!host || new URL(origin).host !== host) return res.status(403).end(); }
    catch { return res.status(403).end(); }
  }
  let body = req.body;
  if (Buffer.isBuffer(body)) body = body.toString('utf8');
  if (typeof body === 'string') {
    if (body.length > 1024) return res.status(413).end();
    try { body = JSON.parse(body); } catch { return res.status(400).end(); }
  }
  const acquisitionSource = body?.acquisition_source == null
    ? 'unknown'
    : SOURCES.has(body.acquisition_source) ? body.acquisition_source : null;
  if (!body || typeof body !== 'object' || !UUID.test(body.event_id) ||
    !UUID.test(body.session_id) || !UUID.test(body.visitor_id) ||
    !EVENTS.has(body.event_type) || typeof body.surface !== 'string' ||
    (body.target !== null && body.target !== undefined && typeof body.target !== 'string') ||
    !acquisitionSource ||
    (body.campaign !== null && body.campaign !== undefined &&
      (typeof body.campaign !== 'string' || !CAMPAIGN.test(body.campaign)))) {
    return res.status(400).end();
  }
  try {
    const upstream = await fetch(SUPABASE_URL + '/rest/v1/rpc/log_inhagame_hub_event_v2', {
      method: 'POST',
      headers: { apikey: SUPABASE_PUBLISHABLE_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        p_event_id: body.event_id, p_session_id: body.session_id,
        p_visitor_id: body.visitor_id, p_event_type: body.event_type,
        p_surface: body.surface, p_target: body.target ?? null,
        p_acquisition_source: acquisitionSource,
        p_campaign: body.campaign ?? null
      }),
      signal: AbortSignal.timeout(4000)
    });
    if (!upstream.ok) return res.status(502).end();
    const accepted = await upstream.json();
    return res.status(accepted === true ? 204 : 400).end();
  } catch {
    return res.status(503).end();
  }
};
