import {
  MusicDocument,
  createEmptyMusicProject,
  parseMusicProject,
  serializeMusicProject
} from "./music-document.js";
import { MusicBrowserStore } from "./music-browser-store.js";
import { MusicCommands } from "./music-commands.js";
import { createMusicPreviewRuntime } from "./music-preview-runtime.js";
import {
  buildMusicExportCandidate,
  describeMusicDiagnostic,
  diagnoseMusicProject
} from "./music-validation.js";
import { WaveformView } from "./waveform-view.js";
import { PLACE_ZONES } from "../place-zone-registry.js";
import { ROOMS } from "../rooms/room-registry.js";
import { MUSIC_PLACE_TARGETS } from "./music-place-targets.js";
import { loadRuntimeMusicProject } from "../audio/music-runtime-config.js";

const STUDIO_AUDIO_BRIDGE_CHANNEL = "inha.studio.audio/1";
const STUDIO_HOST_MODE = new URLSearchParams(globalThis.location?.search || "").get("studioHost") === "1" &&
  globalThis.parent && globalThis.parent !== globalThis;
if (STUDIO_HOST_MODE) document.documentElement.dataset.studioHost = "true";

const ACCEPTED_AUDIO = new Set(["audio/wav", "audio/x-wav", "audio/mpeg", "audio/mp3", "audio/ogg"]);
const TARGET_CATALOGS = Object.freeze({
  placeZone: Object.freeze(PLACE_ZONES.map(zone => Object.freeze({ id: zone.id, label: zone.displayName }))),
  place: MUSIC_PLACE_TARGETS,
  room: Object.freeze(Object.values(ROOMS).map(room => Object.freeze({ id: room.id, label: room.label })))
});
const PLACE_ZONE_IDS = new Set(TARGET_CATALOGS.placeZone.map(item => item.id));
const PLACE_IDS = new Set(TARGET_CATALOGS.place.map(item => item.id));
const ROOM_IDS = new Set(TARGET_CATALOGS.room.map(item => item.id));
const safeName = value => String(value || "").trim();
const slug = value => safeName(value).toLowerCase()
  .replace(/\.[^.]+$/, "")
  .replace(/[^a-z0-9]+/giu, "-")
  .replace(/^-+|-+$/g, "")
  .slice(0, 40) || "track";
const formatTime = seconds => {
  const value = Math.max(0, Number(seconds) || 0);
  const minutes = Math.floor(value / 60);
  const rest = value - minutes * 60;
  return `${minutes}:${rest.toFixed(1).padStart(4, "0")}`;
};

const els = {
  name: document.getElementById("music-project-name"),
  dirty: document.getElementById("music-dirty"),
  revision: document.getElementById("music-revision"),
  fileStatus: document.getElementById("music-file-status"),
  persistence: document.getElementById("music-persistence"),
  validation: document.getElementById("music-validation"),
  assetCount: document.getElementById("music-asset-count"),
  library: document.getElementById("music-library"),
  cues: document.getElementById("music-cues"),
  cueCount: document.getElementById("music-cue-count"),
  addCue: document.getElementById("music-add-cue"),
  bindings: document.getElementById("music-bindings"),
  bindingCount: document.getElementById("music-binding-count"),
  addBinding: document.getElementById("music-add-binding"),
  inspector: document.getElementById("music-inspector"),
  waveform: document.getElementById("music-waveform"),
  empty: document.getElementById("music-empty-state"),
  transport: document.getElementById("music-transport"),
  play: document.getElementById("music-play"),
  stop: document.getElementById("music-stop"),
  time: document.getElementById("music-time"),
  loopEnabled: document.getElementById("music-loop-enabled"),
  loopStartRange: document.getElementById("music-loop-start-range"),
  loopEndRange: document.getElementById("music-loop-end-range"),
  loopStart: document.getElementById("music-loop-start"),
  loopEnd: document.getElementById("music-loop-end"),
  addAudio: document.getElementById("music-add-audio"),
  audioInput: document.getElementById("music-audio-input"),
  newProject: document.getElementById("music-new"),
  openProject: document.getElementById("music-open-project"),
  save: document.getElementById("music-save"),
  importProject: document.getElementById("music-import"),
  projectInput: document.getElementById("music-project-input"),
  exportProject: document.getElementById("music-export"),
  validate: document.getElementById("music-validate"),
  undo: document.getElementById("music-undo"),
  redo: document.getElementById("music-redo"),
  previewUnlock: document.getElementById("music-preview-unlock"),
  previewSpace: document.getElementById("music-preview-space"),
  previewPlaceZone: document.getElementById("music-preview-place-zone"),
  previewPlace: document.getElementById("music-preview-place"),
  previewMaster: document.getElementById("music-preview-master"),
  previewMasterValue: document.getElementById("music-preview-master-value"),
  previewMusic: document.getElementById("music-preview-music"),
  previewMusicValue: document.getElementById("music-preview-music-value"),
  previewMuted: document.getElementById("music-preview-muted"),
  previewState: document.getElementById("music-preview-state"),
  previewTarget: document.getElementById("music-preview-target"),
  previewBinding: document.getElementById("music-preview-binding"),
  previewCue: document.getElementById("music-preview-cue"),
  previewSources: document.getElementById("music-preview-sources"),
  previewContext: document.getElementById("music-preview-context"),
  previewError: document.getElementById("music-preview-error"),
  placePreviewSelect: document.getElementById("music-place-preview-select"),
  placePreviewToggle: document.getElementById("music-place-preview-toggle"),
  placePreviewState: document.getElementById("music-place-preview-state"),
  placePreviewStatus: document.getElementById("music-place-preview-status"),
  placePreviewShell: document.getElementById("music-place-preview-shell"),
  placePreviewCanvas: document.getElementById("music-place-preview-canvas"),
  productionReload: document.getElementById("music-production-reload"),
  productionClone: document.getElementById("music-production-clone"),
  auditionSource: document.getElementById("music-place-audition-source"),
  auditionHere: document.getElementById("music-place-audition"),
  productionStatus: document.getElementById("music-production-status"),
  projectDialog: document.getElementById("music-project-dialog"),
  projectList: document.getElementById("music-project-list"),
  projectCancel: document.getElementById("music-project-cancel"),
  validationDialog: document.getElementById("music-validation-dialog"),
  validationSummary: document.getElementById("music-validation-summary"),
  validationList: document.getElementById("music-validation-list"),
  validationClose: document.getElementById("music-validation-close")
};

let store = null;
let music = new MusicDocument(createEmptyMusicProject());
let commands = new MusicCommands(music);
let unsubscribe = null;
let unsubscribeCommands = null;
let unsubscribePreview = null;
let selectedAssetId = null;
let selectedCueId = null;
let selectedBindingId = null;
let audioContext = null;
let source = null;
let sourceGain = null;
let sourceStartedAt = 0;
let sourceOffset = 0;
let playing = false;
let raf = 0;
let recoveryTimer = 0;
let placeScenePreview = null;
let productionSnapshot = null;
let previewProjectSource = "draft";
let studioBridgeReady = false;
let lastStudioBridgeStatus = "";
const buffers = new Map();
const waveform = new WaveformView(els.waveform);
const preview = createMusicPreviewRuntime({
  getProject: () => previewProjectSource === "production" && productionSnapshot
    ? structuredClone(productionSnapshot)
    : music.snapshot(),
  loadAssetBlob: asset => loadPreviewAssetBlob(asset)
});

function audioContentSnapshot() {
  return {
    moduleId: "audio",
    sections: [
      {
        id: "assets",
        label: "AUDIO ASSETS",
        items: music.assets().map(asset => ({
          kind: "asset",
          id: asset.id,
          assetType: "audio",
          sourceKind: "audio-asset",
          label: asset.title || asset.id,
          detail: `${asset.fileName || asset.uri || "audio"} · ${formatTime(asset.durationSeconds)}`,
          selected: asset.id === selectedAssetId && !selectedCueId && !selectedBindingId,
          selectable: true
        }))
      },
      {
        id: "cues",
        label: "CUES",
        items: music.cues().map(cue => ({
          kind: "cue",
          id: cue.id,
          label: cue.name || cue.id,
          detail: `${cue.bus} · ${cue.assetId} · gain ${Number(cue.gain).toFixed(2)}`,
          selected: cue.id === selectedCueId && !selectedBindingId,
          selectable: true
        }))
      },
      {
        id: "bindings",
        label: "BINDINGS",
        items: music.bindings().map(binding => ({
          kind: "binding",
          id: binding.id,
          label: `${targetLabel(binding.targetType, binding.targetId)} → ${music.getCue(binding.cueId)?.name || binding.cueId}`,
          detail: `${binding.targetType} · p${binding.priority} · ${binding.enabled ? "enabled" : "disabled"}`,
          selected: binding.id === selectedBindingId,
          selectable: true
        }))
      }
    ]
  };
}

