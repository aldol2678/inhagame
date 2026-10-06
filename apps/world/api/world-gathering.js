let handlerPromise;
module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (process.env.WORLD_GATHERING_API_ENABLED !== '1') return res.status(404).end();
  try {
    handlerPromise ??= Promise.all([
      import('../server/gathering-service.mjs'),
      import('../npc-factory/npc-ai-auth.mjs'),
      import('../src/config/supabase-public-config.js')
    ]).then(([server, auth, config]) => server.createGatheringApiHandler({
      enabled: true,
      service: server.createGatheringService({
        verifyUser: auth.verifyNpcAiUser,
        rpc: server.createGatheringRpc({
          url: config.SUPABASE_URL,
          serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY
        })
      })
    }));
    return await (await handlerPromise)(req, res);
  } catch {
    handlerPromise = null;
    return res.status(503).json({ error: 'GATHERING_UNAVAILABLE' });
  }
};
