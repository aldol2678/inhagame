import assert from 'node:assert/strict';
import { approvedChoicePrompt, createNpcAiPilot, groundedDialoguePrompt, pilotPrompt,
  validateApprovedChoice, validateGroundedDialogueOutput, validatePilotInput,
  validatePilotOutput } from './npc-ai-pilot.mjs';
import { createVertexNpcGenerator } from './npc-ai-vertex.mjs';
import { verifyNpcAiUser } from './npc-ai-auth.mjs';
import { createNpcAiQuota } from './npc-ai-quota.mjs';
import { createNpcAiCloudHandler } from './npc-ai-cloud-handler.mjs';
import { Readable } from 'node:stream';
import { createRequire } from 'node:module';

const valid = { npc_id: 'INKYUNG-NPC-001', period: 'lunch', trigger: 'topic', topic: 'architecture',
  prior_topic: null, available_actions: ['stay', 'look_at_player', 'walk_nearby', 'sit_at_bench'] };
const context = validatePilotInput(valid);
assert.equal(context.npc.identity.name, '나나율');
assert.ok(!context.allowed.includes('sit_at_bench'));
const prompt = pilotPrompt(context);
assert.ok(!prompt.includes('student_number'));
assert.match(prompt, /점심/);
assert.match(prompt, /정문/);
assert.match(prompt, /기다리는 중/);
assert.match(prompt, /건축/);
assert.match(prompt, /나나율/);
assert.match(prompt, /NPC 혼자 주변 안전 경로/);
const eveningContext = validatePilotInput({ ...valid, period: 'evening' });
assert.equal(eveningContext.slot.location, 'main_gate');
assert.match(pilotPrompt(eveningContext), /저녁/);
assert.match(pilotPrompt(eveningContext), /저녁에도 정문에서 만날 수 있어요/);
const secondContext = validatePilotInput({ ...valid, npc_id: 'INKYUNG-NPC-002',
  period: 'class_time', topic: 'photography' });
assert.equal(secondContext.slot.location, 'inkyung_photo_point');
assert.match(pilotPrompt(secondContext), /가유담/);
assert.throws(() => validatePilotInput({ ...valid, npc_id: 'INKYUNG-NPC-003' }), /INVALID_CONTEXT/);
assert.throws(() => validatePilotInput({ ...valid, topic: 'unknown' }), /INVALID_TOPIC/);
assert.throws(() => validatePilotInput({ ...valid, trigger: 'ambient', topic: null }), /INVALID_CONTEXT/);
assert.throws(() => validatePilotInput({ ...valid, available_actions: ['stay', 'change_world'] }), /INVALID_ACTIONS/);
assert.throws(() => validatePilotInput({ ...valid, follow_up: true }), /INVALID_FOLLOW_UP/);
assert.throws(() => validatePilotInput({ ...valid, follow_up: 'true' }), /INVALID_FOLLOW_UP/);
assert.throws(() => validatePilotOutput({ line: '좋아요', action: 'change_world' }, context.allowed), /INVALID_MODEL_OUTPUT/);
assert.throws(() => validatePilotOutput({ line: 'https://example.com', action: 'stay' }, context.allowed), /INVALID_MODEL_OUTPUT/);
const social = { ...valid, trigger: 'social', topic: null, available_actions: ['stay', 'look_at_player', 'walk_nearby'] };
const socialContext = validatePilotInput(social);
assert.equal(socialContext.socialSpot, '인경호 동쪽 벤치');
assert.deepEqual(socialContext.allowed, ['stay', 'look_at_player']);
assert.match(pilotPrompt(socialContext), /친구와 함께 할 수 있는 일/);
assert.match(pilotPrompt(socialContext), /인경호 동쪽 벤치/);
assert.equal(validatePilotInput({ ...social, npc_id: 'INKYUNG-NPC-002', period: 'lunch' }).socialSpot,
  '인경호 사진 지점');
