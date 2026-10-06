import { createEmptyWorld, WorldDocument } from "./world-document.js";
import { EditorState } from "./editor-state.js";
import { EditorCommands } from "./editor-commands.js";
import { EditorBrowserStore } from "./editor-browser-store.js";
import { MapReferenceController } from "./map-reference-controller.js";
import { loadWorldDocument, prepareWorldSave, saveWorldDocument } from "./editor-persistence.js";
import { serializeWorld } from "./world-serialization.js";
import { validateWorld } from "./world-schema.js";
import { InhaToolSession, groundFromViewport, projectGround } from "./inha-tools.js";
import { samplePathCenterline } from "./path-spline.js";
import { createEditorAssetResolver, importEditorModel, revokeEditorAssetUrls } from "./editor-model-import.js";
import {
  eulerFromQuaternion,
  quaternionFromEuler,
  rotateVector,
  transformedForDrag,
  worldTransform
} from "./editor-transform.js";

const STUDIO_BRIDGE_CHANNEL = "inha.studio.world/1";
const STUDIO_HOST_MODE = new URLSearchParams(globalThis.location?.search || "").get("studioHost") === "1" &&
  globalThis.parent && globalThis.parent !== globalThis;
if (STUDIO_HOST_MODE) document.documentElement.dataset.studioHost = "true";

const state = new EditorState();
const placement = new InhaToolSession(() => world, () => commands);
let world = null;
let commands = null;
let unsubscribeWorld = null;
let unsubscribeCommands = null;
let drag = null;
let store = null;
let recoveryTimer = null;
let recoveryWrite = Promise.resolve();
let documentBusy = false;
let persistenceLabel = "프로젝트 저장소 연결 중";
let runtimePreview = null;
let previewTimer = null;
let studioBridgeReady = false;
let lastStudioBridgeStatus = "";

const els = {
  worldName: document.getElementById("editor-world-name"),
  dirty: document.getElementById("editor-dirty"),
  entityCount: document.getElementById("editor-entity-count"),
  revision: document.getElementById("editor-revision"),
  hierarchy: document.getElementById("editor-hierarchy"),
  viewport: document.getElementById("editor-viewport"),
  inspector: document.getElementById("editor-inspector"),
  deleteButton: document.getElementById("editor-delete"),
  duplicateButton: document.getElementById("editor-duplicate"),
  undoButton: document.getElementById("editor-undo"),
  redoButton: document.getElementById("editor-redo"),
  spaceButton: document.getElementById("editor-space"),
  moveSnap: document.getElementById("editor-move-snap"),
  rotateSnap: document.getElementById("editor-rotate-snap"),
  feedback: document.getElementById("editor-feedback"),
  persistence: document.getElementById("editor-persistence"),
  fileStatus: document.getElementById("editor-file-status"),
  newButton: document.getElementById("editor-new"),
  openProjectButton: document.getElementById("editor-open-project"),
  mainGateButton: document.getElementById("editor-open-main-gate"),
  openFileButton: document.getElementById("editor-open-file"),
  fileInput: document.getElementById("editor-file-input"),
  saveButton: document.getElementById("editor-save"),
  exportButton: document.getElementById("editor-export"),
  validateButton: document.getElementById("editor-validate"),
  documentDialog: document.getElementById("editor-document-dialog"),
  dialogMessage: document.getElementById("editor-dialog-message"),
  projectDialog: document.getElementById("editor-project-dialog"),
  projectList: document.getElementById("editor-project-list"),
  projectCancel: document.getElementById("editor-project-cancel"),
  previewToggle: document.getElementById("editor-preview-toggle"),
  previewPanel: document.getElementById("editor-runtime-preview"),
  previewCanvas: document.getElementById("editor-preview-canvas"),
  previewStatus: document.getElementById("editor-preview-status"),
  rendererStatus: document.getElementById("editor-renderer-status"),
  modelAssets: document.getElementById("editor-model-assets"),
  modelForm: document.getElementById("editor-add-model"),
  modelUri: document.getElementById("editor-model-uri"),
  modelFile: document.getElementById("editor-model-file"),
  modelImportButton: document.getElementById("editor-import-model"),
  modelImportStatus: document.getElementById("editor-model-import-status"),
  toolOptions: document.getElementById("editor-tool-options"),
  toolHint: document.getElementById("editor-tool-hint")
};
const mapReference = new MapReferenceController({
  viewport: els.viewport,
  getStore: () => store,
  getWorld: () => world,
  isPreviewOpen: () => Boolean(runtimePreview),
  onStart: () => { activatePlacementTool("select"); state.setTool("select"); },
  onCreateMass: candidate => runEdit(() => {
    if (world.hasEntity(candidate.id)) { state.select(candidate.id); return "selected"; }
    commands.addEntity(candidate);
    return "created";
  })
});

function createSandbox() {
  return new WorldDocument(createEmptyWorld({
    worldId: "inha-world-editor-sandbox",
    name: "INHA WORLD · Editor Sandbox"
  }));
}

function mountWorld(nextWorld) {
  cancelDrag();
  placement.activate("select");
  placement.setOption("assetId", "");
  unsubscribeWorld?.();
  unsubscribeCommands?.();
  world = nextWorld;
  mapReference.loadForWorld(world.worldId);
  commands = new EditorCommands(world, state);
  state.clearSelection();
  unsubscribeWorld = world.subscribe(render);
  unsubscribeCommands = commands.subscribe(() => {
    render();
    mapReference.syncControls();
    scheduleRecovery();
    schedulePreviewRefresh();
  });
  render();
  renderToolOptions();
  schedulePreviewRefresh();
}

function schedulePreviewRefresh() {
  if (previewTimer) clearTimeout(previewTimer);
  previewTimer = null;
  if (!runtimePreview) return;
  previewTimer = setTimeout(() => {
    previewTimer = null;
    runtimePreview?.refresh(world).catch(error => { els.previewStatus.textContent = error.message; });
  }, 250);
}

async function toggleRuntimePreview() {
  mapReference.setMode(null);
  if (runtimePreview) {
    if (previewTimer) clearTimeout(previewTimer);
    previewTimer = null;
    const closing = runtimePreview;
    runtimePreview = null;
    await closing.dispose();
    els.previewPanel.hidden = true;
    els.previewToggle.textContent = "Runtime Preview";
    els.previewToggle.setAttribute("aria-pressed", "false");
    return;
  }
  els.previewPanel.hidden = false;
  els.previewStatus.textContent = "프리뷰 준비 중…";
  try {
    const { EditorRuntimePreview } = await import("./editor-runtime-preview.js");
    const objectUrls = new Set();
    const preview = new EditorRuntimePreview(els.previewCanvas, (message, diagnostics) => {
      const first = diagnostics[0];
      els.previewStatus.textContent = first ? `${message} · ${first.code}` : message;
    }, {
      resolveAssetUri: createEditorAssetResolver({ store, worldId: world.worldId, objectUrls }),
      disposeAssetUris: () => revokeEditorAssetUrls(objectUrls)
    });
    runtimePreview = preview;
    await preview.start();
    await preview.refresh(world);
    els.previewToggle.textContent = "Back to Edit";
    els.previewToggle.setAttribute("aria-pressed", "true");
  } catch (error) {
    els.previewStatus.textContent = `프리뷰 실패: ${error.message}`;
    const failed = runtimePreview;
    runtimePreview = null;
    await failed?.dispose();
  }
}

