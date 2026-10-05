export function normalizeMusicState(state = {}) {
  const space = typeof state.space === "string" && state.space ? state.space : "campus";
  const normalized = {
    space,
    placeZoneId: space === "campus" && typeof state.placeZoneId === "string" ? state.placeZoneId : null
  };
  if (space === "campus" && typeof state.placeId === "string" && state.placeId) {
    normalized.placeId = state.placeId;
  }
  return Object.freeze(normalized);
}

function bestBinding(bindings, targetType, targetId) {
  if (!targetId) return null;
  return bindings
    .filter(item => item?.enabled === true && item.targetType === targetType && item.targetId === targetId)
    .sort((a, b) => Number(b.priority || 0) - Number(a.priority || 0) || String(a.id).localeCompare(String(b.id)))[0] ?? null;
}

export function resolveMusicBinding(project, state = {}) {
  const desired = normalizeMusicState(state);
  const bindings = Array.isArray(project?.bindings) ? project.bindings : [];
  const cues = Array.isArray(project?.cues) ? project.cues : [];
  const assets = Array.isArray(project?.assets) ? project.assets : [];

  const candidates = desired.space === "campus"
    ? [
        ...(desired.placeId ? [{ targetType: "place", targetId: desired.placeId }] : []),
        ...(desired.placeZoneId ? [{ targetType: "placeZone", targetId: desired.placeZoneId }] : [])
      ]
    : [{ targetType: "room", targetId: desired.space }];

  const primary = candidates[0] ?? {
    targetType: desired.space === "campus" ? "placeZone" : "room",
    targetId: desired.space === "campus" ? null : desired.space
  };

  let selected = primary;
  let binding = null;
  for (const candidate of candidates) {
    const match = bestBinding(bindings, candidate.targetType, candidate.targetId);
    if (!match) continue;
    selected = candidate;
    binding = match;
    break;
  }

  if (!binding) {
    return Object.freeze({
      state: desired,
      targetType: primary.targetType,
      targetId: primary.targetId,
      binding: null,
      cue: null,
      asset: null
    });
  }

  const cue = cues.find(item => item?.id === binding.cueId) ?? null;
  const asset = cue ? assets.find(item => item?.id === cue.assetId) ?? null : null;
  return Object.freeze({
    state: desired,
    targetType: selected.targetType,
    targetId: selected.targetId,
    binding,
    cue,
    asset
  });
}
