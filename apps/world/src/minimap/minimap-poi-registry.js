// INHA WORLD Mini-map M0 generic POI registry.
// Validates stable definitions and resolves position/gate/discovery through injected owners.
// No DOM, game-specific coordinates, quest rules, database or network access.

export const MAP_SURFACE = Object.freeze({
  MINIMAP: "MINIMAP",
  FULL_MAP: "FULL_MAP"
});

export const MAP_GATE_STATE = Object.freeze({
  AVAILABLE: "AVAILABLE",
  LOCKED_PROGRESS: "LOCKED_PROGRESS",
  LOCKED_ACCOUNT: "LOCKED_ACCOUNT",
  COMING_SOON: "COMING_SOON",
  NEW: "NEW",
  DISABLED: "DISABLED",
  UNKNOWN: "UNKNOWN",
  HIDDEN: "HIDDEN"
});

export const MAP_DISCOVERY_STATE = Object.freeze({
  DISCOVERED: "DISCOVERED",
  UNDISCOVERED: "UNDISCOVERED",
  UNKNOWN: "UNKNOWN"
});

export const MAP_POI_PRESENTATION = Object.freeze({
  NORMAL: "NORMAL",
  LOCKED: "LOCKED",
  COMING_SOON: "COMING_SOON",
  DISABLED: "DISABLED",
  UNKNOWN: "UNKNOWN",
  UNDISCOVERED: "UNDISCOVERED"
});

const gateStates = new Set(Object.values(MAP_GATE_STATE));
const discoveryStates = new Set(Object.values(MAP_DISCOVERY_STATE));
const surfaces = new Set(Object.values(MAP_SURFACE));
const validId = value => typeof value === "string" && /^[a-z0-9][a-z0-9._-]{1,95}$/.test(value);
const cloneRef = value => value && typeof value === "object" ? { ...value } : value;

function copyDefinition(raw) {
  if (!raw || typeof raw !== "object") throw new TypeError("POI definition must be an object");
  if (!validId(raw.poiId)) throw new TypeError("Invalid poiId");
  if (typeof raw.title !== "string" || !raw.title.trim()) throw new TypeError(`Invalid title for ${raw.poiId}`);
  if (typeof raw.kind !== "string" || !raw.kind.trim()) throw new TypeError(`Invalid kind for ${raw.poiId}`);
  if (!raw.sourceRef) throw new TypeError(`Missing sourceRef for ${raw.poiId}`);
  if (typeof raw.iconKey !== "string" || !raw.iconKey.trim()) throw new TypeError(`Invalid iconKey for ${raw.poiId}`);
  if (!Number.isFinite(raw.priority)) throw new TypeError(`Invalid priority for ${raw.poiId}`);
  const listedSurfaces = Array.isArray(raw.surfaces) ? raw.surfaces : [];
  if (!listedSurfaces.length || listedSurfaces.some(surface => !surfaces.has(surface))) {
    throw new TypeError(`Invalid surfaces for ${raw.poiId}`);
  }
  return Object.freeze({
    poiId: raw.poiId,
    title: raw.title.trim(),
    kind: raw.kind,
    sourceRef: Object.freeze(cloneRef(raw.sourceRef)),
    placeZoneId: raw.placeZoneId ?? null,
    iconKey: raw.iconKey,
    priority: raw.priority,
    labelMode: raw.labelMode ?? "NONE",
    surfaces: Object.freeze([...new Set(listedSurfaces)]),
    gateRef: raw.gateRef ? Object.freeze(cloneRef(raw.gateRef)) : null,
    discoveryRef: raw.discoveryRef ? Object.freeze(cloneRef(raw.discoveryRef)) : null
  });
}

function presentationFor(gateState, discoveryState) {
  if (discoveryState === MAP_DISCOVERY_STATE.UNKNOWN || gateState === MAP_GATE_STATE.UNKNOWN) {
    return MAP_POI_PRESENTATION.UNKNOWN;
  }
  if (discoveryState === MAP_DISCOVERY_STATE.UNDISCOVERED) {
    return MAP_POI_PRESENTATION.UNDISCOVERED;
  }
  if (gateState === MAP_GATE_STATE.LOCKED_PROGRESS || gateState === MAP_GATE_STATE.LOCKED_ACCOUNT) {
    return MAP_POI_PRESENTATION.LOCKED;
  }
  if (gateState === MAP_GATE_STATE.COMING_SOON) return MAP_POI_PRESENTATION.COMING_SOON;
  if (gateState === MAP_GATE_STATE.DISABLED) return MAP_POI_PRESENTATION.DISABLED;
  return MAP_POI_PRESENTATION.NORMAL;
}

