// A disabled-by-default, operator-only proxy. Never trust Origin as authentication.
const configuredUrl = process.env.MODEL_CONVERT_CLOUD_RUN_URL;
const MAX_BYTES = 25 * 1024 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const allowedUsers = new Set(String(process.env.MODEL_CONVERT_ALLOWED_USER_IDS || '')
  .split(',').map(value => value.trim().toLowerCase()).filter(value => UUID.test(value)));
const supabaseUrl = String(process.env.SUPABASE_URL || '').replace(/\/$/u, '');
const supabaseKey = String(process.env.SUPABASE_PUBLISHABLE_KEY || '');
const proxySecret = String(process.env.MODEL_CONVERT_PROXY_SECRET || '');
const enabled = process.env.MODEL_CONVERT_ENABLED === '1' && /^https:\/\//u.test(configuredUrl ?? '') &&
  /^https:\/\/[a-z0-9-]+\.supabase\.co$/iu.test(supabaseUrl) && supabaseKey.startsWith('sb_publishable_') &&
  proxySecret.length >= 20 && allowedUsers.size > 0;

async function readBody(req) {
  if (Buffer.isBuffer(req.body)) return req.body;
  if (typeof req.body === 'string') return Buffer.from(req.body, 'binary');
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BYTES) throw new Error('E_MODEL_FILE_TOO_LARGE');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function isFbx(buffer) {
  return buffer.subarray(0, 23).equals(Buffer.from('Kaydara FBX Binary  \0\x1a\0', 'binary')) ||
    /^; FBX(?:\s|\d)/u.test(buffer.subarray(0, 64).toString('utf8'));
}

async function readGlb(response) {
  const declaredLength = Number(response.headers.get('content-length'));
  if (response.headers.has('content-length') && (!Number.isSafeInteger(declaredLength) || declaredLength > MAX_BYTES))
    throw new Error('E_MODEL_CONVERT_TOO_LARGE');
  const reader = response.body?.getReader();
  if (!reader) throw new Error('E_MODEL_CONVERT_INVALID_GLB');
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > MAX_BYTES) throw new Error('E_MODEL_CONVERT_TOO_LARGE');
      chunks.push(Buffer.from(value));
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  const result = Buffer.concat(chunks, size);
  if (result.length < 20 || result.toString('ascii', 0, 4) !== 'glTF' ||
      result.readUInt32LE(4) !== 2 || result.readUInt32LE(8) !== result.length)
    throw new Error('E_MODEL_CONVERT_INVALID_GLB');
  return result;
}

async function authenticateOperator(authorization) {
  if (!/^Bearer [A-Za-z0-9._~-]{20,4096}$/u.test(authorization || '')) return { status: 401 };
  const response = await fetch(supabaseUrl + '/auth/v1/user', {
    headers: { apikey: supabaseKey, Authorization: authorization },
    signal: AbortSignal.timeout(5000)
  });
  if (response.status === 401 || response.status === 403) return { status: 401 };
  if (!response.ok) throw new Error('E_MODEL_AUTH_UNAVAILABLE');
  const user = await response.json();
  if (!UUID.test(user?.id || '') || user.is_anonymous !== false) return { status: 401 };
  return allowedUsers.has(user.id.toLowerCase()) ? { status: 200 } : { status: 403 };
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'GET') return res.status(200).json({ enabled });
  if (!enabled) return res.status(404).json({ error: 'E_MODEL_CONVERT_DISABLED' });
  if (req.method !== 'POST') return res.status(405).end();

  const origin = req.headers.origin;
  if (origin) {
    try { if (new URL(origin).host !== req.headers.host || new URL(origin).protocol !== 'https:') return res.status(403).end(); }
    catch { return res.status(403).end(); }
  }
  if (req.headers['content-type']?.split(';')[0] !== 'application/octet-stream') return res.status(415).end();
  const filename = String(req.headers['x-model-filename'] || req.query?.filename || '');
  if (!/^[^\x00-\x1f\x7f/\\]{1,180}\.fbx$/iu.test(filename)) return res.status(400).json({ error: 'E_MODEL_FBX_FILENAME_REQUIRED' });
  const contentLength = req.headers['content-length'];
  if (contentLength !== undefined && (!/^\d+$/u.test(String(contentLength)) || Number(contentLength) > MAX_BYTES))
    return res.status(413).json({ error: 'E_MODEL_FILE_TOO_LARGE' });

  // Auth must succeed before reading the upload or consuming paid converter resources.
  let access;
  try { access = await authenticateOperator(req.headers.authorization); }
  catch { return res.status(503).json({ error: 'E_MODEL_AUTH_UNAVAILABLE' }); }
  if (access.status !== 200) return res.status(access.status).end();

  try {
    const body = await readBody(req);
    if (!body.length) return res.status(400).json({ error: 'E_MODEL_FILE_REQUIRED' });
    if (body.length > MAX_BYTES) return res.status(413).json({ error: 'E_MODEL_FILE_TOO_LARGE' });
    if (!isFbx(body)) return res.status(415).json({ error: 'E_MODEL_FBX_INVALID' });
    const response = await fetch(configuredUrl, {
      method: 'POST', signal: AbortSignal.timeout(55000),
      headers: { 'Content-Type': 'application/octet-stream', 'X-Model-Filename': filename, 'X-Converter-Key': proxySecret },
      body
    });
    if (!response.ok) {
      // Never forward arbitrary upstream messages to callers.
      return res.status([400, 401, 413, 415, 422, 429, 503].includes(response.status) ? response.status : 502)
        .json({ error: 'E_MODEL_CONVERT_FAILED' });
    }
    const result = await readGlb(response);
    res.setHeader('Content-Type', 'model/gltf-binary');
    res.setHeader('Content-Disposition', "attachment; filename*=UTF-8''" + encodeURIComponent(filename.replace(/\.fbx$/iu, '.glb')));
    return res.status(200).send(result);
  } catch (error) {
    if (error.message === 'E_MODEL_FILE_TOO_LARGE') return res.status(413).json({ error: error.message });
    if (error.message === 'E_MODEL_CONVERT_TOO_LARGE') return res.status(502).json({ error: error.message });
    if (error.message === 'E_MODEL_CONVERT_INVALID_GLB') return res.status(502).json({ error: error.message });
    return res.status(503).json({ error: 'E_MODEL_CONVERT_UNAVAILABLE' });
  }
};