function audioInspectorSnapshot() {
  const binding = selectedBindingId ? music.getBinding(selectedBindingId) : null;
  if (binding) {
    const cue = music.getCue(binding.cueId);
    return {
      moduleId: "audio",
      selection: {
        kind: "binding",
        id: binding.id,
        title: targetLabel(binding.targetType, binding.targetId),
        subtitle: cue?.name || binding.cueId
      },
      fields: [
        { key: "enabled", label: "Enabled", type: "checkbox", value: binding.enabled, editable: true },
        { key: "priority", label: "Priority", type: "number", value: binding.priority, min: -999, max: 999, step: 1, editable: true },
        { key: "targetType", label: "Target Type", type: "readonly", value: binding.targetType, editable: false },
        { key: "targetId", label: "Target", type: "readonly", value: binding.targetId, editable: false },
        { key: "cueId", label: "Cue", type: "readonly", value: binding.cueId, editable: false },
        { key: "id", label: "Binding ID", type: "readonly", value: binding.id, editable: false }
      ]
    };
  }

  const cue = selectedCueId ? music.getCue(selectedCueId) : null;
  if (cue) {
    return {
      moduleId: "audio",
      selection: {
        kind: "cue",
        id: cue.id,
        title: cue.name,
        subtitle: cue.assetId
      },
      fields: [
        { key: "name", label: "Name", type: "text", value: cue.name, editable: true },
        { key: "bus", label: "Bus", type: "select", value: cue.bus, options: ["music", "diegetic"], editable: true },
        { key: "gain", label: "Gain", type: "number", value: cue.gain, min: 0, max: 2, step: 0.01, editable: true },
        { key: "priority", label: "Priority", type: "number", value: cue.priority, min: -999, max: 999, step: 1, editable: true },
        { key: "assetId", label: "Asset", type: "readonly", value: cue.assetId, editable: false },
        { key: "id", label: "Cue ID", type: "readonly", value: cue.id, editable: false }
      ]
    };
  }

  const asset = selectedAssetId ? music.getAsset(selectedAssetId) : null;
  if (asset) {
    return {
      moduleId: "audio",
      selection: {
        kind: "asset",
        id: asset.id,
        title: asset.title,
        subtitle: asset.fileName || asset.uri
      },
      fields: [
        { key: "title", label: "Title", type: "text", value: asset.title, editable: true },
        { key: "artist", label: "Artist", type: "text", value: asset.artist, editable: true },
        { key: "duration", label: "Duration", type: "readonly", value: formatTime(asset.durationSeconds), editable: false },
        { key: "fileName", label: "File", type: "readonly", value: asset.fileName, editable: false },
        { key: "id", label: "Asset ID", type: "readonly", value: asset.id, editable: false }
      ]
    };
  }

  return { moduleId: "audio", selection: null, fields: [] };
}

function updateStudioAudioInspector(payload = {}) {
  const kind = String(payload.kind || "");
  const id = String(payload.id || "");
  const field = String(payload.field || "");
  const value = payload.value;

  if (kind === "asset") {
    if (!music.getAsset(id)) throw new Error(`E_MUSIC_ASSET_NOT_FOUND:${id}`);
    if (!["title", "artist"].includes(field)) throw new Error(`E_STUDIO_AUDIO_INSPECTOR_FIELD_UNKNOWN:${kind}:${field}`);
    commands.updateAsset(id, { [field]: String(value ?? "").trim() }, `Set Asset ${field}`);
  } else if (kind === "cue") {
    if (!music.getCue(id)) throw new Error(`E_MUSIC_CUE_NOT_FOUND:${id}`);
    if (field === "name") {
      const name = String(value || "").trim();
      if (!name) throw new Error("E_MUSIC_CUE_NAME_INVALID");
      commands.updateCue(id, { name }, "Set Cue name");
    } else if (field === "bus") {
      if (!["music", "diegetic"].includes(value)) throw new Error("E_MUSIC_CUE_BUS_INVALID");
      commands.updateCue(id, { bus: value }, "Set Cue bus");
    } else if (field === "gain") {
      const gain = Number(value);
      if (!Number.isFinite(gain)) throw new Error("E_MUSIC_CUE_GAIN_INVALID");
      commands.updateCue(id, { gain }, "Set Cue gain");
    } else if (field === "priority") {
      const priority = Number(value);
      if (!Number.isInteger(priority)) throw new Error("E_MUSIC_CUE_PRIORITY_INVALID");
      commands.updateCue(id, { priority }, "Set Cue priority");
    } else {
      throw new Error(`E_STUDIO_AUDIO_INSPECTOR_FIELD_UNKNOWN:${kind}:${field}`);
    }
  } else if (kind === "binding") {
    if (!music.getBinding(id)) throw new Error(`E_MUSIC_BINDING_NOT_FOUND:${id}`);
    if (field === "enabled") {
      commands.updateBinding(id, { enabled: Boolean(value) }, "Set Binding enabled");
    } else if (field === "priority") {
      const priority = Number(value);
      if (!Number.isInteger(priority)) throw new Error("E_MUSIC_BINDING_PRIORITY_INVALID");
      commands.updateBinding(id, { priority }, "Set Binding priority");
    } else {
      throw new Error(`E_STUDIO_AUDIO_INSPECTOR_FIELD_UNKNOWN:${kind}:${field}`);
    }
  } else {
    throw new Error(`E_STUDIO_AUDIO_INSPECTOR_KIND_UNKNOWN:${kind}`);
  }

  render();
  postAudioBridge("status");
  return audioInspectorSnapshot();
}

function audioBridgeStatus() {
  const runtime = preview.status();
  const place = placeScenePreview?.status?.() ?? { state: "idle" };
  return {
    ready: studioBridgeReady,
    projectId: music?.projectId ?? null,
    name: music?.name ?? null,
    dirty: Boolean(music?.dirty),
    revision: music?.revision ?? 0,
    assetCount: music?.assets?.().length ?? 0,
    cueCount: music?.cues?.().length ?? 0,
    bindingCount: music?.bindings?.().length ?? 0,
    selectedAssetId,
    selectedCueId,
    selectedBindingId,
    canSave: Boolean(store),
    canUndo: Boolean(commands?.canUndo),
    canRedo: Boolean(commands?.canRedo),
    history: {
      undoCount: commands?.undoStack?.length ?? 0,
      redoCount: commands?.redoStack?.length ?? 0,
      nextUndo: commands?.undoStack?.at(-1)?.label ?? null,
      nextRedo: commands?.redoStack?.at(-1)?.label ?? null
    },
    previewContext: runtime.context,
    previewEnabled: runtime.context === "running",
    previewCueId: runtime.cueId,
    previewCueName: runtime.cueName,
    previewTargetId: runtime.targetId,
    previewSources: runtime.activeSources,
    previewMuted: runtime.muted,
    previewProjectSource,
    productionLoaded: Boolean(productionSnapshot),
    placePreviewOpen: Boolean(placeScenePreview),
    placePreviewState: place.state ?? "idle",
    placePreviewId: place.placeId ?? null,
    fileStatus: els.fileStatus?.textContent || "",
    persistence: els.persistence?.textContent || "Persistence: 연결 중"
  };
}

function postAudioBridge(type = "status", extra = {}) {
  if (!STUDIO_HOST_MODE) return;
  const status = audioBridgeStatus();
  const serialized = JSON.stringify(status);
  if (type === "status" && serialized === lastStudioBridgeStatus) return;
  if (type === "status") lastStudioBridgeStatus = serialized;
  globalThis.parent.postMessage({
    channel: STUDIO_AUDIO_BRIDGE_CHANNEL,
    type,
    status,
    ...extra
  }, globalThis.location.origin);
}

function report(message, tone = "normal") {
  els.fileStatus.textContent = message;
  els.fileStatus.dataset.tone = tone;
  postAudioBridge("status");
}

const validationContext = () => ({ placeZoneIds: PLACE_ZONE_IDS, placeIds: PLACE_IDS, roomIds: ROOM_IDS });

async function loadPreviewAssetBlob(asset) {
  if (!asset) return null;
  const uri = String(asset.uri || "");
  if (uri.startsWith("project://")) {
    return store?.readAssetBlob(music.projectId, asset.id) ?? null;
  }
  if (!uri) return null;
  const response = await fetch(uri, { cache: "no-store" });
  if (!response.ok) throw new Error(`E_MUSIC_PREVIEW_ASSET_HTTP:${response.status}:${asset.id}`);
  return response.blob();
}

function renderValidationReport(result, { open = false } = {}) {
  els.validationSummary.textContent = `${result.counts.errors} errors · ${result.counts.warnings} warnings`;
  els.validationList.replaceChildren();
  if (!result.diagnostics.length) {
    const empty = document.createElement("div");
    empty.className = "validation-empty";
    empty.textContent = "Validation PASS · 진단 없음";
    els.validationList.append(empty);
  } else {
    for (const item of result.diagnostics) {
      const row = document.createElement("div");
      row.className = "validation-row";
      row.dataset.severity = item.severity;
      row.dataset.code = item.code;
      row.innerHTML = '<span class="severity"></span><div><strong></strong><code></code><small></small></div>';
      row.querySelector(".severity").textContent = item.severity;
      row.querySelector("strong").textContent = describeMusicDiagnostic(item);
      row.querySelector("code").textContent = `${item.code} · ${item.path}`;
      row.querySelector("small").textContent = item.detail ? `detail: ${item.detail}` : "";
      els.validationList.append(row);
    }
  }
  if (open && !els.validationDialog.open) els.validationDialog.showModal();
}

async function buildCurrentExportCandidate() {
  return buildMusicExportCandidate(music.snapshot(), {
    ...validationContext(),
    hasAssetBlob: async asset => Boolean(await store?.readAssetBlob(music.projectId, asset.id))
  });
}

function previewStateFromControls() {
  const space = els.previewSpace.value || "campus";
  return space === "campus"
    ? { space, placeZoneId: els.previewPlaceZone.value || null, placeId: els.previewPlace.value || null }
    : { space, placeZoneId: null };
}

