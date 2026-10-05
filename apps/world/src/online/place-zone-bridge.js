// Semantic Place Zone → NetworkManager. Only AREA_* place IDs flow through here; render chunks,
// view distance and streaming state never reach the network.
//
// The first zone is joined at once. Later changes are committed after the new zone has held for
// `debounceMs`, so walking along a border does not churn channel subscriptions. Returning to the
// committed zone before the timer ends cancels the pending change.

export const PLACE_ZONE_DEBOUNCE_MS = 400;

export class PlaceZoneNetworkBridge {
  constructor(network, { debounceMs = PLACE_ZONE_DEBOUNCE_MS } = {}) {
    this.network = network;
    this.debounceMs = debounceMs;
    this.committed = undefined;
    this.pending = undefined;
    this.pendingSince = 0;
    this.commits = 0;
  }

  observe(placeZoneId, nowMs) {
    const id = placeZoneId ?? null;
    if (this.committed === undefined) return this.#commit(id);
    if (id === this.committed) { this.pending = undefined; return false; }
    if (id !== this.pending) { this.pending = id; this.pendingSince = nowMs; }
    return false;
  }

  // Commit at once, skipping the debounce (entering/leaving an indoor room is not a border walk).
  commitNow(placeZoneId) {
    this.pending = undefined;
    return this.#commit(placeZoneId ?? null);
  }

  tick(nowMs) {
    if (this.pending === undefined || nowMs - this.pendingSince < this.debounceMs) return false;
    return this.#commit(this.pending);
  }

  #commit(id) {
    this.pending = undefined;
    if (id === this.committed) return false;
    this.committed = id;
    this.commits += 1;
    this.network.handlePlaceZoneChanged(this.network.placeZoneId, id);
    return true;
  }
}