assert.throws(() => validatePilotInput({ ...social, topic: 'architecture' }), /INVALID_TOPIC/);
assert.throws(() => validatePilotOutput({ line: '다른 데 가요.', action: 'stay' }, socialContext.allowed,
  socialContext.socialSpot), /INVALID_MODEL_OUTPUT/);
assert.throws(() => validatePilotOutput({ line: '인경호 동쪽 벤치에 가요.', action: 'walk_nearby' },
  socialContext.allowed, socialContext.socialSpot), /INVALID_MODEL_OUTPUT/);
assert.throws(() => validatePilotOutput({ line: '인경호 동쪽 벤치에서 친구 요청을 보낼게요.', action: 'stay' },
  socialContext.allowed, socialContext.socialSpot), /INVALID_MODEL_OUTPUT/);

let generated = 0, time = 10000;
const pilot = createNpcAiPilot({ generate: async (_prompt, allowed) => {
  generated++;
  assert.ok(allowed.includes('walk_nearby'));
  return { line: '이쪽 길을 잠깐 걸어볼까요?', action: 'walk_nearby' };
}, maxCalls: 1, now: () => time });
await assert.rejects(pilot.decide(valid), /PILOT_AUTH_REQUIRED/);
assert.deepEqual(await pilot.decide(valid, 'user-1'), {
  npc_id: valid.npc_id, line: '이쪽 길을 잠깐 걸어볼까요?', action: 'walk_nearby'
});
assert.equal((await pilot.decide(valid, 'user-1')).cached, true);
await assert.rejects(pilot.decide({ ...valid, prior_topic: 'architecture' }, 'user-1'), /PILOT_CALL_LIMIT/);
await assert.rejects(pilot.decide(valid, 'user-2'), /PILOT_CALL_LIMIT/);
assert.equal(generated, 1);

const socialPilot = createNpcAiPilot({ generate: () => { throw Error('social must not call Gemini'); },
  beforeGenerate: () => { throw Error('social must not claim quota'); }, maxCalls: 0 });
assert.deepEqual(await socialPilot.decide(social, 'user-1'), {
  npc_id: social.npc_id, line: '친구와 인경호 동쪽 벤치에서 잠깐 쉬어 봐요.', action: 'stay'
});
assert.equal((await socialPilot.decide({ ...social, npc_id: 'INKYUNG-NPC-002', period: 'lunch' }, 'user-1')).line,
  '친구와 인경호 사진 지점에서 사진 한 장 남겨 봐요.');
await assert.rejects(socialPilot.decide(valid, 'user-1'), /PILOT_CALL_LIMIT/);

const choicePrompt = approvedChoicePrompt(context);
assert.match(choicePrompt, /APPROVED_LINES=/);
assert.ok(!choicePrompt.includes('student_number'));
assert.deepEqual(validateApprovedChoice({ choice: '1' }, context), {
  line: '건물의 모양을 천천히 살펴보는 걸 좋아해요.', action: 'stay'
});
assert.equal(validateApprovedChoice({ choice: '0', line: '보상을 줄게요.' }, context).line,
  '인경호를 걸으면 건물의 선이 눈에 들어와요.');
assert.throws(() => validateApprovedChoice({ choice: '7' }, context), /INVALID_MODEL_OUTPUT/);
let claimed = 0, selected = 0;
const approvedPilot = createNpcAiPilot({ mode: 'approved', now: () => time, cooldownMs: 0,
  beforeGenerate: async userId => { assert.equal(userId, 'user-1'); claimed++; },
  generate: async (_prompt, options) => { selected++; assert.deepEqual(options, ['0', '1']); return { choice: '0' }; } });
