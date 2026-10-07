const $ = selector => document.querySelector(selector);
const status = $('#preview-status');
const phase = $('#preview-phase');
const buttons = [...document.querySelectorAll('[data-tier]')];
const results = $('#preview-results');
const raw = $('#preview-raw');
const copy = $('#preview-copy');
const device = $('#preview-device');
const mainMetrics = $('#preview-main-metrics');
const worker = new Worker(new URL('./recast-crowd-preview-worker.mjs', import.meta.url), { type: 'module' });

let readyMeta = null;
let running = false;
let monitor = null;
let lastEvidence = null;
let runStartedAt = 0;

function fmt(value, digits = 2) {
  return Number.isFinite(value) ? Number(value).toFixed(digits) : '—';
}

function setState(label, kind = '') {
  status.textContent = label;
  status.dataset.kind = kind;
}

function setButtons(enabled) {
  for (const button of buttons) button.disabled = !enabled;
}

function deviceSnapshot() {
  return {
    userAgent: navigator.userAgent,
    platform: navigator.platform,
    hardwareConcurrency: navigator.hardwareConcurrency ?? null,
    deviceMemoryGB: navigator.deviceMemory ?? null,
    language: navigator.language,
    viewport: `${innerWidth}×${innerHeight}`,
    dpr: devicePixelRatio
  };
}

function renderDevice() {
  const info = deviceSnapshot();
  device.innerHTML = `
    <div><strong>CPU 논리 코어</strong><span>${info.hardwareConcurrency ?? '미공개'}</span></div>
    <div><strong>메모리 힌트</strong><span>${info.deviceMemoryGB ? `${info.deviceMemoryGB} GB` : '미공개'}</span></div>
    <div><strong>Viewport</strong><span>${info.viewport} · DPR ${info.dpr}</span></div>
    <div class="wide"><strong>User Agent</strong><span>${info.userAgent}</span></div>`;
}

function beginMonitor() {
  const data = { frames: 0, maxFrameGapMs: 0, intervalTicks: 0, maxIntervalGapMs: 0, longTasks: [] };
  let active = true;
  let previousFrame;
  let previousTick = performance.now();
  let raf = 0;
  const frame = now => {
    if (!active) return;
    if (previousFrame !== undefined) data.maxFrameGapMs = Math.max(data.maxFrameGapMs, now - previousFrame);
    previousFrame = now;
    data.frames++;
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);
  const interval = setInterval(() => {
    const now = performance.now();
    data.maxIntervalGapMs = Math.max(data.maxIntervalGapMs, now - previousTick);
    previousTick = now;
    data.intervalTicks++;
  }, 16);
  let observer = null;
  try {
    observer = new PerformanceObserver(list => data.longTasks.push(...list.getEntries().map(entry => entry.duration)));
    observer.observe({ type: 'longtask', buffered: true });
  } catch {}
  return () => {
    active = false;
    cancelAnimationFrame(raf);
    clearInterval(interval);
    observer?.disconnect();
    return {
      frames: data.frames,
      maxFrameGapMs: data.maxFrameGapMs,
      intervalTicks: data.intervalTicks,
      maxIntervalGapMs: data.maxIntervalGapMs,
      longTaskCount: data.longTasks.length,
      maxLongTaskMs: data.longTasks.length ? Math.max(...data.longTasks) : 0
    };
  };
}

function renderTier(tier) {
  const budget = tier.meanFrameMs / (1000 / 60) * 100;
  return `<article class="result-card">
    <header><strong>${tier.agents} NPC</strong><span>${fmt(budget, 1)}% of 60fps frame</span></header>
    <div class="metric-grid">
      <div><b>${fmt(tier.meanFrameMs, 3)} ms</b><small>평균 / step</small></div>
      <div><b>${fmt(tier.p95FrameMs, 3)} ms</b><small>p95</small></div>
      <div><b>${fmt(tier.maxFrameMs, 3)} ms</b><small>최대</small></div>
      <div><b>${fmt(tier.setupMs, 2)} ms</b><small>Crowd setup</small></div>
      <div><b>${tier.overlapPairs}</b><small>겹침 pair</small></div>
      <div><b>${tier.invalidAgents}</b><small>invalid</small></div>
    </div>
    <p class="detail">Active ${tier.activeAgents}/${tier.agents} · Target ${tier.acceptedTargets}/${tier.agents} · 평균 이동 ${fmt(tier.meanDistanceMoved, 2)}</p>
  </article>`;
}

