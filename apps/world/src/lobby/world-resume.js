import { WORLD_BOUNDS } from "../campus-layout.js";
import { roadviewGroundHeight } from "../roadview-layout.js";
import { PLAYER_ORIGIN_Y, WALK_SHAPE } from "../player-dimensions.js";
import { canOccupy } from "../world-collision.js";
import { getPlaceZoneAt } from "../place-zone-registry.js";
import { WORLD_REGION_ID, isWorldRegionId } from "../regions/world-region-registry.js";

export const WORLD_RESUME_STORAGE_KEY = "inhagame-world-resume-v1";
export const WORLD_RESUME_VERSION = 2;
export const WORLD_RESUME_LEGACY_VERSION = 1;
export const WORLD_RESUME_SAVE_INTERVAL_MS = 2000;

const finite = (value) => Number.isFinite(Number(value)) ? Number(value) : null;
const inBounds = ({ x, z }, bounds = WORLD_BOUNDS) =>
  x >= bounds.minX && x <= bounds.maxX && z >= bounds.minZ && z <= bounds.maxZ;

function recordRegion(raw) {
  if (raw?.version === WORLD_RESUME_LEGACY_VERSION) return WORLD_REGION_ID.CAMPUS;
  return isWorldRegionId(raw?.regionId) ? raw.regionId : null;
}

export function validateResumeRecord(raw, {
  getZone = getPlaceZoneAt,
  canOccupyPosition = (position) => canOccupy(position, WALK_SHAPE),
  groundHeight = roadviewGroundHeight,
  bounds = WORLD_BOUNDS,
  expectedRegionId = WORLD_REGION_ID.CAMPUS
} = {}) {
  if (!raw || ![WORLD_RESUME_LEGACY_VERSION, WORLD_RESUME_VERSION].includes(raw.version)) {
    return { state: "INVALID", record: null };
  }
  const regionId = recordRegion(raw);
  // P0 resume validators below are Campus authorities. Other regions must opt into their own
  // bounds/ground/place contract before their coordinates can ever be restored as Campus.
  if (!regionId || regionId !== expectedRegionId) return { state: "INVALID", record: null };

  const x = finite(raw.x), z = finite(raw.z), storedY = finite(raw.y);
  const yawDeg = finite(raw.yawDeg) ?? 0;
  const cameraYaw = finite(raw.cameraYaw) ?? 0;
  const savedAt = finite(raw.savedAt);
  if ([x, z, storedY, savedAt].some(value => value === null) || savedAt <= 0) return { state: "INVALID", record: null };
  if (!inBounds({ x, z }, bounds)) return { state: "INVALID", record: null };

  const y = PLAYER_ORIGIN_Y + groundHeight(x, z);
  if (Math.abs(storedY - y) > 0.35) return { state: "INVALID", record: null };
  const position = { x, y, z };
  if (!canOccupyPosition(position)) return { state: "INVALID", record: null };
  const zone = getZone(position);
  if (!zone?.id) return { state: "INVALID", record: null };

  return {
    state: "VALID",
    record: Object.freeze({
      version: WORLD_RESUME_VERSION,
      regionId,
      x, y, z, yawDeg, cameraYaw, savedAt,
      zoneId: zone.id,
      displayName: zone.displayName ?? "캠퍼스"
    })
  };
}

function browserStorage() {
  try { return globalThis.localStorage ?? null; } catch { return null; }
}

export function readWorldResume(storage = null, options = {}) {
  storage ??= browserStorage();
  if (!storage?.getItem) return { state: "MISSING", record: null };
  let raw;
  try {
    const value = storage.getItem(WORLD_RESUME_STORAGE_KEY);
    if (!value) return { state: "MISSING", record: null };
    raw = JSON.parse(value);
  } catch {
    return { state: "INVALID", record: null };
  }
  return validateResumeRecord(raw, options);
}

export function createWorldResumeStore({
  storage = null,
  clock = { now: () => Date.now() },
  saveIntervalMs = WORLD_RESUME_SAVE_INTERVAL_MS
} = {}) {
  storage ??= browserStorage();
  let lastWriteAt = 0;

  const maybeSave = ({
    position,
    yawDeg = 0,
    cameraYaw = 0,
    place = null,
    grounded = false,
    mounted = false,
    insideRoom = false,
    enabled = true,
    regionId = WORLD_REGION_ID.CAMPUS
  } = {}) => {
    if (!enabled || !grounded || mounted || insideRoom || !position || !place?.id) return false;
    // Biryong Realm resume intentionally waits for a region-specific Place Zone/ground contract.
    // Refusing the write is safer than restoring identical local x/z inside Campus.
    if (regionId !== WORLD_REGION_ID.CAMPUS) return false;
    const now = Number(clock.now());
    if (!Number.isFinite(now) || now <= 0 || now - lastWriteAt < saveIntervalMs) return false;

    const candidate = {
      version: WORLD_RESUME_VERSION,
      regionId,
      x: position.x, y: position.y, z: position.z,
      yawDeg, cameraYaw, savedAt: now,
      zoneId: place.id, displayName: place.displayName
    };
    const checked = validateResumeRecord(candidate, { expectedRegionId: WORLD_REGION_ID.CAMPUS });
    if (checked.state !== "VALID") return false;
    try {
      storage?.setItem?.(WORLD_RESUME_STORAGE_KEY, JSON.stringify(checked.record));
      lastWriteAt = now;
      return true;
    } catch {
      return false;
    }
  };

  return {
    read: () => readWorldResume(storage),
    maybeSave,
    clear() { try { storage?.removeItem?.(WORLD_RESUME_STORAGE_KEY); } catch {} },
    get lastWriteAt() { return lastWriteAt; }
  };
}
