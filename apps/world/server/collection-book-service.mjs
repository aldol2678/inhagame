// Self-only C3 read adapter. No discovery, reward, inventory or owner-state writes.
import { COLLECTION_ENTRY_REGISTRY } from '../src/collection/collection-discovery-contract.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const READ_RPC = 'world_collection_list_v1';
const isTime = value => typeof value === 'string' && value.length <= 64 && Number.isFinite(Date.parse(value));
const positive = value => Number.isSafeInteger(value) && value > 0;
export class CollectionBookError extends Error {
  constructor(message = 'COLLECTION_BOOK_UNAVAILABLE', status = 503) { super(message); this.status = status; }
}

/** Raw service-role response stays server-side. Registry/DB agreement is required for visibility.
 * SECRET/HIDDEN and not-yet-active entries are omitted even from totals. Unrevealed silhouettes
 * expose neither their stable content ID nor their title, category, description or internal refs.
 */
export function projectCollectionBook(raw, actor) {
  if (!raw || !UUID.test(actor ?? '') || raw.userId?.toLowerCase() !== actor.toLowerCase() || !Array.isArray(raw.entries)) {
    throw new CollectionBookError();
  }
  const entries = [], seen = new Set();
  for (const row of raw.entries) {
    if (!row || typeof row.entryId !== 'string' || seen.has(row.entryId)) throw new CollectionBookError();
    seen.add(row.entryId);
    const def = COLLECTION_ENTRY_REGISTRY.get(row.entryId);
    if (!def || def.status !== 'ACTIVE' || row.catalogStatus !== 'ACTIVE' ||
      row.category !== def.category || row.persistenceMode !== def.persistenceMode || row.definitionVersion !== def.definitionVersion ||
      !['PUBLIC', 'SILHOUETTE'].includes(def.visibilityPolicy)) continue;
    if (def.persistenceMode === 'DERIVED_FROM_OWNER') {
      if (row.discoveryState !== 'OWNER_DERIVED' || row.discovered !== null || row.firstDiscoveredAt !== null ||
          row.lastDiscoveredAt !== null || row.discoveryCount !== null || row.version !== null ||
          row.ownerDomain !== def.ownerDomain || row.ownerRef !== def.ownerRef) throw new CollectionBookError();
      // No owner resolver exists in this slice. This is explicitly not a discovery assertion.
      entries.push({ key: def.entryId, title: def.title, state: 'OWNER_DERIVED', firstDiscoveredAt: null,
        discoveryCount: null, sourceLabel: null, hint: '이 항목의 발견 여부는 해당 콘텐츠의 기록에서 확인해요' });
      continue;
    }
    if (def.persistenceMode !== 'SERVER_PERSISTED') continue;
    const found = row.discoveryState === 'DISCOVERED' && row.discovered === true;
    const unknown = row.discoveryState === 'UNKNOWN' && row.discovered === false;
    if (row.ownerDomain !== null || row.ownerRef !== null || (!found && !unknown) ||
      (found && (!isTime(row.firstDiscoveredAt) || !isTime(row.lastDiscoveredAt) ||
        Date.parse(row.lastDiscoveredAt) < Date.parse(row.firstDiscoveredAt) || !positive(row.discoveryCount) || !positive(row.version))) ||
      (unknown && (row.firstDiscoveredAt !== null || row.lastDiscoveredAt !== null || row.discoveryCount !== 0 || row.version !== 0))) {
      throw new CollectionBookError();
    }
    const redacted = !found && def.visibilityPolicy === 'SILHOUETTE';
    entries.push({ key: redacted ? `unrevealed:${entries.length}` : def.entryId,
      title: redacted ? '아직 발견하지 못한 기록' : def.title,
      state: found ? 'DISCOVERED' : 'UNKNOWN', firstDiscoveredAt: found ? row.firstDiscoveredAt : null,
      discoveryCount: found ? row.discoveryCount : 0,
      // The existing read RPC intentionally has no first-source field. Never infer provenance
      // from a catalog acquisition rule, current inventory, or domain result/ref identifiers.
      sourceLabel: null, hint: found ? null : '월드에서 기록을 발견하면 자세한 내용이 표시돼요' });
  }
  return { version: 1, entries, discoveredCount: entries.filter(e => e.state === 'DISCOVERED').length,
    trackableCount: entries.filter(e => e.state !== 'OWNER_DERIVED').length };
}

export function createCollectionBookService({ verifyUser, rpc }) {
  return async authorization => {
    let actor;
    try { actor = await verifyUser(authorization); } catch { throw new CollectionBookError(); }
    if (typeof actor !== 'string' || !UUID.test(actor)) throw new CollectionBookError('AUTH_REQUIRED', 401);
    actor = actor.toLowerCase();
    try { return projectCollectionBook(await rpc(READ_RPC, { p_user: actor }), actor); }
    catch (error) { if (error instanceof CollectionBookError) throw error; throw new CollectionBookError(); }
  };
}

export function createCollectionBookRpc({ url, serviceKey, fetcher = fetch }) {
  return async (name, args) => {
    if (name !== READ_RPC || !/^https?:\/\//.test(url ?? '') || !serviceKey ||
        !args || Object.keys(args).join() !== 'p_user' || !UUID.test(args.p_user ?? '')) throw new CollectionBookError();
    try {
      const response = await fetcher(`${url.replace(/\/$/, '')}/rest/v1/rpc/${READ_RPC}`, {
        method: 'POST', signal: AbortSignal.timeout(10000),
        headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(args)
      });
      const data = await response.json();
      if (!response.ok) throw new CollectionBookError(
        data?.message === 'ACCOUNT_UNAVAILABLE' ? 'ACCOUNT_UNAVAILABLE' : 'COLLECTION_BOOK_UNAVAILABLE',
        data?.message === 'ACCOUNT_UNAVAILABLE' ? 403 : 503);
      return data;
    } catch (error) { if (error instanceof CollectionBookError) throw error; throw new CollectionBookError(); }
  };
}

export function createCollectionBookApiHandler({ service }) {
  return async (req, res) => {
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('Vary', 'Authorization');
    if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return res.status(405).end(); }
    if (req.url?.includes('?') || (req.body != null && req.body !== '')) return res.status(400).end();
    if (req.headers.origin) {
      try { if (new URL(req.headers.origin).host !== req.headers.host) return res.status(403).end(); }
      catch { return res.status(403).end(); }
    }
    try { return res.status(200).json(await service(req.headers.authorization)); }
    catch (error) { return res.status(error instanceof CollectionBookError ? error.status : 503).json({
      error: error instanceof CollectionBookError ? error.message : 'COLLECTION_BOOK_UNAVAILABLE'
    }); }
  };
}