function studioContentSnapshot() {
  const snapshot = world.snapshot();
  return {
    moduleId: "world",
    sections: [
      {
        id: "scene",
        label: "SCENE",
        items: world.listEntities().map(entity => ({
          kind: "entity",
          id: entity.id,
          label: entity.name,
          detail: `${entity.kind}${entity.enabled ? "" : " · disabled"}`,
          selected: entity.id === state.selectedEntityId,
          selectable: true
        }))
      },
      {
        id: "assets",
        label: "ASSETS",
        items: snapshot.assets.map(asset => ({
          kind: "asset",
          id: asset.id,
          assetType: asset.type || "other",
          sourceKind: "world-asset",
          label: asset.metadata?.label || asset.id,
          detail: `${asset.type || "other"} · ${asset.uri || "no uri"}`,
          selected: asset.id === placement.options.assetId,
          selectable: asset.type === "model"
        }))
      }
    ]
  };
}

function studioInspectorSnapshot() {
  const entity = state.selectedEntityId ? world.getEntity(state.selectedEntityId) : null;
  if (entity) {
    return {
      moduleId: "world",
      selection: {
        kind: "entity",
        id: entity.id,
        title: entity.name,
        subtitle: entity.kind
      },
      fields: [
        { key: "name", label: "Name", type: "text", value: entity.name, editable: true },
        { key: "enabled", label: "Enabled", type: "checkbox", value: entity.enabled, editable: true },
        { key: "position.x", label: "Position X", type: "number", value: entity.transform.position[0], step: 0.1, editable: true },
        { key: "position.y", label: "Position Y", type: "number", value: entity.transform.position[1], step: 0.1, editable: true },
        { key: "position.z", label: "Position Z", type: "number", value: entity.transform.position[2], step: 0.1, editable: true },
        { key: "tags", label: "Tags", type: "text", value: entity.tags.join(", "), editable: true },
        { key: "id", label: "Entity ID", type: "readonly", value: entity.id, editable: false },
        { key: "kind", label: "Kind", type: "readonly", value: entity.kind, editable: false }
      ]
    };
  }

  const assetId = placement.options.assetId || "";
  const asset = world.snapshot().assets.find(item => item.id === assetId);
  if (asset) {
    return {
      moduleId: "world",
      selection: {
        kind: "asset",
        id: asset.id,
        title: asset.metadata?.label || asset.id,
        subtitle: asset.type || "asset"
      },
      fields: [
        { key: "id", label: "Asset ID", type: "readonly", value: asset.id, editable: false },
        { key: "type", label: "Type", type: "readonly", value: asset.type || "other", editable: false },
        { key: "uri", label: "URI", type: "readonly", value: asset.uri || "", editable: false }
      ]
    };
  }

  return { moduleId: "world", selection: null, fields: [] };
}

function updateStudioWorldInspector(payload = {}) {
  const kind = String(payload.kind || "");
  const id = String(payload.id || "");
  const field = String(payload.field || "");
  const value = payload.value;

  if (kind !== "entity") throw new Error(`E_STUDIO_WORLD_INSPECTOR_READ_ONLY:${kind}`);
  const entity = world.getEntity(id);
  if (!entity) throw new Error(`E_ENTITY_NOT_FOUND:${id}`);

  if (field === "name") {
    const name = String(value || "").trim();
    if (!name) throw new Error("E_ENTITY_NAME_INVALID");
    runEdit(() => commands.renameEntity(id, name));
  } else if (field === "enabled") {
    runEdit(() => commands.setEnabled(id, Boolean(value)));
  } else if (field === "tags") {
    const tags = String(value || "").split(",").map(tag => tag.trim()).filter(Boolean);
    runEdit(() => commands.setTags(id, tags));
  } else if (["position.x", "position.y", "position.z"].includes(field)) {
    const nextValue = Number(value);
    if (!Number.isFinite(nextValue)) throw new Error("E_TRANSFORM_NUMBER_INVALID");
    const index = { "position.x": 0, "position.y": 1, "position.z": 2 }[field];
    const transform = structuredClone(entity.transform);
    transform.position[index] = nextValue;
    runEdit(() => commands.setTransform(id, transform));
  } else {
    throw new Error(`E_STUDIO_WORLD_INSPECTOR_FIELD_UNKNOWN:${field}`);
  }

  return studioInspectorSnapshot();
}

function studioBridgeStatus() {
  return {
    ready: studioBridgeReady,
    worldId: world?.worldId ?? null,
    name: world?.name ?? null,
    dirty: Boolean(world?.dirty),
    entityCount: world?.entityCount ?? 0,
    revision: world?.revision ?? 0,
    selectedEntityId: state.selectedEntityId,
    selectedAssetId: placement.options.assetId || null,
    canSave: Boolean(store) && !documentBusy,
    canUndo: Boolean(commands?.canUndo),
    canRedo: Boolean(commands?.canRedo),
    history: {
      undoCount: commands?.undoStack?.length ?? 0,
      redoCount: commands?.redoStack?.length ?? 0,
      nextUndo: commands?.undoStack?.at(-1)?.label ?? null,
      nextRedo: commands?.redoStack?.at(-1)?.label ?? null
    },
    previewOpen: Boolean(runtimePreview),
    renderer: runtimePreview ? "runtime-adapter" : "2d-edit",
    fileStatus: els.fileStatus?.textContent || "",
    persistence: persistenceLabel
  };
}

function postStudioBridge(type = "status", extra = {}) {
  if (!STUDIO_HOST_MODE) return;
  const status = studioBridgeStatus();
  const serialized = JSON.stringify(status);
  if (type === "status" && serialized === lastStudioBridgeStatus) return;
  if (type === "status") lastStudioBridgeStatus = serialized;
  globalThis.parent.postMessage({
    channel: STUDIO_BRIDGE_CHANNEL,
    type,
    status,
    ...extra
  }, globalThis.location.origin);
}

function setFileStatus(message) {
  els.fileStatus.textContent = message;
  postStudioBridge("status");
}

function cancelRecoveryTimer() {
  if (recoveryTimer) clearTimeout(recoveryTimer);
  recoveryTimer = null;
}

function scheduleRecovery() {
  cancelRecoveryTimer();
  if (!store || !world.dirty) return;
  const document = world;
  recoveryTimer = setTimeout(() => {
    recoveryTimer = null;
    if (document !== world || !document.dirty) return;
    try {
      const text = serializeWorld(document.snapshot());
      recoveryWrite = recoveryWrite.catch(() => {}).then(() => store.writeRecovery(document.worldId, text));
      recoveryWrite.catch(error => setFileStatus(`복구 초안 저장 실패: ${error.message}`));
    } catch (error) {
      setFileStatus(`복구 초안 검증 실패: ${error.message}`);
    }
  }, 3000);
}

function askDocumentChoice(message) {
  els.dialogMessage.textContent = message;
  return new Promise(resolve => {
    const dialog = els.documentDialog;
    const onClick = event => {
      const choice = event.target.closest("[data-dialog-choice]")?.dataset.dialogChoice;
      if (choice) { dialog.returnValue = choice; dialog.close(); }
    };
    const onClose = () => {
      dialog.removeEventListener("click", onClick);
      resolve(dialog.returnValue || "cancel");
    };
    dialog.returnValue = "cancel";
    dialog.addEventListener("click", onClick);
    dialog.addEventListener("close", onClose, { once: true });
    dialog.showModal();
  });
}

