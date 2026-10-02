// Public, read-only server clock. No identity, NPC state writes or database work.
module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader('CDN-Cache-Control', 'no-store');
  res.setHeader('Vercel-CDN-Cache-Control', 'no-store');
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).end();
  }
  const { worldTimePayload } = await import('../npc-factory/npc-world-time-contract.mjs');
  return res.status(200).json(worldTimePayload());
};
