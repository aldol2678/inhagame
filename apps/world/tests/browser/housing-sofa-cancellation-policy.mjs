// QA-only: a network failure is expected only after the page's actual AbortSignal
// fires for this code-owned optional sofa. All other failures remain strict.
export function createSofaCancellationTracker(problems) {
  const records = [], pages = new WeakMap();
  const state = (page,id) => {
    if (!pages.has(page)) pages.set(page,new Map());
    const entries=pages.get(page);if(!entries.has(id))entries.set(id,{signalled:false,failure:null});return entries.get(id);
  };
  return {
    records,
    signalled(page, url, requestId) {
      const entry=state(page,requestId);records.push({url,requestId,reason:'observed-fetch-AbortSignal'});entry.signalled=true;
      if(entry.failure){const index=problems.indexOf(entry.failure);if(index>=0)problems.splice(index,1);}
    },
    failed(page, url, errorText, requestId) {
      if(errorText!=='net::ERR_ABORTED'||!requestId)return false;
      const entry=state(page,requestId);
      if(entry.signalled)return true;
      entry.failure=`request failed: ${url} ${errorText} [sofaRequest=${requestId}]`;problems.push(entry.failure);return true;
    }
  };
}
