import http from 'node:http';
import { createNpcAiCloudHandler } from './npc-ai-cloud-handler.mjs';
import { createNpcAiPilot } from './npc-ai-pilot.mjs';
import { createNpcAiQuota } from './npc-ai-quota.mjs';
import { createVertexNpcGenerator } from './npc-ai-vertex.mjs';
import { createQuestCloudHandler } from './quest-cloud-handler.mjs';
import { createSupabaseQuestStore } from './quest-store.mjs';

// Container entrypoint for apps/world/Dockerfile. The deployment supplies the project and the
// server-only credential; nothing here names a specific cloud project.
if (process.env.NPC_AI_ENABLED !== '1' || !/^[a-z][a-z0-9-]{4,61}[a-z0-9]$/.test(process.env.NPC_AI_PROJECT ?? '')
    || !process.env.SUPABASE_SERVICE_ROLE_KEY)
  throw Error('NPC_AI_PRODUCTION_CONFIG_REQUIRED');

async function cloudRunAccessToken() {
  const response = await fetch('http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token', {
    headers: { 'Metadata-Flavor': 'Google' }, signal: AbortSignal.timeout(3000)
  });
  if (!response.ok) throw Error('NPC_AI_SERVICE_IDENTITY_UNAVAILABLE');
  const token = (await response.json()).access_token;
  if (typeof token !== 'string' || !token) throw Error('NPC_AI_SERVICE_IDENTITY_UNAVAILABLE');
  return token;
}

const pilot = createNpcAiPilot({
  mode: 'grounded', maxCalls: 50, cooldownMs: 0,
  beforeGenerate: createNpcAiQuota({ serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY }),
  generate: createVertexNpcGenerator({ project: process.env.NPC_AI_PROJECT,
    tokenProvider: cloudRunAccessToken })
});
const aiHandler = createNpcAiCloudHandler({ pilot });
const questHandler = createQuestCloudHandler({ store: createSupabaseQuestStore({
  serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY }) });
http.createServer((req, res) => req.url?.split('?')[0] === '/quest'
  ? questHandler(req, res) : aiHandler(req, res)).listen(Number(process.env.PORT || 8080), '0.0.0.0');