assert.equal((await approvedPilot.decide(valid, 'user-1')).action, 'stay');
assert.equal((await approvedPilot.decide(valid, 'user-1')).cached, true);
assert.equal(claimed, 1);
assert.equal(selected, 1);
const groundedContext = validatePilotInput({ ...valid, follow_up: true, prior_topic: 'architecture' });
assert.match(groundedDialoguePrompt(groundedContext), /나나율/);
assert.match(groundedDialoguePrompt(groundedContext), /조금 더 들려주세요/);
assert.deepEqual(validateGroundedDialogueOutput({ line: '점심에는 건축의 선을 천천히 살펴봐요.', action: 'stay' },
  groundedContext), { line: '점심에는 건축의 선을 천천히 살펴봐요.', action: 'stay' });
assert.throws(() => validateGroundedDialogueOutput({ line: '요리가 좋아요.', action: 'stay' },
  groundedContext), /INVALID_MODEL_OUTPUT/);
assert.throws(() => validateGroundedDialogueOutput({ line: '점심에 건축 퀘스트 보상을 드려요.', action: 'stay' },
  groundedContext), /INVALID_MODEL_OUTPUT/);
assert.throws(() => validateGroundedDialogueOutput({ line: '점심에는 건축을 봐요.', action: 'walk_nearby' },
  groundedContext), /INVALID_MODEL_OUTPUT/);
const groundedSecond = validatePilotInput({ ...valid, npc_id: 'INKYUNG-NPC-002', topic: 'photography' });
assert.match(groundedDialoguePrompt(groundedSecond), /가유담/);
assert.deepEqual(validateGroundedDialogueOutput({ line: '인경호 사진 지점에서 사진 구도를 살펴봐요.', action: 'stay' },
  groundedSecond), { line: '인경호 사진 지점에서 사진 구도를 살펴봐요.', action: 'stay' });
for (const [npcId, topic, name, place] of [
  ['INKYUNG-NPC-001', 'architecture', '나나율', '정문'],
  ['INKYUNG-NPC-002', 'photography', '가유담', '인경호 사진 지점']
]) {
  for (const period of ['morning', 'class_time', 'lunch', 'evening']) {
    const current = validatePilotInput({ ...valid, npc_id: npcId, topic, period });
    const text = groundedDialoguePrompt(current);
    assert.match(text, new RegExp(name));
    assert.match(text, new RegExp(place));
    assert.match(text, /NPC 행동은 stay만/);
  }
}
let groundedCalls = 0;
const groundedPilot = createNpcAiPilot({ mode: 'grounded', cooldownMs: 0, now: () => time,
  generate: async (text, allowed) => {
    groundedCalls++;
    assert.deepEqual(allowed, ['stay']);
    assert.match(text, groundedCalls === 1 ? /이야기를 해요/ : /조금 더 들려주세요/);
    return { line: '점심에는 건축의 선을 천천히 살펴봐요.', action: 'stay' };
  } });
assert.equal((await groundedPilot.decide(valid, 'user-1')).action, 'stay');
assert.equal((await groundedPilot.decide(valid, 'user-1')).cached, true);
await groundedPilot.decide({ ...valid, prior_topic: 'architecture', follow_up: true }, 'user-1');
assert.equal(groundedCalls, 2);
await assert.rejects(groundedPilot.decide({ ...valid, follow_up: true }, 'user-1'), /INVALID_FOLLOW_UP/);
const deniedPilot = createNpcAiPilot({ mode: 'approved', beforeGenerate: async () => {
  throw Error('PILOT_GLOBAL_DAILY_LIMIT');
}, generate: () => { throw Error('must not generate after quota denial'); } });
await assert.rejects(deniedPilot.decide(valid, 'user-1'), /PILOT_GLOBAL_DAILY_LIMIT/);
assert.equal(deniedPilot.calls, 0);