async function askProjectChoice(projects) {
  els.projectList.replaceChildren();
  for (const project of projects) {
    const button = document.createElement("button");
    button.type = "button";
    let name = project.worldId;
    try { name = loadWorldDocument(project.text).name; } catch { name += " · 읽기 오류"; }
    const title = document.createElement("strong");
    title.textContent = name;
    const id = document.createElement("small");
    id.textContent = project.worldId;
    button.append(title, id);
    button.addEventListener("click", () => {
      els.projectDialog.returnValue = project.worldId;
      els.projectDialog.close();
    });
    els.projectList.append(button);
  }
  els.projectDialog.returnValue = "";
  els.projectDialog.showModal();
  const choice = await new Promise(resolve => els.projectDialog.addEventListener("close", () => resolve(els.projectDialog.returnValue), { once: true }));
  return projects.find(project => project.worldId === choice) || null;
}

async function saveProject() {
  if (!store) throw new Error("E_EDITOR_STORE_UNAVAILABLE");
  cancelDrag();
  cancelRecoveryTimer();
  try {
    const result = await saveWorldDocument(world, store);
    if (result.saved) {
      await recoveryWrite.catch(() => {});
      await store.clearRecovery(world.worldId);
      setFileStatus(`프로젝트 저장 및 읽기 검증 완료 · 경고 ${result.warnings.length}개`);
    } else {
      setFileStatus("저장 중 추가 변경이 있어 다시 저장해야 합니다.");
    }
    return result.saved;
  } finally {
    if (world.dirty) scheduleRecovery();
  }
}

async function guardDirty(nextAction) {
  if (!world.dirty) return true;
  const choice = await askDocumentChoice(`현재 월드를 ${nextAction} 전에 변경 사항을 처리하세요.`);
  if (choice === "cancel") return false;
  if (choice === "save") return saveProject();
  return true;
}

async function switchWorld(nextWorld) {
  cancelRecoveryTimer();
  await recoveryWrite.catch(() => {});
  if (store) await store.clearRecovery(world.worldId);
  mountWorld(nextWorld);
  if (nextWorld.dirty) scheduleRecovery();
}

async function performDocumentAction(action) {
  if (documentBusy) throw new Error("E_EDITOR_DOCUMENT_BUSY");
  documentBusy = true;
  renderStatus();
  postStudioBridge("status");
  try {
    return await action();
  } catch (error) {
    showError(error);
    setFileStatus(error.message);
    throw error;
  } finally {
    documentBusy = false;
    renderStatus();
    postStudioBridge("status");
  }
}

function runDocumentAction(action) {
  return performDocumentAction(action).catch(() => undefined);
}

function showError(error) {
  els.feedback.textContent = error?.message || String(error);
}

function runEdit(action) {
  try {
    els.feedback.textContent = "";
    return action();
  } catch (error) {
    showError(error);
    render();
    return false;
  }
}

function nextTestEntityId() {
  let index = 1;
  while (world.hasEntity("entity.editor.test-" + String(index).padStart(3, "0"))) index += 1;
  return "entity.editor.test-" + String(index).padStart(3, "0");
}

function addTestProp() {
  runEdit(() => {
    const index = world.entityCount;
    commands.addEntity({
      id: nextTestEntityId(),
      name: "Test Prop " + (index + 1),
      kind: "prop",
      transform: {
        position: [(index % 5) * 6 - 12, 0, Math.floor(index / 5) * 6 - 6],
        rotation: [0, 0, 0, 1],
        scale: [1, 1, 1]
      },
      tags: ["editor-bootstrap"],
      metadata: { editorBootstrap: true }
    });
  });
}

function deleteSelected() {
  const id = state.selectedEntityId;
  if (id) runEdit(() => commands.removeEntity(id));
}

