// Online AOI P0-A: pure spatial routing model for future Realtime cell subscriptions.
//
// IMPORTANT: this module does not subscribe to Supabase or change live transport behavior by itself.
// It defines the deterministic cell/topic contract and the load-model seam used by tests and P0-B.
//
// Network pose coordinates are canonical campus metres (see protocol.js and AOI_P0A.md).

import { isValidPlaceZoneId } from "./protocol.js";

export const AOI_GRID_DEFAULTS = Object.freeze({
  // 17 m Nearby exit radius must fit within the subscribed neighborhood.
  cellSizeM: 9,
  neighborRadiusCells: 2,
  interactionGuaranteeM: 17
});

export const AOI_MAX_SUBSCRIPTIONS =
  (AOI_GRID_DEFAULTS.neighborRadiusCells * 2 + 1) ** 2;

const SIGNED_CELL = /^(?:P0|P[1-9][0-9]*|N[1-9][0-9]*)$/;

function finite(value, name) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new TypeError(`${name} must be a finite number`);
  }
  return value;
}

function positive(value, name) {
  finite(value, name);
  if (value <= 0) throw new RangeError(`${name} must be > 0`);
  return value;
}

function whole(value, name) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative safe integer`);
  }
  return value;
}

function normalizeConfig(config = AOI_GRID_DEFAULTS) {
  return {
    cellSizeM: positive(config.cellSizeM ?? AOI_GRID_DEFAULTS.cellSizeM, "cellSizeM"),
    neighborRadiusCells: whole(
      config.neighborRadiusCells ?? AOI_GRID_DEFAULTS.neighborRadiusCells,
      "neighborRadiusCells"
    ),
    interactionGuaranteeM: positive(
      config.interactionGuaranteeM ?? AOI_GRID_DEFAULTS.interactionGuaranteeM,
      "interactionGuaranteeM"
    )
  };
}

export function encodeAoiCellIndex(index) {
  if (!Number.isSafeInteger(index)) throw new TypeError("AOI cell index must be a safe integer");
  return index < 0 ? `N${Math.abs(index)}` : `P${index}`;
}

export function decodeAoiCellIndex(encoded) {
  if (typeof encoded !== "string" || !SIGNED_CELL.test(encoded)) {
    throw new TypeError(`Invalid AOI cell index: ${encoded}`);
  }
  if (encoded === "P0") return 0;
  const magnitude = Number(encoded.slice(1));
  return encoded[0] === "N" ? -magnitude : magnitude;
}

export function aoiCellForPosition(position, config = AOI_GRID_DEFAULTS) {
  const { cellSizeM } = normalizeConfig(config);
  const x = finite(position?.x, "position.x");
  const z = finite(position?.z, "position.z");
  return Object.freeze({
    x: Math.floor(x / cellSizeM),
    z: Math.floor(z / cellSizeM)
  });
}

export function aoiCellKey(cell) {
  if (!Number.isSafeInteger(cell?.x) || !Number.isSafeInteger(cell?.z)) {
    throw new TypeError("AOI cell needs safe-integer x/z");
  }
  return `X${encodeAoiCellIndex(cell.x)}_Z${encodeAoiCellIndex(cell.z)}`;
}

export function aoiNeighborhood(cell, config = AOI_GRID_DEFAULTS) {
  if (!Number.isSafeInteger(cell?.x) || !Number.isSafeInteger(cell?.z)) {
    throw new TypeError("AOI cell needs safe-integer x/z");
  }
  const { neighborRadiusCells } = normalizeConfig(config);
  const cells = [];
  for (let dz = -neighborRadiusCells; dz <= neighborRadiusCells; dz += 1) {
    for (let dx = -neighborRadiusCells; dx <= neighborRadiusCells; dx += 1) {
      cells.push(Object.freeze({ x: cell.x + dx, z: cell.z + dz }));
    }
  }
  return Object.freeze(cells);
}

export const AOI_TOPIC = /^world:campus:AREA_[A-Z0-9_]{1,60}:aoi:X(?:P0|P[1-9][0-9]*|N[1-9][0-9]*)_Z(?:P0|P[1-9][0-9]*|N[1-9][0-9]*)$/;

export function aoiTopic(placeZoneId, cell) {
  if (!isValidPlaceZoneId(placeZoneId) || !placeZoneId.startsWith("AREA_")) {
    throw new TypeError(`Invalid AOI placeZoneId: ${placeZoneId}`);
  }
  const topic = `world:campus:${placeZoneId}:aoi:${aoiCellKey(cell)}`;
  if (!AOI_TOPIC.test(topic)) throw new TypeError(`Invalid AOI topic: ${topic}`);
  return topic;
}

export function aoiTopicsForPosition(placeZoneId, position, config = AOI_GRID_DEFAULTS) {
  const cell = aoiCellForPosition(position, config);
  return Object.freeze(aoiNeighborhood(cell, config).map((entry) => aoiTopic(placeZoneId, entry)));
}

export function aoiCanObserve(publisherPosition, observerPosition, config = AOI_GRID_DEFAULTS) {
  const publisherCell = aoiCellForPosition(publisherPosition, config);
  const observerCell = aoiCellForPosition(observerPosition, config);
  const { neighborRadiusCells } = normalizeConfig(config);
  return Math.abs(publisherCell.x - observerCell.x) <= neighborRadiusCells
    && Math.abs(publisherCell.z - observerCell.z) <= neighborRadiusCells;
}

// Diagnostic model for Broadcast accounting. Supabase Realtime counts an event when a client sends
// a websocket message and again for each delivered websocket message. Presence/join churn is excluded.
export function estimateAoiRealtimeEventsPerSecond({
  positions,
  movingIndexes,
  poseHz = 4,
  config = AOI_GRID_DEFAULTS
} = {}) {
  if (!Array.isArray(positions) || !Array.isArray(movingIndexes)) {
    throw new TypeError("positions and movingIndexes must be arrays");
  }
  positive(poseHz, "poseHz");

  const cells = positions.map((position) => aoiCellForPosition(position, config));
  const interest = positions.map((position) => {
    const set = new Set(aoiNeighborhood(aoiCellForPosition(position, config), config).map(aoiCellKey));
    return set;
  });

  let deliveriesPerTick = 0;
  let maxRecipients = 0;
  for (const index of movingIndexes) {
    if (!Number.isSafeInteger(index) || index < 0 || index >= positions.length) {
      throw new RangeError(`Invalid moving index: ${index}`);
    }
    const key = aoiCellKey(cells[index]);
    let recipients = 0;
    for (let observer = 0; observer < positions.length; observer += 1) {
      if (observer === index) continue;
      if (interest[observer].has(key)) recipients += 1;
    }
    deliveriesPerTick += recipients;
    maxRecipients = Math.max(maxRecipients, recipients);
  }

  const sendsPerSec = movingIndexes.length * poseHz;
  const deliveriesPerSec = deliveriesPerTick * poseHz;
  return Object.freeze({
    players: positions.length,
    moving: movingIndexes.length,
    poseHz,
    sendsPerSec,
    deliveriesPerSec,
    totalEventsPerSec: sendsPerSec + deliveriesPerSec,
    averageRecipients: movingIndexes.length
      ? deliveriesPerTick / movingIndexes.length
      : 0,
    maxRecipients
  });
}
