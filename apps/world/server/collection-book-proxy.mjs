// Vercel holds no Collection service key. Only the existing trusted backend receives the Bearer.
import { createCollectionBookApiHandler, CollectionBookError } from './collection-book-service.mjs';
import { parseCollectionBook } from '../src/collection/collection-book-contract.mjs';
const MAX_RESPONSE_BYTES = 1024 * 1024;
function backendReadUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) return null;
    return `${url.href.replace(/\/$/, '')}/collection-book`;
  } catch { return null; }
}
async function boundedJson(response) {
  const reader = response.body?.getReader();
  if (!reader) throw new CollectionBookError();
  const chunks = []; let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > MAX_RESPONSE_BYTES) throw new CollectionBookError();
      chunks.push(value);
    }
  } catch (error) { await reader.cancel().catch(() => {}); throw error; }
  finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return JSON.parse(new TextDecoder().decode(bytes));
}
export function createCollectionBookProxy({ url, fetcher = fetch } = {}) {
  const destination = backendReadUrl(url);
  return createCollectionBookApiHandler({ service: async authorization => {
    if (!/^Bearer [A-Za-z0-9._~-]{20,4096}$/.test(authorization ?? '')) throw new CollectionBookError('AUTH_REQUIRED', 401);
    if (!destination) throw new CollectionBookError();
    try {
      const response = await fetcher(destination, { method: 'GET', redirect: 'error', cache: 'no-store',
        // Existing Auth (5s) + RPC (10s), then a small transport margin; browser waits 20s.
        signal: AbortSignal.timeout(18000), headers: { Authorization: authorization } });
      if (![200, 401, 403].includes(response.status)) {
        await response.body?.cancel().catch(() => {}); throw new CollectionBookError();
      }
      const data = await boundedJson(response);
      if (response.status !== 200) {
        if (response.status === 401 && data?.error === 'AUTH_REQUIRED') throw new CollectionBookError('AUTH_REQUIRED', 401);
        if (response.status === 403 && data?.error === 'ACCOUNT_UNAVAILABLE') throw new CollectionBookError('ACCOUNT_UNAVAILABLE', 403);
        throw new CollectionBookError();
      }
      const projection = parseCollectionBook(data);
      if (!projection) throw new CollectionBookError();
      return projection;
    } catch (error) { if (error instanceof CollectionBookError) throw error; throw new CollectionBookError(); }
  } });
}
