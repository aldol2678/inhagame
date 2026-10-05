export const MUSIC_SCHEMA_VERSION = 1;
export const MUSIC_BUSES = Object.freeze(["music", "diegetic"]);
export const MUSIC_BINDING_TARGET_TYPES = Object.freeze(["placeZone", "place", "room"]);
export const MUSIC_BINDING_FALLBACKS = Object.freeze(["silence"]);

const copy = value => structuredClone(value);
const record = value => value !== null && typeof value === "object" && !Array.isArray(value);
const finite = value => Number.isFinite(Number(value));
const positive = value => finite(value) && Number(value) > 0;
const nonnegative = value => finite(value) && Number(value) >= 0;
const nonempty = value => typeof value === "string" && value.trim().length > 0;
const idPattern = /^[A-Za-z][A-Za-z0-9._-]{1,79}$/;

export function normalizeLoop(loop = {}) {
  return {
    enabled: Boolean(loop.enabled),
    startSeconds: Math.max(0, Number(loop.startSeconds) || 0),
    endSeconds: Math.max(0, Number(loop.endSeconds) || 0)
  };
}

export function normalizeMusicAsset(asset) {
  if (!record(asset)) throw new Error("E_MUSIC_ASSET_INVALID");
  return {
    id: String(asset.id || "").trim(),
    type: "audio",
    uri: String(asset.uri || "").trim(),
    title: String(asset.title || asset.fileName || "Untitled").trim(),
    artist: String(asset.artist || "").trim(),
    fileName: String(asset.fileName || "").trim(),
    mimeType: String(asset.mimeType || "").trim(),
    byteLength: Math.max(0, Number(asset.byteLength) || 0),
    durationSeconds: Math.max(0, Number(asset.durationSeconds) || 0),
    rights: {
      source: String(asset.rights?.source || "").trim(),
      license: String(asset.rights?.license || "").trim(),
      approved: asset.rights?.approved === true
    },
    editor: {
      loop: normalizeLoop(asset.editor?.loop)
    }
  };
}

export function normalizeMusicCue(cue) {
  if (!record(cue)) throw new Error("E_MUSIC_CUE_INVALID");
  return {
    id: String(cue.id || "").trim(),
    name: String(cue.name || cue.id || "Untitled Cue").trim(),
    assetId: String(cue.assetId || "").trim(),
    bus: MUSIC_BUSES.includes(cue.bus) ? cue.bus : String(cue.bus || "music").trim(),
    gain: Number.isFinite(Number(cue.gain)) ? Number(cue.gain) : 1,
    loop: normalizeLoop(cue.loop),
    transition: {
      fadeInSeconds: Math.max(0, Number(cue.transition?.fadeInSeconds) || 0),
      fadeOutSeconds: Math.max(0, Number(cue.transition?.fadeOutSeconds) || 0)
    },
    priority: Number.isFinite(Number(cue.priority)) ? Math.trunc(Number(cue.priority)) : 0,
    tags: Array.isArray(cue.tags) ? cue.tags.map(tag => String(tag).trim()).filter(Boolean) : [],
    notes: String(cue.notes || "").trim()
  };
}

export function normalizeMusicBinding(binding) {
  if (!record(binding)) throw new Error("E_MUSIC_BINDING_INVALID");
  return {
    id: String(binding.id || "").trim(),
    targetType: String(binding.targetType || "").trim(),
    targetId: String(binding.targetId || "").trim(),
    cueId: String(binding.cueId || "").trim(),
    enabled: binding.enabled !== false,
    priority: Number.isFinite(Number(binding.priority)) ? Math.trunc(Number(binding.priority)) : 0,
    fallback: MUSIC_BINDING_FALLBACKS.includes(binding.fallback) ? binding.fallback : String(binding.fallback || "silence").trim()
  };
}

export function createEmptyMusicProject({
  projectId = "inha-world-music-editor-sandbox",
  name = "INHA WORLD · Music Editor Sandbox"
} = {}) {
  return {
    schemaVersion: MUSIC_SCHEMA_VERSION,
    projectId,
    name,
    assets: [],
    cues: [],
    bindings: [],
    metadata: { createdBy: "music-editor-p0" }
  };
}

