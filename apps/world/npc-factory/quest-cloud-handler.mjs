import { verifyNpcAiUser } from './npc-ai-auth.mjs';
import { QUEST_ID, QUEST_EVENTS } from './quest-contract.mjs';
import { MAIN2_QUEST_ID, MAIN2_QUEST_EVENTS } from './main2-quest-contract.mjs';
import { MCM_2026_EVENT_ID, MCM_2026_EVENT_ACTIONS } from './mcm-2026-event-contract.mjs';

export function createQuestCloudHandler({ store, verifyUser = verifyNpcAiUser }) {
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
        if (body.length > 256) throw Error('INVALID_QUEST_EVENT');
      }
      const userId = await verifyUser(req.headers.authorization);
      if (!userId) throw Error('QUEST_AUTH_REQUIRED');
      const input = JSON.parse(body);
      if (!input || typeof input !== 'object' || Array.isArray(input)) throw Error('INVALID_QUEST_EVENT');
      const questId = input.quest_id ?? QUEST_ID;
      const keys = Object.keys(input);
      if ((questId === QUEST_ID && (keys.length !== 1 || !QUEST_EVENTS.includes(input.event))) ||
          (questId === MAIN2_QUEST_ID && (keys.length !== 2 || !MAIN2_QUEST_EVENTS.includes(input.event))) ||
          (questId === MCM_2026_EVENT_ID && (keys.length !== 2 || !MCM_2026_EVENT_ACTIONS.includes(input.event))) ||
          (questId !== QUEST_ID && questId !== MAIN2_QUEST_ID && questId !== MCM_2026_EVENT_ID))
        throw Error('INVALID_QUEST_EVENT');
      const result = await store(userId, input.event, questId);
      res.writeHead(200); res.end(JSON.stringify(result));
    } catch (error) {
      const status = error.message === 'QUEST_AUTH_REQUIRED' ? 401 :
        error.message === 'INVALID_QUEST_EVENT' || error instanceof SyntaxError ? 400 : 503;
      res.writeHead(status);
      res.end(JSON.stringify({ error: status === 401 ? 'QUEST_AUTH_REQUIRED' :
        status === 400 ? 'INVALID_QUEST_EVENT' : 'QUEST_UNAVAILABLE' }));
    }
  };
}
