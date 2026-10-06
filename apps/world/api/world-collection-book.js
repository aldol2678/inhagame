// Fixed self-only read. Service credentials never enter the browser bundle.
let handlerPromise;
module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  try {
    handlerPromise ??= Promise.all([
      import('../server/collection-book-service.mjs'), import('../npc-factory/npc-ai-auth.mjs'),
      import('../src/config/supabase-public-config.js')
    ]).then(([server, auth, config]) => server.createCollectionBookApiHandler({
      service: server.createCollectionBookService({ verifyUser: auth.verifyNpcAiUser,
        rpc: server.createCollectionBookRpc({ url: config.SUPABASE_URL, serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY }) })
    }));
    return await (await handlerPromise)(req, res);
  } catch { handlerPromise = null; return res.status(503).json({ error: 'COLLECTION_BOOK_UNAVAILABLE' }); }
};
