// Presentation-only, self read. No browser copy of the discovery registry or private RPC payload.
export const COLLECTION_BOOK_API = '/api/world-collection-book';
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

export function createCollectionBookClient({ getToken, fetcher = (...args) => globalThis.fetch(...args) } = {}) {
  let accountId=null, generation=0, state='SIGNED_OUT', snapshot=null, reading=null;
  const listeners=new Set();
  const emit = () => { for (const listener of listeners) { try { listener({state,snapshot,accountId}); } catch { /* consumer isolation */ } } };
  function setAccount(next) {
    next=typeof next==='string' && next ? next : null;
    if (next===accountId) return;
    generation++; accountId=next; reading=null; snapshot=null; state=next?'IDLE':'SIGNED_OUT'; emit();
  }
  function refresh() {
    if (!accountId) return Promise.resolve(false);
    if (reading) return reading;
    const gen=generation, actor=accountId;
    state='LOADING';snapshot=null;
    const run=(async()=>{
      let next=null;
      try {
        const token=await getToken?.(actor);
        if (gen!==generation) return false;
        if (token) {
          const response=await fetcher(COLLECTION_BOOK_API,{method:'GET',cache:'no-store',
            signal:AbortSignal.timeout(15000),headers:{Authorization:`Bearer ${token}`}});
          if (response.ok) next=parseCollectionBook(await response.json());
        }
      } catch { /* report only a stable unavailable state, never raw server/auth data */ }
      if (gen!==generation) return false;
      snapshot=next;state=next?'READY':'UNAVAILABLE';reading=null;emit();return Boolean(next);
    })();
    reading=run;emit();return run;
  }
  return {setAccount,refresh,get accountId(){return accountId;},get state(){return state;},get snapshot(){return snapshot;},
    onChange(listener){listeners.add(listener);return()=>listeners.delete(listener);}};
}
