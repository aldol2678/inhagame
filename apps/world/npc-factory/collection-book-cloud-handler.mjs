// Native Node HTTP adapter for the existing self-only read service. No account writes.
import { verifyNpcAiUser } from './npc-ai-auth.mjs';
import { SUPABASE_URL } from '../src/config/supabase-public-config.mjs';
import { createCollectionBookApiHandler, createCollectionBookService, createCollectionBookRpc } from '../server/collection-book-service.mjs';

export function createCollectionBookCloudHandler({ verifyUser = verifyNpcAiUser,
  rpc = createCollectionBookRpc({ url: SUPABASE_URL, serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY }) } = {}) {
  const handler = createCollectionBookApiHandler({ service: createCollectionBookService({ verifyUser, rpc }) });
  return async (req, res) => {
    // node:http has no parsed req.body. Reject all nonempty/streamed GET framing before auth.
    // A zero Content-Length is the only accepted framing; no request stream is buffered.
    if (req.method === 'GET' && (req.headers['transfer-encoding'] !== undefined ||
        (req.headers['content-length'] !== undefined && req.headers['content-length'] !== '0'))) {
      res.setHeader('Cache-Control', 'private, no-store');
      res.setHeader('Vary', 'Authorization');
      res.writeHead(400); res.end(); return;
    }
    const adapted = {
      setHeader: (name, value) => res.setHeader(name, value),
      status(code) { res.statusCode = code; return this; },
      end() { res.writeHead(res.statusCode); res.end(); },
      json(body) { res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.writeHead(res.statusCode); res.end(JSON.stringify(body)); }
    };
    return handler(req, adapted);
  };
}