function renderPreviewStatus(status = preview.status()) {
  const state = status.degraded ? "degraded" : status.context;
  els.previewState.dataset.state = state;
  els.previewState.textContent = state;
  els.previewUnlock.textContent = status.context === "running" ? "✓ Preview Enabled" : "▶ Enable Preview";
  const target = status.targetId
    ? `${targetLabel(status.targetType, status.targetId)} · ${status.targetId}`
    : "—";
  els.previewTarget.textContent = target;
  els.previewBinding.textContent = status.bindingId || "—";
  els.previewCue.textContent = status.cueName ? `${status.cueName} · ${status.cueId}` : "—";
  els.previewSources.textContent = `${status.activeSources}${status.fadingSources ? ` (${status.fadingSources} fading)` : ""}`;
  els.previewContext.textContent = status.context;
  els.previewMasterValue.value = Number(status.masterVolume).toFixed(2);
  els.previewMusicValue.value = Number(status.musicVolume).toFixed(2);
  els.previewMuted.checked = status.muted;
  els.previewError.hidden = !status.lastError;
  els.previewError.textContent = status.lastError ? `Preview degraded · ${status.lastError}` : "";
  postAudioBridge("status");
}

function initPreviewControls() {
  els.previewSpace.replaceChildren();
  const campus = document.createElement("option");
  campus.value = "campus";
  campus.textContent = "Campus";
  els.previewSpace.append(campus);
  for (const room of targetCatalog("room")) {
    const option = document.createElement("option");
    option.value = room.id;
    option.textContent = `${room.label} · ${room.id}`;
    els.previewSpace.append(option);
  }

  els.previewPlaceZone.replaceChildren();
  for (const zone of targetCatalog("placeZone")) {
    const option = document.createElement("option");
    option.value = zone.id;
    option.textContent = `${zone.label} · ${zone.id}`;
    els.previewPlaceZone.append(option);
  }
  els.previewPlace.replaceChildren();
  const noPlace = document.createElement("option");
  noPlace.value = "";
  noPlace.textContent = "No specific place";
  els.previewPlace.append(noPlace);
  for (const place of targetCatalog("place")) {
    const option = document.createElement("option");
    option.value = place.id;
    option.textContent = `${place.label} · ${place.id}`;
    els.previewPlace.append(option);
  }
  els.previewSpace.value = "campus";
  els.previewPlaceZone.value = PLACE_ZONE_IDS.has("AREA_MAIN_GATE") ? "AREA_MAIN_GATE" : targetCatalog("placeZone")[0]?.id ?? "";
  els.previewPlace.value = "";

  const setWorldState = () => {
    const campus = els.previewSpace.value === "campus";
    els.previewPlaceZone.disabled = !campus;
    els.previewPlace.disabled = !campus;
    void preview.setState(previewStateFromControls());
  };
  els.previewSpace.addEventListener("change", setWorldState);
  els.previewPlaceZone.addEventListener("change", setWorldState);
  els.previewPlace.addEventListener("change", setWorldState);
  els.previewMaster.addEventListener("input", () => preview.setMasterVolume(Number(els.previewMaster.value)));
  els.previewMusic.addEventListener("input", () => preview.setMusicVolume(Number(els.previewMusic.value)));
  els.previewMuted.addEventListener("change", () => preview.setMuted(els.previewMuted.checked));
  els.previewUnlock.addEventListener("click", async () => {
    stopPlayback();
    const ok = await preview.unlock();
    report(ok ? "Runtime Preview audio enabled" : `Runtime Preview unavailable · ${preview.status().lastError || "audio locked"}`,
      ok ? "success" : "error");
  });
  setWorldState();
}


function renderProductionStatus(message = null, tone = "normal") {
  const snapshot = productionSnapshot;
  if (message) {
    els.productionStatus.textContent = message;
    els.productionStatus.dataset.tone = tone;
    return;
  }
  if (!snapshot) {
    els.productionStatus.textContent = "Production snapshot 미로드";
    els.productionStatus.dataset.tone = "normal";
    return;
  }
  const source = previewProjectSource === "production" ? "PRODUCTION" : "DRAFT";
  els.productionStatus.textContent =
    `Production loaded · ${snapshot.assets.length} assets · ${snapshot.cues.length} cues · ${snapshot.bindings.length} bindings · A/B ${source}`;
  els.productionStatus.dataset.tone = "success";
}

function setPreviewProjectSource(value) {
  const next = value === "production" && productionSnapshot ? "production" : "draft";
  previewProjectSource = next;
  els.auditionSource.value = next;
  void preview.refresh();
  renderProductionStatus();
  postAudioBridge("status");
  return next;
}

async function loadProductionSnapshot() {
  els.productionReload.disabled = true;
  renderProductionStatus("Production snapshot 불러오는 중…");
  try {
    productionSnapshot = await loadRuntimeMusicProject();
    const productionOption = els.auditionSource.querySelector('option[value="production"]');
    if (productionOption) productionOption.disabled = false;
    els.productionClone.disabled = false;
    renderProductionStatus();
    if (previewProjectSource === "production") await preview.refresh();
    postAudioBridge("status");
    return productionSnapshot;
  } catch (error) {
    productionSnapshot = null;
    const productionOption = els.auditionSource.querySelector('option[value="production"]');
    if (productionOption) productionOption.disabled = true;
    els.productionClone.disabled = true;
    if (previewProjectSource === "production") setPreviewProjectSource("draft");
    renderProductionStatus(`Production load 실패 · ${error.message}`, "error");
    postAudioBridge("status");
    return null;
  } finally {
    els.productionReload.disabled = false;
  }
}

function cloneProductionToDraft() {
  if (!productionSnapshot) return false;
  const draft = structuredClone(productionSnapshot);
  const stamp = Date.now().toString(36);
  const baseId = String(productionSnapshot.projectId || "inha-world-music-production")
    .replace(/-runtime$/i, "")
    .slice(0, 54);
  draft.projectId = `${baseId}-draft-${stamp}`;
  draft.name = `${productionSnapshot.name} · Draft`;
  draft.metadata = {
    ...(draft.metadata || {}),
    createdBy: "music-editor-p1.2",
    state: "draft-from-production",
    clonedFromProductionProjectId: productionSnapshot.projectId,
    clonedAt: new Date().toISOString()
  };
  buffers.clear();
  setPreviewProjectSource("draft");
  mount(new MusicDocument(draft), { saved: false });
  report("Production Snapshot → Draft 복제됨 · Production 원본은 읽기 전용", "success");
  return true;
}

function placeAuditionState(place = placePreviewTarget()) {
  if (!place) return { space: "campus", placeZoneId: null, placeId: null };
  return {
    space: "campus",
    placeZoneId: place.placeZoneId || null,
    placeId: place.id
  };
}

async function syncPlaceAuditionTarget(place = placePreviewTarget()) {
  if (!place) return false;
  els.previewSpace.value = "campus";
  els.previewPlaceZone.disabled = false;
  els.previewPlace.disabled = false;
  if (place.placeZoneId && PLACE_ZONE_IDS.has(place.placeZoneId)) els.previewPlaceZone.value = place.placeZoneId;
  els.previewPlace.value = place.id;
  await preview.setState(placeAuditionState(place));
  return true;
}

async function auditionCurrentPlace() {
  const place = placePreviewTarget();
  if (!place) {
    renderProductionStatus("Audition 가능한 Place가 없습니다.", "error");
    return false;
  }
  const source = setPreviewProjectSource(els.auditionSource.value);
  await syncPlaceAuditionTarget(place);
  const ok = await preview.unlock();
  if (!ok) {
    renderProductionStatus(`A/B Audition 실패 · ${preview.status().lastError || "audio locked"}`, "error");
    return false;
  }
  const status = preview.status();
  renderProductionStatus(
    `${source === "production" ? "PRODUCTION" : "DRAFT"} · ${place.label} · ${status.cueName || "silence"}`,
    status.cueId ? "success" : "warning"
  );
  postAudioBridge("status");
  return true;
}

function initProductionControls() {
  const productionOption = els.auditionSource.querySelector('option[value="production"]');
  if (productionOption) productionOption.disabled = true;
  els.productionClone.disabled = true;
  els.productionReload.addEventListener("click", () => void loadProductionSnapshot());
  els.productionClone.addEventListener("click", () => cloneProductionToDraft());
  els.auditionSource.addEventListener("change", () => {
    setPreviewProjectSource(els.auditionSource.value);
    if (preview.status().context === "running") void syncPlaceAuditionTarget();
  });
  els.auditionHere.addEventListener("click", () => void auditionCurrentPlace());
  renderProductionStatus();
}

function placePreviewTarget() {
  return MUSIC_PLACE_TARGETS.find(place => place.id === els.placePreviewSelect.value) ?? null;
}

function renderPlaceScenePreviewStatus(status = placeScenePreview?.status?.() ?? { state: "idle" }) {
  const state = status.state ?? "idle";
  els.placePreviewState.dataset.state = state;
  els.placePreviewState.textContent = state;
  if (state === "ready" && status.placeId) {
    els.placePreviewStatus.textContent = `${status.label || status.placeId} · ${status.placeId} · ${status.residentChunks} chunks · ${status.entitiesCreated} entities`;
  }
  postAudioBridge("status");
}

