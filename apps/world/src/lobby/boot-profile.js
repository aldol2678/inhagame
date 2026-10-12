const PROFILE_KEY = "__INHA_WORLD_BOOT_PROFILE__";
export const WORLD_BOOT_PROFILE_VERSION = 1;

const round = value => Number.isFinite(value) ? Math.round(value * 100) / 100 : null;
function now(performanceTarget) {
  const value = performanceTarget?.now?.();
  return Number.isFinite(value) ? value : Date.now();
}
function hasNavigationEntry(performanceTarget) {
  try { return Boolean(performanceTarget?.getEntriesByType?.("navigation")?.[0]); }
  catch { return false; }
}

function safeDetail(value) {
  if (value == null || typeof value === "string" || typeof value === "boolean") return value;
  if (Number.isFinite(value)) return value;
  if (Array.isArray(value)) return value.slice(0, 20).map(safeDetail);
  if (typeof value === "object") {
    return Object.fromEntries(Object.entries(value).slice(0, 30)
      .map(([key, item]) => [key, safeDetail(item)]));
  }
  return String(value);
}

function resourceKind(entry) {
  let pathname = "";
  try { pathname = new URL(entry?.name ?? "", globalThis.location?.href ?? "http://localhost/").pathname.toLowerCase(); }
  catch {}
  if (pathname.startsWith("/api/")) return "api";
  if (/\.(?:glb|gltf|bin)$/u.test(pathname)) return "model";
  if (/\.(?:js|mjs)$/u.test(pathname) || entry?.initiatorType === "script") return "script";
  if (/\.css$/u.test(pathname) || entry?.initiatorType === "link") return "style";
  if (/\.(?:png|jpe?g|webp|svg|avif|gif)$/u.test(pathname) || entry?.initiatorType === "img") return "image";
  if (/\.(?:mp3|ogg|wav|m4a|mp4|webm)$/u.test(pathname) || ["audio", "video"].includes(entry?.initiatorType)) return "media";
  return "other";
}

export function summarizeBootResources(performanceTarget = globalThis.performance) {
  const entries = performanceTarget?.getEntriesByType?.("resource") ?? [];
  const kinds = {};
  let transferBytes = 0, encodedBodyBytes = 0, decodedBodyBytes = 0, opaqueSizeEntries = 0;
  for (const entry of entries) {
    const kind = resourceKind(entry);
    kinds[kind] = (kinds[kind] ?? 0) + 1;
    const transfer = Number(entry.transferSize) || 0;
    const encoded = Number(entry.encodedBodySize) || 0;
    const decoded = Number(entry.decodedBodySize) || 0;
    transferBytes += transfer;
    encodedBodyBytes += encoded;
    decodedBodyBytes += decoded;
    if (transfer === 0 && encoded === 0 && decoded === 0) opaqueSizeEntries += 1;
  }
  return Object.freeze({
    requests: entries.length,
    transferBytes,
    encodedBodyBytes,
    decodedBodyBytes,
    opaqueSizeEntries,
    kinds: Object.freeze({ ...kinds })
  });
}

function navigationSummary(performanceTarget) {
  const entry = performanceTarget?.getEntriesByType?.("navigation")?.[0];
  if (!entry) return null;
  return Object.freeze({
    responseEndMs: round(entry.responseEnd),
    domContentLoadedMs: round(entry.domContentLoadedEventEnd),
    loadEventMs: round(entry.loadEventEnd),
    transferBytes: Number(entry.transferSize) || 0,
    encodedBodyBytes: Number(entry.encodedBodySize) || 0,
    decodedBodyBytes: Number(entry.decodedBodySize) || 0
  });
}