function validateLoop(loop, duration, path, error) {
  if (!record(loop)) { error("E_MUSIC_LOOP_INVALID", path); return; }
  if (typeof loop.enabled !== "boolean") error("E_MUSIC_LOOP_ENABLED_INVALID", `${path}.enabled`);
  if (!finite(loop.startSeconds) || !finite(loop.endSeconds)) {
    error("E_MUSIC_LOOP_NON_FINITE", path);
    return;
  }
  if (loop.startSeconds < 0 || loop.endSeconds < 0) error("E_MUSIC_LOOP_INVALID", path);
  if (loop.enabled && (loop.endSeconds <= loop.startSeconds || loop.endSeconds > duration + 1e-6)) {
    error("E_MUSIC_LOOP_INVALID", path);
  }
}

export function validateMusicProject(project, { placeZoneIds = null, placeIds = null, roomIds = null } = {}) {
  const diagnostics = [];
  const add = (severity, code, path, detail = null) => diagnostics.push({ severity, code, path, ...(detail ? { detail } : {}) });
  const error = (code, path, detail) => add("ERROR", code, path, detail);
  const warning = (code, path, detail) => add("WARNING", code, path, detail);

  if (!record(project)) {
    error("E_MUSIC_PROJECT_INVALID", "$");
    return { valid: false, diagnostics, errors: diagnostics, warnings: [] };
  }
  const allowed = new Set(["schemaVersion", "projectId", "name", "assets", "cues", "bindings", "metadata"]);
  for (const key of Object.keys(project)) if (!allowed.has(key)) error("E_MUSIC_FIELD_UNKNOWN", key);
  if (project.schemaVersion !== MUSIC_SCHEMA_VERSION) error("E_MUSIC_SCHEMA_UNSUPPORTED", "schemaVersion");
  if (!nonempty(project.projectId) || !idPattern.test(project.projectId)) error("E_MUSIC_PROJECT_ID_INVALID", "projectId");
  if (!nonempty(project.name)) error("E_MUSIC_PROJECT_NAME_INVALID", "name");
  if (!Array.isArray(project.assets)) error("E_MUSIC_ASSETS_INVALID", "assets");
  if (!Array.isArray(project.cues)) error("E_MUSIC_CUES_INVALID", "cues");
  if (!Array.isArray(project.bindings)) error("E_MUSIC_BINDINGS_INVALID", "bindings");
  if (project.metadata !== undefined && !record(project.metadata)) error("E_MUSIC_METADATA_INVALID", "metadata");

  const assetIds = new Set();
  const assetById = new Map();
  if (Array.isArray(project.assets)) project.assets.forEach((raw, index) => {
    const path = `assets[${index}]`;
    if (!record(raw)) { error("E_MUSIC_ASSET_INVALID", path); return; }
    let asset;
    try { asset = normalizeMusicAsset(raw); }
    catch { error("E_MUSIC_ASSET_INVALID", path); return; }
    if (!idPattern.test(asset.id)) error("E_MUSIC_ASSET_ID_INVALID", `${path}.id`);
    else if (assetIds.has(asset.id)) error("E_MUSIC_ASSET_ID_DUPLICATE", `${path}.id`, asset.id);
    else { assetIds.add(asset.id); assetById.set(asset.id, asset); }
    if (!nonempty(asset.uri)) error("E_MUSIC_ASSET_URI_INVALID", `${path}.uri`);
    if (!nonempty(asset.fileName)) warning("W_MUSIC_FILENAME_MISSING", `${path}.fileName`);
    if (!positive(asset.durationSeconds)) error("E_MUSIC_DURATION_INVALID", `${path}.durationSeconds`);
    if (asset.byteLength <= 0) warning("W_MUSIC_BYTE_LENGTH_UNKNOWN", `${path}.byteLength`);
    if (!asset.rights.source) warning("W_MUSIC_RIGHTS_SOURCE_MISSING", `${path}.rights.source`);
    if (!asset.rights.license) warning("W_MUSIC_LICENSE_MISSING", `${path}.rights.license`);
    validateLoop(asset.editor.loop, asset.durationSeconds, `${path}.editor.loop`, error);
  });

  const cueIds = new Set();
  if (Array.isArray(project.cues)) project.cues.forEach((raw, index) => {
    const path = `cues[${index}]`;
    if (!record(raw)) { error("E_MUSIC_CUE_INVALID", path); return; }
    let cue;
    try { cue = normalizeMusicCue(raw); }
    catch { error("E_MUSIC_CUE_INVALID", path); return; }
    if (!idPattern.test(cue.id)) error("E_MUSIC_CUE_ID_INVALID", `${path}.id`);
    else if (cueIds.has(cue.id)) error("E_MUSIC_CUE_ID_DUPLICATE", `${path}.id`, cue.id);
    else cueIds.add(cue.id);
    if (!nonempty(cue.name)) error("E_MUSIC_CUE_NAME_INVALID", `${path}.name`);
    if (!assetIds.has(cue.assetId)) error("E_MUSIC_CUE_ASSET_NOT_FOUND", `${path}.assetId`, cue.assetId);
    if (!MUSIC_BUSES.includes(cue.bus)) error("E_MUSIC_CUE_BUS_INVALID", `${path}.bus`, cue.bus);
    if (!nonnegative(cue.gain) || cue.gain > 2) error("E_MUSIC_CUE_GAIN_INVALID", `${path}.gain`);
    else if (cue.gain > 1) warning("W_MUSIC_CUE_GAIN_ABOVE_UNITY", `${path}.gain`);
    if (!nonnegative(cue.transition.fadeInSeconds)) error("E_MUSIC_CUE_FADE_INVALID", `${path}.transition.fadeInSeconds`);
    if (!nonnegative(cue.transition.fadeOutSeconds)) error("E_MUSIC_CUE_FADE_INVALID", `${path}.transition.fadeOutSeconds`);
    if (!Number.isInteger(cue.priority) || cue.priority < -999 || cue.priority > 999) {
      error("E_MUSIC_CUE_PRIORITY_INVALID", `${path}.priority`);
    }
    if (!Array.isArray(cue.tags) || !cue.tags.every(tag => nonempty(tag))) error("E_MUSIC_CUE_TAGS_INVALID", `${path}.tags`);
    const asset = assetById.get(cue.assetId);
    if (asset) validateLoop(cue.loop, asset.durationSeconds, `${path}.loop`, error);
  });

  const bindingIds = new Set();
  const targetPriority = new Set();
  if (Array.isArray(project.bindings)) project.bindings.forEach((raw, index) => {
    const path = `bindings[${index}]`;
    if (!record(raw)) { error("E_MUSIC_BINDING_INVALID", path); return; }
    let binding;
    try { binding = normalizeMusicBinding(raw); }
    catch { error("E_MUSIC_BINDING_INVALID", path); return; }
    if (!idPattern.test(binding.id)) error("E_MUSIC_BINDING_ID_INVALID", `${path}.id`);
    else if (bindingIds.has(binding.id)) error("E_MUSIC_BINDING_ID_DUPLICATE", `${path}.id`, binding.id);
    else bindingIds.add(binding.id);
    if (!MUSIC_BINDING_TARGET_TYPES.includes(binding.targetType)) {
      error("E_MUSIC_BINDING_TARGET_TYPE_INVALID", `${path}.targetType`, binding.targetType);
    }
    const expected = binding.targetType === "placeZone"
      ? /^AREA_[A-Z0-9_]+$/
      : binding.targetType === "place"
        ? /^PLACE_[A-Z0-9_]+$/
        : /^ROOM_[A-Z0-9_]+$/;
    if (!nonempty(binding.targetId) || !expected.test(binding.targetId)) {
      error("E_MUSIC_BINDING_TARGET_ID_INVALID", `${path}.targetId`, binding.targetId);
    } else {
      const known = binding.targetType === "placeZone" ? placeZoneIds
        : binding.targetType === "place" ? placeIds
          : roomIds;
      if (known && !known.has(binding.targetId)) warning("W_MUSIC_BINDING_TARGET_UNKNOWN", `${path}.targetId`, binding.targetId);
    }
    if (!cueIds.has(binding.cueId)) error("E_MUSIC_BINDING_CUE_NOT_FOUND", `${path}.cueId`, binding.cueId);
    if (typeof binding.enabled !== "boolean") error("E_MUSIC_BINDING_ENABLED_INVALID", `${path}.enabled`);
    if (!Number.isInteger(binding.priority) || binding.priority < -999 || binding.priority > 999) {
      error("E_MUSIC_BINDING_PRIORITY_INVALID", `${path}.priority`);
    }
    if (!MUSIC_BINDING_FALLBACKS.includes(binding.fallback)) {
      error("E_MUSIC_BINDING_FALLBACK_INVALID", `${path}.fallback`, binding.fallback);
    }
    if (binding.enabled && MUSIC_BINDING_TARGET_TYPES.includes(binding.targetType)) {
      const conflictKey = `${binding.targetType}:${binding.targetId}:${binding.priority}`;
      if (targetPriority.has(conflictKey)) error("E_MUSIC_BINDING_PRIORITY_CONFLICT", path, conflictKey);
      else targetPriority.add(conflictKey);
    }
  });

  const errors = diagnostics.filter(item => item.severity === "ERROR");
  return { valid: errors.length === 0, diagnostics, errors, warnings: diagnostics.filter(item => item.severity === "WARNING") };
}

