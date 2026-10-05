import { validateDevCandidate } from './dev-runtime-state.mjs';
import { validateDevRoster } from './dev-appearance.mjs';
import { applyCampusLifeSchedule } from './npc-campus-life-policy.mjs';
import { mergeCampusPopulation } from './npc-campus-expansion.mjs';

export const NPC_POPULATION_URLS = Object.freeze({
  candidate: '/npc-factory/data/repaired/INKYUNG-20-A-R1.json',
  decision: '/npc-factory/data/fixtures/public-fixture.json',
  roster: '/npc-factory/data/fixtures/public-roster.json',
  expansion: '/npc-factory/data/expansion/CAMPUS-28-P2A.json'
});

const sha256Hex = async bytes => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
  .map(b => b.toString(16).padStart(2, '0')).join('');
const defaultWait = ms => new Promise(resolve => setTimeout(resolve, ms));

// CORE-15: the base 20 (which holds both first-walk quest NPCs) is required; a network failure on it
// is retried on retryDelays. The CAMPUS-28 expansion is optional: if it cannot be fetched or does not
// merge, the runtime starts with the base 20 and reports the expansion as UNAVAILABLE. Integrity
// failures (hash, decision, validation) are never retried.
export async function loadNpcPopulation({ fetcher = fetch, urls = NPC_POPULATION_URLS,
  retryDelays = [1000, 3000], wait = defaultWait, onExpansionError = () => {} } = {}) {
  const expansionJson = fetcher(urls.expansion)
    .then(response => response.ok ? response.json() : Promise.reject(Error(`HTTP ${response.status}`)))
    .catch(error => ({ error }));
  let required;
  for (let attempt = 0; ; attempt++) {
    try {
      const responses = await Promise.all([urls.candidate, urls.decision, urls.roster].map(url => fetcher(url)));
      if (responses.some(response => !response.ok)) throw Error('NPC base candidate, decision or roster unavailable');
      required = responses;
      break;
    } catch (error) {
      if (attempt >= retryDelays.length) throw error;
      await wait(retryDelays[attempt]);
    }
  }
  const [candidateResponse, decisionResponse, rosterResponse] = required;
  const bytes = await candidateResponse.arrayBuffer();
  const hash = await sha256Hex(bytes);
  const decision = await decisionResponse.json();
  if (decision.candidate_sha256 !== hash || decision.npc_count !== 20 ||
      decision.kind !== 'SYNTHETIC_PUBLIC_QA' || decision.human_approval !== false) throw new Error('Public QA fixture/hash mismatch');
  const sourceBatch = validateDevCandidate(JSON.parse(new TextDecoder().decode(bytes)));
  const baseRoster = validateDevRoster(sourceBatch, await rosterResponse.json(), hash);

  const expansion = await expansionJson;
  if (!expansion?.error) {
    try {
      const merged = mergeCampusPopulation(sourceBatch, baseRoster, expansion);
      return { batch: validateDevCandidate(merged.batch), roster: merged.roster, hash, expansion: 'READY' };
    } catch (error) {
      onExpansionError(error);
    }
  } else {
    onExpansionError(expansion.error);
  }
  const batch = validateDevCandidate(applyCampusLifeSchedule(sourceBatch, baseRoster));
  return { batch, roster: baseRoster, hash, expansion: 'UNAVAILABLE' };
}
