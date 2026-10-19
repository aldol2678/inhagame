// Vercel CommonJS entry point, matching world-quest.js. No browser service credentials.
let handlerPromise;
module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (process.env.WORLD_FISHING_API_ENABLED !== '1') return res.status(404).end();
  try {
    handlerPromise ??= Promise.all([
      import('../server/fishing-service.mjs'), import('../npc-factory/npc-ai-auth.mjs'),
      import('../src/config/supabase-public-config.js'), import('../npc-factory/supabase-server-key.mjs')
    ]).then(([server, auth, config, keys]) => server.createFishingApiHandler({
      enabled: true,
      service: server.createFishingService({
        verifyUser: auth.verifyNpcAiUser,
        rpc: server.createFishingRpc({ url: config.SUPABASE_URL, serviceKey: keys.requireSupabaseServerKey() })
      })
    }));
    return await (await handlerPromise)(req, res);
  } catch (error) {
    handlerPromise = null;
    // Fixed codes only (SUPABASE_SERVER_KEY_REQUIRED / _INVALID); never the key value.
    if (/^SUPABASE_SERVER_KEY_/u.test(error?.message ?? '')) console.error(error.message);
    return res.status(503).json({ error: 'FISHING_UNAVAILABLE' });
  }
};
