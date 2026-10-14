// Fixed public fields only. Never retain an Error, event, account, or broad debug snapshot.
export const RUNTIME_ERROR_LABELS = Object.freeze({
  RUNTIME_SCRIPT_ERROR: '게임 실행 중 오류가 감지됐어요.',
  RUNTIME_PROMISE_REJECTION: '일부 작업을 완료하지 못했어요.',
  RENDERER_DEVICE_LOST: '그래픽 연결이 끊겼어요. 복구를 기다려 주세요.',
  NETWORK_OFFLINE: '네트워크 연결을 확인해 주세요. 로컬 플레이는 계속할 수 있어요.',
  NETWORK_RECONNECTING: '온라인 연결을 다시 시도하고 있어요.',
  DIAGNOSTICS_READ_FAILED: '일부 상태를 읽지 못했어요. 새로고침해 주세요.'
});
export const MAX_RUNTIME_ERRORS = 10;
const pick = (value, allowed, fallback = 'UNKNOWN') => allowed.includes(value) ? value : fallback;
export const normalizeBuildId = value => typeof value === 'string' && /^[a-f0-9]{40}$/.test(value) ? value : 'development';

export function createRuntimeDiagnostics({ readState = () => ({}), publicZoneIds = [],
  buildId = 'development', now = () => performance.now() } = {}) {
  const zones = new Set(publicZoneIds);
  let errors = [], previousNetwork = null, lost = false;
  let start = null, lastFrame = null, frames = 0, fps = null, frameTimeMs = null;
  const record = code => {
    if (typeof code !== 'string' || !Object.hasOwn(RUNTIME_ERROR_LABELS, code)) return false;
    if (errors.at(-1) !== code) errors = [...errors, code].slice(-MAX_RUNTIME_ERRORS);
    return true;
  };
  const resetFrames = () => { start = lastFrame = fps = frameTimeMs = null; frames = 0; };
  const frame = () => {
    if (lost) return;
    const time = now();
    if (!Number.isFinite(time)) return;
    if (lastFrame !== null && (time < lastFrame || time - lastFrame > 5000)) resetFrames();
    lastFrame = time;
    if (start === null) { start = time; return; }
    frames++;
    const elapsed = time - start;
    if (elapsed >= 1000) {
      fps = Math.round(frames * 10000 / elapsed) / 10;
      frameTimeMs = Math.round(elapsed * 10 / frames) / 10;
      start = time; frames = 0;
    }
  };
  const snapshot = () => {
    let renderer = 'UNKNOWN', quality = 'UNKNOWN', qualityPreference = 'UNKNOWN', worldId = 'UNKNOWN', zoneId = null, network = 'UNKNOWN';
    try {
      const state = readState();
      renderer = pick(state.renderer, ['WebGPU', 'WebGL2']);
      quality = pick(state.quality, ['low', 'medium', 'high']);
      qualityPreference = pick(state.qualityPreference, ['auto', 'low', 'medium', 'high']);
      worldId = pick(state.worldId, ['CAMPUS', 'BIRYONG', 'INTERIOR', 'LOBBY', 'EDITOR']);
      const publicZoneId = state.zoneId;
      zoneId = ['CAMPUS', 'BIRYONG'].includes(worldId) && zones.has(publicZoneId) ? publicZoneId : null;
      network = pick(state.network, ['ONLINE', 'CONNECTING', 'RECONNECTING', 'OFFLINE']);
      if (previousNetwork !== null && network !== previousNetwork) {
        if (network === 'OFFLINE') record('NETWORK_OFFLINE');
        if (network === 'RECONNECTING') record('NETWORK_RECONNECTING');
      }
      previousNetwork = network;
    } catch { record('DIAGNOSTICS_READ_FAILED'); }
    const fresh = lastFrame !== null && now() - lastFrame < 2500;
    return { buildId: normalizeBuildId(buildId), renderer, rendererState: lost ? 'LOST' : renderer === 'UNKNOWN' ? 'UNKNOWN' : 'AVAILABLE',
      quality, qualityPreference, worldId, zoneId, network,
      fps: fresh ? fps : null, frameTimeMs: fresh ? frameTimeMs : null,
      recentErrors: errors.map(code => ({ code })) };
  };
  return Object.freeze({ record, frame, snapshot, resetFrames,
    rendererLost() { lost = true; resetFrames(); record('RENDERER_DEVICE_LOST'); },
    rendererRestored() { lost = false; resetFrames(); },
    reset() { errors = []; previousNetwork = null; resetFrames(); }
  });
}

// Only text the player deliberately enters is accepted, with common credentials/PII redacted.
// No clipboard read, form scraping, console capture, Error.message/stack, or persistent storage.
export function sanitizeReportText(value) {
  if (typeof value !== 'string') return '';
  return value.slice(0, 4000)
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .replace(/https?:\/\/\S+/gi, '[링크 생략]')
    .replace(/[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[이메일 생략]')
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '[ID 생략]')
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[토큰 생략]')
    .replace(/\bBearer\s+\S+/gi, '[인증정보 생략]')
    .replace(/(?:["']?(?:access[_-]?token|refresh[_-]?token|authorization|cookie|set-cookie|password|account[_-]?id|user[_-]?id|session[_-]?id|api[_-]?key|token)["']?\s*[:=])[^\n]+/gi, '[인증정보 생략]')
    .replace(/\b[A-Za-z0-9_-]{32,}\b/g, '[식별자 생략]')
    .trim().slice(0, 1000);
}

export function createBugReport(diagnostics, fields = {}) {
  return { schema: 'inha-world.bug-report/1',
    description: sanitizeReportText(fields.description),
    reproduction: sanitizeReportText(fields.reproduction),
    context: sanitizeReportText(fields.context),
    diagnostics: diagnostics.snapshot() };
}
export const formatBugReport = report => JSON.stringify(report, null, 2);