function duplicateSelected() {
  const id = state.selectedEntityId;
  if (id) runEdit(() => commands.duplicateEntity(id));
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function projectionDirection(vector) {
  return [vector[0] - vector[2] * 0.35, -(vector[1] + vector[2] * 0.75)];
}

function viewportPoint(entity) {
  const position = worldTransform(world, entity.id).position;
  const [screenX, screenY] = projectionDirection(position);
  return {
    left: clamp(50 + screenX * 1.4, 8, 92),
    top: clamp(50 + screenY * 1.4, 8, 92)
  };
}

function renderHierarchy() {
  els.hierarchy.replaceChildren();
  const entities = world.listEntities();
  if (entities.length === 0) {
    const empty = document.createElement("p");
    empty.className = "editor-empty";
    empty.textContent = "Entity가 없습니다.";
    els.hierarchy.append(empty);
    return;
  }

  const list = document.createElement("ul");
  list.className = "editor-entity-list";
  for (const entity of entities) {
    const item = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button";
    button.className = "editor-entity-row";
    button.dataset.selected = String(entity.id === state.selectedEntityId);
    button.setAttribute("aria-label", entity.name + " 선택");
    button.addEventListener("click", () => state.select(entity.id));

    const kind = document.createElement("span");
    kind.className = "editor-entity-kind";
    kind.textContent = entity.kind === "prop" ? "◇" : "□";
    const label = document.createElement("span");
    label.textContent = entity.name;
    button.append(kind, label);
    item.append(button);
    list.append(item);
  }
  els.hierarchy.append(list);
}

function createMarker(entity) {
  const marker = document.createElement("button");
  marker.type = "button";
  marker.className = "editor-viewport-entity";
  marker.dataset.entityId = entity.id;
  marker.textContent = "◇";
  return marker;
}

function renderGizmo(entity) {
  let gizmo = els.viewport.querySelector(".editor-gizmo");
  if (!entity || !entity.enabled || placement.activeTool !== "select") {
    gizmo?.remove();
    return;
  }

  const mode = state.activeTool === "select" ? "move" : state.activeTool;
  if (gizmo && (gizmo.dataset.entityId !== entity.id || gizmo.dataset.mode !== mode)) {
    gizmo.remove();
    gizmo = null;
  }
  if (!gizmo) {
    gizmo = document.createElement("div");
    gizmo.className = "editor-gizmo";
    gizmo.dataset.entityId = entity.id;
    gizmo.dataset.mode = mode;
    const axes = mode === "scale" ? ["x", "y", "z", "all"] : ["x", "y", "z"];
    for (const axis of axes) {
      const handle = document.createElement("button");
      handle.type = "button";
      handle.className = "editor-gizmo-handle";
      handle.dataset.axis = axis;
      handle.dataset.mode = mode;
      handle.textContent = axis === "all" ? "◇" : axis.toUpperCase();
      handle.setAttribute("aria-label", mode + " " + axis + " handle");
      handle.addEventListener("pointerdown", event => beginGizmoDrag(event, handle));
      handle.addEventListener("pointermove", onGizmoMove);
      handle.addEventListener("pointerup", onGizmoUp);
      handle.addEventListener("pointercancel", cancelDrag);
      gizmo.append(handle);
    }
    els.viewport.append(gizmo);
  }
  const point = viewportPoint(entity);
  gizmo.style.left = point.left + "%";
  gizmo.style.top = point.top + "%";
  const rotation = worldTransform(world, entity.id).rotation;
  for (const handle of gizmo.querySelectorAll(".editor-gizmo-handle")) {
    const axis = handle.dataset.axis;
    if (axis === "all") {
      handle.style.left = "60px";
      handle.style.top = "60px";
      continue;
    }
    const basis = axis === "x" ? [1, 0, 0] : axis === "y" ? [0, 1, 0] : [0, 0, 1];
    const direction = state.transformSpace === "local" ? rotateVector(rotation, basis) : basis;
    const projected = projectionDirection(direction);
    const length = Math.hypot(...projected) || 1;
    const radius = axis === "z" ? 70 : 48;
    handle.style.left = (60 + radius * projected[0] / length) + "px";
    handle.style.top = (60 + radius * projected[1] / length) + "px";
  }
}

function renderViewport() {
  const markers = new Map(
    [...els.viewport.querySelectorAll(".editor-viewport-entity")]
      .map(node => [node.dataset.entityId, node])
  );
  const entities = world.listEntities();
  for (const entity of entities) {
    let marker = markers.get(entity.id);
    if (!marker) {
      marker = createMarker(entity);
      els.viewport.append(marker);
    }
    markers.delete(entity.id);
    const point = viewportPoint(entity);
    marker.style.left = point.left + "%";
    marker.style.top = point.top + "%";
    marker.dataset.selected = String(entity.id === state.selectedEntityId);
    marker.dataset.enabled = String(entity.enabled);
    marker.title = entity.name;
    marker.setAttribute("aria-label", entity.name + " 선택");
  }
  for (const marker of markers.values()) marker.remove();
  const selected = state.selectedEntityId ? world.getEntity(state.selectedEntityId) : null;
  renderGizmo(selected);
  renderToolOverlay();
}

function renderToolOverlay() {
  let overlay = els.viewport.querySelector(".editor-tool-overlay");
  if (!overlay) {
    overlay = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    overlay.classList.add("editor-tool-overlay");
    overlay.setAttribute("viewBox", "0 0 100 100");
    overlay.setAttribute("preserveAspectRatio", "none");
    els.viewport.append(overlay);
  }
  overlay.replaceChildren();
  for (const entity of world.listEntities()) {
    const path = entity.components["world.path"];
    if (!entity.enabled || !path) continue;
    const transform = worldTransform(world, entity.id);
    const points = samplePathCenterline(path.points, path.interpolation, path.closed).map(point => {
      const scaled = point.map((value, index) => value * transform.scale[index]);
      const rotated = rotateVector(transform.rotation, scaled);
      return rotated.map((value, index) => value + transform.position[index]);
    });
    if (points.length < 2) continue;
    const line = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
    line.classList.add("editor-saved-path");
    line.dataset.pathType = path.pathType;
    line.dataset.selected = String(entity.id === state.selectedEntityId);
    line.setAttribute("points", points.map(point => {
      const projected = projectGround(point);
      return `${projected.left},${projected.top}`;
    }).join(" "));
    overlay.append(line);
  }
  const { points, hoverPoint } = placement.draft;
  const pathPoints = [...points, ...(placement.activeTool === "path" && hoverPoint ? [hoverPoint] : [])];
  if (placement.activeTool === "path" && pathPoints.length > 1) {
    const line = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
    const sampled = samplePathCenterline(pathPoints, placement.options.pathInterpolation);
    line.setAttribute("points", sampled.map(point => {
      const projected = projectGround(point);
      return `${projected.left},${projected.top}`;
    }).join(" "));
    overlay.append(line);
  }
  for (const point of pathPoints) {
    const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    const projected = projectGround(point);
    circle.setAttribute("cx", projected.left);
    circle.setAttribute("cy", projected.top);
    circle.setAttribute("r", "0.7");
    overlay.append(circle);
  }
  if (placement.activeTool !== "select" && placement.activeTool !== "path" && hoverPoint) {
    const ghost = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    const projected = projectGround(hoverPoint);
    ghost.classList.add("editor-tool-ghost");
    ghost.setAttribute("cx", projected.left);
    ghost.setAttribute("cy", projected.top);
    ghost.setAttribute("r", placement.activeTool === "trigger" ? "2.5" : "1.2");
    overlay.append(ghost);
  }
}

function nextModelAssetId() {
  let number = 1;
  const ids = new Set(world.snapshot().assets.map(asset => asset.id));
  while (ids.has(`asset.model.${String(number).padStart(3, "0")}`)) number += 1;
  return `asset.model.${String(number).padStart(3, "0")}`;
}

function renderModelAssets() {
  els.modelAssets.replaceChildren();
  const assets = world.snapshot().assets.filter(asset => asset.type === "model");
  if (placement.options.assetId && !assets.some(asset => asset.id === placement.options.assetId)) {
    placement.setOption("assetId", "");
  }
  if (!assets.length) {
    const note = document.createElement("span");
    note.className = "editor-empty";
    note.textContent = "등록된 모델이 없습니다.";
    els.modelAssets.append(note);
  }
  for (const asset of assets) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "editor-model-asset";
    button.textContent = asset.metadata?.label || asset.uri;
    button.title = `${asset.id} · ${asset.uri}`;
    button.setAttribute("aria-pressed", String(asset.id === placement.options.assetId));
    button.addEventListener("click", () => {
      placement.setOption("assetId", asset.id);
      activatePlacementTool("building");
    });
    els.modelAssets.append(button);
  }
}

function toolField(labelText, key, value, choices = null) {
  const label = document.createElement("label");
  label.textContent = labelText;
  const input = choices ? document.createElement("select") : document.createElement("input");
  if (choices) {
    for (const choice of choices) {
      const option = document.createElement("option");
      option.value = Array.isArray(choice) ? choice[0] : choice;
      option.textContent = Array.isArray(choice) ? choice[1] : choice;
      input.append(option);
    }
  } else input.type = typeof value === "number" ? "number" : "text";
  input.value = String(value);
  input.setAttribute("aria-label", labelText);
  input.addEventListener("change", () => {
    if (key === "triggerSize" || key === "structureSize") return;
    placement.setOption(key, input.value);
    if (key === "triggerShape") renderToolOptions();
    if (key === "pathInterpolation") renderToolOverlay();
    renderToolPalette();
  });
  label.append(input);
  return label;
}