export function normalizeMusicProject(project) {
  const normalized = copy(project);
  normalized.schemaVersion = Number(normalized.schemaVersion);
  normalized.projectId = String(normalized.projectId || "").trim();
  normalized.name = String(normalized.name || "").trim();
  normalized.assets = Array.isArray(normalized.assets) ? normalized.assets.map(normalizeMusicAsset) : [];
  normalized.cues = Array.isArray(normalized.cues) ? normalized.cues.map(normalizeMusicCue) : [];
  normalized.bindings = Array.isArray(normalized.bindings) ? normalized.bindings.map(normalizeMusicBinding) : [];
  normalized.metadata = record(normalized.metadata) ? copy(normalized.metadata) : {};
  return normalized;
}

export function parseMusicProject(text) {
  let parsed;
  try { parsed = JSON.parse(text); }
  catch { throw new Error("E_MUSIC_JSON_INVALID"); }
  const normalized = normalizeMusicProject(parsed);
  const validation = validateMusicProject(normalized);
  if (!validation.valid) throw new Error(`${validation.errors[0].code}:${validation.errors[0].path}`);
  return normalized;
}

export function serializeMusicProject(project) {
  const normalized = normalizeMusicProject(project);
  const validation = validateMusicProject(normalized);
  if (!validation.valid) throw new Error(`${validation.errors[0].code}:${validation.errors[0].path}`);
  return JSON.stringify(normalized, null, 2) + "\n";
}

