import { FURNITURE_VISUALS } from '../../src/rooms/furniture-visual-assets.js';

// QA-only: exact enabled, code-owned URLs, including query strings. No pathname or
// prefix matching: retired models, altered queries and off-origin URLs stay strict.
export function enabledFurnitureUrls(origin) {
  if (new URL(origin).origin !== origin) throw new TypeError('Expected an exact smoke origin');
  return Object.freeze(FURNITURE_VISUALS.filter(visual => visual.enabled).map(visual => new URL(visual.url, origin))
    .filter(url => url.origin === origin).map(url => url.href));
}
const validRequestId = value => typeof value === 'string'
  && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:[1-9]\d*$/.test(value);

// Expected only when this page, full URL and document-specific request ID match
// an actual AbortSignal event. An unobserved failure stays in problems even when
// Playwright delivers requestfailed before the page binding event.
export function createFurnitureCancellationTracker(problems, { origin }) {
  const urls = enabledFurnitureUrls(origin), trusted = new Set(urls);
  const records = [], pages = new WeakMap();
  const qualifies = (url, requestId) => trusted.has(url) && validRequestId(requestId);
  const state = (page,url,id) => {
    if (!pages.has(page)) pages.set(page,new Map());
    const entries=pages.get(page),key=JSON.stringify([url,id]);
    if(!entries.has(key))entries.set(key,{signalled:false,failure:null});return entries.get(key);
  };
  return {
    records, urls,
    signalled(page, url, requestId) {
      if(!qualifies(url,requestId))return false;
      const entry=state(page,url,requestId);
      if(!entry.signalled)records.push({url,requestId,reason:'observed-fetch-AbortSignal'});
      entry.signalled=true;
      if(entry.failure){const index=problems.indexOf(entry.failure);if(index>=0)problems.splice(index,1);}
      return true;
    },
    failed(page, url, errorText, requestId) {
      if(errorText!=='net::ERR_ABORTED'||!qualifies(url,requestId))return false;
      const entry=state(page,url,requestId);
      if(entry.signalled)return true;
      if(!entry.failure){entry.failure=`request failed: ${url} ${errorText} [furnitureRequest=${requestId}]`;problems.push(entry.failure);}
      return true;
    }
  };
}

// Retain the existing helper import name for callers; the authority is now narrow
// enough to cover all enabled furniture rather than relying on a sofa-only caller.
export const createSofaCancellationTracker = createFurnitureCancellationTracker;

export async function installFurnitureCancellationEvidence(context, { origin, tracker }) {
  await context.exposeBinding('__worldSmokeFurnitureAbort', ({ page }, { url, requestId }) => {
    tracker.signalled(page, url, requestId);
  });
  await context.addInitScript(({ origin, urls }) => {
    if(location.origin!==origin)return;
    const trusted=new Set(urls),original=globalThis.fetch,documentId=crypto.randomUUID();let sequence=0;
    globalThis.fetch=function(input,options){
      const url=new URL(typeof input==='string'||input instanceof URL?input:input.url,location.href);
      const request=input instanceof Request?input:null;
      const signal=options&&Object.hasOwn(options,'signal')?options.signal:request?.signal;
      if(trusted.has(url.href)&&signal){
        const requestId=`${documentId}:${++sequence}`,headers=new Headers(options?.headers??request?.headers);
        headers.set('x-world-smoke-furniture-request',requestId);options={...options,headers};
        const notify=()=>{void globalThis.__worldSmokeFurnitureAbort({url:url.href,requestId}).catch(()=>{});};
        if(signal.aborted)notify();else signal.addEventListener('abort',notify,{once:true});
      }
      return original.call(this,input,options);
    };
  }, { origin, urls: tracker.urls });
}