function renderToolOptions() {
  els.toolOptions.replaceChildren();
  const options = placement.options;
  if (placement.activeTool === "building") {
    els.toolOptions.append(toolField("Area ID (optional)", "areaId", options.areaId));
  } else if (placement.activeTool === "structure") {
    options.structureSize.forEach((size, index) => {
      const field = toolField(`Size ${"XYZ"[index]} (m)`, "structureSize", size);
      field.querySelector("input").addEventListener("change", event => {
        const next = [...placement.options.structureSize];
        next[index] = event.target.value;
        placement.setOption("structureSize", next);
      });
      els.toolOptions.append(field);
    });
    els.toolOptions.append(toolField("Color (#RRGGBB)", "structureColor", options.structureColor));
  } else if (placement.activeTool === "path") {
    els.toolOptions.append(
      toolField("Path type", "pathType", options.pathType, ["walkway", "road"]),
      toolField("경로 형태", "pathInterpolation", options.pathInterpolation, [["linear", "직선"], ["catmull-rom", "부드러운 곡선"]]),
      toolField("Width (m)", "widthMeters", options.widthMeters)
    );
    const commit = document.createElement("button");
    commit.type = "button";
    commit.textContent = "Commit path · Enter";
    commit.addEventListener("click", () => runEdit(() => { placement.commitPath(); renderToolPalette(); renderToolOverlay(); }));
    els.toolOptions.append(commit);
  } else if (placement.activeTool === "spawn") {
    els.toolOptions.append(
      toolField("Spawn type", "spawnType", options.spawnType, ["player", "npc", "prop", "custom"]),
      toolField("Ref ID", "spawnRefId", options.spawnRefId),
      toolField("Radius (m)", "spawnRadiusMeters", options.spawnRadiusMeters)
    );
  } else if (placement.activeTool === "trigger") {
    els.toolOptions.append(
      toolField("Trigger type", "triggerType", options.triggerType, ["quest", "interaction", "custom"]),
      toolField("Ref ID", "triggerRefId", options.triggerRefId),
      toolField("Shape", "triggerShape", options.triggerShape, ["box", "sphere"])
    );
    if (options.triggerShape === "box") {
      options.triggerSize.forEach((size, index) => {
        const field = toolField(`Size ${"XYZ"[index]} (m)`, "triggerSize", size);
        field.querySelector("input").addEventListener("change", event => {
          const next = [...placement.options.triggerSize];
          next[index] = event.target.value;
          placement.setOption("triggerSize", next);
        });
        els.toolOptions.append(field);
      });
    } else els.toolOptions.append(toolField("Sphere radius (m)", "triggerRadius", options.triggerRadius));
  }
}

function renderToolPalette() {
  document.querySelectorAll("[data-placement-tool]").forEach(button => {
    button.setAttribute("aria-pressed", String(button.dataset.placementTool === placement.activeTool));
  });
  els.viewport.dataset.placementTool = placement.activeTool;
  const hints = {
    select: "Entity를 선택하거나 변형하세요.",
    building: placement.options.assetId ? "작업면 클릭으로 선택한 모델을 반복 배치합니다." : "먼저 Model Asset을 선택하세요.",
    structure: "작업면 클릭으로 편집 가능한 Box Structure를 배치합니다.",
    path: `${placement.points.length}점 · ${placement.options.pathInterpolation === "catmull-rom" ? "곡선은 3점 이상" : "직선은 2점 이상"} · 클릭으로 점 추가, Enter/더블클릭 확정, Backspace 마지막 점 취소, Esc 전체 취소`,
    spawn: "Ref ID를 입력하고 작업면을 클릭하세요.",
    trigger: "Ref ID와 Shape를 정하고 작업면을 클릭하세요."
  };
  els.toolHint.textContent = placement.diagnostics[0] || hints[placement.activeTool];
  renderModelAssets();
}

function activatePlacementTool(tool) {
  placement.activate(tool);
  if (tool !== "select") state.setTool("select");
  renderToolOptions();
  renderToolPalette();
  renderToolOverlay();
  renderGizmo(state.selectedEntityId ? world.getEntity(state.selectedEntityId) : null);
}

function makeField(labelText, value, onCommit, { step = "0.1", type = "number", ariaLabel = labelText } = {}) {
  const label = document.createElement("label");
  label.className = "editor-field";
  const caption = document.createElement("span");
  caption.textContent = labelText;
  const input = document.createElement("input");
  input.type = type;
  input.setAttribute("aria-label", ariaLabel);
  if (type === "checkbox") input.checked = Boolean(value);
  else input.value = String(value);
  if (type === "number") input.step = step;
  input.addEventListener("change", () => {
    runEdit(() => onCommit(type === "checkbox" ? input.checked : input.value));
    renderInspector();
  });
  label.append(caption, input);
  return label;
}

function numeric(value) {
  const parsed = Number(value);
  if (value.trim() === "" || !Number.isFinite(parsed)) throw new Error("E_TRANSFORM_NUMBER_INVALID");
  return parsed;
}

function transformSection(title, hint) {
  const section = document.createElement("section");
  section.className = "editor-inspector-section";
  const heading = document.createElement("h3");
  heading.textContent = title;
  section.append(heading);
  if (hint) {
    const note = document.createElement("p");
    note.className = "editor-inspector-hint";
    note.textContent = hint;
    section.append(note);
  }
  return section;
}

function renderInspector() {
  els.inspector.replaceChildren();
  const entity = state.selectedEntityId ? world.getEntity(state.selectedEntityId) : null;
  els.deleteButton.disabled = !entity;
  els.duplicateButton.disabled = !entity;
  if (!entity) {
    const empty = document.createElement("div");
    empty.className = "editor-inspector-empty";
    empty.innerHTML = "<strong>선택 없음</strong><span>Hierarchy 또는 Viewport에서 Entity를 선택하세요.</span>";
    els.inspector.append(empty);
    return;
  }

  const title = document.createElement("div");
  title.className = "editor-inspector-title";
  const heading = document.createElement("strong");
  heading.textContent = entity.name;
  const id = document.createElement("code");
  id.textContent = entity.id;
  title.append(heading, id);
  els.inspector.append(title);
  els.inspector.append(makeField("Name", entity.name, value => commands.renameEntity(entity.id, value), { type: "text" }));

  const position = transformSection("Position · local", "좌표는 부모 기준 local 값으로 저장됩니다.");
  const rotation = transformSection("Rotation · degrees", "UI는 degree, 문서는 quaternion을 사용합니다.");
  const scale = transformSection("Scale · local");
  const euler = eulerFromQuaternion(entity.transform.rotation);
  ["X", "Y", "Z"].forEach((axis, index) => {
    position.append(makeField(axis, Number(entity.transform.position[index].toFixed(3)), value => {
      const current = world.getEntity(entity.id).transform;
      const next = structuredClone(current);
      next.position[index] = numeric(value);
      commands.setTransform(entity.id, next);
    }, { ariaLabel: "Position " + axis }));
    rotation.append(makeField(axis, Number(euler[index].toFixed(3)), value => {
      const current = world.getEntity(entity.id).transform;
      const angles = eulerFromQuaternion(current.rotation);
      angles[index] = numeric(value);
      commands.setTransform(entity.id, { ...current, rotation: quaternionFromEuler(angles) });
    }, { step: "1", ariaLabel: "Rotation " + axis }));
    scale.append(makeField(axis, Number(entity.transform.scale[index].toFixed(3)), value => {
      const current = world.getEntity(entity.id).transform;
      const next = structuredClone(current);
      next.scale[index] = numeric(value);
      commands.setTransform(entity.id, next);
    }, { ariaLabel: "Scale " + axis }));
  });
  els.inspector.append(position, rotation, scale);

  const properties = transformSection("Properties");
  properties.append(makeField("Enabled", entity.enabled, value => commands.setEnabled(entity.id, value), { type: "checkbox" }));
  properties.append(makeField("Tags", entity.tags.join(", "), value =>
    commands.setTags(entity.id, value.split(",").map(tag => tag.trim()).filter(Boolean)), { type: "text" }));
  els.inspector.append(properties);

  const structureData=entity.components["world.structure"];
  if(structureData){
    const structureSection=transformSection("Structure Geometry", "Box 크기는 meter 단위입니다. Move/Rotate/Scale gizmo와 함께 사용할 수 있습니다.");
    structureData.sizeMeters.forEach((size,index)=>{
      structureSection.append(makeField(`Size ${"XYZ"[index]} (m)`,size,value=>{
        const current=world.getEntity(entity.id).components["world.structure"];
        const next=[...current.sizeMeters];
        next[index]=numeric(value);
        commands.setComponentField(entity.id,"world.structure","sizeMeters",next);
      },{step:"0.1",ariaLabel:`Structure size ${"XYZ"[index]}`}));
    });
    structureSection.append(makeField("Color",structureData.color||"#b8b8ad",value=>
      commands.setComponentField(entity.id,"world.structure","color",value.trim()),{type:"text",ariaLabel:"Structure color"}));
    els.inspector.append(structureSection);
  }

  const pathData=entity.components["world.path"];
  if(pathData){
    const pathSection=transformSection("Path Geometry · production", "폭과 각 점은 meter 단위입니다. 정문 정본은 Export world.json으로 production 파일을 갱신합니다.");
    pathSection.append(makeField("Width (m)", pathData.widthMeters, value =>
      commands.setComponentField(entity.id,"world.path","widthMeters",numeric(value)), { step:"0.1", ariaLabel:"Path width meters" }));
    pathData.points.forEach((point,pointIndex)=>{
      ["X","Y","Z"].forEach((axis,axisIndex)=>{
        pathSection.append(makeField(`P${pointIndex+1} ${axis} (m)`,point[axisIndex],value=>{
          const current=world.getEntity(entity.id).components["world.path"];
          const points=structuredClone(current.points);
          points[pointIndex][axisIndex]=numeric(value);
          commands.setComponentField(entity.id,"world.path","points",points);
        },{ step:"0.1",ariaLabel:`Path point ${pointIndex+1} ${axis}` }));
      });
    });
    els.inspector.append(pathSection);
  }

  const components = transformSection("Components", "WorldDocument에 저장되는 Component 값입니다.");
  for (const [name, value] of Object.entries(entity.components)) {
    const item = document.createElement("div");
    item.className = "editor-component";
    const heading = document.createElement("strong");
    heading.textContent = name;
    const data = document.createElement("pre");
    data.textContent = JSON.stringify(value, null, 2);
    item.append(heading, data);
    components.append(item);
  }
  if (!Object.keys(entity.components).length) {
    const empty = document.createElement("p");
    empty.className = "editor-inspector-hint";
    empty.textContent = "Component 없음";
    components.append(empty);
  }
  els.inspector.append(components);

  const meta = document.createElement("dl");
  meta.className = "editor-meta";
  const kindLabel = document.createElement("dt");
  kindLabel.textContent = "Kind";
  const kindValue = document.createElement("dd");
  kindValue.textContent = entity.kind;
  meta.append(kindLabel, kindValue);
  els.inspector.append(meta);
}

