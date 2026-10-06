const enabled = process.env.NPC_JEV_ENABLED === '1' &&
  typeof process.env.TYPESAFE_API_KEY === 'string' && process.env.TYPESAFE_API_KEY.length >= 12;

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (!enabled) return res.status(404).end();
  if (req.method === 'GET') return res.status(200).json({ enabled: true, role: 'EXPERIMENT_ONLY', authorityEffect: 'NONE' });
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
    if (body.length > 12000) return res.status(413).end();
    try { body = JSON.parse(body); } catch { return res.status(400).end(); }
  }
  if (!body || typeof body !== 'object' || Array.isArray(body) || JSON.stringify(body).length > 12000)
    return res.status(400).end();

  try {
    const [{ verifyNpcAiUser }, { createNpcJevDecisionProvider }] = await Promise.all([
      import('../npc-factory/npc-ai-auth.mjs'),
      import('../npc-factory/npc-jev-router.mjs')
    ]);
    const userId = await verifyNpcAiUser(req.headers.authorization);
    if (!userId) return res.status(401).end();
    const provider = createNpcJevDecisionProvider({
      apiKey: process.env.TYPESAFE_API_KEY,
      model: process.env.TYPESAFE_MODEL || 'jev-latest',
      endpoint: process.env.TYPESAFE_SYSTEMONE_URL || undefined
    });
    const started = Date.now();
    const result = await provider.decide(body);
    const latencyMs = Date.now() - started;
    console.info('NPC_JEV_SHADOW', JSON.stringify({
      npcId: body.npcId,
      latencyMs,
      responseSource: result.decision.responseSource,
      intent: result.decision.intent,
      contextPriority: result.decision.contextPriority,
      expression: result.expression,
      confidence: result.confidence
    }));
    return res.status(200).json({ ...result, shadow: { latencyMs } });
  } catch (error) {
    const code = String(error?.message ?? '');
    if (/^JEV_(INVALID|NPC_NOT_PILOT|FORBIDDEN|CONTEXT_TOO_LARGE|EMPTY)/u.test(code))
      return res.status(400).json({ error: code });
    if (code === 'AUTH_UNAVAILABLE') return res.status(503).json({ error: 'JEV_AUTH_UNAVAILABLE' });
    return res.status(503).json({ error: 'JEV_UNAVAILABLE' });
  }
};
