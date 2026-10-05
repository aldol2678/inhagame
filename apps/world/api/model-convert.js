const configuredUrl = process.env.MODEL_CONVERT_CLOUD_RUN_URL;
const enabled = process.env.MODEL_CONVERT_ENABLED === '1' && /^https:\/\//u.test(configuredUrl ?? '');
const MAX_BYTES = 25 * 1024 * 1024;

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

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'GET') return res.status(200).json({ enabled });
  if (!enabled) return res.status(404).json({ error: 'E_MODEL_CONVERT_DISABLED' });
  if (req.method !== 'POST') return res.status(405).end();

  const origin = req.headers.origin;
  if (origin) {
    try { if (new URL(origin).host !== req.headers.host) return res.status(403).end(); }
    catch { return res.status(403).end(); }
  }
  const filename = String(req.headers['x-model-filename'] || req.query?.filename || '');
  if (!/^[^/\\]{1,180}\.fbx$/iu.test(filename)) return res.status(400).json({ error: 'E_MODEL_FBX_FILENAME_REQUIRED' });

  try {
    const body = await readBody(req);
    if (!body.length) return res.status(400).json({ error: 'E_MODEL_FILE_REQUIRED' });
    if (body.length > MAX_BYTES) return res.status(413).json({ error: 'E_MODEL_FILE_TOO_LARGE' });
    const response = await fetch(configuredUrl, {
      method: 'POST',
      signal: AbortSignal.timeout(55000),
      headers: {
        'Content-Type': 'application/octet-stream',
        'X-Model-Filename': filename,
        'X-Converter-Key': process.env.MODEL_CONVERT_PROXY_SECRET || ''
      },
      body
    });
    if (!response.ok) {
      let error = 'E_MODEL_CONVERT_FAILED';
      try { error = (await response.json()).error || error; } catch {}
      return res.status(response.status).json({ error });
    }
    const result = Buffer.from(await response.arrayBuffer());
    if (result.length < 20 || result.subarray(0, 4).toString('ascii') !== 'glTF')
      return res.status(502).json({ error: 'E_MODEL_CONVERT_INVALID_GLB' });
    res.setHeader('Content-Type', 'model/gltf-binary');
    res.setHeader('Content-Disposition', `attachment; filename="${filename.replace(/\.fbx$/iu, '.glb')}"`);
    return res.status(200).send(result);
  } catch (error) {
    if (error.message === 'E_MODEL_FILE_TOO_LARGE') return res.status(413).json({ error: error.message });
    return res.status(503).json({ error: 'E_MODEL_CONVERT_UNAVAILABLE' });
  }
};