function renderToolbar() {
  document.querySelectorAll("[data-editor-tool]").forEach(button => {
    button.setAttribute("aria-pressed", String(placement.activeTool === "select" && button.dataset.editorTool === state.activeTool));
  });
  els.spaceButton.textContent = state.transformSpace === "world" ? "World" : "Local";
  els.spaceButton.setAttribute("aria-pressed", String(state.transformSpace === "local"));
  els.moveSnap.value = String(state.translateSnap);
  els.rotateSnap.value = String(state.rotateSnap);
  els.undoButton.disabled = !commands.canUndo;
  els.redoButton.disabled = !commands.canRedo;
}

function renderStatus() {
  els.worldName.textContent = world.name;
  els.dirty.textContent = world.dirty ? "● 미저장" : "정본";
  els.dirty.dataset.dirty = String(world.dirty);
  els.entityCount.textContent = world.entityCount + " entities";
  els.revision.textContent = "rev " + world.revision;
  els.persistence.textContent = persistenceLabel;
  els.rendererStatus.textContent = runtimePreview ? "Renderer: Runtime Adapter" : "Renderer: 2D edit";
  els.saveButton.disabled = documentBusy || !store;
  els.openProjectButton.disabled = documentBusy || !store;
  els.mainGateButton.disabled = documentBusy;
  els.newButton.disabled = documentBusy;
  els.openFileButton.disabled = documentBusy;
  els.exportButton.disabled = documentBusy;
  els.validateButton.disabled = documentBusy;
}

function render() {
  if (!world || !commands) return;
  if (state.selectedEntityId && !world.hasEntity(state.selectedEntityId)) {
    state.clearSelection();
    return;
  }
  renderToolbar();
  renderToolPalette();
  renderHierarchy();
  renderViewport();
  renderInspector();
  renderStatus();
  postStudioBridge("status");
}

function beginGizmoDrag(event, handle) {
  if (event.button !== 0 || drag) return;
  const gizmo = handle.closest(".editor-gizmo");
  const id = gizmo.dataset.entityId;
  const before = commands.beginTransform(id, handle.dataset.mode);
  drag = {
    id,
    mode: handle.dataset.mode,
    axis: handle.dataset.axis,
    space: state.transformSpace,
    before,
    startX: event.clientX,
    startY: event.clientY,
    pointerId: event.pointerId,
    handle
  };
  els.viewport.dataset.dragging = "true";
  handle.setPointerCapture(event.pointerId);
  event.preventDefault();
  event.stopPropagation();
}

function onGizmoMove(event) {
  if (!drag || event.pointerId !== drag.pointerId) return;
  const dx = event.clientX - drag.startX;
  const dy = event.clientY - drag.startY;
  let amount;
  if (drag.mode === "move") {
    const basis = drag.axis === "x" ? [1, 0, 0] : drag.axis === "y" ? [0, 1, 0] : [0, 0, 1];
    const rotation = worldTransform(world, drag.id, drag.before).rotation;
    const direction = drag.space === "local" ? rotateVector(rotation, basis) : basis;
    const projected = projectionDirection(direction);
    const bounds = els.viewport.getBoundingClientRect();
    const sx = projected[0] * bounds.width * 0.014;
    const sy = projected[1] * bounds.height * 0.014;
    amount = (dx * sx + dy * sy) / Math.max(1e-6, sx * sx + sy * sy);
    if (state.translateSnap) amount = Math.round(amount / state.translateSnap) * state.translateSnap;
  } else if (drag.mode === "rotate") {
    amount = dx * 0.7 - dy * 0.35;
    if (state.rotateSnap) amount = Math.round(amount / state.rotateSnap) * state.rotateSnap;
  } else amount = (dx - dy) / 100;
  runEdit(() => {
    const next = transformedForDrag(world, drag.id, drag.before, drag.mode, drag.axis, drag.space, amount);
    commands.previewTransform(next);
  });
}

function onGizmoUp(event) {
  if (!drag || event.pointerId !== drag.pointerId) return;
  drag = null;
  delete els.viewport.dataset.dragging;
  runEdit(() => commands.commitTransform());
}

function cancelDrag() {
  if (!drag) return;
  const handle = drag.handle;
  const pointerId = drag.pointerId;
  drag = null;
  delete els.viewport.dataset.dragging;
  if (handle.hasPointerCapture?.(pointerId)) handle.releasePointerCapture(pointerId);
  commands?.cancelTransform();
}

function isTextTarget(target) {
  return target instanceof HTMLElement && (
    target.isContentEditable ||
    ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)
  );
}

