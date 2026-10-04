import { startRecastWorker } from './recast-npc-worker-client.mjs';

const output = document.getElementById('recast-poc-output');
const status = document.getElementById('recast-poc-status');
const cancel = document.getElementById('recast-poc-cancel');
const restart = document.getElementById('recast-poc-restart');
const options = new URLSearchParams(location.search);
const phases = { population: '현행 NPC 데이터를 읽는 중…', artifact: '사전 생성 데이터를 검증하는 중…',
  navigator: 'Recast 경로 데이터를 준비하는 중…', schedule: '현행 스케줄과 legacy 경로를 비교하는 중…' };
let active, generation = 0;

async function run() {
  const current = ++generation;
  active?.cancel();
  delete window.__RECAST_NPC_POC__;
  status.textContent = '평가 준비 중…';
  output.textContent = 'loading';
  cancel.disabled = false;
  restart.disabled = options.get('execution') === 'main';
  let result;
  if (options.get('execution') === 'main') {
    // Explicit diagnostic baseline, never an automatic Worker fallback.
    cancel.disabled = true;
    try {
      const { runRecastEvaluation } = await import('./recast-npc-evaluation.mjs');
      result = await runRecastEvaluation({ prebuiltMode: options.get('navMesh') !== 'runtime',
        onPhase: phase => { if (current === generation) status.textContent = phases[phase] ?? phase; } });
    } catch (error) { result = { verdict: 'ERROR', message: error?.message ?? String(error), stack: error?.stack ?? null }; }
  } else {
    active = startRecastWorker({ prebuiltMode: options.get('navMesh') !== 'runtime',
      onPhase: phase => { if (current === generation) status.textContent = phases[phase] ?? phase; } });
    result = await active.promise;
  }
  if (current !== generation) return;
  active = null;
  cancel.disabled = true;
  restart.disabled = false;
  window.__RECAST_NPC_POC__ = Object.freeze(result);
  status.textContent = result.eligibleLegs !== undefined
    ? `${result.verdict} · Recast ${result.recastRoutes}/${result.eligibleLegs} 경로 · NPC ${result.population}명`
    : `${result.verdict} · ${result.message}`;
  output.textContent = JSON.stringify(result, null, 2);
}
cancel.addEventListener('click', () => active?.cancel());
restart.addEventListener('click', run);
window.addEventListener('pagehide', () => { ++generation; active?.cancel(); active = null; });
window.addEventListener('pageshow', event => { if (event.persisted) run(); });
run();
