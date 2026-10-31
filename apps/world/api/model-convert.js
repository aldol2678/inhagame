// Vercel CommonJS entry point. The enabled flag is checked before loading the gate, so a
// disabled deployment answers exactly as before. Enabled requests require a verified
// Supabase member session and pass per-IP / per-user limits (server/model-convert-gate.mjs).
const configuredUrl = process.env.MODEL_CONVERT_CLOUD_RUN_URL;
const enabled = process.env.MODEL_CONVERT_ENABLED === '1' && /^https:\/\//u.test(configuredUrl ?? '');

let handlerPromise;
module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'GET') return res.status(200).json({ enabled });
  if (!enabled) return res.status(404).json({ error: 'E_MODEL_CONVERT_DISABLED' });
  try {
    handlerPromise ??= Promise.all([
      import('../server/model-convert-gate.mjs'), import('../npc-factory/npc-ai-auth.mjs')
    ]).then(([gate, auth]) => gate.createModelConvertHandler({
      enabled: true,
      upstreamUrl: configuredUrl,
      proxySecret: process.env.MODEL_CONVERT_PROXY_SECRET || '',
      verifyUser: auth.verifyNpcAiUser,
      allowedUserIds: gate.modelConvertAllowlistFromEnv(),
      limits: gate.modelConvertLimitsFromEnv(),
      trustProxyHeaders: process.env.VERCEL === '1'
    }));
    return await (await handlerPromise)(req, res);
  } catch { handlerPromise = null; return res.status(503).json({ error: 'E_MODEL_CONVERT_UNAVAILABLE' }); }
};
