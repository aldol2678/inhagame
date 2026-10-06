// Fixed self-only read proxy. Supabase service credentials stay on the existing trusted backend.
let handlerPromise;
module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  try {
    handlerPromise ??= import('../server/collection-book-proxy.mjs').then(({ createCollectionBookProxy }) =>
      createCollectionBookProxy({ url: process.env.NPC_AI_CLOUD_RUN_URL }));
    return await (await handlerPromise)(req, res);
  } catch { handlerPromise = null; return res.status(503).json({ error: 'COLLECTION_BOOK_UNAVAILABLE' }); }
};