async function closePlaceScenePreview() {
  const current = placeScenePreview;
  placeScenePreview = null;
  if (current) await current.dispose();
  els.placePreviewShell.hidden = true;
  els.placePreviewToggle.disabled = false;
  els.placePreviewToggle.textContent = "Open 3D Place";
  els.placePreviewState.dataset.state = "idle";
  els.placePreviewState.textContent = "idle";
  els.placePreviewStatus.textContent = "Read-only · 실제 Campus geometry";
  postAudioBridge("status");
}

async function togglePlaceScenePreview() {
  if (placeScenePreview) {
    await closePlaceScenePreview();
    return;
  }
  const place = placePreviewTarget();
  if (!place) {
    els.placePreviewStatus.textContent = "3D Preview 가능한 Place가 없습니다.";
    return;
  }

  els.placePreviewShell.hidden = false;
  els.placePreviewToggle.disabled = true;
  els.placePreviewState.dataset.state = "loading";
  els.placePreviewState.textContent = "loading";
  els.placePreviewStatus.textContent = `${place.label} Campus geometry 준비 중…`;

  let scene = null;
  try {
    const { PlaceScenePreview } = await import("../preview/place-scene-preview.js");
    scene = new PlaceScenePreview(els.placePreviewCanvas, message => {
      els.placePreviewStatus.textContent = message;
    });
    placeScenePreview = scene;
    await scene.start();
    const status = scene.openPlace(place);
    scene.resize();
    renderPlaceScenePreviewStatus(status);
    els.placePreviewToggle.disabled = false;
    els.placePreviewToggle.textContent = "Close 3D Place";
  } catch (error) {
    if (placeScenePreview === scene) placeScenePreview = null;
    await scene?.dispose();
    els.placePreviewShell.hidden = true;
    els.placePreviewToggle.disabled = false;
    els.placePreviewToggle.textContent = "Open 3D Place";
    els.placePreviewState.dataset.state = "degraded";
    els.placePreviewState.textContent = "degraded";
    els.placePreviewStatus.textContent = `Place Preview 실패 · ${error.message}`;
  }
}

function initPlaceScenePreviewControls() {
  els.placePreviewSelect.replaceChildren();
  const places = MUSIC_PLACE_TARGETS.filter(place => place.position && Number.isFinite(place.position.x) && Number.isFinite(place.position.z));
  for (const place of places) {
    const option = document.createElement("option");
    option.value = place.id;
    option.textContent = `${place.label} · ${place.id}`;
    els.placePreviewSelect.append(option);
  }
  els.placePreviewToggle.disabled = places.length === 0;
  els.placePreviewSelect.disabled = places.length === 0;
  if (!places.length) els.placePreviewStatus.textContent = "3D Preview 가능한 Place가 없습니다.";
  els.placePreviewToggle.addEventListener("click", () => void togglePlaceScenePreview());
  els.placePreviewSelect.addEventListener("change", () => {
    const place = placePreviewTarget();
    if (!place) return;
    if (preview.status().context === "running") void syncPlaceAuditionTarget(place);
    if (!placeScenePreview) return;
    const status = placeScenePreview.openPlace(place);
    renderPlaceScenePreviewStatus(status);
  });
}

function nextAssetId(fileName) {
  const base = `music.${slug(fileName)}`;
  const ids = new Set(music.assets().map(asset => asset.id));
  if (!ids.has(base)) return base;
  for (let index = 2; index < 10000; index += 1) {
    const id = `${base}-${index}`;
    if (!ids.has(id)) return id;
  }
  throw new Error("E_MUSIC_ASSET_ID_EXHAUSTED");
}

function nextCueId(assetId, suffix = "") {
  const assetSlug = String(assetId || "music.cue").replace(/^music\./, "").replace(/[^A-Za-z0-9._-]/g, "-");
  const base = `cue.${assetSlug}${suffix ? `.${slug(suffix)}` : ""}`;
  const ids = new Set(music.cues().map(cue => cue.id));
  if (!ids.has(base)) return base;
  for (let index = 2; index < 10000; index += 1) {
    const id = `${base}-${index}`;
    if (!ids.has(id)) return id;
  }
  throw new Error("E_MUSIC_CUE_ID_EXHAUSTED");
}

function nextBindingId(cueId, targetId) {
  const cuePart = String(cueId || "cue").replace(/^cue\./, "").replace(/[^A-Za-z0-9._-]/g, "-");
  const targetPart = slug(String(targetId || "target").replace(/^AREA_|^PLACE_|^ROOM_/, ""));
  const base = `binding.${cuePart}.${targetPart}`;
  const ids = new Set(music.bindings().map(binding => binding.id));
  if (!ids.has(base)) return base;
  for (let index = 2; index < 10000; index += 1) {
    const id = `${base}-${index}`;
    if (!ids.has(id)) return id;
  }
  throw new Error("E_MUSIC_BINDING_ID_EXHAUSTED");
}

function targetCatalog(type) {
  return TARGET_CATALOGS[type] || [];
}

function targetLabel(type, id) {
  return targetCatalog(type).find(item => item.id === id)?.label || id;
}

function firstFreeTarget(type, priority = 0) {
  const occupied = new Set(music.bindings()
    .filter(binding => binding.enabled && binding.targetType === type && binding.priority === priority)
    .map(binding => binding.targetId));
  return targetCatalog(type).find(item => !occupied.has(item.id))?.id ?? targetCatalog(type)[0]?.id ?? "";
}

function activeBinding() {
  return selectedBindingId ? music.getBinding(selectedBindingId) : null;
}

function activeCue() {
  const binding = activeBinding();
  const cueId = binding?.cueId ?? selectedCueId;
  return cueId ? music.getCue(cueId) : null;
}

function activeLoop(asset = music.getAsset(selectedAssetId)) {
  return activeCue()?.loop ?? asset?.editor?.loop ?? { enabled: false, startSeconds: 0, endSeconds: asset?.durationSeconds || 0 };
}

function mount(next, { saved = true } = {}) {
  stopPlayback({ reset: true });
  unsubscribe?.();
  unsubscribeCommands?.();
  music = next;
  commands = new MusicCommands(music);
  if (saved) music.markSaved();
  else music.markDirty();
  selectedAssetId = music.assets()[0]?.id ?? null;
  selectedCueId = null;
  selectedBindingId = null;
  unsubscribe = music.subscribe(() => {
    render();
    scheduleRecovery();
    void preview.refresh();
  });
  unsubscribeCommands = commands.subscribe(() => render());
  render();
  void preview.refresh();
  if (selectedAssetId) void selectAsset(selectedAssetId);
}

async function context({ resume = false } = {}) {
  if (!audioContext) audioContext = new (globalThis.AudioContext || globalThis.webkitAudioContext)();
  if (resume && audioContext.state !== "running") await audioContext.resume();
  return audioContext;
}

async function decodeBlob(blob) {
  const ctx = await context();
  const bytes = await blob.arrayBuffer();
  return ctx.decodeAudioData(bytes.slice(0));
}

async function bufferFor(asset) {
  if (!asset) return null;
  if (buffers.has(asset.id)) return buffers.get(asset.id);
  let blob = await store?.readAssetBlob(music.projectId, asset.id);
  if (!blob && asset.uri && !String(asset.uri).startsWith("project://")) {
    const response = await fetch(asset.uri, { cache: "no-store" });
    if (!response.ok) throw new Error(`E_MUSIC_ASSET_HTTP:${response.status}:${asset.id}`);
    blob = await response.blob();
  }
  if (!blob) throw new Error("E_MUSIC_ASSET_BLOB_MISSING");
  const buffer = await decodeBlob(blob);
  buffers.set(asset.id, buffer);
  return buffer;
}

function playbackTime() {
  const asset = music.getAsset(selectedAssetId);
  const buffer = buffers.get(selectedAssetId);
  if (!asset || !buffer) return sourceOffset;
  if (!playing || !audioContext) return sourceOffset;
  let value = sourceOffset + (audioContext.currentTime - sourceStartedAt);
  const loop = activeLoop(asset);
  if (loop.enabled && loop.endSeconds > loop.startSeconds && value >= loop.endSeconds) {
    const width = loop.endSeconds - loop.startSeconds;
    value = loop.startSeconds + ((value - loop.startSeconds) % width);
  }
  return Math.min(buffer.duration, Math.max(0, value));
}

function updatePlayhead() {
  const current = playbackTime();
  waveform.setCurrentTime(current);
  els.time.textContent = `${formatTime(current)} / ${formatTime(buffers.get(selectedAssetId)?.duration || 0)}`;
  if (playing) raf = requestAnimationFrame(updatePlayhead);
}

function stopPlayback({ reset = false } = {}) {
  if (playing) sourceOffset = playbackTime();
  playing = false;
  if (raf) cancelAnimationFrame(raf);
  raf = 0;
  if (source) {
    source.onended = null;
    try { source.stop(); } catch {}
    source.disconnect();
  }
  sourceGain?.disconnect();
  source = null;
  sourceGain = null;
  if (reset) sourceOffset = 0;
  waveform.setCurrentTime(sourceOffset);
  els.play.textContent = "▶ Play";
}