function renderEvidence(evidence) {
  results.innerHTML = evidence.worker.results.map(renderTier).join('');
  const m = evidence.mainThread;
  mainMetrics.innerHTML = `
    <div><b>${fmt(m.maxFrameGapMs, 2)} ms</b><small>최대 frame gap</small></div>
    <div><b>${fmt(m.maxIntervalGapMs, 2)} ms</b><small>최대 timer gap</small></div>
    <div><b>${m.longTaskCount}</b><small>Long Task</small></div>
    <div><b>${fmt(evidence.roundTripMs, 2)} ms</b><small>전체 왕복</small></div>`;
  raw.textContent = JSON.stringify(evidence, null, 2);
  copy.disabled = false;
}

function run(tiers) {
  if (!readyMeta || running) return;
  running = true;
  setButtons(false);
  copy.disabled = true;
  results.innerHTML = '<div class="loading-card">Worker에서 DetourCrowd를 계산하고 있어요…</div>';
  mainMetrics.innerHTML = '';
  raw.textContent = 'running';
  setState('RUNNING', 'running');
  phase.textContent = `${tiers.join(' → ')} NPC · 180 step · 60 Hz`; 
  monitor = beginMonitor();
  runStartedAt = performance.now();
  worker.postMessage({ type: 'RUN', tiers, steps: 180, dt: 1 / 60 });
}

worker.addEventListener('message', event => {
  const message = event.data ?? {};
  if (message.type === 'PHASE') {
    phase.textContent = message.label;
    return;
  }
  if (message.type === 'READY') {
    readyMeta = message.meta;
    setState('READY', 'ready');
    phase.textContent = `NPC ${readyMeta.population}명 · 이동쌍 ${readyMeta.movementPairs} · NavMesh ${(readyMeta.navMeshBytes / 1024 / 1024).toFixed(2)} MB · ${readyMeta.triangleCount.toLocaleString()} triangles`;
    setButtons(true);
    window.__INHA_NATIVE_P0C_READY__ = Object.freeze({ ...readyMeta });
    return;
  }
  if (message.type === 'RUN_PHASE') {
    phase.textContent = `${message.agents} NPC 계산 중…`;
    return;
  }
  if (message.type === 'RESULT') {
    const mainThread = monitor?.() ?? {};
    monitor = null;
    const evidence = {
      schema: 'inha.native-p0c.manual-device-evidence/1',
      capturedAt: new Date().toISOString(),
      device: deviceSnapshot(),
      readiness: readyMeta,
      roundTripMs: performance.now() - runStartedAt,
      mainThread,
      worker: message.result
    };
    lastEvidence = evidence;
    window.__INHA_NATIVE_P0C__ = Object.freeze(evidence);
    renderEvidence(evidence);
    running = false;
    setState('PASS', 'ready');
    phase.textContent = '완료 · 결과를 복사해 공유할 수 있어요.';
    setButtons(true);
    return;
  }
  if (message.type === 'ERROR') {
    monitor?.();
    monitor = null;
    running = false;
    setState('ERROR', 'error');
    phase.textContent = message.message ?? '알 수 없는 오류';
    raw.textContent = message.stack ?? message.message ?? 'ERROR';
    results.innerHTML = `<div class="error-card"><strong>실행 실패</strong><p>${message.message ?? '알 수 없는 오류'}</p></div>`;
    setButtons(Boolean(readyMeta));
  }
});

worker.addEventListener('error', event => {
  monitor?.();
  monitor = null;
  running = false;
  setState('WORKER ERROR', 'error');
  phase.textContent = event.message || 'Worker 로드 실패';
  setButtons(false);
});

for (const button of buttons) {
  button.addEventListener('click', () => {
    const value = button.dataset.tier;
    run(value === 'all' ? [48, 100, 200] : [Number(value)]);
  });
}

copy.addEventListener('click', async () => {
  if (!lastEvidence) return;
  try {
    await navigator.clipboard.writeText(JSON.stringify(lastEvidence, null, 2));
    copy.textContent = '복사됨 ✓';
    setTimeout(() => { copy.textContent = '결과 JSON 복사'; }, 1400);
  } catch {
    raw.hidden = false;
    raw.focus?.();
  }
});

$('#preview-toggle-raw').addEventListener('click', () => {
  raw.hidden = !raw.hidden;
});

window.addEventListener('resize', renderDevice);
window.addEventListener('pagehide', () => worker.terminate());
renderDevice();
setButtons(false);
copy.disabled = true;
worker.postMessage({ type: 'INIT' });
