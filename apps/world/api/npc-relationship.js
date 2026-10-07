const configuredUrl = process.env.NPC_AI_CLOUD_RUN_URL;
const enabled = process.env.NPC_RELATIONSHIP_ENABLED === '1' && /^https:\/\//u.test(configuredUrl ?? '');

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (!enabled) return res.status(404).end();
  if (req.method === 'GET') return res.status(200).json({ enabled: true });
  if (req.method !== 'POST' || req.headers['content-type']?.split(';')[0] !== 'application/json')
    return res.status(405).end();
  const origin = req.headers.origin;
  if (origin) {
    try { if (new URL(origin).host !== req.headers.host) return res.status(403).end(); }
    catch { return res.status(403).end(); }
  }
  if (!/^Bearer [A-Za-z0-9._~-]{20,4096}$/u.test(req.headers.authorization ?? ''))
    return res.status(401).end();

  let body = req.body;
  if (Buffer.isBuffer(body)) body = body.toString('utf8');
  if (typeof body === 'string') {
    if (body.length > 256) return res.status(413).end();
    try { body = JSON.parse(body); } catch { return res.status(400).end(); }
  }
  if (!body || typeof body !== 'object' || Array.isArray(body) ||
      Object.keys(body).length !== 2 || typeof body.npcId !== 'string' ||
      typeof body.event !== 'string' || JSON.stringify(body).length > 256)
    return res.status(400).end();

  try {
    const response = await fetch(`${configuredUrl.replace(/\/$/u, '')}/relationship`, {
      method: 'POST',
      signal: AbortSignal.timeout(10000),
      headers: { 'Content-Type': 'application/json', Authorization: req.headers.authorization },
      body: JSON.stringify(body)
    });
    return res.status(response.status).json(await response.json());
  } catch {
    return res.status(503).json({ error: 'NPC_RELATIONSHIP_UNAVAILABLE' });
  }
};