async function startPlayback() {
  const asset = music.getAsset(selectedAssetId);
  if (!asset) return;
  const buffer = await bufferFor(asset);
  const ctx = await context({ resume: true });
  if (ctx.state !== "running") throw new Error("E_MUSIC_AUDIO_LOCKED");
  stopPlayback();
  source = ctx.createBufferSource();
  sourceGain = ctx.createGain();
  source.buffer = buffer;
  source.connect(sourceGain).connect(ctx.destination);
  const cue = activeCue();
  const loop = activeLoop(asset);
  sourceGain.gain.value = cue?.gain ?? 1;
  if (cue?.transition?.fadeInSeconds > 0) {
    sourceGain.gain.setValueAtTime(0, ctx.currentTime);
    sourceGain.gain.linearRampToValueAtTime(cue.gain, ctx.currentTime + cue.transition.fadeInSeconds);
  }
  source.loop = loop.enabled;
  if (loop.enabled) {
    source.loopStart = loop.startSeconds;
    source.loopEnd = loop.endSeconds;
    if (sourceOffset >= loop.endSeconds) sourceOffset = loop.startSeconds;
  }
  sourceStartedAt = ctx.currentTime;
  source.onended = () => {
    if (!playing || source?.loop) return;
    playing = false;
    sourceOffset = 0;
    source = null;
    sourceGain?.disconnect();
    sourceGain = null;
    els.play.textContent = "▶ Play";
    updatePlayhead();
  };
  source.start(0, Math.min(sourceOffset, Math.max(0, buffer.duration - 0.001)));
  playing = true;
  els.play.textContent = "Ⅱ Pause";
  updatePlayhead();
}

async function togglePlayback() {
  if (playing) {
    stopPlayback();
    return;
  }
  try { await startPlayback(); }
  catch (error) { report(`재생 실패 · ${error.message}`, "error"); }
}

async function seek(seconds) {
  const buffer = buffers.get(selectedAssetId);
  if (!buffer) return;
  sourceOffset = Math.max(0, Math.min(buffer.duration, Number(seconds) || 0));
  if (playing) {
    try { await startPlayback(); }
    catch (error) { report(`재생 실패 · ${error.message}`, "error"); }
  } else updatePlayhead();
}

function loopFromControls() {
  return {
    enabled: els.loopEnabled.checked,
    startSeconds: Number(els.loopStart.value),
    endSeconds: Number(els.loopEnd.value)
  };
}

function applyLoop({ changed = "number" } = {}) {
  const asset = music.getAsset(selectedAssetId);
  if (!asset) return;
  const duration = asset.durationSeconds;
  let start = changed === "range" ? Number(els.loopStartRange.value) : Number(els.loopStart.value);
  let end = changed === "range" ? Number(els.loopEndRange.value) : Number(els.loopEnd.value);
  start = Math.max(0, Math.min(duration, Number.isFinite(start) ? start : 0));
  end = Math.max(0, Math.min(duration, Number.isFinite(end) ? end : duration));
  if (end <= start) {
    if (changed === "range" && document.activeElement === els.loopStartRange) start = Math.max(0, end - 0.01);
    else end = Math.min(duration, start + 0.01);
  }
  const loop = { enabled: els.loopEnabled.checked, startSeconds: start, endSeconds: end };
  try {
    const cue = activeCue();
    if (cue) commands.updateCue(cue.id, { loop }, "Set Cue Loop");
    else music.setAssetLoop(asset.id, loop);
    syncLoopControls(music.getAsset(asset.id), activeCue());
    waveform.setLoop(loop);
    if (playing) void startPlayback();
  } catch (error) {
    report(`Loop 거부 · ${error.message}`, "error");
    syncLoopControls(asset, activeCue());
  }
}

function syncLoopControls(asset, cue = activeCue()) {
  const duration = Math.max(0.01, asset?.durationSeconds || 0.01);
  const loop = cue?.loop || asset?.editor?.loop || { enabled: false, startSeconds: 0, endSeconds: duration };
  for (const range of [els.loopStartRange, els.loopEndRange]) {
    range.max = String(duration);
    range.step = "0.01";
  }
  els.loopEnabled.checked = loop.enabled;
  els.loopStartRange.value = String(loop.startSeconds);
  els.loopEndRange.value = String(loop.endSeconds || duration);
  els.loopStart.value = Number(loop.startSeconds).toFixed(2);
  els.loopEnd.value = Number(loop.endSeconds || duration).toFixed(2);
  waveform.setLoop(loop);
}

async function selectAsset(id, { keepCue = false, keepBinding = false } = {}) {
  selectedAssetId = id;
  if (!keepCue) selectedCueId = null;
  if (!keepBinding) selectedBindingId = null;
  stopPlayback({ reset: true });
  render();
  const asset = music.getAsset(id);
  if (!asset) {
    waveform.setBuffer(null);
    return;
  }
  try {
    report(`${asset.title} 불러오는 중…`);
    const buffer = await bufferFor(asset);
    if (selectedAssetId !== id) return;
    waveform.setBuffer(buffer);
    syncLoopControls(asset, activeCue());
    els.transport.hidden = false;
    els.empty.hidden = true;
    updatePlayhead();
    report(`${asset.title} · ${formatTime(buffer.duration)} 준비됨`, "success");
  } catch (error) {
    waveform.setBuffer(null);
    els.transport.hidden = false;
    els.empty.hidden = true;
    report(`${asset.title} · 원본 Blob 없음 (${error.message})`, "error");
  }
}

function renderLibrary() {
  const assets = music.assets();
  els.library.replaceChildren();
  if (!assets.length) {
    const empty = document.createElement("p");
    empty.className = "music-empty-list";
    empty.textContent = "등록된 음악이 없습니다.";
    els.library.append(empty);
    return;
  }
  for (const asset of assets) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "music-asset-row";
    button.dataset.assetId = asset.id;
    button.dataset.selected = String(asset.id === selectedAssetId);
    button.innerHTML = `<span class="music-asset-icon">♫</span><span><strong></strong><small></small></span>`;
    button.querySelector("strong").textContent = asset.title;
    button.querySelector("small").textContent = `${asset.fileName} · ${formatTime(asset.durationSeconds)}`;
    button.onclick = () => void selectAsset(asset.id);
    els.library.append(button);
  }
}

function renderCues() {
  const cues = music.cues();
  els.cues.replaceChildren();
  els.cueCount.textContent = String(cues.length);
  els.addCue.disabled = !selectedAssetId;
  if (!cues.length) {
    const empty = document.createElement("p");
    empty.className = "music-empty-list";
    empty.textContent = "아직 Cue가 없습니다.";
    els.cues.append(empty);
    return;
  }
  for (const cue of cues) {
    const asset = music.getAsset(cue.assetId);
    const button = document.createElement("button");
    button.type = "button";
    button.className = "music-cue-row";
    button.dataset.cueId = cue.id;
    button.dataset.selected = String(cue.id === selectedCueId);
    button.innerHTML = '<span class="cue-icon">C</span><span><strong></strong><small></small></span>';
    button.querySelector("strong").textContent = cue.name;
    button.querySelector("small").textContent = `${asset?.title || cue.assetId} · ${cue.bus} · gain ${cue.gain.toFixed(2)}`;
    button.onclick = () => void selectCue(cue.id);
    els.cues.append(button);
  }
}

function renderBindings() {
  const bindings = music.bindings();
  els.bindings.replaceChildren();
  els.bindingCount.textContent = String(bindings.length);
  els.addBinding.disabled = !selectedCueId;
  if (!bindings.length) {
    const empty = document.createElement("p");
    empty.className = "music-empty-list";
    empty.textContent = "아직 Binding이 없습니다.";
    els.bindings.append(empty);
    return;
  }
  for (const binding of [...bindings].sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id))) {
    const cue = music.getCue(binding.cueId);
    const button = document.createElement("button");
    button.type = "button";
    button.className = "music-binding-row";
    button.dataset.bindingId = binding.id;
    button.dataset.selected = String(binding.id === selectedBindingId);
    button.dataset.enabled = String(binding.enabled);
    button.innerHTML = '<span class="binding-icon">B</span><span><strong></strong><small></small></span>';
    button.querySelector("strong").textContent = `${targetLabel(binding.targetType, binding.targetId)} → ${cue?.name || binding.cueId}`;
    button.querySelector("small").textContent = `${binding.targetType} · p${binding.priority} · ${binding.enabled ? "enabled" : "disabled"}`;
    button.onclick = () => void selectBinding(binding.id);
    els.bindings.append(button);
  }
}

async function selectCue(id, { keepBinding = false } = {}) {
  const cue = music.getCue(id);
  if (!cue) return false;
  selectedCueId = cue.id;
  if (!keepBinding) selectedBindingId = null;
  selectedAssetId = cue.assetId;
  await selectAsset(cue.assetId, { keepCue: true, keepBinding });
  render();
  return true;
}

async function selectBinding(id) {
  const binding = music.getBinding(id);
  if (!binding) return false;
  const cue = music.getCue(binding.cueId);
  if (!cue) return false;
  selectedBindingId = binding.id;
  selectedCueId = cue.id;
  selectedAssetId = cue.assetId;
  await selectCue(cue.id, { keepBinding: true });
  render();
  return true;
}

