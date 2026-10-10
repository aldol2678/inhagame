import { verifyNpcAiUser } from './npc-ai-auth.mjs';
import { NPC_RELATIONSHIP_DIALOGUE_EVENT } from './npc-player-relationship-client.mjs';
import { NPC_RELATIONSHIP_REGISTRY } from './npc-player-relationship-registry.mjs';

export function createNpcRelationshipCloudHandler({ store, verifyUser = verifyNpcAiUser }) {
  if (typeof store !== 'function') throw new TypeError('NPC relationship store is required');
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
        if (body.length > 256) throw Error('INVALID_NPC_RELATIONSHIP_EVENT');
      }
      const userId = await verifyUser(req.headers.authorization);
      if (!userId) throw Error('NPC_RELATIONSHIP_AUTH_REQUIRED');
      const input = JSON.parse(body);
      const keys = input && typeof input === 'object' && !Array.isArray(input) ? Object.keys(input) : [];
      if (keys.length !== 2 || typeof input.npcId !== 'string' ||
          !NPC_RELATIONSHIP_REGISTRY.has(input.npcId) ||
          !Object.values(NPC_RELATIONSHIP_DIALOGUE_EVENT).includes(input.event))
        throw Error('INVALID_NPC_RELATIONSHIP_EVENT');
      const result = await store(userId, input.npcId, input.event);
      res.writeHead(200); res.end(JSON.stringify(result));
    } catch (error) {
      const code = String(error?.message ?? '');
      const status = code === 'NPC_RELATIONSHIP_AUTH_REQUIRED' ? 401 :
        code === 'INVALID_NPC_RELATIONSHIP_EVENT' || code === 'NPC_RELATIONSHIP_NPC_NOT_ALLOWED' ||
        error instanceof SyntaxError ? 400 : 503;
      res.writeHead(status);
      res.end(JSON.stringify({ error: status === 401 ? 'NPC_RELATIONSHIP_AUTH_REQUIRED' :
        status === 400 ? 'INVALID_NPC_RELATIONSHIP_EVENT' : 'NPC_RELATIONSHIP_UNAVAILABLE' }));
    }
  };
}