export class MusicDocument {
  constructor(project = createEmptyMusicProject()) {
    this._project = normalizeMusicProject(project);
    const validation = validateMusicProject(this._project);
    if (!validation.valid) throw new Error(`${validation.errors[0].code}:${validation.errors[0].path}`);
    this.revision = 0;
    this.savedRevision = 0;
    this._listeners = new Set();
  }

  get projectId() { return this._project.projectId; }
  get name() { return this._project.name; }
  get dirty() { return this.revision !== this.savedRevision; }
  snapshot() { return copy(this._project); }
  assets() { return this._project.assets.map(copy); }
  cues() { return this._project.cues.map(copy); }
  bindings() { return this._project.bindings.map(copy); }
  getAsset(id) { const asset = this._project.assets.find(item => item.id === id); return asset ? copy(asset) : null; }
  getCue(id) { const cue = this._project.cues.find(item => item.id === id); return cue ? copy(cue) : null; }
  getBinding(id) { const binding = this._project.bindings.find(item => item.id === id); return binding ? copy(binding) : null; }

  subscribe(listener) {
    this._listeners.add(listener);
    return () => this._listeners.delete(listener);
  }

  _emit(type) {
    const event = Object.freeze({ type, revision: this.revision, dirty: this.dirty, projectId: this.projectId });
    for (const listener of this._listeners) listener(event);
  }