export function createWorldBootProfile({
  performanceTarget = globalThis.performance,
  observerTarget = globalThis.PerformanceObserver,
  target = null
} = {}) {
  // Browser Performance timestamps are navigation-relative, so use 0 when NavigationTiming exists.
  const startedAt = hasNavigationEntry(performanceTarget) ? 0 : now(performanceTarget);
  const marks = [];
  const spans = [];
  const openSpans = new Map();
  const metadata = {};
  let finishedAt = null;
  let longTaskCount = 0;
  let longTaskDurationMs = 0;
  let observer = null;
  let finalResources = null;
  let finalNavigation = null;
  let finalLongTasks = null;

  const mark = (name, detail = null) => {
    const at = now(performanceTarget);
    const record = Object.freeze({ name: String(name), atMs: round(at - startedAt), detail: safeDetail(detail) });
    marks.push(record);
    try { performanceTarget?.mark?.(`inha-world:${name}`); } catch {}
    return record;
  };

  const startSpan = (name, detail = null) => {
    const key = String(name);
    if (openSpans.has(key)) return false;
    openSpans.set(key, { at: now(performanceTarget), detail: safeDetail(detail) });
    mark(`${key}:start`, detail);
    return true;
  };

  const endSpan = (name, detail = null) => {
    const key = String(name), start = openSpans.get(key);
    if (!start) return null;
    openSpans.delete(key);
    const endedAt = now(performanceTarget);
    const record = Object.freeze({
      name: key,
      startMs: round(start.at - startedAt),
      endMs: round(endedAt - startedAt),
      durationMs: round(endedAt - start.at),
      detail: safeDetail(detail ?? start.detail)
    });
    spans.push(record);
    mark(`${key}:end`, detail);
    return record;
  };

  const annotate = (key, value) => {
    metadata[String(key)] = safeDetail(value);
    return metadata[String(key)];
  };

  try {
    if (observerTarget?.supportedEntryTypes?.includes?.("longtask")) {
      observer = new observerTarget(list => {
        for (const entry of list.getEntries()) {
          longTaskCount += 1;
          longTaskDurationMs += Number(entry.duration) || 0;
        }
      });
      observer.observe({ type: "longtask", buffered: true });
    }
  } catch { observer = null; }

  const status = () => {
    const endedAt = finishedAt ?? now(performanceTarget);
    const longTasks = finalLongTasks ?? Object.freeze({ count: longTaskCount, durationMs: round(longTaskDurationMs) });
    return Object.freeze({
      version: WORLD_BOOT_PROFILE_VERSION,
      state: finishedAt === null ? "BOOTING" : "READY",
      elapsedMs: round(endedAt - startedAt),
      metadata: Object.freeze({ ...metadata }),
      marks: Object.freeze([...marks]),
      spans: Object.freeze([...spans]),
      pendingSpans: Object.freeze([...openSpans.keys()]),
      longTasks,
      navigation: finalNavigation ?? navigationSummary(performanceTarget),
      resources: finalResources ?? summarizeBootResources(performanceTarget)
    });
  };

  const finish = (detail = null) => {
    if (finishedAt !== null) return status();
    if (detail && typeof detail === "object") {
      for (const [key, value] of Object.entries(detail)) annotate(key, value);
    }
    mark("ready", detail);
    finishedAt = now(performanceTarget);
    try { observer?.disconnect?.(); } catch {}
    finalLongTasks = Object.freeze({ count: longTaskCount, durationMs: round(longTaskDurationMs) });
    finalNavigation = navigationSummary(performanceTarget);
    finalResources = summarizeBootResources(performanceTarget);
    return status();
  };

  const api = Object.freeze({ mark, startSpan, endSpan, annotate, finish, status });
  mark("profile-installed");
  if (target) target[PROFILE_KEY] = api;
  return api;
}

export function installWorldBootProfile({ target = globalThis, ...options } = {}) {
  if (target?.[PROFILE_KEY]?.status) return target[PROFILE_KEY];
  return createWorldBootProfile({ ...options, target });
}

export function getWorldBootProfile(target = globalThis) {
  return target?.[PROFILE_KEY] ?? null;
}