let cooldownCalls = 0;
const cooldownPilot = createNpcAiPilot({ generate: async () => {
  cooldownCalls++;
  return { line: '잠깐 쉬었다가 다시 걸어요.', action: 'stay' };
}, maxCalls: 2, now: () => time });
await cooldownPilot.decide(valid, 'user-1');
await assert.rejects(cooldownPilot.decide(valid, 'user-2'), /PILOT_COOLDOWN/);
assert.equal(cooldownCalls, 1);
time += 5000;
await cooldownPilot.decide(valid, 'user-2');
assert.equal(cooldownCalls, 2);

assert.equal(await verifyNpcAiUser(undefined, () => { throw Error('should not fetch'); }), null);
const jwt = 'x'.repeat(20);
const authUserId = '11111111-1111-4111-8111-111111111111';
let authRequest;
assert.equal(await verifyNpcAiUser(`Bearer ${jwt}`, async (url, options) => {
  authRequest = { url, options };
  return { ok: true, json: async () => ({ id: authUserId, is_anonymous: false }) };
}), authUserId);
assert.match(authRequest.url, /\/auth\/v1\/user$/);
assert.equal(authRequest.options.headers.Authorization, `Bearer ${jwt}`);
assert.equal(await verifyNpcAiUser(`Bearer ${jwt}`, async () => ({ ok: true,
  json: async () => ({ id: 'guest', is_anonymous: true }) })), null);
assert.equal(await verifyNpcAiUser(`Bearer ${jwt}`, async () => ({ ok: true,
  json: async () => ({ id: authUserId }) })), null);
assert.equal(await verifyNpcAiUser(`Bearer ${jwt}`, async () => ({ status: 401, ok: false })), null);

let sent;
const vertex = createVertexNpcGenerator({ project: 'public-qa-example', tokenProvider: () => 'test-token',
  fetcher: async (url, options) => {
    sent = { url, options };
    return { ok: true, json: async () => ({ candidates: [{ finishReason: 'STOP', content: { parts: [
      { text: '{"line":"인경호를 천천히 걸어볼까요?","action":"stay"}' }
    ] } }] }) };
  } });
assert.deepEqual(await vertex('test prompt', ['stay']), { line: '인경호를 천천히 걸어볼까요?', action: 'stay' });
assert.match(sent.url, /projects\/public-qa-example\/locations\/global/);
assert.deepEqual(JSON.parse(sent.options.body).generationConfig.responseSchema.properties.action.enum, ['stay']);
assert.equal(sent.options.headers.Authorization, 'Bearer test-token');
const choiceVertex = createVertexNpcGenerator({ project: 'public-qa-example', choiceMode: true,
  tokenProvider: () => 'test-token', fetcher: async (_url, options) => {
    sent = { options };
    return { ok: true, json: async () => ({ candidates: [{ finishReason: 'STOP', content: {
      parts: [{ text: '{"choice":"0"}' }] } }] }) };
  } });
assert.deepEqual(await choiceVertex('choose', ['0', '1']), { choice: '0' });
assert.deepEqual(JSON.parse(sent.options.body).generationConfig.responseSchema.properties.choice.enum, ['0', '1']);

let quotaRequest;
const quota = createNpcAiQuota({ serviceRoleKey: 'server-test-key', fetcher: async (url, options) => {
  quotaRequest = { url, options };
  return { ok: true, json: async () => 'OK' };
} });
await quota('user-1');
assert.match(quotaRequest.url, /claim_world_npc_ai_call_v1$/);
assert.equal(JSON.parse(quotaRequest.options.body).p_user, 'user-1');
assert.equal(quotaRequest.options.headers.Authorization, 'Bearer server-test-key');
await assert.rejects(createNpcAiQuota({ serviceRoleKey: 'x', fetcher: async () => ({ ok: true,
  json: async () => 'USER_LIMIT' }) })('user-1'), /PILOT_USER_DAILY_LIMIT/);