function onKeyboard(event) {
  if (event.key === "Escape" && drag) {
    event.preventDefault();
    cancelDrag();
    return;
  }
  const key = event.key.toLowerCase();
  // An active gizmo drag owns the keyboard: only Esc (above) acts. Undo/Redo/Save/Duplicate wait
  // for pointerup, so one keystroke never both cancels the drag and undoes an earlier edit.
  if (drag) {
    if ((event.ctrlKey || event.metaKey) && ["s", "z", "y", "d"].includes(key)) event.preventDefault();
    return;
  }
  if (isTextTarget(event.target)) return;
  if (event.ctrlKey || event.metaKey) {
    if (key === "s") {
      event.preventDefault();
      runDocumentAction(saveProject);
    } else if (key === "z") {
      event.preventDefault();
      runEdit(() => event.shiftKey ? commands.redo() : commands.undo());
    } else if (key === "y") {
      event.preventDefault();
      runEdit(() => commands.redo());
    } else if (key === "d") {
      event.preventDefault();
      duplicateSelected();
    }
    return;
  }
  if (event.altKey) return;
  if (placement.activeTool !== "select") {
    if (event.key === "Escape") {
      event.preventDefault();
      if (placement.points.length) placement.cancel();
      else activatePlacementTool("select");
      renderToolPalette(); renderToolOverlay();
      return;
    }
    if (placement.activeTool === "path" && (event.key === "Backspace" || event.key === "Delete")) {
      event.preventDefault();
      placement.backspace(); renderToolPalette(); renderToolOverlay();
      return;
    }
    if (placement.activeTool === "path" && event.key === "Enter") {
      event.preventDefault();
      runEdit(() => placement.commitPath());
      renderToolPalette(); renderToolOverlay();
      return;
    }
  }
  if (key === "w" || key === "e" || key === "r") {
    activatePlacementTool("select");
    state.setTool({ w: "move", e: "rotate", r: "scale" }[key]);
  } else if (event.key === "Escape") {
    state.clearSelection();
  } else if (event.key === "Delete" || event.key === "Backspace") {
    event.preventDefault();
    deleteSelected();
  } else if (key === "f" && state.selectedEntityId) {
    els.viewport.querySelectorAll(".editor-viewport-entity").forEach(marker => {
      if (marker.dataset.entityId === state.selectedEntityId) marker.focus();
    });
  }
}