function renderCueInspector(cue, asset) {
  const wrap = document.createElement("div");
  wrap.className = "music-inspector-fields";
  wrap.innerHTML = `
    <div class="music-inspector-kicker">MUSIC CUE</div>
    <label>Cue ID<input data-cue-field="id"></label>
    <label>Name<input data-cue-field="name"></label>
    <label>Asset<select data-cue-field="assetId"></select></label>
    <div class="cue-grid">
      <label>Bus<select data-cue-field="bus"><option value="music">music</option><option value="diegetic">diegetic</option></select></label>
      <label>Gain<input type="number" min="0" max="2" step="0.01" data-cue-field="gain"></label>
    </div>
    <div class="cue-grid">
      <label>Fade In<input type="number" min="0" step="0.05" data-cue-transition="fadeInSeconds"></label>
      <label>Fade Out<input type="number" min="0" step="0.05" data-cue-transition="fadeOutSeconds"></label>
    </div>
    <label>Priority<input type="number" min="-999" max="999" step="1" data-cue-field="priority"></label>
    <label>Tags<input data-cue-tags placeholder="explore, tower"></label>
    <label>Notes<textarea data-cue-field="notes" placeholder="연출 메모"></textarea></label>
    <span class="cue-source-link"></span>
    <div class="cue-actions">
      <button type="button" id="music-duplicate-cue">Duplicate Cue</button>
      <button type="button" class="music-danger" id="music-remove-cue">Delete Cue</button>
    </div>
  `;
  const assetSelect = wrap.querySelector('[data-cue-field="assetId"]');
  for (const item of music.assets()) {
    const option = document.createElement("option");
    option.value = item.id;
    option.textContent = item.title;
    assetSelect.append(option);
  }
  wrap.querySelector('[data-cue-field="id"]').value = cue.id;
  wrap.querySelector('[data-cue-field="name"]').value = cue.name;
  assetSelect.value = cue.assetId;
  wrap.querySelector('[data-cue-field="bus"]').value = cue.bus;
  wrap.querySelector('[data-cue-field="gain"]').value = String(cue.gain);
  wrap.querySelector('[data-cue-transition="fadeInSeconds"]').value = String(cue.transition.fadeInSeconds);
  wrap.querySelector('[data-cue-transition="fadeOutSeconds"]').value = String(cue.transition.fadeOutSeconds);
  wrap.querySelector('[data-cue-field="priority"]').value = String(cue.priority);
  wrap.querySelector("[data-cue-tags]").value = cue.tags.join(", ");
  wrap.querySelector('[data-cue-field="notes"]').value = cue.notes;
  wrap.querySelector(".cue-source-link").textContent = `Source: ${asset?.fileName || cue.assetId} · Loop is edited in the transport below the waveform.`;

  for (const input of wrap.querySelectorAll("[data-cue-field]")) {
    input.addEventListener("change", () => {
      const key = input.dataset.cueField;
      let value = input.value;
      if (key === "gain") value = Number(value);
      if (key === "priority") value = Number(value);
      try {
        const previousId = cue.id;
        commands.updateCue(previousId, { [key]: value }, `Set Cue ${key}`);
        if (key === "id") selectedCueId = String(value).trim();
        if (key === "assetId") {
          selectedAssetId = value;
          void selectCue(selectedCueId);
        } else render();
      } catch (error) {
        report(`Cue 편집 거부 · ${error.message}`, "error");
        render();
      }
    });
  }
  for (const input of wrap.querySelectorAll("[data-cue-transition]")) {
    input.addEventListener("change", () => {
      try {
        commands.updateCue(cue.id, {
          transition: { [input.dataset.cueTransition]: Number(input.value) }
        }, "Set Cue Transition");
      } catch (error) {
        report(`Fade 편집 거부 · ${error.message}`, "error");
        render();
      }
    });
  }
  wrap.querySelector("[data-cue-tags]").addEventListener("change", event => {
    const tags = event.target.value.split(",").map(value => value.trim()).filter(Boolean);
    try { commands.updateCue(cue.id, { tags }, "Set Cue Tags"); }
    catch (error) { report(`Tag 편집 거부 · ${error.message}`, "error"); render(); }
  });
  wrap.querySelector("#music-duplicate-cue").onclick = () => {
    try {
      const nextId = nextCueId(cue.assetId, "copy");
      const duplicate = commands.duplicateCue(cue.id, nextId);
      selectedCueId = duplicate.id;
      selectedAssetId = duplicate.assetId;
      void selectCue(duplicate.id);
      report(`${duplicate.name} 생성됨`, "success");
    } catch (error) {
      report(`Cue 복제 실패 · ${error.message}`, "error");
    }
  };
  wrap.querySelector("#music-remove-cue").onclick = () => {
    try {
      commands.removeCue(cue.id);
      selectedCueId = null;
      syncLoopControls(music.getAsset(selectedAssetId), null);
      render();
      report(`${cue.name} 삭제됨 · Undo 가능`, "warning");
    } catch (error) {
      report(`Cue 삭제 실패 · ${error.message}`, "error");
    }
  };
  els.inspector.append(wrap);
}

function renderBindingInspector(binding) {
  const cue = music.getCue(binding.cueId);
  const wrap = document.createElement("div");
  wrap.className = "music-inspector-fields";
  wrap.innerHTML = `
    <div class="music-inspector-kicker binding">MUSIC BINDING</div>
    <label>Binding ID<input data-binding-field="id"></label>
    <label class="binding-state"><input type="checkbox" data-binding-field="enabled"> Enabled</label>
    <div class="cue-grid">
      <label>Target Type<select data-binding-field="targetType"><option value="placeZone">PlaceZone</option><option value="place">Place</option><option value="room">Room</option></select></label>
      <label>Priority<input type="number" min="-999" max="999" step="1" data-binding-field="priority"></label>
    </div>
    <label>Target<select data-binding-target></select></label>
    <label>Cue<select data-binding-field="cueId"></select></label>
    <label>Fallback<select data-binding-field="fallback"><option value="silence">silence</option></select></label>
    <div class="binding-target-hint"></div>
    <div class="binding-actions">
      <button type="button" id="music-duplicate-binding">Duplicate disabled</button>
      <button type="button" class="music-danger" id="music-remove-binding">Delete Binding</button>
    </div>
  `;

  const targetType = wrap.querySelector('[data-binding-field="targetType"]');
  const targetSelect = wrap.querySelector("[data-binding-target]");
  const cueSelect = wrap.querySelector('[data-binding-field="cueId"]');
  const populateTargets = type => {
    targetSelect.replaceChildren();
    for (const item of targetCatalog(type)) {
      const option = document.createElement("option");
      option.value = item.id;
      option.textContent = `${item.label} · ${item.id}`;
      targetSelect.append(option);
    }
  };
  for (const item of music.cues()) {
    const option = document.createElement("option");
    option.value = item.id;
    option.textContent = item.name;
    cueSelect.append(option);
  }

  wrap.querySelector('[data-binding-field="id"]').value = binding.id;
  wrap.querySelector('[data-binding-field="enabled"]').checked = binding.enabled;
  targetType.value = binding.targetType;
  populateTargets(binding.targetType);
  targetSelect.value = binding.targetId;
  cueSelect.value = binding.cueId;
  wrap.querySelector('[data-binding-field="priority"]').value = String(binding.priority);
  wrap.querySelector('[data-binding-field="fallback"]').value = binding.fallback;
  const targetKind = binding.targetType === "placeZone" ? "Campus PlaceZone"
    : binding.targetType === "place" ? "Campus Place"
      : "Indoor Room";
  wrap.querySelector(".binding-target-hint").textContent =
    `${targetKind}: ${targetLabel(binding.targetType, binding.targetId)} · ${binding.targetId}`;

  for (const input of wrap.querySelectorAll("[data-binding-field]")) {
    if (input.dataset.bindingField === "targetType") continue;
    input.addEventListener("change", () => {
      const key = input.dataset.bindingField;
      let value = input.type === "checkbox" ? input.checked : input.value;
      if (key === "priority") value = Number(value);
      try {
        const previousId = binding.id;
        commands.updateBinding(previousId, { [key]: value }, `Set Binding ${key}`);
        if (key === "id") selectedBindingId = String(value).trim();
        if (key === "cueId") {
          selectedCueId = value;
          const selected = music.getCue(value);
          selectedAssetId = selected?.assetId ?? selectedAssetId;
          void selectBinding(selectedBindingId);
        } else render();
      } catch (error) {
        report(`Binding 편집 거부 · ${error.message}`, "error");
        render();
      }
    });
  }

  targetType.addEventListener("change", () => {
    const type = targetType.value;
    const targetId = firstFreeTarget(type, binding.priority);
    try {
      commands.updateBinding(binding.id, { targetType: type, targetId }, "Set Binding Target Type");
      render();
    } catch (error) {
      report(`Binding Target 변경 거부 · ${error.message}`, "error");
      render();
    }
  });

  targetSelect.addEventListener("change", () => {
    try {
      commands.updateBinding(binding.id, { targetId: targetSelect.value }, "Set Binding Target");
      render();
    } catch (error) {
      report(`Binding Target 변경 거부 · ${error.message}`, "error");
      render();
    }
  });

  wrap.querySelector("#music-duplicate-binding").onclick = () => {
    try {
      const nextId = nextBindingId(binding.cueId, binding.targetId);
      const duplicate = commands.duplicateBinding(binding.id, nextId);
      selectedBindingId = duplicate.id;
      selectedCueId = duplicate.cueId;
      void selectBinding(duplicate.id);
      report(`${duplicate.id} 생성됨 · disabled`, "success");
    } catch (error) {
      report(`Binding 복제 실패 · ${error.message}`, "error");
    }
  };

  wrap.querySelector("#music-remove-binding").onclick = () => {
    try {
      commands.removeBinding(binding.id);
      selectedBindingId = null;
      selectedCueId = binding.cueId;
      render();
      report(`${binding.id} 삭제됨 · Undo 가능`, "warning");
    } catch (error) {
      report(`Binding 삭제 실패 · ${error.message}`, "error");
    }
  };

  els.inspector.append(wrap);
}

