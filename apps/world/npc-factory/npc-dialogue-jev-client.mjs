import { validateNpcDialogueDecision } from './npc-dialogue-context.mjs';
import { JEV_DIALOGUE_PILOT_IDS } from './npc-jev-router.mjs';

const PILOT_IDS = new Set(JEV_DIALOGUE_PILOT_IDS);

function fallbackDecision(baseline, reason, latencyMs = 0) {
  return Object.freeze({
    responseSource: baseline.responseSource,
    intent: baseline.intent,
    contextPriority: baseline.contextPriorities?.[0] ?? null,
    provider: 'DETERMINISTIC_BASELINE',
    role: 'EXPERIMENT_ONLY',
    authorityEffect: 'NONE',
    fallbackReason: reason,
    latencyMs
  });
}

function keyFor(context, candidates) {
  return JSON.stringify([
    context.identity.npcId,
    context.current,
    context.world,
    context.memory,
    context.social,
    context.quest,
    context.turn,
    context.generationAllowed,
    candidates
  ]);
}

export function createNpcJevDialogueRouter({
  enabled = false,
  endpoint = '/api/npc-dialogue-route',
  getSession = async () => null,
  fetcher = fetch,
  timeoutMs = 2200,
  cacheMs = 60000,
  now = Date.now
} = {}) {
  const cache = new Map();
  const inFlight = new Map();
  const stats = {
    attempts: 0,
    accepted: 0,
    fallbacks: 0,
    cacheHits: 0,
    lastLatencyMs: null,
    lastProvider: 'DETERMINISTIC_BASELINE',
    lastReason: null,
    lastConfidence: null
  };

  function remember(result) {
    stats.lastLatencyMs = result.latencyMs ?? null;
    stats.lastProvider = result.provider;
    stats.lastReason = result.fallbackReason ?? null;
    stats.lastConfidence = result.confidence ?? null;
    if (result.provider === 'JEV') stats.accepted += 1;
    else stats.fallbacks += 1;
    return result;
  }

  async function route({ context, candidates, baseline }) {
    if (!enabled) return fallbackDecision(baseline, 'DISABLED');
    if (!PILOT_IDS.has(context?.identity?.npcId)) return fallbackDecision(baseline, 'NON_PILOT_NPC');
    const cacheKey = keyFor(context, candidates);
    const hit = cache.get(cacheKey);
    if (hit && now() - hit.at < cacheMs) {
      stats.cacheHits += 1;
      return hit.result;
    }
    if (inFlight.has(cacheKey)) return inFlight.get(cacheKey);

    const promise = (async () => {
      const started = now();
      let token;
      try { token = await getSession(); }
      catch { return remember(fallbackDecision(baseline, 'AUTH_UNAVAILABLE', now() - started)); }
      if (!token) return remember(fallbackDecision(baseline, 'AUTH_REQUIRED', now() - started));
      stats.attempts += 1;
      try {
        const response = await fetcher(endpoint, {
          method: 'POST',
          signal: AbortSignal.timeout(timeoutMs),
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ npcId: context.identity.npcId, context })
        });
        const latencyMs = now() - started;
        if (!response.ok) return remember(fallbackDecision(baseline, `HTTP_${response.status}`, latencyMs));
        const payload = await response.json();
        if (payload?.role !== 'EXPERIMENT_ONLY' || payload?.authorityEffect !== 'NONE' ||
            !validateNpcDialogueDecision(payload.decision, candidates)) {
          return remember(fallbackDecision(baseline, 'INVALID_DECISION', latencyMs));
        }
        const result = Object.freeze({
          ...payload.decision,
          provider: 'JEV',
          role: 'EXPERIMENT_ONLY',
          authorityEffect: 'NONE',
          model: payload.model ?? null,
          confidence: payload.confidence ?? null,
          probabilities: payload.probabilities ?? null,
          serverLatencyMs: Number.isFinite(payload.shadow?.latencyMs) ? payload.shadow.latencyMs : null,
          disagreement: {
            responseSource: payload.decision.responseSource !== baseline.responseSource,
            intent: payload.decision.intent !== baseline.intent,
            contextPriority: payload.decision.contextPriority !== (baseline.contextPriorities?.[0] ?? null)
          },
          latencyMs,
          fallbackReason: null
        });
        remember(result);
        cache.set(cacheKey, { at: now(), result });
        return result;
      } catch (error) {
        const reason = error?.name === 'TimeoutError' || error?.name === 'AbortError' ? 'TIMEOUT' : 'NETWORK_ERROR';
        return remember(fallbackDecision(baseline, reason, now() - started));
      } finally {
        inFlight.delete(cacheKey);
      }
    })();
    inFlight.set(cacheKey, promise);
    return promise;
  }

  return Object.freeze({
    route,
    status: () => Object.freeze({ enabled: Boolean(enabled), pilotNpcIds: JEV_DIALOGUE_PILOT_IDS, ...stats })
  });
}