  _replace(next, type) {
    const normalized = normalizeMusicProject(next);
    const validation = validateMusicProject(normalized);
    if (!validation.valid) throw new Error(`${validation.errors[0].code}:${validation.errors[0].path}`);
    if (JSON.stringify(normalized) === JSON.stringify(this._project)) return false;
    this._project = normalized;
    this.revision += 1;
    this._emit(type);
    return true;
  }

  _commit(type, mutate) {
    const next = this.snapshot();
    mutate(next);
    return this._replace(next, type);
  }

  restoreSnapshot(snapshot, type = "history") {
    return this._replace(snapshot, type);
  }

  markSaved() {
    this.savedRevision = this.revision;
    this._emit("saved");
  }

  markDirty() {
    if (this.dirty) return false;
    this.savedRevision = this.revision - 1;
    this._emit("dirty");
    return true;
  }

  rename(name) {
    return this._commit("rename", project => { project.name = String(name || "").trim(); });
  }

  addAsset(candidate) {
    const asset = normalizeMusicAsset(candidate);
    this._commit("asset-added", project => { project.assets.push(asset); });
    return asset;
  }

  updateAsset(id, patch) {
    return this._commit("asset-updated", project => {
      const index = project.assets.findIndex(asset => asset.id === id);
      if (index < 0) throw new Error(`E_MUSIC_ASSET_NOT_FOUND:${id}`);
      project.assets[index] = normalizeMusicAsset({ ...project.assets[index], ...copy(patch) });
    });
  }

  setAssetLoop(id, loop) {
    return this._commit("loop-updated", project => {
      const asset = project.assets.find(item => item.id === id);
      if (!asset) throw new Error(`E_MUSIC_ASSET_NOT_FOUND:${id}`);
      asset.editor = { ...(asset.editor || {}), loop: normalizeLoop(loop) };
    });
  }

  removeAsset(id) {
    return this._commit("asset-removed", project => {
      const before = project.assets.length;
      project.assets = project.assets.filter(asset => asset.id !== id);
      if (project.assets.length === before) throw new Error(`E_MUSIC_ASSET_NOT_FOUND:${id}`);
    });
  }

  addCue(candidate) {
    const cue = normalizeMusicCue(candidate);
    this._commit("cue-added", project => { project.cues.push(cue); });
    return cue;
  }

  updateCue(id, patch) {
    return this._commit("cue-updated", project => {
      const index = project.cues.findIndex(cue => cue.id === id);
      if (index < 0) throw new Error(`E_MUSIC_CUE_NOT_FOUND:${id}`);
      const before = project.cues[index];
      const after = normalizeMusicCue({
        ...before,
        ...copy(patch),
        transition: patch.transition ? { ...before.transition, ...copy(patch.transition) } : before.transition,
        loop: patch.loop ? { ...before.loop, ...copy(patch.loop) } : before.loop
      });
      project.cues[index] = after;
      if (after.id !== before.id) {
        project.bindings = project.bindings.map(binding =>
          binding.cueId === before.id ? { ...binding, cueId: after.id } : binding);
      }
    });
  }

  removeCue(id) {
    return this._commit("cue-removed", project => {
      const before = project.cues.length;
      project.cues = project.cues.filter(cue => cue.id !== id);
      if (project.cues.length === before) throw new Error(`E_MUSIC_CUE_NOT_FOUND:${id}`);
    });
  }

  addBinding(candidate) {
    const binding = normalizeMusicBinding(candidate);
    this._commit("binding-added", project => { project.bindings.push(binding); });
    return binding;
  }

  updateBinding(id, patch) {
    return this._commit("binding-updated", project => {
      const index = project.bindings.findIndex(binding => binding.id === id);
      if (index < 0) throw new Error(`E_MUSIC_BINDING_NOT_FOUND:${id}`);
      project.bindings[index] = normalizeMusicBinding({ ...project.bindings[index], ...copy(patch) });
    });
  }

  removeBinding(id) {
    return this._commit("binding-removed", project => {
      const before = project.bindings.length;
      project.bindings = project.bindings.filter(binding => binding.id !== id);
      if (project.bindings.length === before) throw new Error(`E_MUSIC_BINDING_NOT_FOUND:${id}`);
    });
  }
}