function renderAssetInspector(asset) {
  const wrap = document.createElement("div");
  wrap.className = "music-inspector-fields";
  wrap.innerHTML = `
    <div class="music-inspector-kicker">AUDIO ASSET</div>
    <label>Title<input data-field="title"></label>
    <label>Artist<input data-field="artist"></label>
    <label>Source / Rights<input data-right="source"></label>
    <label>License<input data-right="license"></label>
    <label class="music-check"><input type="checkbox" data-right="approved"> 권리 승인</label>
    <dl>
      <dt>ID</dt><dd data-meta="id"></dd>
      <dt>File</dt><dd data-meta="file"></dd>
      <dt>Duration</dt><dd data-meta="duration"></dd>
      <dt>Storage</dt><dd>IndexedDB project blob</dd>
    </dl>
    <button type="button" class="music-danger" id="music-remove-asset">Remove asset</button>
  `;
  wrap.querySelector('[data-field="title"]').value = asset.title;
  wrap.querySelector('[data-field="artist"]').value = asset.artist;
  wrap.querySelector('[data-right="source"]').value = asset.rights.source;
  wrap.querySelector('[data-right="license"]').value = asset.rights.license;
  wrap.querySelector('[data-right="approved"]').checked = asset.rights.approved;
  wrap.querySelector('[data-meta="id"]').textContent = asset.id;
  wrap.querySelector('[data-meta="file"]').textContent = asset.fileName;
  wrap.querySelector('[data-meta="duration"]').textContent = formatTime(asset.durationSeconds);
  for (const input of wrap.querySelectorAll("[data-field]")) {
    input.addEventListener("change", () => commands.updateAsset(asset.id, { [input.dataset.field]: input.value }, `Set Asset ${input.dataset.field}`));
  }
  for (const input of wrap.querySelectorAll("[data-right]")) {
    input.addEventListener("change", () => {
      const current = music.getAsset(asset.id);
      const key = input.dataset.right;
      const value = input.type === "checkbox" ? input.checked : input.value;
      commands.updateAsset(asset.id, { rights: { ...current.rights, [key]: value } }, `Set Asset rights.${key}`);
    });
  }
  wrap.querySelector("#music-remove-asset").onclick = async () => {
    try {
      stopPlayback({ reset: true });
      music.removeAsset(asset.id);
      await store?.deleteAssetBlob(music.projectId, asset.id);
      buffers.delete(asset.id);
      selectedAssetId = music.assets()[0]?.id ?? null;
      selectedCueId = null;
      selectedBindingId = null;
      waveform.setBuffer(null);
      if (selectedAssetId) void selectAsset(selectedAssetId);
      else render();
    } catch (error) {
      report(`Asset 삭제 거부 · ${error.message}`, "error");
      render();
    }
  };
  els.inspector.append(wrap);
}

function renderInspector() {
  const binding = activeBinding();
  const cue = activeCue();
  const asset = music.getAsset(selectedAssetId);
  els.inspector.replaceChildren();
  if (binding) {
    renderBindingInspector(binding);
    return;
  }
  if (cue) {
    renderCueInspector(cue, asset);
    return;
  }
  if (!asset) {
    els.inspector.innerHTML = '<div class="music-inspector-empty"><strong>선택 없음</strong><span>왼쪽에서 음원을 추가하거나 Cue를 선택하세요.</span></div>';
    return;
  }
  renderAssetInspector(asset);
}

function render() {
  if (selectedBindingId && !music.getBinding(selectedBindingId)) selectedBindingId = null;
  if (selectedCueId && !music.getCue(selectedCueId)) selectedCueId = null;
  const selectedBinding = activeBinding();
  if (selectedBinding) selectedCueId = selectedBinding.cueId;
  const selectedCue = activeCue();
  if (selectedCue) selectedAssetId = selectedCue.assetId;
  if (selectedAssetId && !music.getAsset(selectedAssetId)) selectedAssetId = music.assets()[0]?.id ?? null;

  els.name.value = music.name;
  els.dirty.dataset.dirty = String(music.dirty);
  els.dirty.textContent = music.dirty ? "미저장" : "저장됨";
  els.revision.textContent = `rev ${music.revision}`;
  els.assetCount.textContent = `${music.assets().length} assets`;
  els.save.disabled = !store;
  els.undo.disabled = !commands.canUndo;
  els.redo.disabled = !commands.canRedo;
  els.undo.title = commands.undoStack.at(-1)?.label ? `Undo · ${commands.undoStack.at(-1).label}` : "Undo";
  els.redo.title = commands.redoStack.at(-1)?.label ? `Redo · ${commands.redoStack.at(-1).label}` : "Redo";

  renderLibrary();
  renderCues();
  renderBindings();
  renderInspector();
  const asset = music.getAsset(selectedAssetId);
  els.transport.hidden = !asset;
  els.empty.hidden = Boolean(asset);
  if (asset) syncLoopControls(asset, activeCue());
  const validation = diagnoseMusicProject(music.snapshot(), validationContext());
  els.validation.textContent = validation.valid
    ? `Validate: OK · warnings ${validation.counts.warnings}`
    : `Validate: ${validation.counts.errors} errors · warnings ${validation.counts.warnings}`;
  els.validation.dataset.valid = String(validation.valid);
  postAudioBridge("status");
}

function scheduleRecovery() {
  if (!store || !music.dirty) return;
  clearTimeout(recoveryTimer);
  recoveryTimer = setTimeout(() => {
    try {
      const text = serializeMusicProject(music.snapshot());
      void store.writeRecovery(music.projectId, text);
    } catch {}
  }, 500);
}

async function importAudioFiles(files) {
  if (!store) throw new Error("E_MUSIC_STORE_NOT_READY");
  for (const file of files) {
    if (!file || (!ACCEPTED_AUDIO.has(file.type) && !/\.(wav|mp3|ogg)$/i.test(file.name))) {
      report(`지원하지 않는 오디오 · ${file?.name || "unknown"}`, "error");
      continue;
    }
    const buffer = await decodeBlob(file);
    const id = nextAssetId(file.name);
    const asset = music.addAsset({
      id,
      uri: `project://${id}`,
      title: file.name.replace(/\.[^.]+$/, ""),
      artist: "",
      fileName: file.name,
      mimeType: file.type || "application/octet-stream",
      byteLength: file.size,
      durationSeconds: buffer.duration,
      rights: { source: "", license: "", approved: false },
      editor: { loop: { enabled: false, startSeconds: 0, endSeconds: buffer.duration } }
    });
    await store.writeAssetBlob(music.projectId, id, file);
    buffers.set(id, buffer);
    selectedAssetId = id;
    render();
    await selectAsset(id);
    report(`${asset.title} 등록 완료 · 저장 전`, "success");
  }
}

async function saveProject({ throwOnError = false } = {}) {
  if (!store) {
    const error = new Error("E_MUSIC_STORE_NOT_READY");
    if (throwOnError) throw error;
    return false;
  }
  try {
    clearTimeout(recoveryTimer);
    recoveryTimer = 0;
    const text = serializeMusicProject(music.snapshot());
    await store.writeCanonicalVerified(music.projectId, text);
    await store.clearRecovery(music.projectId);
    music.markSaved();
    report("프로젝트 저장 + readback 완료", "success");
    return true;
  } catch (error) {
    report(`저장 실패 · ${error.message}`, "error");
    if (throwOnError) throw error;
    return false;
  }
}

async function openProjects() {
  if (!store) return;
  const projects = await store.listProjects();
  els.projectList.replaceChildren();
  if (!projects.length) {
    els.projectList.textContent = "저장된 프로젝트가 없습니다.";
  } else {
    for (const entry of projects) {
      let project = null;
      try { project = parseMusicProject(entry.text); } catch {}
      const button = document.createElement("button");
      button.type = "button";
      button.innerHTML = "<strong></strong><small></small>";
      button.querySelector("strong").textContent = project?.name || entry.projectId;
      button.querySelector("small").textContent = `${entry.projectId} · ${project?.assets?.length ?? "?"} assets`;
      button.onclick = () => {
        if (!project) return;
        buffers.clear();
        mount(new MusicDocument(project), { saved: true });
        els.projectDialog.close();
        report(`${project.name} 열림`, "success");
      };
      els.projectList.append(button);
    }
  }
  els.projectDialog.showModal();
}

