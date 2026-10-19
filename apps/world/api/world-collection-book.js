// Fixed self-only read. Service credentials never enter the browser bundle.
let handlerPromise;
module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  try {
    handlerPromise ??= Promise.all([
      import('../server/collection-book-service.mjs'), import('../npc-factory/npc-ai-auth.mjs'),
      import('../src/config/supabase-public-config.mjs'), import('../npc-factory/supabase-server-key.mjs')
    ]).then(([server, auth, config, keys]) => server.createCollectionBookApiHandler({
      service: server.createCollectionBookService({ verifyUser: auth.verifyNpcAiUser,
        rpc: server.createCollectionBookRpc({ url: config.SUPABASE_URL, serviceKey: keys.requireSupabaseServerKey() }) })
    }));
    return await (await handlerPromise)(req, res);
  } catch (error) {
    handlerPromise = null;
    // Fixed codes only (SUPABASE_SERVER_KEY_REQUIRED / _INVALID); never the key value.
    if (/^SUPABASE_SERVER_KEY_/u.test(error?.message ?? '')) console.error(error.message);
    return res.status(503).json({ error: 'COLLECTION_BOOK_UNAVAILABLE' });
  }
};
