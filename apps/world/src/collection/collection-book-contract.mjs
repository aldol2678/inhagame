// Shared projected-wire validation only; no registry, raw ledger or server authority.
const isText = value => typeof value === 'string' && value.length > 0 && value.length <= 200;
const isTime = value => typeof value === 'string' && value.length <= 64 && Number.isFinite(Date.parse(value));
export function parseCollectionBook(raw) {
  if (!raw || raw.version !== 1 || !Array.isArray(raw.entries) || raw.entries.length > 1000) return null;
  const entries = [], seen = new Set();
  for (const e of raw.entries) {
    if (!e || !isText(e.key) || seen.has(e.key) || !isText(e.title) ||
        !['UNKNOWN', 'DISCOVERED', 'OWNER_DERIVED'].includes(e.state) ||
        (e.hint !== null && !isText(e.hint)) || e.sourceLabel !== null) return null;
    seen.add(e.key);
    if (e.state === 'DISCOVERED' ? (!isTime(e.firstDiscoveredAt) || !Number.isSafeInteger(e.discoveryCount) || e.discoveryCount < 1) :
      (e.firstDiscoveredAt !== null || e.discoveryCount !== (e.state === 'UNKNOWN' ? 0 : null))) return null;
    entries.push(Object.freeze({ key:e.key, title:e.title, state:e.state, firstDiscoveredAt:e.firstDiscoveredAt,
      discoveryCount:e.discoveryCount, sourceLabel:null, hint:e.hint }));
  }
  const discoveredCount=entries.filter(e=>e.state==='DISCOVERED').length;
  const trackableCount=entries.filter(e=>e.state!=='OWNER_DERIVED').length;
  if (raw.discoveredCount !== discoveredCount || raw.trackableCount !== trackableCount) return null;
  return Object.freeze({version:1,entries:Object.freeze(entries),discoveredCount,trackableCount});
}