async function exportProject() {
  try {
    const candidate = await buildCurrentExportCandidate();
    renderValidationReport(candidate, { open: !candidate.ok });
    if (!candidate.ok || !candidate.text) {
      report(`Export 차단 · ${candidate.counts.errors} errors · ${candidate.counts.warnings} warnings`, "error");
      return false;
    }
    const url = URL.createObjectURL(new Blob([candidate.text], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `${music.projectId}.music.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
    report(`Export PASS · readback 동일 · warnings ${candidate.counts.warnings} · 음원 Blob 미포함`, "success");
    return true;
  } catch (error) {
    report(`Export 실패 · ${error.message}`, "error");
    return false;
  }
}

async function boot() {
  waveform.onSeek = seconds => void seek(seconds);
  try {
    store = await MusicBrowserStore.open();
    els.persistence.textContent = "Persistence: IndexedDB";
    const recovery = await store.readRecovery();
    const latest = recovery?.text || await store.readLatestCanonical();
    if (latest) {
      try {
        mount(new MusicDocument(parseMusicProject(latest)), { saved: !recovery });
        report(recovery ? "Recovery Draft 복구됨" : "마지막 프로젝트 열림", recovery ? "warning" : "success");
      } catch (error) {
        report(`저장 프로젝트 열기 실패 · ${error.message}`, "error");
      }
    } else {
      mount(music, { saved: true });
      report("새 프로젝트 준비됨", "success");
    }
  } catch (error) {
    els.persistence.textContent = "Persistence: unavailable";
    report(`IndexedDB 사용 불가 · ${error.message}`, "error");
    mount(music, { saved: false });
  }
}

els.addAudio.onclick = () => els.audioInput.click();
els.audioInput.onchange = async () => {
  const files = [...els.audioInput.files];
  els.audioInput.value = "";
  try { await importAudioFiles(files); }
  catch (error) { report(`음원 등록 실패 · ${error.message}`, "error"); }
};
els.play.onclick = () => void togglePlayback();
els.stop.onclick = () => { stopPlayback({ reset: true }); updatePlayhead(); };
els.loopEnabled.onchange = () => applyLoop();
els.loopStart.onchange = () => applyLoop();
els.loopEnd.onchange = () => applyLoop();
els.loopStartRange.oninput = () => {
  els.loopStart.value = Number(els.loopStartRange.value).toFixed(2);
  applyLoop({ changed: "range" });
};
els.loopEndRange.oninput = () => {
  els.loopEnd.value = Number(els.loopEndRange.value).toFixed(2);
  applyLoop({ changed: "range" });
};
els.name.onchange = () => {
  try { music.rename(els.name.value); }
  catch (error) { report(`이름 변경 실패 · ${error.message}`, "error"); render(); }
};
els.save.onclick = () => void saveProject();
els.newProject.onclick = () => {
  buffers.clear();
  mount(new MusicDocument(createEmptyMusicProject({
    projectId: `inha-world-music-${Date.now().toString(36)}`,
    name: "INHA WORLD · New Music Project"
  })), { saved: false });
  report("새 프로젝트 · 아직 저장되지 않음", "warning");
};
els.openProject.onclick = () => void openProjects();
els.projectCancel.onclick = () => els.projectDialog.close();
els.validationClose.onclick = () => els.validationDialog.close();
els.exportProject.onclick = () => void exportProject();
els.importProject.onclick = () => els.projectInput.click();
els.projectInput.onchange = async () => {
  const file = els.projectInput.files?.[0];
  els.projectInput.value = "";
  if (!file) return;
  try {
    buffers.clear();
    mount(new MusicDocument(parseMusicProject(await file.text())), { saved: false });
    report("music.json 가져옴 · 로컬 음원 Blob은 별도 등록 필요", "warning");
  } catch (error) {
    report(`Import 실패 · ${error.message}`, "error");
  }
};
els.validate.onclick = async () => {
  const result = await buildCurrentExportCandidate();
  renderValidationReport(result, { open: true });
  report(result.ok
    ? `Validate PASS · readback 동일 · warnings ${result.counts.warnings}`
    : `Validate FAIL · ${result.counts.errors} errors · ${result.counts.warnings} warnings`,
  result.ok ? "success" : "error");
  render();
};
els.addCue.onclick = () => {
  const asset = music.getAsset(selectedAssetId);
  if (!asset) return;
  try {
    const cue = commands.addCue({
      id: nextCueId(asset.id),
      name: `${asset.title} Cue`,
      assetId: asset.id,
      bus: "music",
      gain: 1,
      loop: { ...asset.editor.loop },
      transition: { fadeInSeconds: 0.5, fadeOutSeconds: 0.5 },
      priority: 0,
      tags: [],
      notes: ""
    });
    selectedCueId = cue.id;
    selectedAssetId = cue.assetId;
    void selectCue(cue.id);
    report(`${cue.name} 생성됨 · Undo 가능`, "success");
  } catch (error) {
    report(`Cue 생성 실패 · ${error.message}`, "error");
  }
};
els.addBinding.onclick = () => {
  const cue = music.getCue(selectedCueId);
  if (!cue) return;
  const targetType = "placeZone";
  const targetId = firstFreeTarget(targetType, 0);
  if (!targetId) {
    report("Binding 생성 실패 · 사용할 PlaceZone이 없습니다.", "error");
    return;
  }
  try {
    const binding = commands.addBinding({
      id: nextBindingId(cue.id, targetId),
      targetType,
      targetId,
      cueId: cue.id,
      enabled: true,
      priority: 0,
      fallback: "silence"
    });
    selectedBindingId = binding.id;
    selectedCueId = binding.cueId;
    void selectBinding(binding.id);
    report(`${targetLabel(binding.targetType, binding.targetId)} Binding 생성됨 · Undo 가능`, "success");
  } catch (error) {
    report(`Binding 생성 실패 · ${error.message}`, "error");
  }
};
function undoMusic() {
  if (!commands.undo()) return false;
  if (selectedBindingId && !music.getBinding(selectedBindingId)) selectedBindingId = null;
  if (selectedCueId && !music.getCue(selectedCueId)) {
    selectedCueId = music.cues().find(cue => cue.assetId === selectedAssetId)?.id ?? null;
  }
  render();
  report("Music Editor Undo", "warning");
  return true;
}

function redoMusic() {
  if (!commands.redo()) return false;
  if (selectedBindingId && !music.getBinding(selectedBindingId)) selectedBindingId = null;
  if (selectedCueId && !music.getCue(selectedCueId)) {
    selectedCueId = music.cues().find(cue => cue.assetId === selectedAssetId)?.id ?? null;
  }
  render();
  report("Music Editor Redo", "warning");
  return true;
}

async function handleStudioAudioBridgeCommand(event) {
  if (!STUDIO_HOST_MODE || event.origin !== globalThis.location.origin || event.source !== globalThis.parent) return;
  const message = event.data;
  if (!message || message.channel !== STUDIO_AUDIO_BRIDGE_CHANNEL || message.type !== "command" || !message.requestId) return;
  const respond = (ok, result = null, error = null) => postAudioBridge("response", {
    requestId: message.requestId,
    ok,
    ...(ok ? { result } : { error })
  });

  try {
    let result = null;
    if (message.action === "save") {
      result = { saved: await saveProject({ throwOnError: true }) };
    } else if (message.action === "toggle-preview") {
      stopPlayback();
      if (preview.status().context === "running") {
        const suspended = await preview.suspend();
        if (!suspended) throw new Error(preview.status().lastError || "E_MUSIC_PREVIEW_SUSPEND");
        report("Runtime Preview audio suspended", "warning");
      } else {
        const enabled = await preview.unlock();
        if (!enabled) throw new Error(preview.status().lastError || "E_MUSIC_PREVIEW_AUDIO_LOCKED");
        report("Runtime Preview audio enabled", "success");
      }
      result = { previewEnabled: preview.status().context === "running", context: preview.status().context };
    } else if (message.action === "undo") {
      result = { applied: undoMusic() };
    } else if (message.action === "redo") {
      result = { applied: redoMusic() };
    } else if (message.action === "get-content") {
      result = audioContentSnapshot();
    } else if (message.action === "get-inspector") {
      result = audioInspectorSnapshot();
    } else if (message.action === "update-inspector") {
      result = updateStudioAudioInspector(message.payload);
    } else if (message.action === "select-content") {
      const kind = String(message.payload?.kind || "");
      const id = String(message.payload?.id || "");
      let selected = false;
      if (kind === "asset") selected = await selectAsset(id).then(() => Boolean(music.getAsset(id)));
      else if (kind === "cue") selected = await selectCue(id);
      else if (kind === "binding") selected = await selectBinding(id);
      else throw new Error(`E_STUDIO_AUDIO_CONTENT_KIND_UNKNOWN:${kind}`);
      if (!selected && kind !== "asset") throw new Error(`E_STUDIO_AUDIO_CONTENT_NOT_FOUND:${kind}:${id}`);
      postAudioBridge("status");
      result = { selected: Boolean(selected), kind, id };
    } else if (message.action === "validate") {
      const validation = await buildCurrentExportCandidate();
      result = {
        valid: validation.ok,
        errors: validation.counts.errors,
        warnings: validation.counts.warnings,
        firstCode: validation.diagnostics[0]?.code ?? null
      };
      report(validation.ok
        ? `Validate PASS · readback 동일 · warnings ${validation.counts.warnings}`
        : `Validate FAIL · ${validation.counts.errors} errors · ${validation.counts.warnings} warnings`,
      validation.ok ? "success" : "error");
    } else if (message.action === "get-status") {
      result = audioBridgeStatus();
    } else {
      throw new Error(`E_STUDIO_AUDIO_COMMAND_UNKNOWN:${message.action}`);
    }
    respond(true, result);
  } catch (error) {
    respond(false, null, error?.message || String(error));
  }
}
globalThis.addEventListener("message", event => { void handleStudioAudioBridgeCommand(event); });

els.undo.onclick = () => { undoMusic(); };
els.redo.onclick = () => { redoMusic(); };

initPreviewControls();
initPlaceScenePreviewControls();
initProductionControls();
unsubscribePreview = preview.subscribe(renderPreviewStatus);
addEventListener("resize", () => placeScenePreview?.resize());

addEventListener("beforeunload", () => {
  stopPlayback();
  unsubscribePreview?.();
  preview.dispose();
  void placeScenePreview?.dispose();
  waveform.destroy();
  if (audioContext) void audioContext.close().catch(() => {});
});

void loadProductionSnapshot();

void boot().finally(() => {
  studioBridgeReady = true;
  render();
  renderPreviewStatus();
  renderPlaceScenePreviewStatus();
  postAudioBridge("ready");
});
