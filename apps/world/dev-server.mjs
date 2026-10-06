import http from "node:http";
import { worldTimePayload } from './npc-factory/npc-world-time-contract.mjs';
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createNpcAiPilot } from './npc-factory/npc-ai-pilot.mjs';
import { createVertexNpcGenerator } from './npc-factory/npc-ai-vertex.mjs';
import { verifyNpcAiUser } from './npc-factory/npc-ai-auth.mjs';
import { createQuestCloudHandler } from './npc-factory/quest-cloud-handler.mjs';
import { createLocalQuestStore } from './npc-factory/quest-store.mjs';
import { convertFbxBuffer } from './model-converter/convert-model.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 8080;
const npcAiPilot = process.env.NPC_AI_PILOT === '1'
  ? createNpcAiPilot({ generate: createVertexNpcGenerator({ project: process.env.NPC_AI_PROJECT }) })
  : null;
const questHandler = createQuestCloudHandler({ store: createLocalQuestStore() });

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon"
};

const server = http.createServer((req, res) => {
  let reqPath = decodeURIComponent(req.url.split("?")[0]);
  if (reqPath === '/api/world-time') {
    res.writeHead(req.method === 'GET' ? 200 : 405, {
      'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Allow': 'GET'
    });
    res.end(req.method === 'GET' ? JSON.stringify(worldTimePayload()) : '');
    return;
  }
  if (reqPath === '/api/npc-shared-state') {
    const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' };
    if (req.method !== 'GET') {
      res.writeHead(405, { ...headers, Allow: 'GET' });
      res.end();
      return;
    }
    if (process.env.NPC_SHARED_AUTHORITY_P0 !== '1') {
      res.writeHead(404, headers);
      res.end();
      return;
    }
    const placeZoneId = new URL(req.url, `http://127.0.0.1:${PORT}`).searchParams.get('placeZoneId');
    if (!/^AREA_[A-Z0-9_]{1,60}$/u.test(placeZoneId ?? '')) {
      res.writeHead(400, headers);
      res.end(JSON.stringify({ error: 'INVALID_SHARED_NPC_PLACE_ZONE' }));
      return;
    }
    void import('./npc-factory/npc-shared-authority-server.mjs').then(({ createCampusSharedNpcAuthorityP0 }) => {
      res.writeHead(200, headers);
      res.end(JSON.stringify(createCampusSharedNpcAuthorityP0().snapshot({ placeZoneId })));
    }).catch(error => {
      console.warn('Shared NPC authority P0 unavailable:', error?.message ?? error);
      res.writeHead(503, headers);
      res.end(JSON.stringify({ error: 'SHARED_NPC_AUTHORITY_UNAVAILABLE' }));
    });
    return;
  }
  if (reqPath === '/api/model-convert') {
    if (req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ enabled: true, mode: 'local-blender' }));
      return;
    }
    if (req.method !== 'POST' ||
        req.headers.origin && req.headers.origin !== `http://127.0.0.1:${PORT}` &&
        req.headers.origin !== `http://localhost:${PORT}`) {
      res.writeHead(req.method === 'POST' ? 403 : 405); res.end(); return;
    }
    const filename = String(req.headers['x-model-filename'] || '');
    if (!/^[^/\\\\]{1,180}\\.fbx$/iu.test(filename)) {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'E_MODEL_FBX_FILENAME_REQUIRED' }));
      return;
    }
    const chunks = [];
    let size = 0;
    let aborted = false;
    req.on('data', chunk => {
      if (aborted) return;
      size += chunk.length;
      if (size > 25 * 1024 * 1024) {
        aborted = true;
        res.writeHead(413, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: 'E_MODEL_FILE_TOO_LARGE' }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', async () => {
      if (aborted) return;
      try {
        const output = await convertFbxBuffer(Buffer.concat(chunks));
        res.writeHead(200, {
          'Content-Type': 'model/gltf-binary',
          'Content-Length': output.length,
          'Cache-Control': 'no-store'
        });
        res.end(output);
      } catch (error) {
        const code = String(error?.message || 'E_MODEL_CONVERT_FAILED').split(':')[0];
        const status = code === 'E_MODEL_CONVERTER_NOT_INSTALLED' ? 503 : 422;
        res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify({ error: code }));
      }
    });
    return;
  }
  if (reqPath === '/npc-quest') {
    if (req.headers.origin && req.headers.origin !== `http://127.0.0.1:${PORT}` &&
        req.headers.origin !== `http://localhost:${PORT}`) {
      res.writeHead(403); res.end(); return;
    }
    void questHandler(req, res);
    return;
  }
  if (reqPath === '/npc-ai/decide') {
    if (!npcAiPilot || req.method !== 'POST' || req.headers['content-type']?.split(';')[0] !== 'application/json' ||
        req.headers.origin && req.headers.origin !== `http://127.0.0.1:${PORT}` && req.headers.origin !== `http://localhost:${PORT}`) {
      res.writeHead(404); res.end(); return;
    }
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 2048) req.destroy();
    });
    req.on('end', async () => {
      try {
        const userId = await verifyNpcAiUser(req.headers.authorization);
        if (!userId) {
          res.writeHead(401, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
          res.end(JSON.stringify({ error: 'PILOT_AUTH_REQUIRED' }));
          return;
        }
        const result = await npcAiPilot.decide(JSON.parse(body), userId);
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify(result));
      } catch (error) {
        const clientError = /^(INVALID_|NPC_OFF_ZONE|PILOT_)/u.test(error.message);
        const limited = error.message === 'PILOT_COOLDOWN' || error.message === 'PILOT_CALL_LIMIT';
        res.writeHead(limited ? 429 : clientError ? 400 : 503,
          { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify({ error: clientError ? error.message : 'NPC_AI_UNAVAILABLE' }));
        if (!clientError) console.warn('NPC AI pilot request failed:', error.message);
      }
    });
    return;
  }
  if (reqPath === "/campus" || reqPath === "/campus/") {
    reqPath = "/campus/index.html";
  } else if (reqPath === "/profile" || reqPath === "/profile/") {
    reqPath = "/profile/index.html";
  } else if (reqPath === "/editor" || reqPath === "/editor/") {
    reqPath = "/editor/index.html";
  } else if (reqPath === "/editor/music" || reqPath === "/editor/music/") {
    reqPath = "/editor/music/index.html";
  } else if (reqPath === "/worldforge" || reqPath === "/worldforge/") {
    reqPath = "/studio/index.html";
  } else if (reqPath === "/studio" || reqPath === "/studio/") {
    reqPath = "/studio/index.html";
  } else if (reqPath === "/") {
    reqPath = "/index.html";
  }

  const filePath = path.join(__dirname, reqPath);

  // Security: prevent directory traversal
  if (!filePath.startsWith(__dirname)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end(`Not found: ${reqPath}`);
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || "application/octet-stream";

    res.writeHead(200, {
      "Content-Type": contentType,
      "Cache-Control": "no-cache",
      "Access-Control-Allow-Origin": "*"
    });
    fs.createReadStream(filePath).pipe(res);
  });
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`INHAGAME dev server listening on http://127.0.0.1:${PORT}`);
});