async function cloudRequest(body, verifiedUser = 'user-1', selectedPilot = approvedPilot) {
  const request = Readable.from([JSON.stringify(body)]);
  request.method = 'POST'; request.headers = { 'content-type': 'application/json', authorization: `Bearer ${jwt}` };
  const response = { status: null, headers: {}, body: '',
    setHeader(name, value) { this.headers[name] = value; },
    writeHead(status) { this.status = status; },
    end(value = '') { this.body = value; } };
  const handler = createNpcAiCloudHandler({ pilot: selectedPilot, verifyUser: async () => verifiedUser });
  await handler(request, response);
  return response;
}
assert.equal((await cloudRequest(valid, null)).status, 401);
assert.equal((await cloudRequest({ ...valid, npc_id: 'INKYUNG-NPC-003' })).status, 400);
assert.equal(JSON.parse((await cloudRequest({ ...valid, available_actions: ['change_world'] })).body).action, 'stay');
assert.equal((await cloudRequest(valid, 'user-1', { decide: async () => {
  throw Error('INVALID_MODEL_OUTPUT');
} })).status, 503);
const limitedRequest = Readable.from([JSON.stringify(valid)]);
limitedRequest.method = 'POST'; limitedRequest.headers = { 'content-type': 'application/json', authorization: `Bearer ${jwt}` };
const limitedResponse = { status: null, setHeader() {}, writeHead(status) { this.status = status; },
  end(value) { this.body = value; } };
await createNpcAiCloudHandler({ pilot: { decide: async () => { throw Error('PILOT_USER_DAILY_LIMIT'); } },
  verifyUser: async () => authUserId })(limitedRequest, limitedResponse);
assert.equal(limitedResponse.status, 429);

process.env.NPC_AI_ENABLED = '1';
process.env.NPC_AI_CLOUD_RUN_URL = 'https://npc.example.run.app';
const gateway = createRequire(import.meta.url)('../api/npc-ai.js');
const gatewayResponse = () => ({ statusCode: 200, body: null, headers: {},
  setHeader(name, value) { this.headers[name] = value; },
  status(code) { this.statusCode = code; return this; },
  json(value) { this.body = value; return this; },
  end() { return this; } });
const statusResponse = gatewayResponse();
await gateway({ method: 'GET', headers: {} }, statusResponse);
assert.deepEqual(statusResponse.body, { enabled: true });
const deniedResponse = gatewayResponse();
await gateway({ method: 'POST', headers: { 'content-type': 'application/json', host: 'inhagame.example',
  origin: 'https://other.example', authorization: `Bearer ${jwt}` }, body: valid }, deniedResponse);
assert.equal(deniedResponse.statusCode, 403);
const fetchBefore = globalThis.fetch;
let forwarded;
globalThis.fetch = async (url, options) => { forwarded = { url, options }; return { status: 200,
  json: async () => ({ npc_id: valid.npc_id, line: '승인 대사', action: 'stay' }) }; };
try {
  const okResponse = gatewayResponse();
  await gateway({ method: 'POST', headers: { 'content-type': 'application/json', host: 'inhagame.example',
    origin: 'https://inhagame.example', authorization: `Bearer ${jwt}` }, body: valid }, okResponse);
  assert.equal(okResponse.statusCode, 200);
  assert.equal(forwarded.url, 'https://npc.example.run.app');
  assert.equal(forwarded.options.headers.Authorization, `Bearer ${jwt}`);
} finally { globalThis.fetch = fetchBefore; delete process.env.NPC_AI_ENABLED; delete process.env.NPC_AI_CLOUD_RUN_URL; }
const requireGateway = createRequire(import.meta.url);
delete requireGateway.cache[requireGateway.resolve('../api/npc-ai.js')];
const disabledGateway = requireGateway('../api/npc-ai.js');
const disabledResponse = gatewayResponse();
await disabledGateway({ method: 'GET', headers: {} }, disabledResponse);
assert.equal(disabledResponse.statusCode, 404);
console.log('NPC AI pilot contract, call cap, and Vertex request: PASS');
