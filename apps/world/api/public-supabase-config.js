'use strict';

function publicConfig() {
  const url = String(process.env.SUPABASE_URL || '').trim();
  const publishableKey = String(process.env.SUPABASE_PUBLISHABLE_KEY || '').trim();
  const validUrl = /^https:\/\/[a-z0-9.-]+(?:\:[0-9]+)?(?:\/.*)?$/i.test(url);
  const validKey = publishableKey.startsWith('sb_publishable_');
  return validUrl && validKey ? { url, publishableKey } : null;
}

module.exports = function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).end();
  }

  const config = publicConfig();
  if (!config) {
    return res.status(503).send(
      "console.error('INHAGAME public Supabase config is unavailable');"
    );
  }

  // Public URL + publishable key only. Revalidate after at most five minutes;
  // stale responses must not extend a key rotation. 405/503 stay no-store.
  res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=300, must-revalidate');
  return res.status(200).send(
    'globalThis.__INHAGAME_PUBLIC_SUPABASE__ = Object.freeze(' +
      JSON.stringify(config) +
    ');'
  );
};

module.exports.publicConfig = publicConfig;