document.querySelectorAll("[data-editor-tool]").forEach(button => {
  button.addEventListener("click", () => { activatePlacementTool("select"); state.setTool(button.dataset.editorTool); });
});
document.querySelectorAll("[data-placement-tool]").forEach(button => {
  button.addEventListener("click", () => activatePlacementTool(button.dataset.placementTool));
});
els.modelForm.addEventListener("submit", event => {
  event.preventDefault();
  runEdit(() => {
    const uri = els.modelUri.value.trim();
    const resolved = new URL(uri, location.origin);
    if (resolved.origin !== location.origin || !/\.glb$/i.test(resolved.pathname)) throw new Error("E_MODEL_URI_SAME_ORIGIN_GLB_REQUIRED");
    const existing = world.snapshot().assets.find(asset => asset.type === "model" && asset.uri === resolved.pathname);
    if (existing) { placement.setOption("assetId", existing.id); activatePlacementTool("building"); return; }
    const asset = commands.addAsset({
      id: nextModelAssetId(),
      type: "model", uri: resolved.pathname,
      metadata: { label: resolved.pathname.split("/").at(-1) }
    });
    placement.setOption("assetId", asset.id);
    els.modelUri.value = "";
    activatePlacementTool("building");
  });
});
els.modelImportButton.addEventListener("click", () => els.modelFile.click());
els.modelFile.addEventListener("change", () => runDocumentAction(async () => {
  const file = els.modelFile.files?.[0];
  els.modelFile.value = "";
  if (!file) return;
  const targetWorldId = world.worldId;
  const assetId = nextModelAssetId();
  els.modelImportButton.disabled = true;
  els.modelImportStatus.textContent = /\.fbx$/iu.test(file.name) ? "FBX → GLB 변환 중…" : "GLB 가져오는 중…";
  try {
    const imported = await importEditorModel({ file, worldId: targetWorldId, assetId, store });
    if (world.worldId !== targetWorldId) throw new Error("E_MODEL_IMPORT_WORLD_CHANGED");
    const asset = runEdit(() => commands.addAsset({
      id: assetId,
      type: "model",
      uri: imported.uri,
      metadata: {
        label: imported.label,
        editorLocal: true,
        sourceFormat: imported.sourceFormat,
        size: imported.size
      }
    }));
    placement.setOption("assetId", asset.id);
    activatePlacementTool("building");
    els.modelImportStatus.textContent = `${imported.label} · 브라우저 프로젝트에 저장됨`;
  } catch (error) {
    await store.deleteAsset(targetWorldId, assetId).catch(() => {});
    els.modelImportStatus.textContent = error.message;
    throw error;
  } finally {
    els.modelImportButton.disabled = false;
  }
}));
document.querySelectorAll("[data-editor-asset]").forEach(button => {
  button.addEventListener("click", addTestProp);
});
els.viewport.addEventListener("click", event => {
  if (runtimePreview) return;
  if (event.target.closest(".editor-gizmo")) return;
  const marker = event.target.closest(".editor-viewport-entity");
  if (marker) { state.select(marker.dataset.entityId); return; }
  if (placement.activeTool !== "select") {
    if (event.detail > 1) return;
    const point = groundFromViewport(event.clientX, event.clientY, els.viewport.getBoundingClientRect());
    runEdit(() => placement.place(point));
    renderToolPalette(); renderToolOverlay();
    return;
  }
  state.select(null);
});
els.viewport.addEventListener("dblclick", event => {
  if (placement.activeTool !== "path" || event.target.closest(".editor-viewport-entity")) return;
  event.preventDefault();
  runEdit(() => placement.commitPath());
  renderToolPalette(); renderToolOverlay();
});
els.viewport.addEventListener("pointermove", event => {
  if (placement.activeTool === "select" || runtimePreview) return;
  placement.hover(groundFromViewport(event.clientX, event.clientY, els.viewport.getBoundingClientRect()));
  renderToolOverlay();
});
els.viewport.addEventListener("pointerleave", () => { placement.hover(null); renderToolOverlay(); });
els.deleteButton.addEventListener("click", deleteSelected);
els.duplicateButton.addEventListener("click", duplicateSelected);
els.undoButton.addEventListener("click", () => runEdit(() => commands.undo()));
els.redoButton.addEventListener("click", () => runEdit(() => commands.redo()));
els.spaceButton.addEventListener("click", () => state.setTransformSpace(state.transformSpace === "world" ? "local" : "world"));
els.moveSnap.addEventListener("change", () => state.setSnap("move", Number(els.moveSnap.value)));
els.rotateSnap.addEventListener("change", () => state.setSnap("rotate", Number(els.rotateSnap.value)));
els.saveButton.addEventListener("click", () => runDocumentAction(saveProject));
els.newButton.addEventListener("click", () => runDocumentAction(async () => {
  if (!await guardDirty("새 월드를 만들기")) return;
  const next = new WorldDocument(createEmptyWorld());
  next.markUnsaved();
  await switchWorld(next);
  setFileStatus("새 월드 · 아직 프로젝트에 저장되지 않았습니다.");
}));
els.mainGateButton.addEventListener("click", () => runDocumentAction(async () => {
  if (!await guardDirty("정문 production 정본을 열기")) return;
  const response=await fetch("/data/editor/main-gate.world.json",{cache:"no-store"});
  if(!response.ok)throw new Error(`E_MAIN_GATE_CANONICAL_LOAD:${response.status}`);
  const next=loadWorldDocument(await response.text(),{unsaved:true});
  await switchWorld(next);
  setFileStatus("정문 production 정본 불러옴 · 수정 후 Export world.json으로 정본 교체 파일을 만드세요.");
}));
els.openProjectButton.addEventListener("click", () => runDocumentAction(async () => {
  const projects = await store.listProjects();
  if (!projects.length) { setFileStatus("저장된 프로젝트가 없습니다."); return; }
  const selected = await askProjectChoice(projects);
  if (!selected) return;
  if (!await guardDirty("프로젝트를 열기")) return;
  const next = loadWorldDocument(selected.text);
  await switchWorld(next);
  await store.selectProject(next.worldId);
  setFileStatus("저장된 프로젝트를 열었습니다. History가 초기화되었습니다.");
}));
els.projectCancel.addEventListener("click", () => els.projectDialog.close());
els.openFileButton.addEventListener("click", () => runDocumentAction(async () => {
  if (!await guardDirty("world.json을 가져오기")) return;
  els.fileInput.click();
}));
els.fileInput.addEventListener("change", () => runDocumentAction(async () => {
  const file = els.fileInput.files?.[0];
  els.fileInput.value = "";
  if (!file) return;
  const next = loadWorldDocument(await file.text(), { unsaved: true });
  await switchWorld(next);
  setFileStatus(`${file.name} 가져옴 · 프로젝트 저장 필요`);
}));
els.exportButton.addEventListener("click", () => runDocumentAction(async () => {
  const { text, validation } = prepareWorldSave(world);
  const url = URL.createObjectURL(new Blob([text], { type: "application/json;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = "world.json";
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  const localAssets = world.snapshot().assets.filter(asset => asset.metadata?.editorLocal).length;
  setFileStatus(`world.json 내보냄 · 경고 ${validation.warnings.length}개${localAssets ? ` · 로컬 모델 ${localAssets}개는 이 브라우저 전용` : ""} · 프로젝트 저장 상태는 별도`);
}));
els.validateButton.addEventListener("click", () => {
  const result = validateWorld(world.snapshot());
  const first = result.errors[0] || result.warnings[0];
  setFileStatus(`검증: 오류 ${result.errors.length}개 · 경고 ${result.warnings.length}개${first ? ` · ${first.code}` : ""}`);
});
els.previewToggle.addEventListener("click", () => runDocumentAction(toggleRuntimePreview));

async function handleStudioBridgeCommand(event) {
  if (!STUDIO_HOST_MODE || event.origin !== globalThis.location.origin || event.source !== globalThis.parent) return;
  const message = event.data;
  if (!message || message.channel !== STUDIO_BRIDGE_CHANNEL || message.type !== "command" || !message.requestId) return;
  const respond = (ok, result = null, error = null) => postStudioBridge("response", {
    requestId: message.requestId,
    ok,
    ...(ok ? { result } : { error })
  });
  try {
    let result = null;
    if (message.action === "save") {
      result = await performDocumentAction(async () => ({ saved: await saveProject() }));
    } else if (message.action === "toggle-preview") {
      result = await performDocumentAction(async () => {
        await toggleRuntimePreview();
        return { previewOpen: Boolean(runtimePreview) };
      });
    } else if (message.action === "undo") {
      result = { applied: Boolean(runEdit(() => commands.undo())) };
    } else if (message.action === "redo") {
      result = { applied: Boolean(runEdit(() => commands.redo())) };
    } else if (message.action === "get-content") {
      result = studioContentSnapshot();
    } else if (message.action === "get-inspector") {
      result = studioInspectorSnapshot();
    } else if (message.action === "update-inspector") {
      result = updateStudioWorldInspector(message.payload);
    } else if (message.action === "select-content") {
      const kind = String(message.payload?.kind || "");
      const id = String(message.payload?.id || "");
      if (kind === "entity") {
        if (!world.hasEntity(id)) throw new Error(`E_ENTITY_NOT_FOUND:${id}`);
        placement.activate("select");
        placement.setOption("assetId", "");
        state.select(id);
        renderToolPalette();
        result = { selected: true, kind, id };
      } else if (kind === "asset") {
        const asset = world.snapshot().assets.find(item => item.id === id);
        if (!asset) throw new Error(`E_ASSET_NOT_FOUND:${id}`);
        if (asset.type !== "model") throw new Error(`E_STUDIO_WORLD_ASSET_NOT_SELECTABLE:${id}`);
        state.clearSelection();
        placement.setOption("assetId", id);
        activatePlacementTool("building");
        result = { selected: true, kind, id };
      } else {
        throw new Error(`E_STUDIO_WORLD_CONTENT_KIND_UNKNOWN:${kind}`);
      }
    } else if (message.action === "validate") {
      const validation = validateWorld(world.snapshot());
      const first = validation.errors[0] || validation.warnings[0];
      setFileStatus(`검증: 오류 ${validation.errors.length}개 · 경고 ${validation.warnings.length}개${first ? ` · ${first.code}` : ""}`);
      result = {
        valid: validation.valid,
        errors: validation.errors.length,
        warnings: validation.warnings.length,
        firstCode: first?.code ?? null
      };
    } else if (message.action === "get-status") {
      result = studioBridgeStatus();
    } else {
      throw new Error(`E_STUDIO_WORLD_COMMAND_UNKNOWN:${message.action}`);
    }
    respond(true, result);
  } catch (error) {
    respond(false, null, error?.message || String(error));
  }
}
globalThis.addEventListener("message", event => { void handleStudioBridgeCommand(event); });
document.addEventListener("keydown", onKeyboard);
window.addEventListener("blur", cancelDrag);
window.addEventListener("resize", () => { runtimePreview?.resize(); mapReference.render(); });
window.addEventListener("beforeunload", event => {
  if (!world?.dirty) return;
  event.preventDefault();
  event.returnValue = "";
});
state.subscribe(render);

mountWorld(createSandbox());
async function initializePersistence() {
  try {
    store = await EditorBrowserStore.open();
    persistenceLabel = "Persistence: IndexedDB 프로젝트";
    const canonical = await store.readLatestCanonical();
    if (canonical && !world.dirty) mountWorld(loadWorldDocument(canonical));
    else await mapReference.loadForWorld(world.worldId);
    const recovery = await store.readRecovery();
    if (recovery && !world.dirty) {
      if (window.confirm("저장되지 않은 복구 초안이 있습니다. 복구할까요?\n확인: Recover · 취소: Ignore")) {
        mountWorld(loadWorldDocument(recovery.text, { unsaved: true }));
        setFileStatus("복구 초안을 열었습니다. 정본을 덮어쓰려면 Save Project를 누르세요.");
        scheduleRecovery();
      } else {
        await store.clearRecovery();
        setFileStatus("복구 초안을 무시했습니다.");
      }
    } else if (world.dirty) scheduleRecovery();
    else setFileStatus(canonical ? "저장된 프로젝트를 열었습니다." : "새 프로젝트를 만들거나 world.json을 가져오세요.");
  } catch (error) {
    persistenceLabel = "Persistence: 사용 불가";
    setFileStatus(`프로젝트 저장소 오류: ${error.message}`);
    showError(error);
  }
  render();
}
void initializePersistence().finally(() => {
  studioBridgeReady = true;
  render();
  postStudioBridge("ready");
});
