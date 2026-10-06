const PLACE_ZONE_PATTERN = /^AREA_[A-Z0-9_]{1,60}$/u;

function readPlaceZoneId(req) {
  const queryValue = req?.query?.placeZoneId;
  if (typeof queryValue === 'string') return queryValue;
  try {
    return new URL(req?.url ?? '/', 'http://localhost').searchParams.get('placeZoneId');
  } catch {
    return null;
  }
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader('CDN-Cache-Control', 'no-store');
  res.setHeader('Vercel-CDN-Cache-Control', 'no-store');

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).end();
  }
  if (process.env.NPC_SHARED_AUTHORITY_P0 !== '1')
    return res.status(404).end();

  const placeZoneId = readPlaceZoneId(req);
  if (!placeZoneId) return res.status(200).json({ enabled: true });
  if (!PLACE_ZONE_PATTERN.test(placeZoneId))
    return res.status(400).json({ error: 'INVALID_SHARED_NPC_PLACE_ZONE' });

  try {
    const { createCampusSharedNpcAuthorityP0 } = await import('../npc-factory/npc-shared-authority-server.mjs');
    return res.status(200).json(createCampusSharedNpcAuthorityP0().snapshot({ placeZoneId }));
  } catch (error) {
    console.warn('Shared NPC authority P0 unavailable:', error?.message ?? error);
    return res.status(503).json({ error: 'SHARED_NPC_AUTHORITY_UNAVAILABLE' });
  }
};