function position2(value, poiId) {
  const x = value?.x;
  const z = value?.z;
  if (!Number.isFinite(x) || !Number.isFinite(z)) {
    throw new TypeError(`Invalid resolved position for ${poiId}`);
  }
  return { x, z };
}

export function createMapPoiRegistry({
  definitions = [],
  resolvePosition,
  resolveGateState = () => MAP_GATE_STATE.AVAILABLE,
  resolveDiscoveryState = () => MAP_DISCOVERY_STATE.DISCOVERED,
  clock = { now: () => Date.now() }
} = {}) {
  if (typeof resolvePosition !== "function") throw new TypeError("resolvePosition is required");
  if (typeof resolveGateState !== "function") throw new TypeError("resolveGateState must be a function");
  if (typeof resolveDiscoveryState !== "function") throw new TypeError("resolveDiscoveryState must be a function");

  const byId = new Map();
  const errors = [];
  const record = (where, poiId, error) => {
    errors.push({ where, poiId, message: String(error?.message ?? error), at: clock.now() });
    if (errors.length > 20) errors.shift();
  };

  for (const raw of definitions) {
    const definition = copyDefinition(raw);
    if (byId.has(definition.poiId)) throw new Error(`Duplicate poiId: ${definition.poiId}`);
    byId.set(definition.poiId, definition);
  }

  function resolve(definition, context = null) {
    let position;
    try {
      position = position2(resolvePosition(definition.sourceRef, definition, context), definition.poiId);
    } catch (error) {
      record("position", definition.poiId, error);
      return Object.freeze({
        ...definition,
        x: null,
        z: null,
        gateState: MAP_GATE_STATE.UNKNOWN,
        discoveryState: MAP_DISCOVERY_STATE.UNKNOWN,
        visible: false,
        presentation: MAP_POI_PRESENTATION.UNKNOWN,
        validPosition: false
      });
    }

    let gateState = MAP_GATE_STATE.AVAILABLE;
    try {
      const candidate = resolveGateState(definition.gateRef, definition, context);
      if (candidate != null) gateState = typeof candidate === "string" ? candidate : candidate.state;
      if (!gateStates.has(gateState)) throw new Error(`Invalid gate state: ${gateState}`);
    } catch (error) {
      record("gate", definition.poiId, error);
      gateState = MAP_GATE_STATE.UNKNOWN;
    }

    let discoveryState = MAP_DISCOVERY_STATE.DISCOVERED;
    try {
      const candidate = resolveDiscoveryState(definition.discoveryRef, definition, context);
      if (candidate != null) discoveryState = typeof candidate === "string" ? candidate : candidate.state;
      if (!discoveryStates.has(discoveryState)) throw new Error(`Invalid discovery state: ${discoveryState}`);
    } catch (error) {
      record("discovery", definition.poiId, error);
      discoveryState = MAP_DISCOVERY_STATE.UNKNOWN;
    }

    const visible = gateState !== MAP_GATE_STATE.HIDDEN;
    return Object.freeze({
      ...definition,
      x: position.x,
      z: position.z,
      gateState,
      discoveryState,
      visible,
      presentation: presentationFor(gateState, discoveryState),
      validPosition: true
    });
  }

  function get(poiId, context = null) {
    const definition = byId.get(poiId);
    return definition ? resolve(definition, context) : null;
  }

  function list({ surface = MAP_SURFACE.MINIMAP, context = null, includeHidden = false } = {}) {
    if (!surfaces.has(surface)) throw new TypeError(`Invalid map surface: ${surface}`);
    return [...byId.values()]
      .filter(definition => definition.surfaces.includes(surface))
      .map(definition => resolve(definition, context))
      .filter(poi => poi.validPosition)
      .filter(poi => includeHidden || poi.visible)
      .sort((a, b) => b.priority - a.priority || a.poiId.localeCompare(b.poiId));
  }

  return {
    get,
    list,
    has: poiId => byId.has(poiId),
    status: (poiId, context = null) => {
      const poi = get(poiId, context);
      return poi ? Object.freeze({
        poiId: poi.poiId,
        gateState: poi.gateState,
        discoveryState: poi.discoveryState,
        visible: poi.visible,
        presentation: poi.presentation,
        validPosition: poi.validPosition
      }) : null;
    },
    get errors() { return errors.slice(); },
    get size() { return byId.size; }
  };
}
