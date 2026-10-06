// Presentation-only, self read. No browser copy of the discovery registry or private RPC payload.
export const COLLECTION_BOOK_API = '/api/world-collection-book';
import { parseCollectionBook } from './collection-book-contract.mjs';
export { parseCollectionBook } from './collection-book-contract.mjs';

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
            signal:AbortSignal.timeout(20000),headers:{Authorization:`Bearer ${token}`}});
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
