import { verifyNpcAiUser } from './npc-ai-auth.mjs';

export function createNpcAiCloudHandler({ pilot, verifyUser = verifyNpcAiUser }) {
  return async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    if (req.method !== 'POST' || req.headers['content-type']?.split(';')[0] !== 'application/json') {
      res.writeHead(404); res.end(); return;
    }
    try {
      let body = '';
      for await (const chunk of req) {
        body += chunk;
        if (body.length > 2048) throw Error('INVALID_INPUT');
      }
      const userId = await verifyUser(req.headers.authorization);
      if (!userId) throw Error('PILOT_AUTH_REQUIRED');
      const input = JSON.parse(body);
      if (!input || typeof input !== 'object' || Array.isArray(input)) throw Error('INVALID_INPUT');
      // First release is dialogue only. The browser cannot authorize an NPC movement.
      input.available_actions = ['stay'];
      const result = await pilot.decide(input, userId);
      res.writeHead(200); res.end(JSON.stringify(result));
    } catch (error) {
      const denied = error.message === 'PILOT_AUTH_REQUIRED';
      const limited = /^PILOT_.*LIMIT$/u.test(error.message);
      const invalid = /^(INVALID_(?!MODEL_OUTPUT)|NPC_OFF_ZONE)/u.test(error.message) || error instanceof SyntaxError;
      const status = denied ? 401 : limited ? 429 : invalid ? 400 : 503;
      res.writeHead(status);
      res.end(JSON.stringify({ error: denied ? 'PILOT_AUTH_REQUIRED' : limited ? error.message :
        invalid ? 'INVALID_INPUT' : 'NPC_AI_UNAVAILABLE' }));
    }
  };
}
